# Chrome Web Store privacy fields

These declarations describe BiliSmooth's data handling and the reasons for its requested permissions. The public privacy policy is [PRIVACY.en.md](../../PRIVACY.en.md).

## Single purpose

Help users manage Bilibili web video playback by selecting media delivery routes and showing playback status, download speed, and playable buffer. Route controls, automatic stall recovery, and the dashboard all support this playback purpose.

## Permission justification: storage

Store playback and appearance preferences locally in the browser and share those preferences between Bilibili tabs and the extension's dashboard. Settings include automatic/manual routing, recovery preferences, language, theme, floating panel options, and motion. The extension uses chrome.storage.local, not chrome.storage.sync. It does not upload these settings to a developer service.

## Host permission justification: https://*.bilibili.com/*

Run the packaged playback scripts on Bilibili pages, observe the video and its media requests, display the floating controls, and apply the user's route settings. The same site access lets the dashboard identify open Bilibili tabs by title and URL and communicate with the selected page. The extension connects at document start so it can observe the player's initial media requests. It does not request access to unrelated websites or the browser history database.

## Remote code

**Selection: No, I am not using remote code.**

All extension JavaScript, including the Motion animation library, is bundled in the uploaded ZIP. The extension does not load remote JavaScript or WebAssembly and does not evaluate downloaded text as executable code. Remote media manifests are parsed as data; audio/video segments and public cover images are data resources. CDN and relay hostnames select media delivery destinations, not executable extension code.

## Data handling categories

“Handled” includes local processing and transmissions to content providers. The following mapping explains the scope of the dashboard categories for this extension.

| Dashboard category | Declaration scope |
| --- | --- |
| Web history | Declare. URLs and titles of open Bilibili tabs, media URLs, and page/media request information are used for video selection and playback routing. This does not mean access to the browser history database or unrelated sites. |
| Website content | Declare. Video metadata, playback manifests, and media responses are processed for the floating controls and delivery selection. Public covers may be loaded in the dashboard. |
| User activity | Declare. Playback position, speed, buffering, frames, route changes, and related timestamps are processed locally. A user can explicitly export a local diagnostic file. No general click, keystroke, or browsing analytics are uploaded. |
| Authentication information | Declare the media authorization parameters carried in signed URLs. They are used only to retrieve the requested media and may be forwarded to the chosen CDN or compatibility relay. No login form, password, or authentication-cookie database is read. |
| Personally identifiable information | Declare any account-associated identifiers already present in the media URL and passed through with it. The extension does not ask for a name, email address, or account profile, and does not build a user identity database. |
| Location | Declare network IP exposure to Bilibili/CDN/relay/image services and local use of browser time zone. The extension does not request GPS/geolocation or independently look up the user's physical location. |
| Financial and payment information | Not handled. |
| Health information | Not handled. |
| Personal communications | Not handled. |

The signed URL's contents are determined by Bilibili, including when a user is logged in. They are not stripped before media delivery because they may be required to retrieve that media. In relay mode, the complete original media URL is included in the relay request. Signed URLs are excluded from diagnostic exports and persistent extension caches.

## Data use statements

- BiliSmooth does not sell user data or transfer it to advertising platforms or data brokers.
- BiliSmooth uses and transfers information only for its disclosed playback assistance features and support explicitly requested by the user.
- BiliSmooth does not use or transfer data for creditworthiness or lending.
- Diagnostics stay on the device unless the user separately chooses to share them. There is no automatic upload to GitHub or the developer.

## Privacy policy URL

https://github.com/Planetes1mal/BiliSmooth/blob/main/PRIVACY.en.md

## Policy references

- [Privacy fields and permission justifications](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ, including local processing](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
