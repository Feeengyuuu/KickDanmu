import {
  DisplaySettings,
  DistributionStyle,
} from "../../../interface/player_settings";
import { ChatEntry } from "../../../interface/chat_entry";
import {
  ChatContentBuilder,
  KickChatContentBuilder,
} from "./common/chat_content_builder";
import { OnPageChatPool } from "./chat_pool";
import { MockBlockPatternTester } from "./common/mocks";
import { DanmakuCanvasController } from "./danmaku_canvas/danmaku_canvas_controller";
import { DanmakuElement } from "./danmaku_canvas/danmaku_element";
import { createKickDisplaySettings } from "./danmaku_profile";
import {
  createKickDanmakuCanvas,
  KickAssembler,
} from "./kick/kick_assembler";
import { isKickVodPath, parseKickVodRoute } from "./kick/kick_routes";
import { PlayerController } from "./player_controller";
import { Assembler, Refresher } from "./refresher";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, gt, lt } from "@selfage/test_matcher";
import { WebServiceClient } from "@selfage/web_service_client";

function getTransitionDuration(element: DanmakuElement): number {
  return Number(element.body.style.transition.split(" ")[1].slice(0, -1));
}

TEST_RUNNER.run({
  name: "KickBehaviorTests",
  cases: [
    {
      name: "AppliesKickOnlyDisplayOverridesWithoutMutatingSavedSettings",
      execute: () => {
        // Prepare
        let savedSettings: DisplaySettings = {
          speed: 200,
          opacity: 45,
          fontSize: 25,
          density: 90,
          topMargin: 12,
          bottomMargin: 9,
        };

        // Execute
        let kickSettings = createKickDisplaySettings(savedSettings);

        // Verify
        assertThat(kickSettings.fontSize, eq(30), "Kick font size");
        assertThat(kickSettings.opacity, eq(80), "Kick opacity");
        assertThat(kickSettings.topMargin, eq(0), "Kick top margin");
        assertThat(kickSettings.bottomMargin, eq(0), "Kick bottom margin");
        assertThat(kickSettings.speed, eq(200), "unchanged speed");
        assertThat(kickSettings.density, eq(90), "unchanged density");
        assertThat(savedSettings.fontSize, eq(25), "saved font size");
        assertThat(savedSettings.opacity, eq(45), "saved opacity");
      },
    },
    {
      name: "RendersKickTextAndEmotesAtTheEffectiveFontSize",
      execute: () => {
        // Prepare
        let element = new DanmakuElement(
          window,
          new MockBlockPatternTester(),
          new KickChatContentBuilder(),
          {
            speed: 200,
            opacity: 35,
            fontSize: 25,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
          },
          {
            content:
              '<span>Kick chat</span><img alt="Kick emote" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">',
          },
          createKickDisplaySettings,
        );

        // Verify
        assertThat(element.body.style.fontSize, eq("30px"), "text size");
        assertThat(element.body.style.opacity, eq("0.8"), "opacity");
        let text = element.body.querySelector("span") as HTMLElement;
        let emote = element.body.querySelector("img") as HTMLElement;
        assertThat(text.style.fontSize, eq("30px"), "chat text size");
        assertThat(text.style.fontWeight, eq("400"), "chat text weight");
        assertThat(
          text.style.getPropertyValue("-webkit-text-stroke-width"),
          eq("0.067em"),
          "outline width",
        );
        assertThat(
          text.style.getPropertyValue("paint-order"),
          eq("stroke"),
          "outline painted under the fill",
        );
        assertThat(emote.style.width, eq("42px"), "emote width");
        assertThat(emote.style.height, eq("42px"), "emote height");
        element.remove();
      },
    },
    {
      name: "SizesTheWholeKickEmoteFrameToTheEnlargedEmote",
      execute: () => {
        // Prepare: emote markup captured from kick.com on 2026-10-24, with the
        // Kick CSS that sizes it from the chat font size.
        let page = document.createElement("div");
        page.innerHTML = `<style>
          .kick-page { --chatroom-font-size: 14px; }
          .kick-page img { max-width: 100%; }
          .kick-page [data-emote-id] { position: relative; display: inline-block; height: 1.2em; width: calc(var(--chatroom-font-size) * 28 / 13); }
          .kick-page [data-emote-id] > div { position: absolute; top: 50%; left: 0; transform: translateY(-50%); }
        </style>`;
        page.className = "kick-page";
        document.body.append(page);
        let element = new DanmakuElement(
          window,
          new MockBlockPatternTester(),
          new KickChatContentBuilder(),
          {
            speed: 200,
            opacity: 35,
            fontSize: 25,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
          },
          {
            content:
              '<span class="leading-[1.55] font-normal">hi <span class="relative mx-px inline-block h-[1.2em] align-middle w-[calc(var(--chatroom-font-size)*28/13)]" data-emote-id="6316000" data-emote-name="cat"><div class="absolute top-1/2 left-0 -translate-y-1/2" data-state="closed" style="height: calc(var(--chatroom-font-size)*28/13); width: calc(var(--chatroom-font-size)*28/13);"><img class="h-full w-full" alt="cat" draggable="false" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></span></span>',
          },
          createKickDisplaySettings,
        );
        element.body.style.visibility = "visible";
        page.append(element.body);

        // Verify
        let wrapper = element.body.querySelector("[data-emote-id]");
        let emote = element.body.querySelector("img");
        assertThat(
          Math.round(wrapper.getBoundingClientRect().width),
          eq(42),
          "reserved emote width",
        );
        assertThat(
          Math.round(emote.getBoundingClientRect().width),
          eq(42),
          "rendered emote width",
        );
        assertThat(
          Math.round(emote.getBoundingClientRect().height),
          eq(42),
          "rendered emote height",
        );
        element.remove();
        page.remove();
      },
    },
    {
      name: "UpdatesAnActiveDanmakuWhenPlaybackRateChanges",
      execute: () => {
        // Prepare
        let scheduledDelays = new Array<number>();
        let clearedTimeoutIds = new Array<number>();
        let nextTimeoutId = 1;
        let elementWindow = {
          setTimeout: (_handler: TimerHandler, delay: number) => {
            scheduledDelays.push(delay);
            return nextTimeoutId++;
          },
          clearTimeout: (timeoutId: number) =>
            clearedTimeoutIds.push(timeoutId),
          getComputedStyle: () => ({
            transform: "matrix(1, 0, 0, 1, 120, 0)",
          }),
        } as unknown as Window;
        let element = new DanmakuElement(
          elementWindow,
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Playback rate test",
          },
          {
            speed: 200,
            opacity: 80,
            fontSize: 25,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
          },
          { content: "Playback rate test" },
        );
        document.body.append(element.body);
        element.setReadyToPlay(0, 800);

        // Execute
        element.play();
        let normalDuration = getTransitionDuration(element);
        element.setPlaybackRate(2);
        let doubleSpeedDuration = getTransitionDuration(element);

        // Verify
        assertThat(normalDuration, gt(4), "normal duration");
        assertThat(doubleSpeedDuration, eq(2.3), "double-speed duration");
        assertThat(scheduledDelays[2], eq(300), "occupancy timeout");
        assertThat(scheduledDelays[3], eq(2300), "display timeout");
        assertThat(clearedTimeoutIds.length, eq(2), "cleared timeout count");
        element.remove();
      },
    },
    {
      name: "StartsLateObservedKickVodChatAtItsMediaPosition",
      execute: () => {
        // Prepare: a timestamped VOD chat is first observed 1.2 media seconds
        // late. At 200px/s it should already have travelled 240px.
        let element = new DanmakuElement(
          window,
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Late VOD chat",
          },
          {
            speed: 200,
            opacity: 80,
            fontSize: 25,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
          },
          { content: "Late VOD chat", timestamp: 100000 },
        );
        document.body.append(element.body);
        let textWidth = element.body.offsetWidth;

        // Execute
        (element.setReadyToPlay as any)(0, 800, 1200);

        // Verify: position is a function of media age, not DOM arrival time.
        let expectedX = textWidth - 240;
        let actualX = new DOMMatrix(element.body.style.transform).m41;
        assertThat(actualX, gt(expectedX - 0.1), "minimum media position");
        assertThat(actualX, lt(expectedX + 0.1), "maximum media position");
        element.remove();
      },
    },
    {
      name: "DropsExpiredKickVodChatInsteadOfStartingItLate",
      execute: async () => {
        // Prepare: at 200px/s, a chat observed ten media seconds late has
        // already travelled well beyond an 800px canvas.
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "800px";
        canvas.style.height = "120px";
        document.body.append(canvas);
        let playerSettings = {
          displaySettings: {
            enable: true,
            speed: 200,
            opacity: 80,
            fontSize: 25,
            density: 100,
            topMargin: 0,
            bottomMargin: 0,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
            distributionStyle: DistributionStyle.TopDownDistributionStyle,
          },
        };
        let controller = DanmakuCanvasController.create(
          canvas,
          playerSettings,
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Expired VOD chat",
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Execute
        controller.add(
          [{ content: "Expired VOD chat", timestamp: 100000 }],
          110000,
        );

        // Verify
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(0),
          "expired element count",
        );
        controller.remove();
        canvas.remove();
      },
    },
    {
      name: "KeepsLateKickVodChatsInSeparateLanes",
      execute: async () => {
        // Prepare: both messages are already fully inside the viewport. Their
        // horizontal age is identical, so assigning the same lane would make
        // them overlap exactly.
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "800px";
        canvas.style.height = "120px";
        document.body.append(canvas);
        let controller = DanmakuCanvasController.create(
          canvas,
          {
            displaySettings: {
              enable: true,
              speed: 200,
              opacity: 80,
              fontSize: 25,
              density: 100,
              topMargin: 0,
              bottomMargin: 0,
              fontWeight: 400,
              fontFamily: "Arial",
              enableInteraction: false,
              distributionStyle: DistributionStyle.TopDownDistributionStyle,
            },
          },
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: (chatEntry) => chatEntry.content,
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        controller.play();

        // Execute
        controller.add(
          [
            { content: "late one", timestamp: 100000 },
            { content: "late two", timestamp: 100000 },
          ],
          102000,
        );

        // Verify
        let elements = Array.from(
          canvas.querySelectorAll<HTMLElement>(".danmaku-element"),
        );
        assertThat(elements.length, eq(2), "late element count");
        let firstY = new DOMMatrix(elements[0].style.transform).m42;
        let secondY = new DOMMatrix(elements[1].style.transform).m42;
        assertThat(
          Math.abs(firstY - secondY),
          gt(0),
          "late messages use different lanes",
        );
        controller.remove();
        canvas.remove();
      },
    },
    {
      name: "PlacesKickDanmakuInTheTopThirtyPercentRegion",
      execute: async () => {
        // Prepare
        let playerSurface = document.createElement("div");
        playerSurface.style.position = "relative";
        playerSurface.style.width = "600px";
        playerSurface.style.height = "400px";
        document.body.append(playerSurface);
        let canvas = createKickDanmakuCanvas(playerSurface);
        let playerSettings = {
          displaySettings: {
            enable: true,
            speed: 200,
            opacity: 25,
            fontSize: 25,
            density: 100,
            topMargin: 60,
            bottomMargin: 0,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
            distributionStyle: DistributionStyle.RandomDistributionStyle,
          },
        };
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let contentBuilder: ChatContentBuilder = {
          extractContent: (content) => content,
          build: () => "Top region test",
        };
        let controller = new DanmakuCanvasController(
          () => 0.999,
          canvas,
          playerSettings,
          (settings, chatEntry) =>
            DanmakuElement.create(
              settings,
              chatEntry,
              blockPatternTester,
              contentBuilder,
              createKickDisplaySettings,
            ),
          createKickDisplaySettings,
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Execute
        controller.add([{ content: "Top region test" }]);

        // Verify
        let body = canvas.querySelector(".danmaku-element") as HTMLElement;
        let posY = new DOMMatrix(body.style.transform).m42;
        assertThat(posY, gt(50), "randomized vertical position");
        assertThat(posY + body.offsetHeight, lt(121), "bottom of top region");
        assertThat(body.style.fontSize, eq("30px"), "effective font size");
        controller.remove();
        playerSurface.remove();
      },
    },
    {
      name: "KeepsKickDanmakuStableAcrossFullscreenHeightChanges",
      execute: async () => {
        // Prepare
        let playerSurface = document.createElement("div");
        playerSurface.style.position = "relative";
        playerSurface.style.width = "600px";
        playerSurface.style.height = "400px";
        document.body.append(playerSurface);
        let canvas = createKickDanmakuCanvas(playerSurface);
        let controller = new DanmakuCanvasController(
          () => 0.999,
          canvas,
          {
            displaySettings: {
              enable: true,
              speed: 200,
              opacity: 80,
              fontSize: 25,
              density: 100,
              topMargin: 0,
              bottomMargin: 10,
              fontWeight: 400,
              fontFamily: "Arial",
              enableInteraction: false,
              distributionStyle: DistributionStyle.RandomDistributionStyle,
            },
          },
          (settings, chatEntry) =>
            DanmakuElement.create(
              settings,
              chatEntry,
              new MockBlockPatternTester(),
              {
                extractContent: (content) => content,
                build: (chatEntry) => chatEntry.content,
              },
              createKickDisplaySettings,
            ),
          createKickDisplaySettings,
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        controller.add([{ content: "Before fullscreen exit" }]);
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(1),
          "initial danmaku count",
        );

        // Execute
        playerSurface.style.height = "200px";
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Verify
        assertThat(canvas.offsetHeight, eq(60), "top-region canvas height");
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(1),
          "stable fullscreen danmaku count",
        );
        controller.add([{ content: "After fullscreen exit" }]);
        let bodies = canvas.querySelectorAll(".danmaku-element");
        let body = bodies[bodies.length - 1] as HTMLElement;
        let posY = new DOMMatrix(body.style.transform).m42;
        assertThat(
          posY + body.offsetHeight,
          lt(61),
          "reconfined danmaku bottom",
        );
        controller.remove();
        playerSurface.remove();
      },
    },
    {
      name: "KeepsDefaultSiteDanmakuAcrossHeightChanges",
      execute: async () => {
        // Prepare
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "600px";
        canvas.style.height = "400px";
        document.body.append(canvas);
        let controller = DanmakuCanvasController.create(
          canvas,
          {
            displaySettings: {
              enable: true,
              speed: 200,
              opacity: 80,
              fontSize: 25,
              density: 100,
              topMargin: 0,
              bottomMargin: 70,
              fontWeight: 400,
              fontFamily: "Arial",
              enableInteraction: false,
              distributionStyle: DistributionStyle.TopDownDistributionStyle,
            },
          },
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Default resize test",
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        controller.add([{ content: "Default resize test" }]);

        // Execute
        canvas.style.height = "200px";
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Verify
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(1),
          "default-site danmaku count",
        );
        controller.remove();
        canvas.remove();
      },
    },
    {
      name: "SkipsKickDisplayTransformOnEmptyAnimationFrames",
      execute: () => {
        // Prepare
        let transformCount = 0;
        let canvas = document.createElement("div");
        let controller = new DanmakuCanvasController(
          Math.random,
          canvas,
          { displaySettings: {} },
          () => ({}) as DanmakuElement,
          (settings) => {
            transformCount++;
            return settings;
          },
        );

        // Execute
        controller.add([]);

        // Verify
        assertThat(transformCount, eq(0), "display transform count");
        controller.remove();
      },
    },
    {
      name: "ReleasesActiveDanmakuWhenDisplayIsDisabled",
      execute: async () => {
        // Prepare
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "600px";
        canvas.style.height = "200px";
        document.body.append(canvas);
        let playerSettings = {
          displaySettings: {
            enable: true,
            speed: 200,
            opacity: 80,
            fontSize: 25,
            density: 100,
            topMargin: 0,
            bottomMargin: 70,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
            distributionStyle: DistributionStyle.TopDownDistributionStyle,
          },
        };
        let controller = DanmakuCanvasController.create(
          canvas,
          playerSettings,
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Disable display test",
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        controller.add([{ content: "Disable display test" }]);

        // Execute
        playerSettings.displaySettings.enable = false;
        controller.updateDisplaySettings();

        // Verify
        assertThat(
          (controller as any).occupiedReleasers.size,
          eq(0),
          "active occupancy releaser count",
        );
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(0),
          "rendered danmaku count",
        );
        controller.remove();
        canvas.remove();
      },
    },
    {
      name: "PropagatesPlaybackRateToActiveDanmaku",
      execute: async () => {
        // Prepare
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "600px";
        canvas.style.height = "400px";
        document.body.append(canvas);
        let controller = DanmakuCanvasController.create(
          canvas,
          {
            displaySettings: {
              enable: true,
              speed: 200,
              opacity: 80,
              fontSize: 25,
              density: 100,
              topMargin: 0,
              bottomMargin: 70,
              fontWeight: 400,
              fontFamily: "Arial",
              enableInteraction: false,
              distributionStyle: DistributionStyle.TopDownDistributionStyle,
            },
          },
          new MockBlockPatternTester(),
          {
            extractContent: (content) => content,
            build: () => "Controller rate test",
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        controller.add([{ content: "Controller rate test" }]);
        controller.play();
        let body = canvas.querySelector(".danmaku-element") as HTMLElement;
        let normalDuration = Number(
          body.style.transition.split(" ")[1].slice(0, -1),
        );

        // Execute
        controller.setPlaybackRate(2);
        let doubleSpeedDuration = Number(
          body.style.transition.split(" ")[1].slice(0, -1),
        );

        // Verify
        assertThat(
          doubleSpeedDuration,
          lt(normalDuration * 0.6),
          "controller double-speed duration",
        );
        controller.remove();
        canvas.remove();
      },
    },
    {
      name: "PacesNewKickChatNodesAcrossAnimationFrames",
      execute: async () => {
        // Prepare
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML = "<div>baseline</div>";
        let canvas = document.createElement("div");
        canvas.style.position = "relative";
        canvas.style.width = "800px";
        canvas.style.height = "300px";
        document.body.append(chatContainer, canvas);
        let playerSettings = {
          displaySettings: {
            enable: true,
            speed: 200,
            opacity: 80,
            fontSize: 25,
            density: 100,
            topMargin: 0,
            bottomMargin: 0,
            fontWeight: 400,
            fontFamily: "Arial",
            enableInteraction: false,
            distributionStyle: DistributionStyle.TopDownDistributionStyle,
          },
        };
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let canvasController = DanmakuCanvasController.create(
          canvas,
          playerSettings,
          blockPatternTester,
          {
            extractContent: (content) => content,
            build: (chatEntry) => chatEntry.content,
          },
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        let scheduledFrames = new Array<FrameRequestCallback>();
        let currentTime = 0;
        let playerWindow = {
          performance: { now: () => currentTime },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          canvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          new OnPageChatPool(chatContainer, blockPatternTester),
          {} as never,
          undefined,
          false,
          { intervalMs: 80, maxPendingChats: 30 },
        );
        video.dispatchEvent(new Event("playing"));
        chatContainer.append(
          Object.assign(document.createElement("div"), {
            innerHTML: "<span>one</span>",
          }),
          Object.assign(document.createElement("div"), {
            innerHTML: "<span>two</span>",
          }),
          Object.assign(document.createElement("div"), {
            innerHTML: "<span>three</span>",
          }),
        );
        let advanceFrame = (timestamp: number): void => {
          currentTime = timestamp;
          scheduledFrames.shift()(timestamp);
        };

        // Execute and verify
        advanceFrame(0);
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(1),
          "danmaku count at 0ms",
        );
        advanceFrame(79);
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(1),
          "danmaku count at 79ms",
        );
        advanceFrame(80);
        assertThat(
          canvas.querySelectorAll(".danmaku-element").length,
          eq(2),
          "danmaku count at 80ms",
        );
        advanceFrame(160);
        let danmakuElements = Array.from(
          canvas.querySelectorAll(".danmaku-element"),
        );
        assertThat(danmakuElements.length, eq(3), "danmaku count at 160ms");
        assertThat(
          danmakuElements.map((element) => element.textContent).join(","),
          eq("one,two,three"),
          "danmaku order",
        );
        controller.remove();
        chatContainer.remove();
        canvas.remove();
      },
    },
    {
      name: "ScalesKickChatPacingWithVodPlaybackRate",
      execute: () => {
        // Prepare: Kick's native VOD chat follows media time at 2x, so the
        // danmaku smoothing queue must consume twice as quickly as at 1x.
        let scheduledFrames = new Array<FrameRequestCallback>();
        let currentTime = 0;
        let playerWindow = {
          performance: { now: () => currentTime },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        video.playbackRate = 2;
        let unreadChats = [
          { content: "one" },
          { content: "two" },
          { content: "three" },
        ];
        let displayedContents = new Array<string>();
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (chatEntries: Array<ChatEntry>) =>
              displayedContents.push(
                ...chatEntries.map((chatEntry) => chatEntry.content),
              ),
            setPlaybackRate: () => {},
            play: () => {},
            pause: () => {},
            clear: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              let chats = unreadChats;
              unreadChats = [];
              return chats;
            },
          } as never,
          {} as never,
          undefined,
          true,
          { intervalMs: 80, maxPendingChats: 30 },
        );
        let advanceFrame = (timestamp: number): void => {
          currentTime = timestamp;
          scheduledFrames.shift()(timestamp);
        };

        // Execute and verify: 80ms media-time pacing becomes 40ms wall time.
        video.dispatchEvent(new Event("playing"));
        assertThat(displayedContents.join(","), eq("one"), "at 0ms");
        advanceFrame(39);
        assertThat(displayedContents.join(","), eq("one"), "at 39ms");
        advanceFrame(40);
        assertThat(displayedContents.join(","), eq("one,two"), "at 40ms");
        advanceFrame(80);
        assertThat(displayedContents.join(","), eq("one,two,three"), "at 80ms");
        controller.remove();
      },
    },
    {
      name: "KeepsKickVodPacingPhaseAtOnePointFiveSpeedOnSixtyHertz",
      execute: () => {
        // Prepare
        let scheduledFrames = new Array<FrameRequestCallback>();
        let currentFrameTime = 0;
        let playerWindow = {
          performance: { now: () => currentFrameTime },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        video.playbackRate = 1.5;
        let unreadChats = Array.from({ length: 30 }, (_, index) => ({
          content: String(index),
        }));
        let displayFrameTimes = new Array<number>();
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (chatEntries: Array<ChatEntry>) => {
              if (chatEntries.length > 0) {
                displayFrameTimes.push(currentFrameTime);
              }
            },
            setPlaybackRate: () => {},
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              let chats = unreadChats;
              unreadChats = [];
              return chats;
            },
          } as never,
          {} as never,
          undefined,
          true,
          { intervalMs: 80, maxPendingChats: 30 },
        );
        video.dispatchEvent(new Event("playing"));

        // Execute: advance at real 60Hz frame boundaries.
        for (
          let frame = 1;
          frame <= 180 && displayFrameTimes.length < 30;
          frame++
        ) {
          currentFrameTime = (frame * 1000) / 60;
          scheduledFrames.shift()(currentFrameTime);
        }

        // Verify: 29 gaps x 80ms media time is 2320ms. Allow one frame of
        // quantization, but not cumulative frame rounding on every message.
        let elapsedMediaTime =
          displayFrameTimes[displayFrameTimes.length - 1] * video.playbackRate;
        assertThat(displayFrameTimes.length, eq(30), "displayed message count");
        assertThat(elapsedMediaTime, gt(2319), "minimum elapsed media time");
        assertThat(elapsedMediaTime, lt(2346), "maximum elapsed media time");
        controller.remove();
      },
    },
    {
      name: "DisplaysAllDueKickVodChatsInOneFrame",
      execute: () => {
        // Prepare: Bilibili-style VOD scheduling is driven by media time. Chats
        // that share a timestamp are all due in the same frame, not a FIFO.
        let scheduledFrames = new Array<FrameRequestCallback>();
        let playerWindow = {
          performance: { now: () => 0 },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          get: () => 600,
        });
        let displayedContents = new Array<string>();
        let observedCanvasTimestamp = -1;
        let unreadChats = [
          { content: "one", timestamp: 600000 },
          { content: "two", timestamp: 600000 },
          { content: "three", timestamp: 600000 },
          { content: "fallback four" },
          { content: "fallback five" },
        ];
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (
              chatEntries: Array<ChatEntry>,
              currentTimestamp?: number,
            ) => {
              observedCanvasTimestamp = currentTimestamp ?? -1;
              displayedContents.push(
                ...chatEntries.map((chatEntry) => chatEntry.content),
              );
            },
            setPlaybackRate: () => {},
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              let chats = unreadChats;
              unreadChats = [];
              return chats;
            },
          } as never,
          {} as never,
          undefined,
          true,
          { intervalMs: 80, maxPendingChats: 30 },
          true,
        );

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify: all timestamped chats are handed to the lane engine now. The
        // lane engine may drop collisions, but the scheduler must not delay them.
        assertThat(
          displayedContents.join(","),
          eq("one,two,three,fallback four,fallback five"),
          "same-frame due chats",
        );
        assertThat(
          observedCanvasTimestamp,
          eq(600000),
          "canvas media timestamp",
        );
        controller.remove();
      },
    },
    {
      name: "RephasesPendingKickVodChatsWhenPlaybackRateChanges",
      execute: () => {
        // Prepare
        let scheduledFrames = new Array<FrameRequestCallback>();
        let currentFrameTime = 0;
        let playerWindow = {
          performance: { now: () => currentFrameTime },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        let unreadChats = [
          { content: "one" },
          { content: "two" },
          { content: "three" },
        ];
        let displayedContents = new Array<string>();
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (chatEntries: Array<ChatEntry>) =>
              displayedContents.push(
                ...chatEntries.map((chatEntry) => chatEntry.content),
              ),
            setPlaybackRate: () => {},
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              let chats = unreadChats;
              unreadChats = [];
              return chats;
            },
          } as never,
          {} as never,
          undefined,
          true,
          { intervalMs: 80, maxPendingChats: 30 },
        );
        video.dispatchEvent(new Event("playing"));
        assertThat(displayedContents.join(","), eq("one"), "initial message");

        // Execute: after 20ms of an 80ms interval, switch from 1x to 2x.
        currentFrameTime = 20;
        video.playbackRate = 2;
        video.dispatchEvent(new Event("ratechange"));
        currentFrameTime = 49;
        scheduledFrames.shift()(49);
        currentFrameTime = 50;
        scheduledFrames.shift()(50);

        // Verify: 60ms media time remained, which is 30ms at 2x.
        assertThat(
          displayedContents.join(","),
          eq("one,two"),
          "rephased queue",
        );
        controller.remove();
      },
    },
    {
      name: "PreservesKickVodChatCursorAcrossPauseAndResume",
      execute: () => {
        // Prepare
        let scheduledFrames = new Array<FrameRequestCallback>();
        let currentFrameTime = 0;
        let playerWindow = {
          performance: { now: () => currentFrameTime },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {
            scheduledFrames = [];
          },
        } as unknown as Window;
        let video = document.createElement("video");
        let unreadChats = [
          { content: "one" },
          { content: "two" },
          { content: "three" },
        ];
        let displayedContents = new Array<string>();
        let poolStartCount = 0;
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (chatEntries: Array<ChatEntry>) =>
              displayedContents.push(
                ...chatEntries.map((chatEntry) => chatEntry.content),
              ),
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => poolStartCount++,
            read: (): Array<ChatEntry> => {
              let chat = unreadChats.shift();
              return chat ? [chat] : [];
            },
          } as never,
          {} as never,
          undefined,
          false,
          { intervalMs: 80, maxPendingChats: 30 },
          true,
        );
        video.dispatchEvent(new Event("playing"));
        assertThat(displayedContents.join(","), eq("one"), "before pause");

        // Execute
        video.dispatchEvent(new Event("pause"));
        currentFrameTime = 1000;
        video.dispatchEvent(new Event("playing"));

        // Verify: resume immediately continues the existing media-time reader
        // without establishing a new DOM cursor.
        assertThat(displayedContents.join(","), eq("one,two"), "after resume");
        assertThat(poolStartCount, eq(1), "chat pool start count");
        currentFrameTime = 1080;
        scheduledFrames.shift()(1080);
        assertThat(
          displayedContents.join(","),
          eq("one,two,three"),
          "after resumed reading",
        );
        controller.remove();
      },
    },
    {
      name: "PausesKickVodDanmakuWhileVideoIsBuffering",
      execute: () => {
        // Prepare
        let scheduledFrames = new Array<FrameRequestCallback>();
        let canvasPlayCount = 0;
        let canvasPauseCount = 0;
        let chatReadCount = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {
            scheduledFrames = [];
          },
        } as unknown as Window;
        let video = document.createElement("video");
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            setPlaybackRate: () => {},
            play: () => canvasPlayCount++,
            pause: () => canvasPauseCount++,
            clear: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              chatReadCount++;
              return [];
            },
          } as never,
          {} as never,
          undefined,
          true,
          { intervalMs: 80, maxPendingChats: 30 },
          true,
        );
        video.dispatchEvent(new Event("playing"));

        // Execute: waiting means currentTime is no longer advancing even
        // though video.paused can remain false.
        video.dispatchEvent(new Event("waiting"));

        // Verify
        assertThat(canvasPauseCount, eq(1), "canvas pause while buffering");
        assertThat(scheduledFrames.length, eq(0), "chat frames while buffering");
        let readsWhileWaiting = chatReadCount;

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(canvasPlayCount, eq(2), "canvas resumes after buffering");
        assertThat(
          chatReadCount,
          eq(readsWhileWaiting + 1),
          "chat loop resumes after buffering",
        );
        controller.remove();
      },
    },
    {
      name: "DoesNotRunDelayedKickVodPlayWhileWaiting",
      execute: () => {
        // Prepare: construction sees a playing video and schedules a zero-ms
        // start, but buffering begins before that task runs.
        let delayedPlay: (() => void) | undefined;
        let scheduledFrames = new Array<FrameRequestCallback>();
        let poolStartCount = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          setTimeout: (handler: TimerHandler) => {
            delayedPlay = handler as () => void;
            return 1;
          },
          clearTimeout: () => {},
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {
            scheduledFrames = [];
          },
        } as unknown as Window;
        let video = document.createElement("video");
        Object.defineProperty(video, "paused", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "seeking", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 4,
        });
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            clear: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            fill: () => {},
            clear: () => {},
            start: () => poolStartCount++,
            read: () => [],
          },
          {} as never,
          undefined,
          false,
          undefined,
          true,
        );

        // Execute
        video.dispatchEvent(new Event("waiting"));
        delayedPlay?.();

        // Verify
        assertThat(poolStartCount, eq(0), "baselines while waiting");
        assertThat(scheduledFrames.length, eq(0), "frames while waiting");

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(poolStartCount, eq(1), "baseline after real playing");
        assertThat(scheduledFrames.length, eq(1), "frame after real playing");
        controller.remove();
      },
    },
    {
      name: "DoesNotRunDelayedKickVodPlayAfterSourceEmpties",
      execute: () => {
        // Prepare: route/source replacement can empty a reused video before
        // the constructor's delayed play task executes.
        let delayedPlay: (() => void) | undefined;
        let scheduledFrames = new Array<FrameRequestCallback>();
        let poolStartTimestamps = new Array<number>();
        let playerWindow = {
          performance: { now: () => 0 },
          setTimeout: (handler: TimerHandler) => {
            delayedPlay = handler as () => void;
            return 1;
          },
          clearTimeout: () => {},
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {
            scheduledFrames = [];
          },
        } as unknown as Window;
        let video = document.createElement("video");
        Object.defineProperty(video, "paused", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "seeking", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 4,
        });
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          writable: true,
          value: 7200,
        });
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            clear: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            fill: () => {},
            clear: () => {},
            start: (timestamp: number) => poolStartTimestamps.push(timestamp),
            read: () => [],
          },
          {} as never,
          undefined,
          false,
          undefined,
          true,
        );

        // Execute
        video.dispatchEvent(new Event("emptied"));
        delayedPlay?.();
        (video as any).currentTime = 0;

        // Verify
        assertThat(poolStartTimestamps.length, eq(0), "old source baselines");
        assertThat(scheduledFrames.length, eq(0), "old source frames");

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(poolStartTimestamps.length, eq(1), "new source baseline count");
        assertThat(poolStartTimestamps[0], eq(0), "new source baseline timestamp");
        assertThat(scheduledFrames.length, eq(1), "new source animation frame");
        controller.remove();
      },
    },
    {
      name: "KeepsOneChatAnimationLoopAndStopsItOnRemoval",
      execute: () => {
        // Prepare
        let scheduledFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            let frameId = ++nextFrameId;
            scheduledFrames.set(frameId, callback);
            return frameId;
          },
          cancelAnimationFrame: (frameId: number) => {
            scheduledFrames.delete(frameId);
          },
        } as unknown as Window;
        let video = document.createElement("video");
        let readCount = 0;
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              readCount++;
              return [];
            },
          } as never,
          {} as never,
        );

        // Execute: browsers can deliver duplicate playing events while the
        // fullscreen player is being reconfigured.
        video.dispatchEvent(new Event("playing"));
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(scheduledFrames.size, eq(1), "active animation loops");
        let pendingCallback = Array.from(scheduledFrames.values())[0];

        // Execute
        controller.remove();
        let readCountAfterRemoval = readCount;
        pendingCallback(16);

        // Verify
        assertThat(scheduledFrames.size, eq(0), "frames after removal");
        assertThat(readCount, eq(readCountAfterRemoval), "reads after removal");
      },
    },
    {
      name: "ResumesKickVodAfterCachedSeekWithoutPlayingEvent",
      execute: () => {
        // Prepare: the media spec permits seeking -> seeked without another
        // playing event when the destination is already buffered.
        let scheduledFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          setTimeout: () => 1,
          clearTimeout: () => {},
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            let frameId = ++nextFrameId;
            scheduledFrames.set(frameId, callback);
            return frameId;
          },
          cancelAnimationFrame: (frameId: number) => {
            scheduledFrames.delete(frameId);
          },
        } as unknown as Window;
        let video = document.createElement("video");
        Object.defineProperty(video, "paused", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "seeking", {
          configurable: true,
          writable: true,
          value: false,
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 4,
        });
        let poolStartCount = 0;
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            clear: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            fill: () => {},
            clear: () => {},
            start: () => poolStartCount++,
            read: () => [],
          },
          {} as never,
          undefined,
          false,
          undefined,
          true,
        );
        video.dispatchEvent(new Event("playing"));

        // Execute
        (video as any).seeking = true;
        video.dispatchEvent(new Event("seeking"));
        (video as any).seeking = false;
        video.dispatchEvent(new Event("seeked"));

        // Verify
        assertThat(poolStartCount, eq(2), "cached-seek chat baseline count");
        assertThat(scheduledFrames.size, eq(1), "cached-seek animation loop");
        controller.remove();
      },
    },
    {
      name: "RebaselinesKickVodChatOnSeek",
      execute: () => {
        // Prepare
        let scheduledFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            let frameId = ++nextFrameId;
            scheduledFrames.set(frameId, callback);
            return frameId;
          },
          cancelAnimationFrame: (frameId: number) => {
            scheduledFrames.delete(frameId);
          },
        } as unknown as Window;
        let video = document.createElement("video");
        let poolStartCount = 0;
        let poolClearCount = 0;
        let canvasClearCount = 0;
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            clear: () => canvasClearCount++,
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            fill: () => {},
            clear: () => poolClearCount++,
            start: () => poolStartCount++,
            read: () => [],
          },
          {} as never,
          undefined,
          false,
          undefined,
          true,
        );
        Object.defineProperty(video, "seeking", {
          configurable: true,
          writable: true,
          value: false,
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          value: 4,
        });
        video.dispatchEvent(new Event("playing"));
        assertThat(poolStartCount, eq(1), "initial chat baseline count");

        // Execute
        (video as any).seeking = true;
        video.dispatchEvent(new Event("seeking"));

        // Verify
        assertThat(poolClearCount, eq(1), "chat pool reset on seek");
        assertThat(canvasClearCount, eq(1), "danmaku clear on seek");
        assertThat(
          scheduledFrames.size,
          eq(0),
          "animation loops while seeking",
        );

        // Execute: some media implementations emit playing before seeked.
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(poolStartCount, eq(1), "baselines while still seeking");
        assertThat(scheduledFrames.size, eq(0), "loops while still seeking");

        // Execute: buffering can remain active after seeked. Do not restart
        // media-time motion until the browser emits a real playing event.
        video.dispatchEvent(new Event("waiting"));
        (video as any).seeking = false;
        video.dispatchEvent(new Event("seeked"));

        // Verify
        assertThat(poolStartCount, eq(1), "baselines while buffering after seek");
        assertThat(scheduledFrames.size, eq(0), "loops while buffering after seek");

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(poolStartCount, eq(2), "chat baseline after playing");
        assertThat(scheduledFrames.size, eq(1), "animation loop after playing");
        controller.remove();
      },
    },
    {
      name: "RebaselinesKickVodWhenReusedVideoLoadsANewSource",
      execute: () => {
        // Prepare: Kick can update the VOD route before React replaces the
        // underlying media source, while keeping the same <video> element.
        let scheduledFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 0;
        let playerWindow = {
          performance: { now: () => 0 },
          setTimeout: () => 1,
          clearTimeout: () => {},
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            let frameId = ++nextFrameId;
            scheduledFrames.set(frameId, callback);
            return frameId;
          },
          cancelAnimationFrame: (frameId: number) => {
            scheduledFrames.delete(frameId);
          },
        } as unknown as Window;
        let video = document.createElement("video");
        Object.defineProperty(video, "paused", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(video, "seeking", {
          configurable: true,
          writable: true,
          value: false,
        });
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          writable: true,
          value: 7200,
        });
        let poolStartTimestamps = new Array<number>();
        let poolClearCount = 0;
        let canvasClearCount = 0;
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: () => {},
            play: () => {},
            pause: () => {},
            clear: () => canvasClearCount++,
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            fill: () => {},
            clear: () => poolClearCount++,
            start: (timestamp: number) => poolStartTimestamps.push(timestamp),
            read: () => [],
          },
          {} as never,
          undefined,
          false,
          undefined,
          true,
        );
        video.dispatchEvent(new Event("playing"));

        // Execute: the same element empties and then starts the new VOD at 0.
        video.dispatchEvent(new Event("emptied"));
        (video as any).currentTime = 0;

        // Verify: nothing from the old timeline can keep running while empty.
        assertThat(poolClearCount, eq(1), "chat pool reset on source change");
        assertThat(canvasClearCount, eq(1), "danmaku clear on source change");
        assertThat(scheduledFrames.size, eq(0), "loops while source is empty");

        // Execute
        video.dispatchEvent(new Event("playing"));

        // Verify
        assertThat(poolStartTimestamps.length, eq(2), "VOD baseline count");
        assertThat(poolStartTimestamps[0], eq(7200000), "old VOD baseline");
        assertThat(poolStartTimestamps[1], eq(0), "new VOD baseline");
        assertThat(scheduledFrames.size, eq(1), "new VOD animation loop");
        controller.remove();
      },
    },
    {
      name: "KeepsTheNewestKickChatsWhenThePacingQueueOverflows",
      execute: () => {
        // Prepare
        let scheduledFrames = new Array<FrameRequestCallback>();
        let playerWindow = {
          performance: { now: () => 0 },
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            scheduledFrames.push(callback);
            return scheduledFrames.length;
          },
          cancelAnimationFrame: () => {},
        } as unknown as Window;
        let video = document.createElement("video");
        let displayedContents = new Array<string>();
        let unreadChats = Array.from({ length: 31 }, (_, index) => ({
          content: String(index + 1),
        }));
        let controller = new PlayerController(
          playerWindow,
          {} as WebServiceClient,
          video,
          {
            add: (chatEntries: Array<ChatEntry>) =>
              displayedContents.push(
                ...chatEntries.map((chatEntry) => chatEntry.content),
              ),
            play: () => {},
            pause: () => {},
            remove: () => {},
          } as unknown as DanmakuCanvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            addChats: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {
            start: () => {},
            read: (): Array<ChatEntry> => {
              let chats = unreadChats;
              unreadChats = [];
              return chats;
            },
          } as never,
          {} as never,
          undefined,
          false,
          { intervalMs: 80, maxPendingChats: 30 },
        );

        // Execute
        video.dispatchEvent(new Event("playing"));
        scheduledFrames.shift()(80);

        // Verify: message 1 is the single dropped stale item; retained chats
        // continue in their original order.
        assertThat(
          displayedContents.join(","),
          eq("2,3"),
          "displayed overflow order",
        );
        controller.remove();
      },
    },
    {
      name: "SyncsKickPlaybackRateAndStopsListeningOnRemoval",
      execute: () => {
        // Prepare
        let observedPlaybackRates = new Array<number>();
        let video = document.createElement("video");
        let canvasController = {
          setPlaybackRate: (playbackRate: number) =>
            observedPlaybackRates.push(playbackRate),
          pause: () => {},
          remove: () => {},
        } as unknown as DanmakuCanvasController;
        let controller = new PlayerController(
          window,
          {} as WebServiceClient,
          video,
          canvasController,
          { updateDisplaySettings: () => {}, remove: () => {} } as never,
          {
            on: () => {},
            clearChats: () => {},
            remove: () => {},
          } as never,
          { start: () => {}, stop: () => {} } as never,
          {} as never,
          {} as never,
          undefined,
          true,
        );

        // Execute
        video.playbackRate = 2;
        video.dispatchEvent(new Event("ratechange"));

        // Verify
        assertThat(observedPlaybackRates[0], eq(1), "initial playback rate");
        assertThat(
          observedPlaybackRates[observedPlaybackRates.length - 1],
          eq(2),
          "updated playback rate",
        );

        // Execute
        controller.remove();
        let updateCountAfterRemoval = observedPlaybackRates.length;
        video.playbackRate = 3;
        video.dispatchEvent(new Event("ratechange"));

        // Verify
        assertThat(
          observedPlaybackRates.length,
          eq(updateCountAfterRemoval),
          "updates after removal",
        );
      },
    },
    {
      name: "DetectsOnlyKickVodRoutes",
      execute: () => {
        let route = parseKickVodRoute(
          "/quin3614/videos/01a00571-2400-76c5-993d-3a5934f38e26",
        );
        assertThat(route?.channelSlug, eq("quin3614"), "Kick channel slug");
        assertThat(
          route?.vodId,
          eq("01a00571-2400-76c5-993d-3a5934f38e26"),
          "Kick VOD id",
        );
        assertThat(
          isKickVodPath(
            "/quin3614/videos/01a00571-2400-76c5-993d-3a5934f38e26",
          ),
          eq(true),
          "Kick VOD route",
        );
        assertThat(isKickVodPath("/quin3614"), eq(false), "Kick live route");
        assertThat(
          isKickVodPath("/quin3614/videos"),
          eq(false),
          "Kick videos listing route",
        );
      },
    },
    {
      name: "UsesTheKickFullscreenElementAsTheDanmakuSurface",
      execute: () => {
        // Prepare
        let oldCanvas = document.createElement("div");
        let levelOne = document.createElement("div");
        let levelTwo = document.createElement("div");
        let embeddedPlayer = document.createElement("div");
        embeddedPlayer.id = "injected-embedded-channel-player-video";
        let fullscreenElement = document.createElement("div");
        let video = document.createElement("video");
        fullscreenElement.append(video);
        embeddedPlayer.append(fullscreenElement);
        levelTwo.append(embeddedPlayer);
        levelOne.append(levelTwo);
        oldCanvas.append(levelOne);
        let chatroom = document.createElement("div");
        chatroom.id = "chatroom-messages";
        let chatContainer = document.createElement("div");
        chatroom.append(chatContainer);
        document.body.append(oldCanvas, chatroom);
        let assembler = new KickAssembler({});

        // Execute
        let elements = assembler.queryElements();

        // Verify
        assertThat(elements[0], eq(fullscreenElement), "danmaku surface");
        assertThat(elements[1], eq(video), "Kick video");
        assertThat(elements[2], eq(chatContainer), "Kick chat container");
        let canvas = createKickDanmakuCanvas(fullscreenElement);
        assertThat(
          canvas.parentElement,
          eq(fullscreenElement),
          "canvas parent",
        );
        assertThat(
          video.nextElementSibling,
          eq(null),
          "video sibling before controls mount",
        );
        let controls = document.createElement("div");
        fullscreenElement.append(controls);
        assertThat(
          video.nextElementSibling,
          eq(controls),
          "video sibling after controls mount",
        );
        assertThat(canvas.style.position, eq("absolute"), "canvas position");
        assertThat(canvas.style.top, eq("0px"), "canvas top");
        assertThat(canvas.style.left, eq("0px"), "canvas left");
        assertThat(canvas.style.width, eq("100%"), "canvas width");
        assertThat(canvas.style.height, eq("30%"), "canvas height");
        assertThat(canvas.style.overflow, eq("hidden"), "canvas clipping");
        assertThat(
          canvas.style.pointerEvents,
          eq("none"),
          "canvas pointer events",
        );
        canvas.remove();
        oldCanvas.remove();
        chatroom.remove();
      },
    },
    {
      name: "RefreshesKickStructureOnTheNextFrameAfterDomChanges",
      execute: async () => {
        // Prepare
        let mutationTarget = document.createElement("div");
        document.body.append(mutationTarget);
        let requiredElement = document.createElement("div");
        let queryCount = 0;
        let assembleCount = 0;
        let healthy = true;
        let assembler: Assembler = {
          queryElements: () => {
            queryCount++;
            return [requiredElement];
          },
          assemble: () => {
            assembleCount++;
            healthy = true;
          },
          remove: () => {},
          isHealthy: () => healthy,
        };
        let refresher = new Refresher(assembler, window, {
          mutationTarget,
          fallbackIntervalMs: 5000,
          ignoredMutationClassNames: ["danmaku-element"],
        });
        assertThat(queryCount, eq(1), "initial query count");
        assertThat(assembleCount, eq(1), "initial assemble count");

        // Execute
        let ownDanmaku = document.createElement("span");
        ownDanmaku.className = "danmaku-element";
        mutationTarget.append(ownDanmaku);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Verify
        assertThat(queryCount, eq(1), "ignored own-danmaku query count");

        // Execute
        mutationTarget.append(document.createElement("span"));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Verify
        assertThat(queryCount, eq(2), "event-driven query count");
        assertThat(assembleCount, eq(1), "unchanged assemble count");

        // Execute
        healthy = false;
        mutationTarget.append(document.createElement("span"));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Verify
        assertThat(queryCount, eq(3), "unhealthy query count");
        assertThat(assembleCount, eq(2), "unhealthy reassemble count");
        refresher.remove();
        let queryCountAfterRemoval = queryCount;
        mutationTarget.append(document.createElement("span"));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        assertThat(
          queryCount,
          eq(queryCountAfterRemoval),
          "queries after refresher removal",
        );
        mutationTarget.remove();
      },
    },
    {
      name: "RefreshesKickVodWhenPathnameChangesWithoutDomMutations",
      execute: async () => {
        // Prepare: Kick can reuse the complete player DOM while pushState moves
        // from one VOD to another.
        let routeKey = "/channel/videos/first";
        let assembledRouteKey = "";
        let queryCount = 0;
        let assembleCount = 0;
        let requiredElement = document.createElement("div");
        let assembler: Assembler = {
          queryElements: () => {
            queryCount++;
            return [requiredElement];
          },
          assemble: () => {
            assembleCount++;
            assembledRouteKey = routeKey;
          },
          remove: () => {},
          isHealthy: () => assembledRouteKey === routeKey,
        };
        let refresher = new Refresher(assembler, window, {
          fallbackIntervalMs: 5000,
          routeKey: () => routeKey,
          routeCheckIntervalMs: 5,
        });

        // Execute
        routeKey = "/channel/videos/second";
        await new Promise<void>((resolve) => setTimeout(resolve, 20));

        // Verify
        assertThat(queryCount, eq(2), "route-change query count");
        assertThat(assembleCount, eq(2), "route-change assemble count");
        refresher.remove();
      },
    },
  ],
});
