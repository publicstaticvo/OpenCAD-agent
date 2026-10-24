# 版本化评测 v1

这是六条正例（三种零件各创建/精确修改）与四类负例的固定小样本，不代表通用 CAD 能力。固定尺寸/体积/命名参数和特征历史由 fixture 提供，独立于被测模型的 cad_finish 声明；另在全新原生进程构建固定参考实体，对正式FCStd做双向cut几何差验收，覆盖相同体积/bbox但孔位或草图Placement错误的情况。命名约定通过 `benchmarkPrompt` 明确加入模型可见输入（由数据集绑定的fixture hash导出），没有隐藏固定ID要求；此约定只用于固定评测。每次提交仍经过实际 FCStd 独立重开、STEP 重导入、GLB 顶点/索引验收。修改用例先以确定性操作建立 seed，测量的是修改能力，不把 seed 算作模型成功。

## 无模型检查

```bash
npm run test:eval -- evals/text-to-cad/v1.json
```

显式 fake + 真实 Pi/FreeCAD，结果 `mode=offline`、`modelQualityQualified=false`；只验证评测框架/候选链路。默认结果放 `evals/results/<timestamp>-offline/result.json`（本地忽略），每例独立文档，保留 CAD 包供检查。结果含首次成功、修复数、工具调用、assistant 回合数（providerRequests）、报告成本、耗时、人工介入；offline 成本为零。内部失败工具调用与外层重试合计最多一次才计通过；若首次已发生工具错误且未成功，不再增加外部重试。每个 Agent 工作仍有20工具/180秒上限。

## Live 门禁（本轮未获授权、未执行）

1. 负责人明确批准具体服务、模型、数据边界、成本上限和本次 live 执行。不得因环境存在通用 API Key 或个人 Pi 登录信息而运行。
2. 将 `authorization.example.json` 复制到自己控制的权限受限本地路径；填真实 approvalId、有效期、数据集 SHA256、协议/endpoint/model、上下文/输出上限和经核实的**价格上界**。模板故意未填金额/价格，不表示任何真实报价。必须另外在服务商设置硬费用上限并确认 `providerBillingCapConfirmed`，本地预留不能约束服务商的实际账单。
3. 首个准备好的适配器是 Pi 的 `openai-completions` 兼容协议；其他协议需另建适配与本机协议测试，不猜选服务。SDK精确沿用本地Pi声明的 `openai@7.19.0`。密钥仅显式注入 `CAD_EVAL_API_KEY`；不加载个人 Pi auth、环境通用 API Key、文件上传或浏览器凭据。请在终端安全注入，不将密钥写入历史、仓库或结果。
4. 完成无模型回归后，才可由获准操作者执行：

```bash
RUN_LIVE_CAD=1 CAD_EVAL_APPROVAL=/absolute/path/approved.json npm run test:live -- evals/text-to-cad/v1.json
```

未设 opt-in、未批准、过期、数据集 hash 不同或边界不完整均在创建 provider/读取专用密钥前拒绝。可用 `sha256sum evals/text-to-cad/v1.json` 取得 hash。脚本不会替负责人批准上述内容。

只发送合成样例文本、受控工具描述、结构化特征/参数/操作结果和验收反馈，不发送 FCStd/STEP/GLB。每个请求对指定 endpoint 精确匹配，拒绝重定向，禁用 SDK 网络重试；发送前按完整配置上下文+输出上限及核实价格上界预留，耗尽即不发请求；无 usage 不退预留。成本报告区分 provider 声明使用量和保守预留；不能把没有发出的预留称作实际账单。网络请求失败仍消耗预留。数据权限不包含私有 CAD 文件。

验收门槛：正例6/6在一次有界修复内通过独立 golden；四类负例不提交/不改变 seed 的 HEAD及FCStd哈希。记录任何失败和人工介入；脚本不自动修正 golden。只有 `mode=live` 且全部通过才有 `modelQualityQualified=true`；这仍只覆盖固定小样本。真实模型拒绝/解释的语言质量需要负责人审阅结果与会话，不能只依靠任务 failed 字符串认定。

本机 HTTP 协议夹具用 dummy key 验证 SDK 流与费用拒绝，既没有远程服务也没有真实模型，不计作 live。
