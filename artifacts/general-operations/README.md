# 通用操作计划与真实非矩形零件

测试日期：2026-10-31。模型配置来自本机 `advanced-model.yaml`；配置和凭据未复制到本目录。

## 真实模型验收

`live/` 保存真实模型生成的批准计划、完整任务及事件证据、网页截图，以及浏览器实际下载的 FCStd、STEP、GLB。

| 任务 | 正式修订 | 实际包围盒 mm | 实际体积 mm³ | 结果 |
|---|---|---|---|---|
| 三角棱柱 | triangle r1 | 40 × 30 × 10 | 6000 | 通过 |
| 拉伸高度改为12 | triangle r2 | 40 × 30 × 12 | 7200 | 通过 |
| L形支架，臂宽10 | bracket r1 | 60 × 50 × 8 | 8000 | 通过 |
| 支架偏心Ø4贯穿孔，中心[30,5] | bracket r2 | 60 × 50 × 8 | 7899.469035085125 | 通过 |

每项任务通过网页自然语言输入，由真实模型提出 `operations` 计划，测试客户端通过网页批准，再由真实 Agent 逐阶段调用 CAD 工具。每项建模任务分别审批。全部下载文件已由 `scripts/verify-operation-downloads.py` 在独立 FreeCAD 进程中重新打开，并与根据测试输入单独构造的原生参考实体比较实际几何差集；同时检查草图、约束、特征、STEP 和 GLB。

真实模型测试命令：

```bash
mkdir -p .work/tmp
TMPDIR="$PWD/.work/tmp" RUN_LIVE_CAD=1 \
  CAD_LIVE_OUTPUT_DIR=.work/general-operations/live-new \
  CAD_LIVE_DATA_DIR="$PWD/.work/general-operations/live-data-new" \
  npm run test:e2e:live -- tests/live/general-operations.spec.ts
```

默认读取 `advanced-model.yaml`，可通过 `CAD_MODEL_CONFIG` 显式选择配置。服务启动、模型设置、原生环境和支持范围见 README 与 `docs/general-operations-slice.md`。测试将实际调用模型服务；没有开展大规模在线评测。

## 确定性原生与浏览器验收

`structured/` 使用明确的操作计划执行同样四项任务，未调用模型。每项文件、事件和截图来自真实 FreeCAD 与浏览器。单元集成测试另行验证错误候选失败后，原正式修订与 FCStd 字节保持不变；原生测试验证反向拉伸和不同加工模式不能通过批准操作核验。

复测入口：`tests/operation-plan.test.ts`、`tests/operation-workflow.test.ts`、`worker/tests/test_operation_plan.py`、`tests/e2e/operation-plans.spec.ts`。原始基线及回归运行记录保存在本机 `.work/general-operations/`。
