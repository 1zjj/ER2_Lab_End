# ER² Lab V1 上线验收清单

## 自动检查

- GitHub Pages 部署前执行前端 JavaScript 语法检查。
- Worker 部署前执行身份、权限、周报、文献、Track A 课程、教师反馈、去重与请求大小测试。
- Worker 部署完成后自动访问 `/health`，失败则标记部署失败。

## 飞书管理员一次性配置

- 自建应用主页指向 Worker `/auth/launch`，重定向地址为 `/auth/callback`。
- 应用可用范围首轮只包含朱俊杰和郑斯哲。
- 应用已加入各 ER² Lab 多维表格为协作者，并具有读取、新增和修改记录权限。
- 人员表中朱俊杰角色为学生、教师、管理者；郑斯哲角色为学生，并填写负责教师 OpenID。
- 按 `docs/data-schema.md` 补齐请求 ID、反馈字段、门户链接表和自动化日志表字段。
- 新建 Track A 课程提交表，按 `docs/data-schema.md` 补齐课程字段；正文、附件和代码包均不直接存入 GitHub。

## Cloudflare 一次性配置

- `FEISHU_APP_SECRET`、`SESSION_SECRET` 和所有 Base/Wiki token 使用加密 Secret。
- `wrangler.jsonc` 只保留非敏感变量和 table id，不保留 token。
- 两个试用账号首次登录成功后，将 `BOOTSTRAP_FIRST_USER`、`PILOT_AUTO_PROVISION` 改为 `false`。
- 如启用提醒，填写 `PROFESSOR_OPEN_ID` 和 `AUTOMATION_LOGS_TABLE_ID`。
- 填写 `COURSES_TABLE_ID`，并以 Secret 保存 `COURSE_REVIEWER_OPEN_ID`（朱俊杰）和 `PROFESSOR_OPEN_ID`（陈铮一）。

## 两账号验收

1. 郑斯哲登录后只看到学生个人页，可提交并修改本周周报、查看历史周报、提交和查看共享文献。
2. 朱俊杰可切换学生、教师、管理三个视图；教师页只显示负责关系内的学生，并能保存教师反馈。
3. 两个账号都能在当前页打开文献详情，不发生无意义的新开窗口。
4. 大文件只上传飞书云盘或文档，网页和 Worker 只保存 HTTPS 链接。
5. 停用任一人员后，该账号所有 `/api/` 读取和写入都返回禁止访问。
6. 郑斯哲只能查看自己的 Lesson 01–10 提交；朱俊杰可查看并确认全部提交；陈铮一只能查看全部提交，不能确认。
7. Lesson 01–09 只提交「核心收获、问题与处理、其他」，Lesson 10 另有必填「课程总结」，所有课程均不提供附件上传。
8. 10 课全部由朱俊杰确认后，只向陈铮一发送一次结业消息；重复刷新或重复确认不得再次发送。
