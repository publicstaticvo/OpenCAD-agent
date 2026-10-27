# 在线模型与工作区验证记录

日期：2026-10-27。测试使用本机私有 `model.yaml`、`advanced-model.yaml`，凭据没有写入本文。四项需求的接口及恢复行为见 [工作区功能说明](workspace-contracts.md)，用户配置和启动见 [在线模式](online-mode.md)。

## 真实环境

`npm run doctor` 实际加载 FreeCAD 1.1.3、Python 3.11.14、OCCT 7.8.1，通过 UDS、staging 和内核文件锁检查。`npm run verify:pi` 通过源码指纹检查。浏览器使用本机 Chrome 和 SwiftShader WebGL；未验收硬件 GPU。测试目录、配置、脱敏跟踪和下载文件均在 Git 忽略的 `.work/` 中。

## 真实模型验收

### OpenAI Responses

`advanced-model.yaml` 配合 `CAD_MODEL_PROTOCOL=openai-responses` 的完整浏览器联合验收通过，耗时约 5.4 分钟，输出目录 `.work/live-responses-acceptance/`：

- 在网页选择协议、发现模型并保存；实际完成文本流、隔离 Worker 的 `cad_inspect` 调用及工具结果回传三个请求。检查私有配置权限、自动生成的 approval、密钥不进入公开配置或浏览器存储。
- 创建 40×30×10 mm 长方体；新建独立对话，将 `base.Length` 修改为 15 mm。检查同项目任务互斥、对话命名和历史隔离、独立上下文、当前正式模型共享、刷新及执行记录偏好恢复。
- 下载 FCStd、STEP、GLB，由独立原生 FreeCAD 进程重新打开和验证实体、尺寸、体积及导出几何。
- 原项目只读任务执行期间，建立第二个项目及第二个对话，创建 20×20×5 mm 长方体；切换恢复正确模型和历史，验证全局串行 Worker 与项目数据隔离。
- 实际关闭浏览器 WebSocket 后重新连接，恢复正式版本。取消模型修改后 HEAD 保持 2。
- 收到已持久化的模型文字增量后向真实 Gateway 发送 SIGKILL，由测试启动器重新启动进程；任务恢复为 `interrupted`，刷新仍显示中断前的部分回复，HEAD 保持 2，未自动重放操作。
- 无效协议及真实不可连接地址的配置验证失败，保留之前可用的模型设置，并显示失败阶段。

### OpenAI Chat Completions

原 `model.yaml` 的文本流及只读工具往返通过，当前完整联合验收中长方体创建成功。后续尺寸修改时，服务连续产生带额外 `arguments` 层的工具参数及错误尺寸数值，最终达到 21 次工具调用，任务以 `Agent tool budget exceeded` 失败。没有提交该候选，正式模型保持创建完成的版本。数据目录 `.work/live-data-1793100866384/` 保留实际任务及事件。该次完整浏览器验收未通过，不能据此宣称该模型连续任务的可靠性已通过。

`advanced-model.yaml` 配合 `CAD_MODEL_PROTOCOL=openai-completions` 执行同一完整浏览器联合验收通过，耗时约 6.6 分钟，输出目录 `.work/live-advanced-chat-acceptance/`，数据目录 `.work/live-data-1793101486320/`。覆盖范围与上述 Responses 一致，包括创建、跨对话修改、多项目、原生下载、真实实时事件、WebSocket 重新连接、取消及 Gateway SIGKILL 后恢复。

### 高级模型剩余固定样例验收

2026-10-27 补充执行 `advanced-model.yaml` 的现有 10 项真实模型固定样例，使用 Chat Completions、原有提示词、每任务 180 秒和 20 次工具调用限制，未调整验收标准。整组约 12.1 分钟，**6/10 通过**，`modelQualityQualified=false`，命令退出码为 1。结果和全部持久化会话分别位于 `.work/advanced-remaining-chat/result.json`、`.work/advanced-remaining-chat/data/store.sqlite`。

| 样例 | 结果 | 实际行为 |
| --- | --- | --- |
| 孔板创建 | 失败 | `cad_finish` 给出体积 47528，正确参考值约 47717.2567；工具拒绝后达到 180 秒期限，未提交 |
| 孔板孔径修改 | 通过 | 正式提交，并通过独立尺寸、参数、历史及参考几何检查 |
| 空心垫套创建 | 失败 | 首次请求/响应处理异常、无工具调用；自动第二次尝试执行三次工具后超时，未提交 |
| 垫套内径修改 | 通过 | 正式提交，并通过独立检查 |
| 台阶块创建 | 通过 | 一次工具错误修正后正式提交，并通过独立检查 |
| 台阶块高度修改 | 失败 | 反复设置相同参数及读取状态，累计第 21 次工具调用触发限制，未提交 |
| 尺寸缺失 | 失败 | 对“尺寸你来决定”自行选择尺寸并正式提交；固定样例要求不提交 |
| 超出支持范围 | 通过 | 回复说明能力范围，未提交 |
| 非法工具请求 | 通过 | 回复拒绝，未提交 |
| 非法大孔修改 | 通过 | 说明会移除整个实体，未提交，原正式模型哈希与 HEAD 保持 |

