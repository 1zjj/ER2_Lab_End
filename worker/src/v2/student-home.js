export function enrichStudentDashboard(dashboard = {}) {
  if (!dashboard?.student) return dashboard;
  return {
    ...dashboard,
    student: {
      ...dashboard.student,
      home: buildStudentHome(dashboard)
    }
  };
}

export function buildStudentHome(dashboard = {}) {
  const student = dashboard.student || {};
  const literature = dashboard.literature || {};
  const onboarding = normalizeOnboarding(student.onboarding);
  const report = normalizeReport(student.report, dashboard.week);
  const projects = normalizeProjects(student);
  const training = normalizeTraining(student.course, onboarding.completed);
  const reading = normalizeLiterature(literature);
  const todos = buildTodos({ student, report, training, reading, projects });

  return {
    version: 2,
    aiRequired: false,
    modules: {
      weeklyStatus: { visible: true, persistent: true },
      weeklyTodos: { visible: true, persistent: true },
      projects: { visible: projects.length > 0, persistent: false },
      training: { visible: training.visible, persistent: false },
      literature: { visible: true, persistent: true },
      onboarding: { visible: !onboarding.completed, persistent: false }
    },
    report,
    onboarding,
    projects,
    training,
    literature: reading,
    todos
  };
}

function normalizeOnboarding(value = {}) {
  const total = positiveInt(value.total, 5);
  const completedCount = Math.min(total, positiveInt(value.completedCount, Array.isArray(value.completedSteps) ? value.completedSteps.length : 0));
  return {
    completed: value.completed === true || completedCount >= total,
    completedCount,
    total,
    completedSteps: Array.isArray(value.completedSteps) ? value.completedSteps : []
  };
}

function normalizeReport(value = {}, week = {}) {
  return {
    status: value.status === 'submitted' ? 'submitted' : 'pending',
    label: value.status === 'submitted' ? '已提交' : '未提交',
    weekId: week.id || '',
    weekLabel: week.label || '',
    dueLabel: week.dueLabel || '周五 18:00 截止'
  };
}

function normalizeProjects(student = {}) {
  const source = Array.isArray(student.projects) ? student.projects : [student.project].filter(Boolean);
  return source.map((item, index) => ({
    projectId: text(item.projectId || item.id || item.code || `project-${index + 1}`),
    code: text(item.code),
    title: text(item.title),
    role: text(item.role || item.projectRole || '成员'),
    status: text(item.status || '进行中'),
    progress: percent(item.progress),
    nextTask: text(item.nextTask || item.milestone),
    blocker: text(item.blocker),
    url: text(item.url)
  })).filter((item) => item.title && !/暂未分配项目/.test(item.title));
}

function normalizeTraining(course = {}, onboardingCompleted = false) {
  const total = positiveInt(course.total, Array.isArray(course.lessons) ? course.lessons.length : 0);
  const completed = Math.min(total, positiveInt(course.completed, 0));
  const lessons = Array.isArray(course.lessons) ? course.lessons : [];
  const nextLesson = lessons.find((lesson) => lesson.status !== 'confirmed') || null;
  const finished = total > 0 && completed >= total;
  return {
    visible: onboardingCompleted && total > 0 && !finished,
    finished,
    id: text(course.id),
    title: text(course.title || '学习与培训'),
    completed,
    total,
    progress: total ? Math.round((completed / total) * 100) : 0,
    next: text(course.next || (nextLesson ? `Lesson ${nextLesson.lessonId} · ${nextLesson.lessonTitle}` : '')),
    nextLessonId: text(nextLesson?.lessonId),
    lessons
  };
}

function normalizeLiterature(value = {}) {
  const minimum = positiveInt(value.minimum, 3);
  const count = positiveInt(value.mineCount, 0);
  return {
    mineCount: count,
    minimum,
    completed: value.completed === true || count >= minimum,
    remaining: Math.max(0, minimum - count),
    items: Array.isArray(value.items) ? value.items : []
  };
}

function buildTodos({ student, report, training, reading }) {
  const todos = [];
  if (report.status !== 'submitted') {
    todos.push(todo('weekly-report', '周报', '提交本周工作记录', report.dueLabel, 100, 'report'));
  }
  if (training.visible && training.next) {
    todos.push(todo('training-next', '培训', `完成 ${training.next}`, '按培训计划完成', 80, 'training', training.nextLessonId));
  }
  if (!reading.completed) {
    todos.push(todo('literature-target', '文献', `本周还需完成 ${reading.remaining} 篇文献阅读`, `目标 ${reading.minimum} 篇`, 70, 'literature'));
  }

  const sourceTasks = Array.isArray(student.tasks) ? student.tasks : [];
  sourceTasks.forEach((item, index) => {
    const type = text(item.type || '任务');
    if (/周报/.test(type) || /课程|培训/.test(type)) return;
    todos.push(todo(
      text(item.taskId || item.id || `source-${index}`),
      type,
      text(item.title || '未命名任务'),
      text(item.dueLabel || item.deadline || item.detail),
      /项目/.test(type) ? 60 : 50,
      /项目/.test(type) ? 'project' : 'manual',
      text(item.projectId || item.projectCode)
    ));
  });

  return todos.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, 'zh-CN')).slice(0, 5);
}

function todo(id, type, title, detail, priority, action, target = '') {
  return { id, type, title, detail, priority, action, target };
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const percentValue = number > 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percentValue)));
}

function text(value) {
  return String(value || '').trim();
}
