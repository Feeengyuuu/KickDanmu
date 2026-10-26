import { ChatEntry } from "../../../../interface/chat_entry";
import { ChatPool } from "../chat_pool";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { DEBUG_LOG } from "../common/debug_log";
import {
  fetchKickChatHistory,
  Fetcher,
  getKickHistoryBucketStart,
  KICK_HISTORY_BUCKET_MS,
  KickApiRequester,
  KickHistoryMessage,
} from "./kick_api";
import {
  hasRenderableContent,
  renderKickApiMessage,
} from "./kick_message_renderer";

interface KickLiveChannel {
  channelId: number;
  // Server clock minus local clock, from the same-origin Date header.
  clockOffsetMs: number;
}

/**
 * A live chat source for when Kick's chat list cannot be found in the DOM
 * (chat popped out, narrow layout, or a markup change). It polls the history
 * endpoint, which trails real time by a few seconds, and releases messages at
 * created_at + RELEASE_DELAY_MS so that they keep their natural cadence.
 *
 * Polling is driven by read(), which PlayerController only calls on animation
 * frames while the video plays, so a paused or removed player stops polling
 * without needing an extra lifecycle hook.
 */
export class KickLiveApiChatPool implements ChatPool {
  private static POLL_INTERVAL_MS = 3000;
  private static MAX_BACKOFF_MS = 60000;
  private static FETCH_TIMEOUT_MS = 8000;
  // Buckets are re-read until this old, because messages appear in the
  // history endpoint 3-6 seconds after they are sent.
  private static BUCKET_SETTLE_MS = 10000;
  private static RELEASE_DELAY_MS = 6000;
  private static SEEN_MESSAGE_RETENTION_MS = 120000;
  private static MAX_PENDING_CHATS = 300;

  private requester: KickApiRequester;
  private channel: KickLiveChannel | undefined;
  private channelPromise: Promise<KickLiveChannel | undefined> | undefined;
  private generation = 0;
  private baselineEstablished = false;
  private pollInFlight = false;
  private nextPollTime = 0;
  private failureCount = 0;
  private seenMessageIds = new Map<string, number>();
  private pendingChatEntries = new Array<ChatEntry>();

  public constructor(
    fetcher: Fetcher,
    private channelSlug: string,
    private blockTester: BlockPatternTester,
    private now: () => number = Date.now,
    window: Window = globalThis.window,
  ) {
    this.requester = new KickApiRequester(fetcher, window);
  }

  public fill(): void {
    // Live chat cannot be filled from the DanMage backend.
  }

  public clear(): void {
    this.generation++;
    this.requester.abortAll();
    this.pollInFlight = false;
    this.pendingChatEntries = [];
  }

  public start(): void {
    this.clear();
    // Like the DOM pool, a (re)started live pool only shows chats sent from
    // now on. The first successful poll marks everything it sees as history.
    this.baselineEstablished = false;
    this.seenMessageIds.clear();
    this.nextPollTime = 0;
    this.failureCount = 0;
  }

  public read(): Array<ChatEntry> {
    let now = this.now();
    if (!this.pollInFlight && now >= this.nextPollTime) {
      this.pollInFlight = true;
      void this.poll(this.generation);
    }
    if (!this.channel) {
      return [];
    }
    let serverNow = now + this.channel.clockOffsetMs;
    let readyCount = 0;
    while (
      readyCount < this.pendingChatEntries.length &&
      this.pendingChatEntries[readyCount].timestamp +
        KickLiveApiChatPool.RELEASE_DELAY_MS <=
        serverNow
    ) {
      readyCount++;
    }
    return this.pendingChatEntries.splice(0, readyCount);
  }

