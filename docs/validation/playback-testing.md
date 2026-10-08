# 播放与 CDN 验证

验证目标分成三个问题：请求是否去了预期线路、真实故障后是否恢复出画面、当前网络下观看是否更稳定。探测排名第一或 HTTP 200 都不能单独回答这三个问题。

## 日常最小检查

从项目根目录运行。先准备 README 中的 Node.js、项目依赖和 Playwright Chromium。

```powershell
npm run build
npm test
```

仅在改动恢复或请求改写时加跑 `test:recovery`；只有需要判断真实网络播放效果时才运行 `test:compare` 或下述 4K 流程。界面检查按受影响的交互选择，不把所有浏览器矩阵加入日常检查。

每次换一个 `--label`，保留失败证据。报告写入 `outputs/<套件>-<版本>/<label>/`。源码改变后重新构建，浏览器脚本会拒绝测试过期安装目录。

| 检查 | 能验证什么 | 不能证明什么 |
| --- | --- | --- |
| `npm test` | 地址策略、真实请求归属、恢复时机、配置与消息契约 | B站当前接口、真实解码或网络速度 |
| `test:recovery` | 原生 XHR 收到部分正文后超时，播放器同步重试走备用线路，MSE 解码并出现真实画帧 | 真实 CDN 可达性、签名有效性和本站播放器的全部重试行为 |
| `test:compare` | 独立浏览器配置中关闭／开启同一扩展的实际请求、首次画帧、缓冲与停帧记录 | 关闭优化组仍加载扩展；不是完全无扩展的原站组，也不单独证明因果 |
| `benchmark` | 不加载扩展的原站、P0、当前构建三组，在账号默认画质下直接导航与立即重载 | 短期顺序采样不证明其他视频、网络或时段的普遍改善 |
| `test:browser -- --rate=2 --quality=4k` | 原生播放器实际 4K 尺寸、2× 倍速和画帧是否同时成立 | 不能用画质菜单标签代替真实解码，也不代表所有视频和长时间播放 |
| `test:cdn` | 同一签名媒体资源在候选 host 上的 CORS、完整 Range 正文、哈希一致性与有界吞吐 | 分片测量不验证解码或持续 4K / 2× 播放 |

本地恢复检查需要 Python 的 `cryptography`。解释器已有该依赖时，可只对当前终端指定路径：

```powershell
$env:BILISMOOTH_PYTHON = 'C:/path/to/python.exe'
npm run test:recovery -- --label=recovery-local-2
```

它仅生成临时 TLS 证书并在回环地址提供测试媒体，不向系统安装证书，也不访问用户已登录的浏览器。

## 真实播放对照

```powershell
npm run test:compare -- --url=https://www.bilibili.com/video/BV14nYT6mE5N/ --seconds=70 --label=network-a
```

`--url` 可选择当前仍可观看的公开视频；`--seconds` 是每阶段观察时间，范围 15–180 秒，默认 70 秒。关闭优化和开启优化各使用新的临时浏览器配置，每组观察首次打开和刷新后的播放。进入视频前先访问同源 `/robots.txt`，写入与扩展存储一致的真实启动缓存，让 MAIN 脚本首次同步读取时就得到该组的启停设置；准备结果记录在 `runs[].preparation`。未传 `--compare` 时，`test:browser` 只观察开启优化的首次打开和刷新。

测试保留真实 B站响应、浏览器解码和网络速度。视频静音，默认倍速为 1×，可用 `--rate` 指定 0.5–3×；默认匿名，不替换站点响应、不限制带宽。需要登录画质时使用下述专用登录流程。媒体证据保留 host、路径、Range、状态码及失败原因，去掉带签名的查询参数。

阅读报告时依次确认：

1. 最终 URL 仍是目标视频。跳转首页、验证页或访问错误都属于环境受阻，不能计作播放成功。
2. 扩展版本及启停状态符合当前组别；出现实际画帧，且大部分采样处于前台播放状态。
3. 查看实际媒体 HTTP 状态与失败原因，以及 `candidateDiagnostics.session` 中的实际供片测量、`races` 与 `switches`。播放器可能继续使用已取得的地址；目标切换不等于后续请求已换线。
4. 结合首帧、可播缓冲、真实画帧停顿和画质看结果。画帧和媒体事件按主视频元素归属，其他视频的播放不能填补主视频的停顿；播放器元素被替换时重新计时。首次加载、暂停、拖动、结束、后台状态不能算成同一类网络卡顿。暂停、拖动或后台状态结束后重新开始停帧计时，不把此前未出帧的时间计入恢复后的卡顿。

