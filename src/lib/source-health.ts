// 源健康度：进程内失败统计 + 冷却降权（不写库，重启即清零）
// 连续失败 FAIL_THRESHOLD 次后，该源进入 COOLDOWN_MS 冷却期，搜索时跳过；
// 冷却结束自动恢复一次机会（下次成功即完全恢复）。

export const SOURCE_FAIL_THRESHOLD = 3;
export const SOURCE_COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟

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

export function recordSourceSuccess(
  key: string,
  elapsedMs?: number,
  now: number = Date.now()
): void {
  if (!key) return;
  const rec = getRecord(key);
  rec.fails = 0;
  rec.lastOkAt = now;
  rec.cooldownUntil = 0;
  // 记录响应耗时（指数滑动平均），用于首屏优先排序
  if (typeof elapsedMs === 'number' && elapsedMs >= 0 && elapsedMs < 30000) {
    rec.samples += 1;
    rec.avgMs = rec.samples === 1 ? elapsedMs : rec.avgMs * 0.7 + elapsedMs * 0.3;
  }
}

export function recordSourceFailure(key: string, now: number = Date.now()): void {
  if (!key) return;
  const rec = getRecord(key);
  rec.fails += 1;
  rec.lastFailAt = now;
  if (rec.fails >= SOURCE_FAIL_THRESHOLD) {
    rec.cooldownUntil = now + SOURCE_COOLDOWN_MS;
  }
}

export function isSourceCoolingDown(key: string, now: number = Date.now()): boolean {
  if (!key) return false;
  const rec = healthMap.get(key);
  if (!rec || !rec.cooldownUntil) return false;
  if (rec.cooldownUntil > now) return true;
  // 冷却结束：清零重新观察
  rec.cooldownUntil = 0;
  rec.fails = 0;
  return false;
}

export function getSourceHealthSnapshot(): Array<{
  key: string;
  fails: number;
  cooling: boolean;
  lastOkAt: number;
  lastFailAt: number;
}> {
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
  const rec = healthMap.get(key);
  const base = (Number.isFinite(weight) ? weight : 0) * 1000;
  if (!rec) return base + 55;
  const healthBonus = rec.fails === 0 ? 55 : Math.max(0, 55 - rec.fails * 18);
  const latencyBonus = rec.samples > 0 ? Math.max(0, 40 - Math.min(40, rec.avgMs / 25)) : 20;
  return base + healthBonus + latencyBonus;
}

export function resetSourceHealth(key?: string): void {
  if (key) {
    healthMap.delete(key);
    return;
  }
  healthMap.clear();
}
