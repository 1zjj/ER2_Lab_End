# ER² Personnel Master V2

## Stable identity
- `人员编号` is the permanent business key and uses `P-001` ... `P-999`.
- IDs are never reused, renumbered, or changed after creation.
- Feishu OpenID is an authentication identifier, not the business primary key.
- Names are display data and must never be used as authorization keys.

## Current canonical members
| PersonID | 姓名 | 人员边界 | 成员类别 | 系统职责 |
| --- | --- | --- | --- | --- |
| P-001 | 陈铮一 | 团队内 | PI | 预算审批；教授周报接收 |
| P-002 | 朱俊杰 | 团队内 | 硕士 | 管理员；课程审核 |
| P-003 | 郑斯哲 | 团队内 | 博士 | — |
| P-004 | 孙世纪 | 团队内 | 博士 | 财务 |

## Personnel table schema
Required fields:
1. 人员编号
2. 姓名
3. 飞书成员
4. 人员边界：团队内 / 团队外
5. 成员类别：PI / RA / 博士 / 硕士 / 本科生 / 联合培养 / 企业伙伴 / 临时
6. 人员状态：在组 / 离组 / 已归档
7. 入组时间
8. 保密等级：普通 / 内部 / 受限
9. 培训状态：未开始 / 进行中 / 已完成 / 豁免
10. 直属负责人（内部人员关联）
11. 关联项目（通过项目成员关系表关联/汇总）
12. 系统职责（多选）

Recommended system/support fields:
- 飞书OpenID（系统维护）
- 离组时间
- 联合培养/外部导师
- 备注

Removed from personnel master:
- 设备资质
- 能力标签

## System duties
System duties are explicit authorization grants, independent of academic category.
- 管理员 → `admin`
- 财务 → `finance`
- 课程审核 → `course_reviewer`
- 预算审批 → `budget_approver`
- 教授周报接收 → `professor_digest_recipient`
- 知识编辑 → `knowledge_editor`

`admin` MUST NOT imply finance, budget approval, or course review.

## Lifecycle
- 在组: eligible for access when Feishu group membership is also valid.
- 离组: access disabled; history retained; 离组时间 required.
- 已归档: hidden from normal active-person views; history retained.
- Records must not be physically deleted as part of offboarding.
- Rejoining reactivates the same PersonID.

## Group boundary
The intended access model is:
`ER² Lab Members` group membership + personnel status=在组 -> baseline workbench admission.
The group is the first gate. Personnel table data determines identity and authorization.

## Relationships
- 直属负责人 points to an internal PersonID.
- 联合培养/外部导师 stores or links an external supervisor; it does not grant ER² access.
- 关联项目 is not a free-text authorization source. The project-member relation table is authoritative.

## No-code personnel operations
Adding a member must require only data operations: add to ER² Lab Members group, create a personnel row, assign projects/duties. No code or deployment changes.
Removing a member must require only: set 人员状态=离组, set 离组时间, remove from ER² Lab Members group. No code or deployment changes.
Changing finance/admin/reviewer responsibilities must only update 系统职责.
