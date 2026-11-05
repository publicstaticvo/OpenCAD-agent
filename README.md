# OpenCAD Agent

本地单用户 Text-to-CAD 工作区：React/Three.js → HTTP/WS Gateway/Pi → FreeCAD Worker → Linux 隔离进程。在线 Agent 使用 Pi 的 `read/write/edit` 保存不可变 Python 工程快照，通过 `cad_run` 显式执行指定版本。每次执行自动检查几何、独立重开并生成 STEP、GLB 和真实几何图像。成功候选等待用户验收，验收绑定具体执行身份后生成正式修订。执行、隔离及配置见 [Python 建模流程](docs/python-modeling.md)，测试步骤与结果见 [源码与执行专项测试](docs/testing/source-execution-phase-1-2.md)。本次未调用真实模型服务。

顶部布局图标可以打开可编辑 Python 源码及逐版本 Diff。Ctrl/Cmd+S 保存工作副本；运行、检查点和交给 Agent 时冻结版本。活动历史统一显示可见回复、源码修改、真实执行与检查；模型工具栏通过单一“导出”菜单交付正式修订。交互及逐项验证见[源码工作区与活动历史测试](docs/testing/source-workspace-and-activity-timeline.md)。

## 本机启动

要求 Linux（UDS、进程组、/proc、util-linux 的 `/usr/bin/flock`）、Bubblewrap、libseccomp、允许的用户命名空间、锁定 Node24.22.1、实际 FreeCAD1.1.3/Python3.11.14/OCCT7.8.1 运行时及其 Pillow，以及 Chrome/Chromium。`npm ci` 使用根锁文件安装应用依赖；不安装 Pi 上游工作区依赖。Pi 源码通过本地 source alias 复用，必须另行准备与 `docs/pi-source-sha256.json` 一致的 `pi/`。应用维护的 `openai-client.ts`、`openai-completions.ts` 和 `openai-responses.ts` 三个文件包含关闭 SDK 默认超时的适配，由应用 Git 管理；准备其余 Pi 源码时保留这些文件，再运行指纹检查。其余 Pi 源码未复制进应用 Git 历史。当前来源/调查及缺失时的处理见[准备审查](docs/implementation-readiness.md)。不要将个人 Pi 安装目录/登录信息作为应用运行依赖。

```bash
npm ci
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run verify:pi
# 指向完整解包的匹配 FreeCAD AppImage；不要用默认/conda Python 代替
export FREECAD_RUNTIME_ROOT=/absolute/path/to/FreeCAD/squashfs-root
npm run doctor
npm run build
npm run dev
```

`doctor` 会实际 import native modules、检查精确版本、绑定 UDS 并检查 fd 内核锁的持有/竞争/释放，失败必须解决。当前机器忽略的 `runtime.local.json` 仅为本机配置，不能依赖 `/tmp` 在部署后永久存在。AppImage SHA256及解包探针见准备审查。实际 Worker 不加载 GUI，子进程剔除外层 PYTHONPATH/PYTHONHOME/LD_LIBRARY_PATH/DISPLAY。

打开 `http://127.0.0.1:3000`，读取启动日志指定的本地 `data/access-token` 作为访问密钥。连接后填写模型服务的 baseUrl 和 API key，点击“获取模型列表”，选择模型并保存，然后创建项目。程序自动确定模型限制并生成服务端配置。环境可显式提供 `CAD_ACCESS_TOKEN`（至少24字符）。浏览器只在当前标签页保存工作区访问密钥；模型 API key 仅用于配置请求，保存于服务端私有文件。`CAD_DATA_DIR` 默认 `data/`；`CAD_HOST` 默认 loopback；非同源前端需配置 `CAD_ALLOWED_ORIGINS`。开发前端可另开 `npm run web`，允许对应5173 origin；正式入口使用 `dist/` 静态资源。服务和数据目录应处于可信本机或受保护环境。

在线设置可选择 OpenAI Chat Completions 或 OpenAI Responses；保存前实际验证文本流和只读 CAD 工具往返。程序仅使用网页保存或 `CAD_MODEL_CONFIG` 显式指定的凭据。

### Python 建模与候选验收

