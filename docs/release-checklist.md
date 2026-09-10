# ER² Lab V1 上线验收清单

## 自动检查

- GitHub Pages 部署前执行前端 JavaScript 语法检查。
- Worker 部署前执行身份、权限、周报、文献、Track A 课程、教师反馈、去重与请求大小测试。
- Worker 部署完成后自动访问 `/health`，失败则标记部署失败。
- `/health` 必须返回 `coreReady: true`，且 `capabilities.learning.storageReady`、`capabilities.learning.recipientsReady`、`capabilities.finance.configured`、`weeklyAutomation.remindersConfigured` 和 `weeklyAutomation.digestConfigured` 均为 `true`。
- 旧课程表链路已由 `learning-text-v1` 替代；`courseConfigured: false` 是预期状态，不得再作为发布失败条件。旧 `/api/courses/*` 写入入口必须保持关闭。

## 飞书管理员一次性配置

- 自建应用主页指向 Worker `/auth/launch`，重定向地址为 `/auth/callback`。
- 应用可用范围首轮只包含朱俊杰和郑斯哲。
- 应用已加入各 ER² Lab 多维表格为协作者，并具有读取、新增和修改记录权限。
- 人员表中朱俊杰角色为学生、教师、管理者；郑斯哲角色为学生，并填写负责教师 OpenID。
- 按 `docs/data-schema.md` 补齐请求 ID、反馈字段、门户链接表和自动化日志表字段。
- 确认 `learning-text-v1` 独立存储可读写、朱俊杰与陈铮一收件人配置正确；正文、附件和代码包均不直接存入 GitHub。

## Cloudflare 一次性配置

- `FEISHU_APP_SECRET`、`SESSION_SECRET` 和所有 Base/Wiki token 使用加密 Secret。
- `wrangler.jsonc` 只保留非敏感变量和 table id，不保留 token。
- 两个试用账号首次登录成功后，将 `BOOTSTRAP_FIRST_USER`、`PILOT_AUTO_PROVISION` 改为 `false`。
- 如启用提醒，填写 `PROFESSOR_OPEN_ID` 和 `AUTOMATION_LOGS_TABLE_ID`。
- 旧 `COURSES_TABLE_ID` 不再是上线前置；确认 `COURSE_REVIEWER_OPEN_ID`（朱俊杰）、`PROFESSOR_OPEN_ID`（陈铮一）及学习存储绑定已配置。

## 两账号验收

1. 郑斯哲登录后只看到学生个人页，可提交并修改本周周报、查看历史周报、提交和查看共享文献。
2. 朱俊杰可切换学生、教师、管理三个视图；教师页只显示负责关系内的学生，并能保存教师反馈。
3. 两个账号都能在当前页打开文献详情，不发生无意义的新开窗口。
4. 大文件只上传飞书云盘或文档，网页和 Worker 只保存 HTTPS 链接。
5. 停用任一人员后，该账号所有 `/api/` 读取和写入都返回禁止访问。
6. 郑斯哲和孙世纪只能查看自己的 Lesson 01–10 提交；朱俊杰可查看和回复全部提交；陈铮一只能查看全部提交，不能回复或确认。
7. Lesson 01–09 只提交「核心收获、问题与处理、其他」，Lesson 10 另有必填「课程总结」，所有课程均不提供附件上传。
8. 学生完成 10 课后，只向陈铮一发送一次完成消息；重复刷新或重复请求不得再次发送。
9. 并发完成同一学生的最后一课只产生一条完成消息；发送失败保持失败状态，由管理员核实后人工重试。
