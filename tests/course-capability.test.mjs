import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const ui = vm.createContext({ DEMO_MODE: false, state: { dashboard: { student: {} } },
  availableLink: () => '<a>打开学习中心</a>', courseUrl: () => 'https://docs.example/learning' });
vm.runInContext(app.slice(app.indexOf('  function courseSubmissionAvailable('), app.indexOf('  function renderCourseReviewPanel(')), ui);
assert.equal(ui.courseSubmissionAvailable(), false, 'An old backend without capabilities must fail closed');
assert.match(ui.renderCoursePanel(), /课程记录提交暂未开放/);
assert.doesNotMatch(ui.renderCoursePanel(), /data-course-lesson/);
ui.state.dashboard.capabilities = { courses: { submissionEnabled: false } };
assert.equal(ui.courseSubmissionAvailable(), false);
ui.state.dashboard.capabilities.courses.submissionEnabled = 'true';
assert.equal(ui.courseSubmissionAvailable(), false, 'String truthiness must not enable writes');
ui.state.dashboard.capabilities.courses.submissionEnabled = true;
assert.equal(ui.courseSubmissionAvailable(), true);
console.log('PASS course UI: old/unconfigured backend has learning links but no submission actions');
