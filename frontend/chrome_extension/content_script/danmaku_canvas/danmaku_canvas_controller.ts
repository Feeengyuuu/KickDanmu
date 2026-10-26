import { ChatEntry } from "../../../../interface/chat_entry";
import {
  DisplaySettings,
  DistributionStyle,
  PlayerSettings,
} from "../../../../interface/player_settings";
import { BlockPatternTester } from "../common/block_pattern_tester";
import { ChatContentBuilder } from "../common/chat_content_builder";
import { LinkedList, LinkedNode } from "../common/linked_list";
import {
  DisplaySettingsTransform,
  keepDisplaySettings,
} from "../danmaku_profile";
import { DanmakuElement } from "./danmaku_element";

export class DanmakuCanvasController {
  public static create(
    canvas: HTMLElement,
    playerSettings: PlayerSettings,
    blockPatternTester: BlockPatternTester,
    contentBuilder: ChatContentBuilder,
    transformDisplaySettings: DisplaySettingsTransform = keepDisplaySettings,
  ): DanmakuCanvasController {
    return new DanmakuCanvasController(
      Math.random,
      canvas,
      playerSettings,
      (playerSettings, chatEntry) =>
        DanmakuElement.create(
          playerSettings,
          chatEntry,
          blockPatternTester,
          contentBuilder,
          transformDisplaySettings,
        ),
      transformDisplaySettings,
    );
  }

  private width: number;
  private height: number;
  private playing: boolean;
  private playbackRate = 1;
  private occupied = new Array<number>();
  private occupiedReleasers = new Map<DanmakuElement, () => void>();
  private elements = new LinkedList<DanmakuElement>();
  private resizeObserver: ResizeObserver;

  public constructor(
    private random: () => number,
    private canvas: HTMLElement,
    private playerSettings: PlayerSettings,
    private createDanmakuElement: (
      playerSettings: PlayerSettings,
      chatEntry: ChatEntry,
    ) => DanmakuElement,
    private transformDisplaySettings: DisplaySettingsTransform = keepDisplaySettings,
  ) {
    this.resizeObserver = new ResizeObserver((entries) =>
      this.getNewSize(entries[0]),
    );
    this.resizeObserver.observe(this.canvas);
    this.pause();
  }

  private getNewSize(entry: ResizeObserverEntry): void {
    let newWidth: number;
    let newHeight: number;
    if (entry.contentBoxSize) {
      newWidth = entry.contentBoxSize[0].inlineSize;
      newHeight = entry.contentBoxSize[0].blockSize;
    } else {
      newWidth = entry.contentRect.width;
      newHeight = entry.contentRect.height;
    }
    this.height = newHeight;
    if (newWidth !== this.width) {
      this.width = newWidth;
      this.elements.forEach((danmakuElement) => {
        danmakuElement.updateCanvasSize(this.width);
      });
    }
    while (this.occupied.length < this.height) {
      this.occupied.push(0);
    }
  }

  public add(
    chatEntries: Array<ChatEntry>,
    currentTimestamp?: number,
  ): void {
    if (chatEntries.length === 0) {
      return;
    }
    let displaySettings = this.transformDisplaySettings(
      this.playerSettings.displaySettings,
    );
    if (!displaySettings.enable || !this.height) {
      return;
    }
    for (let chatEntry of chatEntries) {
      this.tryStartPlaying(chatEntry, currentTimestamp);
    }
  }

