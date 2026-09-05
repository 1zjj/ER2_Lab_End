# 飞书与 Cloudflare 上线配置

## 1. 创建飞书自建应用

在飞书开放平台创建企业自建应用，名称设为“ER² Lab”，启用网页应用。

应用主页最终填写：

~~~text
https://er2-lab-api.<你的workers.dev子域>.workers.dev/auth/launch
~~~

重定向地址填写：

~~~text
https://er2-lab-api.<你的workers.dev子域>.workers.dev/auth/callback
~~~

## 2. 最小权限

根据飞书后台实际显示名称，申请以下最小范围：

- 获取当前登录用户基本信息；
- 查看知识库（`wiki:wiki:readonly`，用于把 `/wiki/` 节点解析为多维表格 app token）；
- 查看多维表格；
- 新增、修改多维表格记录；
- 发送应用消息（启用周五提醒和教授汇总时需要）。

把自建应用加入承载 ER² Lab 数据的多维表格协作者，并设置应用可用人员范围。

## 3. 部署 Worker

进入 worker 目录：

~~~bash
npm install
npx wrangler login
npx wrangler deploy
~~~

在 Cloudflare 中设置加密 Secrets：

~~~bash
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FEISHU_BASE_WIKI_TOKEN
~~~

SESSION_SECRET 使用至少32字节随机字符串。所有 `*_BASE_APP_TOKEN`、`*_BASE_WIKI_TOKEN` 也按加密 Secret 管理；不使用的项无需设置。不要把这些值写入 GitHub 或 `wrangler.jsonc`。

设置普通 Variables：

| 变量 | 内容 |
|---|---|
| FRONTEND_URL | https://1zjj.github.io/ER2_Lab_End/ |
| FEISHU_REDIRECT_URI | Worker 的 /auth/callback 完整地址 |
| FEISHU_APP_ID | 飞书自建应用 App ID（非密钥） |
| BOOTSTRAP_FIRST_USER | 首次空表登录时自动登记唯一测试账号；完成首个账号验收后改为 `false` |
| BOOTSTRAP_ADMIN_NAME | 可选覆盖：允许自动登记为管理者的飞书姓名；代码默认仅允许 `朱俊杰` |
| PILOT_AUTO_PROVISION | 两人试运行期间设为 `true`，仅对飞书应用可用范围内的新增账号自动登记为学生；两人完成首次登录后改为 `false` |
| PILOT_ALLOWED_NAMES | 可选覆盖：自动登记白名单；代码默认仅允许 `朱俊杰,郑斯哲`，其他账号不会自动加入 |
| MEMBERS_BASE_APP_TOKEN / MEMBERS_TABLE_ID | 人员表的 app token / table id |
| WEEKLY_BASE_APP_TOKEN / WEEKLY_TABLE_ID | 周报表的 app token / table id |
| LITERATURE_BASE_APP_TOKEN / LITERATURE_TABLE_ID | 文献阅读表的 app token / table id |
| PROJECTS_BASE_APP_TOKEN / PROJECTS_TABLE_ID | 项目表的 app token / table id |
| COURSES_BASE_APP_TOKEN / COURSES_TABLE_ID | 课程进度表的 app token / table id |
| TASKS_BASE_APP_TOKEN / TASKS_TABLE_ID | 任务表的 app token / table id |
| LINKS_BASE_APP_TOKEN / LINKS_TABLE_ID | 门户链接表的 app token / table id，可选 |
| AUTOMATION_LOGS_BASE_APP_TOKEN / AUTOMATION_LOGS_TABLE_ID | 自动化日志表的 app token / table id，可选 |
| PROFESSOR_OPEN_ID | 接收周五摘要和 Track A 结业通知的教授 open_id；启用课程流程时必填 |
| COURSE_REVIEWER_OPEN_ID | 朱俊杰的 open_id；只有该账号可以确认 Track A 课程记录 |

ER² Lab 当前数据分布在多套 Base 中，因此优先为每张表设置对应的加密 Secret：`MEMBERS_BASE_APP_TOKEN`、`WEEKLY_BASE_APP_TOKEN`、`LITERATURE_BASE_APP_TOKEN` 等。仅当全部表都在同一套 Base 中时，才使用兼容 Secret `FEISHU_BASE_APP_TOKEN`。

如果某张表位于知识库，可把对应 `*_BASE_APP_TOKEN` 换成加密 Secret `*_BASE_WIKI_TOKEN`；全部核心表位于同一个知识库节点时可统一设置 `FEISHU_BASE_WIKI_TOKEN`。

## 4. 启用真实数据

修改仓库根目录 config.js，把 apiBase 改为 Worker 地址并把 demo 改为 false。

## 5. 验收账号

首轮仅开放朱俊杰、郑斯哲两个账号测试：

1. 郑斯哲：学生角色，只能查看和提交本人周报，可查看共享文献阅读；
2. 朱俊杰：学生、教师、管理者角色，可切换三个视图并查看共享文献阅读。

两人完成首次授权后，立即把 `BOOTSTRAP_FIRST_USER` 和 `PILOT_AUTO_PROVISION` 都改为 `false`。还应测试停用成员无法继续写入、学生直接请求教师接口返回403、同一周重复提交更新原记录、文献提交重试不重复建记录，以及飞书移动端可正常打开。

## 6. Track A 课程记录

在课程进度表中按 `docs/data-schema.md` 增加纯文字提交、确认与结业通知字段。设置：

- `COURSES_TABLE_ID`：课程进度表 table id。
- `COURSES_BASE_APP_TOKEN` 或 `COURSES_BASE_WIKI_TOKEN`：课程表所在 Base 的标识，必须放在 Cloudflare Secret。
- `COURSE_REVIEWER_OPEN_ID`：朱俊杰的 open_id。
- `PROFESSOR_OPEN_ID`：陈铮一教授的 open_id。

Lesson 01–10 每名学生各保留一条记录。Lesson 01–09 提交核心收获、问题与处理、其他；Lesson 10 额外提交课程总结。全部十课由朱俊杰确认后，Worker 仅向陈铮一教授发送一次结业消息。

`/health` 只有在课程表、朱俊杰 OpenID 和陈铮一 OpenID 均配置完成时才返回 `courseConfigured: true`。结业通知同时使用飞书消息 `uuid` 幂等参数、课程表持久状态和同一学生串行确认锁。通知发送失败时不会自动重发；管理员核实后可在飞书后台清空结业通知状态，再重新确认触发一次人工重试。

学生只收到自己的课程记录；朱俊杰、陈铮一教授的全量查看权限在 Worker 服务端判断。不要把课程记录表直接共享给普通学生。
