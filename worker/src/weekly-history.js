import { weeklyText, weeklyValues } from './weekly-write.js';

export async function weeklyHash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function weeklyRevision(record) {
  return record ? weeklyHash([record.record_id, weeklyText(record.fields?.['请求ID']),
    weeklyText(record.fields?.['提交状态']), weeklyValues(record)]) : Promise.resolve('');
}

export function weeklyDates(record) {
  const f = record.fields || {};
  const weekId = weeklyText(f['周次'] ?? f.WeekID);
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  const dateText = value => {
    if (!value) return '';
    const text = weeklyText(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(typeof value === 'number' ? value : text);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date) : '';
  };
  let weekStart = dateText(f['周起始']), weekEnd = dateText(f['周结束']);
  if (match && (!weekStart || !weekEnd)) {
    const monday = new Date(Date.UTC(Number(match[1]), 0, 4));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1 + (Number(match[2]) - 1) * 7);
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    weekStart ||= monday.toISOString().slice(0, 10); weekEnd ||= sunday.toISOString().slice(0, 10);
  }
  const submitted = f['提交时间'];
  const date = new Date(typeof submitted === 'number' ? submitted : weeklyText(submitted));
  const savedAt = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date) : '';
  return { weekStart, weekEnd, savedAt, weekLabel: match
    ? `${match[1]}年 · 第${Number(match[2])}周${weekStart && weekEnd ? '｜' + weekStart + '—' + weekEnd : ''}` : weekId };
}

// Input records have already been filtered by current identity/project access.
export function historyPage(records, search) {
  const rawPage = search.get('page') || '1', year = search.get('year') || '', week = search.get('week') || '';
  if (!/^[1-9]\d{0,5}$/.test(rawPage) || (year && !/^\d{4}$/.test(year)) ||
      (week && (!/^\d{1,2}$/.test(week) || Number(week) < 1 || Number(week) > 53)))
    throw Object.assign(new Error('请选择有效的年份、周次或页码'), { status: 400 });
  const key = r => weeklyText(r.fields?.['周次'] ?? r.fields?.WeekID);
  const years = [...new Set(records.map(key).filter(k => /^\d{4}-W\d{2}$/.test(k)).map(k => k.slice(0, 4)))].sort().reverse();
  const filtered = records.filter(r => (!year || key(r).slice(0, 4) === year) && (!week || key(r).slice(-2) === week.padStart(2, '0')))
    .sort((a, b) => key(b).localeCompare(key(a)) || String(a.record_id).localeCompare(String(b.record_id)));
  const pageSize = 20, total = filtered.length, pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Number(rawPage), pages);
  return { records: filtered.slice((page - 1) * pageSize, page * pageSize), total, page, pages, pageSize, years };
}
