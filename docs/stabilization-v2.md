# ER² Lab Stabilization V2

## Goal

Make ER² Lab configuration-driven and data-driven so adding members, projects, courses, lessons, knowledge entries, and finance records normally requires only Feishu data changes, not frontend or Worker rewrites.

## Non-negotiable safety rules

1. `main` is not changed until the shadow branch passes all gates.
2. No migration step deletes or rebuilds an existing Feishu Base, table, record, document, or Wiki page.
3. Joey's Lab and every non-ER² knowledge base are read-only references and must never be traversed for writes.
4. Wiki is content/navigation only. Core business APIs must eventually use explicit Base app tokens.
5. V2 starts read-only (`V2_WRITES_ENABLED=false`).
6. Legacy global Base fallback remains enabled until direct bindings are verified and observed in production.
7. AI remains paused; AI plans/configuration are retained.

## Branches and rollback

- Production baseline: `main` at the commit from which V2 was created.
- Development: `stabilization/architecture-v2`.
- Rollback snapshot: `backup/pre-stabilization-v2-20260906`.

Do not delete the rollback branch until V2 has completed the production observation window.

## Connection migration

### Stage A — restore legacy locator

Restore the historical ER² Base locator as a Cloudflare secret only. Do not commit the locator to the public repository.

Use it only long enough to verify the existing members and weekly tables and to resolve the true Bitable app token.

### Stage B — explicit direct bindings

Prefer explicit bindings per table/domain:

- `MEMBERS_BASE_APP_TOKEN`
- `WEEKLY_BASE_APP_TOKEN`
- `PROJECTS_BASE_APP_TOKEN`
- `PROJECT_MEMBERS_BASE_APP_TOKEN`
- `COURSES_BASE_APP_TOKEN`
- `TRAINING_CATALOG_BASE_APP_TOKEN`
- `LINKS_BASE_APP_TOKEN`
- `LITERATURE_BASE_APP_TOKEN`
- `KNOWLEDGE_INDEX_BASE_APP_TOKEN`

Each binding is paired with its `*_TABLE_ID`.

### Stage C — shadow comparison

Old and new paths must point to the same physical Base/table. Compare record count, key field names, and stable business keys. V2 performs no writes during this stage.

### Stage D — direct binding primary

Set direct app-token bindings as primary while keeping `LEGACY_GLOBAL_BASE_FALLBACK=true` for rollback.

### Stage E — retire legacy fallback

After a complete observation window with zero fallback use, set `LEGACY_GLOBAL_BASE_FALLBACK=false`. Remove the global Wiki fallback only in a later cleanup release. Never delete historical Feishu records as part of this cleanup.

## Data model direction

### Core

Members, projects, project memberships, weekly reports, portal links, configuration, automation logs.

### Training

Course catalog and lesson catalog are data, not JavaScript constants. Course submissions remain separate from catalog metadata.

### Knowledge

Wiki stores long-form content. A Base index stores title, category, keywords, formal page URL, owner, state, publish/review dates, and visibility capability.

### Finance

Private reimbursement and private budget data remain separate from the public resource list. Finance capabilities are explicit and are not implied by generic manager status.

## Capability model

Capabilities are additive and data-driven:

- `student`
- `teacher`
- `manager`
- `admin`
- `finance`
- `budget_approver`
- `course_reviewer`
- `knowledge_editor`

Changing a reviewer or finance handler should require a member-record edit, not a deployment.

## Training scalability

Course and Lesson rows provide stable IDs, ordering, version, enable/disable state, audience capabilities, content links, and submission-template type.

Supported generic submission templates:

- `TEXT_REFLECTION`
- `CHECKLIST`
- `QUIZ`
- `EXPERIMENT_RECORD`
- `SUMMARY`

Adding a lesson using an existing template must not require frontend code changes.

## Release gates

V2 is not considered ready until all are true:

1. Existing Feishu login works.
2. Existing member read works.
3. Existing weekly read and submit work unchanged.
4. Existing teacher review works unchanged.
5. Direct Base bindings read the same physical records as the legacy path.
6. Required schemas pass.
7. Adding a member requires no code change.
8. Adding a project requires no code change.
9. Adding a Lesson using an existing template requires no code change.
10. Wiki read failure does not block core business health.
11. V2 writes remain disabled until a separate explicit cutover.
12. Rollback branch remains available.

## GitHub production protection

Before final cutover, protect `main` with pull-request and required-check gates and block force pushes/deletion. This is a repository administration step and should be performed only after the final CI check names are known.
