# 工作区视觉审查

## 参考与检查方法

唯一视觉参考：[Varen 产品页面](https://vanyu0710.github.io/Varen-AI-CAD/)及其[公开工作台截图](https://vanyu0710.github.io/Varen-AI-CAD/images/varen-ai-cad-workspace.png)。已用浏览器实际打开截图，保存在 `artifacts/workspace-visual-review/reference.png`。截图可以证明布局，无法证明动态交互、消息顺序及产品能力。

Varen 的大面积三维视口在左侧，Agent 区域在右侧，输入框位于其底部；特征、属性及过程信息集中在视口下方的标签区域。深色界面用低对比边框区分面板，视图操作、模型信息与对话具有不同层级。

本项目使用 1440 × 960 浏览器视口，提交离线预定义孔板任务、批准真实 FreeCAD 建模，再修改孔径为 8 mm。截图包含实际 GLB、正式修订 2 和真实执行记录。这项检查未调用真实模型服务。

## 修改前的实际问题

证据：`artifacts/workspace-visual-review/before/workspace.png` 和 `before/layout.json`。

- 对话区域整体滚动，选择属性后顶部导航及标题已经滚出可见区域；属性占据对话上方空间。
- 输入框位于历史之前；任务倒序排列，任务内部操作正序排列，阅读方向冲突。
- 执行日志全部展开，两个任务的历史高度已经超过 3500 像素；回复、工具结果和任务状态缺少清晰分组。
- 左侧仅有特征列表与下载，右侧同时承载属性和对话，信息分工失衡。
- 项目标签被挤压换行，顶部操作与面板标题的间距不一致。

## 调整决定

保留现有三列结构：左侧集中显示特征、正式修订属性和下载；中央保留主要模型视口；右侧专门承载 Agent 对话。保持浅色风格，使用白色面板、浅灰蓝背景和蓝色操作强调。无需增加界面框架。

对话导航固定在顶部，历史独立滚动，输入固定在底部。任务按时间正序排列；回复与真实执行记录分别呈现，完成任务的执行记录默认折叠，进行中的记录保持展开。用户浏览旧消息时保留阅读位置，并提供返回最新消息的操作。审批、候选与正式模型沿用现有数据与操作。

## 实际效果与验证

相同视口和正式修订状态：`artifacts/workspace-visual-review/after/workspace.png`；展开操作记录：`after/activity.png`；1024 × 768 布局：`after/compact.png`。审批、真实草图及候选实体分别记录在 `after/approval.png`、`after/candidate-sketch.png`、`after/candidate-solid.png`。

- 模型列宽 880 像素，左侧 210 像素，右侧 350 像素；调整前分别为 900、220、320 像素。模型仍占主要空间，对话获得更适合阅读的宽度。模型面积没有增加。
- 对话导航和底部输入框固定可见，完成任务的记录默认折叠；工具操作保持事件顺序，模型文字单独显示。用户浏览旧记录时，新任务完成后仍保持原阅读位置，点击“查看最新消息”恢复跟随。
- 左侧集中显示对应正式修订的特征、参数及下载，属性独立滚动；候选使用黄色边界及“尚未提交”说明，候选实体优先显示，草图与约束可以展开。查看候选期间，正式修订与下载仍保持原版本。
- 保留浅色风格及三列结构。与 Varen 的主要差异是模型信息位于左侧，参考图使用下方标签区域；没有加入其截图中的复杂机械模型和多视图图片功能。静态参考无法证明其动态交互，本轮未作相关推断。

验证入口：`tests/e2e/workspace-layout.spec.ts` 检查真实创建与尺寸修改、消息正序、底部输入、属性位置、旧记录阅读位置、新任务更新、刷新恢复和紧凑布局；`tests/e2e/approval-preview.spec.ts` 在真实 Worker 完成草图及 Pad 后暂停等待浏览器检查，随后继续验证提交和历史候选恢复。暂停只控制测试检查时机，所有模型和事件均来自实际 FreeCAD 执行。其余浏览器测试覆盖取消、失败保护、项目/对话切换、WebSocket 恢复、特征查看与下载文件独立重开。

本机验证：`npm run typecheck`、`npm run build`、`npm run test:unit`（126 项）、`npm run test:cad`（22 项）、`npm run test:e2e`（11 项）、`npm run verify:pi`。构建保留既有的大文件提示；硬件 GPU、其他浏览器和真实模型服务本轮未验收。实际运行日志位于 `.work/visual-*.log`。

## 使用与实现边界

在项目目录执行 `mkdir -p .work/tmp`、`export TMPDIR="$PWD/.work/tmp"`、`npm run build`，随后 `npm run dev`，打开 `http://127.0.0.1:3000`。工作区访问密钥来自本地数据目录的 `access-token` 文件，请通过本机方式读取。已保存的模型配置继续使用；设置入口仍为“模型设置”。本轮没有修改配置、读取服务密钥或调用模型。在线设置及运行要求见[在线模式](online-mode.md)，离线演示使用 `CAD_PROVIDER=fake npm run dev`，固定样例仍执行真实 FreeCAD。浏览器检查由 `npm run test:e2e` 自动启动隔离的数据目录和服务，无需修改现有项目数据。

本轮应用代码只涉及 `web/src/App.tsx` 和 `web/src/style.css`；另修改两个浏览器测试、一个测试辅助服务及本报告。Pi、模型协议、Gateway 生产代码、CAD 工具、审批、Worker 和验证逻辑保持不变。

Pi 简要核查：`gateway/model-config.ts` → `gateway/agent.ts` → `gateway/pi-adapter.mjs:runPiLoop` 每次调用创建一个 `Agent`（第 76 行），注册阶段允许的 CAD 工具，通过既有 `beforeToolCall` 和顺序执行接口检查调用。`gateway/supervisor.ts` 第 94、195 行分别创建规划和执行阶段的应用会话，分别调用同一个运行入口，因此每个正常获批任务依次创建两个 Agent 实例；没有 Agent 间委派或五个职责 Agent，也未使用 Pi Coding Agent 的 `AgentSession`。CAD 写入、候选、审批及提交由 Gateway/Worker 管理。`gateway/eval-provider.mjs` 选择 Pi 已有的 Chat Completions/Responses 流处理；应用维护的 Pi 协议文件包含关闭 SDK 默认超时的适配（提交 `16be6a8`）。M1/M2 提交 `e8eaaf6` 未改动 Pi 核心执行循环、会话管理或工具分发源码；当前核心源码指纹检查通过。独立的上游 Git 元数据已不存在，指纹能确认记录基线一致，无法凭此审定全部源码与上游每项差异。
