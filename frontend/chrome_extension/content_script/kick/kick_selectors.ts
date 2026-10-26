/**
 * Every Kick DOM hook used by the extension, verified against kick.com on
 * 2026-10-17. Each entry is an ordered fallback chain: the first selector is
 * the current markup, later ones are older or more generic variants. When Kick
 * ships a redesign, this file should be the only place that needs updating.
 */
export let KICK_SELECTORS = {
  video: [
    "#injected-embedded-channel-player-video video",
    "video#video-player",
    "video",
  ],
  chatList: ["#chatroom-messages > div"],
  // Media-time label on VOD rows ("MM:SS" or "HH:MM:SS") and wall-clock label
  // on live rows ("HH:MM").
  messageTimestamp: [".text-neutral.pr-1.font-semibold"],
  // Wrapper around badges and the username button. Older Kick markup used the
  // same classes directly on the username button.
  usernameWrapper: [
    ".inline-flex.min-w-0.flex-nowrap.items-baseline.rounded.transition-colors",
  ],
  // Body of a message deleted by a moderator (verified 2026-10-24). Kick swaps
  // the text for this muted span, holding "Deleted by a moderator" for viewers
  // and the struck-through text plus " (Deleted)" for moderators.
  deletedMessage: [
    "span.text-neutral.leading-\\[1\\.55\\]",
    "span.line-through",
  ],
  // Frame around an emote image (verified 2026-10-24). Kick sizes the frame
  // and the box inside it from var(--chatroom-font-size).
  emoteFrame: ["[data-emote-id]"],
  // Stable data-testid hooks in the player's right-hand control group. The
  // settings button is inserted before the first one found.
  controlAnchors: [
    '[data-testid="video-player-pip"]',
    '[data-testid="video-player-clip"]',
    '[data-testid="video-player-theatre-mode"]',
    '[data-testid="video-player-fullscreen"]',
  ],
};

export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: Array<string>,
): T | null {
  for (let selector of selectors) {
    let element = root.querySelector<T>(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

export function queryAllFirst(
  root: ParentNode,
  selectors: Array<string>,
): Array<Element> {
  for (let selector of selectors) {
    let elements = root.querySelectorAll(selector);
    if (elements.length > 0) {
      return Array.from(elements);
    }
  }
  return [];
}
