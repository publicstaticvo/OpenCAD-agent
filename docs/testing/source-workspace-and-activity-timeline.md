# Python 工程工作区验收记录

## 环境与证据

使用当前锁定依赖、Linux、项目已有 FreeCAD 运行库、Bubblewrap 和 Chrome/SwiftShader。测试使用独立的 `.work/` 数据目录，设置 `TMPDIR="$PWD/.work/tmp"`。没有读取模型凭据或调用真实模型服务。Agent 集成测试使用确定的响应序列驱动实际 Pi 工具分发、Gateway 和真实 FreeCAD；这些结果仅证明应用链路，不证明在线模型的自然语言能力。

截图和最终日志保存在 `artifacts/source-workspace-and-activity/`：

- `source-diff.png`：实际源码编辑器与父版本之间的新增、删除行。
- `project-candidate.png`：多文件工程真实执行后的候选模型，正式修订仍为 0，等待用户验收。
- `project-file-diff.png`：历史工程快照中的逐文件差异。

主要实现：`gateway/project-source.ts`、`source-versions.ts`、`source-tools.ts`、`python-session.ts`、`supervisor.ts`；`worker/python_execution.py`、`python_bootstrap.py`；`web/src/SourceWorkspace.tsx`、`ProjectChooser.tsx`、`activity.ts`、`App.tsx`。

## 自动化验收矩阵

每行列明自动化覆盖范围。人工和在线未执行项目单独列在后文。

| 编号 | 实际检查 | 结果与证据 |
|---|---|---|
| P1–P3 | 单文件、模块、package 和 `.FCMacro` 入口进入真实 FreeCAD，读取相对资源 | PASS；`tests/project-workflow.test.ts`、`tests/python-workflow.test.ts` |
| P4–P6 | 实际 Pi 文件工厂新增、精确修改多个模块，保留无关文件，生成全工程快照与逐文件差异 | PASS；`tests/source-tools.test.ts`、`tests/project-source.test.ts` |
| P7 | 多标签独立缓冲区、保存状态和历史查看 | PASS；`tests/e2e/project-workspace.spec.ts` |
| P8 | 浏览器导入多文件 ZIP，保留目录、模块和入口，真实执行 | PASS；`tests/e2e/project-workspace.spec.ts` |
| P9 | 浏览器下载完整 ZIP，再导入新项目并执行，保留入口、模块和 40 × 30 × 15 mm 几何 | PASS；`project-workspace.spec.ts`；下载文件为 `roundtrip-project.zip` |
| P10 | 文件和目录删除、移动，真实版本及差异保持一致 | PASS；`source-tools.test.ts`；移动后的 Python import 由编辑者负责同步 |
| C1–C2 | 普通保存更新工作副本，不生成版本、不执行；无变化检查点复用版本 | PASS；`project-source.test.ts`、`project-workspace.spec.ts` |
| C3 | 未保存编辑与历史查看期间仍可发送对话 | PASS；`project-workspace.spec.ts` |
| C4–C6 | Agent 更新其他文件保留用户缓冲区；同文件条件保存拒绝冲突，保留分支和逐次差异 | PASS；`source-tools.test.ts`、`source-execution.spec.ts`、`project-workspace.spec.ts` |
| C7 | 浏览器采用单个历史文件及完整历史工程；检查其余文件、工作副本与原始不可变快照 | PASS；`project-source.test.ts`、`project-workspace.spec.ts`；人工验收为 NOT RUN |
| C8 | 导入源码生成可供实际 Pi read/edit 使用的快照，本地原文件保存语义明确 | PASS；`source-tools.test.ts`、浏览器导入测试；本地文件授权写回人工检查为 NOT RUN |
| C9–C10 | Agent 指令区分独立设计与已有设计修改；工具保留无关模块、任务固定源码及正式基线 | PASS；`source-tools.test.ts`、`source-gateway.test.ts`；在线模型是否遵循指令为 NOT RUN |
| E1–E2 | 用户运行直接提交指定快照，无模型调用或计划审批；真实候选展示并等待用户验收 | PASS；`project-workflow.test.ts`、`project-workspace.spec.ts` |
| E3–E4 | 实际语法及运行错误保留有效模型；执行期间编辑不改变冻结输入 | PASS；`source-execution.test.ts`、浏览器执行测试 |
| E5–E6 | 同项目运行互斥；同快照重跑具有独立执行身份，不重复创建源码版本 | PASS；`project-workflow.test.ts`、`source-execution.test.ts` |
| E7–E9 | 实际 cad_run 使用精确版本；建模漏执行后向同一 Agent 提醒；仅保存、只读诊断不执行；持续漏执行报告失败且保留历史 | PASS；`source-gateway.test.ts`；包含“执行刚才保存的源码版本”及“运行刚才保存的工程” |
| E10–E12 | 完整工程执行、历史源码快照独立、失败后基于明确父版本修复运行 | PASS；`project-workflow.test.ts`、`project-workspace.spec.ts`、`source-execution.test.ts` |
| E13–E15 | 用户验收更新准确正式修订；拒绝保留正式模型；重复批准或验收不重放执行；待验收状态重启恢复 | PASS；`source-gateway.test.ts`、`project-workflow.test.ts` |
| E16 | 历史修订查看保留当前聊天与源码编辑，视口按完整模型版本切换 | PASS；`project-workspace.spec.ts`、`viewer.spec.ts` |
| U1–U4 | 混合活动按持久序号排序；一次工具调用原位更新；连续操作折叠；重复事件、断线恢复不复制记录 | PASS；`activity.test.ts`、`viewer.spec.ts`、`source-execution.spec.ts` |
| U5–U6 | 持久项目恢复、最近项目和名称搜索 | PASS；`project-source.test.ts`、`project-workflow.test.ts`、`project-workspace.spec.ts` |
| U7 | Worker 实际执行、独立验证进度进入事件流；运行时仍可浏览编辑，取消进入终态 | PASS；`source-execution.test.ts`、`python-workflow.test.ts`、浏览器运行测试 |
| U8–U9 | 模型导出对应正式修订；源码 ZIP 包含工程文件和入口 | PASS；`project-workspace.spec.ts`、`source-execution.spec.ts`、`python-workflow.test.ts` |
| U10–U11 | 四种布局、分隔条和编辑状态；Linux 浏览器保存、撤销、重做、查找 | PASS；`source-execution.spec.ts` |
| U12 | 默认简洁版本标签，内部身份位于展开信息中 | PASS；截图和浏览器断言；人工可读性检查为 NOT RUN |