1. 创建空白项目，输入 `创建一个长40 mm、宽30 mm、高10 mm的长方体。只需要一个实体，不添加其他特征。`。
2. Agent 使用项目文件工具修改 Python 源码，并主动运行指定源码快照。普通建模请求直接开始任务；明确要求“等待我批准”时，先显示计划供用户批准。
3. 查看统一活动历史中的源码 Diff、Python 执行和真实几何检查。检查成功的候选在模型视口显示，点击“验收候选并提交”生成正式修订；拒绝候选保留原正式模型。用户无需输入任何工具名称。
4. 输入 `在当前长方体上增加一个直径6 mm的中心贯穿孔，保留其他尺寸。`，检查源码修改和实际候选，通过人工验收后成为正式版本 2。
5. 输入 `把已有中心贯穿孔的孔径从6 mm修改为8 mm，保留其他尺寸和特征。`，检查 Diff、几何及文件检查结果，验收后成为正式版本 3。
6. 使用“查看修订”选择历史版本，检查对应参数并下载该修订的 FCStd、STEP 或 GLB。历史版本只读；活动记录中的“查看执行源码”打开该次执行实际使用的完整工程。

尺寸、体积和命名参数可以通过任务验收条件进行实际检查。缺少任务条件时报告明确标记“未执行任务验收”，健康和交付检查成功后仍需要用户验收。失败或取消保留对话和原正式模型。源码面板支持文件树、多个文件、完整历史快照与逐文件 Diff；普通保存只更新工作副本，运行指定不可变项目快照。用户可以导入 Python 文件或 ZIP 工程，打开 `.py` 或 `.FCMacro` 后点击“运行当前文件”，无需调用模型。运行菜单中的“运行项目”使用项目默认入口；文件右键菜单中的“设为项目入口”显式更新默认入口。实际执行详情位于中间工作区底部，候选由用户验收。菜单、文件操作、独立撤销记录和截图见 [CAD IDE 工作区](docs/ide-workspace.md)，执行与隔离见 [Python 工作流](docs/python-modeling.md)。

### Python 在线建模与离线操作测试

在线模式使用网页模型配置，或启动时显式指定本地 YAML：

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run build
CAD_PROVIDER=live CAD_MODEL_CONFIG=advanced-model.yaml npm run dev
```

在空白项目输入：`创建一个直角三角棱柱，XY 顶点为 (0,0)、(40,0)、(0,30) mm，沿 +Z 拉伸10 mm。使用真实参数化草图和 Pad。` Agent 使用 Python 建模；独立重开与导出验证通过后显示候选，用户验收后切换正式版本。后续输入 `将当前三角棱柱 Pad 长度改为12 mm，保持其他尺寸。` 并检查、验收修改后的候选。本轮没有重新执行这些自然语言在线样例。

另一项任务可在新项目输入：`创建 L 形平板支架，XY 轮廓依次为 (0,0)、(60,0)、(60,10)、(10,10)、(10,50)、(0,50) mm，闭合后沿 +Z 拉伸8 mm。各边水平或垂直，草图完全约束，先提交操作计划。` 后续可要求在 (30,5) mm 增加 Ø4 mm 贯穿孔。每个任务分别审批。

旧结构化计划测试及其历史证据见[通用操作计划验收](docs/general-operations-slice.md)。这些入口继续服务离线样例和已有测试；在线 Python Agent 的正常工具集合为 `read/write/edit/cad_files/cad_run`，正式验收由用户完成。旧在线测试文件属于迁移前接口的验收记录，不能用于证明当前 Python Agent 链路通过在线验收。

离线启动使用 `CAD_PROVIDER=fake npm run dev`，支持明确尺寸的孔板、垫套、台阶块和指定命名参数修改；它使用固定规则选择 CAD 操作，仍需批准并执行真实 FreeCAD。`CAD_PROVIDER=none npm run dev` 禁用模型建模。离线结果不能证明真实模型能力。

### 双零件装配演示

设置 `CAD_PROVIDER=fake` 后创建空白项目，输入：`装配：80×60×10 mm 底板，中心孔8 mm，圆柱销直径7 mm，长20 mm`。检查结构化计划并批准；Worker 会在隔离候选中建立两个独立参数化 Body、约束草图、Pad/Pocket、原生 Assembly 固定关节和真实几何干涉报告。验证成功后才提交正式修订。正式修订页面显示同一版本的组件位置、BOM 与干涉报告，可下载 FCStd、STEP 和 GLB。该离线入口仅匹配此演示尺寸及销直径 7/9 mm；9 mm 用于现场展示真实碰撞与正式版本保护，不属于有效装配结果。此演示不会调用模型服务。

对应离线验证命令为 `npm run test:unit -- tests/assembly-plan.test.ts tests/assembly-workflow.test.ts`、`npm run test:cad` 和 `npm run test:e2e -- tests/e2e/assembly.spec.ts`。浏览器完整回归使用 `npm run test:e2e`。这些离线测试驱动已批准的固定操作流程并运行真实 FreeCAD。

迁移前的在线固定装配样例及证据见 [多零件在线验收记录](artifacts/live-assembly-advanced/README.md)。其计划审批与固定操作断言适用于当时的结构化接口。当前 Python 在线工作流使用本节启动命令和 [H1–H5 验收步骤](docs/testing/source-execution-phase-1-2.md)，本轮没有执行在线验收。

网页配置、YAML 启动、模型限制来源、文件权限以及真实模型测试说明见[在线模型配置与验证](docs/online-mode.md)。模型设置提供获批执行、单次模型请求、单次 CAD 操作三项超时，单位秒，默认均为 0（不设超时）。公司本地模型费用显示“未配置”。

工作区支持项目新建、列表、切换及改名，每个项目拥有独立正式模型和修订；项目内支持多个独立历史与上下文的对话。所有对话共享该项目当前模型；允许多个待批准计划，同项目同时只有一个获批写任务。执行过程中持续显示实际文字、CAD 工具及保存/重开/导出事件，可选择关键或完整执行记录。接口、迁移与恢复约定见[工作区功能说明](docs/workspace-contracts.md)，本次 M1/M2 证据见[演示产品验收](docs/v1-demo-validation.md)，模型兼容性历史记录见[在线验证记录](docs/online-validation.md)。

## 测试与交付状态

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
npm run test:eval -- evals/text-to-cad/v1.json
```

