# 初步想法\-1022

# 开源 CAD Agent 平台设计方案



> 日期：2026\-10\-22  
> 
> 状态：架构评审稿  
> 
> 目标：基于 Pi Agent Harness、FreeCAD 和可复用的 VibeCAD 能力，构建体验优先、可供少量用户使用的 Web CAD Agent。
> 
> 



## 1\. 目标与范围



平台第一阶段面向 2–10 名可信用户，在一台高性能工作站或局域网服务器上运行。产品需要提供：



- Text\-to\-CAD：通过自然语言创建真实的参数化 CAD 模型。

- Image\-to\-CAD：根据照片、草图或工程图生成带明确假设的参数化模型。

- S~~TEP Edit：导入 STEP，进行几何识别、直接编辑或参数化重建。~~

- 可编辑特征树：保存草图、约束、Pad、Pocket、Fillet、Pattern 等历史。

- 多轮修改：通过自然语言或属性面板继续编辑已有模型。

- 过程可见：实时展示 Agent 计划、工具调用、受影响特征、验证和回滚。

- 可靠输出：持久化 FCStd，导出 STEP，并支持 GLB、STL、PNG 等派生文件。

- Main Agent \+ Subagent：专业 Agent 可以并行分析，但模型修改必须受控提交。

    

第一阶段不包含多租户计费、复杂组织权限、互联网规模调度和实时多人共同编辑。



## 2\. 架构决策



采用以下方案：



**新建 Web CAD 工作台 \+ Pi Agent 编排服务 \+ 独立 FreeCAD Worker \+ 选择性复用 VibeCAD。**



不直接将完整 VibeCAD 桌面界面改造成 Web，也不从零重新实现 FreeCAD 的全部控制能力。重点复用 VibeCAD 中可独立抽取的 Worker、候选模型、验证、脚本执行和本地控制思路。



选择该方案的原因：



- Web 产品体验不受 Qt 桌面界面约束。

- FreeCAD 和 OpenCascade 保持为几何事实来源。

- Pi 与 Web 层使用 TypeScript，便于流式交互和 Agent 编排。

- FreeCAD 在独立 Python 进程中运行，隔离崩溃、全局状态和长时间计算。

- FCStd 保存参数和特征历史，STEP 只承担交换与交付。

- 后续可以将本地 Worker 替换或扩展为远程 Worker，而不重写 Web 产品。

    

## 3\. 总体架构



```Plain Text
┌────────────────── Web CAD Workspace ──────────────────┐
│ Chat │ 3D View │ Feature Tree │ Properties │ Diff     │
└────────────────────────┬───────────────────────────────┘
                         │ HTTP + WebSocket
┌──────────────── CAD Gateway / Application ────────────┐
│ Project │ Revision │ Events │ Permissions │ Scheduler │
│                  Pi Agent Runtime                     │
└────────────────────────┬───────────────────────────────┘
                         │ Versioned CAD RPC
┌────────────────── FreeCAD Worker Pool ────────────────┐
│ Worker A: project-1.FCStd                             │
│ Worker B: project-2.FCStd                             │
│ FreeCAD + OpenCascade + reusable VibeCAD modules      │
└────────────────────────┬───────────────────────────────┘
                         │ Files and metadata
┌──────────────────── Artifact Storage ─────────────────┐
│ FCStd │ STEP │ STL │ GLB │ PNG │ revisions │ logs    │
└────────────────────────────────────────────────────────┘
```



### 3\.1 Web CAD Workspace



Web 端负责产品交互，不在浏览器中运行完整 FreeCAD：



- Three\.js 负责模型显示、选择、高亮、测量和差异预览。

- Chat 与当前选择、视角和特征上下文联动。

- 特征树从 FreeCAD 文档提取，但使用稳定的内部 ID，而非只依赖显示名称。

- 属性面板提供精确数值编辑，Chat 不是唯一入口。

- Agent 时间线实时显示计划、当前步骤、错误、验证结果和用户确认。

- 浏览器通过增量事件更新受影响对象，避免每一步重新加载整个模型。

    

现有 `buerligons-next` 可以保留其交互经验和部分 Web 组件，但 FreeCAD 将成为目标平台的主几何内核。



