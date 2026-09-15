# BiliSmooth

**简体中文** | [English](./README.en.md)

[![Version](https://img.shields.io/github/v/release/Planetes1mal/BiliSmooth?color=0f766e&label=version)](https://github.com/Planetes1mal/BiliSmooth/releases/latest)
[![License](https://img.shields.io/github/license/Planetes1mal/BiliSmooth?color=64748b)](./LICENSE)

为 B 站网页播放切换 CDN 线路，在视频旁查看下载速度和缓冲余量。

[下载](https://github.com/Planetes1mal/BiliSmooth/releases/latest) · [更新记录](./CHANGELOG.md) · [反馈问题](https://github.com/Planetes1mal/BiliSmooth/issues)

<img src="https://raw.githubusercontent.com/Planetes1mal/BiliSmooth/main/docs/images/floating-demo.gif" width="960" alt="BiliSmooth 视频页浮窗：查看下载速度和可播余量，展开后选择播放线路">

*使用自制演示视频展示界面。*

## 功能

- **边看边查看状态**：浮窗显示下载速度、可播余量和当前线路，支持拖动、贴边和收起。
- **按倍速显示可播时长**：例如已缓冲 20 秒视频，在 2 倍速下显示约 10 秒可播余量。
- **自动或手动选线**：自动选择 CDN，也可以固定一条线路；播放卡住时，可尝试备用线路。
- **集中查看和调整**：仪表盘提供下载曲线、线路信息和设置，支持中英文界面、浅色与深色主题。

<img src="https://raw.githubusercontent.com/Planetes1mal/BiliSmooth/main/docs/images/dashboard.png" width="960" alt="BiliSmooth 仪表盘，展示播放状态、下载曲线和线路信息">

## 安装

适用于桌面版 Chrome 和 Edge。Chrome 需要版本 120 或更新。目前通过 GitHub 下载，尚未在 Chrome 应用商店上架。

1. 打开 [最新 Release](https://github.com/Planetes1mal/BiliSmooth/releases/latest)，下载 `BiliSmooth-<版本号>.zip` 并解压。
2. 在地址栏打开 `chrome://extensions`；Edge 使用 `edge://extensions`。
3. 开启 **开发者模式**，点击 **加载已解压的扩展程序**。
4. 选择解压后包含 `manifest.json` 的文件夹。
5. 刷新 B 站视频页，即可看到浮窗。点击浏览器工具栏中的扩展图标，可以打开仪表盘。

请下载 BiliSmooth 安装包，而非 GitHub 自动提供的 **Source code**。安装后保留解压文件夹，浏览器会继续从中加载扩展。

**更新：** 将新版文件解压到原安装目录，在扩展管理页重新加载 BiliSmooth，再刷新视频页。已有设置会保留。

## 使用

正常打开 B 站视频即可，默认开启自动选线。点击浮窗可展开控制面板，选择线路或调整显示内容；手动固定线路后，自动换线会暂停。

需要恢复原站播放线路时，在浮窗中关闭优化，并按提示刷新视频页。

扩展保留播放器中选择的画质，不会解锁会员清晰度或地区限制。不同网络下的线路表现可能不同。

## 隐私

无需额外注册，也不向开发者发送遥测数据。设置保存在本机；播放请求会发送到所选 CDN，启用 MCDN 代理时会通过对应代理服务。

数据处理和权限用途见 [隐私说明](./PRIVACY.md)。

## 贡献与许可

欢迎通过 [Issues](https://github.com/Planetes1mal/BiliSmooth/issues) 报告问题或提出建议。参与开发请阅读 [贡献指南](./CONTRIBUTING.md)。

本项目以 [MIT 许可证](./LICENSE) 开源。线路处理与配置部分基于 [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 改造，界面使用 Motion 和 Tabler Icons。完整归属见 [第三方声明](./NOTICE.md)。
