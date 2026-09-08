import assert from 'node:assert/strict';
import { buildStudentHome } from './src/v2/student-home.js';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

{
  const home = buildStudentHome({
    week: { id:'2026-W36', label:'第36周', dueLabel:'周五 18:00 截止' },
    student: {
      onboarding: { completed:true, completedCount:5, total:5, completedSteps:['a','b','c','d','e'] },
      report: { status:'pending' },
      course: {
        id:'track-a', title:'Track A｜感知与语义导航', completed:3, total:10,
        lessons:[
          { lessonId:'01', lessonTitle:'A', status:'confirmed' },
          { lessonId:'04', lessonTitle:'传感器原始数据', status:'pending' }
        ]
      },
      projects:[
        { code:'P01', title:'PatchNav', role:'负责人', status:'进行中', nextTask:'参数对照' },
        { code:'P02', title:'ReKep', role:'成员', status:'进行中', nextTask:'关键点测试' }
      ],
      tasks:[{ title:'PatchNav 本周实验', detail:'周五前', type:'项目', projectCode:'P01' }]
    },
    literature: { mineCount:1, minimum:3, items:[] }
  });
  assert.equal(home.aiRequired, false);
  assert.equal(home.modules.weeklyStatus.visible, true);
  assert.equal(home.modules.weeklyTodos.visible, true);
  assert.equal(home.modules.literature.visible, true);
  assert.equal(home.modules.onboarding.visible, false);
  assert.equal(home.modules.training.visible, true);
  assert.equal(home.modules.projects.visible, true);
  assert.equal(home.projects.length, 2);
  assert.ok(home.todos.some((item) => item.action === 'report'));
  assert.ok(home.todos.some((item) => item.action === 'training'));
  assert.ok(home.todos.some((item) => item.action === 'literature'));
  assert.ok(home.todos.some((item) => item.action === 'project'));
}

{
  const completedTraining = buildStudentHome({
    week:{},
    student:{
      onboarding:{ completed:true, completedCount:5, total:5 },
      report:{ status:'submitted' },
      course:{ completed:10, total:10, lessons:[] },
      project:{ title:'暂未分配项目' },
      tasks:[]
    },
    literature:{ mineCount:3, minimum:3 }
  });
  assert.equal(completedTraining.modules.training.visible, false);
  assert.equal(completedTraining.modules.projects.visible, false);
  assert.equal(completedTraining.modules.literature.visible, true);
  assert.equal(completedTraining.todos.length, 0);
}

{
  const newcomer = buildStudentHome({
    week:{},
    student:{
      onboarding:{ completed:false, completedCount:2, total:5 },
      report:{ status:'pending' },
      course:{ completed:0, total:10, lessons:[{lessonId:'01', lessonTitle:'仿真', status:'pending'}] },
      tasks:[]
    },
    literature:{ mineCount:0, minimum:3 }
  });
  assert.equal(newcomer.modules.onboarding.visible, true);
  assert.equal(newcomer.modules.training.visible, false);
}

console.log('Student home V2 tests passed');

// Exercise the actual project card and the existing homepage enhancer together.
// The enhancer must not replace fresh, permission-filtered links with older data.
{
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const dom = new JSDOM('<main id="app-root"><section class="welcome"><p class="kicker">STUDENT WORKSPACE</p></section><div id="projects"></div><section class="panel learning-card">学习中心原文</section><section class="panel finance-card">预算与报销原文</section></main>', { url: 'https://portal.example/', runScripts: 'outside-only' });
  const w = dom.window;
  w.state = { dashboard: { student: { projects: [] } } };
  w.eval(extract('  function escapeHtml(', '  function safeUrl('));
  w.eval(extract('  function projectHomepageUrl(', '  function renderStudent('));
  const slot = w.document.querySelector('#projects');
  const render = (projects, moduleErrors = {}) => {
    w.state.dashboard = { student: { projects }, moduleErrors };
    slot.innerHTML = w.renderProjectCard();
  };
  const projects = [4, 2, 3, 1].map(i => ({ code: 'PRJ-00' + i, title: '测试项目' + i, permission: i === 1 ? 1 : 2, url: 'https://lcnywl4yrecr.feishu.cn/wiki/TestProject' + i, progress: 50, blocker: '旧阻塞信息' }));
  render(projects);
  assert.equal(slot.querySelectorAll('a').length, 4);
  assert.match(slot.textContent, /4 个项目/);
  assert.deepEqual([...slot.querySelectorAll('a')].map(a => a.href), [1, 2, 3, 4].map(i => 'https://lcnywl4yrecr.feishu.cn/wiki/TestProject' + i));
  assert.ok([...slot.querySelectorAll('a')].every(a => a.target === '_blank' && a.rel === 'noopener noreferrer'));
  assert.equal(slot.querySelector('[role="progressbar"]'), null);
  assert.doesNotMatch(slot.textContent, /旧阻塞信息|进行中|活跃项目/);
  w.eval(readFileSync(new URL('../config.js', import.meta.url), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.dispatchEvent(new w.CustomEvent('er2-dashboard-rendered', { detail: { role: 'student', home: { aiRequired: false, modules: { projects: { visible: true } }, projects: [{ code: 'PRJ-999', title: '过时项目', url: 'https://evil.example' }] } } }));
  assert.equal(slot.querySelectorAll('a').length, 4);
  assert.doesNotMatch(slot.textContent, /过时项目/);
  render([{ ...projects[0], permission: 0 }, { ...projects[1], url: '' }]);
  assert.equal(slot.querySelectorAll('article').length, 1);
  assert.equal(slot.querySelectorAll('a').length, 0);
  assert.match(slot.textContent, /项目入口待配置/);
  render([{ ...projects[0], title: '<img src=x onerror=alert(1)>', url: 'https://evil.example' }]);
  assert.equal(slot.querySelector('img'), null);
  assert.equal(slot.querySelector('a'), null);
  for (const url of ['javascript:alert(1)', 'https://lcnywl4yrecr.feishu.cn.evil.example/wiki/Test', 'https://user@lcnywl4yrecr.feishu.cn/wiki/Test', 'https://lcnywl4yrecr.feishu.cn/docx/Test']) {
    render([{ ...projects[0], url }]); assert.equal(slot.querySelector('a'), null);
  }
  render(projects, { projects: '读取失败' });
  assert.equal(slot.querySelector('a'), null);
  assert.match(slot.textContent, /项目暂时无法读取/);
  assert.doesNotMatch(slot.textContent, /暂无已授权项目/);
  render([]);
  assert.equal(slot.querySelector('a'), null);
  assert.match(slot.textContent, /暂无已授权项目/);
  assert.equal(w.document.querySelector('.learning-card').textContent, '学习中心原文');
  assert.equal(w.document.querySelector('.finance-card').textContent, '预算与报销原文');
  dom.window.close();
}
console.log('PASS project entry UI: all authorized links, new tabs, stale enhancer isolation, empty/error states and safe URLs');
