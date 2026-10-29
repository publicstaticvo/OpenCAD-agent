# 第一版演示验收记录

验收日期：2026-10-29。项目范围为真实 FreeCAD 单实体 Text-to-CAD，包含长方体、一个中心贯穿孔和孔径修改。此记录区分完整通过的真实在线运行、当前离线回归，以及一次未得到模型计划的在线复测。

## 真实在线运行

已通过 `advanced-model.yaml`、OpenAI Chat Completions、真实模型和本机 FreeCAD 的浏览器端到端运行。模型为 `gpt-5.6-sol`。三个任务均显示计划并经用户批准；获批后才发生 CAD 写入。每项真实工具事件、候选检查点、FreeCAD 几何检查、保存、独立重开、导出和提交均属于同一任务与修订。

| 正式修订 | 操作 | FreeCAD 验收 |
| --- | --- | --- |
| r1 | 创建 40 × 30 × 10 mm 长方体 | 包围盒 `[40,30,10]`、体积 `12000 mm³`、单实体；真实矩形草图、11 个约束、Pad |
| r2 | 增加中心 Ø6 mm 贯穿孔 | 包围盒不变、体积 `11717.256661176918 mm³`、单实体；真实圆草图、Pocket；中心 `[20,15]` 且贯穿 |
| r3 | 将孔径从 6 mm 改为 8 mm | 包围盒不变、体积 `11497.345175425633 mm³`、单实体；真实命名尺寸修改；中心 `[20,15]` 且贯穿 |

最新成功运行的证据目录为 `.work/v1-live-browser-final-8/approved-demo-approved-rea-a24c3-d-restores-native-revisions/`，包含逐任务事件、候选网格、工作区画面、三份修订的 FCStd/STEP/GLB 下载与 `verified-demo.json`。浏览器核对每份下载的 manifest 哈希并运行 `scripts/verify-demo-downloads.py`；每份 FCStd 均经当前约束核验和独立重开检查。浏览器查看 r2、r3 的孔径参数与实际画面，保存的 `diameter-6.png` 和 `diameter-8.png` 显示对应的几何变化；三个修订和历史候选实体均可查看。较早一次成功运行的证据保存在 `.work/v1-live-browser-final-3/`，该批三份下载也已用当前验收程序重新打开并全部通过。

一次重复运行保存在 `.work/v1-live-browser-final-7.log`。首个长方体规划请求在约 8.6 秒后以模型库 `stopReason=error` 结束；没有模型文本、计划、工具调用或 CAD Worker 写入，正式版本保持 r0。该次持久记录只保留通用错误，缺少上游状态及底层诊断，因此无法确认具体原因，也不能归类为模型建模能力失败。随后通过本机真实 HTTP 503 响应发现适配层会丢失状态码；修复后两种协议均保留状态码，同时丢弃上游响应正文。最新受限在线复测已完成三个任务，但成功复测不能确定先前失败的具体原因。

## 当前工作区回归

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| `npm run doctor` | 通过 | 当前 FreeCAD 1.1.3、Python 3.11.14、OCCT 7.8.1 与 UDS/文件锁运行能力 |
| `npm run verify:pi` | 通过 | 本地 Pi 源码指纹符合项目锁定要求 |
| `npm run typecheck` | 通过 | TypeScript 检查 |
| `npm run test:unit` | 126 项通过 | Gateway、Agent、计划/审批、项目/对话、并发写入、恢复与事件处理 |
| `npm run test:cad` | 22 项通过 | 实际 FreeCAD 建模、约束、孔、文件生成和独立重开验收 |
| `npm run test:e2e` | 10 项通过 | 离线前端、真实 HTTP/Worker/FreeCAD、审批、候选/正式版本显示及项目/对话行为；此处的规划输入由测试驱动，不证明模型能力 |
| `npm run test:e2e -- approval-preview.spec.ts projects.spec.ts` | 3 项通过 | 浏览器中的实际候选实体、候选提交隔离、多个待批对话与过期批准保护 |
| `npm run test:unit -- tests/eval-provider.test.ts tests/model-errors.test.ts` | 5 项通过 | Chat Completions 和 Responses 的真实本机 HTTP 503 响应保留状态码，不公开服务响应正文 |

新增原生反例测试先以真实 FreeCAD 文件证明旧检查会接受同外形、同体积且完全约束、但约束引用不符合计划的草图；更新 `worker/validation.py` 后，两项保存和独立重开检查均通过，完整 `test:cad` 为 22 项通过。测试输出保存在 `.work/v1-native-constraints-red-6.log`、`.work/v1-native-constraints-green-6.log` 与 `.work/v1-final-cad-7.log`。

## 范围与运行

当前真实在线建模资格仅覆盖一个参数化长方体、其一个中心贯穿孔及孔径修改。用户每次任务先检查计划并批准；批准前没有 CAD 写入。前端显示真实草图、约束、候选实体、正式修订和操作状态；保存文件在独立 FreeCAD 进程中重新打开验收。真实通过运行只覆盖 `openai-completions` 与该模型配置。Responses 协议及其他模型的资格请查阅[在线验证记录](online-validation.md)。多零件 BOM、装配、干涉检查、STEP 编辑、图像建模及工程图不属于当前能力。

在线设置入口、YAML 导入、服务启动和单次验收命令见[在线模型配置与启动](online-mode.md)。离线完整回归在项目根目录运行：

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
npm run doctor
npm run verify:pi
npm run typecheck
npm run test:unit
npm run test:cad
npm run test:e2e
```

受控真实在线运行会调用三个建模任务，并需在网页批准每份计划；它使用外部模型服务，可能受该服务当时状态影响：

```bash
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG="$PWD/advanced-model.yaml" \
  CAD_MODEL_PROTOCOL=openai-completions \
  CAD_LIVE_DATA_DIR="$PWD/.work/live-data-<unique>" \
  CAD_LIVE_OUTPUT_DIR="$PWD/.work/live-output-<unique>" \
  npm run test:e2e:live -- approved-demo.spec.ts
```

运行时请将两个 `<unique>` 替换为本次唯一目录名，保留先前结果。该命令不运行广泛在线评测；不要把离线测试结果当作真实模型资格。
