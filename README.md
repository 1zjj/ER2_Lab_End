# ER² Lab 统一工作台

ER² Lab 面向学生、教师和管理者的一页式飞书工作台。GitHub Pages 负责界面，Cloudflare Worker 负责飞书身份与权限，飞书多维表格负责结构化数据，知识库与云盘负责正文和大文件。

## 当前状态

- GitHub Pages 默认运行演示模式，可预览学生、教师和管理者视图。
- 页面内周报表单已完成。
- worker 目录已包含飞书 OAuth、角色校验、仪表盘、周报写入、教师反馈和定时提醒接口。
- 接入真实飞书前，需要完成 docs/feishu-setup.md 中的管理员配置。

## 预览

- 工作台：<https://1zjj.github.io/ER2_Lab_End/>
- 学生：?view=student
- 教师：?view=teacher
- 管理：?view=manager

演示模式使用虚构数据，不读取或保存任何飞书记录。

## 数据与安全边界

- GitHub 只保存公开前端代码、样式、静态搜索目录和 Worker 源码。
- App Secret、Session Secret 只保存在 Cloudflare Secrets。
- 学生信息、历史周报、项目敏感数据和自动化日志保存在飞书。
- ZIP、模型、rosbag、视频和代码包保存在飞书云盘，网页仅保存链接。
- 所有角色和数据范围均由 Worker 服务端校验，不能依赖前端隐藏按钮。

## 本地预览

在仓库根目录运行任意静态服务器：

~~~bash
python3 -m http.server 8080
~~~

然后打开 <http://localhost:8080/>。不要直接双击 index.html，否则浏览器可能禁止读取 data/catalog.json。

## 真实环境启用

1. 按 docs/data-schema.md 映射飞书多维表格字段。
2. 按 docs/feishu-setup.md 创建自建应用并配置权限。
3. 部署 worker，设置 Cloudflare Secrets 和 Variables。
4. 将根目录 config.js 的 apiBase 改为 Worker 地址，并把 demo 改为 false。
5. 在飞书工作台发布 ER² Lab 应用，完成学生、教师和管理者账号验收。

## 版本边界

V1 包含身份识别、个人门户、教师汇总、管理概览、页面内周报、提醒和教授汇总。不包含 OpenClaw、跨知识库 AI 问答、大文件代理上传、完整财务系统和完整设备审批。
