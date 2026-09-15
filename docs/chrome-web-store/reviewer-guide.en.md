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
6. Open “Route management.” Choose a built-in host under “Fixed CDN hostname” and click “Apply to future requests” to use manual routing. Then select “Automatic” under “Route selection.” Route changes apply to subsequent media requests; a buffered video need not immediately request new data.
7. Turn off “Enable optimization,” then refresh the video page. Automatic route changes stop while playback metrics can still be displayed. Re-enable it to restore automatic handling.

## Review local data controls

- Change the theme or language, close and reopen the dashboard, and confirm the preference remains available.
- “Export diagnostics” downloads a JSON file to the local device. It does not upload the file. The export omits video titles, full page URLs, covers, and signed media addresses.
- Open “Activity log” and click “Clear records” to remove retained session diagnostic records.
- The full privacy policy is available in [English](../../PRIVACY.en.md) and [Chinese](../../PRIVACY.md).

## Expected network behavior

The extension processes Bilibili's media manifests and requests in the video page. Playback and route probes contact media CDNs; probes omit browser cookies but retain signed media URL parameters. When compatibility relay handling applies, the default relay at `proxy-tf-all-ws.bilivideo.com` receives the complete original media URL as a query parameter. The dashboard may also request the public cover image from Bilibili's image service.

These requests deliver or compare the video routes shown in the UI. They do not download executable extension code. All extension JavaScript and the animation library are packaged locally. BiliSmooth does not operate a telemetry endpoint or collect diagnostic files automatically.

## Scope

The extension is designed for Bilibili web video playback on `bilibili.com`. It does not unlock paid quality, regional restrictions, or login-only content. Download speed can fall to zero while playback remains buffered; that alone is not an extension failure. Automatic recovery requires a stalled video and an available alternative route, so smooth playback does not necessarily trigger it.
