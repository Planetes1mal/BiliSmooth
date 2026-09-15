# 智能体提交与发布工作流

本流程由执行任务的智能体完成。用户要求提交时，完成提交并核对结果；要求发布时，继续推送、跟踪 Actions 和校验公开 Release。不要把执行步骤交还用户。

目标仓库为 [`Planetes1mal/BiliSmooth`](https://github.com/Planetes1mal/BiliSmooth)，正式发布分支为 `main`。版本从 `package.json` 读取。

## 1. 准备改动

1. 查看 `git status --short`、当前分支、远程地址和暂存区，明确本次改动范围。
2. 完成实现及受影响的说明。发布新版本时同步 `package.json`、`package-lock.json` 的两处版本、`src/extension/manifest.json`、`src/page/passive-session.js`，以及 README 中的版本与下载文件名。
3. 在 `CHANGELOG.md` 添加唯一、非空的 `## <version> — YYYY-MM-DD` 节；准备 `docs/releases/<version>.md`，首行以 `# BiliSmooth <version>` 开头。Release 正文直接使用此文件，安装包也包含同一份说明。
4. 按改动选择已有验证。纯流程改动不运行真实网站或完整前端矩阵；播放行为改动按 [播放验证指南](validation/playback-testing.md) 选择有区分力的检查。

公开文案写给使用者：介绍功能、安装、使用及用户可见的变化。测试数量、通过率、测速数据、播放观察、研究过程和内部版本沿革仅保存到本地忽略目录；不放进 README、CHANGELOG、Release 正文或安装包，也不在这些页面链接实验报告。发布前检查说明正文及 ZIP 中附带的文档。

`node_modules/`、`dist/`、`outputs/`、`work/` 和 `archive/` 是本地产物，不加入提交。保留已有无关修改；发布脚本要求干净的工作区，必要时在独立工作区准备已授权的发布内容。

## 2. 生成并执行提交

提交标题使用英文 Conventional Commit，例如 `chore(release): automate verified GitHub releases`。正文按需要说明具体变化与验证。禁止署名尾注和工具生成声明，完整约束见 [AGENTS.md](../AGENTS.md)。

智能体把完整消息写入忽略目录中的 UTF-8 文件，然后传入明确的文件范围：

```sh
npm run commit -- --message-file work/commit-message.txt -- AGENTS.md docs/RELEASING.md
```

这是调用示例，实际路径必须对应本次改动。提交脚本先校验消息和暂存范围，再执行 `git diff --cached --check` 与 `git commit -F`，最后核对实际提交信息。存在无关已暂存内容时会明确报错并保留暂存区；不要通过 reset 或全量 add 绕过。

本地 `.githooks/commit-msg` 和 CI 使用同一个消息校验器。智能体首次接手克隆时检查 `git config --get core.hooksPath` 以及已有 `commit-msg` hook：没有自定义 hook 时执行 `git config --local core.hooksPath .githooks`；存在自定义 hook 时保留它并集成校验调用。

```sh
node scripts/check-commit-message.mjs --file work/commit-message.txt
node scripts/check-commit-message.mjs --range=origin/main..HEAD
```

本地 hook 不是唯一保障：CI 检查本次 push 或 PR 的提交范围；发布入口也检查待发布提交。首次推送检查全部已有提交。

## 3. 执行发布

环境需要 Node.js 24+、Python 3.9+ 和可向目标仓库推送的 Git 认证。已有依赖时无需重新安装；全新克隆执行 `npm ci --ignore-scripts`。本地无需安装 GitHub CLI。Python 可通过 `PYTHON` 环境变量指定，GitHub API 可使用已有 `GH_TOKEN` 或 `GITHUB_TOKEN`；不要把令牌写入仓库或远程 URL。

```sh
npm run release:check
npm run release
```

智能体在所需改动提交后执行发布入口，它将：

1. 核对干净的 `main` 工作区、目标仓库、版本、标签和对应说明。
2. 从已提交版本建立独立工作区，在统一换行的源码上运行核心与少量工作流测试，再调用现有构建、打包及 Python 包校验器。
3. 推送 `main`，创建与版本对应的标签并推送；不覆盖已发布版本或移动标签。
4. 等待标签触发的 **Release** 工作流，跟踪失败步骤与发布状态。
5. 下载公开附件，核对 ZIP、发布的 `SHA256SUMS.txt` 和本地构建，输出 Release 地址。

GitHub Actions 从标签提交构建，使用与本地相同的脚本校验版本、提交信息、测试和包内容，创建草稿并上传 ZIP 与校验文件，下载校验通过后**自动公开发布**。无需用户进入 GitHub 点击 Publish。

只需复核已经触发的发布时执行：

```sh
npm run release:verify
```

## 4. 失败与重试

- 本地验证失败：修复具体失败，提交相关修改后重试；尚未推送的步骤不会发布。
- 推送被拒绝：检查远程状态或认证，用正常 Git 流程处理；不强制覆盖远程。
- Actions 失败：智能体读取失败日志并修复。相同提交的暂时网络失败可重跑工作流；如果需要改变已推送标签对应的源码，使用新版本，不移动旧标签。
- 同标签草稿可由工作流重新上传和校验；已公开 Release 的附件不被覆盖。公开版本需要修复时发布新版本。
- 发布成功后本地跟踪中断：运行 `release:verify`，不重复创建版本。
- 只有账号登录、组织权限等无法代办的条件才向用户说明具体阻塞；继续完成可独立完成的本地工作，不伪称发布成功。

完成后报告提交 SHA、Release 链接、附件校验结果及实际失败或未验证的限制。保留 `outputs/` 中的本地构建与校验依据。

## 设计依据

按 [OpenAI 的技能与提示设计文章](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)，根 `AGENTS.md` 只保留稳定约束、按需入口和完成标准，机械检查由脚本承担。发布流程参考 Wider Gemini 的版本标签校验、共享打包入口和标签触发发布；BiliSmooth 使用自己的构建与 ZIP 校验流程，不引入其商店上传或候选版本约定。
