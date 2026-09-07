# 周报统一核对与发布说明

## 依据与边界

以用户更新的「01.2.1_提交本周记录」五项内容为准。90.1 继续作为人员、项目和权限的权威来源。
这份说明对应候选修复代码，不表示 Cloudflare 已部署、真实数据已迁移或已验收上线。
私有表 ID、Wiki 定位值和应用密钥保留在部署配置，不写入此文档。

## 为什么有多个周报入口

| 对象 | 已核实用途 | 统一后的安排 |
| --- | --- | --- |
| 工作台原绑定的独立周报表 | 后端曾向此表写入，日志报 FieldNameNotFound；网页位置未确认 | 通过管理员数据源面板定位，备份并核对历史后迁移 |
| 90.2 机器人实验室-周报表 | 29 个字段；「提交本周工作记录」和多个教师视图属于同一张表 | 作为唯一周报存储和教师查看后台 |
| 01.2.1 提交本周记录的问卷表 | 独立存储；5 项正文加自动编号、提交时间、公式等，共 13 个字段 | 保留最新版内容为迁移依据，入口最终指向工作台同一表单 |
| 90.2 机器人实验室-周报项目明细表 | 独立存储；11 项表单，要求关联已提交的主周报及项目 | 当前五项个人周报不调用；核对引用后停用学生入口 |

问卷/表单视图不是额外的数据表。教师按学生、按项目、需要协调等视图也不会各自产生一份独立存储。
但上述旧工作台表、90.2 主表、01.2.1 问卷表、项目明细表确实是四个独立对象。
旧设计将个人周报与项目进展拆开；后来又建立了独立问卷，尚未完成统一迁移。

## 唯一正文结构

| 字段 | 类型 | 必填 | 来源/用途 |
| --- | --- | --- | --- |
| 本周完成与结果 | 文本 | 是 | 本人填写；本人历史、教师查看、汇总读取 |
| 学习与方法 | 文本 | 否 | 提示：在科研过程中，掌握的学习经验、技术 |
| 产出（若有阶段性成果，可以提交文档链接） | 文本 | 否 | 原文保存；支持说明和多个 HTTP/HTTPS 网页、飞书链接 |
| 当前问题与阻塞 | 文本 | 否 | 原文保存，教师查看 |
| 下周计划 | 文本 | 是 | 本人填写；本人历史、教师查看、汇总读取 |

后台技术字段仍需存在：请求ID、飞书OpenID、姓名、周次（YYYY-Www）、周序号、周起始、周结束、提交状态、提交时间。
身份来自登录后重新核验的人员记录；周期由服务器按上海时区生成。正文表单不要求项目，也不猜测关联项目。
教师反馈功能另外依赖教师反馈、反馈请求ID、审核状态、反馈教师OpenID、反馈时间；启用前需核对这些列。
不要把自动创建人当作登录提交人，也不要向公式列写入值。

## 候选代码行为

- 五项正文使用统一读写映射，兼容迁移期间的已知旧列名；不创建第三套正文列。最终应通过确认字段引用后重命名完成统一。
- 文本产出原样保存；旧 URL 列只接受单链接，说明或多个链接会返回明确的存储类型错误，不截断内容。
- 新的 `/api/weekly` 独立读取周报，继续执行完整人员/项目鉴权，不依赖课程、文献等业务模块。
- 工作台首页的其他业务模块失败时，可独立显示周报；周报或人员读取失败仍报错，不伪造零条记录。
- `?page=weekly` 打开同一工作台表单；学生登录后自动打开，教师/管理员显示已获授权的查看入口。
- 管理员的「周报数据源核对」显示实际后端表名、ID、链接和字段缺口；普通成员不能调用该接口。
- 提交后读回验证五项内容与请求 ID，读回未确认时保留草稿；同账号同周重复记录会阻止覆盖。
- 教师查看、本人历史和教授汇总继续使用同一 WEEKLY 绑定。教授消息排版维持既有约定，此次未发送任何真实消息。

## 生产切换仍需完成

1. 记录当前 Cloudflare 版本并保留原配置，在后端部署候选代码；保持人员/项目绑定、SESSION_SECRET、AI 开关不变。
2. 确认 `/health` 返回 `weeklyPatch: weekly-five-fields-v1`。这只是代码标记，不是业务验收。
3. 通过管理员页面定位原工作台表，读取并备份原记录。此前另外两张表的只读清点为 0 条，不能据此假定原工作台表也为空。
4. 核对 90.2 主表的字段与依赖。已有正文列优先重命名，后台技术列按类型补齐；核对周报更新自动处理、项目表的周报列表/项目明细关联、01.2.1 的仪表盘与自动化。
5. 合并历史时，只用已核实的账号身份和周键；不按显示姓名或项目名称猜测归属。切换 WEEKLY_TABLE_ID 与该表自己的 WEEKLY_BASE 定位，防止落入旧全局 Base。
6. 后端验证后发布匹配的前端。一次真实提交、刷新后的本人历史、教师查看、第二账号隔离全部验收。
7. 将知识库周报入口指向 `https://1zjj.github.io/ER2_Lab_End/?page=weekly`；停用旧问卷提交入口。引用未核清、历史未备份前不删除表或字段。

尚不具备跨请求原子唯一约束；并发创建同一账号同周记录可能冲突。当前代码检测重复后拒绝继续覆盖，需要管理人员合并；不能据此宣称并发事务保证。

## 本地验证

执行 `cd worker && npm test`。飞书读取、身份和写入使用模拟数据，覆盖完整五项读写、修改同条记录、历史/教师读取、账号隔离、周报独立加载、权限撤回和读回失败。
本地通过不代表真实迁移或线上验收完成。

## Empty-source consolidation helper

`worker/prepare-weekly-consolidation.mjs` accepts the private release configuration
and four explicitly supplied Feishu table URLs (active Worker source, selected
weekly storage, edited questionnaire, project details), followed by `--plan` or
`--apply`. Do not commit those private URLs or configuration.

The helper snapshots every source and the prior configuration outside the checkout
before any schema change. It proceeds only if every source has no human-entered
content; computed cells and completely blank placeholder rows are retained in
place. Real content stops this bootstrap path and requires a separate reviewed
record migration. No row, view, workflow, permission, or message is changed.

The selected storage receives the canonical five content names by renaming existing
text columns, missing server metadata, and teacher feedback fields. Existing field
IDs are preserved on rename. Formula, person, and linked-record columns are not
converted or deleted. The backend populates existing teacher-view person columns,
week anchors, and the period title from the server-owned identity and week.

After schema mutation, all four sources are read again. Incomplete reads or new
content prevent configuration cutover. Only verified schema writes the proposed
weekly binding to the private release configuration; other runtime settings remain
unchanged. Deployment is a separate command guarded by the helper's exit status.
Partial schema changes are safe to resume by rerunning with a fresh backup.

The helper does not certify native ACLs, disable duplicate entrypoints, or claim
production readiness. Confirm one real submission with persisted readback and
teacher visibility before retiring old forms or rewriting knowledge-base links.
