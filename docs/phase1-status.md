# 阶段一实施记录

2026-10-24，本地分支 `implementation/text-to-cad`。任务0–10确定性纵切已实现；任务11的无授权准备已实现，**真实模型评测尚未授权/执行，不能宣称阶段一产品能力验收完成**。原始准备审查与设计稿保留为历史依据，未改写成“全部已通过”。

## 任务与实际验收

|任务|状态|实际执行的验证/行为|
|---|---|---|
|0 环境/工具链|完成|`npm run doctor` 实际FreeCAD1.1.3/Python3.11.14/OCCT7.8.1、UDS可绑定；`verify:pi`源码指纹；独立根锁文件及Node24.22.1|
|1 契约|完成|TS+Python共用严格DSL fixtures；布尔/字符串/非有限数/额外字段/越界拒绝|
|2 Worker|完成|真实独立进程/UDS分帧、ID匹配、限帧、超时、退出；不以同进程mock替代|
|3 可编辑CAD|完成|真实草图/命名约束/Pad/Pocket、命名参数修改、幂等步骤、事务回滚；单Body/单实体|
|4 独立验收|完成|新native进程重开FCStd、检查历史/参数/几何，STEP重导入，GLB实际二进制顶点/索引；三种零件|
|5 Revision提交|完成|SQLite WAL/FULL、baseRevision CAS、请求幂等、不可变完整包；真实child kill覆盖发布/DB窗口，坏hash/缺包fail closed|
|6 监督/恢复|完成|真实SIGKILL/挂起/超时/保存阶段取消、Gateway杀进程重启、排队旧版本；正式hash及HEAD保护|
|7 HTTP/WS|完成|真实本机监听：鉴权/Origin、快照/版本化文件、持久事件补发、幂等与409；无broker|
|8 Pi工具|完成（fake）|实际Pi循环；原始参数hook阻止true→1转换；20次工具/180秒限制；假的“成功”不能提交；无个人凭据读取|
|9 Web正式状态|完成（软件WebGL）|实际Chrome GLTFLoader/三角网格/bounds/孔位像素；全版本Before/After，迟到GLB/重复乱序事件/断线/缺artifact|
|10 用户闭环|完成（fake）|真实Chrome文字创建→孔径6到8→revision2；失败保持FCStd字节相同；取消、真实旧版本409、刷新、三格式下载；下载FCStd独立重开继续编辑，STEP重导入|
|11 评测准备|完成|固定6正例+4类负例、独立golden、原生离线runner、结果记录；本机HTTP SSE验证Pi协议/显式dummy key/请求前预算拒绝|
|11 live验收|待授权，未执行|尚需负责人批准provider/base URL/model、合成数据范围、价格上界/费用硬上限及本次执行；不以fake替代|

## 当前完整回归

`bash scripts/check-task11.sh` 在可绑定socket和启动Chrome的获准本机环境执行。测试命令不是未来建议：

|命令|实际结果|
|---|---|
|`npm run verify:pi`|通过，1922个源码文件指纹匹配；不重新声称用户移除`.git`后的Pi是干净Git checkout|
|`npm run doctor`|通过：精确版本、GuiUp=0、UDS/staging真值|
|`npm run typecheck`|通过|
|`npm run test:unit`|70/70，通过（包含实际UDS/HTTP/故障进程，不全是内存单元测试）|
|`npm run test:cad`|17/17，通过（host harness调用bundled native Python）|
|`npm run test:e2e`|7/7，通过，真实Chrome+ANGLE SwiftShader|
|`npm run test:eval -- evals/text-to-cad/v1.json`|离线10/10，`modelQualityQualified=false`；实际native包与独立golden验收|
|未设opt-in的`npm run test:live -- evals/text-to-cad/v1.json`|按设计退出1，明确Live NOT RUN；这是授权拒绝测试，不是live通过|

日志与结果在本机忽略的 `.superpowers/sdd/2026-10-24-text-to-cad/`；最终整体审查和修复记录追加在本文件后。RED阶段缺实现/回归失败属于开发证据，不混称环境阻塞。实际browser用安装的Chrome；测试不是只检查canvas存在。当前WebGL渲染、轴向/缩放、三角网格和孔位均真实验证，但**硬件GPU/交互桌面/其他浏览器未测**，不算对应产品验收通过。

## 工程决策、风险与退出条件

完整逐条裁决（按发生顺序及代价）见[工程裁决](phase1-decisions.md)。主要边界：一个Gateway数据目录/串行候选Worker；严格原始参数与跨端验证；Gateway唯一提交者；失败不重放；显式fake与授权live隔离；网格0.1mm近似不可替代BRep制造尺寸验收。属性修改沿用显式命名文字任务，因此当前离线样例以外的修改能力没有获证。

|准备审查退出条件|结论|
|---|---|
|无模型可复现测试 + 获准live小型评测|前半通过；live待授权，**未满足完整条件**|
|Web创建/修改/正式Revision/可编辑FCStd/有效STEP|fake编排+真实CAD/浏览器通过；自然语言模型能力未证|
|失败/超时/取消/杀进程/重复/旧版本保护|已测试的进程/文件故障矩阵通过；没有掉电/硬件故障或网络FS认证|
|刷新/重开/断线/乱序/迟到预览收敛|通过；未完成任务interrupted，不自动续跑|
|真实GLB加载/朝向/特征选择/完整版本切换|软件WebGL通过；Body/Tip级高亮，不承诺面→feature映射；硬件浏览器验收未做|

部署仍需固定持久位置的完整FreeCAD runtime、Pi源码指纹匹配、可绑定socket环境、浏览器和系统库。当前临时解包路径不能作为长期部署承诺。正式包损坏会阻止文档使用，需要人工检查数据目录；尚无恢复/磁盘整理UI、quarantine自动清理、备份自动化、跨设备掉电认证或多租户。这些不以静默降级或自动回退掩盖。

未调用付费模型、未上传CAD文件、未读取个人Pi登录信息、未推送远程。用户原有`.gitignore`修改保留且未纳入本轮提交；`pi/`源码未改动。使用方法与停止服务后的完整目录备份约定见[README](../README.md)。
