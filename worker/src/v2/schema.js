export const SCHEMA_VERSION = 2;

export const SCHEMAS = Object.freeze({
  members: {
    tableBinding: 'MEMBERS_TABLE_ID',
    required: ['姓名', '飞书OpenID', '是否启用'],
    recommended: ['PersonID', '角色', '功能权限', '负责教师OpenID', '默认项目', '加入日期', '离组日期']
  },
  weekly: {
    tableBinding: 'WEEKLY_TABLE_ID',
    required: ['飞书OpenID', '姓名', '周次', '本周完成与结果', '下周计划', '提交时间'],
    recommended: ['周序号', '周起始', '周结束', '学习与方法', '问题与阻塞', '证据链接', '请求ID', '审核状态', '教师反馈']
  },
  projects: {
    tableBinding: 'PROJECTS_TABLE_ID',
    required: ['项目编号', '项目名称', '状态'],
    recommended: ['ProjectID', '项目负责人', '开始日期', '结束日期', '简介', '项目主页', '是否启用']
  },
  projectMembers: {
    tableBinding: 'PROJECT_MEMBERS_TABLE_ID',
    required: ['ProjectID', 'PersonID'],
    recommended: ['项目角色', '加入日期', '退出日期', '是否启用']
  },
  trainingCatalog: {
    tableBinding: 'TRAINING_CATALOG_TABLE_ID',
    required: ['CourseID', '课程名称', '类型', '排序', '是否启用'],
    recommended: ['LessonID', 'Track', '标题', '正文链接', '学习目标', '提交模板类型', '提交提示', '是否必修', '版本', '适用能力']
  },
  courseSubmissions: {
    tableBinding: 'COURSES_TABLE_ID',
    required: ['飞书OpenID', 'Lesson', '状态'],
    recommended: ['CourseID', 'LessonID', '姓名', '核心收获', '问题与处理', '课程总结', '其他', '提交时间', '确认时间', '确认说明', '请求ID', 'revision']
  },
  links: {
    tableBinding: 'LINKS_TABLE_ID',
    required: ['标题', '链接', '是否启用'],
    recommended: ['EntryID', '父级EntryID', '分类', '副标题', '关键词', '可见能力', '排序']
  },
  knowledgeIndex: {
    tableBinding: 'KNOWLEDGE_INDEX_TABLE_ID',
    required: ['标题', '正式页面链接', '状态'],
    recommended: ['KnowledgeID', '分类', '关键词', '设备或软件', 'Owner', '发布日期', '复查日期', '可见能力']
  },
  literature: {
    tableBinding: 'LITERATURE_TABLE_ID',
    required: ['论文标题', '提交人OpenID', '周次'],
    recommended: ['提交人姓名', '作者', '会议或期刊', '发表年份', '论文链接', '阅读笔记链接', '请求ID']
  }
});

export function validateSchema(schemaKey, fieldNames = []) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) return { ok: false, schemaKey, error: 'unknown_schema', missingRequired: [], missingRecommended: [] };
  const available = new Set(fieldNames.map((name) => String(name || '').trim()).filter(Boolean));
  const missingRequired = schema.required.filter((name) => !available.has(name));
  const missingRecommended = schema.recommended.filter((name) => !available.has(name));
  return {
    ok: missingRequired.length === 0,
    schemaKey,
    version: SCHEMA_VERSION,
    tableBinding: schema.tableBinding,
    missingRequired,
    missingRecommended
  };
}

export function schemaSummary() {
  return Object.fromEntries(Object.entries(SCHEMAS).map(([key, schema]) => [key, {
    tableBinding: schema.tableBinding,
    requiredCount: schema.required.length,
    recommendedCount: schema.recommended.length
  }]));
}
