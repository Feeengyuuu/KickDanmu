import { ChatEntry } from "../../../../interface/chat_entry";
import { OnPageChatPool, VirtualizedChatMode } from "../chat_pool";
import { KickChatContentBuilder } from "../common/chat_content_builder";
import { MockBlockPatternTester } from "../common/mocks";
import { Assembler, Refresher } from "../refresher";
import { fetchKickVodMetadata, KickApiRequester } from "./kick_api";
import {
  createKickChatPool,
  findKickControlAnchor,
  KickAssembler,
} from "./kick_assembler";
import { KickLiveApiChatPool } from "./kick_live_api_chat_pool";
import { KickLiveDomChatPool } from "./kick_live_dom_chat_pool";
import { parseKickLiveRoute, parseKickVodRoute } from "./kick_routes";
import { KickVodApiChatPool } from "./kick_vod_chat_pool";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray } from "@selfage/test_matcher";

// Live chat rows captured from kick.com on 2026-10-17 (badge SVG paths and
// image URLs shortened).
let LIVE_ROW =
  '<div class="group relative px-2 lg:px-3"><div class="w-full min-w-0 shrink-0 rounded-lg px-2 break-words" style="font-size: var(--chatroom-font-size); padding-block: var(--chatroom-message-spacing);"><div class="inline-flex max-w-full flex-nowrap items-baseline"><span class="text-neutral pr-1 font-semibold whitespace-nowrap">10:06</span><div class="inline-flex min-w-0 flex-nowrap items-baseline rounded cursor-pointer transition-colors duration-150 ease-out"><div class="flex items-center gap-1 self-center pr-1"><div class="inline-flex shrink-0 items-center size-[calc(1em*(18/13))] justify-center"><svg data-ds-icon="Level64" width="20" height="20" viewBox="0 0 20 20" role="img" aria-labelledby="_r_62_"><title id="_r_62_">Level 64</title><path d="M0 0h20v20H0z"></path></svg></div></div><button class="inline font-bold truncate" title="Marcussilva07" data-prevent-expand="true" style="color: rgb(255, 216, 153);">Marcussilva07</button></div><span class="inline-flex font-bold" aria-hidden="true">:&nbsp;</span></div><span class="leading-[1.55] font-normal">no hltv alterou pra 14:20</span></div></div>';
let REPLY_ROW =
  '<div class="group relative px-2 lg:px-3"><div type="button" aria-haspopup="dialog" aria-expanded="false" data-state="closed"><div class="flex w-full min-w-0 shrink-0 flex-col rounded-lg px-2 py-1 wrap-break-word" style="font-size: var(--chatroom-font-size);"><button class="w-full min-w-0 shrink-0 truncate text-left text-xs font-medium text-white/40 cursor-pointer"><svg><path d="M0 0"></path></svg><span class="ml-1">Replying to <span>Carvalhoofe</span>: <span class="inline">que horas comeca?</span></span></button><div class="w-full min-w-0 shrink-0 wrap-break-word"><div class="inline-flex max-w-full flex-nowrap items-baseline"><span class="text-neutral pr-1 font-semibold whitespace-nowrap">10:06</span><div class="inline-flex min-w-0 flex-nowrap items-baseline rounded cursor-pointer transition-colors duration-150 ease-out"><div class="flex items-center gap-1 self-center pr-1"><div class="inline-flex shrink-0 items-center size-[calc(1em*(18/13))]"><img width="72" alt="Flyby" class="size-[calc(1em*(18/13))]" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></div><button class="inline font-bold truncate" title="BlPOLAR" data-prevent-expand="true" style="color: rgb(255, 166, 0);">BlPOLAR</button></div><span class="inline-flex font-bold" aria-hidden="true">:&nbsp;</span></div><span class="leading-[1.55] font-normal">14h20 by hltv <button class="mention">@Carvalhoofe</button></span></div></div></div></div>';

