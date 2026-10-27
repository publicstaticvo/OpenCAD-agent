# OpenCAD Agent 下一阶段实施方案

日期：2026-10-27。本文定义四项待实现需求：模型 API 协议选择、实时建模进度、多对话、项目管理。各项均包含现有代码依据、实现位置与新增测试要求；新增接口、字段及测试文件均为开发目标。

实施状态：四项需求已接入当前工作区。以下“现有实现”描述开始开发时的基线，任务列表保留为验收依据。当前操作、接口和恢复约定见 [工作区功能说明](workspace-contracts.md)，配置与启动见 [在线模式](online-mode.md)，实际执行的测试及服务限制见 [在线验证记录](online-validation.md)。在线浏览器联合验收集中在 `tests/live/model-setup.spec.ts`，项目迟到响应隔离另由 `tests/e2e/projects.spec.ts` 验证。

继续使用现有 React/Three.js、Gateway/Pi、SQLite、独立 FreeCAD Worker。正式模型沿用候选隔离、几何与文件验收、不可变修订包和 revision 条件提交机制。开发范围保持 Text-to-CAD。

## A. 支持不同模型 API 协议

### 现有实现

`gateway/model-config.ts` 的配置和 `gateway/eval-provider.mjs` 的 Provider 固定使用 `openai-completions`，请求发送到 `/chat/completions`。Pi 已有 Chat Completions 和 Responses 两套实现；Responses 位于 `pi/packages/ai/src/api/openai-responses.ts`，包含独立的消息、工具转换与流式事件处理。

### 实现任务

1. **扩展配置契约。** 在配置、公开查询结果、YAML 导入及自动生成的 `approved.json` 中保存 `protocol: "openai-completions" | "openai-responses"`。`model-settings.json` 升级为版本 2；版本 1 与未提供协议的 YAML 默认使用 Chat Completions。保留现有上下文长度、输出限制来源和费用为空的规则。
2. **增加网页选择。** `web/src/ModelSettings.tsx` 增加“API 协议”下拉框，显示两个协议的完整名称；重新打开设置恢复已保存值。模型发现继续使用服务 `/models`，目录条目不代表协议能力。发现接口不可用时显示原因，允许填写模型 ID，并通过实际协议探测验证。
3. **使用 Pi 原生协议适配。** `gateway/eval-provider.mjs` 按协议构造 Pi model 并调用对应 `streamSimple` 实现。Chat Completions 使用其 messages、工具增量和结束原因；Responses 使用其 input、工具结构和独立事件流。CAD Agent 继续消费统一 Pi 消息、工具事件及严格 CAD 参数契约。
4. **配置验证与生效分离。** 扩展 `GET/POST /api/model-config` 和 `POST /api/model-config/discover`，新增 `POST /api/model-config/probe`。临时配置分别探测真实文本流和一次只读工具往返；后者使用正式 CAD 工具定义中的 `cad_inspect` 查询隔离空文档，不执行模型修改。返回 `protocol, phase, textStreaming, toolCalling, errorCode`。保存前要求两项探测通过，界面提示将向服务发送测试请求。
5. **持久化与恢复。** 私有 settings 是配置事实来源，API key 仅在服务端以 `0600` 保存。验证成功后原子替换 settings，再派生不含密钥的 approval；重启可重新生成 approval。探测失败保留当前配置。只有 approval 而缺少凭据时提示配置密钥。已开始任务固定配置快照，修改影响之后开始的任务。
6. **分阶段报告错误。** 区分模型发现、认证、HTTP 服务失败、协议解析、工具能力验证及 CAD 执行。错误包含所选协议、阶段与可公开状态；浏览器和日志排除密钥、认证头及不可信原始响应体。不自动更换协议或重放 CAD 写操作。

涉及文件：`gateway/model-config.ts`、`gateway/eval-provider.mjs` 及类型声明、`gateway/server.ts`、`gateway/evaluation.ts`、`web/src/ModelSettings.tsx`、`web/src/api.ts`。

### 需要增加的测试

- 配置迁移：真实版本 1 配置副本升级后，检查协议默认值、限制值、密钥权限、重启恢复；探测或写入失败时当前配置仍可使用；approval 可以重新生成。
- 协议链路：两种协议分别验证实际请求结构、文本增量、工具参数、工具结果回传、结束事件与中途断流；先通过真实只读工具探测，再执行 CAD 任务。
- 两种协议分别创建 40×30×10 mm 长方体并修改尺寸，检查单个实体、包围盒、体积、FCStd 保存重开及 STEP/GLB 导出。已有 Chat Completions 配置运行相同验收。
- 网页选择、保存、刷新及修改协议；密钥留空复用边界；发现失败时手填模型 ID；协议不匹配时保留原配置并显示失败阶段。

