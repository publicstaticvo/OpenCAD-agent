# 可靠 Text-to-CAD 阶段一开发计划

> **执行方式：**当前只交付调查和计划。后续实施采用 executing-plans 方法逐项完成；不默认启用子代理，不在本轮搭建产品或安装依赖。

**目标：**用户通过文字创建和修改可编辑的单实体参数化零件；失败不改变正式模型；刷新后恢复，FCStd/STEP/GLB 可交付。

**架构：**一个 TypeScript Gateway 嵌入 Pi core，一个主线程执行 FreeCAD API 的独立 Python Worker；先只开一个 Worker，UDS 通信。SQLite 保存 HEAD/任务/事件/会话，不可变文件包保存每个 revision；Web 通过 HTTP + WS 与 Gateway 同步。

**技术栈：**Pi 本地 commit `b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb`、TypeBox、FreeCAD 1.1.3/Python 3.11.14/OCCT 7.8.1；建议 React + Vite + Three.js，Node HTTP + WS，Vitest + Python unittest + Playwright。新增包的精确版本在任务 0 实际安装/核实后锁定，不能填猜测版本。

**依据：**先读 [implementation-readiness.md](../../implementation-readiness.md)，再读 [原设计](../../design.md)。前者记录已验证事实、建议偏离和尚未关闭的门槛；本计划不是已实施清单。

## 全局约束

- 仅 Text-to-CAD 和生成模型的 STEP 导出验证；不做 STEP 编辑、图像、装配、工程图、Subagent、任意脚本、远程服务池和多人协同。
- 第一交付支持单 Body/单实体、平面 line/circle 草图、命名约束、Pad/Pocket、白名单参数编辑；首批零件范围待负责人审阅，不宣称支持任意机械件。
- mm、度、CAD 右手 Z-up；GLB 使用运行时验证的米/Y-up 转换；不能双重换算。几何验收和网格精度采用准备审查中的初始公差。
- 正式 HEAD 只能由 Gateway 经验证与 baseRevision 比较后推进；候选不得覆盖正式 FCStd。重试/取消/超时都必须有明确可查询状态。
- `pi/` 保持独立上游 checkout，本期不修改其源码；不得直接复用个人 Pi 的登录信息。真实付费调用只在显式配置的 live 测试中发生。
- 每项先写指定失败测试，再实现最少行为，再运行命令验证；开发任务完成须具备可独立检查的结果。禁止以 skip、fake 或文件存在代替真实 CAD/Web 测试。

## Review Focus

以下五类输入/故障必须有明确归属，不能最后补一句“增加异常测试”：

1. 布尔值/字符串被 SDK 转成尺寸、NaN、越界路径和未知对象：任务 1、8 必须拒绝。
2. recompute/状态文本成功但没有实体，或保存后丢失特征/参数：任务 3、4 必须检出。
3. 请求重复、旧版本提交、取消与提交竞争、响应丢失：任务 5、6、7 必须只产生一个确定结果。
4. Worker/Gateway 在写文件、发布包、DB 提交前后退出，以及磁盘满：任务 5、6 必须保护旧 HEAD 或恢复新 HEAD，不能出现半套模型。
5. 刷新、断线、乱序/重复事件和迟到 GLB，让树、参数、预览来自不同版本：任务 7、9、10 必须收敛到同一 snapshot。

## 建议的文件边界

根目录新建独立应用配置；保持 `docs/`、`pi/`，不为每个模块另建服务/仓库。下列路径是计划创建的位置，**当前产品文件/命令尚不存在**。

- `shared/cad-contracts.ts`：RPC、操作、snapshot、event 的类型和严格 Schema。
- `worker/{main,model_ops,validation,artifacts}.py`：传输/派发、建模、验收、派生文件；FreeCAD 调用只在该进程主线程。
- `gateway/{worker-client,supervisor,revision-store,events,agent,server}.ts`：进程边界、正式发布、应用 API；Agent 不拥有 storage 的直接写入口。
- `web/src/{api,store,viewer,App}.tsx/ts`：服务通信、版本化状态、GLB 和特征树/Chat；不把 Pi provider 或凭据带到浏览器。
- `tests/*.test.ts`、`worker/tests/`、`tests/e2e/`、`evals/text-to-cad/v1.json`：分别测试契约/应用、真实 CAD、浏览器和显式 live 评测。单元测试根配置只匹配产品 tests，不递归运行 Pi 的 e2e。

## 测试环境约定

