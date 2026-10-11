# BiliSmooth 架构

## 执行边界

Manifest V3 在匹配的 B站页面 document_start 装载 MAIN 世界的 `playback.js`，并以隔离世界 `content.js` 连接扩展后台。播放协调器是唯一负责当前视频的测量、竞速、请求目标和恢复的模块；两个界面只消费状态并提交命令。Chrome/Edge 最低版本为 120，与 Motion 本地构建目标一致。

| 模块 | 职责 |
| --- | --- |
| src/core/settings.js | v4 配置白名单、默认值、候选节点和字段校验 |
| src/core/routing-policy.js | 纯地址分析、改写计划与播放信息准备 |
| src/core/media-observer.js | 被动音视频目录、请求身份及 URL 别名 |
| src/core/delivery-session.js | 每个 cid 的媒体表示、所需码率和原生签名地址 |
| src/core/throughput.js | 视频请求（含未完成传输）的 goodput、首字节和近期窗口 |
| src/core/delivery-policy.js | 纯判定与集中的测量、竞速、恢复和历史阈值 |
| src/core/playback-feedback.js | 按地区保存竞速历史与失败时间，只排列挑战者 |
| src/page/frame-monitor.js | rVFC、质量计数和时钟活性证据 |
| src/page/network-probe.js | 两路有界 Range 竞速；返回实测结果，不决定视频目标 |
| src/page/request-interceptor.js | JSON/播放信息、Fetch/XHR 接入、请求测量及受限合成超时 |
| src/page/playback-kernel.js | 每视频竞速、保持、片段重试、请求归属与恢复协调器 |
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
policy.prepare(payload);
// { value, changed, rewrites }

