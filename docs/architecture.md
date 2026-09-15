# BiliSmooth 架构

## 执行边界

Manifest V3 在匹配的 B站页面 document_start 装载 MAIN 世界的 `playback.js`，并以隔离世界 `content.js` 连接扩展后台。播放协调器是唯一负责探测、排名、目标和恢复的模块；两个界面只消费状态并提交命令。Chrome/Edge 最低版本为 120，与 Motion 本地构建目标一致。

| 模块 | 职责 |
| --- | --- |
| src/core/settings.js | v4 配置白名单、默认值、候选节点和字段校验 |
| src/core/routing-policy.js | 纯地址分析、改写计划与播放信息准备 |
| src/core/media-observer.js | 被动音视频目录、请求身份及 URL 别名 |
| src/core/playback-feedback.js | 有界播放反馈和排序证据 |
| src/page/frame-monitor.js | rVFC、质量计数和时钟活性证据 |
| src/page/network-probe.js | 有界、可取消采样；返回结果，不选线 |
| src/page/request-interceptor.js | JSON/播放信息、Fetch/XHR 等浏览器接入；执行地址决策 |
| src/page/playback-kernel.js | 唯一探测代次、排名、请求归属和恢复协调器 |
| src/page/passive-session.js | 播放观察、开播/卡顿摘要、保存确认、视图快照和诊断 |
| src/page/control-bridge.js | 命令白名单、保存确认及刷新顺序 |
| src/extension/background.js | 串行配置权威、仪表盘复用与文档升级 |
| src/extension/content.js | 隔离世界消息桥、权威配置和保存回执 |
| src/ui/surface.js | 共用 token、控件样式、品牌、播放投影、格式及可用视口测量 |
| src/ui/entry-display.js | 九种实时入口与共享状态图形；不探测网络或伪造数据 |
| src/ui/control/log-view.js | 有界日志快照、历史位置、新记录提示和可打断回到最新 |
| src/ui/motion-entry.js / motion-runtime.js | 锁定 Motion 13.2.0 的本地动画入口与生成文件 |
| src/ui/choice.js | 文档/Shadow DOM 共用可搜索选择组件 |
| src/page/floating-control.js | 三态浮窗、页路由门控、安全布局与生命周期 |
| src/ui/control/ | 概览、线路、设置、记录和视频来源选择 |

## 地址策略接口

`BiliSmoothRoutingPolicy` 只导出两个入口，不执行网络、存储或恢复：

```js
const policy = BiliSmoothRoutingPolicy.createPolicy(config);
policy.route(rawUrl);          // { changed, original, url, reason, targetHost? }
policy.describe(rawUrl);       // 地址类别和媒体/直播等事实
policy.prepare(payload, { ranking });
// { value, changed, rewrites, sampleUrl }

BiliSmoothRoutingPolicy.addressForHost(rawUrl, host); // 改写后的地址字符串
```

`createPolicy` 对配置规范化，组合地址事实、策略意图优先级与渲染方式。`route` 根据模式、节点选择和兼容策略给出结果，直播、非媒体和不适用地址保留。`prepare` 在有变化时返回准备后的对象，收集改写记录与采样地址，并在自动模式下为媒体表示补充有界候选地址；无变化保留输入对象。

`addressForHost` 是明确的地址构造工具，用于探测目标等调用点，不自行判断目标是否应被选择。输入或目标 authority 无效时抛错；候选的业务校验由 settings 与调用点负责。

## 观察与界面快照

会话通过 `BiliSmoothSession` 和 `BiliSmoothRuntime` 提供同一 API：

- `getViewState()` 返回已缓存的媒体观察、配置副本、当前缓冲/倍速、供片信息与保存状态，不再次扫描播放器、构建排名或复制日志。浮窗优先使用它。
- `getState()` 刷新观察并组合排名、开播/恢复摘要、曲线和近期事件，供仪表盘和控制桥使用。
- `getDiagnostics()` 返回独立导出结构，明确去除 `videoMeta`，并限制事件、请求信息和媒体地址的字段范围。

`observedAt` 是观察时间，`hidden` 表示页面可见性；共享 `projectPlayback(snapshot, connected)` 将它们与 media.frameHealth 投影为 disconnected、waiting、error、ended、seeking、paused、buffering、frozen、smooth 或 playing。优化关闭是独立配置状态；只有近期健康且可见的画帧证据才投影 smooth。