新增 `tests/model-protocols.test.ts`、`tests/live/model-protocols.spec.ts`，扩展 `tests/model-config.test.ts`。配置与 SDK 转换测试使用实际文件和转换函数；网络兼容性使用真实服务验证。

需要准备支持 Responses 且已授权调用的服务配置。现有服务能力必须实测；环境缺失时将该协议验收标为阻塞，不能声明已通过。

## B. 实时显示建模进度

### 现有实现

Pi 提供 `message_update`、`tool_execution_start/update/end` 等事件；`gateway/pi-adapter.mjs` 当前主要转发工具结束事件，完整 transcript 在任务结束时保存。SQLite 按 document 分配事件 `seq`，`gateway/events.ts` 通过 WebSocket 发送持久事件。前端 `web/src/store.ts` 已有重连与快照恢复机制。

Worker 的 `prepare_candidate` 在一次调用中完成验收、保存及导出；`gateway/worker-client.ts` 当前仅接受请求响应，尚不支持阶段通知。

### 实现任务

1. **定义真实事件契约。** 扩展现有信封，保留 `seq, documentId, jobId, revision, candidateId, type, data`，增加 `conversationId`。事件覆盖排队、运行、模型文字、服务实际返回的 thinking、工具开始/结束/失败、几何验证、FCStd 保存和独立重开、导出、提交、取消与错误。工具携带 `toolCallId`，文字携带 `messageId, deltaIndex`。
2. **接入 Pi 事件。** Gateway 为消息分配稳定身份，同一消息的部分更新与最终内容归入同一记录。高频文字允许短时间合并，工具边界、结束、失败和取消必须立即刷新待写增量。所有进展来自实际执行事件。
3. **扩展 Worker 通信。** 增加 JSON-RPC 通知 `cad_progress`，包含 `requestId`、候选身份、阶段、开始/完成及序号。Worker 在真实阶段边界发送；客户端校验并关联未完成请求，不将通知误作响应。`hello` 公布通知能力，同步更新协议契约与兼容检查；保留现有超时及正式模型保护机制。
4. **持久化后发送。** Gateway 在同一事务中更新消息快照并追加事件，提交后由 EventHub 发送。快照和事件按项目水位读取，避免刷新时重复追加消息。提交成功仅由 Gateway 正式 revision 结果确认。
5. **恢复与取消一致性。** 前端按连续 `seq` 应用事件，以 `messageId/deltaIndex` 去重。序号缺失时补读持久事件；刷新或重连恢复项目、对话消息快照后，从水位继续订阅。迟到事件不覆盖终态。Gateway 重启保留已持久进度，将未完成任务标为中断，不重放 CAD 副作用。
6. **展示设置。** 提供“关键执行记录”和“完整执行记录”，偏好保存在浏览器。关键模式显示状态、可见文字、工具摘要、验收和结果；完整模式增加服务实际返回的 thinking 与完整工具参数、结果。没有 thinking 时显示“模型未提供”。“调用命令”对应现有受控 CAD 操作，不增加代码执行入口。两种模式均排除密钥。

涉及文件：`shared/cad-contracts.ts`、`gateway/pi-adapter.mjs`、`gateway/supervisor.ts`、`gateway/worker-client.ts`、`gateway/events.ts`、`gateway/revision-store.ts`、`worker/main.py`、`worker/candidates.py`、`worker/artifacts.py`、`web/src/store.ts`、`web/src/App.tsx`。

### 需要增加的测试

- 真实任务结束前观察到文字或工具开始事件；顺序符合执行过程，最终文本没有重复。服务缺少文字增量或 thinking 时，正确展示可用事件。
- 实际 FreeCAD 保存、独立重开与导出均有阶段通知，属于正确请求；协议错误立即报告，原有 RPC 响应正常完成。
- 实际断开 WebSocket、刷新、重新连接后，与数据库及正式模型一致；使用保存的真实事件检查重复、乱序和序号缺失。
- 在模型响应、CAD 执行及验收阶段分别取消，确认终态固定、候选无法提交、正式文件哈希不变；终止 Gateway 后重启，进度恢复且任务不续跑。
- 展示设置不改变 Agent 请求、工具执行及结果；完整记录没有密钥；长文字传输保持有界消息大小与 WebSocket 缓冲处理。

