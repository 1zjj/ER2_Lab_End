import assert from 'node:assert/strict';
import { resolveTableBinding, bindingConfigured, summarizeAllBindings } from './src/v2/bindings.js';
import { capabilitiesFromMemberFields, canReviewCourses, canApproveBudgets, canHandleFinance, isAdmin } from './src/v2/capabilities.js';
import { validateSchema, SCHEMA_VERSION } from './src/v2/schema.js';
import { buildTrainingCatalog, visibleTrainingCatalog } from './src/v2/training.js';
import { buildV2Health } from './src/v2/health.js';
import { nextPersonId, validatePersonRecord, mayUseWorkbench } from './src/v2/personnel.js';

{
  const env = {
    MEMBERS_TABLE_ID: 'tbl-members',
    MEMBERS_BASE_APP_TOKEN: 'app-direct',
    WEEKLY_TABLE_ID: 'tbl-weekly',
    FEISHU_BASE_WIKI_TOKEN: 'wiki-legacy'
  };
  const members = resolveTableBinding(env, 'MEMBERS_TABLE_ID');
  assert.equal(members.source, 'MEMBERS_BASE_APP_TOKEN');
  assert.equal(members.legacy, false);
  assert.equal(bindingConfigured(members), true);
  const weekly = resolveTableBinding(env, 'WEEKLY_TABLE_ID');
  assert.equal(weekly.source, 'FEISHU_BASE_WIKI_TOKEN');
  assert.equal(weekly.legacy, true);
  assert.equal(resolveTableBinding({ ...env, LEGACY_GLOBAL_BASE_FALLBACK: 'false' }, 'WEEKLY_TABLE_ID').source, '');
}

{
  const fields = { 人员边界:'团队内', 成员类别:'硕士', 系统职责:['管理员','课程审核'] };
  const caps = capabilitiesFromMemberFields(fields);
  assert.ok(caps.includes('internal_member'));
  assert.ok(caps.includes('master'));
  assert.ok(caps.includes('admin'));
  assert.ok(caps.includes('course_reviewer'));
  assert.equal(isAdmin({ capabilities: caps }), true);
  assert.equal(canReviewCourses({ capabilities: caps }), true);
  assert.equal(canHandleFinance({ capabilities: caps }), false);
  assert.equal(canApproveBudgets({ capabilities: caps }), false);
}

{
  const schema = validateSchema('members', [
    '人员编号','姓名','飞书成员','人员边界','成员类别','人员状态','入组时间',
    '保密等级','培训状态','直属负责人','关联项目','系统职责'
  ]);
  assert.equal(schema.ok, true);
  assert.equal(schema.version, SCHEMA_VERSION);
  assert.ok(schema.missingRecommended.includes('飞书OpenID'));
  const broken = validateSchema('weekly', ['飞书OpenID', '姓名']);
  assert.equal(broken.ok, false);
  assert.ok(broken.missingRequired.includes('周次'));
}

{
  assert.equal(nextPersonId(['P-001','P-002','P-004']), 'P-003');
  const valid = validatePersonRecord({ fields: {
    人员编号:'P-004', 姓名:'孙世纪', 飞书成员:[{open_id:'ou-test'}], 人员边界:'团队内',
    成员类别:'博士', 人员状态:'在组', 入组时间:1, 保密等级:'内部', 培训状态:'已完成',
    直属负责人:['P-001'], 关联项目:[], 系统职责:['财务']
  }});
  assert.equal(valid.ok, true);
  assert.equal(canHandleFinance({ capabilities: valid.person.capabilities }), true);
  assert.equal(mayUseWorkbench(valid.person, true), true);
  assert.equal(mayUseWorkbench(valid.person, false), false);
}

{
  const records = [
    { fields: { CourseID:'NAV', 课程名称:'语义导航', 类型:'course', Track:'A', 排序:2, 是否启用:true, 适用能力:['student'] } },
    { fields: { CourseID:'NAV', 课程名称:'语义导航', 类型:'lesson', LessonID:'L02', 标题:'TF', 排序:2, 是否启用:true, 提交模板类型:'experiment_record' } },
    { fields: { CourseID:'NAV', 课程名称:'语义导航', 类型:'lesson', LessonID:'L01', 标题:'ROS', 排序:1, 是否启用:true, 提交模板类型:'text_reflection' } },
    { fields: { CourseID:'OPS', 课程名称:'操作', 类型:'course', 排序:1, 是否启用:false } }
  ];
  const catalog = buildTrainingCatalog(records);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].courseId, 'NAV');
  assert.deepEqual(catalog[0].lessons.map(x => x.lessonId), ['L01','L02']);
  assert.equal(visibleTrainingCatalog(catalog, ['student']).length, 1);
  assert.equal(visibleTrainingCatalog(catalog, ['teacher']).length, 0);
}

{
  const health = buildV2Health({
    MEMBERS_TABLE_ID:'members', MEMBERS_BASE_APP_TOKEN:'base1',
    WEEKLY_TABLE_ID:'weekly', FEISHU_BASE_WIKI_TOKEN:'legacy'
  });
  assert.equal(health.mode, 'shadow');
  assert.equal(health.productionCutover, false);
  assert.equal(health.writesEnabled, false);
  assert.equal(health.bindings.MEMBERS_TABLE_ID.legacyFallback, false);
  assert.equal(health.bindings.WEEKLY_TABLE_ID.legacyFallback, true);
  assert.ok(Object.keys(summarizeAllBindings({})).length > 0);
}

console.log('V2 stabilization tests passed');
