import { ChatEntry } from "../../../interface/chat_entry";
import { PlayerSettings } from "../../../interface/player_settings";
import { ChatPool, OnPageChatPool } from "./chat_pool";
import {
  ChatWindowToggler,
  NoopChatWindowToggler,
  YouTubeChatWindowToggler,
} from "./chat_window_toggler";
import { BlockPatternTester } from "./common/block_pattern_tester";
import {
  Twitch7tvChatContentBuilder,
  TwitchChatContentBuilder,
  YouTubeChatContentBuilder,
} from "./common/chat_content_builder";
import { GlobalDocuments } from "./common/global_documents";
import { ControlPanel } from "./control_panel";
import {
  ControlPanelAttacher,
  ControlPanelOneTimeAttacher,
} from "./control_panel_attacher";
import { DanmakuCanvasController } from "./danmaku_canvas/danmaku_canvas_controller";
import { ChatPacingSettings } from "./danmaku_profile";

export class PlayerController {
  public static createYouTubeChat(
    video: HTMLVideoElement,
    canvas: HTMLElement,
    anchorButtonElement: Element,
    chatContainer: Element,
    chatWindowContainers: Array<HTMLElement>,
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): PlayerController {
    let blockPatternTester = BlockPatternTester.createHtml(
      new YouTubeChatContentBuilder(),
      playerSettings.blockSettings,
    );
    let controlPanel = ControlPanel.createYouTubeChat(
      globalDocuments,
      playerSettings,
    );
    return new PlayerController(
      window,
      video,
      DanmakuCanvasController.create(
        canvas,
        playerSettings,
        blockPatternTester,
        new YouTubeChatContentBuilder(),
      ),
      YouTubeChatWindowToggler.create(
        chatWindowContainers,
        playerSettings.displaySettings,
      ),
      controlPanel,
      ControlPanelOneTimeAttacher.create(controlPanel, anchorButtonElement),
      new OnPageChatPool(chatContainer, blockPatternTester),
    );
  }

  public static createTwitch(
    video: HTMLVideoElement,
    canvas: HTMLElement,
    anchorButtonElement: Element,
    chatContainer: Element,
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): PlayerController {
    let blockPatternTester = BlockPatternTester.createHtml(
      new TwitchChatContentBuilder(),
      playerSettings.blockSettings,
    );
    let controlPanel = ControlPanel.createTwitch(
      globalDocuments,
      playerSettings,
    );
    return new PlayerController(
      window,
      video,
      DanmakuCanvasController.create(
        canvas,
        playerSettings,
        blockPatternTester,
        new TwitchChatContentBuilder(),
      ),
      NoopChatWindowToggler.create(),
      controlPanel,
      ControlPanelOneTimeAttacher.create(controlPanel, anchorButtonElement),
      new OnPageChatPool(chatContainer, blockPatternTester),
    );
  }

  public static createTwitch7tvLive(
    video: HTMLVideoElement,
    canvas: HTMLElement,
    anchorButtonElement: Element,
    chatContainer: Element,
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): PlayerController {
    let blockPatternTester = BlockPatternTester.createHtml(
      new Twitch7tvChatContentBuilder(),
      playerSettings.blockSettings,
    );
    let controlPanel = ControlPanel.createTwitch(
      globalDocuments,
      playerSettings,
    );
    return new PlayerController(
      window,
      video,
      DanmakuCanvasController.create(
        canvas,
        playerSettings,
        blockPatternTester,
        new Twitch7tvChatContentBuilder(),
      ),
      NoopChatWindowToggler.create(),
      controlPanel,
      ControlPanelOneTimeAttacher.create(controlPanel, anchorButtonElement),
      new OnPageChatPool(chatContainer, blockPatternTester),
    );
  }

  private static HAVE_FUTURE_DATA = 3;

  private addChatsCycleId: number | undefined;
  private delayedPlayId: number | undefined;
  private isChatLoopRunning = false;
  private chatPoolStarted = false;
  private awaitingSynchronizedPlaying = false;
  private removed = false;
  private pendingDanmakuChats = new Array<ChatEntry>();
  private nextDanmakuDisplayTime = 0;
  private scheduledChatPacingIntervalMs = 0;

  public constructor(
    private window: Window,
    private video: HTMLVideoElement,
    private danmakuCanvasController: DanmakuCanvasController,
    private chatWindowToggler: ChatWindowToggler,
    private controlPanel: ControlPanel,
    private controlPanelAttacher: ControlPanelAttacher,
    private chatPool: ChatPool,
    private followPlaybackRate = false,
    private chatPacing?: ChatPacingSettings,
    private synchronizeChatOnSeek = false,
  ) {
    this.controlPanelAttacher.start();

    this.video.onplaying = this.handlePlaying;
    this.video.onpause = () => this.pause();
    this.video.onended = () => this.clear();
    if (this.canStartPlaybackWithoutEvent()) {
      this.delayedPlayId = this.window.setTimeout(() => {
        this.delayedPlayId = undefined;
        if (this.canStartPlaybackWithoutEvent()) {
          this.play();
        }
      }, 0);
    }
    this.controlPanel.on("updateDisplaySettings", () =>
      this.updateDisplaySettings(),
    );
    this.controlPanel.on("updateBlockSettings", () =>
      this.updateBlockSettings(),
    );
    if (this.followPlaybackRate) {
      this.video.addEventListener("ratechange", this.updatePlaybackRate);
      this.updatePlaybackRate();
    }
    if (this.synchronizeChatOnSeek) {
      this.video.addEventListener("seeking", this.handleSynchronizedSeeking);
      this.video.addEventListener("seeked", this.handleSynchronizedSeeked);
      this.video.addEventListener("waiting", this.handleSynchronizedWaiting);
      this.video.addEventListener("emptied", this.handleSynchronizedSourceReset);
    }
  }