BiliSmoothRoutingPolicy.addressForHost(rawUrl, host); // 改写后的地址字符串
```

`createPolicy` 对配置规范化，组合地址事实、策略意图优先级与渲染方式。`route` 根据模式、固定选择和兼容策略给出结果，直播、非媒体和不适用地址保留。自动实测路由由内核按会话和请求的 Range 决定；自动模式只忽略保存的 `force` 与 `rewriteAkamai`，固定模式仍采用这两个设置；`mode: off` 或关闭优化始终停用改写与竞速。`prepare` 保留原生备用地址，不扩充候选列表；兼容处理有变化时返回准备后的对象及改写记录，无变化保留输入对象。

`addressForHost` 是明确的地址构造工具，用于合法 UPOS 挑战者等调用点，不自行判断目标是否应被选择。输入或目标 authority 无效时抛错；候选的业务校验由 settings 与调用点负责。

## 观察与界面快照

会话通过 `BiliSmoothSession` 和 `BiliSmoothRuntime` 提供同一 API：

- `getViewState()` 返回已缓存的媒体观察、配置副本、当前缓冲/倍速、供片信息与保存状态，不再次扫描播放器、排列挑战者或复制完整记录。浮窗优先使用它。
- `getState()` 刷新观察并组合当前视频的线路状态、竞速与切换记录、开播/恢复摘要、曲线和近期事件，供仪表盘和控制桥使用。
- `getDiagnostics()` 返回独立导出结构，明确去除 `videoMeta`，并限制事件、请求信息和媒体地址的字段范围。

内核 `getFlags()` 返回 `{needReload, delivery}`。其中 delivery 为 `{status, nativeHost, activeHost, nextTestAt, canTest, comparedHosts}`：status 取 native/testing/switched/compared/current-fastest；nextTestAt 是 Unix epoch 毫秒；canTest 反映真实可用条件；comparedHosts 是本视频历次竞速涉及的不同主机数量，含原线路和挑战者。界面不另算冷却阈值。nativeHost 来自当前视频表示的原始 playinfo base 地址，可为 PCDN/MCDN；只有实际或请求主机与它相符时，界面才可把供片标为原生。

完整 `getState().session` 另含 cid、requiredBps、representations、hosts、switchCount、nextAutomaticAt、races、switches、syntheticTimeouts、racing 和 lastRace。races 保存 at/networkEpoch/currentHost/trigger/range、挑战者、currentMs、完整样本、winner/runnerUp、switched 与 verdict；currentMs 为 null 表示无法给出有限估计。verdict 区分 switched、fragment、current-fastest、below-margin、no-completion。switches 保存时间、来源/目标主机、Range 及 fragment/video 范围；switchCount 只计全视频切换。syntheticTimeouts 为 `{enabled, pending, events}`，enabled 与 pending 为布尔值。

`observedAt` 是观察时间，`hidden` 表示页面可见性；首帧之前播放器为恢复观看位置进行的跳转投影为 buffering，开播等待时长由 startup 摘要记录，不计入卡顿次数；共享 `projectPlayback(snapshot, connected)` 将它们与 media.frameHealth 投影为 disconnected、waiting、error、ended、seeking、paused、buffering、frozen、smooth 或 playing。优化关闭是独立配置状态；只有近期健康且可见的画帧证据才投影 smooth。

`bufferWallSeconds` 是内容缓冲除以实际倍速，`media.currentTime/duration` 来自播放器。速度以近期有效媒体传输 Mbps 转为十进制 MB/s，低于 1 MB/s 时使用十进制 KB/s；未知样本不补造。`videoMeta` 的标题、页面 URL 和公共封面只服务当前视频卡片；页面身份变化先清除旧身份，封面更新独立检查。

会话在已有观察周期中读取站点可见的地区限制提示、初始化数据中的视频不可用错误，以及无可播放数据时的充电专属资格字段（`is_upower_exclusive` 为 true，`is_upower_play` 与 `is_upower_preview` 为 false），输出 `availability`（region、unavailable 或 payment），不把站点门槛解释为等待、缓冲或卡顿。信号消失时清除此状态；紧凑快照不额外扫描。`-404` 本身不能证明删除或地区限制，使用中性不可用说明。该观察不新增网络请求，也不尝试获取被站点拒绝的地址。

两种界面共用本地化说明和错误投影，并停用受限视频的手动线路对比及恢复动作。浮窗的当前视频线路入口停用；仪表盘的共用选线方式、线路选择和应用仍可保存，`applyRoute` 只保存全局偏好，不解除当前视频的站点门槛。`resetNetwork` 只拒绝受限视频的 manual 原因；online、connection-change 等自动网络证据重置仍执行。

## 配置和消息

`bilismooth.config.v4` 是唯一扩展设置权威。后台对 read/patch 串行执行“读取最新值 → 白名单合并 → 写入 → 回执”，避免多页整份覆盖。隔离世界向后台发送消息遇到“接收端不存在”时短暂重试两次；后台仍不可达时，设置读写改由内容脚本按同一迁移与合并规则直接访问扩展存储，只失去跨标签页排队，仪表盘入口报告 `background-unreachable` 并提示重新加载扩展。`floatingFields` 允许 status/speed/buffer，按固定顺序去重规范化，允许空数组；状态图形不受文字字段隐藏影响。

`settings-migration.js` 在当前记录缺失时按数据结构查找偏好，并保存导入备份；不依赖产品名称别名，不改写导入源。存在多个不同的规范化配置时返回读取错误，避免静默挑选。当前 v4 始终优先。配置包含 floatingEntryEnabled、floatingEntryType、floatingEdgeSnap 白名单字段；缺失时补三态、状态 logo、轻吸附默认值，保留用户已有偏好和 schemaVersion 4。

MAIN 世界同步读取启动缓存，然后接收异步权威配置。用户明确固定选择优先于自动会话路由；已经交付的播放信息需要新设置时，界面提示刷新。保存有唯一 ID、5 秒超时、pending/saved/error 状态；数组按内容比较确认。控制桥的刷新命令等待保存成功后才刷新页面。

自动候选池由 `settings.js` 维护，固定线路只接受合法的 bilivideo UPOS 主机。旧的 Akamai 固定配置迁回自动。Akamai 可以作为自动竞速候选，但必须使用 B站为当前表示下发的原始签名地址，不能从 UPOS 地址替换主机生成。原生备用地址及其顺序保留，自动模式不扩充 backupUrl。

会话按 cid 保存表示、码率和按主机归类的下发地址。所需码率取本会话实际请求过的最高视频码率，并按当前倍速换算。自动模式从原站下发的线路开始，既有 PCDN/MCDN 兼容处理继续适用；固定模式沿用用户的目标与改写范围。原生下发主机、当前会话目标、实际请求主机与实际供片主机分别记录。

`playback-feedback.js` 只导出 `createHistory`。地区键为 `bilismooth.delivery-history.v1.<时区>|<语言>`，内容是 `{version: 1, rows: [{host, meanBps, weight, measuredAt, failedAt}]}`；meanBps 单位为 bit/s，weight 是有效样本权重，两个时间字段是 Unix epoch 毫秒。`recordRace` 记录竞速结果，`recordFailure` 记录失败，`challengers` 只排序调用方传入的本视频候选；`importFailures` 只服务启动迁移，`snapshot/clear` 提供持久化快照与清除。历史以三天半衰期降低旧样本权重，只排列挑战者，不设置当前视频目标。一小时内失败的主机后置；未知主机按已测主机的下位中位数参与排序，全未知时同分，同分优先大陆镜像。每个挑战者名额有五分之一机会从同一失败等级的剩余主机中探索。

创建内核时仅扫描一次 `biliSmooth.playback-feedback.v1.` 与 `bilismooth.routing.rank.v4.` 旧键。前者按原地区后缀把一小时内有效 failedAt 合并到新历史，成功写入后删除旧键；后者直接删除，不导入旧排名或探测速率。迁移和读取历史都不发起网络请求。历史读取校验合法 CDN 主机、数值和时间，不因当前视频候选不同而删除其他合法主机记录。可请求的候选仍由本视频下发地址与候选池决定，历史不产生目的地址。

浮窗通过页面会话提交命令；仪表盘通过扩展消息定向到所选视频的顶层 frame。视频选择拥有代次，旧来源迟到的回复不能应用到新来源；共用设置保存和所选视频的播放状态分开处理。

## 三态浮窗和控制页

浮窗默认生命周期为 edge → preview → panel。关闭 floatingEntryEnabled 后最小状态为 preview；新视频、刷新、退出全屏、外部点击和 Esc 均服从当前最小状态。隐藏文档与全屏隐藏交互层，拖动中发生的生命周期变化也立即生效。

播放浮窗也支持已选择视频的 `/list/watchlater` 和 `/list/ml<收藏夹编号>` 播放页，使用 bvid（否则 oid）区分列表中的当前视频。视频卡片使用当前条目的公开 `/video/BV…/` 或 `/video/av…/` URL，不携带收藏夹编号或查询参数。未选择视频的列表页不挂载浮窗；首页、搜索页与直播页保持原有边界。

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

选线测量与界面速度图分开：goodput 使用前台有效的视频 XHR，包含正常完成及超时、中止等未完成传输；字节除以请求发出至终止的完整 elapsed，包含首字节等待和收到部分字节后的停顿。单样本至少 16 KiB、累计至少 128 KiB 才形成可信估计；半衰期为 2 秒和 5 秒的两个平均取较低值。近期窗口保留达到 4 MiB 或 8 秒所需的整条传输样本，并提供首字节中位数。与隐藏时段重叠的样本不参与选线，音频和未验证 Fetch 时序不作为视频 goodput。

开播不进行全候选池探测。自动决策只遍历当前 cid、网络和媒体代次的真实在途视频 XHR；仅 waiting、frozen 或低缓冲不产生竞速。请求发出及进度/完成通知会立即求值，250 毫秒周期补充无新事件时的等待判断；播放证据需在 1500 毫秒内，隐藏重叠请求不参与。每个 cid/表示/完整 Range 自动最多竞速一次。纯判定覆盖三类触发：至少 128 KiB 的视频 Range 等待首字节达到 1 秒且缓冲不足 3 秒；或已传 0.5 秒/128 KiB、速率低于需求 1.3 倍、预计剩余超过 1 秒且晚于缓冲耗尽前 2 秒。近期 4 MiB 或 8 秒速度低于需求 1.2 倍且缓冲不足 30 秒时判为持续不足；30 秒内两次真实视频失败也可触发。未完成视频片段被播放器中止时，不论已收到多少字节，只要请求持续至少 1.99 秒、属于当前媒体代次和网络，并处于开播等待或非暂停、非跳转的播放中，就计为主机失败；旧播放器请求与短时取消不计入该中止规则。1.99 秒门槛为播放器名义 2 秒取消的计时偏差留出 10 毫秒，避免已放弃的请求因略短于 2 秒而被重新指向同一失败主机。条件、门槛与单位集中在 `delivery-policy.js`。

竞速对该片段接下来所需的字节并行比较最多两名挑战者，每条使用一个闭合的单 Range 请求，媒体正文最多 768 KiB，每次两路合计最多 1.5 MiB（2 × 768 KiB = 1,572,864 字节），4 秒截止。HTTP/TLS 等网络协议开销与正常播放流量不在这个正文限额内。对比请求不带 Cookie，但使用播放器所需的签名地址。当前线路的竞速比较速率取本次请求速率与该主机近期窗口速率的较低值，使短时突发不能掩盖此前未完成传输的停顿。首个完成样本用时不超过当前线路估计的三分之二才可切换；被竞速 Range 的任何一次尝试（包括播放器自己在原生备用上的重试）若在竞速开始后、胜者之前于其他主机完成，判为当前最快，不切换；在途零字节挂起的速率按零处理，不回退为该主机先前的高速。失败或取消的未完成竞速不冒充完整速度样本。

若主机此前可信 goodput 与近期窗口速率均达到需求 1.2 倍且 30 秒内无真实失败，一次 stuck 只改变当前表示与完整 Range 的重试目标。会话锚定原来实际供片的健康主机，避免播放器粘住临时备用地址；之后再次挂起会看到本次失败证据。其余已测得明显更快的情况才切换整个视频。播放器请求失败后，优先使用最近竞速已完成且未在该片段失败的亚军；亚军不存在或也失败时，保留播放器本次给出的原生重试地址，不强行拉回失败目标。音频、视频各自的表示与 Range 失败记录互不混淆。

合成超时仅用于视频 Range：摘下播放器赋值的回调，执行原生 abort，再调用其 ontimeout 与 onloadend，让播放器自己的重试逻辑使用已选地址。竞速得出结论时，作用于该 Range 当前在途、且不在胜者主机上的最新一次尝试，因为播放器可能已经自行取消并在原生备用上重试。没有可用的属性回调时不合成；每个表示与 Range 最多一次，与是第几次尝试无关。3 秒内未观察到同一片段重试即停用本页的合成超时，记录原因；合成动作本身不重复计为主机真实失败。

每次比较产生结论后至少 10 秒内不再竞速；自动间隔之后按两倍增长，手动“测试其他线路”仍遵守至少 10 秒间隔。每个 cid 的全视频切换最多四次，手动不绕过上限。播放器替换、切回同一视频或重置网络记录都不重置该视频的切换额度和冷却。隐藏、已起播后的暂停或跳转不触发自动竞速；首帧前的实际加载等待仍按开播证据判断。不主动降低画质，也不强制暂停积累缓冲。

“测试其他线路”不保存播放设置；“重置网络记录”清除当前会话网络状态和当前地区历史，其他地区历史保留，本身不触发探测或竞速。manual、online、connection-change 与 clearData 的网络重置都遵循这一范围。它会中止在途竞速、清除当前测量、临时片段目标、失败窗口与亚军，使旧 activeEpoch 失效；每个 cid 的 switchCount、冷却截止、自动竞速过的 Range 集合及已经保留的 races/switches 记录仍保留，合成超时的本页停用状态也不重置。两种界面消费同一轻量 delivery 状态与实际冷却截止时间，区分原生、正在对比、已切换、已比较和有测量支持的当前最快。挑战者略快但未达到切换门槛时仅表示已比较，不称当前最快。

会话导出包含按时间排列的 races、switches、合成超时记录，以及各主机 goodput 与首字节中位数。竞速记录区分完整样本、胜者、亚军和判定；切换记录区分仅当前片段与整个视频。导出保留主机、时间和 Range，不包含签名 URL。请求、cid、表示和网络代次隔离晚到结果。Fetch 正文维持原生读取语义；XHR 完成在消费者复用同一实例前记录，失败在消费者同步重试前通知协调器。

通用诊断窗口最多保留 200 条近期事件、800 条关键事件及 600 个状态样本；每视频的 races/switches 与合成超时事件在页面会话中独立保留。仪表盘独立限制显示条数，筛选和阅读暂停不改变诊断导出内容。

## 构建和验证

`scripts/build.mjs` 先生成 Motion 本地运行时，校验依赖及版本，再将 MAIN 模块按依赖顺序组合成唯一 playback.js。实际 Motion 构建依赖、文件大小和输出以对应产物及 BUILD.json 的源/产物 SHA256 为准。

构建读取输入后写入新目录，再保留原安装目录并替换 dist/extension。品牌 SVG、toolbar PNG 和 favicon 使用内容哈希文件名；安装包包含 Motion 与 Tabler Icons 的 MIT 许可文本。`scripts/package.mjs` 校验文件白名单、清单与产物哈希，然后输出对应版本 ZIP。

[播放验证指南](validation/playback-testing.md) 说明如何选择检查，具体运行结果保存在本地忽略目录。发布通过 [Release 流程](RELEASING.md) 构建 ZIP 与校验文件。
