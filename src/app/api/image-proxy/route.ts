/* eslint-disable @typescript-eslint/no-explicit-any */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

// ===== 本地图片缓存（v1.5.0）=====
// 海报/封面走本地磁盘缓存：命中直接读文件，未命中回源并落盘。
// 目录放在已有的 bind mount（./upstream -> /app/upstream）下，容器重建不丢。
const IMAGE_CACHE_DIR = process.env.IMAGE_CACHE_DIR || '/app/upstream/image-cache';
const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const IMAGE_CACHE_MAX_BYTES = 800 * 1024 * 1024; // 总量上限 800MB（超出按最旧淘汰）
const IMAGE_CACHE_MAX_FILE_BYTES = 6 * 1024 * 1024; // 单图超过 6MB 不落盘
const IMAGE_CACHE_TRIM_EVERY = 200; // 每写 200 张触发一次淘汰
const SAFE_CONTENT_TYPE = /^image\//i;

let cacheWriteCount = 0;
let trimRunning = false;

function isCloudflareEnvironment(): boolean {
  return (
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare'
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function applyBangumiImageBaseUrl(
  imageUrl: string,
  imageBaseUrl?: string
): string {
  const normalizedBaseUrl = normalizeBaseUrl(imageBaseUrl || '');
  if (!normalizedBaseUrl) {
    return imageUrl;
  }

  if (imageUrl.startsWith(`${normalizedBaseUrl}/`)) {
    return imageUrl;
  }

  return `${normalizedBaseUrl}/${imageUrl}`;
}

function isBangumiImageUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'lain.bgm.tv' ||
      hostname === 'r.bgm.tv' ||
      hostname === 'bangumi.lol' ||
      hostname.endsWith('.bgm.tv') ||
      hostname.endsWith('.bangumi.tv') ||
      hostname.endsWith('.bangumi.lol')
    );
  } catch {
    return false;
  }
}

// 缓存键：URL 的 sha256，避免超长文件名与非法字符
function cacheKey(targetUrl: string): string {
  return crypto.createHash('sha256').update(targetUrl).digest('hex');
}

function cachePaths(key: string) {
  const sub = key.slice(0, 2);
  return {
    dir: path.join(IMAGE_CACHE_DIR, sub),
    body: path.join(IMAGE_CACHE_DIR, sub, key),
    meta: path.join(IMAGE_CACHE_DIR, sub, `${key}.meta`),
  };
}

async function readCache(targetUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  const { body, meta } = cachePaths(cacheKey(targetUrl));
  try {
    const [stat, metaRaw] = await Promise.all([
      fs.stat(body),
      fs.readFile(meta, 'utf8'),
    ]);
    if (Date.now() - stat.mtimeMs > IMAGE_CACHE_TTL_MS) {
      return null;
    }
    const parsed = JSON.parse(metaRaw) as { ct?: string };
    const contentType = parsed?.ct || 'image/jpeg';
    const buffer = await fs.readFile(body);
    // 命中时刷新 mtime，配合按 mtime 淘汰实现近似 LRU
    void fs.utimes(body, stat.atime, new Date()).catch(() => {});
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function writeCache(
  targetUrl: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const { dir, body, meta } = cachePaths(cacheKey(targetUrl));
  const tmpBody = `${body}.${process.pid}.tmp`;
  const tmpMeta = `${meta}.${process.pid}.tmp`;
  try {
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(tmpBody, buffer),
      fs.writeFile(tmpMeta, JSON.stringify({ ct: contentType, url: targetUrl })),
    ]);
    await fs.rename(tmpBody, body);
    await fs.rename(tmpMeta, meta);
  } catch {
    void fs.unlink(tmpBody).catch(() => {});
    void fs.unlink(tmpMeta).catch(() => {});
    return;
  }

  cacheWriteCount += 1;
  if (cacheWriteCount % IMAGE_CACHE_TRIM_EVERY === 0) {
    void trimCache();
  }
}

