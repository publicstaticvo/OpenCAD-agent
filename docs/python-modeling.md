# Python 工程工作区

## 启动与配置

```bash
npm ci
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
export FREECAD_RUNTIME_ROOT=/absolute/path/to/FreeCAD/squashfs-root
npm run verify:pi
npm run doctor
npm run build
npm run dev
```

已有 `runtime.local.json` 可以提供 FreeCAD 路径。浏览器打开 `http://127.0.0.1:3000`，使用启动日志指定文件中的本地访问密钥。`CAD_DATA_DIR` 选择持久数据目录；同一目录只能由一个 Gateway 持有。

无需模型即可导入、编辑、保存、运行和验收 Python 工程。选择源码布局，导入 `.py`、`.FCMacro`、ZIP 或目录，选择入口，点击“运行当前源码”。成功候选在视口显示；点击“验收候选并提交”生成正式修订，或者拒绝候选。普通保存不会启动执行。模型导出菜单只下载所选正式修订的 FCStd、STEP、GLB；源码面板提供文件下载、完整工程 ZIP 和本地授权另存为。

在线 Agent 在模型设置中配置服务，或者使用 `CAD_PROVIDER=live CAD_MODEL_CONFIG=advanced-model.yaml npm run dev`。配置支持 Chat Completions / Responses；仅在服务实际支持图像时启用图像输入。配置保存会调用服务验证协议；本轮没有读取凭据或调用真实模型。`CAD_PROVIDER=fake` 保留固定离线规则样例，实际执行 FreeCAD，不证明在线模型生成能力。`CAD_PROVIDER=none` 禁用模型对话，直接源码执行仍然可用。

## 文件、版本和执行

项目保存相对路径文本文件、二进制资源、目录和一个明确的 Python 入口。SQLite 中 `source_workspaces` 是可变工作副本，`source_versions` 保存完整不可变项目快照，`source_heads` 指向当前快照。浏览器逐文件保留未保存缓冲区。普通保存更新工作副本；检查点、运行、交给 Agent 和 Agent 修改按需生成快照。无变化检查点复用现有版本。

每个快照记录父版本、作者、时间、完整项目和 SHA-256。逐文件 Diff 使用成熟的 `diff` 库计算实际新增和删除；初始版本显示新增内容，失败执行的源码仍然保留。历史选择器浏览整份项目快照，允许采用整个历史工程或指定文件。历史浏览保留当前工作副本与未保存编辑。

Agent 工具为 Pi Coding Agent 1.2.0 的 `read/write/edit` 工厂、项目目录管理 `cad_files` 和明确执行工具 `cad_run`。文件工具通过受限项目适配器读取 SQLite，不取得宿主文件权限。`cad_files` 支持列出、建立目录、移动、删除和选择入口。每次有效修改记录完整快照及逐文件差异。独立设计新增文件并选择入口；修改已有设计读取相关模块，保留无关文件。

Agent 编辑可以连续进行，准备完成后调用 `cad_run`。对于建模请求中的源码修改，以及明确要求执行已保存工程的请求，Agent 漏掉执行时，平台向同一 Agent 提醒完成执行；仍未执行会明确报告 `ModelDidNotExecute` 并保留源码和对话。只读、诊断及明确不执行请求不会触发运行提醒。用户无需知道工具名称。Agent 不拥有正式提交权限。

用户运行路径：保存工作副本 → 冻结整个项目 → jobs 指定 `sourceVersionId/sourceHash` → PythonSession。Agent 运行路径：文件工具生成快照 → `cad_run` 指定快照 → 同一 PythonSession。每次执行产生独立 `executionId`，同一快照可以运行多次。执行输入保存于候选执行目录中的 `input/project/`，`project.json` 保存完整快照；工程根目录加入 Python 模块搜索路径，入口显式编译执行。

单个文件上限 1 MiB，文本与二进制资源合计 4 MiB，最多 256 个文件和 256 个显式目录。ZIP 使用 `fflate`，检查路径、重复条目和展开大小。`.FCMacro` 按 Python 入口执行。相对资源从冻结工程读取；运行期间源码只读。

## 检查、观察和验收

