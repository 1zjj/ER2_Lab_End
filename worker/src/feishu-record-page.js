// Accept the explicit first-page empty envelope returned by Feishu, while
// refusing missing records on later/nonempty pages and incomplete pagination.
export function recordPage(result, previousPage = '', recordsRead = 0) {
  const data = result?.data;
  const empty = result?.code === 0 && data?.total === 0 && data.has_more === false &&
    data.items == null && !data.page_token && !previousPage && recordsRead === 0;
  if (!Array.isArray(data?.items) && !empty)
    throw Object.assign(new Error('数据表返回格式异常'), { status: 502 });
  if (data.has_more != null && typeof data.has_more !== 'boolean')
    throw Object.assign(new Error('数据表分页标志异常'), { status: 502 });
  if (data.has_more === true && (typeof data.page_token !== 'string' || !data.page_token))
    throw Object.assign(new Error('数据表分页不完整'), { status: 502 });
  return { items: empty ? [] : data.items, next: data.has_more === true ? data.page_token : '' };
}
