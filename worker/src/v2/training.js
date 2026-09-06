export const SUBMISSION_TEMPLATES = Object.freeze({
  TEXT_REFLECTION: 'TEXT_REFLECTION',
  CHECKLIST: 'CHECKLIST',
  QUIZ: 'QUIZ',
  EXPERIMENT_RECORD: 'EXPERIMENT_RECORD',
  SUMMARY: 'SUMMARY'
});

export function buildTrainingCatalog(records = []) {
  const courses = new Map();
  for (const record of records) {
    const fields = record?.fields || {};
    if (field(fields, '是否启用', '启用') === false) continue;
    const type = clean(field(fields, '类型')).toLowerCase();
    const courseId = clean(field(fields, 'CourseID', '课程ID'));
    if (!courseId) continue;

    if (!courses.has(courseId)) {
      courses.set(courseId, {
        courseId,
        title: clean(field(fields, '课程名称', '标题')) || courseId,
        track: clean(field(fields, 'Track', '课程方向')),
        description: clean(field(fields, '简介', '说明')),
        owner: clean(field(fields, '负责人', 'Owner')),
        order: number(field(fields, '排序')),
        version: clean(field(fields, '版本')) || '1',
        enabled: true,
        audienceCapabilities: arrayValue(field(fields, '适用能力', '可见能力')),
        lessons: []
      });
    }

    if (type === 'lesson' || clean(field(fields, 'LessonID', 'Lesson'))) {
      const lessonId = clean(field(fields, 'LessonID', 'Lesson'));
      if (!lessonId) continue;
      const course = courses.get(courseId);
      course.lessons.push({
        lessonId,
        title: clean(field(fields, '标题', 'Lesson标题')) || lessonId,
        contentUrl: clean(field(fields, '正文链接', '链接')),
        objective: clean(field(fields, '学习目标')),
        submissionTemplate: normalizeTemplate(field(fields, '提交模板类型')),
        submissionPrompt: clean(field(fields, '提交提示')),
        required: field(fields, '是否必修') !== false,
        order: number(field(fields, '排序')),
        version: clean(field(fields, '版本')) || '1',
        enabled: true
      });
    }
  }

  return [...courses.values()]
    .map((course) => ({
      ...course,
      lessons: course.lessons.sort(compareOrder)
    }))
    .sort(compareOrder);
}

export function visibleTrainingCatalog(catalog, capabilities = []) {
  const allowed = new Set(capabilities.map((value) => String(value || '').trim().toLowerCase()));
  return (catalog || []).filter((course) => {
    if (!course.audienceCapabilities?.length) return true;
    return course.audienceCapabilities.some((capability) => allowed.has(String(capability || '').trim().toLowerCase()));
  });
}

export function normalizeTemplate(value) {
  const key = clean(value).toUpperCase();
  return SUBMISSION_TEMPLATES[key] || SUBMISSION_TEMPLATES.TEXT_REFLECTION;
}

function compareOrder(a, b) {
  return (number(a.order) - number(b.order)) || String(a.title || a.courseId || a.lessonId || '').localeCompare(String(b.title || b.courseId || b.lessonId || ''), 'zh-CN');
}

function field(fields, ...names) {
  for (const name of names) {
    let value = fields?.[name];
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 1) value = value[0];
    if (value && typeof value === 'object') {
      if ('text' in value) value = value.text;
      else if ('name' in value) value = value.name;
      else if ('link' in value) value = value.link;
    }
    return value;
  }
  return '';
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.name || item?.text || '']).filter(Boolean);
  if (typeof value === 'string') return value.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return value ? [String(value)] : [];
}

function clean(value) {
  return String(value || '').trim();
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
