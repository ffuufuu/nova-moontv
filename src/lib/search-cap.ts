// 搜索结果按源截断：单源最多 N 条、总量最多 M 条。
//
// 背景：51 个源聚合时一次搜索可返回 500+ 条、JSON 超过 1MB，
// 其中绝大部分是各源自己的「全部匹配结果」。手机端传输和渲染都吃不下，
// 而 UI 只需要每个源靠前的若干条（换源列表也只用每源 1 条）。
// 这里只做条数截断，不改字段、不动 episodes（播放页还要用它们测速/直连）。

export const SEARCH_MAX_PER_SOURCE = 20;
export const SEARCH_MAX_TOTAL = 200;

export function capSearchResults<T extends { source?: string }>(
  items: T[]
): T[] {
  if (!Array.isArray(items) || items.length === 0) return items;
  const perSource = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= SEARCH_MAX_TOTAL) break;
    const source = String(item?.source ?? '');
    const used = (perSource.get(source) ?? 0) + 1;
    if (used > SEARCH_MAX_PER_SOURCE) continue;
    perSource.set(source, used);
    out.push(item);
  }
  return out;
}
