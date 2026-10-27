# OpenCAD Agent

本地单用户 Text-to-CAD 工作区：React/Three.js → HTTP/WS Gateway/Pi → 独立原生 FreeCAD Worker。正式模型必须经过候选隔离、独立文件/几何验收和 SQLite Revision CAS 提交。支持单 Body/单实体、平面 line/circle 草图、命名约束、Pad/Pocket 与白名单参数修改。在线模式通过网页配置兼容 OpenAI 的模型服务，另提供离线固定样例模式。支持范围不包含 STEP 编辑、图像、装配、工程图或 Python 执行入口。

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

样例：`创建40×30×10 mm长方体`，再通过属性面板修改命名尺寸。在线设置可选择 OpenAI Chat Completions 或 OpenAI Responses；保存前实际验证文本流和只读 CAD 工具往返。离线模式使用 `CAD_PROVIDER=fake npm run dev`，支持明确尺寸的孔板、垫套、台阶块和指定命名参数修改；它使用固定规则选择 CAD 操作。`CAD_PROVIDER=none npm run dev` 禁用模型建模。程序仅使用网页保存或 `CAD_MODEL_CONFIG` 显式指定的凭据。

网页配置、YAML 启动、模型限制来源、文件权限以及真实模型测试说明见[在线模型配置与验证](docs/online-mode.md)。模型设置提供整个任务、单次模型请求、单次 CAD 操作三项超时，单位秒，默认均为 0（不设超时）。公司本地模型费用显示“未配置”。

工作区支持项目新建、列表、切换及改名，每个项目拥有独立正式模型和修订；项目内支持多个独立历史与上下文的对话。所有对话共享该项目当前模型，同项目同时只接受一个未结束任务。执行过程中持续显示实际文字、CAD 工具及保存/重开/导出事件，可选择关键或完整执行记录。接口、迁移与恢复约定见[工作区功能说明](docs/workspace-contracts.md)，实际测试范围见[在线验证记录](docs/online-validation.md)。[下一阶段实施方案](docs/next-stage-plan.md)保留需求及验收依据。

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

完整阶段状态和风险见[实施记录](docs/phase1-status.md)。初始设计/准备审查/计划是历史文件，内容不是当前产品已通过验收的声明。评测授权门禁与成本记录见[评测说明](evals/text-to-cad/README.md)。

## 状态与恢复约定

- 一个数据目录只允许一个 Gateway/Supervisor；一个串行候选 Worker。`supervisor.owner.lock` 的持久 inode + 父进程持有 fd 的内核锁是所有权权威，禁止删除/替换此文件；JSON lease 仅为原子持久化诊断，不通过删除旧 JSON 抢占活跃 owner。正式版本是 `data/revisions/<candidateId>/` 不可变完整包；SQLite WAL/FULL 保存 HEAD、操作幂等结果、任务和事件。
- 只有 `committed` 才表示正式成功；assistant 的“成功”文本没有提交权。Web模型、树、属性和下载总是同一完整 Revision。当前 Before/After 比较最近显示过的两份完整版本；刷新重建当前快照，不承诺跨刷新持久保存 UI 的 previous 指针。
- 失败/取消/超时/进程被终止不覆盖旧包。Gateway 重启将未完成任务标记 interrupted，不自动重放 CAD 副作用。重试应新建任务，网络重试同一 operationId只能发送完全相同内容/baseRevision。
- 诊断lease通过临时写入、fsync和原子rename发布；SIGKILL/写失败不会发布半份JSON，正常重启清理已确认协议所属临时文件。历史上已损坏的诊断JSON会明确 fail closed；停止所有Gateway、保留整个目录后人工检查，不依据损坏元数据杀PID，也不删除owner锁inode来解锁。
- 启动检测正式文件缺失/哈希损坏会将文档 fail closed 为 corrupt，不自动回退或补零。停止服务并保留整个数据目录检查；不要手改 HEAD 或删除 DB 来“修复”。文件发布但 DB 未引用的包隔离到 quarantine，失败候选仅保留最近10个；隔离包暂不自动清理。
- 测试覆盖 SIGKILL/挂起/取消、提交窗口故障、模拟 ENOSPC与实际权限失败；没有做掉电、磁盘硬件故障或网络文件系统一致性认证。备份应在服务停止后复制**整个**数据目录（含SQLite相关文件和全部正式包），不能只备份 FCStd。恢复/磁盘整理 UI不在本阶段内。
