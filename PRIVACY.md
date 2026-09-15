# 隐私说明

适用版本：BiliSmooth 2.8.2。更新日期：2026-09-15。

BiliSmooth 在浏览器本地处理播放状态、选线和设置。当前运行时代码没有配置向开发者上传诊断或使用统计的接口；播放、测速和封面显示会向 B 站及相关内容服务发出网络请求。

## 访问范围与用途

扩展声明 `storage` 权限，以及 `https://*.bilibili.com/*` 和 `https://*.bilibili.tv/*` 的页面访问权限。页面脚本用于读取播放信息、观察视频状态并按设置改写 Fetch/XHR 请求；仪表盘读取这些站点标签页的标题、地址和播放状态，用于选择正在观看的视频。当前清单没有声明 Cookie、历史记录或全站访问权限。[权限清单](src/extension/manifest.json)、[标签页连接](src/ui/control/live.js)

在匹配页面中，扩展会处理视频源地址、媒体响应、CDN 主机、传输字节和耗时、播放位置、倍速、分辨率、缓冲区、画帧计数及可见状态。视频标题、去掉查询参数的页面地址和公共封面用于本地界面。用于实际取流的签名地址会暂存在页面内存中。[请求接入](src/page/request-interceptor.js)、[播放观察](src/page/passive-session.js)

## 本地保存什么

| 位置 | 内容与用途 |
| --- | --- |
| 扩展的 `chrome.storage.local` | 共用播放与界面偏好、动效开关；需要导入旧偏好时保留导入备份。未使用 `chrome.storage.sync` |
| B 站页面的 `localStorage` | 启动配置缓存、浮窗位置、按浏览器时区和语言区分的节点排名与近期播放反馈 |
| 当前页面内存 | 播放元数据、请求关联、速度曲线、开播／卡顿记录及诊断样本 |

排名缓存按六小时有效期使用，近期稳定与超时反馈分别使用十分钟和两分钟的有效窗口；这些是选线时的有效期，不表示过期存储立即从磁盘删除。页面 `localStorage` 与该站点共享，页面脚本可以访问，不能把它当作只有扩展可读的私密存储。[设置保存与导入](src/core/settings-migration.js)、[排名及反馈保存](src/page/playback-kernel.js)、[反馈有效期](src/core/playback-feedback.js)、[浮窗位置](src/page/floating-control.js)

## 网络请求发给谁

- **播放请求**：发送到原站提供的媒体地址，或设置和路由规则选择的 CDN。改写保留媒体路径及签名查询参数；原播放请求的凭据选项沿用调用方的行为。目标服务器会收到完成该请求所需的地址参数、客户端 IP 及浏览器正常发送的请求信息。[地址策略](src/core/routing-policy.js)、[Fetch/XHR 接入](src/page/request-interceptor.js)
- **自动探测**：向候选 CDN 请求真实媒体字节，用于本地比较。请求设置 `credentials: 'omit'`，但 URL 仍可能带有 B 站生成的签名或账号关联参数。当前默认候选为 9 个，每节点在读取达到约 768 KiB 或四秒截止时停止；探测会产生额外流量，失败和取消也可能已传输部分字节。[候选设置](src/core/settings.js)、[探测实现](src/page/network-probe.js)
- **MCDN 中转**：默认 `proxy-all` 策略对匹配的 MCDN 媒体使用 `proxy-tf-all-ws.bilivideo.com`。原媒体的**完整 URL，包括查询参数**被编码进中转请求的 `url` 参数，因此中转服务会接收原地址。配置支持 `proxy-*.bilivideo.com/.cn/.net` 形态的中转主机；手动 CDN 则限定为校验通过的 `upos-` 主机。两者都不是向 BiliSmooth 开发者自建服务上传数据。[默认配置与校验](src/core/settings.js)、[中转格式](src/core/routing-policy.js)
- **封面图片**：仪表盘可以从 `https://*.hdslb.com` 加载当前视频的公共封面；这是独立的图片网络请求。[封面显示](src/ui/control/app.js)

B 站及其内容服务如何保存访问日志，由相应服务决定。扩展的本地处理方式不会取消原站自身的网络请求或数据处理。

## 诊断导出与保留

点击“导出诊断”会在本地生成 JSON 下载，不会自动提交给开发者或 GitHub。导出包含扩展设置、CDN host、时间戳、播放位置与倍速、缓冲、帧与传输统计、错误和恢复记录；排除视频标题、封面、页面完整地址和媒体签名 URL。记录上限为 200 条近期事件、800 条关键事件、600 条观察样本，以及最多 16 条当前未完成请求的摘要。[诊断字段](src/page/passive-session.js)、[本地下载](src/ui/control/app.js)

这些性能和时间数据仍可能反映观看时段。公开分享文件前，可自行检查内容；文件下载后的保存、转发和提交由你控制。

## 控制与删除

- 关闭优化停止后续请求改写和自动选线，刷新视频页后使用新状态；界面仍可观察播放指标。
- “清空运行记录”清除当前会话已保留的事件与观察。“重新评估网络”重置当前排名和近期反馈，并可能立即开始新的探测。
- “重置播放设置”恢复默认配置，不等同于删除所有本地存储；浮窗位置、动效偏好及旧偏好导入备份有各自的保存位置。
- 完整移除时，通过浏览器移除扩展并清理相关扩展数据；B 站页面中的 `localStorage` 需通过浏览器站点数据管理另行清除。清除站点数据可能同时影响 B 站的登录状态与偏好。已经导出的 JSON 文件需在下载位置自行删除。

本说明描述当前源码行为；对应实现入口见上文链接，版本变化时应同步更新本说明。

## English summary

BiliSmooth processes playback observations and preferences locally. It has no configured developer telemetry or automatic diagnostic-upload endpoint. Playback and probes contact Bilibili/CDN services; MCDN relay mode sends the complete original media URL to the configured relay, and the dashboard may load public cover images. Preferences live in extension-local storage and website-readable localStorage. Diagnostic export is a user-triggered local JSON download that omits video metadata and signed media URLs but includes host, timing, settings and performance information. Removing the extension does not by itself describe or clear all website storage or previously exported files; those are managed separately in the browser and filesystem.
