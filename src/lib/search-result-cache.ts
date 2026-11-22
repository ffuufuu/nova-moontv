// 同关键词搜索结果缓存：流式(ws)与非流式(api/search)共用同一份，5 分钟 / 最多 50 条。
// 键包含用户名与搜索模式，避免串权限。

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 50;

type SearchCachePayload = { results: any[] };

const searchCache = new Map<string, { at: number; payload: SearchCachePayload }>();

export function makeSearchCacheKey(
  username: string,
  specialOnly: boolean,
  privateOnly: boolean,
  query: string
): string {
  return `${username}|${specialOnly ? 1 : 0}|${privateOnly ? 1 : 0}|${query.trim().toLowerCase()}`;
}

export function getCachedSearch(key: string): SearchCachePayload | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // LRU：命中后挪到队尾
  searchCache.delete(key);
  searchCache.set(key, entry);
  return entry.payload;
}

export function setCachedSearch(key: string, payload: SearchCachePayload): void {
  if (!key || !payload || !Array.isArray(payload.results) || payload.results.length === 0) return;
  searchCache.delete(key);
  searchCache.set(key, { at: Date.now(), payload });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

export function clearSearchCache(): void {
  searchCache.clear();
}
