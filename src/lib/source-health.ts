// 源健康度：失败统计 + 冷却降权 + 跨重启持久化（kvrocks/redis 哈希）。
// 连续失败 FAIL_THRESHOLD 次后，该源进入 COOLDOWN_MS 冷却期，搜索时跳过；
// 冷却结束自动恢复一次机会（下次成功即完全恢复）。
//
// 持久化说明：进程内 Map 仍是热数据源；启动后首次使用时异步从
// `nova:source-health` 哈希里灌回来，之后每次变更 2 秒防抖批量写回。
// 只在 kvrocks / redis 模式下启用；localstorage / d1 等模式自动退化到纯内存，
// 所有存储异常一律吞掉，绝不影响搜索。

export const SOURCE_FAIL_THRESHOLD = 3;
export const SOURCE_COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟

const HEALTH_HASH_KEY = 'nova:source-health';
const PERSIST_DEBOUNCE_MS = 2000;
const HYDRATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 超过 24 小时没动静的记录不恢复

type HealthRecord = {
  fails: number;
  lastFailAt: number;
  lastOkAt: number;
  cooldownUntil: number;
  avgMs: number;
  samples: number;
};

const healthMap = new Map<string, HealthRecord>();

function getRecord(key: string): HealthRecord {
  const existing = healthMap.get(key);
  if (existing) return existing;
  const fresh: HealthRecord = {
    fails: 0,
    lastFailAt: 0,
    lastOkAt: 0,
    cooldownUntil: 0,
    avgMs: 0,
    samples: 0,
  };
  healthMap.set(key, fresh);
  return fresh;
}

function normalizeRecord(raw: unknown): HealthRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<HealthRecord>;
  if (
    typeof r.fails !== 'number' ||
    typeof r.lastOkAt !== 'number' ||
    typeof r.lastFailAt !== 'number'
  ) {
    return null;
  }
  return {
    fails: Number.isFinite(r.fails) && r.fails >= 0 ? r.fails : 0,
    lastFailAt: Number.isFinite(r.lastFailAt) ? r.lastFailAt : 0,
    lastOkAt: Number.isFinite(r.lastOkAt) ? r.lastOkAt : 0,
    cooldownUntil: Number.isFinite(r.cooldownUntil as number)
      ? (r.cooldownUntil as number)
      : 0,
    avgMs: Number.isFinite(r.avgMs as number) ? (r.avgMs as number) : 0,
    samples: Number.isFinite(r.samples as number) ? (r.samples as number) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * 持久化层：任何一步失败都静默降级为纯内存
 * ------------------------------------------------------------------ */

type HealthAdapter = {
  hGetAll?: (key: string) => Promise<Record<string, string>>;
  hSet?: (key: string, data: Record<string, string>) => Promise<number>;
  hDel?: (key: string, ...fields: string[]) => Promise<number>;
};

let adapterCache: HealthAdapter | null | undefined;
let hydrateStarted = false;

function getHealthAdapter(): HealthAdapter | null {
  if (adapterCache !== undefined) return adapterCache;
  adapterCache = null;
  if (typeof window !== 'undefined') return adapterCache;
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  if (storageType !== 'kvrocks' && storageType !== 'redis') return adapterCache;
  try {
    // 延迟加载，避免与 storage 初始化形成循环依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getStorage } = require('./db');
    const storage: any = getStorage();
    const adapter: any = storage && storage.adapter;
    if (
      adapter &&
      typeof adapter.hGetAll === 'function' &&
      typeof adapter.hSet === 'function'
    ) {
      adapterCache = adapter as HealthAdapter;
    }
  } catch {
    adapterCache = null;
  }
  return adapterCache;
}

function scheduleHydrate(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  const adapter = getHealthAdapter();
  if (!adapter || typeof adapter.hGetAll !== 'function') return;
  try {
    adapter
      .hGetAll(HEALTH_HASH_KEY)
      .then((data) => {
        if (!data) return;
        const now = Date.now();
        let restored = 0;
        Object.keys(data).forEach((key) => {
          if (healthMap.has(key)) return; // 进程内已有更新的记录，不覆盖
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(data[key]);
          } catch {
            return;
          }
          const rec = normalizeRecord(parsed);
          if (!rec) return;
          const lastActive = Math.max(rec.lastOkAt, rec.lastFailAt);
          if (lastActive > 0 && now - lastActive > HYDRATE_MAX_AGE_MS) return;
          if (rec.cooldownUntil > 0 && rec.cooldownUntil < now - SOURCE_COOLDOWN_MS) {
            rec.cooldownUntil = 0;
          }
          healthMap.set(key, rec);
          restored += 1;
        });
        if (restored > 0) {
          console.log(`[source-health] 已恢复 ${restored} 条源健康记录`);
        }
      })
      .catch(() => undefined);
  } catch {
    /* 忽略 */
  }
}

