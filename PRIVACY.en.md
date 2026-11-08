# Privacy Policy

[中文](PRIVACY.md) | **English**

Last updated: November 8, 2026

BiliSmooth is an independent browser extension for Bilibili web playback. It selects video delivery routes, shows download speed and playable buffer, and attempts to recover stalled playback. Settings and playback analysis are processed in your browser. The extension has no developer-operated data server, advertising, analytics SDK, or automatic diagnostic upload.

**Local analysis still involves network requests.** Playback and route comparisons connect to Bilibili and its content delivery services. The receiving servers can see your IP address and media address. Compatibility relays also receive the complete original media address, including its signed parameters.

## Information handled

| Information | Purpose |
| --- | --- |
| URLs and titles of open Bilibili pages, and the current video's public cover image | Identify and select the video in the control panel |
| Media addresses, playback manifests, and audio/video responses, including signed or account-associated URL parameters | Select a delivery route and transfer the current video; the extension does not read login forms or passwords |
| Playback position, speed, resolution, buffer, frame information, transferred bytes, timings, errors, and recovery status | Display playback metrics and decide whether to try another route |
| Browser language, time zone, and connection type when available | Separate local route history by time zone and language and respond to network changes; no geolocation API is used |
| Playback, appearance, panel position, and motion preferences, and server hostnames you add | Save your choices |

The extension reads playback information through page scripts and uses browser APIs to identify open Bilibili tabs. It does not read the browser's history database, track browsing on unrelated websites, or access payment information, private messages, contacts, or local files.

## Local storage and retention

- **Extension storage:** playback and appearance settings (including up to 8 server hostnames you add), motion preferences, and a backup when older preferences are imported. The extension does not synchronize them to cloud storage.
- **Bilibili website storage:** startup preferences, panel position, and CDN host comparison results and failure times. These are stored in the site's `localStorage`, which scripts on that same website can also read. Complete signed media addresses are not stored here.
- **Page memory:** current playback information, complete media addresses, request state, and recent diagnostic records. Refreshing or closing the video page releases that page's session data; display copies held by the dashboard are released when the dashboard closes. Settings and caches written to local storage remain separately.

Preferences remain until changed or deleted. Route history orders candidates for comparison. With “Automatic” selected and “Start on the fastest tested server” on, it also selects a video's starting route: only a route measured at least twice within the last day, with no failure within the last day and at least twice the video's bitrate, is used. This choice makes no additional requests. Older measurements lose weight with a three-day half-life, and routes that failed within the last hour are placed last. Changes in weight or the end of that failure period do not erase records from disk. Recent events and state samples use bounded rolling buffers, so newer records replace older ones. Each video's route comparisons, switches, and fragment retry records remain in the page session. The extension does not separately encrypt local settings or exported files; their access protection depends on your browser and device.

## Network recipients

1. **Bilibili and content delivery networks (CDNs):** playback requests go to media servers supplied by Bilibili or selected by the extension, mainly under `bilivideo.com`, `bilivideo.cn`, `bilivideo.net`, and `akamaized.net`, including servers you add yourself (upos or bcache hosts under `bilivideo`, such as `cn-jxnc-cmcc-bcache-06.bilivideo.com`). When route history is trustworthy, a video may start on the fastest route measured in your region instead of the one Bilibili assigned. Requests retain the media path and signed parameters needed for playback. The site's own media requests and credential handling remain subject to the browser and Bilibili.
2. **Route comparison servers:** no additional route probes run at playback startup. When handling slow or failed video requests automatically, or when you click “Test speed,” the extension compares up to two candidate CDN routes, chosen from the built-in routes and the ones you added. Each route uses one Range request for up to 768 KiB of media body data. Each comparison requests at most 1.5 MiB in total (2 × 768 KiB, or 1,572,864 bytes). Normal playback and network protocol overhead are separate. Comparison requests omit browser cookies, but media URLs may contain signed or account-associated parameters.
3. **Compatibility relay:** by default, matching MCDN media requests use `proxy-tf-all-ws.bilivideo.com`. The complete original media URL, including its query parameters, is sent as a parameter of the relay request. You can change this behavior under “Settings → Advanced → MCDN addresses.”
4. **Cover image services:** the dashboard loads public video covers from Bilibili image services such as `hdslb.com`.

These services receive ordinary network connection information, including your IP address, request time, and headers the browser sends under its normal rules. An IP address can indicate an approximate region. New CDN and relay addresses selected by the extension use HTTPS. The BiliSmooth developer does not receive these playback requests or control how long Bilibili and its CDNs retain server logs. Their own privacy policies continue to apply.

## Diagnostic export and support

“Export diagnostics” creates a JSON file on your device. It does not send it to the developer. The file contains settings, CDN hostnames, timestamps, playback state, performance statistics, errors, and this video session's route comparisons, switches, and fragment retry records. It excludes video titles, covers, complete page URLs, and signed media URLs.

Timing and performance information can still reveal viewing periods. You decide whether to download, retain, or share the file. Issues and attachments you choose to submit on GitHub are hosted by GitHub. Public issues are visible to everyone; do not upload account credentials, signed media URLs, or other private information. Project maintainers receive support information only when you choose to provide it.

## Your controls

- Set the server to “Bilibili default” to stop subsequent automatic route selection, request rewriting, and recovery. Refresh the video page to fully apply the change. Playback metrics may still be displayed.
- “Test speed” compares candidate routes without saving playback settings. “Clear speed data” clears the current session's network state and the current region's route history. Other regions remain unchanged, and the action does not start a route comparison. “Clear” on the Log page removes retained activity logs and state samples. The current video's route session records remain until the page session ends.
- Turn off “Start on the fastest tested server” in Settings to start videos on the route Bilibili assigns. After you remove a server you added, the extension no longer contacts it.
- “Restore defaults” restores playback preferences and removes the servers you added. It does not erase all storage or downloaded files.
- Remove the extension and its extension data to delete extension settings. Clear Bilibili website storage separately through the browser's site data controls; doing so may also remove Bilibili login state and other site preferences. Delete exported files from your download location separately.
- To stop all extension processing on pages, disable or remove it in the browser and refresh open Bilibili pages.

## Limited Use

BiliSmooth uses this information only for its disclosed playback assistance features and support you request. It does not sell user data or use it for advertising, profiling, creditworthiness, or lending. BiliSmooth's use of information received through Chrome APIs adheres to the [Chrome Web Store User Data Policy, including its Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

## Contact and changes

For privacy questions, contact the maintainers through [BiliSmooth's GitHub support page](https://github.com/Planetes1mal/BiliSmooth/issues). This is a public channel; include only the non-sensitive information needed to address your question.

If data handling changes, this policy and the relevant product disclosures will be updated, together with the date above.
