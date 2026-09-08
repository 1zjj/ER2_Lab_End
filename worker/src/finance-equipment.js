import { authError } from './authorization.js';
import { DEVICE_FIELDS, EQUIPMENT, SOURCE, devicePayload } from './finance-policy.js';

export const COPY_FIELDS = DEVICE_FIELDS.filter(name => name !== '父记录');
export const financeReady = settings => Boolean(settings?.ready && settings.equipmentBinding &&
  settings.equipmentVerified?.wiki === settings.equipmentBinding.wiki &&
  settings.equipmentVerified?.table === settings.equipmentBinding.table);

export function equipmentBinding(url) {
  let value; try { value = new URL(url); } catch (_) { throw authError(400, '请填写设备档案表的完整飞书链接'); }
  const wiki = value.pathname.match(/^\/wiki\/([A-Za-z0-9]+)$/)?.[1], table = value.searchParams.get('table');
  if (value.protocol !== 'https:' || !value.hostname.endsWith('.feishu.cn') || !wiki || !/^tbl[A-Za-z0-9]+$/.test(table || '') || [SOURCE.wiki, EQUIPMENT.wiki].includes(wiki))
    throw authError(400, '请选择ER2中的新设备副本，链接须包含具体数据表');
  return { wiki, table };
}

const text = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : v.text || '').join('') : String(value ?? '');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const stringify = value => JSON.stringify(stable(value));
function schema(field) {
  const property = {};
  for (const key of ['formatter', 'date_formatter', 'multiple', 'currency_code']) if (field.property?.[key] !== undefined) property[key] = field.property[key];
  if (field.type === 3) property.options = (field.property?.options || []).map(o => ({ name: o.name || '', color: o.color ?? null }));
  return { name: field.field_name, type: field.type, primary: Boolean(field.is_primary), ui: field.ui_type || '', property };
}
function valueForCopy(value, type) {
  if (type === 1) return text(value);
  if (type === 11) return (value || []).map(v => v.id).sort();
  if (type === 17) return (value || []).map(v => ({ name: v.name, size: v.size })).sort((a,b) => stringify(a).localeCompare(stringify(b)));
  if (value == null) return null;
  return value;
}
export async function copyDigest(snapshot) {
  const normalized = { fields: snapshot.fields.map(schema), records: snapshot.records.map(r => stringify(snapshot.fields.map(f => valueForCopy(r.fields?.[f.field_name], f.type)))).sort() };
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stringify(normalized))))].map(v => v.toString(16).padStart(2,'0')).join('');
}
export function validateEquipmentSchema(fields, owner) {
  if (fields.length !== COPY_FIELDS.length || COPY_FIELDS.some((name, i) => fields[i]?.field_name !== name)) throw authError(409, '设备副本须保留原12个字段及顺序，且不含父记录');
  const types = [1,3,3,1,17,1,2,1,5,3,1,11];
  if (fields.some((f,i) => f.type !== types[i]) || fields.filter(f => f.is_primary).length !== 1 || !fields[0].is_primary) throw authError(409, '设备字段类型或名称索引不匹配');
  devicePayload({name:'字段核验',quantity:'1',unitPrice:'1.00',purchaseDate:'2026-01-01'}, owner, fields);
}
export async function verifyEquipmentCopy(service, owner) {
  const source = await service.sourceSnapshot();
  const target = await service.snapshot(service.equipment.obj_token, service.target.table);
  validateEquipmentSchema(target.fields, owner);
  const expected = {...source, fields: source.fields.filter(f => f.field_name !== '父记录')};
  if (!source.records.length || source.fields.length !== 13 || source.records.length !== target.records.length || await copyDigest(expected) !== await copyDigest(target))
    throw authError(409, '设备副本与来源的字段、记录或图片信息不一致，未切换设备绑定');
  const sourceTokens = new Set(source.records.flatMap(r => r.fields['图片'] || []).map(a => a.file_token));
  const images = target.records.flatMap(r => r.fields['图片'] || []);
  if (images.some(a => !a.file_token || sourceTokens.has(a.file_token))) throw authError(409, '设备图片尚未形成独立副本');
  return { wiki: service.target.wiki, table: service.target.table, app: target.app, count: target.records.length, images: images.length, fields: target.fields.length, digest: await copyDigest(target), verifiedAt: new Date().toISOString() };
}
