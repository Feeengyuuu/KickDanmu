import { ChatEntry } from "../../../../interface/chat_entry";
import { DisplaySettings } from "../../../../interface/player_settings";
import { KICK_SELECTORS } from "../kick/kick_selectors";

let FONT_SIZE_SCALE = 1 / 1;
// A thick outer outline (the stroke is painted under the fill) plus a soft
// glow keeps danmaku readable on bright scenes, where Douyu's 1px halo fades.
// The stroke is in em so it scales with the font size setting: 2px at Kick's
// default 30px.
let TEXT_OUTLINE_STYLES: { [key: string]: string } = {
  "-webkit-text-stroke": "0.067em black",
  "paint-order": "stroke",
  "text-shadow": "0 0 3px rgba(0, 0, 0, 0.6)",
};
let TEXT_OUTLINE_CSS = Object.entries(TEXT_OUTLINE_STYLES)
  .map(([name, value]) => `${name}: ${value};`)
  .join(" ");

function removeSelectedChildElements(children: NodeListOf<Element>): void {
  for (let i = children.length - 1; i >= 0; i--) {
    children.item(i).remove();
  }
}

function setStyleForSelectedChildElements(
  children: NodeListOf<Element>,
  styleAttributes: { [key: string]: string },
): void {
  for (let i = children.length - 1; i >= 0; i--) {
    let child = children.item(i) as HTMLElement;
    for (let styleName in styleAttributes) {
      let styleValue = styleAttributes[styleName];
      child.style.setProperty(styleName, styleValue);
    }
  }
}

function getFontStyles(displaySettings: DisplaySettings): {
  [key: string]: string;
} {
  return {
    "font-family": displaySettings.fontFamily,
    // Kick's chat spans carry font-weight utility classes, which beat the
    // weight inherited from the danmaku element.
    "font-weight": `${displaySettings.fontWeight}`,
    "font-size": `${displaySettings.fontSize * FONT_SIZE_SCALE}px`,
    "line-height": "normal",
  };
}

function getFontAndColorStyles(displaySettings: DisplaySettings): {
  [key: string]: string;
} {
  return {
    ...getFontStyles(displaySettings),
    color: "white",
    ...TEXT_OUTLINE_STYLES,
  };
}

function getHeightStyles(fontSize: number): { [key: string]: string } {
  return {
    height: `${fontSize * FONT_SIZE_SCALE}px`,
    width: `${fontSize * FONT_SIZE_SCALE}px`,
  };
}

export interface ChatContentBuilder {
  extractContent: (content: string) => string;
  build: (chatEntry: ChatEntry, displaySettings: DisplaySettings) => string;
}

export class StructuredContentBuilder implements ChatContentBuilder {
  public extractContent(content: string): string {
    return content;
  }

  public build(chatEntry: ChatEntry, displaySettings: DisplaySettings): string {
    let contentHTML = `<span style="color: white; ${TEXT_OUTLINE_CSS}">${chatEntry.content}</span>`;
    if (displaySettings.showUserName) {
      return `<span style="color: white; margin-right: 8px;">${chatEntry.userNickname}</span>${contentHTML}`;
    } else {
      return contentHTML;
    }
  }
}

export class YouTubeChatContentBuilder implements ChatContentBuilder {
  private static CUSTOM_TAG_OPEN = /<ytd?-.*? /g;
  private static CUSTOM_TAG_CLOSE = /<\/ytd?-.*?>/g;

  public extractContent(content: string): string {
    let template = document.createElement("template");
    template.innerHTML = content
      .replace(YouTubeChatContentBuilder.CUSTOM_TAG_OPEN, "<div ")
      .replace(YouTubeChatContentBuilder.CUSTOM_TAG_CLOSE, "</div>");
    this.removeUserName(template);
    return template.innerHTML;
  }