const dirtyKeys = new Set<string>();
const dirtyDeletes = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(key: string, deleted: boolean = false): void {
  const adapter = getHealthAdapter();
  if (!adapter || typeof adapter.hSet !== 'function') return;
  if (deleted) {
    dirtyDeletes.add(key);
    dirtyKeys.delete(key);
  } else {
    dirtyKeys.add(key);
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersist();
  }, PERSIST_DEBOUNCE_MS);
  // 不要因为这条定时器拖住进程退出
  if (typeof (persistTimer as any)?.unref === 'function') {
    (persistTimer as any).unref();
  }
}

function flushPersist(): void {
  const adapter = getHealthAdapter();
  if (!adapter) {
    dirtyKeys.clear();
    dirtyDeletes.clear();
    return;
  }
  const payload: Record<string, string> = {};
  dirtyKeys.forEach((key) => {
    const rec = healthMap.get(key);
    if (rec) payload[key] = JSON.stringify(rec);
  });
  const pendingDeletes = Array.from(dirtyDeletes);
  dirtyKeys.clear();
  dirtyDeletes.clear();
  try {
    if (Object.keys(payload).length > 0 && typeof adapter.hSet === 'function') {
      Promise.resolve(adapter.hSet(HEALTH_HASH_KEY, payload)).catch(() => undefined);
    }
    if (pendingDeletes.length > 0 && typeof adapter.hDel === 'function') {
      Promise.resolve(adapter.hDel(HEALTH_HASH_KEY, ...pendingDeletes)).catch(
        () => undefined
      );
    }
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ *
 * 对外 API
 * ------------------------------------------------------------------ */

export function recordSourceSuccess(
  key: string,
  elapsedMs?: number,
  now: number = Date.now()
): void {
  if (!key) return;
  scheduleHydrate();
  const rec = getRecord(key);
  rec.fails = 0;
  rec.lastOkAt = now;
  rec.cooldownUntil = 0;
  // 记录响应耗时（指数滑动平均），用于首屏优先排序
  if (typeof elapsedMs === 'number' && elapsedMs >= 0 && elapsedMs < 30000) {
    rec.samples += 1;
    rec.avgMs = rec.samples === 1 ? elapsedMs : rec.avgMs * 0.7 + elapsedMs * 0.3;
  }
  schedulePersist(key);
}

export function recordSourceFailure(key: string, now: number = Date.now()): void {
  if (!key) return;
  scheduleHydrate();
  const rec = getRecord(key);
  rec.fails += 1;
  rec.lastFailAt = now;
  if (rec.fails >= SOURCE_FAIL_THRESHOLD) {
    rec.cooldownUntil = now + SOURCE_COOLDOWN_MS;
  }
  schedulePersist(key);
}

export function isSourceCoolingDown(key: string, now: number = Date.now()): boolean {
  if (!key) return false;
  scheduleHydrate();
  const rec = healthMap.get(key);
  if (!rec || !rec.cooldownUntil) return false;
  if (rec.cooldownUntil > now) return true;
  // 冷却结束：清零重新观察
  rec.cooldownUntil = 0;
  rec.fails = 0;
  schedulePersist(key);
  return false;
}

export function getSourceHealthSnapshot(): Array<{
  key: string;
  fails: number;
  cooling: boolean;
  lastOkAt: number;
  lastFailAt: number;
}> {
  scheduleHydrate();
  const now = Date.now();
  const list: Array<{
    key: string;
    fails: number;
    cooling: boolean;
    lastOkAt: number;
    lastFailAt: number;
  }> = [];
  healthMap.forEach((rec, key) => {
    list.push({
      key,
      fails: rec.fails,
      cooling: isSourceCoolingDown(key, now),
      lastOkAt: rec.lastOkAt,
      lastFailAt: rec.lastFailAt,
    });
  });
  return list.sort((a, b) => b.fails - a.fails);
}

/**
 * 源排序优先级：管理端权重为主序，再叠加健康度与实测耗时。
 * 分值越大越先搜索 —— 让首屏结果尽量来自“最近又快又没挂”的源。
 */
export function getSourcePriority(key: string, weight: number = 0): number {
  scheduleHydrate();
  const rec = healthMap.get(key);
  const base = (Number.isFinite(weight) ? weight : 0) * 1000;
  if (!rec) return base + 55;
  const healthBonus = rec.fails === 0 ? 55 : Math.max(0, 55 - rec.fails * 18);
  const latencyBonus = rec.samples > 0 ? Math.max(0, 40 - Math.min(40, rec.avgMs / 25)) : 20;
  // 最近 6 小时内成功过的源，略微加权重（用户体感“刚用着还行”的源优先）
  const recencyBonus =
    rec.lastOkAt > 0 && Date.now() - rec.lastOkAt < 6 * 60 * 60 * 1000 ? 8 : 0;
  return base + healthBonus + latencyBonus + recencyBonus;
}

export function resetSourceHealth(key?: string): void {
  if (key) {
    healthMap.delete(key);
    schedulePersist(key, true);
    return;
  }
  healthMap.forEach((_, k) => dirtyDeletes.add(k));
  healthMap.clear();
  flushPersist();
}
