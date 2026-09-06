import assert from 'node:assert/strict';
import { buildStudentHome } from './src/v2/student-home.js';

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