  private removeUserName(template: HTMLTemplateElement): void {
    removeSelectedChildElements(
      template.content.querySelectorAll("#author-photo"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll("#author-name"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll("#chat-badges"),
    );
  }

  public build(chatEntry: ChatEntry, displaySettings: DisplaySettings): string {
    let template = document.createElement("template");
    template.innerHTML = chatEntry.content
      .replace(YouTubeChatContentBuilder.CUSTOM_TAG_OPEN, "<div ")
      .replace(YouTubeChatContentBuilder.CUSTOM_TAG_CLOSE, "</div>");
    removeSelectedChildElements(
      template.content.querySelectorAll("#timestamp"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll("#deleted-state"),
    );
    removeSelectedChildElements(template.content.querySelectorAll("#menu"));
    removeSelectedChildElements(
      template.content.querySelectorAll("#inline-action-button-container"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll("#action-buttons"),
    );
    if (!displaySettings.showUserName) {
      this.removeUserName(template);
    }
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".yt-live-chat-text-message-renderer"),
      {
        padding: "0px",
        display: "inline-flex",
        "align-items": "center",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#message"),
      {
        flex: "0 0 auto",
        display: "inline", // Override .yt-live-chat-text-message-renderer
        ...getFontAndColorStyles(displaySettings),
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#author-name"),
      getFontStyles(displaySettings),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll("#author-name > #chip-badges"),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".emoji"),
      getHeightStyles(displaySettings.fontSize),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#author-photo > img"),
      getHeightStyles(displaySettings.fontSize),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#chip-badges"),
      getHeightStyles(displaySettings.fontSize),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#chat-badges"),
      {
        "margin-right": "8px",
        "margin-left": "8px",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("#chat-badges img"),
      getHeightStyles(displaySettings.fontSize),
    );
    // Super chat
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".yt-live-chat-paid-message-renderer"),
      {
        display: "inline-flex",
        "align-items": "center",
        "background-color": "transparent",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        ".yt-live-chat-paid-message-renderer #header-content-primary-column",
      ),
      {
        "align-items": "flex-start",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#card.yt-live-chat-paid-message-renderer",
      ),
      {
        "align-items": "flex-start",
      },
    );
    // Membership chat
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        ".yt-live-chat-membership-item-renderer",
      ),
      {
        display: "inline-flex",
        "align-items": "center",
        "background-color": "transparent",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#header-primary-text.yt-live-chat-membership-item-renderer",
      ),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#header-subtext.yt-live-chat-membership-item-renderer",
      ),
      {
        margin: "0px",
        "margin-left": "8px",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#header-subtext.yt-live-chat-membership-item-renderer",
      ),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#card.yt-live-chat-membership-item-renderer",
      ),
      {
        "align-items": "flex-start",
      },
    );
    // Gifted membership chat
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        ".ytd-sponsorships-live-chat-header-renderer",
      ),
      {
        display: "inline-flex",
        "align-items": "center",
        "background-color": "transparent",
      },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        "#primary-text.ytd-sponsorships-live-chat-header-renderer",
      ),
      getFontAndColorStyles(displaySettings),
    );
    return template.innerHTML;
  }
}

export class TwitchChatContentBuilder implements ChatContentBuilder {
  private static COLON_REPLACER = />: ?<\//;

  public extractContent(content: string): string {
    let template = document.createElement("template");
    template.innerHTML = content.replace(
      TwitchChatContentBuilder.COLON_REPLACER,
      `> </`,
    );
    this.removeUserName(template);
    return template.innerHTML;
  }

  private removeUserName(template: HTMLTemplateElement): void {
    removeSelectedChildElements(
      template.content.querySelectorAll(".chat-badge"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll(".chat-author__display-name"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll(".chat-author__intl-login"),
    );
  }

  public build(chatEntry: ChatEntry, displaySettings: DisplaySettings): string {
    let template = document.createElement("template");
    if (!displaySettings.showUserName) {
      template.innerHTML = chatEntry.content.replace(
        TwitchChatContentBuilder.COLON_REPLACER,
        `> </`,
      );
      this.removeUserName(template);
    } else {
      template.innerHTML = chatEntry.content;
    }

    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".chat-line__message"),
      { padding: "0px" },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".text-fragment"),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".mention-fragment"),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".link-fragment"),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".chat-badge"),
      getHeightStyles(displaySettings.fontSize),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".chat-line__message--emote"),
      getHeightStyles(displaySettings.fontSize),
    );
    // Remove timestamp
    removeSelectedChildElements(
      template.content.querySelectorAll(".vod-message__header"),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".vod-message"),
      { padding: "0px" },
    );
    return template.innerHTML;
  }
}

export class Twitch7tvChatContentBuilder implements ChatContentBuilder {
  private static COLON_REPLACER = />: ?<\//;

  public extractContent(content: string): string {
    let template = document.createElement("template");
    template.innerHTML = content.replace(
      Twitch7tvChatContentBuilder.COLON_REPLACER,
      `> </`,
    );
    this.removeUserName(template);
    return template.innerHTML;
  }

