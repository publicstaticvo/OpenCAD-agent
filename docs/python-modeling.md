# Python 建模流程

## 使用与配置

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

打开 http://127.0.0.1:3000，使用启动日志指定文件中的本地访问密钥。模型设置填写服务地址、模型和凭据，保存配置会调用模型服务进行协议验证。选择 Chat Completions 或 Responses。仅当服务明确支持图像时启用“模型支持图像输入”；连接验证本身不检查图像理解。也可以使用已有 YAML 配置启动：`CAD_PROVIDER=live CAD_MODEL_CONFIG=advanced-model.yaml npm run dev`。YAML 可设置 `image_input: true`。本轮未读取或改变既有模型凭据，未发送真实模型请求。

提交自然语言需求后，用户批准本次任务范围和基础正式修订。Agent 在该任务中使用 `cad_python` 提交初始完整脚本，或提交 `patch` 与准确的 `parentHash`。每次提交均自动执行，无需额外执行或预览调用。Agent 可使用 `cad_inspect` 读取完整父源码、上次执行状态与候选数据；`cad_finish` 请求最终验收。在线运行不注册旧的 `cad_plan`、`cad_apply` 或逐项建模工具。

`CAD_PROVIDER=fake` 保留已有固定离线样例，实际执行 FreeCAD；该模式不运行模型生成 Python 的链路。直接脚本 HTTP 入口用于无需模型的原生集成验证：向现有项目 jobs 路由提交 `{baseRevision,operationId,python:{source,criteria}}`，或 `{baseRevision,operationId,python:{patch,parentHash,criteria}}`，然后通过现有批准路由批准对应任务。请求使用本地访问密钥；无需配置模型服务。

## 执行、版本与观察

调用路径：Pi `cad_python` → `PythonSession` → 现有 Worker JSON-RPC → Bubblewrap 中的 FreeCAD Python → 独立 Bubblewrap 验证进程 → 现有候选快照、前端 GLB 加载和修订提交。

源码上限 256 KiB，补丁使用 `diff` 包解析并精确应用到指定父版本；禁止移动补丁位置或模糊匹配。`scripts.json` 保存每次提交的完整源码、父哈希、源码哈希、项目、任务、基础修订、候选及执行身份、验收条件和结果。每次执行拥有独立目录；运行结果不会改写以前的执行目录。`script.py` 和 `execution.json` 表示最新有效候选。失败提交仍成为源码父版本，便于继续修复，但不替换有效候选预览；最新提交失败时禁止最终提交。

每次成功执行返回实际对象类型、参数、依赖、几何尺寸、体积、独立重开和 STEP 检查结果，以及真实三角网格生成的等轴测 PNG。GLB 候选快照通过现有持久化事件自动刷新前端。正式树、视口和下载继续绑定正式版本；候选有独立标识。Python 执行事件区分运行中、候选有效和失败，正式成功以 `committed` 为准。

图像启用时，PNG 作为 Pi 工具结果的图像内容进入下一次模型请求；两种协议均使用现有 Pi 转换。关闭时仅发送结构化反馈。PNG 使用实际几何绘制，当前不包含 CAD GUI、尺寸标注或隐藏边。文本、源码与结果仍保存在对话和任务事件中。

## 隔离与保护

需要 `/usr/bin/bwrap`、libseccomp、Linux 用户/PID/网络/挂载命名空间和允许的非特权用户命名空间。本机已验证 Bubblewrap 0.6.1。隔离无法建立时执行失败；不会改用宿主 Python。

隔离进程仅获得只读运行库、引导程序、当前源码和基础 FCStd 副本；不挂载项目数据、其他任务、正式修订或用户主目录。环境变量清空。写入仅位于私有内存文件系统：输出 256 MiB、工作目录 64 MiB；引导阶段设置限制后清除全部 capability，再加载 FreeCAD。seccomp 禁止进程创建、执行外部程序、网络、挂载及命名空间变更，保留 OCCT 原生线程并同步线程过滤。每进程地址空间上限 4 GiB、单文件 64 MiB、128 个文件描述符、64 项进程及线程数量限制、CPU 时间 300 秒。输出通过有名称和解压大小限制的 ZIP 返回宿主；宿主不打开未验证的 FCStd。

用户的单次 CAD 超时设置分别作用于执行和独立验证，0 表示不设置墙钟超时；上述资源限制始终有效。取消、Gateway 退出和 Worker 异常退出终止进程，Bubblewrap 的父进程死亡处理和私有 PID 命名空间清理子进程。已有进程租约用于服务重启清理。项目写入资格、固定基础修订和会话内提交互斥共同防止候选冲突。

错误包含阶段、类型、信息及能够取得的 Python 文件和行号。执行目录保留错误、Python stdout/stderr 和输出传输记录；工具结果自动返回输出末尾最多 16000 字节的诊断。Worker 错误作为可修复工具结果返回，用户取消会终止任务。失败候选沿用服务现有最近十项保留策略；任务、对话和事件仍保存于数据库。

## 验证与交付

验证进程重新打开执行保存的 FCStd，重新计算实际文档，检查对象错误及有限、正体积的有效实体。独立检查任务指定的包围盒、体积和命名参数；不要求旧操作历史或固定对象类型。通过 FreeCAD 导出 STEP，再重新导入并进行实际几何差集比较；生成 GLB 后运行已有二进制网格检查。几何有效性与任务条件分别记录。

交付文件使用原生 FreeCAD 对象；持久化 Python 对象及回调会在打开文件前通过 FCStd XML 类型检查拒绝，避免重新打开和用户下载后的执行副作用。脚本本身可以使用 Python 函数和类计算模型，但不能将 Python 执行对象存入交付文档。FCStd 归档、XML 和输出文件均有大小限制。

现有验收结构支持包围盒、体积和指定参数。复杂设计的全部拓扑、材料、装配关系和自然语言意图未由这些条件全面证明；Agent 生成条件仍可能存在能力错误。当前没有增加齿轮、装配或其他专用验证器。

正式包除原有 FCStd、STEP、GLB、树、验收条件和报告之外，还包含源码、源码版本记录、执行身份和 PNG；全部参与清单哈希检查。源码哈希和执行身份必须与验证报告一致。失败和取消不会提交；正式下载仅引用已提交包。Python 源码可在左侧下载。

## 离线验证命令

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
export PYTHONDONTWRITEBYTECODE=1
npm run typecheck
npm run build
npm run test:unit
npm run test:cad
npm run test:e2e
```

专项测试：`npx vitest run tests/python-source.test.ts tests/python-workflow.test.ts`、`python -m unittest discover -s worker/tests -p test_python_execution.py -v`、`npx playwright test tests/e2e/python-workflow.spec.ts`。真实模型调用遵循单独授权，本轮不执行。

专项测试覆盖原生创建和补丁修改、实际 PNG/GLB、两种模型协议的图像请求序列化、语法及运行错误、网络和子进程限制、文件系统与 capability 限制、超时、取消、Worker 退出、正式提交、文件下载与错误后的正式文件哈希保护。浏览器测试截图和下载保存于 Playwright 输出目录。

本轮已执行完整应用测试（139 项）、原生 CAD 回归（32 项）和浏览器回归（15 项），均通过；另有实际线程数量限制、命名草图约束、自定义数值属性的专项原生验证。类型检查、前端构建和 Pi 指纹检查通过。前端构建仍报告较大 JavaScript 文件的提示。测试不证明真实模型生成源码和修复源码的能力，本轮禁止的在线请求未执行。