新增 `tests/progress-events.test.ts`、`tests/live/progress.spec.ts`，扩展 RPC、恢复及浏览器测试。需要真实流式模型、FreeCAD 和 Chrome；取消与断连操作真实进程及连接。

## C. 管理多个对话

### 现有实现

当前没有独立对话表，每个 Job 保存一次用户文本和 Agent transcript，新任务创建新 Agent。document 已代表项目模型状态，任务、事件及修订通过 `document_id` 关联。

### 实现任务

1. **新增持久数据。** 新增 `conversations(id, document_id, title, created_at, updated_at)` 和 `messages(id, conversation_id, ordinal, operation_id, base_revision, role, content, created_at)`。对话外键指向 document；`(conversation_id, ordinal)` 唯一。Job 增加 `conversation_id`。消息保留 Pi 规范内容与工具调用关联 ID。
2. **增加接口。** `GET/POST /api/documents/:id/conversations` 列表或新建；`GET/PATCH /api/documents/:id/conversations/:conversationId` 读取或重命名；分页历史使用 `GET .../:conversationId/messages?afterOrdinal=...&limit=...`，返回水位与 `hasMore`。所有接口验证对话所属项目。
3. **恢复独立上下文。** 新任务只加载当前对话已结束轮次，保留 assistant 与工具结果配对，追加项目最新正式模型快照。历史几何结果标注原 revision，当前几何以最新快照为准。按 Pi 上下文预算移除完整旧轮次，完整聊天保留在数据库，界面提示未发送的历史范围。更换协议使用 Pi 规范消息转换。
4. **共享模型与写入互斥。** 同项目对话共享当前 FCStd 和修订，界面持续显示“本项目的所有对话共享当前模型”。任务携带 `conversationId, baseRevision, operationId, text`。Gateway 在事务中检查活动任务并入队；queued、running、validating、committing 均占用项目写入资格。第二个修改任务返回 HTTP 409 `project_busy`；执行前再次检查 revision，过期返回 `revision_conflict`。结构化操作与修订恢复同样受此约束。
5. **增加对话界面。** 工作区提供新建、列表、切换及重命名；地址保存 `?document=<id>&conversation=<id>`。切换只更换历史和上下文视图，模型视口继续显示共享正式 revision。后台活动任务显示所属对话；切换或刷新不取消任务。
6. **迁移旧历史。** 每个旧项目创建稳定默认对话，将 Job 用户输入与 transcript 按任务顺序转换；注入的系统快照不重复成为聊天内容。重复启动不重复生成消息，旧任务继续可查。旧提交缺少 `conversationId` 时映射默认对话。

涉及文件：`gateway/revision-store.ts`、`gateway/server.ts`、`gateway/supervisor.ts`、`gateway/agent.ts`、`gateway/pi-adapter.mjs`、`shared/cad-contracts.ts`、`web/src/App.tsx`、`web/src/store.ts`、`web/src/api.ts`。

### 需要增加的测试

- 同项目两个对话交替发送真实模型任务，各自历史、工具记录与上下文独立；对话 B 能检查并修改对话 A 提交的最新模型。
- 分页、改名、刷新与重启后，对话身份、顺序、内容一致；超预算时持久历史完整，发送的工具消息保持配对。
- 两个对话同时提交同 revision，仅一个获准，另一个返回 `project_busy`；结束后可重新提交，revision 按实际提交增加。
- 混用项目和对话 ID 必须被拒绝，不产生 Job、消息或候选；文本、结构化修改与修订恢复遵守同一写入约束。
- 当前数据库副本升级后比较原 Job 与历史；重复启动无重复消息，迁移失败事务完整撤销。

新增 `tests/conversations.test.ts`、`tests/live/conversations.spec.ts`，扩展 Gateway、Supervisor 测试。使用真实 SQLite、FreeCAD 与模型；上下文验证检查脱敏实际请求。

## D. 项目管理

### 现有实现

`documents` 已隔离 head、修订、任务和事件。正式文件位于 `revisions/<candidateId>/`，由数据库关联项目和 revision。首页已有创建 document、按 ID 打开功能；工作区缺少项目列表与创建入口。

### 实现任务