// 超过总量上限时按 mtime 从旧到新删除
async function trimCache(): Promise<void> {
  if (trimRunning) return;
  trimRunning = true;
  try {
    const entries: { file: string; size: number; mtime: number }[] = [];
    const subs = await fs.readdir(IMAGE_CACHE_DIR, { withFileTypes: true });
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const subDir = path.join(IMAGE_CACHE_DIR, sub.name);
      const files = await fs.readdir(subDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || f.name.endsWith('.tmp')) continue;
        const full = path.join(subDir, f.name);
        try {
          const st = await fs.stat(full);
          entries.push({ file: full, size: st.size, mtime: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }

    // 过期清理
    for (const e of entries) {
      if (Date.now() - e.mtime > IMAGE_CACHE_TTL_MS) {
        void fs.unlink(e.file).catch(() => {});
      }
    }

    const total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= IMAGE_CACHE_MAX_BYTES) return;

    entries.sort((a, b) => a.mtime - b.mtime);
    let current = total;
    for (const e of entries) {
      if (current <= IMAGE_CACHE_MAX_BYTES * 0.9) break;
      await fs.unlink(e.file).catch(() => {});
      current -= e.size;
    }
  } catch {
    /* ignore */
  } finally {
    trimRunning = false;
  }
}

async function fetchImage(
  imageUrl: string,
  options?: { source?: string }
): Promise<{ response: Response; targetUrl: string }> {
  const isBangumiImage =
    options?.source === 'bangumi' || isBangumiImageUrl(imageUrl);
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    Referer: isBangumiImage ? 'https://bgm.tv/' : 'https://movie.douban.com/',
  };

  const config = isBangumiImage ? await getConfig() : null;
  const targetUrl = isBangumiImage
    ? applyBangumiImageBaseUrl(imageUrl, config?.SiteConfig.BangumiImageBaseUrl)
    : imageUrl;

  if (!isBangumiImage || isCloudflareEnvironment()) {
    return {
      response: await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(15000),
      }),
      targetUrl,
    };
  }

  const proxy = config?.SiteConfig.BangumiProxy?.trim();
  const fetchOptions: any = {
    headers,
    signal: AbortSignal.timeout(proxy ? 30000 : 15000),
  };

  if (proxy) {
    fetchOptions.agent = new HttpsProxyAgent(proxy, {
      timeout: 30000,
      keepAlive: false,
    });
  }

  return {
    response: (await nodeFetch(targetUrl, fetchOptions)) as unknown as Response,
    targetUrl,
  };
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const source = searchParams.get('source') || undefined;
  const noCache = searchParams.get('nocache') === '1';

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  // 命中本地缓存直接返回，完全不回源
  if (!noCache) {
    const cached = await readCache(imageUrl);
    if (cached) {
      const headers = new Headers();
      headers.set('Content-Type', cached.contentType);
      headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000');
      headers.set('X-Image-Cache', 'HIT');
      return new Response(cached.buffer as unknown as BodyInit, {
        status: 200,
        headers,
      });
    }
  }

  try {
    const { response: imageResponse, targetUrl } = await fetchImage(imageUrl, {
      source,
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type') || '';

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    // 创建响应头
    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    // 设置缓存头（可选）
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000'); // 缓存半年
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');
    headers.set('X-Image-Cache', noCache ? 'BYPASS' : 'MISS');

    // 只缓存正常图片，且体积可控；命中失败不影响正常返回
    if (
      !noCache &&
      SAFE_CONTENT_TYPE.test(contentType) &&
      isCacheableHost(targetUrl)
    ) {
      const declared = Number(imageResponse.headers.get('content-length') || 0);
      if (!declared || declared <= IMAGE_CACHE_MAX_FILE_BYTES) {
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        if (buffer.length > 0 && buffer.length <= IMAGE_CACHE_MAX_FILE_BYTES) {
          void writeCache(imageUrl, buffer, contentType);
        }
        // 落盘后仍然直接把内容返回，客户端不必再等
        return new Response(buffer as unknown as BodyInit, {
          status: 200,
          headers,
        });
      }
    }

    // 直接返回图片流
    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('图片代理请求失败:', error);
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
  }
}

// 只缓存公网图床/豆瓣/TMDB 这类稳定资源，避免把内网或私有源内容写盘
function isCacheableHost(targetUrl: string): boolean {
  try {
    const { hostname, protocol } = new URL(targetUrl);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      /^127\./.test(lower) ||
      /^10\./.test(lower) ||
      /^192\.168\./.test(lower)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