`bufferWallSeconds` 是内容缓冲除以实际倍速，`media.currentTime/duration` 来自播放器。速度以近期有效媒体传输 Mbps 转为十进制 MB/s，低于 1 MB/s 时使用十进制 KB/s；未知样本不补造。`videoMeta` 的标题、页面 URL 和公共封面只服务当前视频卡片；页面身份变化先清除旧身份，封面更新独立检查。

## 配置和消息

`bilismooth.config.v4` 是唯一扩展设置权威。后台对 read/patch 串行执行“读取最新值 → 白名单合并 → 写入 → 回执”，避免多页整份覆盖。`floatingFields` 允许 status/speed/buffer，按固定顺序去重规范化，允许空数组；状态图形不受文字字段隐藏影响。

`settings-migration.js` 在当前记录缺失时按数据结构查找偏好，并保存导入备份；不依赖产品名称别名，不改写导入源。存在多个不同的规范化配置时返回读取错误，避免静默挑选。当前 v4 始终优先。配置包含 floatingEntryEnabled、floatingEntryType、floatingEdgeSnap 白名单字段；缺失时补三态、状态 logo、轻吸附默认值，保留用户已有偏好和 schemaVersion 4。

MAIN 世界同步读取启动缓存，然后接收异步权威配置。用户明确固定选择优先于自动排名；已经交付的播放信息需要新设置时，界面提示刷新。保存有唯一 ID、5 秒超时、pending/saved/error 状态；数组按内容比较确认。控制桥的刷新命令等待保存成功后才刷新页面。

自动候选池由 `settings.js` 维护；固定列表由该池加 Akamai host 生成。媒体表示的备用地址最多 8 条，最终选线由当前网络证据决定。

六小时排名缓存使用 `bilismooth.routing.rank.v3.` 前缀，按时区及语言区分。前缀升级使旧候选池的排名不会阻止新池首次探测；用户设置继续使用 v4，播放反馈缓存保持 `biliSmooth.playback-feedback.v1.`。

浮窗通过页面会话提交命令；仪表盘通过扩展消息定向到所选视频的顶层 frame。视频选择拥有代次，旧来源迟到的回复不能应用到新来源；共用设置保存和所选视频的播放状态分开处理。

## 三态浮窗和控制页

浮窗默认生命周期为 edge → preview → panel。关闭 floatingEntryEnabled 后最小状态为 preview；新视频、刷新、退出全屏、外部点击和 Esc 均服从当前最小状态。隐藏文档与全屏隐藏交互层，拖动中发生的生命周期变化也立即生效。

入口、预览和面板共用一个角点锚点，持久化于 bilismooth.panel.position.v3。初始自动定位优先避开已知交互区；明确拖动后的自由位置由用户决定，只按可用视口边界约束。展开/收起不会重新选择角落。边界变化统一换算后再限制位置与尺寸。

入口固定高 54px，宽度按九种内容固定；预览目标 256px，面板目标 312px，可按实际视口收窄。四周保留 8px。拖动不自动吸附；距离安全边 24px 内显示淡色落点提示，松手才以强阻尼 spring 落位。再次按下从动画当前可见位置接管。拖动中同步的内容/两态设置在松手时补做阶段和尺寸更新。

shared.viewport(window) 返回 {left,top,right,bottom,width,height,originX,originY,scaleX,scaleY}。前六项是 fixed inset:0 标记的 getBoundingClientRect 与 visualViewport 可视范围的交集；与原站元素矩形直接比较。originX/Y 是 CSS fixed 原点映射到 client 坐标的位置，scaleX/Y 来自标记 client 尺寸与 CSS 尺寸的比例。写 CSS 坐标使用 (client-origin)/scale，宽高也按比例换算。getViewportMarker(window) 提供同一标记给 ResizeObserver。传统滚动条、双侧 gutter、root CSS zoom 和 visualViewport 变化由同一边界模型处理，不以 innerWidth 或 body 宽度作为可绘制区域。

工具栏、快捷键和浮窗打开同一个 `control/index.html`。其 locate 回复使用 HTML 内嵌版本，并附文档 tabId、当前 sourceTabId 和 hash。后台对旧文档原址 reload，保留浏览器持有的 URL；等待 onUpdated 完成（有限超时）后，只在用户明确从新视频发起时向新文档 select-tab。不需要广泛 tabs 权限，也不使用新 manifest 版本假定旧文档已刷新。