需要可绑定 UDS/HTTP 和启动真实浏览器的本机/CI。沙箱返回 EPERM 时不能算通过，需在获准环境执行。E2E 优先使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`，当前本机使用 `/opt/google/chrome/chrome`；其他机器可 `npm exec -- playwright install chromium` 并提供系统库。当前自动化显式使用 ANGLE SwiftShader，验证真实 WebGL/GLTFLoader/像素几何和交互，但**未验收硬件 GPU 或交互桌面兼容性**。

测试不静默 skip native CAD。`test:unit` 也包含真实 UDS/故障进程/HTTP 的应用集成测试；名称不表示全是内存 Mock。`test:cad` 由 host unittest 调用匹配 bundled Python。下载 E2E 会用独立 native process 重开 FCStd、修改命名参数并重新验收，以及 STEP 重导入。

历史阶段状态和风险见[实施记录](docs/phase1-status.md)，当前演示范围与实际验证结果见[演示产品验收](docs/v1-demo-validation.md)。评测授权门禁与成本记录见[评测说明](evals/text-to-cad/README.md)。

## 状态与恢复约定

- 一个数据目录只允许一个 Gateway/Supervisor；一个串行候选 Worker。`supervisor.owner.lock` 的持久 inode + 父进程持有 fd 的内核锁是所有权权威，禁止删除/替换此文件；JSON lease 仅为原子持久化诊断，不通过删除旧 JSON 抢占活跃 owner。正式版本是 `data/revisions/<candidateId>/` 不可变完整包；SQLite WAL/FULL 保存 HEAD、操作幂等结果、任务和事件。
- 只有 `committed` 才表示正式成功；assistant 的“成功”文本没有提交权。Web模型、树、属性和下载总是同一完整 Revision。当前 Before/After 比较最近显示过的两份完整版本；刷新重建当前快照，不承诺跨刷新持久保存 UI 的 previous 指针。
- 失败/取消/超时/进程被终止不覆盖旧包。Gateway 重启保留待批准计划，将执行中的任务标记 interrupted，不自动重放 CAD 副作用。重试应新建任务并重新批准，网络重试同一 operationId只能发送完全相同内容/baseRevision。
- 诊断lease通过临时写入、fsync和原子rename发布；SIGKILL/写失败不会发布半份JSON，正常重启清理已确认协议所属临时文件。历史上已损坏的诊断JSON会明确 fail closed；停止所有Gateway、保留整个目录后人工检查，不依据损坏元数据杀PID，也不删除owner锁inode来解锁。
- 启动检测正式文件缺失/哈希损坏会将文档 fail closed 为 corrupt，不自动回退或补零。停止服务并保留整个数据目录检查；不要手改 HEAD 或删除 DB 来“修复”。文件发布但 DB 未引用的包隔离到 quarantine，失败候选仅保留最近10个；隔离包暂不自动清理。
- 测试覆盖 SIGKILL/挂起/取消、提交窗口故障、模拟 ENOSPC与实际权限失败；没有做掉电、磁盘硬件故障或网络文件系统一致性认证。备份应在服务停止后复制**整个**数据目录（含SQLite相关文件和全部正式包），不能只备份 FCStd。恢复/磁盘整理 UI不在本阶段内。
