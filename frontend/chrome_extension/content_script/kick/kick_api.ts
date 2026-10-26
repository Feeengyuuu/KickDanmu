/**
 * Kick's public web endpoints used by the extension, verified on 2026-10-17:
 *   GET kick.com/api/v2/channels/{slug}/info                -> { id }
 *   GET web.kick.com/api/v1/channels/{id}/videos/{vodId}    -> { data: video }
 *   GET web.kick.com/api/v1/channels/{id}/videos            -> { data: [video] }
 *       (latest 30 only, kept as a fallback)
 *   GET web.kick.com/api/v1/chat/{id}/history?start_time=   -> { data: { messages } }
 *       (the five-second bucket containing start_time; works for VODs and,
 *       a few seconds behind real time, for live streams)
 */
export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface KickHistoryMessage {
  id?: string;
  content?: string;
  created_at?: string;
  type?: string;
  sender?: {
    username?: string;
    identity?: {
      color?: string;
    };
  };
}

export interface KickVodMetadata {
  channelId: number;
  startTimestamp: number;
}

interface KickChannelInfoResponse {
  id?: number;
}

interface KickVideo {
  id?: string;
  start_time?: string;
  channel?: {
    id?: number;
  };
}

interface KickVideoResponse {
  data?: KickVideo;
}

interface KickVideosResponse {
  data?: Array<KickVideo>;
}

interface KickHistoryResponse {
  data?: {
    messages?: Array<KickHistoryMessage>;
  };
}

export let KICK_HISTORY_BUCKET_MS = 5000;

export class KickHttpError extends Error {
  public constructor(
    message: string,
    public status: number,
  ) {
    super(`${message}: ${status}`);
  }
}

/**
 * Issues JSON requests with a hard timeout that also covers a stalled
 * response body, and can abort everything in flight (e.g. on seek).
 */
export class KickApiRequester {
  private activeAbortControllers = new Set<AbortController>();

  public constructor(
    private fetcher: Fetcher,
    private window: Window,
  ) {}

  public async fetchJson<T>(
    input: string,
    errorPrefix: string,
    timeoutMs: number,
    onResponse?: (response: Response) => void,
  ): Promise<T> {
    let abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    let timeoutId: number | undefined;
    try {
      return await Promise.race([
        (async () => {
          let response = await this.fetcher(input, {
            signal: abortController.signal,
          });
          if (!response.ok) {
            throw new KickHttpError(errorPrefix, response.status);
          }
          onResponse?.(response);
          return (await response.json()) as T;
        })(),
        new Promise<T>((_resolve, reject) => {
          timeoutId = this.window.setTimeout(() => {
            abortController.abort();
            reject(new Error(`${errorPrefix}: timed out.`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        this.window.clearTimeout(timeoutId);
      }
      this.activeAbortControllers.delete(abortController);
    }
  }

  public abortAll(): void {
    for (let abortController of this.activeAbortControllers) {
      abortController.abort();
    }
    this.activeAbortControllers.clear();
  }
}

export async function fetchKickChannelId(
  requester: KickApiRequester,
  channelSlug: string,
  timeoutMs: number,
): Promise<number | undefined> {
  let channelInfo = await requester.fetchJson<KickChannelInfoResponse>(
    `/api/v2/channels/${encodeURIComponent(channelSlug)}/info`,
    "Kick channel metadata failed",
    timeoutMs,
  );
  return Number.isFinite(channelInfo?.id) ? channelInfo.id : undefined;
}

export async function fetchKickVodMetadata(
  requester: KickApiRequester,
  channelSlug: string,
  vodId: string,
  timeoutMs: number,
): Promise<KickVodMetadata | undefined> {
  let channelId = await fetchKickChannelId(requester, channelSlug, timeoutMs);
  if (channelId === undefined) {
    return undefined;
  }

  let video: KickVideo | undefined;
  try {
    video = (
      await requester.fetchJson<KickVideoResponse>(
        `https://web.kick.com/api/v1/channels/${channelId}/videos/${encodeURIComponent(vodId)}`,
        "Kick VOD metadata failed",
        timeoutMs,
      )
    ).data;
  } catch (error) {
    // Only an HTTP-level miss justifies trying the listing. A timeout or abort
    // would most likely repeat and delay the DOM fallback even further.
    if (!(error instanceof KickHttpError)) {
      throw error;
    }
  }
  if (video?.id !== vodId) {
    let videos = await requester.fetchJson<KickVideosResponse>(
      `https://web.kick.com/api/v1/channels/${channelId}/videos`,
      "Kick VOD listing failed",
      timeoutMs,
    );
    video = videos.data?.find((candidate) => candidate.id === vodId);
  }

  let startTimestamp = Date.parse(video?.start_time ?? "");
  let videoChannelId = video?.channel?.id ?? channelId;
  if (
    !video ||
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(videoChannelId)
  ) {
    return undefined;
  }
  return { channelId: videoChannelId, startTimestamp };
}

export async function fetchKickChatHistory(
  requester: KickApiRequester,
  channelId: number,
  bucketStart: number,
  timeoutMs: number,
): Promise<Array<KickHistoryMessage>> {
  let history = await requester.fetchJson<KickHistoryResponse>(
    `https://web.kick.com/api/v1/chat/${channelId}/history?start_time=${encodeURIComponent(
      new Date(bucketStart).toISOString(),
    )}`,
    "Kick chat history failed",
    timeoutMs,
  );
  return history?.data?.messages ?? [];
}

export function getKickHistoryBucketStart(absoluteTimestamp: number): number {
  return (
    Math.floor(absoluteTimestamp / KICK_HISTORY_BUCKET_MS) *
    KICK_HISTORY_BUCKET_MS
  );
}
