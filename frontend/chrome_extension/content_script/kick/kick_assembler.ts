import { PlayerSettings } from "../../../../interface/player_settings";
import { ChatPool, OnPageChatPool, VirtualizedChatMode } from "../chat_pool";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { KickChatContentBuilder } from "../common/chat_content_builder";
import { DEBUG_LOG } from "../common/debug_log";
import { GlobalDocuments } from "../common/global_documents";
import { SERVICE_CLIENT } from "../common/service_client";
import { ControlPanel } from "../control_panel";
import { ControlPanelPeriodicAttacher } from "../control_panel_attacher";
import { DanmakuCanvasController } from "../danmaku_canvas/danmaku_canvas_controller";
import { KICK_DANMAKU_PROFILE } from "../danmaku_profile";
import { PlayerController } from "../player_controller";
import { Assembler } from "../refresher";
import { NoopChatWindowToggler } from "../chat_window_toggler";
import { NoopVideoIdExtractor } from "../video_id_extractor";
import { Fetcher } from "./kick_api";
import { KickLiveApiChatPool } from "./kick_live_api_chat_pool";
import { KickLiveDomChatPool } from "./kick_live_dom_chat_pool";
import {
  KickLiveRoute,
  KickVodRoute,
  parseKickLiveRoute,
  parseKickVodRoute,
} from "./kick_routes";
import { KICK_SELECTORS, queryFirst } from "./kick_selectors";
import { readKickVodTimestamp } from "./kick_timestamp";
import { KickVodApiChatPool } from "./kick_vod_chat_pool";

export let KICK_CHAT_ELEMENT_INDEX = 2;

export function createKickDanmakuCanvas(
  playerSurface: HTMLElement,
  heightPercent = KICK_DANMAKU_PROFILE.canvasHeightPercent ?? 100,
): HTMLDivElement {
  let canvas = document.createElement("div");
  canvas.className = "danmage-kick-canvas";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = `${heightPercent}%`;
  canvas.style.overflow = "hidden";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "10";
  // Keep the overlay before the video so it never occupies
  // video.nextElementSibling, which Kick uses for its controls.
  playerSurface.prepend(canvas);
  return canvas;
}

/**
 * Finds the element the settings button is inserted before: the first
 * data-testid control in the right-hand group, falling back to the first
 * button of the control bar.
 */
export function findKickControlAnchor(
  playerSurface: HTMLElement | undefined,
  video: HTMLVideoElement | undefined,
): HTMLElement | null {
  if (!playerSurface) {
    return null;
  }
  return (
    queryFirst<HTMLElement>(playerSurface, KICK_SELECTORS.controlAnchors) ??
    video?.nextElementSibling?.children?.[1]?.querySelector("button") ??
    null
  );
}

export interface KickChatSourceOptions {
  chatContainer: Element | null;
  vodRoute?: KickVodRoute;
  liveRoute?: KickLiveRoute;
  blockPatternTester: BlockPatternTester;
  fetcher: Fetcher;
}

/**
 * Picks the chat source for a Kick page:
 *   VOD:  history API timeline, falling back to the chat DOM.
 *   Live: the chat DOM, or the history API when the chat list is missing.
 */
export function createKickChatPool(options: KickChatSourceOptions): ChatPool {
  let { chatContainer, vodRoute, liveRoute, blockPatternTester, fetcher } =
    options;
  if (vodRoute) {
    return new KickVodApiChatPool(
      fetcher,
      vodRoute.channelSlug,
      vodRoute.vodId,
      new OnPageChatPool(
        chatContainer,
        blockPatternTester,
        VirtualizedChatMode.VodMediaTimestamps,
        readKickVodTimestamp,
      ),
      blockPatternTester,
    );
  }
  if (!chatContainer && liveRoute) {
    return new KickLiveApiChatPool(
      fetcher,
      liveRoute.channelSlug,
      blockPatternTester,
    );
  }
  return new KickLiveDomChatPool(chatContainer, blockPatternTester);
}

