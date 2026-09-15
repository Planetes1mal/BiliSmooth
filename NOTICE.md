# Acknowledgments and third-party components

## Bilibili Accelerator

BiliSmooth 基于 [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 开发。感谢 realzza 对海外 B 站播放卡顿、CDN 选线和浏览器播放观察的工作。

本项目延续了上游的 CDN 候选与配置约定、PCDN/MCDN 地址识别、`xy_usource` 来源选择及中转 URL 格式，并在此基础上拆分、重构播放模块。上游已提供悬浮面板、下载速度和缓冲显示；BiliSmooth 进一步完善三态浮窗、可配置常驻指标、按当前倍速换算的可播余量和独立仪表盘。

上游采用 MIT License，版权声明为 `Copyright (c) 2026 realzza`。完整原文保留在 [docs/licenses/bilibili-accelerator-MIT.txt](docs/licenses/bilibili-accelerator-MIT.txt)。BiliSmooth 的项目许可证不替代该上游声明。

本次来源核对使用上游提交 [`81438a3d9060bc59f9af08534bb94f1a4332db6e`](https://github.com/realzza/bilibili-accelerator/tree/81438a3d9060bc59f9af08534bb94f1a4332db6e)：[README](https://github.com/realzza/bilibili-accelerator/blob/81438a3d9060bc59f9af08534bb94f1a4332db6e/README.md)、[核心重写代码](https://github.com/realzza/bilibili-accelerator/blob/81438a3d9060bc59f9af08534bb94f1a4332db6e/src/core/rewrite.js)、[页面运行时代码](https://github.com/realzza/bilibili-accelerator/blob/81438a3d9060bc59f9af08534bb94f1a4332db6e/src/page/bili-accelerator.page.js)、[LICENSE](https://github.com/realzza/bilibili-accelerator/blob/81438a3d9060bc59f9af08534bb94f1a4332db6e/LICENSE)。这是来源核对快照，不代表项目最初基于该提交创建。

BiliSmooth is based on Bilibili Accelerator by realzza and retains upstream routing conventions while developing its own current module structure and controls. The original MIT copyright and permission notice are preserved in the linked license file.

## Locally bundled components

BiliSmooth includes the following locally bundled components and assets:

- Motion 13.2.0 (including Framer Motion, motion-dom and motion-utils portions used by the bundle). MIT notices are preserved in control/motion-LICENSE.txt.
- Tabler Icons outline paths. The applicable MIT notice is preserved in control/tabler-LICENSE.txt.

The BiliSmooth brand mark is a project-specific vector asset. The extension does not fetch executable animation code or icon assets from a runtime CDN.
