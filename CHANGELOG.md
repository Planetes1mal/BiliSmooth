# 更新记录 / Changelog

## 3.0.0 — 2026-11-08

### 中文

- 线路页可以添加自己的线路（upos 或 bcache 节点），最多 8 条，可以随时删除。添加的线路会参加自动测速，也可以固定使用。
- 选择“自动选择”时，有近期测速记录的话，视频会直接从本地区测得最快的线路开播；可以在“设置 → 播放”中关闭。
- 线路页为每条测过速的线路标出预计够哪档画质，速度跟不上当前画质时会提示。测速后，参与对比的线路也会显示速度。
- 自动换线改为按当前视频的实际传输判断：播放卡住时对比最多两条备用线路，只在明显更快时换线；本地区的测速记录决定先试哪条线路。
- 音频卡住导致画面停住时，也会对比线路，并把这段音频改到更快的线路重试。
- 可以在“设置 → 浮窗”中关闭视频页上的浮窗，仪表盘仍可以从工具栏图标或 Alt+Shift+B 打开。
- 浮窗和仪表盘重新设计，主色改为蓝色，原来默认的青绿色会换成蓝色；宽屏时仪表盘内容居中并增加右栏。
- 浮窗也会出现在带语言前缀的视频页（如 /en/），以及稍后再看和收藏夹的列表播放页。
- 视频因地区限制、付费或充电专属不能播放时，会说明原因，不再显示为缓冲。
- 设置保存失败时会提示，并恢复到上次保存的设置。
- 不能再把 Akamai 设为固定线路；原来固定到 Akamai 的设置会改回“自动选择”。

### English

- Add your own servers (upos or bcache hosts) on the Servers page, up to 8, and remove them at any time. Added servers join automatic speed tests and can be fixed.
- With “Automatic” selected, a video starts on the fastest server recently measured in your region. Turn this off under Settings → Playback.
- The Servers page shows which quality each tested server likely covers and warns when its speed falls short of the current quality. After a speed test, the compared servers show their speeds too.
- Automatic switching now follows the current video's actual transfers: when playback gets stuck it compares up to two other servers and switches only to a clearly faster one. Your region's test results decide which servers to try first.
- When stuck audio freezes the picture, BiliSmooth also compares servers and retries that audio on the faster one.
- Turn off the floating control on video pages under Settings → Floating control. The dashboard still opens from the toolbar icon or Alt+Shift+B.
- Redesigned floating control and dashboard in blue; the former default teal becomes blue. On wide screens the dashboard centers its pages and adds a right column.
- The floating control also appears on video pages with a language prefix such as /en/, and on Watch Later and favorites list playback.
- Videos blocked by region, payment or charging-only access now say why instead of looking like buffering.
- A failed settings save is reported, and the last saved settings are restored.
- Akamai can no longer be a fixed server; a fixed Akamai choice returns to “Automatic”.

## 2.8.3 — 2026-09-15

### 中文

- 浏览器中的扩展名称、简介和工具栏提示支持英文显示。
- 提供完整的英文隐私说明。
- 网站访问权限收窄为 bilibili.com。

### English

- Added English text for the extension name, description and toolbar tooltip in the browser.
- Added a complete privacy policy in English.
- Limited website access to bilibili.com.

## 2.8.2 — 2026-09-15

### 中文

首次发布。

- 视频页浮窗显示下载速度、可播余量和当前线路，支持拖动、贴边与展开控制。
- 支持自动或手动选择 CDN，播放卡顿时可尝试备用线路。
- 仪表盘提供下载曲线、线路信息和设置，支持中英文、浅色与深色主题。

### English

Initial release.

- Floating video controls show download speed, playable buffer and the active route, with drag, dock and expand controls.
- Automatic and manual CDN selection, with alternate routes available when playback stalls.
- A dashboard for download history, route information and settings, with Chinese and English text and light and dark themes.