function textOf(html: string): string {
  let template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent.replace(/\s+/g, " ").trim();
}

function renderedRoot(html: string): DocumentFragment {
  let template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function jsonResponse(body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { headers });
}

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

class PassingBlockPatternTester extends MockBlockPatternTester {
  public test(): boolean {
    return false;
  }
}

TEST_RUNNER.run({
  name: "KickAdapterTests",
  cases: [
    {
      name: "ExtractsOnlyTheMessageTextForBlockRules",
      execute: () => {
        let builder = new KickChatContentBuilder();

        // Execute
        let live = textOf(builder.extractContent(LIVE_ROW));
        let reply = textOf(builder.extractContent(REPLY_ROW));

        // Verify: no wall-clock label, badge tooltip, author or reply quote.
        assertThat(live, eq("no hltv alterou pra 14:20"), "live row text");
        assertThat(reply, eq("14h20 by hltv @Carvalhoofe"), "reply row text");
      },
    },
    {
      name: "RendersRepliesAsASingleLineWithoutTheQuotedParent",
      execute: () => {
        let builder = new KickChatContentBuilder();

        // Execute
        let withName = renderedRoot(
          builder.build(
            { content: REPLY_ROW },
            { fontSize: 30, showUserName: true },
          ),
        );
        let withoutName = renderedRoot(
          builder.build(
            { content: REPLY_ROW },
            { fontSize: 30, showUserName: false },
          ),
        );

        // Verify
        assertThat(
          withName.textContent.replace(/\s+/g, " ").trim(),
          eq("BlPOLAR: 14h20 by hltv @Carvalhoofe"),
          "reply with author",
        );
        assertThat(
          withoutName.textContent.replace(/\s+/g, " ").trim(),
          eq("14h20 by hltv @Carvalhoofe"),
          "reply without author",
        );
        assertThat(
          withName.querySelector("button.mention") !== null,
          eq(true),
          "mention inside the message is kept",
        );
        let rowWrapper = withName.querySelector(
          '[aria-haspopup="dialog"] > div',
        ) as HTMLElement;
        assertThat(rowWrapper.style.fontSize, eq("30px"), "wrapper font size");
      },
    },
    {
      name: "DropsBadgeTooltipsButKeepsBadges",
      execute: () => {
        // Execute
        let root = renderedRoot(
          new KickChatContentBuilder().build(
            { content: LIVE_ROW },
            { fontSize: 24, showUserName: true },
          ),
        );

        // Verify
        assertThat(root.querySelectorAll("svg").length, eq(1), "badge svg");
        assertThat(root.querySelectorAll("title").length, eq(0), "tooltips");
        assertThat(
          root.textContent.replace(/\s+/g, " ").trim(),
          eq("Marcussilva07: no hltv alterou pra 14:20"),
          "visible text",
        );
      },
    },
    {
      name: "AnchorsTheSettingsButtonToStableControlTestIds",
      execute: () => {
        // Prepare: video, then Kick's overlay with a left and right group.
        let surface = document.createElement("div");
        let video = document.createElement("video");
        let overlay = document.createElement("div");
        let topRow = document.createElement("div");
        let controlBar = document.createElement("div");
        let play = document.createElement("button");
        let pip = document.createElement("button");
        pip.setAttribute("data-testid", "video-player-pip");
        let fullscreen = document.createElement("button");
        fullscreen.setAttribute("data-testid", "video-player-fullscreen");
        controlBar.append(play, pip, fullscreen);
        overlay.append(topRow, controlBar);
        surface.append(video, overlay);

        // Execute & verify
        assertThat(
          findKickControlAnchor(surface, video),
          eq(pip),
          "first right-hand control",
        );
        pip.remove();
        assertThat(
          findKickControlAnchor(surface, video),
          eq(fullscreen),
          "next stable control",
        );
        fullscreen.remove();
        assertThat(
          findKickControlAnchor(surface, video),
          eq(play),
          "legacy structural fallback",
        );
        assertThat(
          findKickControlAnchor(undefined, video),
          eq(null),
          "no surface",
        );
      },
    },
    {
      name: "ParsesKickLiveAndVodRoutes",
      execute: () => {
        assertThat(
          parseKickLiveRoute("/gaules")?.channelSlug,
          eq("gaules"),
          "live channel",
        );
        assertThat(
          parseKickLiveRoute("/gaules/")?.channelSlug,
          eq("gaules"),
          "trailing slash",
        );
        assertThat(parseKickLiveRoute("/"), eq(undefined), "front page");
        assertThat(parseKickLiveRoute("/browse"), eq(undefined), "browse");
        assertThat(
          parseKickLiveRoute("/Following"),
          eq(undefined),
          "reserved paths are case-insensitive",
        );
        assertThat(
          parseKickLiveRoute("/gaules/videos/abc"),
          eq(undefined),
          "VOD is not live",
        );
        assertThat(
          parseKickVodRoute("/gaules/videos/abc")?.vodId,
          eq("abc"),
          "VOD id",
        );
        assertThat(
          parseKickVodRoute("/%E0%A4%A/videos/abc"),
          eq(undefined),
          "malformed encoding",
        );
      },
    },
    {
      name: "LoadsVodMetadataFromTheSingleVideoEndpoint",
      execute: async () => {
        // Prepare: the listing only has the newest 30 VODs, so an older VOD
        // must be resolved through the single-video endpoint.
        let requested = new Array<string>();
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          requested.push(url.pathname);
          if (url.pathname === "/api/v2/channels/gaules/info") {
            return jsonResponse({ id: 67262278 });
          }
          if (url.pathname === "/api/v1/channels/67262278/videos/old-vod") {
            return jsonResponse({
              data: {
                id: "old-vod",
                start_time: "2026-10-16T11:14:57Z",
                channel: { id: 67262278 },
              },
            });
          }
          return new Response("not found", { status: 404 });
        };

        // Execute
        let metadata = await fetchKickVodMetadata(
          new KickApiRequester(fetcher, window),
          "gaules",
          "old-vod",
          1000,
        );

        // Verify
        assertThat(metadata?.channelId, eq(67262278), "channel id");
        assertThat(
          metadata?.startTimestamp,
          eq(Date.parse("2026-10-16T11:14:57Z")),
          "start",
        );
        assertThat(
          requested,
          isArray([
            eq("/api/v2/channels/gaules/info"),
            eq("/api/v1/channels/67262278/videos/old-vod"),
          ]),
          "no listing request",
        );
      },
    },
    {
      name: "FallsBackToTheVodListingWhenTheSingleEndpointIsMissing",
      execute: async () => {
        // Prepare
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/gaules/info") {
            return jsonResponse({ id: 1 });
          }
          if (url.pathname === "/api/v1/channels/1/videos") {
            return jsonResponse({
              data: [{ id: "vod", start_time: "2026-10-16T00:00:00Z" }],
            });
          }
          return new Response("not found", { status: 404 });
        };

        // Execute
        let metadata = await fetchKickVodMetadata(
          new KickApiRequester(fetcher, window),
          "gaules",
          "vod",
          1000,
        );

        // Verify
        assertThat(metadata?.channelId, eq(1), "channel id from info");
        assertThat(
          metadata?.startTimestamp,
          eq(Date.parse("2026-10-16T00:00:00Z")),
          "start from listing",
        );
      },
    },
    {
      name: "PollsLiveHistoryAndReleasesOnlyNewMessagesInOrder",
      execute: async () => {
        // Prepare: the server clock is 30 seconds ahead of the local clock.
        let localNow = Date.parse("2026-10-17T17:00:00Z");
        let serverOffset = 30000;
        let historyCalls = 0;
        let messagesByBucket = new Map<number, Array<Record<string, unknown>>>();
        let message = (id: string, serverTime: number) => ({
          id,
          content: `chat ${id}`,
          created_at: new Date(serverTime).toISOString(),
          sender: { username: id },
        });
        let addMessage = (id: string, serverTime: number) => {
          let bucket = Math.floor(serverTime / 5000) * 5000;
          let list = messagesByBucket.get(bucket) ?? [];
          list.push(message(id, serverTime));
          messagesByBucket.set(bucket, list);
        };
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/gaules/info") {
            return jsonResponse(
              { id: 7 },
              { date: new Date(localNow + serverOffset).toUTCString() },
            );
          }
          if (url.pathname === "/api/v1/chat/7/history") {
            historyCalls++;
            let bucket = Date.parse(url.searchParams.get("start_time"));
            return jsonResponse({
              data: { messages: messagesByBucket.get(bucket) ?? [] },
            });
          }
          return new Response("not found", { status: 404 });
        };
        let serverNow = () => localNow + serverOffset;
        addMessage("old", serverNow() - 4000);
        let pool = new KickLiveApiChatPool(
          fetcher,
          "gaules",
          new PassingBlockPatternTester(),
          () => localNow,
        );

        // Execute: the first poll only establishes the history baseline.
        pool.start();
        assertThat(pool.read(), isArray([]), "nothing before the first poll");
        await flushAsync();
        let callsAfterFirstPoll = historyCalls;
        localNow += 1000;
        assertThat(pool.read(), isArray([]), "baseline is not replayed");
        assertThat(historyCalls, eq(callsAfterFirstPoll), "poll interval");

        addMessage("b", serverNow() - 500);
        addMessage("a", serverNow() - 1500);
        localNow += 3000;
        pool.read();
        await flushAsync();
        let beforeDelay = pool.read();
        localNow += 6000;
        let released = pool.read();
        await flushAsync();
        localNow += 10000;
        let afterDuplicatePolls = pool.read();
        await flushAsync();

        // Verify
        assertThat(beforeDelay, isArray([]), "held for the release delay");
        assertThat(
          released.map((chatEntry: ChatEntry) => chatEntry.id),
          isArray([eq("a"), eq("b")]),
          "new messages in created_at order",
        );
        assertThat(
          afterDuplicatePolls,
          isArray([]),
          "overlapping buckets are deduplicated",
        );
        assertThat(
          textOf(
            new KickChatContentBuilder().build(released[0], {
              showUserName: true,
              fontSize: 20,
            }),
          ),
          eq("a: chat a"),
          "rendered like a Kick row",
        );
        pool.clear();
      },
    },
    {
      name: "BacksOffAndRecoversWhenLiveHistoryFails",
      execute: async () => {
        // Prepare
        let localNow = 1_000_000;
        let failing = true;
        let historyCalls = 0;
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/gaules/info") {
            return jsonResponse({ id: 7 });
          }
          historyCalls++;
          return failing
            ? new Response("rate limited", { status: 429 })
            : jsonResponse({ data: { messages: [] } });
        };
        let pool = new KickLiveApiChatPool(
          fetcher,
          "gaules",
          new PassingBlockPatternTester(),
          () => localNow,
        );

        // Execute
        pool.start();
        pool.read();
        await flushAsync();
        let callsAfterFailure = historyCalls;
        localNow += 3000;
        pool.read();
        await flushAsync();
        let callsWithinBackoff = historyCalls;
        localNow += 3001;
        failing = false;
        pool.read();
        await flushAsync();
        let callsAfterBackoff = historyCalls;

        // Verify
        assertThat(callsAfterFailure > 0, eq(true), "first poll ran");
        assertThat(
          callsWithinBackoff,
          eq(callsAfterFailure),
          "no request before the doubled interval",
        );
        assertThat(
          callsAfterBackoff > callsWithinBackoff,
          eq(true),
          "retried after backoff",
        );
        pool.clear();
      },
    },
    {
      name: "IgnoresLiveHistoryResponsesAfterClear",
      execute: async () => {
        // Prepare
        let localNow = 1_000_000;
        let historyRequests = 0;
        let abortedRequests = 0;
        let fetcher = async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/gaules/info") {
            return jsonResponse({ id: 7 });
          }
          historyRequests++;
          // Never answers on its own, like a stalled connection.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              abortedRequests++;
              reject(new Error("aborted"));
            });
          });
        };
        let pool = new KickLiveApiChatPool(
          fetcher,
          "gaules",
          new PassingBlockPatternTester(),
          () => localNow,
        );
        pool.start();
        pool.read();
        await flushAsync();
        let requestsBeforeClear = historyRequests;

        // Execute
        pool.clear();
        await flushAsync();
        localNow += 100;
        pool.read();
        await flushAsync();

        // Verify
        assertThat(requestsBeforeClear, eq(3), "three buckets requested");
        assertThat(abortedRequests, eq(3), "clear aborted in-flight requests");
        assertThat(
          historyRequests,
          eq(6),
          "a new poll starts right after clear",
        );
        pool.clear();
      },
    },
    {
      name: "PicksTheKickChatSourceForEachPageKind",
      execute: () => {
        let tester = new PassingBlockPatternTester();
        let fetcher = async (): Promise<Response> => new Response("");
        let chatList = document.createElement("div");

        // Execute & verify
        assertThat(
          createKickChatPool({
            chatContainer: chatList,
            vodRoute: { channelSlug: "a", vodId: "b" },
            blockPatternTester: tester,
            fetcher,
          }) instanceof KickVodApiChatPool,
          eq(true),
          "VOD uses the history timeline",
        );
        assertThat(
          createKickChatPool({
            chatContainer: chatList,
            liveRoute: { channelSlug: "a" },
            blockPatternTester: tester,
            fetcher,
          }) instanceof KickLiveDomChatPool,
          eq(true),
          "live with a chat list reads the DOM",
        );
        assertThat(
          createKickChatPool({
            chatContainer: null,
            liveRoute: { channelSlug: "a" },
            blockPatternTester: tester,
            fetcher,
          }) instanceof KickLiveApiChatPool,
          eq(true),
          "live without a chat list polls the API",
        );
      },
    },
    {
      name: "KeepsReadingLiveChatAfterTheListIsFull",
      execute: () => {
        // Prepare: a full 300-message list renders its last rows at 296-299.
        let chatList = document.createElement("div");
        let rows = ["m1", "m2", "m3", "m4"];
        let render = () => {
          // Kick keys rows by message: existing nodes are kept and re-indexed,
          // new messages get new nodes at the end.
          let nodes = new Map<string, Element>();
          for (let child of Array.from(chatList.children)) {
            nodes.set(child.textContent, child);
          }
          let visible = rows.slice(-4);
          chatList.replaceChildren(
            ...visible.map((text, i) => {
              let node = nodes.get(text) ?? document.createElement("div");
              node.textContent = text;
              node.setAttribute("data-index", String(296 + i));
              return node;
            }),
          );
        };
        render();
        let pool = new KickLiveDomChatPool(
          chatList,
          new PassingBlockPatternTester(),
        );
        pool.start();

        // Execute
        rows.push("m5");
        render();
        let first = pool.read();
        rows.push("m6", "m7");
        render();
        let second = pool.read();
        let idle = pool.read();

        // Verify
        assertThat(
          first.map((chat) => chat.content),
          isArray([eq("m5")]),
          "first message after the cap",
        );
        assertThat(
          second.map((chat) => chat.content),
          isArray([eq("m6"), eq("m7")]),
          "batch after the cap, in order",
        );
        assertThat(idle, isArray([]), "nothing new");
      },
    },
    {
      name: "SkipsRemountedLiveRowsButKeepsNewOnes",
      execute: () => {
        // Prepare
        let chatList = document.createElement("div");
        chatList.innerHTML =
          '<div data-index="100">old one</div>' +
          '<div data-index="101">old two</div>';
        let pool = new KickLiveDomChatPool(
          chatList,
          new PassingBlockPatternTester(),
        );
        pool.start();

        // Execute: fullscreen remounts every row as a new node, reveals an
        // older row, and a new message arrives in the same commit.
        chatList.innerHTML =
          '<div data-index="99">older history</div>' +
          '<div data-index="100">old one</div>' +
          '<div data-index="101">old two</div>' +
          '<div data-index="102">new during remount</div>';
        let duringRemount = pool.read();
        chatList.insertAdjacentHTML(
          "beforeend",
          '<div data-index="103">new message</div>',
        );
        let fresh = pool.read();

        // Verify
        assertThat(
          duringRemount.map((chat) => chat.content),
          isArray([eq("new during remount")]),
          "only the new row",
        );
        assertThat(
          fresh.map((chat) => chat.content),
          isArray([eq("new message")]),
          "fresh message",
        );
      },
    },
    {
      name: "SkipsTheNewMessagesDividerRow",
      execute: () => {
        // Prepare
        let message = (index: number, author: string, text: string) =>
          `<div data-index="${index}"><div class="inline-flex min-w-0 flex-nowrap items-baseline rounded transition-colors"><button title="${author}">${author}</button></div><span>${text}</span></div>`;
        let chatList = document.createElement("div");
        chatList.innerHTML = message(0, "a", "old");
        let pool = new KickLiveDomChatPool(
          chatList,
          new PassingBlockPatternTester(),
        );
        pool.start();

        // Execute: divider captured from kick.com on 2026-10-17.
        chatList.insertAdjacentHTML(
          "beforeend",
          '<div data-index="1"><div class="flex w-full min-w-0 shrink-0 items-center gap-2"><div class="h-px grow"></div><div class="text-sm font-semibold">New messages</div><div class="h-px grow"></div></div></div>' +
            message(2, "b", "hello"),
        );
        let chats = pool.read();

        // Verify
        assertThat(chats.length, eq(1), "only the message");
        assertThat(textOf(chats[0].content), eq("bhello"), "message text");
      },
    },
    {
      name: "SkipsMessagesDeletedByAModerator",
      execute: () => {
        // Prepare: message bodies as rendered by kick.com on 2026-10-24.
        let message = (index: number, author: string, body: string) =>
          `<div data-index="${index}"><div class="inline-flex min-w-0 flex-nowrap items-baseline rounded transition-colors"><button title="${author}">${author}</button></div>${body}</div>`;
        let text = (value: string) =>
          `<span class="font-normal leading-[1.55]">${value}</span>`;
        let chatList = document.createElement("div");
        chatList.innerHTML = message(0, "a", text("old"));
        let pool = new KickLiveDomChatPool(
          chatList,
          new PassingBlockPatternTester(),
        );
        pool.start();

        // Execute: what viewers see, then what moderators see.
        chatList.insertAdjacentHTML(
          "beforeend",
          message(
            1,
            "b",
            '<span class="text-neutral leading-[1.55]"><span class="font-semibold" style="font-size: calc(var(--chatroom-font-size) - 2px);">Deleted by a moderator</span></span>',
          ) +
            message(
              2,
              "c",
              '<span class="text-neutral leading-[1.55]"><span class="line-through"><span>spam</span></span><span class="font-semibold"> (Deleted)</span></span>',
            ) +
            message(3, "d", text("hello")),
        );
        let chats = pool.read();

        // Verify
        assertThat(
          chats.map((chat) => textOf(chat.content)),
          isArray([eq("dhello")]),
          "only the kept message",
        );
      },
    },
    {
      name: "RebaselinesLiveChatWhenTheWholeListIsReplaced",
      execute: () => {
        // Prepare
        let chatList = document.createElement("div");
        chatList.innerHTML =
          '<div data-index="0">old one</div><div data-index="1">old two</div>';
        let pool = new KickLiveDomChatPool(
          chatList,
          new PassingBlockPatternTester(),
        );
        pool.start();

        // Execute: Kick clears the list, then refills it with other history
        // (e.g. after reconnecting) in a later frame.
        chatList.replaceChildren();
        let whileEmpty = pool.read();
        chatList.innerHTML =
          '<div data-index="0">reloaded one</div>' +
          '<div data-index="1">reloaded two</div>';
        let afterRefill = pool.read();
        chatList.insertAdjacentHTML(
          "beforeend",
          '<div data-index="2">new message</div>',
        );
        let fresh = pool.read();

        // Verify
        assertThat(whileEmpty, isArray([]), "while empty");
        assertThat(afterRefill, isArray([]), "refill is not replayed");
        assertThat(
          fresh.map((chat) => chat.content),
          isArray([eq("new message")]),
          "fresh message",
        );
      },
    },
    {
      name: "ToleratesAMissingChatListInTheDomPool",
      execute: () => {
        let pool = new OnPageChatPool(
          null,
          new PassingBlockPatternTester(),
          VirtualizedChatMode.VodMediaTimestamps,
        );

        // Execute & verify
        pool.start(1000);
        assertThat(pool.read(2000), isArray([]), "no chats");
        pool.clear();
      },
    },
    {
      name: "RefresherTreatsOptionalElementsAsStructure",
      execute: () => {
        // Prepare
        let required = document.createElement("div");
        let optional: Element | null = null;
        let assembleCount = 0;
        let removeCount = 0;
        let allowed = true;
        let assembler: Assembler = {
          queryElements: () => [required, optional],
          assemble: () => assembleCount++,
          remove: () => removeCount++,
          canAssemble: () => allowed,
        };

        // Execute
        let refresher = new Refresher(assembler, window, {
          optionalElementIndexes: [1],
          fallbackIntervalMs: 60000,
          mutationTarget: document.createElement("div"),
        });
        let assembledWithoutOptional = assembleCount;
        optional = document.createElement("div");
        (refresher as unknown as { refresh: () => void }).refresh();
        let assembledAfterOptionalAppears = assembleCount;
        allowed = false;
        (refresher as unknown as { refresh: () => void }).refresh();
        let assembledWhenNotAllowed = assembleCount;
        refresher.remove();

        // Verify
        assertThat(assembledWithoutOptional, eq(1), "optional may be null");
        assertThat(
          assembledAfterOptionalAppears,
          eq(2),
          "null to element reassembles",
        );
        assertThat(
          assembledWhenNotAllowed,
          eq(2),
          "canAssemble=false does not assemble",
        );
        assertThat(removeCount >= 2, eq(true), "removed when not allowed");
      },
    },
    {
      name: "KickAssemblerRequiresAChatSource",
      execute: () => {
        // Prepare: a featured player on the front page, without chat.
        let surface = document.createElement("div");
        let video = document.createElement("video");
        surface.append(video);
        document.body.append(surface);
        let pathname = "/";
        let assembler = new KickAssembler(
          {},
          { pathname } as Location,
          async () => new Response(""),
        );

        // Execute
        let frontPageElements = assembler.queryElements();
        let frontPage = assembler.canAssemble();
        pathname = "/gaules";
        assembler = new KickAssembler(
          {},
          { pathname } as Location,
          async () => new Response(""),
        );
        assembler.queryElements();
        let channelPage = assembler.canAssemble();

        // Verify
        assertThat(frontPageElements[1], eq(video), "video found");
        assertThat(frontPageElements[2], eq(null), "no chat list");
        assertThat(frontPage, eq(false), "front page rejected");
        assertThat(channelPage, eq(true), "channel page uses the API");
        surface.remove();
      },
    },
  ],
});