以下任务命令均在 `~/ai4s/cad-web` 执行，是对应任务建立后才存在的产品测试，不是本轮通过记录。任务 0 先设置 `export FREECAD_RUNTIME_ROOT=/tmp/cad-web-readiness-runtime/squashfs-root`（本机调查 runtime），正式部署换成固定安装位置；CAD harness 必须读取此变量并启动其内置 Python，缺失则失败。浏览器测试还需 Chromium/WebGL 和可绑定本机 socket 的运行环境。

## 按依赖顺序执行

### Task 0: 固化可启动环境与 SDK 导入（可立即开始）

**目标/行为：**新环境可以报告精确 runtime 版本并跑通无网络的基线，不依赖交互 shell/全局 Pi 安装。仅建立必要的根 package.json、锁文件、tsconfig、测试配置和环境检查；根目录 Git 初始化/上游版本记录由工程处理，不把整个 Pi checkout 当不明 gitlink 提交。

**接口/文件：**建立 `scripts/doctor.py`、`docs/toolchain-lock.json`、`tests/pi-import.test.ts`。通过 `FREECAD_RUNTIME_ROOT` 指定固定 runtime；doctor 报 Python/FreeCAD/OCCT、GuiUp、可写 staging、UDS 可用性。记录 AppImage hash；选择维护中的 Node LTS 精确补丁并再跑测试，当前 Node 25.9.0 只算调查环境。

**需要验证：**运行错误 Python/版本漂移/缺动态库时明确失败；fake provider 完成 tool call 和 hooks/events。默认采用固定 Pi checkout 的 source aliases 由独立应用构建，不修改 Pi；本轮 probe 已证明 core 源码路径可用。新应用必须自己精确安装 TypeBox 1.3.27、partial-json 0.1.7 及选定 provider 的实际依赖，不能长期借用全局目录。若改用发布包，先核对 API，不能认为同版本号就等于该 commit。

- [ ] 先保存本轮两个 probe 的可复现基线及缺 runtime 的失败测试，再建立最小配置、独立依赖和导入测试。
- [ ] 建立脚本：`typecheck = tsc --noEmit`、`test:unit = vitest run`；`test:cad = python -m unittest discover -s worker/tests -v`（测试 harness 启动匹配的 FreeCAD 子进程）；`test:e2e = playwright test`；live 单独 opt-in。
- [ ] 执行：`python scripts/doctor.py`、`npm run test:unit -- tests/pi-import.test.ts`、准备审查中的 FreeCAD probe 命令。干净安装可复现且版本匹配才通过。

**当前状态：**CAD 8 个 action 和本地 Pi source/fake 的 3 个场景已经单独通过；产品 doctor、构建、独立安装、所选 LTS 测试还不存在。普通 shell DNS 受限；UDS 在执行沙箱 bind 为 EPERM，沙箱外探针的自动审批因审核模型不可用（404）失败，宿主机结果未知。工程上先准备可绑定 socket 的本机/CI 测试环境，不将此误判为架构不可行或默默跳过 RPC 测试。

### Task 1: 定义跨端最小契约

**依赖：**0。**目标/行为：**错误输入在进入 FreeCAD 前被拒绝；TS 与 Python 使用同一组 JSON fixtures，不各自解释协议。

**接口/文件：**`shared/cad-contracts.ts`、`worker/contracts.py`、`tests/fixtures/contracts/*.json`。定义 `RpcRequest/RpcResponse`、`CadOperation`、`CandidateResult`、`DocumentSnapshot`、`AppEvent`，核心字段见准备审查。读写工具共享 Gateway 注入的执行信封，LLM 只能填白名单操作参数。featureId 与参数名跨 revision 保持，显示名称不能替代它们。

- [ ] 测试毫米/角度、严格数值类型（含 bool/null/字符串）、NaN/Infinity、额外字段、未知 op、错误版本、非法 ID/对象类型/路径；两端同样接受/拒绝。
- [ ] 实现严格验证和初始预算配置：建议最多 20 次工具调用、任务 180s、CAD 操作 30s、启动 15s，可由测试缩短；这些是工程初值，获准成本上限另行配置。最终尺寸/体积验收采用准备审查中的公差。
- [ ] 执行：`npm run test:unit -- tests/contracts.test.ts`；`python -m unittest discover -s worker/tests -p test_contracts.py -v`。必须验证坏参数不会触发建模调用。

### Task 2: 跑通一个真实 Worker 的通信与生命周期

**依赖：**1。**目标/行为：**Gateway 能启动指定 runtime、握手、发只读请求并识别退出；仅一个 Worker，不预建调度平台。