### 3\.2 CAD Gateway



CAD Gateway 使用 TypeScript 实现，承担：



- Pi Agent Runtime 及 CAD 领域中间件。

- 项目、会话、文档版本和文件管理。

- WebSocket 事件流、任务取消和断线恢复。

- Worker 创建、复用、健康检查和回收。

- 工具权限、危险操作确认和资源预算。

- 将大文件转换为 Artifact 引用，避免进入 LLM 上下文。

    

初期采用单服务部署，不引入 Kubernetes、分布式消息队列或复杂微服务。少量用户场景可使用 SQLite WAL 保存元数据和任务状态，文件系统保存 CAD Artifact。



### 3\.3 FreeCAD Worker



每个 Worker 是独立的 FreeCAD Python 进程：



- 同一文档同一时刻只有一个写入 Worker。

- 不同文档可以在不同 Worker 中并行计算。

- Worker 常驻，避免每次操作重新启动 FreeCAD。

- 每次变更在候选文档副本上执行。

- Worker 崩溃不会带走 Gateway 和其他文档。

- STEP、GLB、截图等大文件通过文件路径或 Artifact ID 传递。

    

Gateway 和 Worker 之间使用带版本号的 JSON\-RPC 协议，并通过本机 Unix Domain Socket 通信。协议稳定后可迁移到 gRPC，但第一阶段不承担该复杂度。



### 3\.4 Artifact Storage



项目目录采用以下结构：



```Plain Text
project/
  project.json
  canonical.FCStd
  feature-tree.json
  events.jsonl
  revisions/
    000001.FCStd
    000002.FCStd
  artifacts/
    model.step
    preview.glb
    thumbnail.png
```



- `canonical.FCStd`：唯一可编辑主模型。

- `feature-tree.json`：用于 Web 和 Agent 快速读取的派生索引。

- `events.jsonl`：不可变的操作、验证、确认和回滚记录。

- `revisions/`：可恢复的文档快照。

- `artifacts/`：STEP、STL、GLB、PNG 和工程图等派生输出。

    

## 4\. Agent 总体架构



平台采用“单写入者、多专家提案”模型：



```Plain Text
Main CAD Agent
              意图理解 / 规划 / 调度 / 提交
                              │
       ┌──────────────┬───────┴───────┬──────────────┐
       ▼              ▼               ▼              ▼
 Modeling Agent   Vision Agent   STEP Agent   Verification Agent
       └──────────────┴───────┬───────┴──────────────┘
                              ▼
                    CAD Transaction Engine
                              ▼
                        FreeCAD Worker
```



Main Agent 是正式模型变更的唯一协调者。Subagent 可以并行检查、推理或在不同候选副本上实验，但不能直接并发修改 `canonical.FCStd`。



### 4\.1 Main CAD Agent



Main Agent 负责：



- 理解用户目标、当前选择和上下文。

- 检查模型现状，不依据旧对话猜测模型状态。

- 生成可检查的执行计划和验收标准。

- 选择 Subagent、工具和模型等级。

- 管理假设、歧义、资源预算和用户确认。

- 将候选修改交给验证流程。

- 决定提交、修复或回滚。

- 向用户解释实际修改及生成的文件。

    

Main Agent 使用固定状态机：



```Plain Text
UNDERSTAND
→ INSPECT
→ PLAN
→ REQUEST_APPROVAL（仅高风险或歧义操作）
→ EXECUTE_CANDIDATE
→ RECOMPUTE
→ VERIFY
→ RENDER
→ COMMIT / REPAIR / ROLLBACK
→ REPORT
```



### 4\.2 Modeling Agent



负责 Text\-to\-CAD 和参数化修改：



- 提取尺寸、约束、材料和设计意图。

- 选择草图基准面和特征顺序。

- 生成完全约束或尽可能明确的草图。

- 使用 Part Design、Part 和 Sketcher 工具构建模型。

- 修改已有特征参数，避免无必要重建整个模型。

    

输出必须是结构化 CAD 操作列表，而不是任意 Python 文本。



### 4\.3 Vision Agent



负责 Image\-to\-CAD：



- 判断输入是照片、手绘草图、单视图还是多视图工程图。

