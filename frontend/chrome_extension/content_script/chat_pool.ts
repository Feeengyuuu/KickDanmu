import { ChatEntry } from "../../../interface/chat_entry";
import { BlockPatternTester } from "./common/block_pattern_tester";

export interface ChatPool {
  fill: (chatEntries: Array<ChatEntry>) => void;
  clear: () => void;
  start: (timestamp: number) => void;
  read: (timestamp: number) => Array<ChatEntry>;
}

export enum VirtualizedChatMode {
  None,
  VodMediaTimestamps,
}

/** Reads a row's media timestamp in ms, used by VodMediaTimestamps mode. */
export type SourceTimestampReader = (element: Element) => number | undefined;

export class StructuredChatPool implements ChatPool {
  private static ANONYMOUS = "Anonymous";

  private lastTimestamp: number = 0; // ms
  private chatEntries = new Array<ChatEntry>();
  private lastIndex = 0;

  public constructor(private blockTester: BlockPatternTester) {}

  public fill(newChatEntries: Array<ChatEntry>): void {
    for (let newChatEntry of newChatEntries) {
      if (!newChatEntry.userNickname) {
        newChatEntry.userNickname = StructuredChatPool.ANONYMOUS;
      }
    }

    let rightChatEntries = newChatEntries.sort((l, r) => {
      return l.timestamp - r.timestamp;
    });
    let leftChatEntries = this.chatEntries;
    this.chatEntries = [];
    let leftPointer = 0;
    let rightPointer = 0;
    while (
      leftPointer < leftChatEntries.length &&
      rightPointer < rightChatEntries.length
    ) {
      let left = leftChatEntries[leftPointer];
      let right = rightChatEntries[rightPointer];
      if (left.timestamp <= right.timestamp) {
        this.chatEntries.push(left);
        leftPointer++;
      } else {
        this.chatEntries.push(right);
        rightPointer++;
      }
    }
    for (; leftPointer < leftChatEntries.length; leftPointer++) {
      this.chatEntries.push(leftChatEntries[leftPointer]);
    }
    for (; rightPointer < rightChatEntries.length; rightPointer++) {
      this.chatEntries.push(rightChatEntries[rightPointer]);
    }

    this.binarySearchReadPointer();
  }