执行后自动进入独立 FreeCAD 验证：重新打开 FCStd、重新计算、检查真实实体有效性与正体积、检查可选任务条件、导出 STEP 并重新导入比较几何、生成和验证 GLB，并生成实际几何 PNG。每次 `cad_run` 自动向 Agent 返回结构化结果及错误；配置支持图像时 PNG 进入下一次模型请求。前端预览和 Agent 图像反馈分别验证。

执行、健康检查、任务验收、交付检查、候选有效和正式提交分别记录。没有任务条件时 `acceptanceStatus=not-run`，不能宣称尺寸需求已经自动验收。健康及交付检查成功后候选进入 `awaiting_acceptance`；用户明确验收绑定执行身份、源码版本与哈希，再提交正式修订。任务条件失败提供诊断预览，保留之前有效候选与正式模型。

`POST jobs/:operationId/accept` 和 `POST jobs/:operationId/reject-candidate` 处理用户决定；重复相同决定不会重新执行。验收检查完整清单、执行身份、当前源码与基础正式修订。过时结果拒绝提交。待验收状态可在服务重启后恢复。项目运行互斥，连续点击不会并发改写同一模型。

正式包包含 FCStd、STEP、GLB、特征树、验证报告、任务条件、入口源码副本、完整 `project.json`、执行身份、诊断记录和 PNG，统一参与文件哈希检查。旧单文件正式包保留兼容校验。恢复历史正式修订保留原始执行来源。兼容 HTTP 单文件 `source`/`python` 入口保留集成用途，不能覆盖已有多文件工程；新 Agent 主路径只使用项目文件工具和 `cad_run`。

## 协作与界面

CodeMirror 提供 Python 高亮、行号、撤销、重做、查找替换和 Ctrl/Cmd+S。文件树提供创建、改名和删除，标签页保留独立编辑缓冲区。服务器保存使用工作副本修订号和父快照条件更新。Agent 更新其他文件时，未保存内容保留；同文件冲突明确显示，并可创建完整冲突检查点后比较或采用。

源码编辑与历史查看不禁用对话。执行使用指定的已保存快照，未保存缓冲区不进入该次执行。切换项目和离开页面时保护未保存内容。入口项目列表按更新时间展示并支持名称搜索。模型、源码、左右并列和上下并列四种布局保留可调整分隔条。

活动历史复用持久事件序号，按真实顺序显示用户、Agent 可见文本、源码、工具、执行、验证、候选和提交。一次工具调用原位更新完成状态。连续操作可以折叠，展开保留各项顺序。没有模型私有推理或模拟进度。Worker 实际发出 Python 执行与独立验证的开始/完成事件。

## 隔离与恢复

沿用 Bubblewrap、Linux 用户/PID/网络/挂载命名空间及 seccomp。只读挂载运行库、可信引导程序、当前冻结工程与基础 FCStd 副本；不挂载宿主项目数据、凭据或正式修订。清空环境变量，禁止网络、创建进程和外部程序。隔离无法建立时执行失败。

进程地址空间 4 GiB、CPU 300 秒、单文件 64 MiB、128 个文件描述符及线程数量限制保持有效。可配置单次 CAD 墙钟超时，0 表示不设置；取消、Worker 退出和服务重启处理实际进程及持久状态。失败源码、日志和对话保留，失败执行不覆盖有效候选与正式文件。FCStd 中持久化 Python 执行对象在独立重开前被拒绝。

## 验证

```bash
export TMPDIR="$PWD/.work/tmp"
npm run typecheck
npm run build
npm run test:unit
npm run test:cad
npm run test:e2e
```

专项：`npx vitest run tests/project-source.test.ts tests/source-tools.test.ts tests/source-execution.test.ts tests/source-gateway.test.ts tests/project-workflow.test.ts`；浏览器：`npx playwright test tests/e2e/project-workspace.spec.ts`。

逐项实际结果及人工未执行项目见 [测试记录](testing/source-workspace-and-activity-timeline.md)。当前类型检查的既有阻塞为本地 Pi `openai-client.ts:8` 访问 OpenAI 7.19.0 的私有 `fetch` 成员；未屏蔽类型检查，未修改 Pi 内部实现。本轮没有在线模型验收。
