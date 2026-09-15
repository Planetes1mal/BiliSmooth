# Chrome Web Store 材料

本目录保存商店介绍、隐私申报说明和审核操作说明。它们与扩展功能、权限和隐私政策保持一致。

| 材料 | 用途 |
| --- | --- |
| [中文介绍](listing.zh-CN.md) | 中文名称、简短描述和完整商店介绍 |
| [English listing](listing.en.md) | English name, short description, and store description |
| [Privacy fields](privacy-fields.en.md) | Single purpose, permission reasons, remote code, and data handling |
| [Reviewer instructions](reviewer-guide.en.md) | Account requirements and the main review flow |
| [中文隐私政策](../../PRIVACY.md) / [English Privacy Policy](../../PRIVACY.en.md) | 公开的完整数据处理说明 |

商店默认语言使用英文，附加 `zh_CN` 本地化。名称和简短描述与扩展 `_locales` 中的对应条目一致。常规更新内容来自项目 CHANGELOG，完整安装说明只保留在商店介绍和 README 中。

## 生成提交材料

智能体负责生成、检查并交付提交材料。开发中的版本使用 `npm run store:prepare`：脚本检查元数据长度、图片尺寸及格式，再构建、打包并校验扩展，生成 `outputs/chrome-web-store-<版本号>/` 和同名 `-materials.zip`。

已发布版本仅更新商店图片或文案时，复用下载的正式 Release 附件：

```powershell
npm run store:prepare -- --release-assets=outputs/published-v2.8.3
```

指定目录须包含 `BiliSmooth-<版本号>.zip` 和 `SHA256SUMS.txt`。脚本核对安装包的 SHA-256、ZIP 完整性及包内版本，再将原文件汇入材料包；不重新构建或改写正式安装包。已有材料目录和材料 ZIP 会先备份，文件被占用时改用新的 ZIP 文件名。

上传到商店的代码包是材料目录内的 `BiliSmooth-<版本号>.zip`。外层 `-materials.zip` 用于保存全部文案和图片，不是扩展安装包。实际提交前，公开英文隐私链接须可访问，并在开发者后台核对发布者账号与申报字段。

界面或标识变化后，智能体按需更新素材：`npm run store:artwork` 从项目矢量标识生成宣传图；`npm run build` 后，运行 `npm run store:capture -- --locale=zh-CN` 生成中文界面截图，运行 `npm run store:capture -- --locale=en` 生成英文截图。捕获在独立临时浏览器的离线演示页中展示当前扩展界面。演示页使用本项目制作的视频、封面和 `Test video` 标题，不接收外部视频地址，也不随扩展打包。截图需要已有 Playwright Chromium；材料打包使用 Python 标准库。先检查是否已有依赖，不自动安装工具。新截图只检查一次尺寸、内容和清晰度，不当作播放性能结论。

## README 演示视频

运行 `npm run demo:record` 生成本地 60 fps 预览 `outputs/readme-demo/floating-demo-preview.mp4`；`-- --locale=en` 另存英文版 `floating-demo-preview-en.mp4`。真实界面录制与鼠标、镜头合成分开进行：鼠标平滑移动，点击时短暂按压，镜头靠近浮窗，菜单展开后停留，再返回全景。原始录屏与动作时间线保存在忽略的 `work/demo-video-*` 中。脚本不改写 README 或商店截图，也不自动上传。

先交付本地视频供用户确认，确认后再替换公开演示。README 使用 GitHub 附件视频播放器：智能体通过 GitHub 的附件上传接口或 Markdown 编辑器上传 MP4，取得 `https://github.com/user-attachments/assets/...` 链接，单独成段替换中英文 README 中的旧链接，并在 Preview 中确认可以播放。附件接口可复用已有的仓库写入凭据，其调用方式见 [GitHub CLI 的附件实现](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go)；不为获取链接创建 Issue。上传附件不等于提交 README，提交与推送仍按用户请求执行。普通仓库文件路径不能代替附件地址来内嵌播放器。视频保持在 10 MB 以下，使用 H.264 编码；规格见 [GitHub 附件说明](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)。

## 图片规格

- 商店图标：128 × 128 PNG。
- 截图：中文、英文各 4 张，均为 1280 × 800 的 24 位 RGB PNG，无 alpha 透明层。每种语言上传对应的 4 张图片，不将两种语言合并上传；商店每种语言最多 5 张截图。
- 小宣传图：440 × 280 的 24 位 RGB PNG，无 alpha 透明层，以项目标识和核心功能为主。
- 顶部宣传图块：1400 × 560 的 24 位 RGB PNG，无 alpha 透明层。

图片不包含观看记录、个人账号、未实现功能、测速结论或评分宣传。截图与当前可安装版本一致。商店链接只在实际审核通过并可访问后加入 README。

| 图片 | 内容 |
| --- | --- |
| [icon-128.png](assets/icon-128.png) | 商店图标 |
| [promo-small-440x280.png](assets/promo-small-440x280.png) | 小宣传图 |
| [promo-marquee-1400x560.png](assets/promo-marquee-1400x560.png) | 顶部宣传图块 |
| [screenshot-floating-zh-CN.png](assets/screenshot-floating-zh-CN.png) | 中文：视频页浮窗 |
| [screenshot-dashboard-zh-CN.png](assets/screenshot-dashboard-zh-CN.png) | 中文：播放概览 |
| [screenshot-routes-zh-CN.png](assets/screenshot-routes-zh-CN.png) | 中文：线路管理 |
| [screenshot-preferences-zh-CN.png](assets/screenshot-preferences-zh-CN.png) | 中文：偏好设置 |
| [screenshot-floating-en.png](assets/screenshot-floating-en.png) | English: floating panel |
| [screenshot-dashboard-en.png](assets/screenshot-dashboard-en.png) | English: playback overview |
| [screenshot-routes-en.png](assets/screenshot-routes-en.png) | English: route management |
| [screenshot-preferences-en.png](assets/screenshot-preferences-en.png) | English: preferences |

使用自制演示视频展示界面。Interface shown with a demo video.

官方说明：[商店介绍](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)、[图片要求](https://developer.chrome.com/docs/webstore/images)。