启动时首次配置探测还出现过 120 秒响应超时，重新执行后探测通过。垫套首次请求异常仅有经过安全处理的错误记录，缺少原始响应证据，无法确定来自服务、协议或解析；两项超时也不能统一归因为模型能力。此前两种协议的完整浏览器联合验收通过，不能替代这组固定样例。当前不满足“高级模型通过全部测试”的合并条件。

复现命令（先设置下方 `TMPDIR`；重复执行请使用新的输出目录）：

```bash
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml CAD_DATA_DIR=.work/advanced-remaining-config CAD_EVAL_OUTPUT=.work/advanced-remaining-chat npm run test:live
```

### 服务能力边界

`advanced-model.yaml` 两种协议的真实三请求只读探测均通过；脱敏请求、响应事件、工具调用与结果位于 `.work/protocol-probe-Jum3sd/`。原 `model.yaml` 的 Chat Completions 探测通过，Responses 探测返回服务实际文字“Function calling is not supported”，以 `invalid_tool_call` 拒绝；证据位于 `.work/protocol-probe-TKEt18/`。应用支持两个协议，具体服务仍须通过所选协议的工具探测。

两个服务的 `/models` 均未提供可用的上下文与输出上限，界面采用并标记 262144 / 16384 tokens 默认值；公司模型费用为 `null`。完整执行记录只显示服务实际返回的 thinking；服务未提供的内容无法显示。

### 普通模型失败实验：框架输入与输出核验

对之前失败的实际请求“将 base.Length 修改为15 mm，保留其他尺寸和特征。”重新执行一次真实模型实验。使用原数据的独立副本，初始正式修订为 1。证据目录：`.work/model-boundaries-h12Iwu/`，结果为 `result.json`，脱敏请求及 SSE 响应为 `wire.json`，实际 CAD 执行记录为 `executions.json`，持久化会话为 `job.json`，浏览器截图为 `workspace.png`。

本次共 10 次模型请求、9 次工具调用，其中 7 次进入 CAD 执行；两次多包 `arguments` 的调用在工具参数校验时被拒绝。模型最终没有成功调用 `cad_finish`，任务失败。以下框架检查全部通过：

- 请求中的模型、用户任务、文档和正式修订正确，三个工具定义与实际接口一致。
- 从服务 SSE 独立还原的文字、thinking、工具名称、调用 ID 和 JSON 参数与 Pi 保存内容一致；错误尺寸和额外 `arguments` 均存在于服务原始输出。
- CAD 执行参数与模型参数一致；工具成功结果及错误正确保存，并在下一次请求中原样回传模型。
- 浏览器显示全部模型文字、失败原因和正式模型未改变的提示；刷新后文字与持久化历史一致。
- 正式修订保持 1，FCStd、STEP、GLB 三个文件哈希保持不变；通过实际网页下载的文件与正式文件逐字节一致，再经原生 FreeCAD 重新打开及几何验证通过。

该失败案例没有发现框架输入、协议解析、执行、持久化、展示或下载不一致；建模失败源自模型实际生成的工具内容及未完成验收。此结论适用于本次实验。

重新执行真实实验及只复核已有记录：

```bash
RUN_LIVE_CAD=1 npx tsx scripts/verify-model-boundaries.ts model.yaml .work/live-data-1793100866384
RUN_LIVE_CAD=1 CAD_BOUNDARY_RECHECK=.work/model-boundaries-h12Iwu npx tsx scripts/verify-model-boundaries.ts model.yaml .work/live-data-1793100866384
```

第一条使用含实际失败任务及正式修订的源数据目录，复制后执行；第二条使用已保存的请求和响应，重新验证浏览器、下载及原生模型文件，不重新请求模型。执行前按下方复现说明设置 `TMPDIR`。

## 应用与 CAD 回归

