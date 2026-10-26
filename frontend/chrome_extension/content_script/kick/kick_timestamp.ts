import { KICK_SELECTORS, queryFirst } from "./kick_selectors";

/** Parses Kick's VOD row label ("MM:SS" or "HH:MM:SS") into media ms. */
export function parseKickMediaTimestamp(text: string): number | undefined {
  let parts = text.trim().split(":");
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !/^\d+$/.test(part))
  ) {
    return undefined;
  }
  let values = parts.map(Number);
  let seconds = values.pop();
  let minutes = values.pop();
  let hours = values.pop() ?? 0;
  if (seconds >= 60 || minutes >= 60) {
    return undefined;
  }
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function formatKickMediaTimestamp(mediaTimestamp: number): string {
  let totalSeconds = Math.max(0, Math.floor(mediaTimestamp / 1000));
  let seconds = totalSeconds % 60;
  let totalMinutes = Math.floor(totalSeconds / 60);
  let minutes = totalMinutes % 60;
  let hours = Math.floor(totalMinutes / 60);
  let pad = (value: number): string => value.toString().padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** Reads the media timestamp of a rendered Kick VOD chat row. */
export function readKickVodTimestamp(element: Element): number | undefined {
  let label = queryFirst(element, KICK_SELECTORS.messageTimestamp)
    ?.textContent?.trim();
  return label ? parseKickMediaTimestamp(label) : undefined;
}