  private handlePlaying = (): void => {
    if (!this.video.seeking) {
      this.awaitingSynchronizedPlaying = false;
      this.play();
    }
  };

  private canStartPlaybackWithoutEvent(): boolean {
    return (
      !this.removed &&
      !this.video.paused &&
      !this.video.ended &&
      !this.video.seeking &&
      (!this.synchronizeChatOnSeek ||
        (!this.awaitingSynchronizedPlaying &&
          this.video.readyState >= PlayerController.HAVE_FUTURE_DATA))
    );
  }

  private updatePlaybackRate = (): void => {
    let previousPacingInterval = this.scheduledChatPacingIntervalMs;
    this.danmakuCanvasController.setPlaybackRate(this.video.playbackRate);
    if (
      this.chatPacing &&
      this.pendingDanmakuChats.length > 0 &&
      this.nextDanmakuDisplayTime > 0 &&
      previousPacingInterval > 0
    ) {
      let now = this.window.performance.now();
      let remainingFraction = Math.min(
        1,
        Math.max(
          0,
          (this.nextDanmakuDisplayTime - now) / previousPacingInterval,
        ),
      );
      let newPacingInterval = this.getChatPacingIntervalMs();
      this.nextDanmakuDisplayTime = now + newPacingInterval * remainingFraction;
      this.scheduledChatPacingIntervalMs = newPacingInterval;
    }
  };

  private handleSynchronizedSeeking = (): void => {
    this.clear();
    this.chatPool.clear();
  };

  private handleSynchronizedSeeked = (): void => {
    // A fully buffered seek is only required to emit "seeked", not another
    // "playing" event. Resume unless buffering or source replacement told us
    // to wait for a real playback-ready signal.
    if (
      !this.awaitingSynchronizedPlaying &&
      !this.video.paused &&
      !this.video.ended &&
      !this.video.seeking &&
      this.video.readyState >= PlayerController.HAVE_FUTURE_DATA
    ) {
      this.play();
    }
  };

  private handleSynchronizedWaiting = (): void => {
    // A buffering video can keep paused=false while currentTime is frozen.
    // Stop both the media-time reader and CSS motion until "playing" resumes.
    this.awaitingSynchronizedPlaying = true;
    this.pause();
  };

  private handleSynchronizedSourceReset = (): void => {
    // Kick can reuse a video element while changing VOD routes. The route can
    // update before the new media source resets currentTime, so discard the old
    // timeline and wait for a real "playing" event to establish the new one.
    this.awaitingSynchronizedPlaying = true;
    this.clear();
    this.chatPool.clear();
  };

  private play(): void {
    if (
      this.removed ||
      this.isChatLoopRunning ||
      this.video.seeking ||
      (this.synchronizeChatOnSeek && this.awaitingSynchronizedPlaying)
    ) {
      return;
    }
    if (this.delayedPlayId !== undefined) {
      this.window.clearTimeout(this.delayedPlayId);
      this.delayedPlayId = undefined;
    }
    this.isChatLoopRunning = true;
    if (!this.chatPoolStarted) {
      this.resetChatPacing();
      this.chatPool.start(this.getCurrentTimestamp());
      this.chatPoolStarted = true;
    } else {
      // Normal pause/resume keeps both the DOM cursor and queued danmaku.
      this.nextDanmakuDisplayTime = 0;
      this.scheduledChatPacingIntervalMs = 0;
    }
    this.addChatsPeriodic(this.window.performance.now());
    this.danmakuCanvasController.play();
  }

  private addChatsPeriodic = (frameTimestamp: number): void => {
    if (!this.isChatLoopRunning || this.removed) {
      return;
    }
    let videoTimestamp = this.getCurrentTimestamp();
    let chatEntries = this.chatPool.read(videoTimestamp);
    this.danmakuCanvasController.add(
      this.getPacedDanmakuChats(chatEntries, frameTimestamp),
      videoTimestamp,
    );
    this.addChatsCycleId = this.window.requestAnimationFrame(
      this.addChatsPeriodic,
    );
  };

