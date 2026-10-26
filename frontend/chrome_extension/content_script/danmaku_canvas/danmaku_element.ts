import EventEmitter = require("events");
import { ChatEntry } from "../../../../interface/chat_entry";
import {
  DisplaySettings,
  PlayerSettings,
} from "../../../../interface/player_settings";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { ChatContentBuilder } from "../common/chat_content_builder";
import {
  DisplaySettingsTransform,
  keepDisplaySettings,
} from "../danmaku_profile";
import { E } from "@selfage/element/factory";

export interface DanmakuElement {
  on(event: "occupyEnded", listener: () => void): this;
  on(event: "displayEnded", listener: () => void): this;
}

export class DanmakuElement extends EventEmitter {
  public static create(
    playerSettings: PlayerSettings,
    chatEntry: ChatEntry,
    blockPatternTester: BlockPatternTester,
    contentBuilder: ChatContentBuilder,
    transformDisplaySettings: DisplaySettingsTransform = keepDisplaySettings,
  ): DanmakuElement {
    return new DanmakuElement(
      window,
      blockPatternTester,
      contentBuilder,
      playerSettings.displaySettings,
      chatEntry,
      transformDisplaySettings,
    );
  }

  private static OPACITY_SCALE = 1 / 100;
  private static FONT_SIZE_SCALE = 1 / 1;

  public body: HTMLDivElement;
  private canvasWidth: number;
  private posX: number;
  private posY: number;
  private playAfterLeaving: boolean;
  private playByPlayer: boolean;
  private playbackRate = 1;
  private occupyUntilDisplayEnded = false;
  private endOccupyTimeoutId: number;
  private endDisplayTimeoutId: number;

  public constructor(
    private window: Window,
    private blockPatternTester: BlockPatternTester,
    private danmakuElementContentBuilder: ChatContentBuilder,
    private displaySettings: DisplaySettings,
    private chatEntry: ChatEntry,
    private transformDisplaySettings: DisplaySettingsTransform = keepDisplaySettings,
  ) {
    super();
    this.body = E.div({
      class: "danmaku-element",
      style: `display: flex; flex-flow: row nowrap; align-items: center; position: absolute; bottom: 100%; right: 0; padding: 2px 16px 2px 0; line-height: normal; z-index: 10; white-space: nowrap; visibility: hidden;`,
    });
    this.render();
    this.leaveToResume();
    this.body.addEventListener("mouseenter", () => this.hoverToPause());
    this.body.addEventListener("mouseleave", () => this.leaveToResume());
  }

  private render(): void {
    let displaySettings = this.transformDisplaySettings(this.displaySettings);
    this.body.style.opacity = `${
      displaySettings.opacity * DanmakuElement.OPACITY_SCALE
    }`;
    this.body.style.fontSize = `${
      displaySettings.fontSize * DanmakuElement.FONT_SIZE_SCALE
    }px`;
    this.body.style.fontWeight = `${displaySettings.fontWeight}`;
    this.body.style.setProperty(
      "font-family",
      displaySettings.fontFamily,
      "important",
    );
    if (displaySettings.enableInteraction) {
      this.body.style.pointerEvents = "auto";
    } else {
      this.body.style.pointerEvents = "none";
    }
    this.body.innerHTML = this.danmakuElementContentBuilder.build(
      this.chatEntry,
      displaySettings,
    );
  }
  private leaveToResume(): void {
    this.playAfterLeaving = true;
    this.tryStartTransition();
  }

  private tryStartTransition(): void {
    if (this.playAfterLeaving && this.playByPlayer) {
      this.startTransition();
    }
  }

  private startTransition(): void {
    let speed =
      this.transformDisplaySettings(this.displaySettings).speed *
      this.playbackRate;
    if (this.posX > 0) {
      let remainingDuration = this.posX / speed;
      this.endOccupyTimeoutId = this.window.setTimeout(() => {
        this.emit("occupyEnded");
      }, remainingDuration * 1000);
    } else {
      this.emit("occupyEnded");
    }
    if (this.posX > -this.canvasWidth) {
      let duration = (this.canvasWidth + this.posX) / speed;
      this.body.style.transition = `transform ${duration}s linear`;
      this.transform(-this.canvasWidth);
      this.endDisplayTimeoutId = this.window.setTimeout(() => {
        this.emit("displayEnded");
      }, duration * 1000);
    } else {
      this.emit("displayEnded");
    }
  }

  private transform(posX: number): void {
    this.body.style.transform = `translate3d(${posX}px, ${this.posY}px, 0)`;
  }

  private hoverToPause(): void {
    this.playAfterLeaving = false;
    this.pauseTransition();
  }

  private pauseTransition(): void {
    this.clearAllTimeouts();
    this.posX = this.getPosXComputed();
    this.transform(this.posX);
    this.body.style.transition = `none`;
    // Force reflow.
    this.body.offsetHeight;
  }

  private getPosXComputed(): number {
    return new DOMMatrix(this.window.getComputedStyle(this.body).transform).m41;
  }

  private clearAllTimeouts(): void {
    this.window.clearTimeout(this.endOccupyTimeoutId);
    this.window.clearTimeout(this.endDisplayTimeoutId);
  }

  public getOffsetHeight(): number {
    return this.body.offsetHeight;
  }

  public setReadyToPlay(
    posY: number,
    canvasWidth: number,
    elapsedMediaTimeMs = 0,
  ): boolean {
    this.canvasWidth = canvasWidth;
    let normalizedElapsedMediaTimeMs =
      Number.isFinite(elapsedMediaTimeMs) && elapsedMediaTimeMs > 0
        ? elapsedMediaTimeMs
        : 0;
    let speed = this.transformDisplaySettings(this.displaySettings).speed;
    this.posX =
      this.body.offsetWidth - (speed * normalizedElapsedMediaTimeMs) / 1000;
    this.occupyUntilDisplayEnded = this.posX <= 0;
    this.posY = posY;
    this.body.style.bottom = "";
    this.body.style.top = "0";
    this.transform(this.posX);
    this.body.style.transition = `none`;
    this.body.style.visibility = "visible";
    // Force reflow.
    this.body.offsetHeight;
    return this.posX > -this.canvasWidth;
  }

  public shouldOccupyUntilDisplayEnded(): boolean {
    return this.occupyUntilDisplayEnded;
  }

  public play(): void {
    this.playByPlayer = true;
    this.tryStartTransition();
  }

  public pause(): void {
    this.playByPlayer = false;
    this.pauseTransition();
  }

  public setPlaybackRate(playbackRate: number): void {
    let normalizedPlaybackRate =
      Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    if (normalizedPlaybackRate === this.playbackRate) {
      return;
    }
    this.tryPauseTransition();
    this.playbackRate = normalizedPlaybackRate;
    this.tryStartTransition();
  }

  public reRender(): void {
    this.tryPauseTransition();
    this.render();
    this.tryStartTransition();
  }

  private tryPauseTransition(): void {
    if (this.playAfterLeaving && this.playByPlayer) {
      this.pauseTransition();
    }
  }

  public isBlocked(): boolean {
    return this.blockPatternTester.test(this.chatEntry);
  }

  public updateCanvasSize(canvasWidth: number): void {
    this.canvasWidth = canvasWidth;
    this.tryPauseTransition();
    this.tryStartTransition();
  }

  public remove(): void {
    this.clearAllTimeouts();
    this.body.remove();
  }
}
