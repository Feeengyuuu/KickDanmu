# DanMage

## Overview

DanMage is a project that brings NicoNico-style flow chat (A.K.A., scrolling chat, danmaku, danmu) to multiple video sites as both [a chrome extension](https://chrome.google.com/webstore/detail/danmage/elhaopojedichjdgkglifmijgkeclalm) and [a firefox extension](https://addons.mozilla.org/en-US/firefox/addon/danmage), now supporting YouTube, Twitch, Kick and Crunchyroll. It's also deployed as a [website](https://www.danmage.com/), which provides minimum backend support to the extension, such as storing posted chats and player settings.

It's definitely not perfect. The DOM tree is a complete mess and not easy to parse, while the sites can introduce changes anytime without notifying me.

So if you want to see danmaku being built into a native video platform, wish list [here](https://www.secount.com/danmaku).

![Secount wish list page](./danmaku_site.png)

## Deployment

It's deployed to Google Cloud Platform (GCP) by using [Google Cloud Build](https://cloud.google.com/build) using `cloudbuild.yaml` and `Dockerfile`.

## Build

You can build the extension locally by `npm run ext_linux`, which dumps the bundled JS files into `./chrome_extension_bin` directory, which can be loaded in debug mode in browsers. It talks directly to the PROD web server.

On Windows, run `npm run ext_windows`. The unpacked extension is written to the same `./chrome_extension_bin` directory.

You can do so for firefox with `npm run ext_firefox_linux_zip`.

## Kick adapter

All Kick-specific code lives in `frontend/chrome_extension/content_script/kick/`:

- `kick_selectors.ts`: every DOM selector the extension depends on, as ordered fallback chains. When Kick ships a redesign, start here.
- `kick_api.ts`: the Kick web endpoints used (channel info, single VOD metadata, chat history buckets), with timeouts that also cover stalled response bodies.
- `kick_assembler.ts`: picks the chat source per page. VODs use the history API timeline (DOM fallback). Live streams read the chat DOM, or poll the history API when the chat list is not mounted (chat popped out, narrow layout, or a markup change).
- `kick_live_api_chat_pool.ts` / `kick_vod_chat_pool.ts`: the two API-backed chat sources.

Diagnostics: run `localStorage.setItem("danmage:debug", "1")` on kick.com and reload to log which chat source is active. Broken selectors and API fallbacks are always reported once as `[DanMage]` console warnings.

Tests run in headless Chrome, e.g. `npx bundage prun frontend/chrome_extension/content_script/kick/kick_adapter_test` (set `CHROME` to a Chrome executable).

## Version

### Version 5.4.0

Kick: moved all Kick code into a dedicated adapter with centralized selectors. Replies no longer render their quoted parent as a second danmaku line, badge tooltips and timestamps no longer trigger block rules, and badges scale with the danmaku font. The settings button anchors to Kick's stable `data-testid` controls. Older VODs (beyond the latest 30) now resolve through the single-video endpoint and keep API timing. Live danmaku keeps working when the chat list is missing by polling the chat history API with backoff. Added opt-in debug logging.

### Version 5.3.2

Merged fix for compability with other scripts.

### Version 5.3.1

Fixed a bug when navigating between YouTube live replaces with chat window hidden, danmaku might not show.

### Version 5.3.0

Added a show/hide YouTube chat window option in the display settings tab, which is only needed on YouTube. Twitch and Kick can hide chat using their own buttons without disrupting danmaku. As a result, the button to open settings panel is relocated to the bottom of video players on all platforms.

### Version 5.2.1

Fixed small issues on Kick, including danmaku appearing mid screen on large screen, and sometimes timestamp is not removed. Though still easy to break whenver Kick updates their UI.

### Version 5.2.0

Supported Kick live streaming platform. Updated danmaku styling for YouTube.

### Version 5.1.0

Added support for 7tv extension on Twitch. Small refactors on extrating and applying styles to danmaku HTML elements.

### Version 5.0.1

Huge bump of library versions, which breaks the authentication on old extension unfortunately. Please update if you want to log in and load player settings. Otherwise the old extension works fine on its own.