若两组都没有卡顿，结论是“该次条件下都可播放”，不能写“已显著提速”。默认 `bad-only` 模式可能无需重写普通健康 CDN；它观察播放并在适用条件下改写线路。

网络列表也包含竞速请求。每路完成 Range 或整轮截止后会停止读取，浏览器可能记录 `net::ERR_ABORTED`；需结合 `candidateDiagnostics.session.races` 的主机、Range、字节和结果，区分竞速结束与播放器请求失败。单个挑战者域名无法解析也不等于播放失败，还要看后续真实供片是否成功。

命令成功退出仅表示取得了有效观察；仍需检查报告中的卡顿与网络指标。脚本以退出码 1 表示扩展加载／配置或原生媒体错误，以 2 表示受阻或观察不足。站点自身的脚本错误会记录，不能未经归属就认定来自扩展。

## 默认画质的三组首播与重载

`benchmark` 用于原站、P0 构建、当前构建的相同条件对照。它与 `test:compare` 分开：`native` 组完全不加载扩展，`p0` 组加载指定的冻结构建，`bilismooth` 组加载当前 `dist/extension`。可继续显式指定 `upstream` 和本地 v0.5.0 构建作为额外组。

先准备已核对的样本文件（例如 `work/p2/videos.json`）和输出目录内的 `plan.md`。样本文件为 `{ "videos": [...] }`，每项填写以下字段；不要用未经核对的示例视频或预期值替代实际元数据。

| 字段 | 内容 |
| --- | --- |
| `id` 或 `url` | 真实 BV/av 标识或正常 B 站视频页面地址 |
| `set` | `popular` 或 `cold` |
| `viewCount`、`publishedAt`、`verifiedAt` | 已核对播放量、上传时间和核对时间；时间使用 ISO 格式 |
| `quality` | `site-default`、`1080p60` 或 `4k`，表示需要验证的实际覆盖，不是切换画质命令 |
| `encoding`、`bitrateBps` | 已有且可核对的参考编码、码率；未知时为 `null`，实际请求对应表示由报告记录 |

至少准备热门、冷门各 3 个。热门要求播放量超过 100 万；冷门要求低于 1000，或上传不满 24 小时。脚本每阶段从真实页面再次核对分类；至少一个视频实际覆盖 1080p60、一个覆盖 4K。`plan.md` 记录平台、网络条件、构建、样本、时间和流量预算；开始后其内容摘要被冻结。

```powershell
npm run build
npm run test:login
npm run benchmark -- --auth "--arms=native,p0,bilismooth" --p0=work/measured-routing-p0-540fd04/extension --videos=work/p2/videos.json --seconds=60 --pause=15 --label=mac --output=outputs/p2-mac
```

`--p0` 指向单独保留的 P0 MV3 安装目录；该构建及其 `BUILD.json` 必须完整。脚本校验 P0 文件摘要、当前构建与源码一致性，并从各自扩展的 service worker 读取、核对各自默认偏好。不要使用当前默认值替代 P0 默认值。

每个视频、每个组使用新的临时浏览器配置，组别顺序随视频轮转。在同一配置内先直接导航，再立即重载；重载保留媒体缓存和该组产生的历史记录。两个阶段均从导航观察原生首帧，保持静音、1×、账号／站点默认画质，不先降低画质、暂停或归零。历史续播位置如实记录。每阶段导航前还记录配置目录是否复用及实际存在的路由历史键，不把重载自动等同于已有选线记忆。账号默认画质不能提供 1080p60 或 4K 时，记录覆盖不足；不能把独立切换画质后的帧作为本流程的导航首帧。

每阶段默认观察首帧后 60 秒前台播放，`--seconds` 可设为 60–180 秒。隐藏、暂停和拖动间隔不计入该时长，额外等待最多 30 秒。首帧前出现隐藏会使该首帧样本无效；与隐藏重叠的整条请求不进入前台等待或前台额外流量统计，但实际接收字节仍计入总预算。

报告按首次／重载分别列出导航首帧、最长视频分片等待、仍未完成的截尾请求、首帧后前 60 秒缓冲耗尽、竞速／切换次数和额外流量，并保留实际尺寸、清单编码／码率／帧率和真实画帧记录。P0 的旧开播探测与恢复次数另行记录，不当作新引擎竞速。组摘要包含首帧中位数和 nearest-rank P90；`comparisons` 核对逐视频、逐阶段的实际画质、尺寸和倍速。条件不匹配、样本不足或观察受阻时，不得作同条件优劣结论。

