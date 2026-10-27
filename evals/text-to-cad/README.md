# Text-to-CAD 固定样本 v1

六条正例覆盖孔板、垫套、台阶块的创建和精确修改，四条负例覆盖尺寸缺失、超出范围、非法工具请求与失败修改保护。模型可见输入包含固定样本的特征及尺寸命名约定。修改样本使用原生操作建立初始模型，初始模型不计入模型成绩。

正例必须通过独立尺寸、体积、参数和特征历史检查，并在新建 FreeCAD 进程中对比参考实体的双向几何差。正式提交还需通过 FCStd 独立重开、STEP 重导入及 GLB 验收。负例必须保留 HEAD 和正式 FCStd 哈希。

```bash
# 固定规则与真实 CAD 的无模型检查
npm run test:eval

# 使用网页保存的模型配置
RUN_LIVE_CAD=1 npm run test:live

# 从三个信息的 YAML 导入模型配置后执行
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=model.yaml npm run test:live
```

配置入口、YAML 格式和模型限制来源见 [在线模式](../../docs/online-mode.md)。配置确认由程序自动生成，费用未配置。单个任务受 20 次工具调用限制；任务、模型请求和 CAD 操作超时默认均为 0，可在模型设置中修改。内部工具错误与外部修复合计最多一次才计入通过。各样本使用独立文档，样本失败不会自动修改验收标准。

结果保存在 `evals/results/<timestamp>-live/result.json`，记录逐例通过状态、首次成功率、工具调用、模型响应次数、耗时和错误。金额为 `null`。只有真实模型模式全部通过，`modelQualityQualified` 才为 `true`。该指标仅覆盖固定小样本；负例不提交的检查需要结合会话判断具体原因。
