import { ChatEntry } from "../../../../interface/chat_entry";
import { ChatPool } from "../chat_pool";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { DEBUG_LOG } from "../common/debug_log";
import {
  fetchKickChatHistory,
  fetchKickVodMetadata,
  Fetcher,
  getKickHistoryBucketStart,
  KICK_HISTORY_BUCKET_MS,
  KickApiRequester,
  KickVodMetadata,
} from "./kick_api";
import {
  hasRenderableContent,
  renderKickApiMessage,
} from "./kick_message_renderer";

/**
 * A media-time chat source for Kick VODs.
 *
 * Kick's visible chat DOM can arrive several media seconds late. The history
 * endpoint exposes five-second buckets ahead of playback, so this pool fetches
 * those buckets early and only releases each message when video.currentTime
 * reaches its created_at offset. The DOM pool remains a failure fallback.
 */
export class KickVodApiChatPool implements ChatPool {
  private static LOOKAHEAD_MS = 15000;
  private static SEEN_MESSAGE_RETENTION_MS = 60000;
  private static FETCH_TIMEOUT_MS = 10000;

  private requester: KickApiRequester;
  private metadata: KickVodMetadata | undefined;
  private metadataPromise: Promise<KickVodMetadata | undefined> | undefined;
  private generation = 0;
  private baselineTimestamp = 0;
  private lastReadTimestamp = 0;
  private apiActive = false;
  private fallbackActive = false;
  private lastPrefetchBucketStart: number | undefined;
  private completedBucketStarts = new Set<number>();
  private bucketRequests = new Map<number, Promise<void>>();
  private seenMessageIds = new Map<string, number>();
  private pendingChatEntries = new Array<ChatEntry>();

  public constructor(
    fetcher: Fetcher,
    private channelSlug: string,
    private vodId: string,
    private fallback: ChatPool,
    private blockTester: BlockPatternTester,
    window: Window = globalThis.window,
  ) {
    this.requester = new KickApiRequester(fetcher, window);
  }

  public fill(chatEntries: Array<ChatEntry>): void {
    this.fallback.fill(chatEntries);
  }

  public clear(): void {
    this.generation++;
    this.requester.abortAll();
    if (!this.metadata) {
      this.metadataPromise = undefined;
    }
    this.resetApiState();
    this.fallbackActive = false;
    this.fallback.clear();
  }

  public start(destinationTimestamp: number): void {
    let generation = ++this.generation;
    this.requester.abortAll();
    if (!this.metadata) {
      this.metadataPromise = undefined;
    }
    this.baselineTimestamp = Math.max(0, destinationTimestamp);
    this.lastReadTimestamp = this.baselineTimestamp;
    this.resetApiState();
    this.fallbackActive = false;
    this.fallback.start(destinationTimestamp);
    void this.prepare(generation, this.baselineTimestamp);
  }

  public read(currentTimestamp: number): Array<ChatEntry> {
    this.lastReadTimestamp = currentTimestamp;
    if (this.fallbackActive) {
      return this.fallback.read(currentTimestamp);
    }
    if (!this.apiActive || !this.metadata) {
      return [];
    }

    let generation = this.generation;
    this.schedulePrefetch(currentTimestamp, generation);
    let readyCount = 0;
    while (
      readyCount < this.pendingChatEntries.length &&
      (this.pendingChatEntries[readyCount].timestamp ?? Infinity) <=
        currentTimestamp
    ) {
      readyCount++;
    }
    return this.pendingChatEntries.splice(0, readyCount);
  }

  private resetApiState(): void {
    this.apiActive = false;
    this.lastPrefetchBucketStart = undefined;
    this.completedBucketStarts.clear();
    this.bucketRequests.clear();
    this.seenMessageIds.clear();
    this.pendingChatEntries = [];
  }

  private async prepare(
    generation: number,
    destinationTimestamp: number,
  ): Promise<void> {
    try {
      let metadata = await this.loadMetadata();
      if (generation !== this.generation) {
        return;
      }
      if (!metadata) {
        this.activateFallback(
          generation,
          destinationTimestamp,
          "VOD metadata not found",
        );
        return;
      }
      this.metadata = metadata;
      let currentBucketStart = this.getBucketStart(destinationTimestamp);
      await this.requestBucket(currentBucketStart, generation);
      if (generation !== this.generation) {
        return;
      }
      // The current bucket is sufficient to start a media-time timeline. A
      // slow +15s bucket must never hold present messages hostage.
      this.apiActive = true;
      DEBUG_LOG.info("KickVod", "Using history API as chat source.", {
        channelId: metadata.channelId,
        vodId: this.vodId,
      });
      this.lastPrefetchBucketStart = currentBucketStart;
      this.scheduleFutureBuckets(currentBucketStart, generation);
    } catch (error) {
      if (generation === this.generation) {
        this.metadataPromise = undefined;
        this.activateFallback(generation, this.lastReadTimestamp, error);
      }
    }
  }

  private async loadMetadata(): Promise<KickVodMetadata | undefined> {
    if (this.metadata) {
      return this.metadata;
    }
    if (!this.metadataPromise) {
      this.metadataPromise = fetchKickVodMetadata(
        this.requester,
        this.channelSlug,
        this.vodId,
        KickVodApiChatPool.FETCH_TIMEOUT_MS,
      );
    }
    return this.metadataPromise;
  }