  private async poll(generation: number): Promise<void> {
    try {
      let channel = await this.loadChannel();
      if (generation !== this.generation) {
        return;
      }
      if (!channel) {
        throw new Error(`Kick channel ${this.channelSlug} not found`);
      }
      let serverNow = this.now() + channel.clockOffsetMs;
      let bucketStarts = new Array<number>();
      for (
        let bucketStart = getKickHistoryBucketStart(
          serverNow - KickLiveApiChatPool.BUCKET_SETTLE_MS,
        );
        bucketStart <= serverNow;
        bucketStart += KICK_HISTORY_BUCKET_MS
      ) {
        bucketStarts.push(bucketStart);
      }
      let buckets = await Promise.all(
        bucketStarts.map((bucketStart) =>
          fetchKickChatHistory(
            this.requester,
            channel.channelId,
            bucketStart,
            KickLiveApiChatPool.FETCH_TIMEOUT_MS,
          ),
        ),
      );
      if (generation !== this.generation) {
        return;
      }
      this.acceptMessages(buckets.flat(), serverNow);
      if (this.failureCount > 0) {
        DEBUG_LOG.resetWarning("KickLive", "poll");
      }
      this.failureCount = 0;
      this.nextPollTime = this.now() + KickLiveApiChatPool.POLL_INTERVAL_MS;
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      if (!this.channel) {
        this.channelPromise = undefined;
      }
      this.failureCount++;
      let backoff = Math.min(
        KickLiveApiChatPool.MAX_BACKOFF_MS,
        KickLiveApiChatPool.POLL_INTERVAL_MS * 2 ** this.failureCount,
      );
      this.nextPollTime = this.now() + backoff;
      DEBUG_LOG.warnOnce(
        "KickLive",
        "poll",
        `Live chat history request failed, retrying with backoff (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    } finally {
      if (generation === this.generation) {
        this.pollInFlight = false;
      }
    }
  }

  private acceptMessages(
    messages: Array<KickHistoryMessage>,
    serverNow: number,
  ): void {
    let isBaseline = !this.baselineEstablished;
    this.baselineEstablished = true;
    let newChatEntries = new Array<ChatEntry>();
    for (let message of messages) {
      if (!hasRenderableContent(message) || this.seenMessageIds.has(message.id)) {
        continue;
      }
      let createdTimestamp = Date.parse(message.created_at ?? "");
      if (!Number.isFinite(createdTimestamp)) {
        continue;
      }
      this.seenMessageIds.set(message.id, createdTimestamp);
      if (isBaseline) {
        continue;
      }
      let chatEntry: ChatEntry = {
        id: message.id,
        content: renderKickApiMessage(message),
        timestamp: createdTimestamp,
      };
      if (!this.blockTester.test(chatEntry)) {
        newChatEntries.push(chatEntry);
      }
    }
    this.pendingChatEntries.push(...newChatEntries);
    this.pendingChatEntries.sort(
      (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
    );
    let overflow =
      this.pendingChatEntries.length - KickLiveApiChatPool.MAX_PENDING_CHATS;
    if (overflow > 0) {
      this.pendingChatEntries.splice(0, overflow);
    }
    let oldestSeenTimestamp =
      serverNow - KickLiveApiChatPool.SEEN_MESSAGE_RETENTION_MS;
    for (let [messageId, createdTimestamp] of this.seenMessageIds) {
      if (createdTimestamp < oldestSeenTimestamp) {
        this.seenMessageIds.delete(messageId);
      }
    }
  }

  private loadChannel(): Promise<KickLiveChannel | undefined> {
    if (this.channel) {
      return Promise.resolve(this.channel);
    }
    if (!this.channelPromise) {
      this.channelPromise = this.fetchChannel();
    }
    return this.channelPromise;
  }

  private async fetchChannel(): Promise<KickLiveChannel | undefined> {
    let clockOffsetMs = 0;
    let requestStart = this.now();
    let info = await this.requester.fetchJson<{ id?: number }>(
      `/api/v2/channels/${encodeURIComponent(this.channelSlug)}/info`,
      "Kick channel metadata failed",
      KickLiveApiChatPool.FETCH_TIMEOUT_MS,
      (response) => {
        let serverDate = Date.parse(response.headers?.get("date") ?? "");
        if (Number.isFinite(serverDate)) {
          // Date has one-second precision; assume the server stamped the
          // middle of the round trip.
          clockOffsetMs = serverDate + 500 - (requestStart + this.now()) / 2;
        }
      },
    );
    if (!Number.isFinite(info?.id)) {
      return undefined;
    }
    this.channel = { channelId: info.id, clockOffsetMs };
    DEBUG_LOG.info("KickLive", "Using history API as live chat source.", {
      channelSlug: this.channelSlug,
      ...this.channel,
    });
    return this.channel;
  }
}