  private removeUserName(template: HTMLTemplateElement): void {
    removeSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-user-badge-list"),
    );
    removeSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-user-username"),
    );
  }

  public build(chatEntry: ChatEntry, displaySettings: DisplaySettings): string {
    let template = document.createElement("template");
    if (!displaySettings.showUserName) {
      template.innerHTML = chatEntry.content.replace(
        Twitch7tvChatContentBuilder.COLON_REPLACER,
        `> </`,
      );
      this.removeUserName(template);
    } else {
      template.innerHTML = chatEntry.content;
    }
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-message-background"),
      { padding: "0px" },
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-message-body"),
      getFontAndColorStyles(displaySettings),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-badge > img"),
      getHeightStyles(displaySettings.fontSize),
    );
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(".seventv-chat-emote"),
      getHeightStyles(displaySettings.fontSize),
    );
    return template.innerHTML;
  }
}

export class KickChatContentBuilder implements ChatContentBuilder {
  private static COLON_REPLACER = />:&nbsp;<\//;
  // Emotes are drawn larger than the text so they stay recognizable.
  private static EMOTE_SCALE = 1.4;

  public extractContent(content: string): string {
    let template = document.createElement("template");
    template.innerHTML = content.replace(
      KickChatContentBuilder.COLON_REPLACER,
      `> </`,
    );
    this.removeChrome(template);
    this.removeUserName(template);
    return template.innerHTML;
  }

  private removeUserName(template: HTMLTemplateElement): void {
    removeSelectedChildElements(
      template.content.querySelectorAll(
        KICK_SELECTORS.usernameWrapper.join(","),
      ),
    );
  }

  // Removes everything that is not part of the message itself: the timestamp
  // label, the "Replying to ..." header of replies, and SVG <title> tooltips of
  // badges (e.g. "Level 64"), which would otherwise be matched by block rules.
  private removeChrome(template: HTMLTemplateElement): void {
    removeSelectedChildElements(
      template.content.querySelectorAll(
        KICK_SELECTORS.messageTimestamp.join(","),
      ),
    );
    removeSelectedChildElements(template.content.querySelectorAll("svg title"));
    this.removeReplyHeaders(template);
  }

  // A reply row renders its quoted parent as a <button> placed before the
  // element that holds the author. Walk up from each author and drop such
  // preceding buttons, which does not depend on Kick's utility classes.
  private removeReplyHeaders(template: HTMLTemplateElement): void {
    let root = template.content;
    let replyHeaders = new Set<Element>();
    for (let author of Array.from(
      root.querySelectorAll(KICK_SELECTORS.usernameWrapper.join(",")),
    )) {
      for (
        let node: Element | null = author;
        node && node.parentNode !== root;
        node = node.parentElement
      ) {
        for (
          let sibling = node.previousElementSibling;
          sibling;
          sibling = sibling.previousElementSibling
        ) {
          if (sibling.tagName === "BUTTON") {
            replyHeaders.add(sibling);
          }
        }
      }
    }
    replyHeaders.forEach((replyHeader) => replyHeader.remove());
  }

  public build(chatEntry: ChatEntry, displaySettings: DisplaySettings): string {
    let template = document.createElement("template");
    if (!displaySettings.showUserName) {
      template.innerHTML = chatEntry.content.replace(
        KickChatContentBuilder.COLON_REPLACER,
        `> </`,
      );
      this.removeChrome(template);
      this.removeUserName(template);
    } else {
      template.innerHTML = chatEntry.content;
      this.removeChrome(template);
    }

    // Kick sizes rows with var(--chatroom-font-size) and badges with em units.
    // Pin every wrapper to the danmaku font size so badges scale with text.
    setStyleForSelectedChildElements(template.content.querySelectorAll("div"), {
      padding: "0px",
      "font-size": `${displaySettings.fontSize * FONT_SIZE_SCALE}px`,
    });
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("span"),
      getFontAndColorStyles(displaySettings),
    );
    // This is the username
    setStyleForSelectedChildElements(
      template.content.querySelectorAll("button"),
      getFontStyles(displaySettings),
    );
    // Kick's emote frame and the box inside it are sized from the chat font
    // size, and images are capped at max-width: 100%, so the frame would
    // squeeze a larger emote. Size the frame, its box and the image alike.
    let emoteFrames = KICK_SELECTORS.emoteFrame.join(",");
    setStyleForSelectedChildElements(
      template.content.querySelectorAll(
        `${emoteFrames}, :is(${emoteFrames}) div, img`,
      ),
      {
        ...getHeightStyles(
          displaySettings.fontSize * KickChatContentBuilder.EMOTE_SCALE,
        ),
        "max-width": "none",
      },
    );
    return template.innerHTML;
  }
}