- 提取轮廓、孔、槽、圆角、轴线、对称关系和尺寸标注。

- 区分明确尺寸、推导尺寸和未知尺寸。

- 输出结构化几何草案和假设清单。

    

如果缺失的尺寸会明显改变设计，Vision Agent 必须请求用户确认；不得将视觉估计伪装成精确尺寸。



### 4\.4 STEP Agent



负责 STEP 导入和编辑：



- 检查实体、壳体、面类型和装配结构。

- 识别孔、圆柱、平面、圆角、倒角和重复阵列。

- 为简单修改生成直接编辑方案。

- 为需要长期编辑的模型生成参数化重建方案。

    

STEP 通常不包含原始设计历史。平台可以创建新的重建特征树，但不能声称无损恢复原始树。



### 4\.5 Verification Agent



Verification Agent 默认只读，负责独立检查：



- FreeCAD recompute 是否成功。

- Shape 是否为空或无效。

- 是否存在非流形、自相交或异常壳体。

- 关键尺寸、孔数量和位置是否符合验收标准。

- 修改前后是否出现非预期几何变化。

- 装配干涉和基础可制造性问题。

    

验证失败时只返回诊断和建议，不直接修改正式模型。修复必须重新经过 Main Agent 和事务引擎。



## 5\. Pi Agent Harness 的 CAD 适配



Pi 保留模型调用、工具循环、流式事件、上下文转换和 Steering 能力。CAD 平台在其外部增加以下领域能力。



### 5\.1 类型化 CAD Tool Registry



第一阶段提供稳定、窄职责工具：



```Plain Text
inspect_document
inspect_feature
inspect_selection
create_body
create_sketch
add_sketch_geometry
add_constraint
pad_feature
pocket_feature
fillet_feature
chamfer_feature
pattern_feature
edit_feature_parameter
suppress_feature
import_step
recognize_step_features
offset_face
remove_feature_geometry
validate_model
render_model
export_step
```



工具输入使用严格 JSON Schema，并统一：



- 长度单位为毫米。

- 角度单位为度。

- 坐标采用右手坐标系。

- 明确建模公差。

- 每次调用携带 `documentId`、`baseRevision` 和幂等 `operationId`。

- 每个写工具声明预期结果和验收条件。

    

任意 Python 仅通过 `execute_sandboxed_cad_script` 提供，限制可导入模块、文件路径、运行时间、内存和输出大小。



### 5\.2 CAD Transaction Middleware



Pi 的工具调用前后增加确定性的事务中间件：



```Plain Text
工具调用前：
权限检查 → Schema校验 → 单位归一化 → Revision检查 → 创建候选副本

工具调用后：
FreeCAD recompute → Shape校验 → 尺寸验收 → 渲染预览

成功：
原子提交 → 生成新Revision → 更新特征树和预览

失败：
保留诊断 → 丢弃候选副本 → 修复或回滚
```



该能力必须由应用代码保证，不能依赖提示词要求模型“谨慎”。



### 5\.3 CAD State Provider



LLM 上下文只保存当前任务需要的摘要：



```JSON
{
  "documentRevision": 42,
  "activeBody": "Body",
  "selectedFeatures": ["HolePattern"],
  "parameters": {
    "plate_width": "80 mm",
    "hole_diameter": "6 mm"
  },
  "validation": "passed"
}
```



完整 FCStd、STEP、网格和大规模特征数据保留在 Artifact Storage。Agent 通过检查工具按需获取，防止上下文膨胀和使用过期状态。



### 5\.4 语义拓扑选择器



不能长期依赖 `Face3`、`Edge17` 等易变名称。工具层使用语义选择器：



```JSON
{
  "featureId": "BasePlate",
  "geometryType": "cylindrical_face",
  "axis": [0, 0, 1],
  "radius": 3,
  "nearestTo": [8, 8, 12]
}
```



解析顺序为：稳定特征 ID、创建关系、几何签名、空间邻近匹配。若匹配不唯一，操作停止并要求确认。



### 5\.5 长任务和中断



Pi 需要把每个步骤映射为前端事件：



```Plain Text
agent.plan.created
subagent.started
cad.operation.started
cad.preview.updated
cad.validation.failed
approval.required
revision.committed
task.cancelled
```



