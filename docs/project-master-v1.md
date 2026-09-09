# Canonical project source for prelaunch

Project definitions now come from `PROJECTS_TABLE_ID` (90.2). `AUTH_PROJECTS_TABLE_ID` (90.1) supplies compatibility links for existing relationship records. Stable PRJ identifiers join the two sources; legacy P01/P02/P03 labels and display names never authorize access.

The reader rejects ambiguous IDs, duplicate definitions, missing canonical policy fields, and policy drift between the canonical record and its mirror. An orphan mirror never creates an authorized project. New canonical projects are readable by current internal administrators without fabricating a business relationship or requiring a mirror first. A rename uses the canonical title and reports stale mirror text.

`projectDisplayProjection` computes the owner and member fields from current, effective, applied business relationships. Administrator duties alone do not add someone to these lists. Empty ownership displays `待指定`; multiple active owners produce an explicit issue and no arbitrary owner selection. A malformed extra relationship remains visible to the authorization validator after translating legacy links, so it cannot be silently discarded to preserve another grant.

The request reuses its canonical project snapshot for project cards and responses. Personal weekly records and reminder recipient checks remain independent of project definitions unless a returned record actually has a project scope.

`GET /api/admin/projects/consistency` reports source consistency and the proposed display projection to a current administrator. It performs no writes, rechecks administrator duties before returning data, and never certifies native access from this report.

## Deployment gate

This change does not yet implement the mirror writer, display-field writer, versioned native permission executor, or receipt verification. These writers must be completed and verified before production cutover. Do not manually set an unapplied relationship to `已落实` to satisfy the reader. Existing pending relationships will remain denied by the tightened reader.

Acceptance covers canonical versus mirror drift, unknown and duplicate IDs, new administrator projects without relationships, read-only owners, role/permission separation, expired and revoked relationships, and malformed extra associations. Automated fixtures do not replace native ACL readback or real-account acceptance.
