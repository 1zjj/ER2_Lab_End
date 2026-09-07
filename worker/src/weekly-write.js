// One contract for preflight and actual weekly-report writes.
export const WEEKLY_FIELDS = Object.freeze({
  '请求ID': [1], '飞书OpenID': [1], '姓名': [1], '周次': [1],
  '周序号': [2, 20], '周起始': [1, 5], '周结束': [1, 5],
  '本周完成与结果': [1], '学习与方法': [1], '证据链接': [1, 15],
  '问题与阻塞': [1], '下周计划': [1], '提交状态': [1, 3], '提交时间': [1, 5]
});

export const WEEKLY_VERSION = 'weekly-five-fields-v1';
// First name is the approved questionnaire label. Remaining names are read/write
// compatibility for existing tables during migration, never new columns to create.
export const WEEKLY_NAMES = Object.freeze({
  '本周完成与结果': ['本周完成与结果', '本周完成了什么', '本周进展'],
  '学习与方法': ['学习与方法', '关联学习内容／培训进展（可不填）'],
  '证据链接': ['产出（若有阶段性成果，可以提交文档链接）', '产出与证据（文档、代码、截图或数据链接）', '证据链接'],
  '问题与阻塞': ['当前问题与阻塞', '问题与阻塞', '问题与需要协助', '风险阻塞'],
  '下周计划': ['下周计划', '下周承诺']
});

function column(fields, name) {
  for (const alias of WEEKLY_NAMES[name] || [name]) {
    const found = fields.filter(f => f.field_name === alias);
    if (found.length) return found.length === 1 ? found[0] : null;
  }
}

export function weeklyText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(weeklyText).join('');
  if (typeof value === 'object') return weeklyText(value.link ?? value.text ?? '');
  return String(value);
}

export function weeklyValues(record) {
  const read = name => {
    for (const alias of WEEKLY_NAMES[name] || [name]) {
      const value = weeklyText(record?.fields?.[alias]);
      if (value.trim()) return value;
    }
    return '';
  };
  return { progress: read('本周完成与结果'), learning: read('学习与方法'),
    evidence: read('证据链接'), blockers: read('问题与阻塞'), nextPlan: read('下周计划') };
}

export function evidenceText(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 5000) throw new Error('产出内容请控制在 5000 字以内');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('产出内容包含无效控制字符');
  return value.trim();
}

export function weeklyCompatibility(fields) {
  const missing = [], incompatible = [];
  for (const [name, types] of Object.entries(WEEKLY_FIELDS)) {
    const match = column(fields, name);
    if (match === undefined) missing.push((WEEKLY_NAMES[name] || [name])[0]);
    else if (!match || !types.includes(match.type)) incompatible.push((WEEKLY_NAMES[name] || [name])[0]);
  }
  return { ok: !missing.length && !incompatible.length, missing, incompatible };
}

export function evidenceUrl(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096) throw new Error('请填写完整的网页链接');
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url;
  try { url = new URL(trimmed); } catch (_) { throw new Error('请填写以 http:// 或 https:// 开头的完整网页链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\u0000-\u0020]/.test(trimmed)) {
    throw new Error('请填写有效的 HTTP 或 HTTPS 网页链接');
  }
  return url.href;
}

export function serializeWeekly(fields, values) {
  const check = weeklyCompatibility(fields);
  if (!check.ok) throw Object.assign(new Error('周报数据表字段尚未配置完整，请联系管理员'), { status: 503, code: 'WEEKLY_SCHEMA_MISMATCH', weeklySchema: check });
  const output = {};
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(WEEKLY_FIELDS, name)) throw new Error('Unexpected weekly write field');
    const spec = column(fields, name);
    if (spec.type === 20 && name === '周序号') continue; // Computed by Feishu, never overwrite a formula.
    if (spec.type === 15) {
      let link;
      try { link = evidenceUrl(value); }
      catch (_) { throw Object.assign(new Error('周报产出字段仍是旧的单链接类型，需改为文本后才能保存说明和多个链接'), { status: 503, code: 'WEEKLY_EVIDENCE_COLUMN_TYPE' }); }
      output[spec.field_name] = link ? { text: link, link } : null;
    } else if (spec.type === 5) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + 'T00:00:00+08:00' : value;
      const timestamp = Date.parse(date);
      if (!Number.isFinite(timestamp)) throw new Error('Invalid weekly date');
      output[spec.field_name] = timestamp;
    } else output[spec.field_name] = value;
  }
  return output;
}

// Hyperlink columns canonicalize URL spelling; text columns preserve the content.
export function weeklyMatches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    if (actual[key] === value) return true;
    if (key !== 'evidence') return false;
    try { return evidenceUrl(value) === actual.evidence; } catch (_) { return false; }
  });
}