  private tryStartPlaying(
    chatEntry: ChatEntry,
    currentTimestamp?: number,
  ): void {
    let element = this.createDanmakuElement(this.playerSettings, chatEntry);
    this.canvas.append(element.body);
    element.setPlaybackRate(this.playbackRate);
    let displaySettings = this.transformDisplaySettings(
      this.playerSettings.displaySettings,
    );
    let elapsedMediaTimeMs =
      currentTimestamp !== undefined && chatEntry.timestamp !== undefined
        ? Math.max(0, currentTimestamp - chatEntry.timestamp)
        : 0;

    let startY = Math.floor((displaySettings.topMargin / 100) * this.height);
    let endY =
      this.height -
      Math.floor((displaySettings.bottomMargin / 100) * this.height); // Exclusive
    let elementHeight = element.getOffsetHeight();
    if (endY - startY - elementHeight < 0) {
      // Not enough room for a danmaku.
      element.remove();
      return;
    }

    let marginAround =
      Math.floor(elementHeight / (displaySettings.density / 100)) -
      elementHeight;
    let occupyScore = 0;
    let initY = this.getInitY(startY, endY, elementHeight, displaySettings);
    let headY = initY - marginAround;
    let tailY = initY + elementHeight + marginAround; // Exclusive
    for (let i = Math.max(0, headY); i < Math.min(endY, tailY); i++) {
      occupyScore += this.occupied[i];
    }

    let posYDown = this.findPosYDownward(
      initY,
      headY,
      tailY,
      occupyScore,
      elementHeight,
      startY,
      endY,
    );
    let posYUp = this.findPosYUpward(
      initY,
      headY,
      tailY,
      occupyScore,
      startY,
      endY,
    );
    if (posYDown < 0 && posYUp < 0) {
      element.remove();
      return;
    }

    let posY: number;
    if (posYDown < 0) {
      posY = posYUp;
    } else if (posYUp < 0) {
      posY = posYDown;
    } else if (posYDown - initY > initY - posYUp) {
      posY = posYUp;
    } else {
      posY = posYDown;
    }

    if (!element.setReadyToPlay(posY, this.width, elapsedMediaTimeMs)) {
      element.remove();
      return;
    }

    for (let i = posY; i < posY + elementHeight; i++) {
      this.occupied[i]++;
    }
    let node = this.elements.pushBack(element);
    let releaseOccupied = (): void => {
      if (!this.occupiedReleasers.has(element)) {
        return;
      }
      this.occupiedReleasers.delete(element);
      this.releaseOccupied(posY, elementHeight);
    };
    this.occupiedReleasers.set(element, releaseOccupied);
    if (element.shouldOccupyUntilDisplayEnded()) {
      // A late VOD message can start fully inside the viewport. Keep its lane
      // until it leaves so another equally late message cannot overlap it.
      element.once("displayEnded", releaseOccupied);
    } else {
      element.once("occupyEnded", releaseOccupied);
    }
    element.once("displayEnded", () => this.removeNode(node));
    if (this.playing) {
      element.play();
    }
  }

  private getInitY(
    startY: number,
    endY: number,
    elementHeight: number,
    displaySettings: DisplaySettings,
  ): number {
    switch (displaySettings.distributionStyle) {
      case DistributionStyle.TopDownDistributionStyle:
        return startY;
      case DistributionStyle.RandomDistributionStyle:
        return (
          Math.floor(this.random() * (endY - startY - elementHeight + 1)) +
          startY
        );
    }
    return ((): never => {})();
  }

  private findPosYDownward(
    posY: number,
    headY: number,
    tailY: number,
    score: number,
    elementHeight: number,
    startY: number,
    endY: number,
  ): number {
    while (score > 0 && posY + elementHeight < endY) {
      posY++;
      headY++;
      tailY++;
      if (headY - 1 >= startY) {
        score -= this.occupied[headY - 1];
      }
      if (tailY <= endY) {
        score += this.occupied[tailY - 1];
      }
    }
    if (score > 0) {
      return -1;
    } else {
      return posY;
    }
  }

  private findPosYUpward(
    posY: number,
    headY: number,
    tailY: number,
    score: number,
    startY: number,
    endY: number,
  ): number {
    while (score > 0 && posY > startY) {
      posY--;
      headY--;
      tailY--;
      if (headY >= startY) {
        score += this.occupied[headY];
      }
      if (tailY < endY) {
        score -= this.occupied[tailY];
      }
    }
    if (score > 0) {
      return -1;
    } else {
      return posY;
    }
  }

  private releaseOccupied(posY: number, elementHeight: number): void {
    for (let i = posY; i < posY + elementHeight; i++) {
      this.occupied[i]--;
    }
  }

  private removeNode(node: LinkedNode<DanmakuElement>): void {
    this.occupiedReleasers.get(node.value)?.();
    node.remove();
    node.value.remove();
  }

  public play(): void {
    this.playing = true;
    this.elements.forEach((danmakuElement) => {
      danmakuElement.play();
    });
  }

  public pause(): void {
    this.playing = false;
    this.elements.forEach((danmakuElement) => {
      danmakuElement.pause();
    });
  }

  public setPlaybackRate(playbackRate: number): void {
    let normalizedPlaybackRate =
      Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    if (normalizedPlaybackRate === this.playbackRate) {
      return;
    }
    this.playbackRate = normalizedPlaybackRate;
    this.elements.forEach((danmakuElement) => {
      danmakuElement.setPlaybackRate(this.playbackRate);
    });
  }

  public updateDisplaySettings(): void {
    if (!this.playerSettings.displaySettings.enable) {
      this.clear();
    } else {
      this.elements.forEach((danmakuElement) => {
        danmakuElement.reRender();
      });
    }
  }

  public updateBlockSettings(): void {
    this.elements.forEachNode((danmakuElementNode) => {
      if (danmakuElementNode.value.isBlocked()) {
        this.removeNode(danmakuElementNode);
      }
    });
  }

  public clear(): void {
    this.elements.forEachNode((danmakuElementNode) => {
      this.removeNode(danmakuElementNode);
    });
    this.elements.clear();
    this.occupiedReleasers.clear();
    this.occupied.fill(0);
  }

  public remove(): void {
    this.resizeObserver.disconnect();
    this.clear();
  }
}