用户可以在当前工具调用完成后暂停任务、补充要求或取消后续步骤。FreeCAD 原子操作执行中不强制杀进程；超时后由 Worker Supervisor 终止候选 Worker 并保留正式文档。



### 5\.6 模型路由



- 快速模型：意图分类、简单参数修改和摘要。

- 强推理模型：复杂建模规划、失败修复和 STEP 重建。

- 视觉模型：照片、草图和工程图理解。

- FreeCAD/OpenCascade：最终尺寸、拓扑和有效性判断。

    

模型路由由任务复杂度和失败次数触发，不让每个请求都使用最高成本模型。



## 6\. Subagent 协议



### 6\.1 任务信封



```JSON
{
  "taskId": "task-1042",
  "documentId": "gearbox",
  "baseRevision": 18,
  "objective": "将四个安装孔直径改成 8 mm",
  "constraints": ["孔中心位置不变"],
  "allowedTools": ["inspect_document", "edit_feature_parameter"],
  "acceptanceCriteria": ["四个孔直径均为 8 mm"],
  "resourceBudget": {
    "maxToolCalls": 20,
    "timeoutSeconds": 180
  },
  "writeMode": "candidate-only"
}
```



### 6\.2 返回信封



```JSON
{
  "status": "candidate_ready",
  "baseRevision": 18,
  "operations": [],
  "assumptions": [],
  "affectedFeatures": ["HolePattern"],
  "validationRequests": [],
  "artifacts": [],
  "requiresUserApproval": false
}
```



如果正式文档已经不再是 `baseRevision`，结果不得直接提交。Main Agent 必须重新检查、重新规划或在新版本上重放操作。



### 6\.3 并发规则



- 多个 Subagent 可以并行读取同一 Revision。

- 多个候选副本可以并行实验。

- 正式文档提交必须串行。

- Verification Agent 不拥有写权限。

- Subagent 不相互调用；统一由 Main Agent 调度，避免不可控递归。

- 第一阶段最大 Subagent 深度为 1，最大并行数由 Worker 数量决定。

    

## 7\. 三类核心工作流



### 7\.1 Text\-to\-CAD



```Plain Text
自然语言
→ 结构化需求和参数表
→ 检查歧义
→ 生成特征计划
→ 创建候选FCStd
→ 逐特征执行并实时预览
→ 几何与尺寸验证
→ 提交Revision
→ 导出STEP
```



成功标准是产生可继续编辑的特征树，而不仅是一个外观相似的单一实体。



### 7\.2 Image\-to\-CAD



```Plain Text
图片预处理
→ 视图和标注识别
→ 轮廓与尺寸提取
→ 明确假设
→ 用户确认关键未知项
→ 参数化建模
→ 渲染视角对比
→ 几何验证和提交
```



照片生成的模型标记为“视觉估计”；包含完整尺寸的工程图可以标记为“尺寸驱动”。



### 7\.3 STEP Edit



```Plain Text
STEP导入
→ 实体和面分析
→ 识别可编辑特征
→ 选择直接编辑或参数化重建
→ 候选修改
→ 拓扑和尺寸验证
→ 保存为FCStd
→ 导出新STEP
```



直接编辑适合快速修改；参数化重建适合需要长期维护的零件。



## 8\. 可靠性与安全



- 所有写操作必须在候选副本执行。

- 正式文档通过原子文件替换提交。

- 每次提交生成 Revision 和可审计事件。

- Worker 仅访问指定项目目录和临时目录。

- 禁止生成代码访问任意网络、Shell 和用户目录。

- 设置执行时间、内存、文件大小和工具调用次数上限。

- 导入第三方 STEP 时进行文件类型、尺寸和复杂度检查。

- 导出前重新打开生成文件并执行最小完整性检查。

    

## 9\. 性能策略



- FreeCAD Worker 常驻并按文档复用。

- 推理、图像分析和只读几何检查可以并行。

- 同一文档的修改和 recompute 串行执行。

- 浏览器使用按对象拆分的 GLB 或增量网格更新。

- Agent 工具返回摘要和 Artifact ID，不返回完整网格。

- 特征树和几何摘要按 Revision 缓存。

