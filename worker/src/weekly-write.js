// One contract for preflight and actual weekly-report writes.
export const WEEKLY_FIELDS = Object.freeze({
  '请求ID': [1], '飞书OpenID': [1], '姓名': [1], '周次': [1],
  '周序号': [2, 20], '周起始': [1, 5], '周结束': [1, 5],
  '本周完成与结果': [1], '学习与方法': [1], '证据链接': [1, 15],
  '问题与阻塞': [1], '下周计划': [1], '提交状态': [1, 3], '提交时间': [1, 5]
});

export function weeklyCompatibility(fields) {
  const missing = [], incompatible = [];
  for (const [name, types] of Object.entries(WEEKLY_FIELDS)) {
    const matches = fields.filter(f => f.field_name === name);
    if (!matches.length) missing.push(name);
    else if (matches.length !== 1 || !types.includes(matches[0].type)) incompatible.push(name);
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
  if (!check.ok) throw Object.assign(new Error('周报数据表字段尚未配置完整，请联系管理员'), { status: 503, weeklySchema: check });
  const output = {};
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(WEEKLY_FIELDS, name)) throw new Error('Unexpected weekly write field');
    const spec = fields.find(f => f.field_name === name);
    if (spec.type === 20 && name === '周序号') continue; // Computed by Feishu, never overwrite a formula.
    if (spec.type === 15) {
      const link = evidenceUrl(value);
      output[name] = link ? { text: link, link } : null;
    } else if (spec.type === 5) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + 'T00:00:00+08:00' : value;
      const timestamp = Date.parse(date);
      if (!Number.isFinite(timestamp)) throw new Error('Invalid weekly date');
      output[name] = timestamp;
    } else output[name] = value;
  }
  return output;
}