## 动效与热区

入口色面与文字使用成对 `entry-*` token。新配置默认青碧；已有强调色偏好保留，schemaVersion 与存储键不变。深色用墨灰背景及深色调色面。状态 logo 以可见位移和不同几何节奏表达状态，减少动效/隐藏时停止循环。

Motion mini 与 spring 由构建打包为本地 BiliSmoothMotion。背景几何与内容分开变换，展开约 400ms、收起约 240ms。快速反向先读取可见背景矩形，再取消旧动画，避免对 hidden 节点提交样式。选择菜单保留可中断过渡，实例及全局 `syncMotion()` 由控制页和浮窗偏好同步调用，结束当前过渡并完成相应 popover 终态。开关使用原生 CSS。入口悬停装饰在独立视觉层上执行，不修改定位锚点，拖拽接管时清除。

运行记录在固定高度区域中按新到旧排列。查看历史时保留已有节点和 scrollTop，新的 id 仅计入待显示数量；点击新记录按钮才合并快照并平滑回到顶部。滚轮、触摸、滚动键能立即打断，只有新加入的记录动画。记录来源变化与显式筛选分别重置快照，导出仍读取会话诊断。

开关的非交互行、精确关联标签与轨道分离。退出菜单不截获指针，折叠内容 hidden/inert。系统减少动态效果优先于界面偏好，隐藏/销毁清理动画和菜单。新增 resetFloatingPosition 控制命令只重置所选视频的浮窗锚点，不调用网络 reset。

## 播放和诊断边界

下载吞吐是完整三秒观察窗口的字节量 / 墙钟时长，窗口包含已观测的空闲。`lastTransferAt` 表示真实字节到达，`speedObservedAt` 表示数值观察时间：空闲 0 可保持有效，未知为 null。较旧视图缺少新字段时才兼容回退到 lastTransferAt；显式 null 不能回退为旧速率。离线、超过三秒的观察缺口、清空/更换视频会重置观察；后台仍收到的真实字节可以统计，但不恢复后台停帧判断。

入口、预览、面板和仪表盘共用 `surface.format.speed`。仪表盘图表只使用带时间戳的 speedSamples，已观测零值连接，未知及较长时间缺口断开；孤立真实样本显示点。图表插值仅连接已有观测，不生成历史样本。

探测默认每节点最多 768 KiB、4 秒截止，可随新代次取消；可用样本必须收到实际字节，空 2xx 响应记为 `empty-body`。结果和真实媒体流量分开记录。请求、媒体与网络代次隔离晚到结果，避免污染新视频或排名。Fetch 正文维持原生读取语义，资源时序的未验证传输不等于稳定供片；XHR 失败在消费者同步重试前通知协调器。消费者在完成事件中复用同一 XHR 时，在原生 `open()` 清空响应前记录上一请求的完成数据。

自动恢复受用户暂停、拖动进度、后台、固定线路、关闭优化和关闭恢复等条件限制；启动阶段真实请求失败的专用恢复路径保留。手动重试成功换线后，已有等待计时器从当前时刻重新等待五秒。不主动降低画质，不强制暂停来积累缓冲。后续目标、实际请求、观察到的供片和持续恢复是不同证据。

诊断最多保留 200 条近期事件、800 条关键事件及 600 个状态样本。仪表盘独立限制显示条数，筛选和阅读暂停不改变诊断导出内容。

## 构建和验证

`scripts/build.mjs` 先生成 Motion 本地运行时，校验依赖及版本，再将 MAIN 模块按依赖顺序组合成唯一 playback.js。实际 Motion 构建依赖、文件大小和输出以对应产物及 BUILD.json 的源/产物 SHA256 为准。

构建读取输入后写入新目录，再保留原安装目录并替换 dist/extension。品牌 SVG、toolbar PNG 和 favicon 使用内容哈希文件名；安装包包含 Motion 与 Tabler Icons 的 MIT 许可文本。`scripts/package.mjs` 校验文件白名单、清单与产物哈希，然后输出对应版本 ZIP。

[播放验证指南](validation/playback-testing.md) 说明如何选择检查，具体运行结果保存在本地忽略目录。发布通过 [Release 流程](RELEASING.md) 构建 ZIP 与校验文件。
