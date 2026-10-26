import { PlayerSettings } from "../../../interface/player_settings";
import { GlobalDocuments } from "./common/global_documents";
import { KICK_CHAT_ELEMENT_INDEX, KickAssembler } from "./kick/kick_assembler";
import { PlayerController } from "./player_controller";

export interface Assembler {
  queryElements: () => Element[];
  assemble: () => void;
  remove: () => void;
  isHealthy?: () => boolean;
  // Checked after queryElements(). False means the page cannot host danmaku
  // even though all required elements are present.
  canAssemble?: () => boolean;
}

export interface RefresherOptions {
  mutationTarget?: Node;
  fallbackIntervalMs?: number;
  // Indexes into queryElements() that may be null. A change between null and
  // an element still counts as a structural change.
  optionalElementIndexes?: Array<number>;
  ignoredMutationElementIndexes?: Array<number>;
  ignoredMutationClassNames?: Array<string>;
  routeKey?: () => string;
  routeCheckIntervalMs?: number;
}

export class YouTubeAssembler implements Assembler {
  public assemble: () => void;
  private canvas: HTMLElement;
  private video: HTMLVideoElement;
  private chatContainer: Element;
  private anchorButtonElement: Element;
  private iframeDocument: Document;
  private chatWindowContainer1: HTMLElement;
  private chatWindowContainer2: HTMLElement;
  private playController: PlayerController;

  public constructor(private playerSettings: PlayerSettings) {}

  public queryElements(): Element[] {
    this.canvas = document.getElementById("movie_player");
    this.video = document.getElementsByTagName("video")[0];
    this.anchorButtonElement = document.querySelector(".ytp-settings-button");
    let chatIframe = document.getElementById("chatframe") as HTMLIFrameElement;
    if (!chatIframe) {
      this.assemble = this.assembleStructured;
      return [this.canvas, this.video, this.anchorButtonElement];
    } else {
      this.iframeDocument = chatIframe.contentDocument;
      this.chatContainer = this.iframeDocument.querySelector("#chat #items");
      this.chatWindowContainer1 = document.getElementById("chat-container");
      this.chatWindowContainer2 = document.getElementById(
        "panels-full-bleed-container",
      );
      this.assemble = this.assembleChat;
      return [
        this.canvas,
        this.video,
        this.chatContainer,
        this.anchorButtonElement,
        this.chatWindowContainer1,
        this.chatWindowContainer2,
      ];
    }
  }

  public assembleStructured(): void {
    this.playController = PlayerController.createYouTubeStructured(
      this.video,
      this.canvas,
      this.anchorButtonElement,
      GlobalDocuments.create([document]),
      this.playerSettings,
    );
  }

  public assembleChat(): void {
    this.playController = PlayerController.createYouTubeChat(
      this.video,
      this.canvas,
      this.anchorButtonElement,
      this.chatContainer,
      [this.chatWindowContainer1, this.chatWindowContainer2],
      GlobalDocuments.create([document, this.iframeDocument]),
      this.playerSettings,
    );
  }

  public remove(): void {
    if (this.playController) {
      this.playController.remove();
      this.playController = undefined;
    }
  }
}

export class TwitchAssembler implements Assembler {
  public assemble: () => void;
  private canvas: HTMLElement;
  private video: HTMLVideoElement;
  private chatContainer: Element;
  private anchorButtonElement: Element;
  private playController: PlayerController;

  public constructor(private playerSettings: PlayerSettings) {}

  public queryElements(): Element[] {
    this.canvas = document.querySelector(".video-player__container");
    this.video = document.getElementsByTagName("video")[0];
    this.anchorButtonElement = document.querySelector(
      `[data-a-target="player-settings-button"]`,
    )?.parentElement?.parentElement?.parentElement?.parentElement;
    this.chatContainer = document.querySelector(
      ".chat-scrollable-area__message-container",
    );
    if (!this.chatContainer) {
      this.chatContainer = document.querySelector(`main.seventv-chat-list`);
      if (!this.chatContainer) {
        // Play back videos
        this.chatContainer = document.querySelector(
          ".video-chat__message-list-wrapper ul",
        );
        this.assemble = this.assembleVideo;
      } else {
        // Live 7tv chat
        this.assemble = this.assemble7tv;
      }
    } else {
      // Live Twitch chat
      this.assemble = this.assembleVideo;
    }
    return [
      this.canvas,
      this.video,
      this.chatContainer,
      this.anchorButtonElement,
    ];
  }

