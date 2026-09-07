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

## Empty-source preparation helper

`worker/prepare-weekly-consolidation.mjs` accepts a private release configuration
and explicitly supplied source/target table URLs, followed by `--plan` or `--apply`.
It snapshots sources outside the checkout and stops when human-entered content
requires a reviewed migration. It prepares compatible fields and a proposed
binding; it does not retire native forms, workflows, views or knowledge-base
entrypoints. Deployment remains a separate action.
