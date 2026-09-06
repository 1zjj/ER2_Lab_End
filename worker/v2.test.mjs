import assert from 'node:assert/strict';
import { resolveTableBinding, bindingConfigured, summarizeAllBindings } from './src/v2/bindings.js';
import { normalizeCapabilities, canReviewCourses, canApproveBudgets, canHandleFinance } from './src/v2/capabilities.js';
import { validateSchema, SCHEMA_VERSION } from './src/v2/schema.js';
import { buildTrainingCatalog, visibleTrainingCatalog } from './src/v2/training.js';
import { buildV2Health } from './src/v2/health.js';

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
  const caps = normalizeCapabilities(['finance', 'course_reviewer'], ['学生']);
  assert.deepEqual(new Set(caps), new Set(['finance', 'course_reviewer', 'student']));
  assert.equal(canHandleFinance({ capabilities: caps }), true);
  assert.equal(canReviewCourses({ capabilities: caps }), true);
  assert.equal(canApproveBudgets({ capabilities: caps }), false);
  assert.equal(canApproveBudgets({ capabilities: ['admin'] }), true);
}

{
  const schema = validateSchema('members', ['姓名', '飞书OpenID', '是否启用']);
  assert.equal(schema.ok, true);
  assert.equal(schema.version, SCHEMA_VERSION);
  assert.ok(schema.missingRecommended.includes('PersonID'));
  const broken = validateSchema('weekly', ['飞书OpenID', '姓名']);
  assert.equal(broken.ok, false);
  assert.ok(broken.missingRequired.includes('周次'));
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
