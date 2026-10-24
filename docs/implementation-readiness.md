# Text-to-CAD 实施准备审查

调查日期：2026-10-24。范围：`~/ai4s/cad-web`、相邻 CAD 项目的相关模块、本机运行环境及上游一手资料。本轮未实现产品功能、安装项目依赖或修改 `pi/`；实验文件保存在 `/tmp`。

可追溯记录：[环境](evidence/environment-2026-10-24.json)、[FreeCAD 实验](evidence/freecad-readiness-2026-10-24.json)、[Pi 实验](evidence/pi-readiness-2026-10-24.json)。

## 结论与第一步

**可以开始阶段一的环境固化和确定性建模；尚不能宣称平台已有可靠闭环。** 当前目录是设计稿加 Pi 源码，不是已经连好的 CAD Web 产品。已用真实 FreeCAD 完成草图→Pad→Pocket→参数修改→FCStd 重开及 STEP/GLB 导出。最大实施风险是提交一致性、候选隔离和前端混用不同版本的数据，而非是否能够生成一个实体。

第一步是把本次实验固化成失败即停止的环境检查和 CAD 集成测试，然后实现**不调用大模型的候选事务闭环**。通过故障注入后再接 Pi 和浏览器。具体依赖顺序见[阶段一计划](superpowers/plans/2026-10-24-text-to-cad.md)。

## 已确认的事实与证据

| 项目 | 确认结果 | 证据/限制 |
| --- | --- | --- |
| 项目边界 | `cad-web/` 只有 `docs/`、`pi/`；根目录不是 Git 仓库 | `ls -la`、`git status`；不要误把产品代码写进 Pi 上游仓库 |
| 现有前端 | 此目录没有 Web 应用、根 package.json、Gateway、CAD Worker 或应用测试 | 目录及 package.json 扫描；设计所说的 `buerligons-next` 未在检查位置找到 |
| Pi 来源 | 独立 Git checkout，干净；提交 `b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb`，2026-10-14；origin 为 `earendil-works/pi` | `pi/README.md`、`pi/AGENTS.md`、`git -C pi log/status/remote` |
| Pi 依赖 | `pi-agent-core`、`pi-ai`、`pi-durable` 均声明 1.2.0；TypeBox 1.3.27、Vitest 4.1.11、TypeScript 7.0.2；Node >=22.19.0 | `pi/package.json`、包 package.json、package-lock.json；这些是源码/锁文件版本，**不是已安装运行结果** |
| Pi 接入点 | `AgentTool`、Schema 校验、before/after hook、`subscribe`、`steer`、`abort` 已存在；默认工具执行是 parallel | `pi/packages/agent/src/{types,agent,agent-loop}.ts`；应用必须显式顺序执行 CAD 写工具。Pi hook 本身不等于 CAD 事务 |
| Pi 可运行性 | 本 checkout 无 node_modules、dist，catalog 派生数据也未落地；通过 source alias 已跑通本地 1.2.0 的 fake 工具循环 | [source probe](probes/pi_readiness.mjs) 只借用全局目录中匹配版本的 TypeBox 1.3.27、partial-json 0.1.7；没有运行全局 Pi 1.3.0 或本仓库 Vitest 全套，也未验证独立安装/付费 provider |
| Pi 校验边界 | 实测 `diameter: true` 经 Pi 参数转换变成 `1` 并执行；检查原始参数的 before hook 能阻止执行 | [3 个场景的结果](evidence/pi-readiness-2026-10-24.json)；CAD 严格类型规则不能只依赖 Pi 自带 Schema 校验 |
| Durable 选项 | `pi-durable` 提供持久会话、SQLite、replay 策略，但 README 明确 Experimental | `pi/packages/durable/README.md`、`src/storage/sqlite/node.ts`；会话持久化不能自动保证外部 FCStd 的原子提交 |
| 当前开发环境 | Node 25.9.0、npm 11.12.1；默认 Python 3.14.3；名为 freecad 的 conda 环境是 Python 3.12.3，二者都找不到 FreeCAD 模块 | `command -v`、版本命令、`importlib.util.find_spec`；禁止拿环境名推断可用性 |
| 可用 CAD runtime | 下载目录 AppImage 解包后，其 Python 3.11.14 可加载 FreeCAD 1.1.3、OCCT 7.8.1；`GuiUp=0` | [实验结果](evidence/freecad-readiness-2026-10-24.json)；必须使用整套匹配的 Python/动态库，不能向默认 Python 随意加路径 |
| 另一套 FreeCAD | Snap revision 2741 的 metadata 声明 `1.1-g0108fd4b`，但本执行沙箱调用 `freecad.cmd` 因 `/run/user/1000/snap.freecad` 只读失败 | 这是本次沙箱限制，**不能推断宿主机 Snap 已损坏**；Snap runtime 未通过本轮验证 |
| SQLite | 当前 Node 的 `node:sqlite` 可查询 SQLite 3.51.3；临时文件库切到 WAL、设置 FULL、事务写入 rev=1 后关闭重开仍为 1 | 通过基本写入/重开，不是进程中断/断电恢复或目标部署 Node 的验证 |
| UDS 环境 | 本执行沙箱的 AF_UNIX bind 返回 EPERM | [探针](probes/uds_readiness.py) 未证明宿主机不可用；申请沙箱外验证时自动审批因审核模型不可用（404）失败，命令未执行。真实 UDS/HTTP 服务测试需可绑定 socket 的环境 |