**接口/文件：**`worker/main.py`、`gateway/worker-client.ts`、`tests/rpc.test.ts`。`hello` 返回 protocolVersion/runtime/capabilities/workerInstanceId；`inspect_document` 针对 candidate 或已加载只读快照；Python 主线程串行派发。JSON-RPC/LF、1 MiB 帧限制和私有 socket 目录按审查约定落实。

- [ ] 先用真实子进程测试分段帧、连续帧、未知方法/id 匹配、超限、启动失败、进程退出和日志污染；不要用同进程 mock 代替最终验证。
- [ ] 实现 `WorkerClient.request(method, params, deadline)`；信号/退出映射为应用错误，不对超时写命令盲重试。
- [ ] 执行：`npm run test:unit -- tests/rpc.test.ts`。连续请求有界完成；错误 runtime 不能静默切换到另一套 FreeCAD。

### Task 3: 实现可重算的核心参数化操作

**依赖：**1、2。**目标/行为：**用固定 JSON 操作创建孔板，修改命名直径；保留 Sketcher 和 PartDesign 历史，不输出一个不可编辑的 Part::Feature 壳。

**接口/文件：**`worker/model_ops.py` 的 `apply_operations(doc, operations)`；支持创建 Body、XY/显式基准位姿 sketch、line/circle geometry、命名约束、Pad/Pocket、白名单 set_parameter；所有操作只对当前 candidate。`worker/tests/test_model_ops.py` 启动真实 FreeCAD 运行 fixtures。

- [ ] 从本轮孔板夹具建立回归断言：两张完全约束草图、Pad/Pocket、唯一稳定 ID、80×60×10、孔中心 (20,15)、直径 6→8；约束名称而非数组下标用于生产修改。
- [ ] 补空心垫套（双圆 Pad）和台阶块（第二 Pad）夹具；反向 Pocket、冲突/未完全约束草图、删除/重命名显示标签均有明确行为。第一支持集的欠约束不允许悄悄提交；对不支持的特征明确失败。
- [ ] 执行：`npm run test:cad`。对象树、参数、单实体、包围盒和体积同时通过；`operationId/stepId` 重复不得再造对象。

### Task 4: 建立独立验收与 revision 文件包

**依赖：**3。**目标/行为：**候选保存后独立进程重开、检查，输出树/FCStd/STEP/GLB/manifest；几何看似成功不能绕过验收。

**接口/文件：**`worker/validation.py` 的 `validate_document(doc, criteria)`；`worker/artifacts.py` 的 `prepare_revision(candidate, criteria)` 返回 manifest、hash 和报告，不推进 HEAD。feature tree 提供 ID、父子关系、参数名/单位和 Body.Tip；GLB 提供稳定的 Body mesh 映射。第一期只选树中特征，以 Body/Tip 粒度高亮，不承诺逐面的显示映射。

- [ ] 验证 500 mm 孔造成实体数 0，即使状态 Valid 也拒绝；还测空/损坏文件、丢失参数/ID、导出失败和验证进程异常。
- [ ] FCStd 必须在新进程重开仍可改约束；STEP 新文档导入实体有效/体积与尺寸符合公差；GLB 真有三角网格、轴/比例正确。最终全包不齐或失败时标 candidate failed，不发布半套交付物。
- [ ] 执行：`python -m unittest discover -s worker/tests -p test_artifacts.py -v`。记录每个失败的结构化诊断；浏览器渲染仍需任务 9。

### Task 5: 实现唯一正式提交点与重启对账

**依赖：**4。**目标/行为：**一个用户任务对应一个 candidate、一个可查询结果；重复请求不重复提交，旧版本永不覆盖新版本。

**接口/文件：**`gateway/revision-store.ts`、`tests/revisions.test.ts`。`commitCandidate(documentId, candidateId, baseRevision, operationId)` 消费任务 4 的已验证包，返回 committed revision 或 typed conflict；SQLite 在同一事务更新 HEAD、operation result、revision 和 committed event。文件包先完整落盘再发布；canonical/tree/events 的兼容副本只作派生缓存。

- [ ] 测相同 ID/相同内容返回同结果、同 ID/不同内容拒绝、相同 base 的两个 candidate 只提交一个、无文档初始 HEAD、撤回到旧快照生成新 revision。
- [ ] 在 staging 写中、包 rename 后/DB 前、DB 提交后/响应前，用独立 Gateway 子进程和 failpoints 终止再重启；注入 ENOSPC/权限错误、损坏 manifest、缺失正式文件。成功对账不能依赖人工修改 JSON。
- [ ] 执行：`npm run test:unit -- tests/revisions.test.ts`。未提交包不可见；已提交 HEAD 可重开；丢失响应的重试仍只返回同一 revision。真实断电耐久性未测就不能声称保证断电零丢失。

