# BiliSmooth

[简体中文](./README.md) | **English**

[![Version](https://img.shields.io/github/v/release/Planetes1mal/BiliSmooth?color=0f766e&label=version)](https://github.com/Planetes1mal/BiliSmooth/releases/latest)
[![License](https://img.shields.io/github/license/Planetes1mal/BiliSmooth?color=64748b)](./LICENSE)

Switch CDN routes for Bilibili videos and see download speed and playable buffer beside the player.

[Download](https://github.com/Planetes1mal/BiliSmooth/releases/latest) · [Changelog](./CHANGELOG.md) · [Report an issue](https://github.com/Planetes1mal/BiliSmooth/issues)

<img src="https://raw.githubusercontent.com/Planetes1mal/BiliSmooth/main/docs/images/floating-demo.gif" width="960" alt="BiliSmooth floating panel showing download speed and playable buffer, with controls for choosing a video delivery route">

*Interface shown with a demo video.*

## Features

- **Status beside the video:** see download speed, playable buffer and the active route in a panel you can drag, dock or collapse.
- **Buffer adjusted for playback speed:** 20 seconds of buffered video shows about 10 seconds of playable time at 2× speed.
- **Automatic or manual routing:** let BiliSmooth select a CDN or keep a fixed route. Try an alternate route when playback stalls.
- **A separate dashboard:** view download history and route information, adjust settings, and choose Chinese or English with a light or dark theme.

<img src="https://raw.githubusercontent.com/Planetes1mal/BiliSmooth/main/docs/images/dashboard.png" width="960" alt="BiliSmooth dashboard showing playback status, download history and route information">

## Install

For desktop Chrome and Edge. Chrome requires version 120 or later. Downloads are currently available through GitHub; BiliSmooth is not yet listed in the Chrome Web Store.

1. Open the [latest release](https://github.com/Planetes1mal/BiliSmooth/releases/latest), download `BiliSmooth-<version>.zip`, and extract it.
2. Open `chrome://extensions`, or `edge://extensions` in Edge.
3. Enable **Developer mode**, then click **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.
5. Refresh your Bilibili video page to load the floating panel. Click the extension's browser toolbar icon to open the dashboard.

Download the BiliSmooth installation ZIP, rather than GitHub's **Source code** archives. Keep the extracted folder in place; the browser loads the extension from it.

**Update:** Extract the new files into the existing installation folder, reload BiliSmooth on the extensions page, and refresh your video pages. Your settings are retained.

## Use

Open a Bilibili video as usual. Automatic routing is on by default. Click the floating panel to expand its controls, choose a route or adjust the display. Selecting a fixed route pauses automatic switching.

To return to the site's original routing, turn off optimization in the floating panel and refresh the page when prompted.

BiliSmooth preserves the quality selected in the player. It does not unlock paid quality options or bypass regional restrictions. Route performance varies with your network.

## Privacy

No additional account is required, and no telemetry is sent to the developer. Settings stay on your device. Playback requests go to the selected CDN; when MCDN proxying is enabled, they pass through the configured proxy service.

See the [privacy policy](./PRIVACY.en.md) for data handling and permission details.

## Contributing and license

Report problems or suggest improvements in [Issues](https://github.com/Planetes1mal/BiliSmooth/issues). For development, see the [contribution guide](./CONTRIBUTING.md).

BiliSmooth is [MIT licensed](./LICENSE). Its routing and configuration code adapts [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator). The interface uses Motion and Tabler Icons. See the [third-party notices](./NOTICE.md) for attribution.
