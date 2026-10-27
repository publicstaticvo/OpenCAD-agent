# 在线模型配置与启动

## 网页配置

完成 [README](../README.md) 中的 Node、Pi 和 FreeCAD 准备，在项目目录执行：

```bash
npm ci
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run doctor
npm run build
npm run dev
```

默认 `CAD_PROVIDER=live`。打开 `http://127.0.0.1:3000`，使用 `data/access-token` 连接工作区。首次连接进入模型设置：

1. 选择 **OpenAI Chat Completions** 或 **OpenAI Responses**。两者通过 Pi 各自的原生消息转换与流式工具处理调用；服务必须支持所选协议及工具调用。
2. 填写 baseUrl 与 API key。仅有域名时自动增加 `/v1`，已有自定义路径保持原样。远程使用 HTTPS，本机允许 loopback HTTP。
3. 点击“获取模型列表”，选择模型。发现失败时可填写模型 ID；模型列表出现某个名称并不保证协议兼容。
4. 保存时实际发送文本流测试、隔离空文档的 `cad_inspect` 工具调用和工具结果回传，共三次模型请求。界面说明会发生这些请求。验证通过才保存；失败显示所选协议和失败阶段，保留当前配置。
5. 创建项目，描述具体尺寸。顶部“模型设置”可修改配置。相同服务地址可留空复用密钥；更换地址需要提供密钥。运行中任务固定配置，修改影响之后开始的任务。

项目和对话的使用、共享模型关系及异常恢复见 [工作区功能说明](workspace-contracts.md)。设置与工作区均可选择关键/完整执行记录；完整模式显示服务实际返回的 thinking、工具参数和结果，缺少 thinking 时显示“模型未提供”。

## 配置文件与环境变量

`CAD_DATA_DIR` 默认 `data/`，包含：

| 文件 | 用途 |
| --- | --- |
| `access-token` | 本地工作区访问密钥 |
| `model-settings.json` | 版本 3 私有配置、协议、超时、自动确定的模型限制及 API key，权限 `0600` |
| `approved.json` | 自动派生的无密钥配置确认，用户无需手动编辑 |

重启恢复私有 settings；旧版本 1、2 自动迁移，缺失超时字段使用 0，保留已有协议和密钥。approval 缺失时从 settings 重建。API key 不写入浏览器存储。备份整个数据目录包含凭据，应按私有数据保存。

主要环境变量：`CAD_PROVIDER=live|fake|none`、`CAD_DATA_DIR`、`CAD_ACCESS_TOKEN`（至少 24 字符）、`CAD_HOST`（默认 `127.0.0.1`）、`PORT`（默认 `3000`）、`CAD_ALLOWED_ORIGINS`（逗号分隔）。模型请求禁止重定向和自动重试，不自动切换协议或重放修改。

### 超时设置

网页“模型设置”包含三个整数秒字段，范围 0–2147483，默认均为 **0（不设超时）**：

| 设置 | 范围 |
| --- | --- |
| 整个任务 | 从任务开始执行至正式提交，排队时间不计入 |
| 单次模型请求 | 每次请求开始至流式响应结束，同时适用于模型发现和配置探测 |
| 单次 CAD 操作 | 每个 Worker 操作，包括检查、修改、几何验证及保存导出 |

保存并重启均可恢复；修改用于后续开始的任务。0 会关闭应用、模型 SDK 和 HTTP 客户端的对应期限；服务端、代理和网络仍可终止连接。任务可随时手动取消，正式版本继续受候选隔离保护。Worker 启动握手另有 15 秒基础设施检查；测试运行器有独立的测试期限。

兼容环境变量 `CAD_TASK_TIMEOUT_MS` 接受 0–2147483647 毫秒，显式设置时优先于网页的整个任务设置。日常使用应移除此变量，通过网页管理。

开发前端另开 `npm run web`，Gateway 配置允许其 5173 origin；正式启动使用上面的构建后单服务入口。

## 私有 YAML 启动

```yaml
test_llm:
  base_url: YOUR_BASE_URL
  api_key: YOUR_API_KEY
  model: YOUR_MODEL
  protocol: openai-completions
  timeouts:
    taskSeconds: 0
    requestSeconds: 0
    cadSeconds: 0
```

`protocol` 可选，默认 `openai-completions`；Responses 使用 `openai-responses`。

```bash
CAD_MODEL_CONFIG=model.yaml npm run dev
```

指定 YAML 后每次启动都会重新导入并进行真实探测。日常通过网页维护配置使用普通 `npm run dev`。程序不读取个人 Pi 登录文件或通用 API key 环境变量。两种真实协议验收所用配置见 [在线验证记录](online-validation.md)。

## 上下文、输出与费用

优先读取服务 `/models` 中的上下文、输出元数据，其次使用 Pi 本地目录中 endpoint 与模型 ID 均匹配的定义。无法获取时使用 262144 tokens 上下文和 Pi 自定义模型默认 16384 tokens 单次输出，并展示来源。当前两份本机配置均采用该默认值。单次输出限制来自 Pi 的模型定义与请求选项；Agent 可继续进行多轮请求和工具调用，应用不截断返回文本。

对话上下文移除完整旧轮次，保留工具调用与结果配对，为系统说明、工具定义、当前模型和输出预留预算。完整历史继续保存在 SQLite，界面提示省略轮次。输入超过预算时明确失败。

公司本地模型费用为“未配置”，报告金额为 `null`，无需填写价格、余额或金额上限。Pi 内部需要的数值费用字段使用零占位。

## 验证命令

需要真实模型服务、本机 HTTP/UDS、Chrome 和匹配 FreeCAD。测试会发送建模文本、工具定义、结构化模型摘要与验收反馈；CAD 文件在本机处理。

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
# 分别验收两种协议；协议由测试设置页显式选择
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml CAD_MODEL_PROTOCOL=openai-completions npm run test:e2e:live
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml CAD_MODEL_PROTOCOL=openai-responses npm run test:e2e:live
# 两种原生协议的只读探测和脱敏请求/事件记录
npx tsx scripts/probe-model-protocols.ts advanced-model.yaml
# 固定复杂样例评测，范围与简单浏览器闭环不同
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=model.yaml npm run test:live
```

浏览器使用独立 `.work/live-data-*`，配置阶段关闭截图、录屏、trace，完成后只保存工作区截图；测试包含真实 Gateway 进程终止重启。`CAD_LIVE_PORT` 默认 4175，`CAD_LIVE_OUTPUT_DIR` 默认 `.work/live-browser`。应用超时使用网页配置。实际通过范围和仍有局限的服务能力见 [在线验证记录](online-validation.md)。

离线启动：`CAD_PROVIDER=fake npm run dev`。禁用模型：`CAD_PROVIDER=none npm run dev`。既有离线回归：`npm run test:e2e`、`npm run test:eval`；离线结果仅证明应用与 CAD 编排。
