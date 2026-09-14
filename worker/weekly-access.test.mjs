import assert from 'node:assert/strict';
import { owesWeekly, reviewsWeekly, canReadWeekly, shanghaiWeek, selectWeeklyTarget } from './src/weekly-access.js';
const person = (id, category, boundary, roles) => ({ sub: `ou_${id}`, personId: id, roles,
  grants: { 'PRJ-004': { access: 'edit' } }, memberRecord: { fields: {
    '成员类别': category, '人员边界': boundary, '人员状态': '在组', '是否启用': true } } });
const pi = person('P-001', 'PI', '团队内', ['teacher']);
const admin = person('P-002', 'RA', '团队内', ['student', 'teacher', 'manager']);
const external = person('P-006', '联合培养', '团队外', ['collaborator']);
const externalPi = person('P-005', 'PI', '团队外', ['collaborator']);
const env = { WEEKLY_REVIEWER_OPEN_ID: pi.sub,
  WEEKLY_START_DATES: JSON.stringify({ 'P-002': '2026-09-07', 'P-006': '2026-09-07' }) };
const before = JSON.stringify([pi, admin, external, externalPi]);
assert.equal(owesWeekly(pi), false);
assert.equal(owesWeekly(externalPi), false);
assert.equal(owesWeekly(external), true);
assert.equal(owesWeekly(admin), true);
assert.equal(reviewsWeekly(pi, env), true);
assert.equal(reviewsWeekly(pi, {}), false);
assert.equal(reviewsWeekly(admin, env), false);
assert.equal(reviewsWeekly(externalPi, env), false);
const own = { fields: { '飞书OpenID': external.sub } };
assert.equal(canReadWeekly(external, own, env), true);
assert.equal(canReadWeekly(pi, own, env), true);
assert.equal(canReadWeekly(admin, own, env), false);
assert.equal(canReadWeekly(externalPi, own, env), false);
const now = Date.parse('2026-09-14T12:00:00+08:00');
assert.equal(selectWeeklyTarget(external, env, '2026-W37', now).submissionType, '历史补交');
assert.equal(selectWeeklyTarget(external, env, '2026-W38', now).submissionType, '正常提交');
for (const id of ['2026-W36', '2026-W39', '2026-W99'])
  assert.throws(() => selectWeeklyTarget(external, env, id, now), /只能/);
assert.throws(() => selectWeeklyTarget(external, {}, '2026-W37', now), /尚未确认/);
assert.throws(() => selectWeeklyTarget(external, { ...env, WEEKLY_START_DATES: '{"P-006":"2026-09-14"}' }, '2026-W37', now), /起始周之前/);
assert.equal(shanghaiWeek(Date.parse('2026-09-13T23:59:59+08:00')).id, '2026-W37');
assert.equal(shanghaiWeek(Date.parse('2026-09-14T00:00:00+08:00')).id, '2026-W38');
assert.equal(shanghaiWeek(Date.parse('2027-01-01T00:00:00+08:00')).id, '2026-W53');
assert.equal(shanghaiWeek(Date.parse('2027-01-04T00:00:00+08:00')).id, '2027-W01');
assert.equal(JSON.stringify([pi, admin, external, externalPi]), before, 'No existing roles/grants mutated');
console.log('PASS weekly-only policy: external students, sole reviewer, previous-week window, explicit start, timezone and unchanged roles/grants');
