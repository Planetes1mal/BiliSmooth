# 参与 BiliSmooth

欢迎提交可复现的问题、文档改进和范围明确的修复。中文、英文均可。

## 报告问题

在 [Issues](https://github.com/Planetes1mal/BiliSmooth/issues) 中描述：扩展版本、浏览器版本、系统、可公开的视频链接、画质／倍速、优化模式和复现步骤。网络问题可自愿提供国家／地区与运营商，不需要精确位置或 IP。

如果方便，从仪表盘导出诊断记录，先检查内容再附上。不要上传 Cookie、账号资料、完整带签名的媒体链接、浏览器用户目录或全部 `work/`、`outputs/`。隐私说明见 [PRIVACY.md](PRIVACY.md)，安全问题见 [SECURITY.md](SECURITY.md)。

## 本地开发

需要 Node.js 24+；打包验证使用 Python 3.9+ 标准库。运行时依赖锁定在 `package-lock.json`，界面脚本在构建时打包进扩展。

```sh
npm ci --ignore-scripts
npm run build
npm test
node scripts/package.mjs
python scripts/verify-package.py
```

在浏览器扩展管理页加载 `dist/extension`。修改源码后重新构建、重新加载扩展，再刷新视频页。

仅在需要真实浏览器验证时安装 Playwright Chromium：

```sh
npx playwright install chromium
node scripts/check-extension-control.cjs --label=my-change
```

播放测试及特殊 Python 依赖见 [播放验证指南](docs/validation/playback-testing.md)。CI 默认运行现有核心测试与构建／打包检查；不在每次提交时运行真实网站或大规模界面矩阵。

## 修改范围

- 一次修复一个可说明的问题，优先复用现有测试；不要为简单文案、样式或配置调整增加成批前端测试。
- 播放逻辑改动说明触发条件、改变后的行为和验证方式。区分本地模拟、真实媒体请求和实际解码证据。
- 界面改动附一张必要的截图即可。截图中的模拟数据需注明，不能作为提速证明。
- 不承诺解锁画质、会员权益或地区限制；不得把短时顺畅播放写成普遍提速。
- 保留实际参考与复用来源的许可，见 [NOTICE.md](NOTICE.md)。

目录职责见 [架构说明](docs/architecture.md)。提交源码、文档及必要测试；安装包通过 GitHub Release 分发，不提交 `dist/`、`outputs/`、`work/`、`archive/` 或依赖目录。

## Pull Request

说明问题、最终行为和已完成的验证；没有验证的条件直接注明。小改动保持简短，不需要额外审查模板或重复测试。提交消息使用英文 Conventional Commit，禁止署名尾注或工具生成声明，见 [AGENTS.md](AGENTS.md)。智能体执行提交及发布的流程见 [RELEASING.md](docs/RELEASING.md)。

## English summary

Issues and pull requests are welcome in Chinese or English. Include a reproducible scenario and relevant versions, keep changes focused, and reuse existing tests. Redact private data before sharing diagnostics. Build with Node.js 24+, run `npm test`, and verify the ZIP with `python scripts/verify-package.py`. Browser tests are selected by the changed behavior; a passing fixture is not proof of real-world playback performance. Preserve upstream licenses and keep generated outputs out of Git.
