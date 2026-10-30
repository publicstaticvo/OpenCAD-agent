# 双零件在线验收

日期：2026-10-30。实际配置：项目根目录 `advanced-model.yaml`，模型 `gpt-5.6-sol`，协议 `openai-completions`。凭据保留在本地配置，证据文件不包含 API key。

## 预期结果核查

M1：60×40×8 mm 底板，中心 Ø8 mm 贯穿孔；Ø7×20 mm 销固定于 [30,20,0]。径向间隙 (8−7)/2=0.5 mm。底板范围 [0,60]×[0,40]×[0,8]，销范围 [26.5,33.5]×[16.5,23.5]×[0,20]，整体尺寸 60×40×20 mm。真实材料交集体积应为零。

M2：仅将销直径改为 10 mm。底板厚度内的交叠为半径 4–5 mm 的圆环柱，体积 π(25−16)×8=72π≈226.1946710584651 mm³。其他尺寸和位置保持不变。M2 的验收要求检测碰撞、拒绝提交并保留 M1 正式模型。

## 实际结果与证据

- M1：正式修订 1，两个独立参数化 Body、完全约束的矩形/圆草图、Pad/Pocket、两个组件链接、原生固定关节。实际 BOM 两项且各 1 个，交集体积 0 mm³。FCStd 独立进程重开、装配求解、尺寸/位置、STEP 实体几何匹配和 GLB 两个网格均通过。
- M2：模型生成 `edit_pin_plate_assembly` 计划并等待批准；批准后真实修改命名直径约束，检测 `PlateComponent` 与 `PinComponent` 交叠 `226.19467105846513 mm³`。任务状态 `failed`，正式修订保持 1，正式 BOM 中销直径保持 7 mm，候选中为 10 mm。
- 干涉判定容差为 `1e-7 mm³`；理论体积复核绝对容差为 `1e-6 mm³`；STEP 几何交集复核容差为 `1e-5 mm³`。
- `formal-protection.json` 保存 M2 前后的正式修订与 FCStd、STEP、GLB SHA-256，三份文件均保持不变。
- `m1-plan.json`、`m2-plan.json` 保存实际用户输入和结构化计划；`m1-events.json`、`m2-events.json` 保存完整、有序事件，含模型回复、工具调用、CAD 操作和干涉报告。所有 CAD 操作事件均晚于批准事件，M1 顺序为底板、销、装配、检查，M2 顺序为直径修改、检查。
- `m1-validation.json`、`m2-validation.json` 保存正式验收和失败报告；`m2-candidate.json`、`m2-candidate.glb` 保存 Agent 实际失败候选的参数、位置与真实几何预览。
- `m1-model.FCStd`、`m1-model.step`、`m1-preview.glb` 为正式修订的实际下载文件。`native-m2-candidate.FCStd` 为独立 FreeCAD 实验从 M1 文件执行同一修改后保存的碰撞模型，已再次独立重开。
- 截图：`m1-plan.png`、`m1-committed.png`、`m2-failed.png`、`formal-bom-after-m2.png`、`m2-collision-evidence.png`。最后两张由已保存的在线项目重新加载，核对正式 BOM 和实际失败步骤。

## 已执行测试

| 检查 | 结果 |
|---|---|
| TypeScript 类型检查、前端构建 | 通过 |
| `npm run test:unit` | 129 项通过 |
| `npm run test:cad` | 30 项通过 |
| `npm run test:e2e` | 13 项通过；离线计划驱动真实 FreeCAD |
| `tests/live/advanced-assembly.spec.ts` | 1 项通过，覆盖真实模型 M1/M2，耗时约 3.1 分钟 |
| 原生下载文件与碰撞模型独立重开复核 | 通过 |
| 已保存项目浏览器复核 | 通过 |
| `npm run verify:pi`、`git diff --check` | 通过 |

在线测试过程中曾遇到一次配置探测的 `tool_result` 阶段失败；最终验收复用此前已成功验证并持久化的相同模型配置。该次探测失败保存在 `playwright-final-2` 中。通过记录对应 `playwright-verified/.last-run.json`。此记录证明本次固定样例通过，未进行跨模型或大规模成功率评测。

## 复现

在工程目录准备原生 FreeCAD 环境及 `advanced-model.yaml`，创建 `.work/tmp`。执行：

```bash
TMPDIR="$PWD/.work/tmp" RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml npm run test:e2e:live -- tests/live/advanced-assembly.spec.ts
```

该命令调用真实模型服务，可能产生费用，并自动批准固定样例计划。测试使用独立数据目录，端口为 4175；凭据不会复制到证据目录。设置 `CAD_LIVE_DATA_DIR` 可以使用已配置的独立测试目录，测试会核对模型名称与协议。

复核本次保存项目，无需调用模型服务：

```bash
TMPDIR="$PWD/.work/tmp" CAD_LIVE_DATA_DIR="$PWD/.work/live-data-1793291901592" npx tsx scripts/capture-assembly-acceptance.ts
TMPDIR="$PWD/.work/tmp" python scripts/verify-live-assembly-downloads.py "$PWD/artifacts/live-assembly-advanced/m1-model.FCStd" "$PWD/artifacts/live-assembly-advanced/m1-model.step" "$PWD/artifacts/live-assembly-advanced/m1-preview.glb"
```

能力范围为矩形底板、中心贯穿孔、圆柱销及其原生固定连接和销直径修改。任意零件、任意关节和通用装配设计没有通过本次验收。
