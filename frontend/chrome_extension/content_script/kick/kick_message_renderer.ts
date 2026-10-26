import { KickHistoryMessage } from "./kick_api";
import { formatKickMediaTimestamp } from "./kick_timestamp";

let EMOTE_PATTERN = /\[emote:(\d+):([^\]]+)\]/g;

/**
 * Renders an API chat message into the same shape as a Kick chat row, so that
 * KickChatContentBuilder handles API and DOM sourced chats identically. All
 * user text goes through text nodes, never through innerHTML.
 */
export function renderKickApiMessage(
  message: KickHistoryMessage,
  mediaTimestamp?: number,
): string {
  let container = document.createElement("div");
  if (mediaTimestamp !== undefined) {
    let timestamp = document.createElement("span");
    timestamp.className = "text-neutral pr-1 font-semibold";
    timestamp.textContent = formatKickMediaTimestamp(mediaTimestamp);
    container.append(timestamp);
  }

  let usernameText = message.sender?.username ?? "Anonymous";
  let username = document.createElement("button");
  username.className =
    "inline-flex min-w-0 flex-nowrap items-baseline rounded transition-colors";
  username.title = usernameText;
  username.textContent = usernameText;
  if (message.sender?.identity?.color) {
    username.style.color = message.sender.identity.color;
  }
  let usernameWrapper = document.createElement("span");
  usernameWrapper.append(username, document.createTextNode(": "));
  container.append(usernameWrapper);

  let content = document.createElement("span");
  let source = message.content ?? "";
  let lastIndex = 0;
  for (let match of source.matchAll(EMOTE_PATTERN)) {
    content.append(
      document.createTextNode(source.slice(lastIndex, match.index)),
    );
    let image = document.createElement("img");
    image.alt = match[2];
    image.src = `https://files.kick.com/emotes/${match[1]}/fullsize`;
    content.append(image);
    lastIndex = match.index + match[0].length;
  }
  content.append(document.createTextNode(source.slice(lastIndex)));
  container.append(content);
  return container.innerHTML;
}

export function hasRenderableContent(message: KickHistoryMessage): boolean {
  return !!message.id && !!message.content?.trim();
}
