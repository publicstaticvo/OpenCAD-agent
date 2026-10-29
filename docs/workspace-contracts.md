# 项目、对话与执行记录

## 用户操作

工作区顶部提供新建项目、项目列表、切换和项目改名。每个项目拥有自己的当前模型、不可变修订、下载文件、任务和对话。地址使用 `?document=<项目ID>&conversation=<对话ID>`，刷新恢复对应身份；无效身份明确报错。

对话面板提供新建、切换及改名。每个对话拥有独立聊天和发送给模型的上下文；同一项目的所有对话共享当前 CAD 模型及修订记录，界面持续显示此关系。切换对话保留模型视口。后台任务显示所属对话，切换项目或对话不会取消任务。

输入自然语言后先生成只读计划，界面显示结构、尺寸和验收条件。支持参数化长方体、在其上增加一个中心贯穿孔及修改孔径；尺寸来自本次计划。每个任务批准一次，批准前没有候选或可写 Worker。拒绝后可提交修订后的需求；获批计划不能直接编辑。

任务执行时显示真实的用户可见文字、工具开始及结果、逐操作事务记录、FreeCAD 草图/约束、候选实体、几何检查、保存 FCStd、独立重开、STEP/GLB 导出及正式提交。候选标记为未提交，左侧正式树、属性与下载保持原修订；完整正式包载入后一起切换。关键/完整记录偏好仅保存在浏览器；完整记录增加服务返回的 thinking 和 CAD 调用参数、结果。正式成功以 `committed` 及 revision 为准。

活动记录保留实际草图检查点；成功任务最后一个实体检查点可以主动打开查看，标记为只读历史候选。失败、取消或中断时隐藏候选。通过“查看修改前”比较最近显示的正式版本，通过“查看修订”选择并下载任一已有正式版本；历史版本不能编辑。

## HTTP 与数据身份

所有接口沿用工作区访问密钥验证和 document 项目身份。

| 接口 | 行为 |
| --- | --- |
| `GET/POST /api/documents` | 项目列表/创建；创建接受可选 `id,name`，同时建立默认对话 |
| `GET/PATCH /api/documents/:id` | 项目快照/修改 `name` |
| `GET/POST .../:id/conversations` | 对话列表/创建，接受可选 `title` |
| `GET/PATCH .../:id/conversations/:conversationId` | 查询/重命名 `title`，检查所属项目 |
| `GET .../:conversationId/messages?afterOrdinal=0&limit=200` | 持久消息分页，包含 Pi payload、ordinal、operation 和 base revision |
| `POST .../:id/jobs` | 原有请求增加可选 `conversationId`；缺省映射默认对话 |
| `POST .../:id/jobs/:operationId/approve` | 接受 `{planHash}`；核对持久计划、HEAD 与项目写入资格，批准并排入执行；重复批准不重放 |
| `POST .../:id/jobs/:operationId/reject` | 接受 `{planHash}`；仅拒绝待批准计划，不创建候选 |
| `GET .../:id/jobs/:operationId/events?afterSeq=0&limit=200` | 按任务分页读取完整持久事件，超出快照窗口的旧记录仍可查询 |
| `GET .../:id/jobs/:operationId/candidate/snapshot` | 返回当前任务状态及最近实际候选快照，包含基线、计划、候选身份和序号 |
| `GET .../:id/jobs/:operationId/candidate/preview?sequence=N` | 读取最新真实候选 GLB，核对身份、文件类型、字节数及哈希；成功后可读最后检查点；失败/取消/中断拒绝 |
| `GET .../:id/revisions`、`GET .../:id/revisions/:revision` | 查看已有正式修订及完整树/参数/资产；下载 URL 绑定该修订 |
| `GET/WS .../:id/events` | 项目事件和连续 seq 恢复 |

