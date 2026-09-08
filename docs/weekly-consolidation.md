# Weekly reporting contract and maintenance

The workbench has one weekly form and one configured weekly storage table.
Use `?page=weekly` for the shared entrypoint. The homepage and knowledge-base
navigation must lead to this form rather than to independent questionnaires.

## Content contract

The form uses five text fields: progress/results, learning/methods, output/evidence,
current blockers, and next-week plans. Progress/results and next-week plans are
required. Evidence may contain explanatory text and multiple HTTP/HTTPS links;
it is not restricted to a single URL cell.

The server determines the submitting identity and reporting week. Clients must
not supply authoritative person identifiers or infer project relationships.
Project selection and separate project-detail submissions are not required by
this personal weekly contract.

## Storage and consumers

Resolve all weekly reads and writes through `WEEKLY_TABLE_ID` and its table-specific
base locator. Submission, readback, personal history, teacher review, feedback,
and scheduled digest processing must use that same binding. A knowledge-base
page title does not determine the write destination.

Preserve the server metadata, identity/week fields and feedback fields required
by the serializers. Do not write to formula or automatic-created-user fields.
Hide obsolete presentation columns where appropriate instead of removing
fields still referenced by formulas or other consumers.

A same-week edit updates the existing record. Saving is followed by independent
readback of the submitted content and request identifier. If readback cannot be
confirmed, retain the draft and report that state. Duplicate identity/week rows
must not be silently merged or overwritten.

## Retiring duplicate storage

Inventory the active binding, older storage, forms, native workflows, linked
fields, dashboards and navigation before removal. Distinguish physical tables
from views and dashboards. Back up real records and configuration privately;
do not commit production inventories, table locators or record snapshots.

Stop duplicate collection and scheduled consumers before retiring their source.
Remove obsolete linked-field dependencies before deleting an unused table.
Preserve unrelated tables in shared bases. Move a retired configuration bundle
out of student navigation when it still contains useful configuration history.
Update every entrypoint to the shared workbench form and verify old collection
links no longer accept submissions.

Keep operational cleanup evidence in the private system documentation. This
repository guide describes the maintenance contract; it is not a live inventory
or a certification that every deployment has completed the procedure.

## Validation

Run `cd worker && npm test` for code changes. Relevant cases cover five-field
read/write mapping, optional project links, same-record edits, caller isolation,
readback failures and scheduled-consumer filtering. A live acceptance check must
also verify refresh, personal history and teacher visibility. Use clearly marked
synthetic content and remove only the corresponding test record afterwards.

A binding health check alone is not submission acceptance. Native sharing/ACLs,
other modules and cross-request uniqueness require their own verification.

## Stability regression coverage

The weekly stability regression covers dual-role students in the reminder and
digest roster, explicit empty Feishu record pages, draft/submitted status,
no-issue text, text-only input, and final-write eligibility revalidation.
Reminder deliveries require a configured receipt table, use deterministic
message identifiers and retain per-recipient success receipts for partial retries.
The retired legacy text-summary path is removed; the runtime uses the verbatim
digest implementation at the scheduled summary time.

Optional literature statistics cannot block a weekly reminder or digest. When
literature cannot be read, the digest explicitly labels those statistics as
unavailable rather than reporting zero. Failures reading personnel, weekly
records or delivery receipts still stop delivery.

The frontend preserves owner-scoped drafts across session expiry and binds them
only after the server confirms the account. Switching accounts, explicit logout
or denied access clears private drafts. Confirmed saves refresh the teacher view;
failure of that secondary refresh does not turn a verified save into a failure.

`health.weeklyAutomation` reports configuration presence only. It does not
certify receipt-table permissions/schema or successful message delivery. Keep
real-account acceptance results and deployment identifiers in private operations
records. The mock tests do not send messages or alter production data.

## Empty-source preparation helper

`worker/prepare-weekly-consolidation.mjs` accepts a private release configuration
and explicitly supplied source/target table URLs, followed by `--plan` or `--apply`.
It snapshots sources outside the checkout and stops when human-entered content
requires a reviewed migration. It prepares compatible fields and a proposed
binding; it does not retire native forms, workflows, views or knowledge-base
entrypoints. Deployment remains a separate action.

## Save/history phase 1 (2026-09-08)

The existing five inputs and `WEEKLY_TABLE_ID` stay authoritative. This phase
adds no questionnaire, Feishu table, role, project grant, or feedback workflow.
It does not change the onboarding guide, course capabilities, finance actions,
weekly reminder recipients or scheduled digest logic.

- A SQLite Durable Object (`WEEKLY_WRITES`) serializes workbench saves for each
  table/person. Week-scoped receipts contain request IDs, content hashes and
  record IDs, never report text. Feishu remains the content store.
- Identical retries return the verified existing record. A differing save must
  present the revision that the editor originally loaded. A stale draft returns
  409 and stays in the browser; explicitly loading the saved record asks before
  replacing that draft. Existing clients without revision metadata can make
  first submissions but must refresh before editing a saved report.
- A remote timeout is ambiguous. The pending receipt survives runtime restart.
  A retry first reads the original request ID/content back; it never blindly
  creates another row. If the remote result remains unknown, submission stays
  blocked for that person's week and the draft remains available. Resolve the
  upstream outcome before any manual recovery; never delete a pending receipt
  merely because a timeout elapsed. This is not an exactly-once guarantee for
  direct native Feishu edits or externally created duplicate rows.
- `GET /api/reports/history` retrieves every source page, filters by the current
  identity and existing project policy, then returns 20 records per page with
  optional `year` and `week` filters. Counts and year options are filtered too.
  It does not read retired sources. The dashboard's 12-record preview and the
  teacher page's 8-record preview are unchanged.
- History shows the ISO week year, Monday–Sunday dates and latest saved time in
  Asia/Shanghai. It preserves the five content fields and existing feedback.
  This is a history of weekly records, not an archive of every same-week edit.

The first namespace migration establishes a rollback-compatible deployment of
the **currently deployed business code** plus an unused class export. Only after
that baseline passes core checks does `release.mjs` activate the new save path.
Later failures roll back to that compatible baseline, not across the class
migration. The Pages build waits for `weekly-save-history-v1` and a successful
coordinator storage probe. Reviewed Feishu bindings are fingerprint-checked
before and after deployment. Never remove the DO class/migration to roll back.

Tests cover concurrent first saves, stale edits, request replays, ambiguous
responses, durable-journal recovery, pagination and identity isolation, timezone
boundaries, draft recovery choices, and the actual workerd/SQLite binding. These
use synthetic local data; real-account submission acceptance remains separate.
