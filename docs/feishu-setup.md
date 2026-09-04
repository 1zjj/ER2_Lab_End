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
npx wrangler secret put FEISHU_APP_ID
npx wrangler secret put FEISHU_APP_SECRET
npx wrangler secret put SESSION_SECRET
~~~

SESSION_SECRET 使用至少32字节随机字符串。不要把以上值写入 GitHub。

设置普通 Variables：

| 变量 | 内容 |
|---|---|
| FRONTEND_URL | https://1zjj.github.io/ER2_Lab_End/ |
| FEISHU_REDIRECT_URI | Worker 的 /auth/callback 完整地址 |
| FEISHU_BASE_APP_TOKEN | 多维表格 app token |
| MEMBERS_TABLE_ID | 人员表 table id |
| WEEKLY_TABLE_ID | 周报表 table id |
| PROJECTS_TABLE_ID | 项目表 table id |
| COURSES_TABLE_ID | 课程进度表 table id |
| TASKS_TABLE_ID | 任务表 table id |
| LINKS_TABLE_ID | 门户链接表 table id |
| AUTOMATION_LOGS_TABLE_ID | 自动化日志表 table id，可选 |
| PROFESSOR_OPEN_ID | 接收周五摘要的教授 open_id，可选 |

## 4. 启用真实数据

修改仓库根目录 config.js，把 apiBase 改为 Worker 地址并把 demo 改为 false。

## 5. 验收账号

至少用三个账号测试：

1. 学生：只能查看和提交本人记录；
2. 教师：只能查看负责学生；
3. 管理者：查看全局汇总。

还应测试学生直接请求教师或管理接口时返回403、同一周重复提交更新原记录、飞书移动端可正常打开。
