# English store listing

## Name

BiliSmooth - Bilibili Playback Helper

## Short description

Switch Bilibili video CDNs and see download speed, playable buffer time, and playback status in a floating panel.

## Detailed description

BiliSmooth helps you manage Bilibili video playback when a delivery route is slow. A small floating panel shows download speed and how much buffered video remains at your current playback speed.

The extension reads the active Bilibili page's title, URL, playback information, and media addresses for these controls. Analysis and settings stay in your browser. Playback and route comparisons connect to Bilibili/CDN services, which receive your IP address and signed media URLs; compatibility relays also receive the original media URL. There is no developer telemetry or automatic diagnostic upload.

No additional route probes run at playback startup. Candidate routes are compared when handling slow or failed requests, or when you click “Test other routes.” Each comparison uses up to two routes, with one Range request per route for up to 768 KiB of media body data. The total is at most 1.5 MiB (2 × 768 KiB, or 1,572,864 bytes); normal playback and network protocol overhead are separate.

WHAT YOU CAN DO

• View playback status, download speed, and playable buffer without leaving the video.
• Start automatic playback on a route supplied by Bilibili, then use the current video's actual transfers to decide whether to switch. PCDN and MCDN compatibility handling still applies.
• Manually fix a bilivideo route. Akamai is used only through addresses supplied for the current video and cannot be a fixed target.
• Use “Test other routes” without saving playback settings. “Reset network records” clears the current session's network state and the current region's history. It retains other regions and does not start a speed test.
• Open the dashboard to change settings, select a video tab, and view this video session's route comparisons and switches.
• Choose English or Chinese, light or dark appearance, and the floating panel's position and visible metrics.

HOW TO USE

Open a video on bilibili.com. Hover over the BiliSmooth tab for metrics, or click it for playback controls. Click the extension's toolbar icon to open the dashboard. If the video page was already open when you installed the extension, refresh it once.

BiliSmooth does not require an account of its own. Bilibili's normal account and content requirements still apply. It preserves the selected quality and does not unlock paid quality or restricted videos. Route availability depends on your connection and the video.

BiliSmooth is an independent open-source project, based on Bilibili Accelerator by realzza. It is not affiliated with or endorsed by Bilibili.

Privacy: https://github.com/Planetes1mal/BiliSmooth/blob/main/PRIVACY.en.md
Support: https://github.com/Planetes1mal/BiliSmooth/issues

Interface shown with a demo video.

## Listing links

- Homepage: https://github.com/Planetes1mal/BiliSmooth
- Support: https://github.com/Planetes1mal/BiliSmooth/issues
- Privacy policy: https://github.com/Planetes1mal/BiliSmooth/blob/main/PRIVACY.en.md
