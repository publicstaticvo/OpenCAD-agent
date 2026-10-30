# OpenCAD Agent

本地单用户 Text-to-CAD 工作区：React/Three.js → HTTP/WS Gateway/Pi → 独立原生 FreeCAD Worker。正式模型必须经过候选隔离、独立文件/几何验收和 SQLite Revision CAS 提交。单零件功能支持单 Body/单实体、平面 line/circle 草图、命名约束、Pad/Pocket 与白名单参数修改。受限双零件能力支持带中心贯穿孔的矩形底板、圆柱销、FreeCAD 原生固定关节、BOM、实际干涉检查及装配导出，也支持在现有装配中修改销直径。`advanced-model.yaml` 已通过 60×40×8 mm 底板、Ø8 mm 孔、Ø7×20 mm 销的在线装配验收，以及将销修改至 Ø10 mm 后检测碰撞并保护正式版本的验收。其余范围不包含通用多零件设计、STEP 编辑、图像、工程图或 Python 执行入口。

## 本机启动

要求 Linux（UDS、进程组、/proc、util-linux 的 `/usr/bin/flock`）、锁定 Node24.22.1、实际 FreeCAD1.1.3/Python3.11.14/OCCT7.8.1 运行时和 Chrome/Chromium。`npm ci` 使用根锁文件安装应用依赖；不安装 Pi 上游工作区依赖。Pi 源码通过本地 source alias 复用，必须另行准备与 `docs/pi-source-sha256.json` 一致的 `pi/`。应用维护的 `openai-client.ts`、`openai-completions.ts` 和 `openai-responses.ts` 三个文件包含关闭 SDK 默认超时的适配，由应用 Git 管理；准备其余 Pi 源码时保留这些文件，再运行指纹检查。其余 Pi 源码未复制进应用 Git 历史。当前来源/调查及缺失时的处理见[准备审查](docs/implementation-readiness.md)。不要将个人 Pi 安装目录/登录信息作为应用运行依赖。

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

### 获批后的真实建模

1. 创建空白项目，输入 `创建一个长40 mm、宽30 mm、高10 mm的长方体。只需要一个实体，不添加其他特征。`。
2. 检查计划卡的尺寸、草图/Pad 步骤与验收体积，点击“批准并开始建模”。待批准阶段不创建候选、不启动可写 Worker；拒绝计划不改变模型。
3. 查看实际 FreeCAD 草图和约束、操作记录及候选实体。候选明确标记为未提交，正式特征树与下载继续对应原修订。验证、保存、独立重开和导出通过后显示正式版本 1。
4. 输入 `在当前长方体上增加一个直径6 mm的中心贯穿孔，保留其他尺寸。`，检查并批准新计划；真实圆草图和 Pocket 通过验证后成为正式版本 2。
5. 输入 `把已有中心贯穿孔的孔径从6 mm修改为8 mm，保留其他尺寸和特征。`，检查计划中的 6→8 修改并批准；通过验证后成为正式版本 3。
6. 使用“查看修订”选择历史版本，检查对应参数并下载该修订的 FCStd、STEP 或 GLB。历史版本只读；选择“当前正式版本”后可提交后续请求。活动记录中的“查看实际草图检查点”保留本任务真实草图与约束。

长方体尺寸从模型计划取得；当前自然语言审批支持长方体、该长方体的单个中心贯穿孔及孔径修改。每个修改任务都需要新批准，服务端检查对象、尺寸、约束和阶段；没有自动 CAD 写入修复。失败或取消保留对话和原正式模型。已有属性修改入口同样生成待批准任务，不直接改写正式文件。

离线启动使用 `CAD_PROVIDER=fake npm run dev`，支持明确尺寸的孔板、垫套、台阶块和指定命名参数修改；它使用固定规则选择 CAD 操作，仍需批准并执行真实 FreeCAD。`CAD_PROVIDER=none npm run dev` 禁用模型建模。离线结果不能证明真实模型能力。

### 双零件装配演示

设置 `CAD_PROVIDER=fake` 后创建空白项目，输入：`装配：80×60×10 mm 底板，中心孔8 mm，圆柱销直径7 mm，长20 mm`。检查结构化计划并批准；Worker 会在隔离候选中建立两个独立参数化 Body、约束草图、Pad/Pocket、原生 Assembly 固定关节和真实几何干涉报告。验证成功后才提交正式修订。正式修订页面显示同一版本的组件位置、BOM 与干涉报告，可下载 FCStd、STEP 和 GLB。该离线入口仅匹配此演示尺寸及销直径 7/9 mm；9 mm 用于现场展示真实碰撞与正式版本保护，不属于有效装配结果。此演示不会调用模型服务。

对应离线验证命令为 `npm run test:unit -- tests/assembly-plan.test.ts tests/assembly-workflow.test.ts`、`npm run test:cad` 和 `npm run test:e2e -- tests/e2e/assembly.spec.ts`。浏览器完整回归使用 `npm run test:e2e`。这些离线测试驱动已批准的固定操作流程并运行真实 FreeCAD。

在线固定样例使用 `TMPDIR="$PWD/.work/tmp" RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml npm run test:e2e:live -- tests/live/advanced-assembly.spec.ts`。配置文件需包含 `base_url`、`api_key`、`model` 和可选 `protocol`，测试会调用该服务并自动批准样例计划。运行前创建被 Git 忽略的 `.work/tmp` 目录；已有服务不得占用测试端口 4175。测试证据与复核方法见 [多零件在线验收记录](artifacts/live-assembly-advanced/README.md)。手动使用时，按照下方在线模式启动，在模型设置中配置服务，在空白项目输入装配需求，确认计划后批准；修改销直径也需要批准新的计划。

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