## 执行命令与结果

所有命令均在项目根目录运行，并设置上述 TMPDIR。最终日志对应本次工作目录。

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm run test:unit` | PASS，40 个文件、182 项测试 | `unit-current.log` |
| `npm run test:cad` | PASS，32 项真实原生 CAD 测试 | `cad-current.log` |
| `npm run build` | PASS；存在前端单文件体积提示 | `build-current.log` |
| `npx playwright test --reporter=line` | PASS，27 项完整浏览器回归，耗时约 2.5 分钟 | `browser-current.log` |
| `npx playwright test tests/e2e/project-workspace.spec.ts --reporter=line` | PASS，4 项；包含 ZIP 下载、重新导入及真实执行、单文件与完整历史恢复 | `project-browser-current.log` |
| `npm run verify:pi` | PASS，源码指纹一致 | `pi-current.log` |
| `git diff --check` | PASS | `diff-check-current.log` |
| `npm run typecheck` | BLOCKED，既有 Pi 与 OpenAI SDK 私有成员接口问题 | `typecheck-current.log` |

类型检查的用户提示词：不适用。确切错误为 `pi/packages/ai/src/api/openai-client.ts:8:15`，TS2341，访问 OpenAI 7.19.0 的私有 `fetch` 成员。该文件属于本地 Pi 源码，当前内容与 HEAD 相同。本轮未修改 Pi 内部实现，未屏蔽类型检查。

## 人工验收与未执行范围

以下均为 NOT RUN，不能根据自动化结果认定人工验收通过。在线步骤使用项目已经授权的配置，可能产生模型调用费用；本轮没有执行。

| 项目 | 操作与预期 | 证据缺口 |
|---|---|---|
| 在线 H1–H5 | 按 `source-execution-phase-1-2.md` 自然语言保存、执行、修改和修复；核对实际工具与源码身份 | 未调用真实模型服务 |
| 项目再次访问 | 重启日常开发服务，通过名称找到此前人工项目 | 已有隔离数据库重启自动检查；日常用户环境未人工操作 |
| 本地文件 | 通过浏览器授权另存为，核对本地文件；通过原生选择器导入目录 | 原生文件选择器和授权操作未人工执行；ZIP 下载后重新导入与执行已有浏览器自动验证 |
| 历史恢复 | 人工选择完整历史工程及单个历史文件采用，检查其余文件和未保存缓冲区 | 相同按钮已有浏览器自动验证；人工操作未执行 |
| 人机协作 | 用户未保存时与在线 Agent 同时修改相同和不同文件，选择保留、采用或手动合并 | 已有确定响应序列与浏览器冲突检查；在线人工协作未执行 |
| 活动阅读 | 长任务中展开操作，查看错误、逐文件差异和候选，检查滚动与阅读位置 | 有事件排序和运行状态自动检查；人工阅读质量未验证 |
| 其他平台 | macOS Cmd 快捷键、其他浏览器及硬件 GPU | 本轮仅 Linux Chrome/SwiftShader |

## 使用与状态

完整配置、环境变量和启动说明见 `docs/python-modeling.md` 与 README。启动后打开源码布局，选择文件进行编辑；普通保存只更新项目工作副本。“运行当前源码”冻结完整快照并直接执行；成功后查看候选并点击“验收候选并提交”。正式修订在验收后更新。活动中的“查看差异”打开对应父版本的真实新增、删除行；历史执行打开当时完整工程。

Python Agent 工具为 `read/write/edit/cad_files/cad_run`。建模请求无需用户指定工具名；保存与执行分开记录。`cad_run` 自动检查、重开、导出和返回观察结果；Agent 没有正式提交权限。没有任务条件时 `acceptanceStatus=not-run`，健康检查不能证明用户尺寸需求已经自动通过。失败执行保留源码、诊断和已有有效模型。

Pi 核心源码、模型服务配置和协议适配保持不变。旧固定操作仍供兼容和离线规则样例使用，未注册到新 Python Agent 正常工具集合。
