# BiliSmooth

[简体中文](./README.md) | **English**

[![Version](https://img.shields.io/badge/version-2.8.2-0f766e)](https://github.com/Planetes1mal/BiliSmooth/releases/latest)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285f4)
![Chrome / Edge 120+](https://img.shields.io/badge/Chrome%20%2F%20Edge-120%2B-4285f4)
[![MIT License](https://img.shields.io/badge/license-MIT-64748b)](./LICENSE)

**See Bilibili's download speed, playable buffer and active delivery route—and try a better CDN when playback stalls.**

BiliSmooth is a local playback helper for Chrome and Edge. It puts live metrics and routing controls in a floating panel on the video page, with a separate dashboard for details. Your selected video quality is preserved.

<img src="./docs/images/floating-preview.png" width="320" alt="BiliSmooth floating control preview">

*Floating interface preview using demo data.*

[Download](https://github.com/Planetes1mal/BiliSmooth/releases/latest) · [Report an issue](https://github.com/Planetes1mal/BiliSmooth/issues) · [Changelog](./CHANGELOG.md)

## Why I built it

While studying overseas, I often ran into repeated buffering on Bilibili. Alongside trying different routes, I wanted to see whether a download was progressing, how long the buffer would last at my playback speed, and which route was actually delivering the video.

BiliSmooth adapts routing and configuration work from [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator). Its floating controls, playable-buffer display and route dashboard are designed around my viewing habits. Thanks to realzza for sharing that work under the MIT license.

## What it offers

| Feature | What it helps you do |
| --- | --- |
| **Floating video controls** | See observed download speed, playback state, playable buffer and delivery route. Drag, dock or expand the panel. |
| **Buffer adjusted for playback speed** | Read the time you can keep watching. For example, 20 seconds of buffered video lasts about 10 seconds at 2×. |
| **Automatic or fixed routing** | Select a CDN using local network probes and playback feedback, or choose a fixed route yourself. |
| **Stall recovery** | Try alternate routes while automatic routing is enabled, with attempted recovery distinguished from observed recovery. |
| **Playback dashboard** | Inspect download history, delivery routes and activity; customize the theme, language and floating display. |

Resolutions such as 4K depend on Bilibili's available sources and your account permissions. The extension preserves the quality you select in the player.

## Install

Requires **Chrome or Edge 120 or newer**. Installation is currently through GitHub Releases; there is no extension-store listing yet.

1. Download **`BiliSmooth-2.8.2.zip`** from [Releases](https://github.com/Planetes1mal/BiliSmooth/releases/latest) and extract it. Use this installation ZIP rather than GitHub's automatically generated Source code archives.
2. Open `chrome://extensions`, or `edge://extensions` in Edge.
3. Turn on **Developer mode** and choose **Load unpacked**.
4. Select the extracted folder containing **`manifest.json`**.
5. Refresh any open Bilibili video pages. The BiliSmooth floating control confirms that the page integration has loaded; the extension's toolbar icon opens the dashboard.

Keep the extracted folder in place: the browser continues to load the extension from it.

**Update:** Extract the new version into the existing installation folder, reload BiliSmooth on the browser's extensions page, then refresh your video pages. Existing preferences are retained.

## Start watching

1. **Play a video normally.** Automatic routing is enabled by default; check the floating speed and buffer indicators.
2. **Expand the floating control when needed.** Enable or disable optimization, select a route, try an alternate route or reassess the network.
3. **Open the dashboard for details.** Use the extension's toolbar icon, or `Alt+Shift+B` if that shortcut is configured in your browser.

Choosing a fixed route pauses automatic route switching. Settings that require a page refresh show a reminder. To use the site's original routing, disable optimization and refresh the video page as prompted.

## Privacy and permissions

The extension uses local storage and access to Bilibili pages to save preferences, connect to video pages and handle playback requests. It requires no extra account and has no cloud sync. Video titles and thumbnails are used in the current interface; diagnostic exports omit video metadata and full media addresses.

Read the [privacy notice](./PRIVACY.md) and [third-party notices](./NOTICE.md) for details.

## Development and contributions

Requires **Node.js 24+**. From the repository root:

```sh
npm ci --ignore-scripts
npm run build
```

Load **`dist/extension`** using the installation steps above. Run `npm test` to check the playback core.

- [Contributing](./CONTRIBUTING.md): issues, change scope and local validation.
- [Architecture](./docs/architecture.md): module responsibilities and playback request flow.
- [2.8.2 release notes](./docs/releases/2.8.2.md): features and installation instructions.

When [reporting an issue](https://github.com/Planetes1mal/BiliSmooth/issues), include your browser and extension versions, video page, selected quality, playback speed, and expected versus observed behavior.

## License and acknowledgements

BiliSmooth is [MIT licensed](./LICENSE). Its routing and configuration work adapts MIT-licensed code from [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator). The interface also uses Motion and Tabler Icons. See [NOTICE.md](./NOTICE.md) for attribution and license details.