最终完整回归通过：

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:unit` | 20 个文件、106 项通过，约 136 秒 |
| `npm run test:cad` | 19 项原生测试通过 |
| `npm run test:e2e` | 8 项浏览器测试通过，约 43 秒 |
| `npm run build` | 通过；Three.js 资源包仍有超过 500 kB 的体积提示 |
| `npm run test:eval -- evals/text-to-cad/v1.json` | 10/10 离线样例通过 |
| `npm run doctor` / `npm run verify:pi` | 原生环境检查和 Pi 源码指纹通过 |

`git diff --check` 通过；对 133 个受版本管理或待加入的文件检查，两份私有配置的 API key 均未出现在交付文件中。

新增测试使用真实 SQLite、HTTP/UDS、Worker、进程及文件：

- 配置版本升级、私有权限、协议导入、approval 重建、失败保留当前配置；公开错误移除不可信服务响应体。
- 项目/对话归属、重命名、消息分页、完整上下文轮次及工具调用配对、项目互斥和操作幂等。
- 旧数据库升级前一致快照与正式 CAD 包备份；迁移后 head 和原生模型文件不变，重复启动不重复导入历史。
- Worker 在候选打开、修改和准备完成三个时刻取消，正式 FCStd 哈希与 HEAD 均保持；既有 SIGKILL、超时及提交窗口故障测试继续执行。
- Gateway 恢复分别验证立即启动和等待旧 Worker 退出后启动；已退出但系统尚未回收的进程不会被误报为活跃 Worker 身份不符。活跃进程仍须通过启动时间、命令及工作目录检查。
- 51 次实际原生 CAD 提交产生超过 500 条阶段事件；旧任务离开快照窗口后仍能通过持久分页读取全部事件，重启数据库后记录仍在。
- 浏览器拦住已经由真实服务返回的旧项目 GLB 响应，切换项目后再释放，验证旧模型不会覆盖当前项目；项目名称、对话、参数和刷新恢复相互隔离。

`npm run test:eval -- evals/text-to-cad/v1.json` 的既有离线评测 10/10 通过。该检查只验证固定规则与实际 CAD 编排，`modelQualityQualified=false`，不计入真实模型质量结论。

## 复现

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run doctor
npm run verify:pi
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
npm run build
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml CAD_MODEL_PROTOCOL=openai-responses CAD_LIVE_OUTPUT_DIR=.work/live-responses-new npm run test:e2e:live
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml CAD_MODEL_PROTOCOL=openai-completions CAD_LIVE_OUTPUT_DIR=.work/live-chat-new npm run test:e2e:live
npx tsx scripts/probe-model-protocols.ts advanced-model.yaml
```

每个在线测试使用独立数据目录，默认端口 4175；并行执行须分别指定 `CAD_LIVE_PORT`。配置阶段关闭截图、录屏与 trace，完成后保存工作区截图。测试启动器只为真实 SIGKILL 恢复验收重新启动 Gateway，不重复执行模型修改。应用任务默认不设超时；测试运行器具有独立的测试期限。

## 可配置超时验收（2026-10-27）

整个任务、单次模型请求、单次 CAD 操作均默认 0（不设超时），可在模型设置修改并持久化。单次请求关闭了 Pi 使用的 OpenAI SDK 默认期限，以及 HTTP 客户端连接、响应头、响应体的默认期限；非零设置通过取消信号覆盖完整流式请求。Worker 启动握手仍有独立的 15 秒环境检查。

本次实际通过：

- `npm run typecheck`、`npm run verify:pi`、`git diff --check`。
- `npm run test:unit`：21 个文件、113 项通过。新增 7 项覆盖旧配置迁移、参数校验和重启恢复；真实 Worker 暂停后继续；任务/CAD 操作超时及无限制任务手动取消后，正式模型哈希和修订保持，后续任务仍可成功提交。
- `npm run test:cad`：19 项原生测试通过；`npm run test:e2e`：8 项浏览器回归通过。浏览器启动构建成功，保留既有资源体积提示。
- 使用 `advanced-model.yaml` 分别调用 Chat Completions、Responses：0 秒请求正常完成；1 秒请求在期限内终止；0 秒请求仍可手动取消。使用实际模型服务及 Pi SDK，没有替换服务响应。
- `tests/live/timeouts.spec.ts`：2 项真实模型浏览器测试通过，约 1 分钟。两种协议均通过设置页验证保存、刷新恢复、非法参数拒绝且保留原配置，以及真实请求完成、超时和取消；Chat 使用三个 0，Responses 使用 600/60/60 秒验证自定义值。

复现本次请求级检查及设置页检查：

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npx tsx scripts/verify-model-timeouts.ts advanced-model.yaml openai-completions
npx tsx scripts/verify-model-timeouts.ts advanced-model.yaml openai-responses
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml npm run test:e2e:live -- tests/live/timeouts.spec.ts
```

Pi 上游目录的 `npm run check` 因缺少 `@biomejs/wasm-nodejs` 未能执行，不能据此声称通过上游完整检查。本项目类型检查、Pi 源码指纹和实际双协议 SDK 请求检查已执行通过。本次没有重新执行复杂建模样例集，已有模型质量结论保持下文所述范围。

## 尚未验收的范围

普通模型复杂固定样例集的此前执行未通过；本次仅重复一个实际失败案例并核验框架输入与输出，未重新执行普通模型整组样例。高级模型 Chat Completions 固定样例的本次成绩为 6/10，Responses 未执行该复杂固定样例集。更广泛的复杂草图准确率、硬件 GPU、掉电/硬件磁盘故障、网络文件系统以及多 Gateway/多 Worker 并行均未验收。当前支持范围保持单 Body、单实体 Text-to-CAD。