  private binarySearchReadPointer(): void {
    let left = 0;
    let right = this.chatEntries.length;
    while (left < right) {
      let mid = Math.floor((left + right) / 2);
      let chatEntry = this.chatEntries[mid];
      if (chatEntry.timestamp < this.lastTimestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    this.lastIndex = left;
  }

  public clear(): void {
    this.chatEntries = [];
  }

  public start(destinationTimestamp: number /* ms */): void {
    this.lastTimestamp = destinationTimestamp;
    this.binarySearchReadPointer();
  }

  public read(currentTimestamp: number /* ms */): Array<ChatEntry> {
    let returnChatEntries = new Array<ChatEntry>();
    for (
      ;
      this.lastIndex < this.chatEntries.length &&
      this.chatEntries[this.lastIndex].timestamp < currentTimestamp;
      this.lastIndex++
    ) {
      let chatEntry = this.chatEntries[this.lastIndex];
      if (this.blockTester.test(chatEntry)) {
        continue;
      }
      returnChatEntries.push(chatEntry);
    }
    this.lastTimestamp = currentTimestamp;
    return returnChatEntries;
  }
}

export class OnPageChatPool implements ChatPool {
  private static TW_HIDE_CLASS = "tw-hide";
  private static MAX_SEEN_VOD_CHAT_KEYS = 2000;

  private logElementPointer: Element | null;
  private vodBaselineTimestamp = 0;
  private vodRebaselinePending = false;
  private vodEmptyInitialScanCompleted = false;
  private pendingVodChats = new Array<ChatEntry>();
  private seenVodChatKeys = new Set<string>();

  public constructor(
    // May be null when a site adapter has an API source and only keeps this
    // pool as a fallback for a chat list that is not mounted.
    private chatContainer: Element | null,
    private blockTester: BlockPatternTester,
    private virtualizedChatMode = VirtualizedChatMode.None,
    private readSourceTimestamp: SourceTimestampReader = () => undefined,
  ) {}

  public fill(): void {
    // Do nothing.
  }

  public clear(): void {
    if (!this.chatContainer) {
      return;
    }
    if (this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps) {
      // Snapshot the entire pre-seek window, including rows appended since the
      // last animation frame. If seeked fires before Kick replaces its DOM,
      // none of that old window may be scanned as future chat.
      this.logElementPointer = this.chatContainer.lastElementChild;
      this.vodRebaselinePending = true;
      this.vodEmptyInitialScanCompleted = false;
      this.pendingVodChats = [];
      this.seenVodChatKeys.clear();
    }
  }

  public start(destinationTimestamp = 0): void {
    if (!this.chatContainer) {
      return;
    }
    if (this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps) {
      // Scan the visible VOD window on the next read. Timestamps at or before
      // the playhead are history; future rows are retained until media time
      // reaches them. This is independent of seeked/remount event ordering.
      if (!this.vodRebaselinePending) {
        this.logElementPointer = null;
      }
      // Kick's VOD labels have whole-second precision. Round the playhead down
      // so a message genuinely added later in the same second is not lost.
      this.vodBaselineTimestamp =
        Math.floor(destinationTimestamp / 1000) * 1000;
      this.vodEmptyInitialScanCompleted = false;
      this.pendingVodChats = [];
      this.seenVodChatKeys.clear();
      return;
    }
    this.logElementPointer = this.chatContainer.lastElementChild;
  }

  public read(currentTimestamp = 0): Array<ChatEntry> {
    if (!this.chatContainer) {
      return [];
    }
    let nextLogElementPointer: Element | null;
    let isVodWindowScan = false;
    let isVodRebaselineScan = false;
    let processedVodElement = false;
    let vodPointerWasNull = !this.logElementPointer;
    if (this.chatContainer.contains(this.logElementPointer)) {
      nextLogElementPointer = this.logElementPointer.nextElementSibling;
      isVodRebaselineScan =
        this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps &&
        this.vodRebaselinePending &&
        !!nextLogElementPointer;
    } else if (
      this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps
    ) {
      // Kick can replace the VOD virtual-list children before or after seeked.
      // Scan the whole visible window and use its media timestamps below.
      nextLogElementPointer = this.chatContainer.firstElementChild;
      isVodWindowScan = true;
      isVodRebaselineScan = this.vodRebaselinePending;
    } else {
      nextLogElementPointer = this.chatContainer.firstElementChild;
    }

    let returnChatEntries = new Array<ChatEntry>();
    for (
      ;
      nextLogElementPointer;
      this.logElementPointer = nextLogElementPointer,
        nextLogElementPointer = nextLogElementPointer.nextElementSibling
    ) {
      if (this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps) {
        processedVodElement = true;
      }
      let htmlContent = nextLogElementPointer.innerHTML;
      // Silly twitch hidden emoticons. Stop and try from here next time.
      if (htmlContent.indexOf(OnPageChatPool.TW_HIDE_CLASS) !== -1) {
        break;
      }

      let chatEntry: ChatEntry = {
        content: htmlContent,
      };
      if (this.blockTester.test(chatEntry)) {
        continue;
      }

      if (this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps) {
        let sourceTimestamp = this.readSourceTimestamp(nextLogElementPointer);
        if (sourceTimestamp !== undefined) {
          let sourceKey = this.createVodChatKey(
            nextLogElementPointer,
            sourceTimestamp,
            htmlContent,
          );
          if (this.seenVodChatKeys.has(sourceKey)) {
            continue;
          }
          this.seenVodChatKeys.add(sourceKey);
          if (
            this.seenVodChatKeys.size > OnPageChatPool.MAX_SEEN_VOD_CHAT_KEYS
          ) {
            let oldestKey = this.seenVodChatKeys.values().next().value;
            if (oldestKey !== undefined) {
              this.seenVodChatKeys.delete(oldestKey);
            }
          }
          if (
            sourceTimestamp < this.vodBaselineTimestamp &&
            (isVodWindowScan || this.vodRebaselinePending)
          ) {
            continue;
          }
          chatEntry.timestamp = sourceTimestamp;
          this.pendingVodChats.push(chatEntry);
          continue;
        }
        // If the site changes its timestamp markup, a full-window scan cannot
        // distinguish history from new rows. Baseline it safely; subsequent
        // directly appended rows retain the legacy immediate behavior.
        if (
          (isVodWindowScan || this.vodRebaselinePending) &&
          !(
            vodPointerWasNull &&
            this.vodEmptyInitialScanCompleted &&
            !this.vodRebaselinePending
          )
        ) {
          continue;
        }
      }

      returnChatEntries.push(chatEntry);
    }
    if (this.virtualizedChatMode === VirtualizedChatMode.VodMediaTimestamps) {
      if (isVodRebaselineScan && processedVodElement) {
        this.vodRebaselinePending = false;
      }
      if (isVodWindowScan) {
        this.vodEmptyInitialScanCompleted =
          !processedVodElement && !this.vodRebaselinePending;
      }
      this.pendingVodChats.sort(
        (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
      );
      let readyCount = 0;
      while (
        readyCount < this.pendingVodChats.length &&
        (this.pendingVodChats[readyCount].timestamp ?? Infinity) <=
          currentTimestamp
      ) {
        readyCount++;
      }
      returnChatEntries.push(...this.pendingVodChats.splice(0, readyCount));
    }
    return returnChatEntries;
  }

  private createVodChatKey(
    element: Element,
    sourceTimestamp: number,
    htmlContent: string,
  ): string {
    // VOD rows do not expose a message ID in the DOM. Media timestamp plus
    // normalized visible text is the most stable available identity across
    // harmless React markup changes and virtual-list reindexing.
    let visibleText = element.textContent?.replace(/\s+/g, " ").trim();
    return `${sourceTimestamp}\u0000${visibleText || htmlContent}`;
  }
}