### Task 6: 将 Supervisor、候选任务与故障恢复连起来

**依赖：**2、5。**目标/行为：**真实 Worker 死亡/超时不会改动正式模型，Gateway 活着并能运行下一任务。状态覆盖 queued/running/validating/committing/committed/failed/cancelled/interrupted。

**接口/文件：**`gateway/supervisor.ts`、`tests/worker-recovery.test.ts`。`runCandidate(job)` 只交给 Worker 候选目录，持有文档锁；`cancelJob(jobId)` 与提交由同一状态边界串行裁定。若已提交，取消返回已经提交的事实。重启中断任务不自动重播副作用。

- [ ] 在打开/修改/保存候选时 SIGKILL，模拟不返回的 native 操作、取消后迟到成功、死 Worker 旧实例响应；杀进程前后核对正式 HEAD、文件 hash、树和已持久化事件。
- [ ] Gateway 重启后标记 interrupted/对账，重开正式 FCStd，再成功执行新任务。限制 worker 总数=1、日志/输出上限；安全退出清理 socket，失败候选保留有限诊断，确认无引用后再清理。
- [ ] 执行：`npm run test:unit -- tests/worker-recovery.test.ts`。本轮 probe 只测文件分离，这里才是实际 Supervisor 验收。

### Task 7: 建立 HTTP/WS 和可恢复 snapshot

**依赖：**5、6。**目标/行为：**不用模型和浏览器，也能经应用 API 建/改项目、查看任务结果、获取一致的正式版本并恢复事件。

**接口/文件：**`gateway/{server,events}.ts`、`tests/gateway.test.ts`。最小端点：创建项目、取 snapshot、提交 job、查 job、取消、取受控 artifact；WS 订阅 afterSeq。snapshot 含 revision/lastSeq/tree/parameters/artifact IDs/jobs；客户端不能提交自造文件路径。由持久事件先记账再推送，增量 token 可作不保证重放的临时事件。

- [ ] HTTP 重试、409 冲突、版本化 artifact、断线补事件、重复 seq、snapshot 与订阅交界竞态均用实际进程/真实 Worker 测试；不得只验证 HTTP 200。
- [ ] 默认 loopback；局域网试用通过配置的共享访问凭据/反向代理认证并校验 WS Origin、项目路径。小规模可信用户不等于公开无鉴权接口；密钥只留服务端。
- [ ] 执行：`npm run test:unit -- tests/gateway.test.ts`。关闭 Gateway 重开后 API 返回相同 HEAD/完成会话；所有返回的正式 artifact 属于该 revision。

### Task 8: 接入一个 Pi Agent，约束副作用和上下文

**依赖：**7。**目标/行为：**fake provider 和真实 provider 使用同一 CAD 工具执行路径，LLM 只能提案/操作候选，最终成功取决于任务 4—6。

**接口/文件：**`gateway/agent.ts`、`tests/agent.test.ts`。封装 `runTextJob(job, provider)`；读工具获取最新 snapshot，写工具在同一 candidate 中逐步执行；finish 请求由应用校验后发布。明确 `toolExecution="sequential"`；`beforeToolCall` 对原始参数做严格校验（Pi 自带校验会做类型转换），Gateway 注入事务信封；hook 不是唯一的提交保护。

- [ ] fake provider 产生建模→检查→完成、无效尺寸→有限修复、unsupported、取消、预算超限、伪称成功、原始 bool 尺寸等序列。工具未通过/没有提交就不能返回 committed。
- [ ] 模型上下文只带 task、revision、参数/特征摘要和诊断；大型文件留 artifact。持久化完成对话和任务结果；重启若存在未完成 tool call，显示 interrupted/重建有效上下文，不自动重复写模型。
- [ ] 执行：`npm run test:unit -- tests/agent.test.ts`。禁止支付 API；不能因环境中存在密钥就自动跑 live。请求下一轮前重新注入当前 revision。

### Task 9: 做到浏览器能正确显示正式 CAD 状态

**依赖：**7，可在 8 前完成。**目标/行为：**加载 snapshot，显示 Three.js GLB、特征树和参数，选树中特征可查看参数/定位所属 Body，明确标识 candidate/正式版本。