1. **保留项目身份。** 沿用 `documents.id` 作为 project ID，增加 `name, created_at, updated_at`。项目拥有一个正式模型 head、独立修订、任务、事件及对话。正式包保持现有路径，artifact 查询始终验证项目与 revision 归属。
2. **增加项目接口。** `GET /api/documents` 返回 ID、名称、更新时间、head revision 和活动任务摘要；`POST /api/documents` 接受可选名称；`PATCH /api/documents/:id` 改名。现有项目快照提供活动任务与事件水位。创建项目和默认对话在同一事务中完成。
3. **增加工作区入口。** 顶部显示项目全名，提供列表、切换与“新建项目”；创建后进入默认对话。列表显示后台任务状态。名称用于展示，请求与缓存使用稳定 ID。
4. **切换状态隔离。** 切换取消浏览器旧请求、清理订阅并建立新 WorkspaceStore；同时更换模型、特征树、属性、下载地址、修订视图、对话和任务。异步结果写入前检查 project ID 与请求世代，旧 GLB 不能覆盖新项目。新快照完整加载前禁用修改和下载，明确显示正在打开的项目。
5. **恢复与升级。** URL 保存项目和对话，刷新从数据库恢复。身份缺失时显示错误，不悄悄打开其他项目。SQLite 用 `user_version` 管理升级，接收任务前完成迁移；旧 ID 生成默认名称。升级前备份数据库与正式包，迁移失败保留原数据。
6. **保持调度约定。** 沿用单 Gateway、全局串行 Worker 队列，项目互斥按 C 项实现。切换不取消后台任务，完成事件只更新所属项目。项目删除、跨项目复制和并行 Worker 不属于本次范围。

涉及文件：`gateway/revision-store.ts`、`gateway/server.ts`、`gateway/supervisor.ts`、`shared/cad-contracts.ts`、`web/src/App.tsx`、`web/src/store.ts`、`web/src/api.ts`、`web/src/style.css`。

### 需要增加的测试

- 在工作区创建两个项目，各创建两个对话，验证列表、名称、模型、修订、任务、聊天和下载归属。
- A 执行任务时切换 B 并提交任务，Worker 依次执行；A 完成事件不修改 B 视图，各项目保存各自 revision。
- 在模型加载、任务提交、断线恢复期间快速切换，迟到响应、旧事件及 GLB 均不能污染当前项目。
- 刷新和重启恢复正确项目、对话及版本；修改仅作用于当前完整加载的项目，下载与所显示 revision 一致。
- 旧数据库迁移前后比较项目数、head、全部 manifest 哈希及文件清单；损坏正式数据继续触发现有保护。

新增 `tests/projects.test.ts`、`tests/live/projects.spec.ts`，扩展 Web 状态和浏览器测试。迁移与隔离验收使用真实数据库和模型文件副本。

## 开发依赖顺序

1. **契约与存储升级：** 定义协议、项目、对话、消息和事件字段，建立配置及 SQLite 迁移测试，确认旧数据可读。
2. **协议适配：** 完成 A 项界面、Provider、真实探测与两协议 CAD 验收。
3. **项目和对话后端：** 完成 D 项接口、C 项消息与上下文及项目写入互斥，验证归属和并发提交。
4. **持久实时事件：** 基于项目、对话身份完成 B 项 Pi/Worker 事件、消息快照、重连与取消规则。
5. **工作区交互：** 接入项目新建/切换、对话管理和展示设置，完成四项联合浏览器验收。

每项提交包含对应测试与配置/启动文档。界面和文档仅声明实际验收的能力；真实服务缺失或调用失败单独标明阻塞条件。

## 测试命令与环境

现有检查命令继续运行：

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
npm run build
```

新增 `tests/*.test.ts` 由 `test:unit` 纳入。将新增在线浏览器测试加入 `playwright.live.config.ts` 的匹配范围，并检查文件确实被收集。在线验证命令：

```bash
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=/absolute/path/to/private-model.yaml npm run test:e2e:live
```

在线测试配置需要支持新增 `protocol` 字段，分别使用已授权的 Chat Completions 和 Responses 服务执行。两种协议均通过创建、修改、实时事件、多项目/多对话、取消与重启验收后，完成本阶段交付。

环境需要匹配的 FreeCAD、本机 HTTP/UDS、Chrome、真实模型服务及独立测试目录。保留脱敏请求、事件、模型验证结果与失败原因；凭据及输出置于 Git 忽略目录。测试使用实际连接、进程、数据库和 CAD 文件；既有离线回归保留，协议与模型能力验收使用真实服务。