默认整批预算为 4 GiB、3 小时，输出写入 `--output`。不同 label 共用该目录的预算；`--resume` 只能继续相同设置且尚未开始的项目，不能清除停止状态或静默重跑部分样本。缺少独立登录态时脚本停止；只使用 `test:login` 的专用窗口，不读取日常浏览器配置。

Windows 使用相同版本代码、冻结 P0 构建和样本文件，在自己的独立测试窗口登录；不复制浏览器 profile 或账号凭据。重新核对热度／上传时间仍符合分类，并记录网络是否与 Mac 相同。PowerShell 命令为：

```powershell
npm run build
npm run test:login
npm run benchmark -- --auth "--arms=native,p0,bilismooth" --p0=work/measured-routing-p0-540fd04/extension --videos=work/p2/videos.json --seconds=60 --pause=15 --label=windows --output=outputs/p2-windows
```

执行前同样填写 `outputs/p2-windows/plan.md`。只有报告中同一视频的实际画质、倍率和可见观察条件一致，才能比较 Windows 与 Mac、或各组之间的首帧与卡顿。

## 4K / 2× 实际播放

需要账号权限的画质可以先登录一次，再复用本地登录态：

```powershell
npm run test:login
npm run build
npm run test:4k -- --compare --rate=2 --seconds=70 "--label=4k-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

`test:login` 打开独立的 Chromium 窗口，由你在 B 站完成扫码或账号登录。它不访问日常浏览器的配置；每约 3 秒检查一次登录状态，最多等待 15 分钟，成功后保存并关闭窗口，手动关闭窗口则取消。登录成功并不代表账号拥有该视频的 4K 权限；测试仍通过原生画质菜单选择，不能获取时如实报告账号或画质限制。

`test:4k` 默认选择 `BV1rp4y1e745`，启用 `--auth --quality=4k --headed`。可用 `--url=https://www.bilibili.com/video/BV.../` 换成你能观看的 4K 视频；不传 `--rate` 时为 1×。测量期间保持测试窗口在前台，尽量不操作播放器或同时下载大文件。脚本会依次打开关闭／开启优化的独立窗口，分别观察首次播放和刷新，每阶段默认 70 秒。使用相同登录态，但初始媒体缓存、扩展排名和站点本地存储互相隔离，避免上一组配置混入下一组。登录测试在开始播放时回到 0 秒，避免账号观看历史恢复到不同片段；该动作记在 `requestedStartTime`。画质可选择但有效播放不足时仍保留刷新观察，只有明确的画质或账号门槛才跳过重复刷新。

后续重复测试只需运行第三条命令，PowerShell 会用当前时间生成新的 `--label`；源码改变时先重新构建。登录过期时脚本会停止该组并提示重新运行 `test:login`，不会悄悄改为匿名测试。需要无窗口运行时，可用 `npm run test:compare -- --auth --quality=4k --rate=2 --seconds=70 --label=signed-in-headless`；报告会记录是否无头运行。

登录态只包含 B 站域的 Cookie，保存在已忽略的 `work/playback-auth/state.json`，**该文件是可复用凭据，不要分享或提交**。专用临时测试配置也位于已忽略的 `work/`。报告不包含 Cookie、整页截图、页面标题或整页文字；浏览器媒体属性仅保留解码相关字段，错误中的 URL 查询参数也会去除。非敏感登录进度写入 `work/playback-auth/status.json`。结束使用后，先关闭测试窗口，再删除 `work/playback-auth/` 及需要清理的 `work/playback-<版本>-*/` 临时配置；这不影响日常浏览器。

无需登录时仍可使用原来的匿名入口：

```powershell
npm run test:browser -- --url=https://www.bilibili.com/video/BV1rp4y1e745/ --rate=2 --quality=4k --seconds=70 --label=playback-4k-2x
```

需要关闭／开启优化的对照时，把 `test:browser` 换成 `test:compare`，保留其余参数。默认 `--quality=auto` 使用站点选择；`--quality=4k` 会先确认主视频是否已经实际解码到 4K，否则操作原生画质菜单选择；菜单操作失败后也复核真实尺寸，避免把已在播放的 4K 误判为不可用。选项锁定和账号要求等明确门槛仍如实记录。拿不到所需画质时缩短该阶段并跳过相同条件的刷新，避免重复等待。

判断依据在 `requestedConditions`：需要累计至少 5 秒的有效采样间隔，同时满足前台播放、原生倍速符合请求、实际解码宽或高至少 3840 像素且画帧继续增加。电影比例的 `3840×1920` 可以属于 4K。报告另保留实际媒体请求与 DASH 表示的路径匹配、编码、尺寸和码率；`bandwidthBps` 是清单码率，不是本机下载速度。