复用调查（均未作为已安装产品依赖）：

- 相邻 `cadpilot/`：MIT，0.7.7，提交 `c079d2f6b1d17858d4b374610a6174deaacb0d34`。`addon/CADPilot/rpc_server/sketcher_ops.py`、`feature_ops.py` 和对应测试可参考草图、约束、特征及 Body/Tip 规则；`gui_dispatch.py` 明确依赖 FreeCADGui/PySide 主线程，**不可直接充当 headless Worker**。未运行该项目测试，不承诺模块可直接搬用。
- 相邻 `freecad-ai/`：提交 `11bc3b71cf5321f9ae51478eedf28d842cd76ebd`，`LICENSE-CODE` 为 LGPL-2.1；`core/executor.py` 可参考子进程 dry-run、诊断和回滚经验；不把 Python 静态过滤或 FreeCAD undo 当安全隔离/文件事务。`freecad-mcp/`（MIT，提交 `78bf0230a03324b56c9a0b7f55150fb5be2a0d42`）的 `freecad_client.py` 可参考每次 RPC 独立 transport 和超时策略，但仍是现有桌面 addon/XML-RPC 路径。
- 上游 [wangtao9090/VibeCAD](https://github.com/wangtao9090/VibeCAD)：README 描述 candidate checkout、验证、draft、commit/reject、可终止 Worker；pyproject 声明 0.10.1、Python >=3.12，LICENSE 为 MIT。[调查时 main 的 SHA](https://api.github.com/repos/wangtao9090/VibeCAD/commits/main) 为 `faa4fa3c5bcc550b1b78cf8759f091de815f5ed0`（2026-08-21）。**仅核实上游资料，尚无本地源码运行验证**；固定 SHA 的源码目录取回受限，Worker 协议/提交机制未核实。也存在不同的 `10-X-eng/vibecad` 项目，不能混为一谈。设计稿将复用组件统称 LGPL 不准确，必须逐文件核实。AppImage 的 Python 3.11 与其声明下限不同，整体复用前需兼容性实验，不能据此断言每个独立模块都不兼容。
- 上游 [awv-informatik/buerligons](https://github.com/awv-informatik/buerligons) 是 MIT Web 应用，但依赖 ClassCAD。未确认设计中的确切 `buerligons-next` 来源及其版本；不把 ClassCAD 模型/通信层视为 FreeCAD 适配器。新建最小 Web 工作区不依赖找到它。

## 已做的小型实验

可复现脚本：[freecad_readiness.py](probes/freecad_readiness.py)。它是调查夹具，**不是生产 Worker、事务引擎或浏览器测试**。每个 action 均启动独立的 FreeCAD Python 进程，CAD 输出只写新建的输出目录。

| 实验 | 结果 |
| --- | --- |
| 80×60×10 mm 板，孔中心 (20,15)，直径 6 mm | 两张完全约束草图、真实 Pad/Pocket、一个有效实体；体积 47717.256661176914 mm³ |
| FCStd 保存，另进程打开 | 特征类型、约束、尺寸、实体和自定义稳定 ID 通过检查 |
| 候选孔径改为 8 mm，保存并另进程打开 | 体积 47497.34517542564 mm³，仍为一个有效实体；正式文件 SHA-256 不变 |
| 孔径改为 500 mm 的失败用例 | Pocket 的 State/Status 仍是 Up-to-date/Valid，但实体数 0、体积 0；由确定性验收拒绝。因此只看 recompute 或状态文本不够 |
| 候选保存后 SIGKILL；另一次打开候选后超时杀进程 | 两次正式文件 SHA-256 不变，后续导出进程可重开正式文件；仅验证候选文件分离原则，**未覆盖真实 Supervisor 或提交窗口崩溃** |
| STEP 导出→新文档重新导入 | 一个有效实体，体积与正式模型相同；没有把 STEP 当参数化历史存储 |
| headless GLB | `Shape.tessellate(0.1)` 后 `Import.export` 生成 18832 字节 GLB，检查头、JSON chunk 和非空 POSITION accessor；未做浏览器加载/截图验收 |
| GLB 坐标 | 此夹具由 CAD 的 Z-up、mm 转成 GLB Y-up、m：`(x,y,z) → (x,z,-y)/1000`，包围盒 `[0,0,-0.06]..[0.08,0.01,0]`；前端不可重复缩放/旋转 |

复现（`out` 必须不存在；AppImage 已存在，不联网安装）：

```bash
cd ~/ai4s/cad-web
mkdir -p /tmp/cad-web-readiness-runtime
cd /tmp/cad-web-readiness-runtime
~/下载/FreeCAD_1.1.3-Linux-x86_64-py311.AppImage --appimage-extract > extraction.log 2>&1
cd ~/ai4s/cad-web
python docs/probes/freecad_readiness.py \
  --runtime-root /tmp/cad-web-readiness-runtime/squashfs-root \
  --output /tmp/cad-web-readiness-recheck
```

退出码 0 且输出目录有 `results.json` 才算通过；失败查对应 action.log。AppImage SHA-256：`3a853eb69ee595f779f2255dbf80a765926981d8ff68903cefee4dfb03a8f5ef`。本轮 `/tmp/cad-web-readiness-final` 完整日志/CAD 文件只作本机调查记录，不依赖 `/tmp` 长期保存；机器可读结果另存 evidence/。

官方依据：[Headless FreeCAD](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Headless_FreeCAD.md) 解释 GUI 与 core API 边界；[FreeCAD #8610](https://github.com/FreeCAD/FreeCAD/issues/8610) 的维护者说明 headless glTF 需要显式 tessellation。本轮以实际二进制结果为准，未验证 Fillet、Chamfer、Pattern、语义面选择、截图或所有几何的可制造性。

Pi 无网络源码实验：`node docs/probes/pi_readiness.mjs ./pi /home/lenovo/.pi/agent/install/releases/1.3.0/node_modules`。探针明确把 agent/ai/telemetry 解析到本地源码，检查借用的两个通用依赖的版本；数字 8、bool→1、严格 hook 阻止 bool 三个场景均通过。该路径是本机调查夹具，产品必须建立独立依赖；本轮没有执行 npm 安装或真实 LLM 请求。普通 shell 对 GitHub 的 DNS 解析失败，官方资料通过 web 工具取得；网络/registry 环境仍需在安装时验证。

## 实施缺口与建议约定

以下是本轮提出的**工程默认值，尚未实现，不是设计稿已经保证的行为**。

1. **接入边界**：Gateway 嵌入 `pi-agent-core` + 明确配置的 `pi-ai` provider，通过窄适配器隔离版本；不启动拥有 bash/read/write 权限的 coding-agent CLI。暂不采用 experimental durable、Subagent 或多模型路由。会话和任务由应用持久化；重启后中断任务标为 interrupted，由用户显式重试，不自动重放 CAD 副作用。
2. **Gateway↔Worker**：沿用本机 UDS + JSON-RPC 2.0。应用协议 `protocolVersion=1` 与 `jsonrpc="2.0"` 分开；每条 UTF-8 JSON 以 LF 分帧，初始上限 1 MiB，禁止 NaN/Infinity。握手报告 FreeCAD/Python/OCCT、capabilities、workerInstanceId；响应按 id 匹配。UDS 放服务私有 0700 目录，socket 0600；日志不进 RPC channel。契约测试覆盖拆包/粘包、未知方法、超限、退出、迟到响应。JSON-RPC 不自带这些语义，见[规范](https://www.jsonrpc.org/specification)。
3. **串行与取消**：先配置 Worker 数=1，全局串行 CAD 命令，保留 document 锁和提交时版本比较；不要先造池调度器。FreeCAD API 在 Worker 主线程执行，不用线程池并发写文档。取消先阻止后续操作和提交；原子 native 调用返回后丢弃候选。超时由父进程终止候选进程并重启，旧实例的迟到响应永不提交；忙碌期间 ping 不响应不能单独判死。
4. **CAD 工具**：先覆盖单 Body、平面 line/circle 草图、明确约束、Pad、Pocket、白名单参数修改和只读检查。长度 mm、角度度、CAD 右手 Z-up；禁止任意 Python、文件路径和 Shell 工具。Schema 和 Python 端均检查有限数值、范围、对象类型/归属与能力；不支持的请求明确返回 unsupported。实体/尺寸验收初始绝对公差 `1e-6 mm`，体积公差 `max(1e-6 mm³, abs(expected)*1e-9)`，网格离散 0.1 mm 与几何验收分开。这些只对本期夹具成立，不是全 CAD 公差政策。
5. **操作与事务粒度**：一次用户修改对应一个 candidate，多个建模工具共用它；空草图等中间态允许存在，**不能每调用一次 create_sketch 就要求最终实体并提交**。Gateway 注入 `documentId/baseRevision/candidateId/operationId`；模型不能指定正式文件路径。相同 operationId + 相同 payload 返回既有结果，不同 payload 拒绝；工具子步骤也有稳定 stepId。interrupted 的旧 ID 返回中断事实，显式重试用新 ID 和最新 baseRevision。提交前再次比较 baseRevision；新用户指令不隐式改写正在执行的候选。
6. **保存与发布**：Worker 只保存 staging FCStd；独立进程重开并验收，派生 STEP/GLB/tree/manifest 全部带同一 revision/candidate 标识。推荐先将完整包 fsync 并同文件系统 rename 为不可变 `revisions/<id>/`，再以 SQLite 单事务比较旧 HEAD、写 revision/operation/event 并推进 HEAD。正式可见性的唯一切换点是 DB 提交；不得先发 committed 再写盘。
7. **必要的设计调整**：原稿 mutable `canonical.FCStd` + 多个 JSON/事件文件分别更新，无法靠一次文件替换获得整体原子性。推荐 **HEAD 指向不可变 FCStd，canonical.FCStd 仅作可重建兼容副本**；tree/events.jsonl 同样是缓存/导出，不能成为第二个权威源。这样不引入额外服务。重启对账：有包无 DB 引用→孤儿；DB 引用缺包/校验失败→明确故障，不悄悄创建空模型。回退旧内容生成新 revision；正式历史不覆盖。SQLite WAL/FULL、fsync、磁盘满及崩溃窗口必须实测，不把 rename 等同于跨 DB/文件事务或断电保证。
8. **版本与标识**：revision 是整个 FCStd 快照，不合并 BRep diff；稳定 featureId 写入自定义属性并随 FCStd 保存，Label 只用于显示。约束/参数使用命名映射，不把裸 FaceN/EdgeN 或约束数组下标作为跨版本持久引用。第一期选择 feature，不承诺任意面/边编辑；复杂语义拓扑选择后移。
9. **Web 状态同步**：HTTP 提交任务/取 snapshot/artifact，WS 推送应用事件。事件含单调 seq、documentId、jobId、baseRevision、revision、candidateId。snapshot 包含 lastSeq；断线按 seq 补发，无法补齐则取快照；丢弃重复/过期事件。候选预览与正式树分开展示；tree/mesh/参数同版本才整体切换，迟到 GLB 不覆盖新版本。先完整 GLB，不做增量网格、面选择和测量。CAD↔GLB 坐标转换只在一个边界做。
10. **验收与隔离**：模型验证是确定性代码，不依赖另一个 LLM 说“通过”。最终检查对象错误、约束、Tip、非空 Shape、有效性、实体数、参数、包围盒/体积；保存后独立重开再验证。单一 `isValid()` 不证明设计意图、自相交全部情形或可制造性。Worker 独立进程只解决故障传播，不自动限制 OS 权限；一期禁任意代码并仅接可信用户/受保护局域网，若开放上传或任意脚本，须先补 OS 级沙箱，不能用正则过滤替代。

## 阻塞、默认与后置决策

| 分类 | 事项与处理 |
| --- | --- |
| 开发前无须等负责人 | 可以立即做环境固化、确定性 CAD 测试、RPC 和事务。上表单位、分帧、ID、版本比较、事件恢复等由工程人员落实，不转交负责人 |
| 首个可运行版本的技术门槛 | 目标机器 runtime 固定；Pi 独立依赖/构建；可绑定 socket 的服务测试环境；真实 Worker + 提交恢复测试；浏览器 GLB 解析。当前 CAD probe 和 Pi source/fake smoke 已通过，产品环境与集成由计划逐项关闭，不能跳过直接做 Agent 演示 |
| 发布范围需负责人判断 | 建议首个验收集只承诺单实体、平面草图 + Pad/Pocket：孔板、空心垫套、台阶块，以及多轮尺寸修改；圆角、阵列暂不作为第一交付承诺。如果实际首批业务必须依赖它们，需要增加操作/拓扑测试再承诺，不能用“Text-to-CAD 支持任意零件”描述产品。此决定阻塞验收范围冻结，不阻塞前述基础工程 |
| 真实模型接入前需负责人判断 | 哪个获准模型服务可接收用户文本及 CAD 摘要、是否允许出机器、可接受的单任务成本/等待上限。建议开发默认用 fake provider；获准后只上传必要摘要，不上传 FCStd/网格。没有授权/凭据时不调用付费服务、不读取个人 Pi 登录信息；这阻塞 live 评测，不阻塞确定性闭环 |
| 工程自行调查关闭 | npm 源/网络、维护中的 Node LTS 精确补丁、Pi source 与发布包差异、VibeCAD 源码兼容性/许可证、浏览器 feature↔mesh 映射。不能要求负责人选择序列化库或解释 FreeCAD API |
| 可以后移 | Subagent/Verification LLM、常驻多 Worker 池、gRPC、远程存储、增量 BRep/mesh、任意 Python、任意拓扑选择、自动续跑；STEP 编辑、Image-to-CAD、装配和工程图明确不做 |

产品负责人本轮需要审阅的是**首批零件覆盖范围**与**真实模型的数据/成本边界**。其余按推荐默认实施并以测试反馈修正。不要把缺少一套完整 CAD 工具目录或找不到 buerligons-next 当作停止开发的理由。

## 阶段一退出条件

- 无模型/API 的可复现测试先通过；再以显式获准 provider 完成小型版本化 Text-to-CAD 评测，分别报告成功、失败、修复和耗时，不能用 fake 的成功率代替模型能力。
- 创建孔板→显示过程/树/预览→文字或属性改孔径→得到新 revision；下载的 FCStd 可在匹配 FreeCAD 中继续编辑，STEP 重导入为有效单实体。
- 失败、超时、取消、Worker SIGKILL、Gateway 在每个提交窗口被终止、重复请求、旧版本提交：正式 HEAD/文件/事件一致，不多提交，不污染原模型。当前文件探针**没有**完成这些应用级验收。
- 刷新/重开项目保留正式 revision、树、参数、完成的会话和任务结果；断线补事件后收敛，旧 GLB/事件不可覆盖新状态；未完成任务明确 interrupted。
- 浏览器真实加载 GLB 并检查缩放/朝向、特征选择映射与预览状态，不以“文件非空”作为 Web 验收；候选 Before/After 可先用两份完整 GLB 切换，无需几何 diff 引擎。

未验证项均留在上述门槛和[具体任务](superpowers/plans/2026-10-24-text-to-cad.md)中；本调查不意味着平台或上游复用代码已经通过生产验收。