  public assembleVideo(): void {
    this.playController = PlayerController.createTwitch(
      this.video,
      this.canvas,
      this.anchorButtonElement,
      this.chatContainer,
      GlobalDocuments.create([document]),
      this.playerSettings,
    );
  }

  public assemble7tv(): void {
    this.playController = PlayerController.createTwitch7tvLive(
      this.video,
      this.canvas,
      this.anchorButtonElement,
      this.chatContainer,
      GlobalDocuments.create([document]),
      this.playerSettings,
    );
  }

  public remove(): void {
    if (this.playController) {
      this.playController.remove();
      this.playController = undefined;
    }
  }
}

export class CrunchyrollAssembler implements Assembler {
  private canvas: HTMLElement;
  private video: HTMLVideoElement;
  private playController: PlayerController;

  public constructor(private playerSettings: PlayerSettings) {}

  public queryElements(): Element[] {
    this.canvas = document.querySelector("#velocity-player-package");
    this.video = document.querySelector("#player0") as HTMLVideoElement;
    return [this.canvas, this.video];
  }

  public assemble(): void {
    this.playController = PlayerController.createCrunchyroll(
      this.video,
      this.canvas,
      () => document.querySelector("#settingsControl"),
      GlobalDocuments.create([document]),
      this.playerSettings,
    );
  }

  public remove(): void {
    if (this.playController) {
      this.playController.remove();
      this.playController = undefined;
    }
  }
}

enum ElementsComparisonResult {
  UNCHANGED,
  LACK_REQUIRED_ELEMENTS,
  CHANGED,
}

export class Refresher {
  public static createYouTube(playerSettings: PlayerSettings): Refresher {
    return new Refresher(new YouTubeAssembler(playerSettings), window);
  }

  public static createTwitch(playerSettings: PlayerSettings): Refresher {
    return new Refresher(new TwitchAssembler(playerSettings), window);
  }

  public static createKick(playerSettings: PlayerSettings): Refresher {
    return new Refresher(new KickAssembler(playerSettings), window, {
      mutationTarget: document.documentElement,
      fallbackIntervalMs: Refresher.MUTATION_FALLBACK_INTERVAL,
      // Without a chat list, live and VOD chats come from Kick's API.
      optionalElementIndexes: [KICK_CHAT_ELEMENT_INDEX],
      // Chat messages are consumed by PlayerController on animation frames.
      // They do not require the player structure to be queried again.
      ignoredMutationElementIndexes: [KICK_CHAT_ELEMENT_INDEX],
      // Adding/removing rendered danmaku is expected and does not change any
      // of the required Kick player elements.
      ignoredMutationClassNames: ["danmaku-element"],
      // pushState can swap VODs without replacing the player DOM or emitting a
      // mutation outside the ignored virtual chat list.
      routeKey: () => window.location.pathname,
      routeCheckIntervalMs: Refresher.ROUTE_CHECK_INTERVAL,
    });
  }

  public static createCrunchyroll(playerSettings: PlayerSettings): Refresher {
    return new Refresher(new CrunchyrollAssembler(playerSettings), window);
  }

  private static REFRESH_INTERVAL = 500; // ms
  private static MUTATION_FALLBACK_INTERVAL = 5000; // ms
  private static ROUTE_CHECK_INTERVAL = 250; // ms

  private lastElements: Element[] = [];
  private periodicRefreshTimeoutId: number;
  private mutationRefreshFrameId: number;
  private mutationRefreshScheduled = false;
  private mutationObserver: MutationObserver;
  private routeCheckTimeoutId: number;
  private observedRouteKey: string;
  private removed = false;

  public constructor(
    private assembler: Assembler,
    private window: Window,
    private options: RefresherOptions = {},
  ) {
    this.refresh();
    if (this.options.mutationTarget) {
      this.mutationObserver = new MutationObserver(this.handleMutations);
      this.mutationObserver.observe(this.options.mutationTarget, {
        childList: true,
        subtree: true,
      });
    }
    this.schedulePeriodicRefresh();
    if (this.options.routeKey) {
      this.observedRouteKey = this.options.routeKey();
      this.scheduleRouteCheck();
    }
  }