  private getPacedDanmakuChats(
    chatEntries: Array<ChatEntry>,
    frameTimestamp: number,
  ): Array<ChatEntry> {
    let timelineChats = new Array<ChatEntry>();
    if (this.synchronizeChatOnSeek) {
      // Kick VOD rows already carry media timestamps and ChatPool only returns
      // them once they are due. Like a timeline danmaku renderer, hand every
      // due row to the lane engine in this frame instead of time-shifting it
      // through the live-chat smoothing FIFO. Timestamp-less fallback rows are
      // also shown immediately: delaying unknown media time is worse than
      // letting the lane engine accept or drop the current batch.
      timelineChats = chatEntries;
      chatEntries = [];
    }
    if (!this.chatPacing) {
      return [...timelineChats, ...chatEntries];
    }

    this.pendingDanmakuChats.push(...chatEntries);
    let overflow =
      this.pendingDanmakuChats.length - this.chatPacing.maxPendingChats;
    if (overflow > 0) {
      this.pendingDanmakuChats.splice(0, overflow);
    }
    if (
      this.pendingDanmakuChats.length === 0 ||
      (this.nextDanmakuDisplayTime > 0 &&
        frameTimestamp < this.nextDanmakuDisplayTime)
    ) {
      return timelineChats;
    }

    let chatEntry = this.pendingDanmakuChats.shift();
    if (this.pendingDanmakuChats.length === 0) {
      this.nextDanmakuDisplayTime = 0;
      this.scheduledChatPacingIntervalMs = 0;
    } else {
      let pacingInterval = this.getChatPacingIntervalMs();
      if (
        this.nextDanmakuDisplayTime === 0 ||
        frameTimestamp - this.nextDanmakuDisplayTime > pacingInterval * 4
      ) {
        // Establish a fresh phase after the first message or a long suspended
        // animation frame. Do not replay accumulated pacing debt in a burst.
        this.nextDanmakuDisplayTime = frameTimestamp + pacingInterval;
      } else {
        // Preserve the target phase across normal rAF quantization. Basing the
        // next target on the late frame itself would add one frame of drift to
        // every message, especially visible at 1.5x playback.
        this.nextDanmakuDisplayTime += pacingInterval;
      }
      this.scheduledChatPacingIntervalMs = pacingInterval;
    }
    return chatEntry ? [...timelineChats, chatEntry] : timelineChats;
  }

  private getChatPacingIntervalMs(): number {
    if (!this.chatPacing || !this.followPlaybackRate) {
      return this.chatPacing?.intervalMs ?? 0;
    }
    let playbackRate = this.video.playbackRate;
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
      playbackRate = 1;
    }
    return this.chatPacing.intervalMs / playbackRate;
  }

  private resetChatPacing(): void {
    this.pendingDanmakuChats = [];
    this.nextDanmakuDisplayTime = 0;
    this.scheduledChatPacingIntervalMs = 0;
  }

  private getCurrentTimestamp(): number {
    return this.video.currentTime * 1000;
  }

  private pause(): void {
    this.isChatLoopRunning = false;
    if (this.delayedPlayId !== undefined) {
      this.window.clearTimeout(this.delayedPlayId);
      this.delayedPlayId = undefined;
    }
    if (this.addChatsCycleId !== undefined) {
      this.window.cancelAnimationFrame(this.addChatsCycleId);
      this.addChatsCycleId = undefined;
    }
    if (this.synchronizeChatOnSeek) {
      this.nextDanmakuDisplayTime = 0;
      this.scheduledChatPacingIntervalMs = 0;
    } else {
      // Preserve the established pause/resume behavior on live streams and
      // other sites: skip chat accumulated while media playback was paused.
      this.resetChatPacing();
      this.chatPoolStarted = false;
    }
    this.danmakuCanvasController.pause();
  }

  private clear(): void {
    this.pause();
    this.clearChats();
    this.chatPoolStarted = false;
  }

  private clearChats(): void {
    this.resetChatPacing();
    this.danmakuCanvasController.clear();
  }

  private updateDisplaySettings(): void {
    this.danmakuCanvasController.updateDisplaySettings();
    this.chatWindowToggler.updateDisplaySettings();
  }

  private updateBlockSettings(): void {
    this.danmakuCanvasController.updateBlockSettings();
  }

  public remove(): void {
    this.removed = true;
    if (this.delayedPlayId !== undefined) {
      this.window.clearTimeout(this.delayedPlayId);
      this.delayedPlayId = undefined;
    }
    this.video.onplaying = undefined;
    this.video.onpause = undefined;
    this.video.onended = undefined;
    this.video.onloadedmetadata = undefined;
    this.video.onseeking = undefined;
    this.video.removeEventListener("ratechange", this.updatePlaybackRate);
    this.video.removeEventListener("seeking", this.handleSynchronizedSeeking);
    this.video.removeEventListener("seeked", this.handleSynchronizedSeeked);
    this.video.removeEventListener("waiting", this.handleSynchronizedWaiting);
    this.video.removeEventListener("emptied", this.handleSynchronizedSourceReset);
    this.pause();
    this.chatPool.clear?.();
    this.danmakuCanvasController.remove();
    this.chatWindowToggler.remove();
    this.controlPanel.remove();
    this.controlPanelAttacher.stop();
  }
}