| 退出码 | 如何理解 |
| --- | --- |
| `0` | 取得满足所请求条件的有效观察；还需查看卡顿、掉帧和失败请求 |
| `1` | 检查框架、扩展加载／配置或原生媒体出现失败 |
| `2` | 访问受阻、4K／2× 请求条件未满足，或有效观察不足；不能写成通过，也不直接归因于扩展 |

## 有界 CDN 分片比较

```powershell
npm run test:cdn -- --quality=4k --label=cdn-4k
npm run test:cdn -- --auth --quality=4k --include-source-hosts --bytes=1048576 "--label=cdn-4k-$(Get-Date -Format yyyyMMdd-HHmmss)"
npm run test:cdn -- --auth --offset=random --quality=4k --include-source-hosts "--label=cdn-random-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

命令默认测试当前 9 个自动候选；每个 host 两轮，每次前 2 MiB、6 秒截止，逐一请求并轮换每轮起点。先读取原始媒体作为参考，再比较完整正文和 SHA-256；默认计划流量为 38 MiB，取得视频页面的流量另计。它使用独立 Chromium，默认匿名；`--auth` 复用上述本地登录态并验证登录。从真实页面取得 DASH 地址后进入同源 `/robots.txt` 停止播放器继续取流，执行浏览器 Fetch；不加载扩展，CDN 请求不携带账号 Cookie。

可用参数：

| 参数 | 范围与含义 |
| --- | --- |
| `--url` | 正常 B 站 BV／av 视频页；默认 `BV1rp4y1e745` |
| `--quality=4k` | 要求页面实际下发 4K 表示；默认 `highest` 选择已下发的最高尺寸表示 |
| `--hosts=host1,host2` | 最多 20 个明确的 `upos-` CDN host；省略时用当前自动候选池 |
| `--auth` | 复用 `test:login` 保存的登录态；必要时通过原生画质菜单取得 4K |
| `--include-source-hosts` | 加测该媒体表示中原站下发且路径相同的 `upos-` host；不修改默认候选池 |
| `--rounds=2` | 2 或 3 轮 |
| `--bytes=2097152` | 默认从文件开头读取，每次 65,536–2,097,152 字节；参考与候选总计划流量最多 100 MiB |
| `--offset=random` | 随机偏移；默认且固定最多 768 KiB，不与其他 `--bytes` 值并用；资源更短时读取完整资源 |

`--offset=random` 先使用真实媒体响应的 `Content-Range` 总长度；没有取得长度时，只向原始资源追加一次 1 字节 Range 请求。该请求计入计划与实际预算，失败后停止，不重试。参考和全部候选的所有轮次使用相同随机偏移与范围；报告保留 offset、总长度、Range 和长度发现字节。

报告为 `outputs/cdn-<版本>/<label>/cdn.json`。先看 `source` 的真实尺寸、编码与取得方式，再看 `summary` 的 `verifiedRounds`、`minMbps`、`medianMbps`、错误和完整字节数。`recommendations` 只列出每轮都与原始资源一致的候选；字段表示这次采样结果，不能直接当作全地区默认排名。`bitrateAt2xMbps` 由清单中所选视频和音频码率计算，只表示平均消费需求估算。

测试始终保留参考资源的路径与签名，仅替换 host。因此某 host 返回 403 只说明该资源的 host 替换不兼容，不能据此否定原站提供的另一条独立签名备用地址。

该命令正常退出表示采样流程完成，可能仍有候选失败或推荐列表为空。无法取得媒体流、登录失效、没有所需 4K、参考资源不可读等受阻情况退出码为 2；参数错误等启动异常为 1。真实视频、签名路径和所在地改变后，旧的快慢结果可能失效。新增候选采用一次分片筛选加少数有效节点的播放验证，不循环扩大节点清单。

## 出现具体故障时再扩大范围

| 症状 | 下一项检查 |
| --- | --- |
| 切换线路后下载数据不对、XHR 同步重试异常 | `node --test test/routing-contracts.test.js` |
| 拖动、暂停或手动重试后反复换线 | `node --test test/playback-recovery.test.js` |
| 分 P、换画质、播放器替换或后台状态异常 | `npm run test:lifecycle -- --label=lifecycle-local`；报告会单列未复现的原生场景 |
| 浮窗与仪表盘设置不同步 | `node scripts/check-extension-control.cjs --label=mv3-local` |

没有界面修改时不跑整套主题／视口矩阵。一个已复现问题保留一个有区分力的回归用例，复测受影响部分；通过后结束本轮检查，不循环追加假想风险处理。

真实高画质以报告中的实际尺寸和条件检查为准；长时观看、登录会员流及番剧地区限制需要相应环境的独立证据。
