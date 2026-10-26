export interface KickVodRoute {
  channelSlug: string;
  vodId: string;
}

export interface KickLiveRoute {
  channelSlug: string;
}

// First path segments that are Kick pages rather than channel slugs.
let RESERVED_TOP_LEVEL_PATHS = new Set([
  "",
  "browse",
  "categories",
  "category",
  "clips",
  "dashboard",
  "following",
  "search",
  "settings",
  "subscriptions",
  "video",
  "videos",
]);

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch (_error) {
    return undefined;
  }
}

export function parseKickVodRoute(pathname: string): KickVodRoute | undefined {
  let match = /^\/([^/]+)\/videos\/([^/]+)\/?$/.exec(pathname);
  if (!match) {
    return undefined;
  }
  let channelSlug = decodeSegment(match[1]);
  let vodId = decodeSegment(match[2]);
  if (!channelSlug || !vodId) {
    return undefined;
  }
  return { channelSlug, vodId };
}

export function parseKickLiveRoute(
  pathname: string,
): KickLiveRoute | undefined {
  let match = /^\/([^/]+)\/?$/.exec(pathname);
  if (!match) {
    return undefined;
  }
  let channelSlug = decodeSegment(match[1]);
  if (
    !channelSlug ||
    RESERVED_TOP_LEVEL_PATHS.has(channelSlug.toLowerCase())
  ) {
    return undefined;
  }
  return { channelSlug };
}

export function isKickVodPath(pathname: string): boolean {
  return !!parseKickVodRoute(pathname);
}
