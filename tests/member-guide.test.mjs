import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const storeCode = readFileSync(new URL('../guide-store.js', import.meta.url), 'utf8');
const entries = new Map();
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
const ctx = vm.createContext({});
vm.runInContext(storeCode, ctx);
const steps = ['workbench', 'rules', 'environment', 'learning', 'weekly'];
const make = (namespace = 'production', provider = () => storage) => ctx.ER2GuideStore.create({ namespace, steps, storage: provider });
const guide = make();
assert.equal(guide.setStep('rules', true), false, 'Unverified identity cannot save progress');
guide.bind('account-a');
guide.setStep('rules', true);
assert.equal(guide.read().completedCount, 1, 'One acknowledgement cannot complete all five');
assert.deepEqual(Array.from(guide.read().completedSteps), ['rules']);
assert.equal(guide.setStep('personnel-status', true), false);
assert.equal(guide.setStep('weekly', 'true'), false);
const reloaded = make(); reloaded.bind('account-a');
assert.equal(reloaded.read().completedCount, 1, 'Same browser and account retain progress');
reloaded.bind('account-b');
assert.equal(reloaded.read().completedCount, 0, 'Another account starts independently');
reloaded.setStep('weekly', true);
reloaded.bind('account-a');
assert.deepEqual(Array.from(reloaded.read().completedSteps), ['rules']);
const otherEnvironment = make('staging'); otherEnvironment.bind('account-a');
assert.equal(otherEnvironment.read().completedCount, 0);

// Two tabs updating different items must not replace each other's whole list.
reloaded.setStep('workbench', true);
guide.setStep('environment', true);
assert.equal(reloaded.read().completedCount, 3);
assert.equal(guide.read().completedCount, 3);
guide.skip();
assert.equal(guide.read().skipped, true);
assert.equal(guide.read().completed, false, 'Skipping is not an acknowledgement of unread items');
guide.setStep('rules', false);
assert.equal(guide.read().skipped, false, 'Undo returns the homepage to the guide');
for (const step of steps) guide.setStep(step, true);
assert.equal(guide.read().completed, true);
assert.equal(guide.ownsStorageKey([...entries.keys()][0]), true);
guide.bind('');
assert.equal(guide.read().completedCount, 0);
assert.equal(guide.skip(), false);
assert.equal(guide.ownsStorageKey(null), false);

const blocked = make('private-mode', () => { throw new Error('Storage denied'); });
blocked.bind('account-a');
blocked.setStep('rules', true);
assert.equal(blocked.read().completedCount, 1);
assert.equal(blocked.read().persistent, false, 'Storage failure must be visible without blocking the guide');
blocked.bind('account-b'); assert.equal(blocked.read().completedCount, 0);
blocked.bind('account-a'); assert.equal(blocked.read().completedCount, 1);

// Exercise the actual UI handlers with no network or Feishu persistence available.
const effects = [];
const coursePanel = { hidden: true, scrollIntoView() { effects.push('learning'); } };
const element = () => ({ innerHTML: '', textContent: '', className: '', setAttribute() {},
  querySelectorAll() { return []; }, querySelector() { return { style: {}, addEventListener() {}, focus() {} }; } });
const uiStore = make('ui'); uiStore.bind('account-a');
const dashboard = { profile: { roles: ['student'], sub: 'account-a', status: '在组' },
  student: { onboarding: { completed: true, completedSteps: steps }, course: { completed: 0 } } };
const snapshot = JSON.stringify(dashboard);
const ui = vm.createContext({ memberGuide: uiStore, state: { dashboard, activeRole: 'student', learningCenterOpen: false },
  elements: { onboardingDialog: { open: true }, onboardingChecklist: element(), onboardingProgressLabel: element(),
    onboardingProgressHint: element(), onboardingProgressTrack: element(), onboardingCourseEntry: element(),
    onboardingSaveStatus: element(), app: { querySelector: () => coursePanel } },
  escapeHtml: value => String(value), renderActiveView() { effects.push('render'); },
  closeDialog(dialog) { dialog.open = false; }, showDialog(dialog) { dialog.open = true; }, showToast() {}, openReportDialog() {},
  request() { throw new Error('Guide must not send any backend request'); } });
vm.runInContext(app.slice(app.indexOf('  const onboardingSteps ='), app.indexOf('\n  const elements =')), ui);
vm.runInContext(app.slice(app.indexOf('  function onboardingData('), app.indexOf('  function renderCoursePanel(')), ui);
assert.equal(ui.onboardingData().completedCount, 0, 'Ignore old server onboarding flags');
ui.openLearningCenter();
assert.equal(coursePanel.hidden, false, 'Learning is available before acknowledging the guide');
ui.acknowledgeGuideStep('rules');
assert.equal(ui.onboardingData().completedCount, 1);
assert.equal((ui.elements.onboardingChecklist.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
assert.equal((ui.elements.onboardingChecklist.innerHTML.match(/aria-pressed="false"/g) || []).length, 4);
assert.ok(!ui.elements.onboardingChecklist.innerHTML.includes('disabled'));
ui.skipMemberGuide();
assert.equal(ui.onboardingData().completedCount, 1);
assert.match(ui.renderOnboardingEntry(), /入组说明/);
assert.match(ui.renderOnboardingEntry(), /onboarding-shortcut/);
ui.acknowledgeGuideStep('rules');
assert.equal(ui.onboardingData().completedCount, 0);
assert.match(ui.renderOnboardingEntry(), /查看指南/);
for (const step of steps) ui.acknowledgeGuideStep(step);
assert.equal(ui.onboardingData().completed, true);
assert.equal(ui.elements.onboardingDialog.open, false);
assert.match(ui.renderOnboardingEntry(), /入组说明/);
assert.equal(JSON.stringify(dashboard), snapshot, 'Acknowledgements cannot mutate personnel, training or server state');
ui.state.activeRole = 'teacher'; coursePanel.hidden = true; ui.openLearningCenter();
assert.equal(coursePanel.hidden, true, 'Guide cannot switch role or bypass access');
ui.state.dashboard = null; ui.acknowledgeGuideStep('rules');
assert.equal(uiStore.read().completedCount, 5, 'No guide mutation after session invalidation');

entries.clear();
guide.bind('account-a'); assert.equal(guide.read().completedCount, 0, 'Clearing browser data resets the guide');
console.log('PASS member guide: independent steps, undo, reload, accounts, environments, tabs and denied storage');
console.log('PASS member guide UI: no backend writes, skip without fake completion, learning entry and retained guide');

vm.runInContext(app.slice(app.indexOf('  function studentHomeView('), app.indexOf('  function renderActiveView(')), ui);
const oldHome = { report: { status: 'pending', dueLabel: '周五截止' },
  todos: [{ action: 'report' }, { action: 'literature' }], aiRequired: false };
const updatedHome = ui.studentHomeView({ home: oldHome, report: { status: 'submitted' } });
assert.equal(updatedHome.report.status, 'submitted');
assert.equal(updatedHome.report.dueLabel, '周五截止');
assert.deepEqual(Array.from(updatedHome.todos, item => item.action), ['literature']);
assert.equal(oldHome.report.status, 'pending', 'Rendering must not mutate the stored dashboard');
assert.equal(ui.studentHomeView({ report: { status: 'submitted' } }), null);
console.log('PASS homepage rendering: confirmed weekly status takes precedence over an older home summary');
