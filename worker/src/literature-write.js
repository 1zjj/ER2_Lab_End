// Match the documented text/date/URL variants without changing the live table.
export const LITERATURE_FIELDS = Object.freeze({
  '论文标题': [1], '请求ID': [1], '提交人OpenID': [1], '提交人姓名': [1],
  '提交人角色': [1], '周次': [1], '周序号': [2, 20],
  '阅读日期': [1, 5], '提交时间': [1, 5], '发表年份': [2, 1],
  '作者': [1], '会议或期刊': [1], 'DOI或arXiv': [1], '研究方向': [1],
  '阅读类型': [1, 3], '提交状态': [1, 3], '一句话贡献': [1],
  '核心问题': [1], '方法摘要': [1], '个人评价': [1], '与项目关系': [1],
  '论文链接': [1, 15], '阅读笔记链接': [1, 15], '论文附件链接': [1, 15]
});

export function literatureCompatibility(fields) {
  const missing = [], incompatible = [];
  for (const [name, types] of Object.entries(LITERATURE_FIELDS)) {
    const found = fields.filter(f => f.field_name === name);
    if (!found.length) missing.push(name);
    else if (found.length !== 1 || !types.includes(found[0].type)) incompatible.push(name);
  }
  return { ok: !missing.length && !incompatible.length, missing, incompatible };
}

export function literatureText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(literatureText).join('');
  if (typeof value === 'object') return literatureText(value.link ?? value.text ?? value.name ?? '');
  return String(value);
}

export function serializeLiterature(schema, values) {
  if (!literatureCompatibility(schema).ok) throw Object.assign(new Error('文献数据表字段不兼容'), {
    status: 503, code: 'LITERATURE_SCHEMA_MISMATCH'
  });
  const output = {};
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(LITERATURE_FIELDS, name)) throw new Error('Unexpected literature field');
    const spec = schema.find(f => f.field_name === name);
    if (spec.type === 20) continue; // A formula is owned by Feishu.
    if (value === '' || value == null) continue; // Empty URL/number/select values are omitted on create.
    if (spec.type === 15) output[name] = { text: String(value), link: String(value) };
    else if (spec.type === 5) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + 'T00:00:00+08:00' : value;
      const timestamp = Date.parse(date);
      if (!Number.isFinite(timestamp)) throw Object.assign(new Error('阅读日期不正确'), { status: 400 });
      output[name] = timestamp;
    } else output[name] = spec.type === 1 ? String(value) : value;
  }
  return output;
}

export function literatureMatches(record, expected) {
  if (!record?.record_id || !record.fields) return false;
  return Object.entries(expected).every(([name, value]) => {
    const actual = literatureText(record.fields[name]), wanted = literatureText(value);
    if (actual === wanted) return true;
    if (name.endsWith('链接')) {
      try { return new URL(actual).href === new URL(wanted).href; } catch (_) { return false; }
    }
    return false;
  });
}
