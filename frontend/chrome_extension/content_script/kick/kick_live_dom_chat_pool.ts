import { ChatEntry } from "../../../../interface/chat_entry";
import { ChatPool } from "../chat_pool";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { KICK_SELECTORS, queryFirst } from "./kick_selectors";

interface ChatRow {
  element: Element;
  order: number;
  seen: boolean;
}

/**
 * Reads new messages from Kick's live chat list.
 *
 * Kick renders the chat with a virtual list keyed by message: a new message is
 * a new row node, while scrolling, resizing or fullscreen can remount old
 * messages as new nodes too. The list holds at most 300 messages and, once
 * full, shifts every row's data-index down by one per new message, so
 * data-index is only meaningful within a single snapshot (verified on
 * 2026-10-17; new rows keep arriving at indexes 294-299).
 *
 * A row is therefore "seen" if its node was seen or its text was seen (which
 * recognizes remounts), and only unseen rows ordered after the newest seen row
 * of the same snapshot are new. If no row is recognized at all (the list was
 * replaced), the snapshot becomes the new baseline instead of being replayed.
 * Rows without an author, such as the "New messages" divider, are skipped, and
 * so are messages a moderator deleted. Kick's automatic moderation can delete
 * a message before its row is first read, leaving only the deletion note.
 */
export class KickLiveDomChatPool implements ChatPool {
  private static MAX_SEEN_KEYS = 1000;

  private seenElements = new WeakSet<Element>();
  private seenKeys = new Set<string>();
  private elementKeys = new WeakMap<Element, string>();
  private elementHasAuthor = new WeakMap<Element, boolean>();

  public constructor(
    private chatContainer: Element,
    private blockTester: BlockPatternTester,
  ) {}

  public fill(): void {
    // Live chat cannot be filled from the DanMage backend.
  }

  public clear(): void {
    // start() establishes a fresh baseline whenever playback resumes.
  }

  public start(): void {
    this.seenElements = new WeakSet<Element>();
    this.seenKeys.clear();
    for (let row of this.readRows()) {
      this.markSeen(row.element);
    }
  }

  public read(): Array<ChatEntry> {
    let rows = this.readRows();
    let newestSeenOrder = -Infinity;
    for (let row of rows) {
      if (row.seen) {
        newestSeenOrder = Math.max(newestSeenOrder, row.order);
      }
    }
    if (newestSeenOrder === -Infinity) {
      // Empty, or every row is unknown: Kick replaced the whole window.
      rows.forEach((row) => this.markSeen(row.element));
      return [];
    }

    let newRows = new Array<ChatRow>();
    for (let row of rows) {
      if (row.seen) {
        // Remember remounted nodes so their text is not keyed again.
        this.seenElements.add(row.element);
        continue;
      }
      this.markSeen(row.element);
      // Older rows are history revealed by a remount or scroll.
      if (row.order > newestSeenOrder) {
        newRows.push(row);
      }
    }
    if (newRows.length === 0) {
      return [];
    }

    // Only trust the author selector while it still matches some row, so a
    // Kick markup change degrades to showing dividers instead of nothing.
    let authorSelectorMatches = rows.some((row) => this.hasAuthor(row.element));
    let chatEntries = new Array<ChatEntry>();
    for (let row of newRows) {
      if (authorSelectorMatches && !this.hasAuthor(row.element)) {
        continue;
      }
      if (queryFirst(row.element, KICK_SELECTORS.deletedMessage)) {
        continue;
      }
      let chatEntry: ChatEntry = { content: row.element.innerHTML };
      if (!this.blockTester.test(chatEntry)) {
        chatEntries.push(chatEntry);
      }
    }
    return chatEntries;
  }

  private readRows(): Array<ChatRow> {
    let rows = new Array<ChatRow>();
    let position = 0;
    for (
      let element = this.chatContainer.firstElementChild;
      element;
      element = element.nextElementSibling, position++
    ) {
      let index = element.getAttribute("data-index");
      rows.push({
        element,
        order: index && /^\d+$/.test(index) ? Number(index) : position,
        seen:
          this.seenElements.has(element) ||
          this.seenKeys.has(this.getKey(element)),
      });
    }
    return rows.sort((left, right) => left.order - right.order);
  }

  private markSeen(element: Element): void {
    this.seenElements.add(element);
    let key = this.getKey(element);
    if (this.seenKeys.has(key)) {
      return;
    }
    this.seenKeys.add(key);
    if (this.seenKeys.size > KickLiveDomChatPool.MAX_SEEN_KEYS) {
      this.seenKeys.delete(this.seenKeys.values().next().value);
    }
  }

  private hasAuthor(element: Element): boolean {
    let hasAuthor = this.elementHasAuthor.get(element);
    if (hasAuthor === undefined) {
      hasAuthor = !!queryFirst(element, KICK_SELECTORS.usernameWrapper);
      this.elementHasAuthor.set(element, hasAuthor);
    }
    return hasAuthor;
  }

  // The row text includes the minute label and the author, so it identifies
  // a message except for one user repeating the same text within a minute.
  private getKey(element: Element): string {
    let key = this.elementKeys.get(element);
    if (key === undefined) {
      key = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
      this.elementKeys.set(element, key);
    }
    return key;
  }
}