SQLite `documents` 保存名称、时间和 head；`conversations` 外键属于项目；`messages` 使用 `(conversation_id,ordinal)` 排序，保存规范 Pi 消息、工具调用 ID 和 base revision。只将当前对话已提交/正常回复轮次用作后续模型上下文，历史几何标记原版本，当前正式快照独立提供。

## 执行与恢复

状态路径为 `planning → awaiting_approval → approved → running → validating → committing → committed`。只读回复和澄清使用 `answered`，用户拒绝为 `rejected`，其余终态为 `failed/cancelled/interrupted`。每个 job 保存一份不可变 plan、内容哈希、base revision 和批准决定，复用现有 SQLite JSON，不建立单独审批系统。

同项目 approved、queued、running、validating、committing 均占用写入资格；可同时保存多个只读待批准计划，其他对话仍可提交只读需求。第二次批准若项目忙碌返回 HTTP 409 `project_busy`；HEAD 已变化时拒绝过期计划。规划与执行沿用全局串行队列，排队期间基线变化会明确拒绝。不同项目的数据保持隔离；一个数据目录仅运行一个 Gateway。

所有写入口经过同一有限授权检查：对象、几何、约束、参数、依赖顺序和阶段符合批准才转交 Worker；批次后再次检查真实文档。一次写入拒绝或失败后，不再接受该任务的写入或提交。没有自动 CAD 修复或修改重放。保存前和独立重开后检查实际草图约束、Pad/Pocket 结构及几何；孔还需通过圆柱面和实际材料点检查证明贯穿。只有完成完整文件包并再次检查批准和基线，才能更新 HEAD。

事件先与消息快照一起写入 SQLite，再发送 WebSocket。事件具有项目 seq、job、conversation、候选身份；Pi 文字具有 messageId、deltaIndex。Worker JSON-RPC `cad_progress` 通知带原请求 ID、候选 ID、阶段和递增序号，`hello` 公布版本 1 通知能力。前端处理重复、缺失及重新连接时恢复正式快照；模型与下载只在完整版本载入后更新。

项目快照保留最近 500 条进度用于快速恢复。界面另外分页读取选中对话的持久消息及各任务完整事件，历史执行记录不会因该窗口而丢失。进程意外终止前已写入的部分回复也能恢复。Gateway 重启保留 `awaiting_approval`，将其余未结束任务标为 `interrupted`，清理旧 Worker，不自动重放 CAD 操作。取消、超时和失败不会改变既有正式包。

原生操作事件区分 start、returned、batch_complete 和 batch_aborted；返回结果仍处于事务中时不能表示该几何已保留。草图和实体检查点仅在真实批次提交及回读检查后发布。快照持久化前重新检查取消、终态和候选身份，迟到结果不能恢复已取消任务。成功后观察资产从对应正式包读取，仍标记为历史执行记录；正式文件下载使用 revision manifest。

切换项目时销毁旧订阅和模型、取消旧浏览器请求，按请求世代、项目和 revision 检查迟到结果。项目列表的活动任务摘要在读取列表时取得；选中项目的实际任务状态由事件实时更新。

## 升级与备份

SQLite `user_version=1`；升级前在数据目录生成 `before-workspace-<UUID>/`，通过 SQLite 一致快照备份数据库并复制全部正式修订包，之后事务迁移。旧项目保留 ID、head 和文件；每项目建立默认对话，从旧 Job 导入用户输入和 transcript，重复启动不重复导入。配置文件版本独立，`model-settings.json` 版本 3 保存协议和三个超时字段；旧配置保留原协议，缺失协议使用 Chat Completions，缺失超时使用 0。

日常备份应停止 Gateway 后复制整个数据目录，包含 SQLite、正式包及私有模型配置。升级备份用于保留升级前模型与数据库，不能代替整个目录的日常备份。不要删除内核 owner 锁文件、手工修改 head 或自动重放中断任务。

启动与模型设置见 [在线模式](online-mode.md)，本次 M1/M2 验收见 [演示产品验收](v1-demo-validation.md)，模型兼容性历史记录见 [在线验证](online-validation.md)。