**接口/文件：**`web/src/{api,store,viewer,App}.tsx/ts`、`tests/e2e/viewer.spec.ts`；具体扩展名按模块实际内容。先全量 GLB + Body/Tip 高亮，Before/After 用两个完整版本切换。未完成面级映射时不得随便把 mesh index 当 featureId。

- [ ] 真实浏览器 GLTFLoader 加载，不仅检查 canvas 出现；孔板的长宽高、孔位置、轴向/比例、树/属性对应同 revision，卸载旧 geometry/material，缺 artifact 显示明确失败。
- [ ] 乱序/重复事件、旧 GLB 请求晚返回、断线期间提交、刷新恢复，由版本化 store 测试保证最终一致；应用事件 gap 超出保留范围则取快照。
- [ ] 建立浏览器环境（`npm exec -- playwright install chromium`，缺系统库由部署环境解决），再执行 `npm run test:e2e -- tests/e2e/viewer.spec.ts`。记录 WebGL 可用性；软件渲染/headless 问题不能记为产品通过。

### Task 10: 接通 Chat、属性编辑、取消与用户可理解的失败

**依赖：**8、9。**目标/行为：**输入文字创建孔板→看到过程→改直径→产生新 revision；属性修改走相同候选链路。坏修改保留正式模型，用户能看到具体原因并重试。

**接口/文件：**完善 `web/src/App.tsx` 与 store，`tests/e2e/text-to-cad.spec.ts`。所有 task/result/approval 标识来自 Gateway；页面不根据聊天文字推断模型成功；“暂停”一期可用取消后续步骤及 interrupted 状态替代自动续跑，必须说明实际行为。

- [ ] 用 fake provider + 真实 FreeCAD 测完整用户流程、失败回退、取消、刷新、下载并重开 FCStd/STEP；禁用 stale revision 的属性提交，处理 409 后刷新。
- [ ] 执行：`npm run test:e2e -- tests/e2e/text-to-cad.spec.ts`。检查参数、树、mesh、任务结果及正式文件，而不只断言消息气泡。

### Task 11: 用小型 live 验收集关闭阶段一

**依赖：**0—10；负责人确认首批零件范围、获准模型服务及数据/成本边界。**目标/行为：**在真实模型上证明这个有限产品能用，同时如实记录能力边界。

**接口/文件：**`evals/text-to-cad/v1.json`、`scripts/eval-text-to-cad.ts`、评测结果文件。初始三个零件各一条创建、一条精确修改，共 6 条正例；另含尺寸歧义、unsupported、非法操作、失败修改等负例。验收标准来自固定 fixture，不能让被测模型自己决定是否正确。

- [ ] 先跑全部无模型测试和故障矩阵；建议初始发布门槛为 6/6 正例在一次有界修复以内满足几何/历史/保存验收，负例不污染正式模型；单独记录首次成功率、修复次数、调用数、成本、耗时和用户介入。该小样本不代表通用 CAD 成功率。
- [ ] 建立显式 opt-in：`RUN_LIVE_CAD=1 npm run test:live -- evals/text-to-cad/v1.json`；所需 provider/base URL/model、凭据注入方式及成本上限在执行时记录，不在文档放密钥。没有授权/网络就记未执行，不用 fake 替代 live 报告。
- [ ] 最终执行 `npm run typecheck`、`npm run test:unit`、`npm run test:cad`、`npm run test:e2e`，再执行显式 live 命令。报告准备审查的每项退出条件对应的结果，剩余失败则不标阶段一完成。

## 本轮已执行 vs 尚需建立

- **已执行：**准备审查的 FreeCAD probe 命令（8 actions，多轮退出码 0）；`node docs/probes/pi_readiness.mjs ./pi /home/lenovo/.pi/agent/install/releases/1.3.0/node_modules`（退出码 0，3 个无网络 source/fake 场景，借用的只是两个匹配版本的通用依赖）；当前 Node 的 SQLite 内存查询和文件 WAL 写入/关闭重开。UDS bind 实测 EPERM，沙箱外验证未执行。
- **尚需建立：**根应用依赖/锁文件与全部产品 scripts、真实 UDS Worker/Supervisor、SQLite WAL/文件提交恢复、独立 provider 配置、Playwright 浏览器/WebGL、CI 上匹配 runtime 和 live 授权。上述未来命令不是本轮已通过的测试。
- **先交付什么：**完成 0—6 即可审阅“固定操作建模、验证、提交、重启不损坏”的确定性纵切；完成 7—10 才是 Web/fake 闭环；完成 11 才能验收有限范围的真实 Text-to-CAD。
