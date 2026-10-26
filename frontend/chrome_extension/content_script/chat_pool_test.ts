import { ChatEntry } from "../../../interface/chat_entry";
import {
  OnPageChatPool,
  StructuredChatPool,
  VirtualizedChatMode,
} from "./chat_pool";
import { readKickVodTimestamp } from "./kick/kick_timestamp";
import { KickVodApiChatPool } from "./kick/kick_vod_chat_pool";
import { KickChatContentBuilder } from "./common/chat_content_builder";
import { MockBlockPatternTester } from "./common/mocks";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq, isArray, lt } from "@selfage/test_matcher";

TEST_RUNNER.run({
  name: "ChatPoolTests",
  cases: [
    {
      name: "FillAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(chatEntry: ChatEntry) {
            assertThat(chatEntry.timestamp, eq(10), "tested entry");
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10 };

        // Execute
        chatPool.fill([chatEntry]);
        let readed = chatPool.read(20);

        // Verify
        assertThat(readed, isArray([eq(chatEntry)]), "read chat entries.");
      },
    },
    {
      name: "FillAndReadNothing",
      execute: () => {
        // Prepare
        let blockPatternTester = new MockBlockPatternTester();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10 };

        // Execute
        chatPool.fill([chatEntry]);
        let readed = chatPool.read(10);

        // Verify
        assertThat(readed, isArray([]), "read chat entries");
      },
    },
    {
      name: "FillAndReadBlocked",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(chatEntry: ChatEntry) {
            assertThat(chatEntry.content, eq("blocked"), "blocked content");
            return true;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10, content: "blocked" };

        // Execute
        chatPool.fill([chatEntry]);
        let readed = chatPool.read(20);

        // Verify
        assertThat(readed, isArray([]), "read chat entries");
      },
    },
    {
      name: "FillTwoAndReadTwice",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test() {
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 30 };

        // Execute
        chatPool.fill([{ timestamp: 10 }, chatEntry]);
        chatPool.read(20);
        let readed = chatPool.read(40);

        // Verify
        assertThat(readed, isArray([eq(chatEntry)]), "read chat entries");
      },
    },
    {
      name: "FillUnorderedTwoAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test() {
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10 };
        let chatEntry2 = { timestamp: 30 };

        // Execute
        chatPool.fill([chatEntry2, chatEntry]);
        let readed = chatPool.read(40);

        // Verify
        assertThat(
          readed,
          isArray([eq(chatEntry), eq(chatEntry2)]),
          "read chat entries",
        );
      },
    },
    {
      name: "FillMoreUnorderedAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test() {
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10 };
        let chatEntry2 = { timestamp: 30 };
        let chatEntry3 = { timestamp: 30 };
        let chatEntry4 = { timestamp: 50 };
        let chatEntry5 = { timestamp: 100 };

        // Execute
        chatPool.fill([
          chatEntry2,
          chatEntry4,
          chatEntry,
          chatEntry3,
          chatEntry5,
        ]);
        let readed = chatPool.read(200);

        // Verify
        assertThat(
          readed,
          isArray([
            eq(chatEntry),
            eq(chatEntry2),
            eq(chatEntry3),
            eq(chatEntry4),
            eq(chatEntry5),
          ]),
          "read chat entries",
        );
      },
    },
    {
      name: "FillTwiceUnorderedAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test() {
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 10 };
        let chatEntry2 = { timestamp: 30 };
        let chatEntry3 = { timestamp: 30 };
        let chatEntry4 = { timestamp: 30 };
        let chatEntry5 = { timestamp: 50 };
        let chatEntry6 = { timestamp: 100 };

        // Execute
        chatPool.fill([chatEntry2, chatEntry5]);
        chatPool.fill([chatEntry3, chatEntry, chatEntry4, chatEntry6]);
        let readed = chatPool.read(200);

        // Verify
        assertThat(
          readed,
          isArray([
            eq(chatEntry),
            eq(chatEntry2),
            eq(chatEntry3),
            eq(chatEntry4),
            eq(chatEntry5),
            eq(chatEntry6),
          ]),
          "read chat entries",
        );
      },
    },
    {
      name: "FillAndJumpAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test() {
            return false;
          }
        })();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 20 };
        let chatEntry2 = { timestamp: 30 };
        let chatEntry3 = { timestamp: 30 };
        let chatEntry4 = { timestamp: 50 };

        // Execute
        chatPool.fill([chatEntry, chatEntry2, chatEntry3, chatEntry4]);
        chatPool.start(30);
        let readed = chatPool.read(40);

        // Verify
        assertThat(
          readed,
          isArray([eq(chatEntry2), eq(chatEntry3)]),
          "read chat entries",
        );
      },
    },
    {
      name: "FillAndJumpToEndAndRead",
      execute: () => {
        // Prepare
        let blockPatternTester = new MockBlockPatternTester();
        let chatPool = new StructuredChatPool(blockPatternTester);
        let chatEntry = { timestamp: 20 };
        let chatEntry2 = { timestamp: 30 };
        let chatEntry3 = { timestamp: 30 };

        // Execute
        chatPool.fill([chatEntry, chatEntry2, chatEntry3]);
        chatPool.start(50);
        let readed = chatPool.read(60);

        // Verify
        assertThat(readed, isArray([]), "read chat entries");
      },
    },
    {
      name: "RebaselinesKickVodAfterSeekWithoutReplayingVisibleHistory",
      execute: () => {
        // Prepare: Kick resets its virtual-list indexes after a VOD seek.
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="5"><span>10:00</span>old message</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(600000);
        chatPool.clear();
        chatPool.start(3660000);

        // Execute: seeked can fire before Kick remounts the chat. Visible rows
        // are history; a row from 1:01:01 is genuinely new but still future at
        // the 1:01:00 playhead.
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">01:00:40</span>history one</div>' +
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">01:00:53</span>history two</div>' +
          '<div data-index="2"><span class="text-neutral pr-1 font-semibold">01:01:01</span>new message</div>';
        let visibleHistory = chatPool.read(3660000);
        let beforeNewTimestamp = chatPool.read(3660999);
        let fresh = chatPool.read(3661000);

        // Verify
        assertThat(visibleHistory, isArray([]), "visible history after seek");
        assertThat(beforeNewTimestamp, isArray([]), "future message");
        assertThat(fresh.length, eq(1), "fresh message count");
        assertThat(
          fresh[0].content,
          eq(
            '<span class="text-neutral pr-1 font-semibold">01:01:01</span>new message',
          ),
          "fresh message",
        );
      },
    },
    {
      name: "FindsFutureKickVodMessageWhenRemountFinishesBeforeSeeked",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="5"><span class="text-neutral pr-1 font-semibold">10:00</span>old message</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(600000);
        chatPool.clear();
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">01:00:53</span>history</div>' +
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">01:01:01</span>new message</div>';

        // Execute: the DOM remount completes before seeked/play calls start.
        chatPool.start(3660000);
        let atSeekTarget = chatPool.read(3660000);
        let fresh = chatPool.read(3661000);

        // Verify
        assertThat(atSeekTarget, isArray([]), "history at seek target");
        assertThat(fresh.length, eq(1), "future message count");
        assertThat(
          fresh[0].content?.includes("new message"),
          eq(true),
          "future message content",
        );
      },
    },
    {
      name: "DoesNotDropFirstKickVodMessageWhenChatStartsEmpty",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(0);

        // Execute
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">00:01</span>first message</div>';
        let first = chatPool.read(1000);

        // Verify
        assertThat(first.length, eq(1), "first message count");
        assertThat(
          first[0].content?.includes("first message"),
          eq(true),
          "first message content",
        );
      },
    },
    {
      name: "FiltersKickVodHistoryAppendedInTheSameContainerAfterSeek",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="5"><span class="text-neutral pr-1 font-semibold">10:00</span>old message</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(600000);
        chatPool.clear();
        chatPool.start(3660000);

        // Execute: a UI implementation may reuse the same root and append the
        // new history window instead of replacing the old pointer.
        chatContainer.insertAdjacentHTML(
          "beforeend",
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">01:00:53</span>history</div>' +
            '<div data-index="1"><span class="text-neutral pr-1 font-semibold">01:01:01</span>new message</div>',
        );
        let atSeekTarget = chatPool.read(3660000);
        let fresh = chatPool.read(3661000);

        // Verify
        assertThat(atSeekTarget, isArray([]), "same-root history");
        assertThat(fresh.length, eq(1), "same-root future message count");
        assertThat(
          fresh[0].content?.includes("new message"),
          eq(true),
          "same-root future message content",
        );
      },
    },
    {
      name: "DoesNotDuplicatePendingKickVodMessageAcrossReindexedRemount",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(3660000);
        chatContainer.innerHTML =
          '<div data-index="5"><span class="text-neutral pr-1 font-semibold">01:01:01</span><b>same message</b></div>';
        let firstScan = chatPool.read(3660000);

        // Execute: a virtual-list remount can change its index and harmless
        // markup while representing the same logical future message.
        chatContainer.innerHTML =
          '<div data-index="99"><span class="text-neutral pr-1 font-semibold">01:01:01</span><b>same message</b><i></i></div>';
        let secondScan = chatPool.read(3660500);
        let ready = chatPool.read(3661000);

        // Verify
        assertThat(firstScan, isArray([]), "first future scan");
        assertThat(secondScan, isArray([]), "remounted future scan");
        assertThat(ready.length, eq(1), "deduplicated future message count");
      },
    },
    {
      name: "EmitsKickVodMessageAddedLaterInTheBaselineSecond",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(3660500);
        chatPool.read(3660500);

        // Execute: Kick labels only whole seconds, so a genuinely new message
        // can arrive later within the same baseline second.
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">01:01:00</span>same-second message</div>';
        let message = chatPool.read(3660800);

        // Verify
        assertThat(message.length, eq(1), "same-second message count");
      },
    },
    {
      name: "EmitsFreshLateKickVodMessageAfterInitialBaselineScan",
      execute: () => {
        // Prepare
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">01:00:53</span>visible history</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(3660000);
        chatPool.read(3660000);

        // Execute: a genuinely new DOM row can arrive slightly late. Once the
        // initial baseline is established it must be emitted immediately.
        chatContainer.insertAdjacentHTML(
          "beforeend",
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">01:00:54</span>late fresh message</div>',
        );
        let message = chatPool.read(3661000);

        // Verify
        assertThat(message.length, eq(1), "late fresh message count");
      },
    },
    {
      name: "FallsBackWithoutDroppingFirstKickVodMessageAfterEmptyScan",
      execute: () => {
        // Prepare: keep a compatibility path if Kick changes its timestamp
        // classes before this extension can be updated.
        let chatContainer = document.createElement("div");
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(0);
        chatPool.read(0);

        // Execute
        chatContainer.innerHTML = '<div data-index="0">first message</div>';
        let first = chatPool.read(1000);

        // Verify
        assertThat(first.length, eq(1), "fallback first message count");
      },
    },
    {
      name: "DoesNotQueueOldWindowAsFutureDuringBackwardKickVodSeek",
      execute: () => {
        // Prepare: seek backward from 1:01:00 to 10:00 while the old DOM
        // window is still mounted when seeked resumes the reader.
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="40"><span class="text-neutral pr-1 font-semibold">01:01:00</span>old window</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(3660000);
        chatPool.read(3660000);
        chatPool.clear();
        chatPool.start(600000);

        // Execute: one read happens before remount, then Kick replaces the old
        // window with history around the new target and one future message.
        let beforeRemount = chatPool.read(600000);
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">09:53</span>new history</div>' +
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">10:01</span>new message</div>';
        let atTarget = chatPool.read(600000);
        let newMessage = chatPool.read(601000);
        let oldWindowAtItsTimestamp = chatPool.read(3660000);

        // Verify
        assertThat(beforeRemount, isArray([]), "old window before remount");
        assertThat(atTarget, isArray([]), "new history after remount");
        assertThat(newMessage.length, eq(1), "backward-seek new message");
        assertThat(
          oldWindowAtItsTimestamp,
          isArray([]),
          "old window was never queued",
        );
      },
    },
    {
      name: "CapturesOldWindowWhenBackwardKickVodSeekPrecedesFirstRead",
      execute: () => {
        // Prepare: the video can be paused and seeked before the chat reader's
        // first animation frame establishes a cursor.
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="40"><span class="text-neutral pr-1 font-semibold">01:01:00</span>old unstarted window</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );

        // Execute: seeking clears the pool before start/read has ever run.
        chatPool.clear();
        chatPool.start(600000);
        let beforeRemount = chatPool.read(600000);
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">09:53</span>new history</div>' +
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">10:01</span>new message</div>';
        chatPool.read(600000);
        let newMessage = chatPool.read(601000);
        let oldWindowAtItsTimestamp = chatPool.read(3660000);

        // Verify
        assertThat(beforeRemount, isArray([]), "unstarted old window");
        assertThat(newMessage.length, eq(1), "unstarted-seek new message");
        assertThat(
          oldWindowAtItsTimestamp,
          isArray([]),
          "unstarted old window was never queued",
        );
      },
    },
    {
      name: "CapturesUnreadOldTailDuringBackwardKickVodSeek",
      execute: () => {
        // Prepare: establish a cursor, then let Kick append an old-window row
        // after the last animation frame but before the user seeks.
        let chatContainer = document.createElement("div");
        chatContainer.innerHTML =
          '<div data-index="40"><span class="text-neutral pr-1 font-semibold">01:01:00</span>old read row</div>';
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new OnPageChatPool(
          chatContainer,
          blockPatternTester,
          VirtualizedChatMode.VodMediaTimestamps,
          readKickVodTimestamp,
        );
        chatPool.start(3660000);
        chatPool.read(3660000);
        chatContainer.insertAdjacentHTML(
          "beforeend",
          '<div data-index="41"><span class="text-neutral pr-1 font-semibold">01:01:05</span>old unread tail</div>',
        );

        // Execute
        chatPool.clear();
        chatPool.start(600000);
        let beforeRemount = chatPool.read(600000);
        chatContainer.innerHTML =
          '<div data-index="0"><span class="text-neutral pr-1 font-semibold">09:53</span>new history</div>' +
          '<div data-index="1"><span class="text-neutral pr-1 font-semibold">10:01</span>new message</div>';
        chatPool.read(600000);
        let newMessage = chatPool.read(601000);
        let oldTailAtItsTimestamp = chatPool.read(3665000);

        // Verify
        assertThat(beforeRemount, isArray([]), "old unread tail before remount");
        assertThat(newMessage.length, eq(1), "unread-tail seek new message");
        assertThat(
          oldTailAtItsTimestamp,
          isArray([]),
          "old unread tail was never queued",
        );
      },
    },
    {
      name: "PrefetchesKickVodChatsAndReleasesThemByMediaTime",
      execute: async () => {
        // Prepare: model the three Kick endpoints with literal VOD metadata and
        // messages spread across future five-second history buckets.
        let vodStart = Date.parse("2026-08-15T12:41:36Z");
        let historyRequests = new Array<number>();
        let releaseFarthestBucket: (() => void) | undefined;
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/quin3614/info") {
            return new Response(JSON.stringify({ id: 119117173, slug: "quin3614" }));
          }
          if (
            url.href ===
            "https://web.kick.com/api/v1/channels/119117173/videos"
          ) {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "vod-id",
                    start_time: "2026-08-15T12:41:36Z",
                    channel: { id: 119117173, slug: "quin3614" },
                  },
                ],
              }),
            );
          }
          if (
            url.origin === "https://web.kick.com" &&
            url.pathname === "/api/v1/chat/119117173/history"
          ) {
            let bucketStart = Date.parse(url.searchParams.get("start_time"));
            historyRequests.push(bucketStart);
            let bucketOffset = bucketStart - vodStart;
            if (bucketOffset === 74000) {
              return new Promise<Response>((resolve) => {
                releaseFarthestBucket = () =>
                  resolve(
                    new Response(
                      JSON.stringify({ data: { messages: [], cursor: "next" } }),
                    ),
                  );
              });
            }
            let messages = new Array<Record<string, unknown>>();
            if (bucketOffset === 59000) {
              messages.push({
                id: "message-61",
                content: "first",
                created_at: new Date(vodStart + 61000).toISOString(),
                sender: { username: "one", identity: { color: "#ffffff" } },
              });
            } else if (bucketOffset === 64000) {
              messages.push({
                id: "message-67",
                content: "second",
                created_at: new Date(vodStart + 67000).toISOString(),
                sender: { username: "two", identity: { color: "#ffffff" } },
              });
            } else if (bucketOffset === 69000) {
              messages.push({
                id: "message-72",
                content: "third",
                created_at: new Date(vodStart + 72000).toISOString(),
                sender: { username: "three", identity: { color: "#ffffff" } },
              });
            }
            return new Response(
              JSON.stringify({ data: { messages, cursor: "next" } }),
            );
          }
          return new Response("not found", { status: 404 });
        };
        let fallbackReadCount = 0;
        let fallback = {
          fill: () => {},
          clear: () => {},
          start: () => {},
          read: (): Array<ChatEntry> => {
            fallbackReadCount++;
            return [];
          },
        };
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new KickVodApiChatPool(
          fetcher,
          "quin3614",
          "vod-id",
          fallback,
          blockPatternTester,
        );

        // Execute
        chatPool.start(60000);
        for (let i = 0; i < 20 && historyRequests.length < 4; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let initialHistoryRequestCount = historyRequests.length;
        let atBaseline = chatPool.read(60000);
        let first = chatPool.read(61000);
        releaseFarthestBucket?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let second = chatPool.read(67000);
        let third = chatPool.read(72000);

        // Verify
        assertThat(atBaseline, isArray([]), "baseline messages");
        assertThat(first.length, eq(1), "first prefetched message");
        let extractedFirst = new KickChatContentBuilder().build(first[0], {
          showUserName: false,
        });
        let extractedTemplate = document.createElement("template");
        extractedTemplate.innerHTML = extractedFirst;
        assertThat(first[0].timestamp, eq(61000), "first media timestamp");
        assertThat(
          extractedTemplate.content.textContent?.trim(),
          eq("first"),
          "message without hidden username punctuation",
        );
        assertThat(second.length, eq(1), "second prefetched message");
        assertThat(second[0].timestamp, eq(67000), "second media timestamp");
        assertThat(third.length, eq(1), "third prefetched message");
        assertThat(third[0].timestamp, eq(72000), "third media timestamp");
        assertThat(
          initialHistoryRequestCount,
          eq(4),
          "prefetched bucket count",
        );
        assertThat(fallbackReadCount, eq(0), "fallback read count");
      },
    },
    {
      name: "FallsBackToKickVodDomWhenApiIsUnavailable",
      execute: async () => {
        // Prepare
        let fallbackStartTimestamp = -1;
        let fallback = {
          fill: () => {},
          clear: () => {},
          start: (timestamp: number): void => {
            fallbackStartTimestamp = timestamp;
          },
          read: (timestamp: number): Array<ChatEntry> => [
            { content: "DOM fallback", timestamp },
          ],
        };
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new KickVodApiChatPool(
          async () => new Response("unavailable", { status: 503 }),
          "quin3614",
          "vod-id",
          fallback,
          blockPatternTester,
        );

        // Execute
        chatPool.start(60000);
        chatPool.read(60500);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let chats = chatPool.read(61000);

        // Verify
        assertThat(fallbackStartTimestamp, eq(60500), "fallback baseline");
        assertThat(chats.length, eq(1), "fallback message count");
        assertThat(chats[0].content, eq("DOM fallback"), "fallback content");
      },
    },
    {
      name: "FallsBackWhenKickVodResponseBodyTimesOut",
      execute: async () => {
        // Prepare: receiving HTTP headers is not enough. A body can stall
        // forever, and the media timeline must fall back instead of freezing.
        let fallbackStartTimestamp = -1;
        let requestSignal: AbortSignal | undefined;
        let bodyStarted = false;
        let fetcher = async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          requestSignal = init?.signal as AbortSignal;
          return {
            ok: true,
            status: 200,
            json: () => {
              bodyStarted = true;
              return new Promise((_resolve, reject) =>
                requestSignal?.addEventListener(
                  "abort",
                  () => reject(new Error("aborted")),
                  { once: true },
                ),
              );
            },
          } as Response;
        };
        let poolClass = KickVodApiChatPool as unknown as {
          FETCH_TIMEOUT_MS: number;
        };
        let originalTimeout = poolClass.FETCH_TIMEOUT_MS;
        poolClass.FETCH_TIMEOUT_MS = 0;
        let chatPool = new KickVodApiChatPool(
          fetcher,
          "quin3614",
          "vod-id",
          {
            fill: () => {},
            clear: () => {},
            start: (timestamp: number) => {
              fallbackStartTimestamp = timestamp;
            },
            read: (): Array<ChatEntry> => [],
          },
          new (class extends MockBlockPatternTester {
            public test(): boolean {
              return false;
            }
          })(),
        );

        // Execute
        try {
          chatPool.start(60000);
          chatPool.read(60500);
          for (let i = 0; i < 20 && fallbackStartTimestamp !== 60500; i++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        } finally {
          poolClass.FETCH_TIMEOUT_MS = originalTimeout;
          chatPool.clear();
        }

        // Verify
        assertThat(bodyStarted, eq(true), "response body consumption started");
        assertThat(requestSignal?.aborted, eq(true), "stalled body aborted");
        assertThat(fallbackStartTimestamp, eq(60500), "latest fallback baseline");
      },
    },
    {
      name: "KeepsLateKickVodBucketForTrajectoryBasedExpiry",
      execute: async () => {
        // Prepare: on a wide fullscreen canvas a message can remain visible
        // much longer than one five-second history bucket.
        let vodStart = Date.parse("2026-08-15T12:41:36Z");
        let releaseInitialBucket: ((response: Response) => void) | undefined;
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/quin3614/info") {
            return new Response(JSON.stringify({ id: 119117173 }));
          }
          if (url.pathname === "/api/v1/channels/119117173/videos") {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "vod-id",
                    start_time: new Date(vodStart).toISOString(),
                    channel: { id: 119117173 },
                  },
                ],
              }),
            );
          }
          if (url.pathname === "/api/v1/chat/119117173/history") {
            let bucketStart = Date.parse(url.searchParams.get("start_time"));
            if (bucketStart - vodStart === -1000) {
              return new Promise<Response>((resolve) => {
                releaseInitialBucket = resolve;
              });
            }
            return new Response(JSON.stringify({ data: { messages: [] } }));
          }
          return new Response("not found", { status: 404 });
        };
        let chatPool = new KickVodApiChatPool(
          fetcher,
          "quin3614",
          "vod-id",
          {
            fill: () => {},
            clear: () => {},
            start: () => {},
            read: (): Array<ChatEntry> => [],
          },
          new (class extends MockBlockPatternTester {
            public test(): boolean {
              return false;
            }
          })(),
        );

        // Execute: the initial bucket arrives when the video is already at 12s.
        chatPool.start(0);
        for (let i = 0; i < 20 && !releaseInitialBucket; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        chatPool.read(12000);
        releaseInitialBucket?.(
          new Response(
            JSON.stringify({
              data: {
                messages: [
                  {
                    id: "late-but-visible",
                    content: "place me at my media position",
                    created_at: new Date(vodStart + 4000).toISOString(),
                    sender: { username: "viewer" },
                  },
                ],
              },
            }),
          ),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let chats = chatPool.read(12000);

        // Verify: the renderer, which knows width and speed, decides expiry.
        assertThat(chats.length, eq(1), "late bucket message count");
        assertThat(chats[0].timestamp, eq(4000), "late bucket media timestamp");
        chatPool.clear();
      },
    },
    {
      name: "IgnoresKickVodApiResultsFromBeforeSeek",
      execute: async () => {
        // Prepare: hold history responses so the first generation can finish
        // only after a seek has started a second generation.
        let vodStart = Date.parse("2026-08-15T12:41:36Z");
        let historyResolvers = new Array<(response: Response) => void>();
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/quin3614/info") {
            return new Response(JSON.stringify({ id: 119117173 }));
          }
          if (url.pathname === "/api/v1/channels/119117173/videos") {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "vod-id",
                    start_time: new Date(vodStart).toISOString(),
                    channel: { id: 119117173 },
                  },
                ],
              }),
            );
          }
          if (url.pathname === "/api/v1/chat/119117173/history") {
            return new Promise<Response>((resolve) =>
              historyResolvers.push(resolve),
            );
          }
          return new Response("not found", { status: 404 });
        };
        let fallback = {
          fill: () => {},
          clear: () => {},
          start: () => {},
          read: (): Array<ChatEntry> => [],
        };
        let blockPatternTester = new (class extends MockBlockPatternTester {
          public test(): boolean {
            return false;
          }
        })();
        let chatPool = new KickVodApiChatPool(
          fetcher,
          "quin3614",
          "vod-id",
          fallback,
          blockPatternTester,
        );
        let historyResponse = (id: string, content: string): Response =>
          new Response(
            JSON.stringify({
              data: {
                messages: [
                  {
                    id,
                    content,
                    created_at: new Date(vodStart + 601000).toISOString(),
                    sender: { username: "viewer" },
                  },
                ],
              },
            }),
          );
        let emptyHistoryResponse = (): Response =>
          new Response(JSON.stringify({ data: { messages: [] } }));

        // Execute
        chatPool.start(60000);
        for (let i = 0; i < 20 && historyResolvers.length < 1; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        historyResolvers[0](emptyHistoryResponse());
        for (let i = 0; i < 20 && historyResolvers.length < 4; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        chatPool.clear();
        chatPool.start(600000);
        for (let i = 0; i < 20 && historyResolvers.length < 5; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        historyResolvers[4](historyResponse("new-generation", "display once"));
        for (let i = 0; i < 20 && historyResolvers.length < 8; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        for (let resolve of historyResolvers.slice(1, 4)) {
          resolve(historyResponse("old-generation", "must not display"));
        }
        for (let resolve of historyResolvers.slice(5)) {
          resolve(emptyHistoryResponse());
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        let chats = chatPool.read(601000);

        // Verify
        assertThat(chats.length, eq(1), "post-seek message count");
        assertThat(
          chats[0].content?.includes("display once"),
          eq(true),
          "post-seek message",
        );
        assertThat(
          chats[0].content?.includes("must not display"),
          eq(false),
          "pre-seek message",
        );
      },
    },
    {
      name: "KeepsKickVodApiStateBoundedDuringLongPlayback",
      execute: async () => {
        // Prepare
        let vodStart = Date.parse("2026-08-15T12:41:36Z");
        let historyRequestCount = 0;
        let fetcher = async (input: RequestInfo | URL): Promise<Response> => {
          let url = new URL(String(input), window.location.origin);
          if (url.pathname === "/api/v2/channels/quin3614/info") {
            return new Response(JSON.stringify({ id: 119117173 }));
          }
          if (url.pathname === "/api/v1/channels/119117173/videos") {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "vod-id",
                    start_time: new Date(vodStart).toISOString(),
                    channel: { id: 119117173 },
                  },
                ],
              }),
            );
          }
          if (url.pathname === "/api/v1/chat/119117173/history") {
            historyRequestCount++;
            let bucketStart = Date.parse(url.searchParams.get("start_time"));
            return new Response(
              JSON.stringify({
                data: {
                  messages: [
                    {
                      id: `message-${bucketStart}`,
                      content: "message",
                      created_at: new Date(bucketStart).toISOString(),
                      sender: { username: "viewer" },
                    },
                  ],
                },
              }),
            );
          }
          return new Response("not found", { status: 404 });
        };
        let chatPool = new KickVodApiChatPool(
          fetcher,
          "quin3614",
          "vod-id",
          {
            fill: () => {},
            clear: () => {},
            start: () => {},
            read: (): Array<ChatEntry> => [],
          },
          new (class extends MockBlockPatternTester {
            public test(): boolean {
              return false;
            }
          })(),
        );
        chatPool.start(0);
        for (let i = 0; i < 20 && historyRequestCount < 4; i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        // Execute: advance through thirty bucket boundaries, then call read as
        // if sixty animation frames occurred without changing media buckets.
        for (let bucket = 1; bucket <= 30; bucket++) {
          chatPool.read(bucket * 5000);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        let requestsBeforeSameBucketFrames = historyRequestCount;
        for (let frame = 0; frame < 60; frame++) {
          chatPool.read(150000);
        }
        let state = chatPool as unknown as {
          completedBucketStarts: Set<number>;
          bucketRequests: Map<number, Promise<void>>;
          seenMessageIds: Map<string, number>;
        };

        // Verify: retained state follows a short sliding media window rather
        // than total VOD duration, and rAF reads do not refetch the same bucket.
        assertThat(
          historyRequestCount,
          eq(requestsBeforeSameBucketFrames),
          "same-bucket history requests",
        );
        assertThat(
          state.completedBucketStarts.size,
          lt(8),
          "retained completed buckets",
        );
        assertThat(state.bucketRequests.size, lt(5), "active bucket requests");
        assertThat(state.seenMessageIds.size, lt(20), "retained message ids");
        chatPool.clear();
      },
    },
  ],
});