- 简单参数修改走快速路径，不重新运行完整规划 Agent。

- 复杂建模按阶段生成预览，避免长时间无反馈。

    

## 10\. 测试与验收



### 10\.1 单元测试



- Tool Schema、单位转换和参数校验。

- Revision 冲突和幂等操作。

- 语义拓扑选择器。

- Agent 任务与结果信封。

- 权限和资源预算。

    

### 10\.2 FreeCAD 集成测试



- 草图、约束、Pad、Pocket、Fillet 和 Pattern。

- FCStd 保存、关闭和重新打开。

- STEP 导入、修改、导出和重新导入。

- Worker 崩溃、超时和候选回滚。

- 特征删除、重命名和拓扑变化。

    

### 10\.3 Agent 评测集



建立版本化 CAD Benchmark：



- 基础机械零件 Text\-to\-CAD。

- 多轮参数修改。

- 图纸尺寸提取。

- STEP 孔径、圆角和长度修改。

- 故意制造失败，检查自动诊断和回滚。

    

评测指标包括任务成功率、尺寸误差、特征树可编辑性、平均工具调用数、首次成功率、延迟和用户介入次数。



### 10\.4 端到端验收



第一阶段必须稳定完成以下闭环：



1. 用户用文字创建带草图和约束的机械零件。

2. Web 实时显示建模步骤和特征树。

3. 用户选中特征并通过文字或属性面板修改尺寸。

4. 修改失败时正式模型不受影响，并展示可理解的诊断。

5. 关闭并重新打开项目后，特征树和会话仍可恢复。

6. 导出的 STEP 能被 FreeCAD 重新导入并通过实体有效性检查。

    

## 11\. 实施分期



### 阶段一：可靠 Text\-to\-CAD 闭环



- Web 工作区基础框架。

- Gateway、Worker Supervisor 和单文档事务。

- Sketcher、Part Design、Part 的核心类型化工具。

- FCStd、特征树、Revision、STEP 和 GLB。

- Main Agent、Modeling Agent 和 Verification Agent。

- 过程流、取消、回滚和 Before/After。

    

### 阶段二：STEP 编辑



- STEP 几何检查与语义选择。

- 常见孔、圆柱、圆角和倒角识别。

- 直接编辑与基础参数化重建。

- STEP Agent 和 STEP 回归测试库。

    

### 阶段三：Image\-to\-CAD



- 图像、草图和工程图上传。

- Vision Agent、尺寸提取和假设确认。

- 多视图匹配和渲染对比。

    

### 阶段四：工程能力扩展



- Assembly、TechDraw 和工程图输出。

- 干涉、基础 DFM 和批量导出。

- 远程 Worker、团队协作和更细权限。

    

## 12\. 主要风险与控制措施



### FreeCAD 拓扑命名变化



使用稳定特征 ID、创建关系和几何签名组合定位；匹配不唯一时停止自动修改。



### STEP 无历史特征



明确区分直接编辑与参数化重建，不承诺无损恢复原始设计历史。



### LLM 生成不可靠操作



采用类型化工具、候选副本、确定性验证和独立 Verification Agent，不以自然语言判断成功。



### FreeCAD 稳定性和并发限制



使用进程隔离、单文档单写入者、Worker 超时和自动重启。



### VibeCAD 与 FreeCAD 许可证



Web UI 和 Pi 编排层保持清晰边界；复用和修改的 LGPL 组件保留许可证、通知和相应源码义务。发布前进行正式许可证审查。



## 13\. 已确定的产品原则



1. 本地优先，第一版服务少量用户。

2. 体验优先，但不以隐藏工程状态换取表面简洁。

3. FCStd 是主模型，STEP 是交换和交付格式。

4. FreeCAD/OpenCascade 是几何事实来源。

5. Main Agent 是唯一变更协调者。

6. Subagent 并行分析，正式 CAD 变更串行提交。

7. 类型化工具优先，受限 Python 只作为逃生通道。

8. 每次修改都必须可追踪、可验证、可取消和可回退。

9. 第一阶段只覆盖高价值 FreeCAD 能力，不追求所有工作台。

10. 完成 Text\-to\-CAD 可靠闭环后，再扩展 STEP 和图像能力。

    

