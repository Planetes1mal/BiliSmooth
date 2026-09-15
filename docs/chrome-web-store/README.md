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

在项目根目录运行 `npm run store:prepare`。脚本检查元数据长度和图片尺寸，再构建、打包并校验扩展，生成 `outputs/chrome-web-store-<版本号>/` 和同名 `-materials.zip`。

上传到商店的代码包是材料目录内的 `BiliSmooth-<版本号>.zip`。外层 `-materials.zip` 用于保存全部文案和图片，不是扩展安装包。实际提交前，公开英文隐私链接须可访问，并在开发者后台核对发布者账号与申报字段。

界面或标识变化后，智能体按需更新素材：`npm run store:artwork` 从项目矢量标识生成宣传图；`npm run build` 后运行 `npm run store:capture`，在独立临时浏览器的离线演示页中展示当前扩展界面，并生成 README GIF。演示页使用本项目制作的视频、封面和 Test 标题，不接收外部视频地址，也不随扩展打包。捕获需要已有 Playwright Chromium 和 Python Pillow；材料打包本身只用 Python 标准库。先检查是否已有依赖，不自动安装工具。新截图只检查一次尺寸、内容和清晰度，不当作播放性能结论。

## 图片规格

- 商店图标：128 × 128 PNG。
- 截图：至少 1 张，最多 5 张；优先使用 1280 × 800，展示实际扩展界面。可分别提供中文和英文截图。
- 小宣传图：440 × 280 PNG 或 JPEG，以项目标识和核心功能为主。
- 横幅：1400 × 560，可选。

图片不包含观看记录、个人账号、未实现功能、测速结论或评分宣传。截图与当前可安装版本一致。商店链接只在实际审核通过并可访问后加入 README。

| 图片 | 内容 |
| --- | --- |
| [icon-128.png](assets/icon-128.png) | 商店图标 |
| [promo-small-440x280.png](assets/promo-small-440x280.png) | 小宣传图 |
| [screenshot-floating-en.png](assets/screenshot-floating-en.png) | 视频页浮窗 |
| [screenshot-dashboard-en.png](assets/screenshot-dashboard-en.png) | 播放概览 |
| [screenshot-routes-en.png](assets/screenshot-routes-en.png) | 线路管理 |
| [screenshot-preferences-en.png](assets/screenshot-preferences-en.png) | 偏好设置 |

使用自制演示视频展示界面。Interface shown with a demo video.

官方说明：[商店介绍](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)、[图片要求](https://developer.chrome.com/docs/webstore/images)。
