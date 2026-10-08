# Reviewer instructions

## Access

BiliSmooth has no separate account, subscription, activation code, or server setup. Its core route controls and playback metrics work with an ordinary publicly playable Bilibili video. Paid 4K quality is not required to review the extension.

Choose any publicly playable video under `https://www.bilibili.com/video/`. Bilibili may display a login prompt, geographic restriction, or anti-bot challenge depending on the video and network. Those are site controls; the extension does not bypass them. No test account or credentials are provided by BiliSmooth.

The screenshots use a project-created demo video that is not bundled with the extension. Review playback and routing on a public Bilibili video using the steps below.

## Review the main flow

1. Install the extension and open a public video on bilibili.com. Refresh an already-open video page after installation.
2. Start the video at a quality available without payment. Locate the BiliSmooth tab near the edge of the page.
3. Hover over the tab to see playback status, download speed, and playable buffer. Click it to expand route controls. The buffer value accounts for the player's current playback speed.
4. Click the extension icon in the browser toolbar to open the dashboard. Select the video tab if more than one Bilibili tab is open.
5. If the interface is in Chinese, open “偏好设置” (Preferences), find “语言” (Language) in “外观” (Appearance), and select “English.” The video panel follows the same preference.
6. Open “Route management.” Automatic mode shows the original route and whether a comparison or switch has occurred. Click “Test other routes” while video fragments are available. The action does not save playback settings and becomes available again after its cooldown. A comparison can retain the current route.
7. On “Route management,” review “Current video route evidence” and “Current video session.” These sections show measured route data and this session's comparisons and switches. A fragment retry is separate from a switch for the rest of the video.
8. Choose a built-in bilivideo host under “Fixed CDN hostname” and click “Apply to future requests” to use manual routing. Akamai hosts are not accepted as fixed targets. Select “Automatic” under “Route selection” to return to automatic handling. Buffered playback may not immediately request new data.
9. Turn off “Enable optimization,” then refresh the video page. Automatic route changes stop while playback metrics can still be displayed. Re-enable it to restore automatic handling.

## Review local data controls

- Change the theme or language, close and reopen the dashboard, and confirm the preference remains available.
- “Export diagnostics” downloads a JSON file to the local device. It does not upload the file. The export omits video titles, full page URLs, covers, and signed media addresses.
- Click “Reset network records” to clear the current session's network state and the current region's route history. Other regions are retained. This action does not initiate route probes or comparisons.
- Open “Activity log” and click “Clear records” to remove retained activity logs and state samples. Route session records remain until the page session ends.
- The full privacy policy is available in [English](../../PRIVACY.en.md) and [Chinese](../../PRIVACY.md).

## Expected network behavior

The extension processes Bilibili's media manifests and requests in the video page. No additional route probes run at playback startup. Automatic handling of slow or failed video requests, or “Test other routes,” can compare up to two CDN routes. Each route uses one Range request for up to 768 KiB of media body data. The combined limit is 1.5 MiB per comparison (2 × 768 KiB, or 1,572,864 bytes), excluding normal playback and network protocol overhead. These requests omit browser cookies but retain signed media URL parameters.

Automatic playback starts on an address supplied for the video, with existing PCDN and MCDN compatibility handling. Akamai can be an automatic candidate only when Bilibili supplies its signed address for that representation. The extension does not create Akamai addresses by substituting hostnames, and Akamai is not offered as a fixed target.

When compatibility relay handling applies, the default relay at `proxy-tf-all-ws.bilivideo.com` receives the complete original media URL as a query parameter. The dashboard may also request the public cover image from Bilibili's image service.

These requests deliver or compare the video routes shown in the UI. They do not download executable extension code. All extension JavaScript and the animation library are packaged locally. BiliSmooth does not operate a telemetry endpoint or collect diagnostic files automatically.

## Scope

The extension is designed for Bilibili web video playback on `bilibili.com`. It does not unlock paid quality, regional restrictions, or login-only content. Download speed can fall to zero while playback remains buffered; that alone is not an extension failure. Automatic comparisons require measured slow delivery, a fragment at risk of arriving too late, or repeated request failures. Smooth playback does not necessarily trigger a comparison. The extension keeps the selected quality. A hung fragment may retry on a measured alternative while the rest of the video remains on its previously healthy route. The extension triggers at most one such retry for the same fragment; if the player does not retry within three seconds, that action is disabled for the current page.