  private getBucketStart(currentTimestamp: number): number {
    return getKickHistoryBucketStart(
      this.metadata.startTimestamp + currentTimestamp,
    );
  }

  private schedulePrefetch(
    currentTimestamp: number,
    generation: number,
  ): void {
    if (!this.metadata || generation !== this.generation) {
      return;
    }
    let currentBucketStart = this.getBucketStart(currentTimestamp);
    if (this.lastPrefetchBucketStart === currentBucketStart) {
      return;
    }
    this.lastPrefetchBucketStart = currentBucketStart;
    this.pruneOldState(currentTimestamp);
    void this.requestBucket(currentBucketStart, generation).catch((error) =>
      this.activateFallback(generation, this.lastReadTimestamp, error),
    );
    this.scheduleFutureBuckets(currentBucketStart, generation);
  }

  private scheduleFutureBuckets(
    currentBucketStart: number,
    generation: number,
  ): void {
    for (
      let offset = KICK_HISTORY_BUCKET_MS;
      offset <= KickVodApiChatPool.LOOKAHEAD_MS;
      offset += KICK_HISTORY_BUCKET_MS
    ) {
      // Future buckets are best-effort. They are retried as the playhead gets
      // closer, and only failure of the bucket currently being played causes
      // a DOM fallback.
      void this.requestBucket(currentBucketStart + offset, generation).catch(
        () => {},
      );
    }
  }

  private requestBucket(
    bucketStart: number,
    generation: number,
  ): Promise<void> {
    if (this.completedBucketStarts.has(bucketStart)) {
      return Promise.resolve();
    }
    let existingRequest = this.bucketRequests.get(bucketStart);
    if (existingRequest) {
      return existingRequest;
    }
    let request: Promise<void>;
    request = this.fetchHistoryBucket(bucketStart, generation)
      .then(() => {
        let oldestRetainedBucket =
          this.getBucketStart(this.lastReadTimestamp) -
          KICK_HISTORY_BUCKET_MS * 2;
        if (
          generation === this.generation &&
          bucketStart >= oldestRetainedBucket
        ) {
          this.completedBucketStarts.add(bucketStart);
        }
      })
      .finally(() => {
        if (this.bucketRequests.get(bucketStart) === request) {
          this.bucketRequests.delete(bucketStart);
        }
      });
    this.bucketRequests.set(bucketStart, request);
    return request;
  }

  private async fetchHistoryBucket(
    bucketStart: number,
    generation: number,
  ): Promise<void> {
    let messages = await fetchKickChatHistory(
      this.requester,
      this.metadata.channelId,
      bucketStart,
      KickVodApiChatPool.FETCH_TIMEOUT_MS,
    );
    if (generation !== this.generation) {
      return;
    }
    for (let message of messages) {
      if (!hasRenderableContent(message) || this.seenMessageIds.has(message.id)) {
        continue;
      }
      let createdTimestamp = Date.parse(message.created_at ?? "");
      if (!Number.isFinite(createdTimestamp)) {
        continue;
      }
      let mediaTimestamp = createdTimestamp - this.metadata.startTimestamp;
      if (mediaTimestamp < this.baselineTimestamp) {
        continue;
      }
      this.seenMessageIds.set(message.id, mediaTimestamp);
      let chatEntry: ChatEntry = {
        id: message.id,
        content: renderKickApiMessage(message, mediaTimestamp),
        timestamp: mediaTimestamp,
      };
      if (!this.blockTester.test(chatEntry)) {
        this.pendingChatEntries.push(chatEntry);
      }
    }
    this.pendingChatEntries.sort(
      (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
    );
  }

  private pruneOldState(currentTimestamp: number): void {
    let oldestSeenTimestamp =
      currentTimestamp - KickVodApiChatPool.SEEN_MESSAGE_RETENTION_MS;
    for (let [messageId, mediaTimestamp] of this.seenMessageIds) {
      if (mediaTimestamp < oldestSeenTimestamp) {
        this.seenMessageIds.delete(messageId);
      }
    }
    let oldestBucketStart =
      this.getBucketStart(currentTimestamp) - KICK_HISTORY_BUCKET_MS * 2;
    for (let bucketStart of this.completedBucketStarts) {
      if (bucketStart < oldestBucketStart) {
        this.completedBucketStarts.delete(bucketStart);
      }
    }
    for (let bucketStart of this.bucketRequests.keys()) {
      if (bucketStart < oldestBucketStart) {
        this.bucketRequests.delete(bucketStart);
      }
    }
  }

  private activateFallback(
    generation: number,
    timestamp: number,
    reason: unknown,
  ): void {
    if (generation !== this.generation || this.fallbackActive) {
      return;
    }
    DEBUG_LOG.warnOnce(
      "KickVod",
      `fallback:${this.vodId}`,
      `History API unavailable for VOD ${this.vodId}, using the chat DOM instead (${
        reason instanceof Error ? reason.message : String(reason)
      }).`,
    );
    // Invalidate any other in-flight bucket requests from this API generation.
    this.generation++;
    this.requester.abortAll();
    this.resetApiState();
    this.fallbackActive = true;
    this.fallback.clear();
    this.fallback.start(timestamp);
  }
}