  private refresh = (): void => {
    let newElements = this.assembler.queryElements();
    let comparisonResult = this.compareElements(newElements);
    if (
      comparisonResult !== ElementsComparisonResult.LACK_REQUIRED_ELEMENTS &&
      this.assembler.canAssemble &&
      !this.assembler.canAssemble()
    ) {
      comparisonResult = ElementsComparisonResult.LACK_REQUIRED_ELEMENTS;
    }
    if (
      comparisonResult === ElementsComparisonResult.UNCHANGED &&
      this.assembler.isHealthy &&
      !this.assembler.isHealthy()
    ) {
      comparisonResult = ElementsComparisonResult.CHANGED;
    }
    switch (comparisonResult) {
      case ElementsComparisonResult.LACK_REQUIRED_ELEMENTS:
        this.assembler.remove();
        this.lastElements = [];
        break;
      case ElementsComparisonResult.CHANGED:
        this.assembler.remove();
        this.lastElements = newElements;
        this.assembler.assemble();
        break;
      default:
        break;
    }
  };

  private schedulePeriodicRefresh(): void {
    let interval = this.options.mutationTarget
      ? (this.options.fallbackIntervalMs ??
        Refresher.MUTATION_FALLBACK_INTERVAL)
      : Refresher.REFRESH_INTERVAL;
    this.periodicRefreshTimeoutId = this.window.setTimeout(
      this.refreshPeriodically,
      interval,
    );
  }

  private refreshPeriodically = (): void => {
    if (this.removed) {
      return;
    }
    this.refresh();
    this.schedulePeriodicRefresh();
  };

  private scheduleRouteCheck(): void {
    this.routeCheckTimeoutId = this.window.setTimeout(
      this.checkRoute,
      this.options.routeCheckIntervalMs ?? Refresher.ROUTE_CHECK_INTERVAL,
    );
  }

  private checkRoute = (): void => {
    if (this.removed || !this.options.routeKey) {
      return;
    }
    let routeKey = this.options.routeKey();
    if (routeKey !== this.observedRouteKey) {
      this.observedRouteKey = routeKey;
      this.refresh();
    }
    this.scheduleRouteCheck();
  };

  private handleMutations = (mutations: Array<MutationRecord>): void => {
    if (
      this.removed ||
      this.mutationRefreshScheduled ||
      !mutations.some((mutation) => this.shouldRefreshForMutation(mutation))
    ) {
      return;
    }
    this.mutationRefreshScheduled = true;
    this.mutationRefreshFrameId = this.window.requestAnimationFrame(() => {
      this.mutationRefreshScheduled = false;
      this.refresh();
    });
  };

  private shouldRefreshForMutation(mutation: MutationRecord): boolean {
    let changedNodes = [
      ...Array.from(mutation.addedNodes),
      ...Array.from(mutation.removedNodes),
    ];
    if (
      changedNodes.length > 0 &&
      changedNodes.every(
        (node) =>
          node instanceof Element &&
          this.options.ignoredMutationClassNames?.some((className) =>
            node.classList.contains(className),
          ),
      )
    ) {
      return false;
    }
    for (let index of this.options.ignoredMutationElementIndexes ?? []) {
      let ignoredElement = this.lastElements[index];
      if (
        ignoredElement &&
        (ignoredElement === mutation.target ||
          ignoredElement.contains(mutation.target))
      ) {
        return false;
      }
    }
    return true;
  }

  private compareElements(newElements: Element[]): ElementsComparisonResult {
    for (let i = 0; i < newElements.length; i++) {
      if (
        !newElements[i] &&
        !this.options.optionalElementIndexes?.includes(i)
      ) {
        return ElementsComparisonResult.LACK_REQUIRED_ELEMENTS;
      }
    }

    if (this.lastElements.length !== newElements.length) {
      return ElementsComparisonResult.CHANGED;
    } else {
      for (let i = 0; i < this.lastElements.length; i++) {
        let element = this.lastElements[i];
        let newElement = newElements[i];
        if (element !== newElement) {
          return ElementsComparisonResult.CHANGED;
        }
      }
    }

    return ElementsComparisonResult.UNCHANGED;
  }

  public remove(): void {
    this.removed = true;
    this.mutationObserver?.disconnect();
    this.window.clearTimeout(this.periodicRefreshTimeoutId);
    this.window.clearTimeout(this.routeCheckTimeoutId);
    if (this.mutationRefreshScheduled) {
      this.window.cancelAnimationFrame(this.mutationRefreshFrameId);
      this.mutationRefreshScheduled = false;
    }
    this.assembler.remove();
    this.lastElements = [];
  }
}
