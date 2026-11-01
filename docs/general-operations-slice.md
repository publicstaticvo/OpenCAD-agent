# 通用操作计划实施范围

本轮实现线段和圆草图、命名约束、Pad、Pocket 与尺寸修改的可组合计划。计划逐阶段列出实际操作，用户批准后按原顺序执行；范围变化需要新任务与新批准。保留现有固定计划兼容性。

## 实施与验收

1. 建立基线：129 项单元测试、30 项原生 CAD 测试、13 项浏览器测试通过；类型检查、构建、Pi 指纹检查通过。结果保存在 `.work/general-operations/baseline/`。
2. 增加操作计划契约和授权测试：计划内容、操作顺序、正式版本与基础操作历史绑定；拒绝未经批准的修改。
3. 接入真实 Worker：每个成功批次保存操作历史；在独立 FreeCAD 文档中重放批准历史，核对真实草图、约束、特征参数与最终实体。保存后独立进程重新验证并检查导出几何。
4. 接入 Agent 和审批界面：模型生成实际操作阶段，审批卡显示阶段、操作与几何验收条件；复用现有候选草图、实体及活动事件。
5. 验证 L 形支架、三角棱柱、孔加工和尺寸修改，以及失败后的正式版本保护。运行完整回归，保存实际文件和检查结果。

不扩展曲线、旋转、放样、多零件通用操作或自动修复。仅开放通过原生操作测试的现有操作集合。

## 已实现的接口与边界

- `cad_plan` 接受 `kind: operations`、任务目标、阶段列表和几何验收条件。每个阶段包含名称、实际草图编号、完整操作数组。最多16个阶段、合计256项操作。
- 批准内容使用计划哈希、正式修订号和基础操作历史哈希绑定。Gateway 逐阶段检查严格操作顺序及参数；Worker 再次核验实际操作与批准内容。
- 通用计划使用现有 `create_body`、`create_sketch`、`add_geometry`、`add_constraint`、`pad`、`pocket`、`set_parameter`，不增加按零件形状选择模板的分支。每个阶段必须形成可观察的完全约束草图或有效特征。
- 每个阶段产生真实草图检查点，有实体时导出实际候选预览。审批卡显示完整操作；原有正式模型视口与下载在提交前保持原修订。
- 原生文档保存累计操作历史。验证器创建独立文档重放历史，核对几何、约束名称与引用、草图位置、特征 Profile、方向、长度和 Tip，再检查实体几何差集。最终 FCStd 由独立进程重新打开，STEP 重新导入并比较实际几何。
- 正式验证报告保存 `operationPlanHash`、`operationHistoryHash` 和 `operationModel`，供后续任务读取真实草图及特征信息。累计历史最多4096项操作。通用计划修改要求具有该历史；旧固定计划继续使用原有验证。
- `POST /api/documents/:id/jobs` 可提交 `{baseRevision,operationId,plan}`，仍需使用现有 approve 接口批准。该结构化入口用于明确操作计划的客户端和自动化测试；网页自然语言任务由真实模型调用 `cad_plan`。

## 可复现验证

```bash
mkdir -p .work/tmp
export TMPDIR="$PWD/.work/tmp"
export PYTHONDONTWRITEBYTECODE=1
npm run typecheck
npm run verify:pi
npm run test:unit
npm run test:cad
npm run test:e2e
# 实际调用配置文件中的模型服务；需要有效凭据和可访问服务
RUN_LIVE_CAD=1 CAD_MODEL_CONFIG=advanced-model.yaml \
  CAD_LIVE_OUTPUT_DIR=.work/general-operations/live \
  CAD_LIVE_DATA_DIR="$PWD/.work/general-operations/live-data-new" \
  npm run test:e2e:live -- tests/live/general-operations.spec.ts
```

原生运行时通过 `FREECAD_RUNTIME_ROOT` 或本机 `runtime.local.json` 配置。在线入口与访问密钥使用方法见 README；测试服务使用独立数据目录与4175端口，不修改已有项目或用户模型配置。每次在线复测使用新的数据目录，保留原证据。

确定性测试使用真实 Worker 与 FreeCAD，直接提交明确的操作计划，未调用模型。四项几何验收分别为：三角棱柱40×30×10、体积6000 mm³；高度改为12、体积7200 mm³；L形支架60×50×8、臂宽10、体积8000 mm³；增加中心[30,5]的Ø4贯穿孔，体积 `8000−32π` mm³。下载检查额外构造独立原生参考实体，使用实际差集比较形状及位置。

测试证据保存在 `.work/general-operations/`：`baseline/`、`browser/`、`verification-*/verified-results.json` 与 `live/`。浏览器目录包含下载的 FCStd、STEP、GLB、批准计划、真实事件及正式视口截图；测试运行输出保存在对应 `.log` 文件。

已保存的可检查交付证据见 `artifacts/general-operations/README.md`。真实高级模型四项任务全部通过，包括浏览器批准、逐阶段工具执行、正式提交与下载后的独立几何核验。

## 本轮验证结果

- 单元及集成测试：135项通过，包含批准内容、操作顺序、基础历史、重复提交、失败保护与规划规则检查。
- 原生 CAD 测试：31项通过。FreeCAD1.1.3、Python3.11.14、OCCT7.8.1；`doctor` 验证原生导入、UDS与文件锁。
- 完整浏览器测试：14项通过。覆盖本轮四项结构化操作、原有装配/碰撞检查、取消、历史修订、项目/对话切换、刷新恢复及下载。
- 真实高级模型：一个浏览器测试中四项连续建模任务全部通过，执行约6分钟。没有进行模型批量评测。
- 类型检查、前端构建、Pi源码指纹与 `git diff --check` 通过。构建仍提示现有前端包超过500 kB。
- 独立代码审查完成；加工模式、任务幂等性和规划范围检查均有对应测试。Pi内部源码与执行循环保持现状。

已有视觉回归测试会刷新 `artifacts/workspace-visual-review/after/` 与 `artifacts/assembly-demo/workspace.png`；本轮新增样例证据保存在独立的 `artifacts/general-operations/`。