export function createKickPlayerController(
  video: HTMLVideoElement,
  canvas: HTMLElement,
  chatPool: ChatPool,
  blockPatternTester: BlockPatternTester,
  anchorElementSelectFn: () => HTMLElement,
  globalDocuments: GlobalDocuments,
  playerSettings: PlayerSettings,
  isVod: boolean,
): PlayerController {
  let controlPanel = ControlPanel.createKick(
    globalDocuments,
    blockPatternTester,
    playerSettings,
  );
  return new PlayerController(
    window,
    SERVICE_CLIENT,
    video,
    DanmakuCanvasController.create(
      canvas,
      playerSettings,
      blockPatternTester,
      new KickChatContentBuilder(),
      KICK_DANMAKU_PROFILE.transformDisplaySettings,
    ),
    NoopChatWindowToggler.create(),
    controlPanel,
    ControlPanelPeriodicAttacher.create(controlPanel, anchorElementSelectFn),
    chatPool,
    NoopVideoIdExtractor.create(),
    undefined,
    KICK_DANMAKU_PROFILE.followPlaybackRate,
    KICK_DANMAKU_PROFILE.chatPacing,
    isVod,
  );
}

export class KickAssembler implements Assembler {
  private static CHAT_LIST_GRACE_MS = 10000;

  private chatListMissingSince: number | undefined;
  private playerSurface: HTMLElement;
  private canvas: HTMLElement;
  private video: HTMLVideoElement;
  private chatContainer: Element | null;
  private playController: PlayerController;
  private vodRoute: KickVodRoute | undefined;
  private liveRoute: KickLiveRoute | undefined;
  private routeKey: string | undefined;
  private assembledRouteKey: string | undefined;

  public constructor(
    private playerSettings: PlayerSettings,
    private location: Location = window.location,
    private fetcher: Fetcher = window.fetch.bind(window),
  ) {}

  public queryElements(): Element[] {
    let pathname = this.location.pathname;
    this.vodRoute = parseKickVodRoute(pathname);
    this.liveRoute = this.vodRoute ? undefined : parseKickLiveRoute(pathname);
    this.routeKey = this.vodRoute
      ? `vod:${this.vodRoute.channelSlug}/${this.vodRoute.vodId}`
      : this.liveRoute
        ? `live:${this.liveRoute.channelSlug}`
        : undefined;
    this.video = queryFirst<HTMLVideoElement>(document, KICK_SELECTORS.video);
    // Kick requests fullscreen on the video's direct parent. Keeping the
    // danmaku surface inside that same element makes it visible both in-page
    // and in fullscreen.
    this.playerSurface = this.video?.parentElement;
    this.chatContainer = queryFirst(document, KICK_SELECTORS.chatList);
    this.reportMissingChatList();
    return [this.playerSurface, this.video, this.chatContainer];
  }

  // The chat list normally mounts shortly after the player. Only a list that
  // stays missing suggests a Kick markup change (or a layout without chat).
  private reportMissingChatList(): void {
    if (!this.video || this.chatContainer || !this.routeKey) {
      this.chatListMissingSince = undefined;
      return;
    }
    let now = Date.now();
    this.chatListMissingSince ??= now;
    if (now - this.chatListMissingSince >= KickAssembler.CHAT_LIST_GRACE_MS) {
      DEBUG_LOG.warnOnce(
        "Kick",
        "chatList",
        `Chat list (${KICK_SELECTORS.chatList.join(" | ")}) not found; using the chat history API instead.`,
      );
    }
  }

  // Without a chat list, danmaku can only come from the API, which needs a
  // channel or VOD route. This rejects e.g. the front page's featured player.
  public canAssemble(): boolean {
    return !!this.chatContainer || !!this.routeKey;
  }

  public assemble(): void {
    let blockPatternTester = BlockPatternTester.createHtml(
      new KickChatContentBuilder(),
      this.playerSettings.blockSettings,
    );
    this.canvas = createKickDanmakuCanvas(this.playerSurface);
    let chatPool = createKickChatPool({
      chatContainer: this.chatContainer,
      vodRoute: this.vodRoute,
      liveRoute: this.liveRoute,
      blockPatternTester,
      fetcher: this.fetcher,
    });
    DEBUG_LOG.info("Kick", "Assembled.", {
      route: this.routeKey,
      chatSource: chatPool.constructor.name,
    });
    this.playController = createKickPlayerController(
      this.video,
      this.canvas,
      chatPool,
      blockPatternTester,
      () => findKickControlAnchor(this.playerSurface, this.video),
      GlobalDocuments.create([document]),
      this.playerSettings,
      !!this.vodRoute,
    );
    this.assembledRouteKey = this.routeKey;
  }

  public isHealthy(): boolean {
    return (
      !!this.canvas &&
      this.canvas.isConnected &&
      this.canvas.parentElement === this.playerSurface &&
      this.assembledRouteKey === this.routeKey
    );
  }

  public remove(): void {
    if (this.playController) {
      this.playController.remove();
      this.playController = undefined;
    }
    this.canvas?.remove();
    this.canvas = undefined;
  }
}
