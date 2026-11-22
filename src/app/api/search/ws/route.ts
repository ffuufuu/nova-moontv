/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  getSourcePriority,
  isSourceCoolingDown,
  recordSourceFailure,
  recordSourceSuccess,
} from '@/lib/source-health';
import { getCachedSearch, makeSearchCacheKey, setCachedSearch } from '@/lib/search-result-cache';
import { hasFeaturePermission } from '@/lib/permissions';
import { yellowWords } from '@/lib/yellow';
import { getProxyToken } from '@/lib/emby-token';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const specialOnly = searchParams.get('special') === '1';
  const privateOnly = searchParams.get('privateOnly') === '1';

  if (!query) {
    return new Response(
      JSON.stringify({ error: '搜索关键词不能为空' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const cacheKey = makeSearchCacheKey(authInfo.username, specialOnly, privateOnly, query);

  const config = await getConfig();
  const apiSites = privateOnly
    ? []
    : await getAvailableApiSites(authInfo.username, specialOnly);
  const [hasOpenListPermission, hasEmbyPermission] = await Promise.all([
    hasFeaturePermission(authInfo.username, 'private_library'),
    hasFeaturePermission(authInfo.username, 'emby'),
  ]);
  // 特殊源入口（/under）只搜影视源：私人影库（OpenList/Emby）不参与搜索。
  // 否则 0 个特殊源时也会去搜私人影库，既串味又要白等 20s 超时。
  const canAccessOpenList = hasOpenListPermission && !specialOnly;
  const canAccessEmby = hasEmbyPermission && !specialOnly;

  // 创建权重映射表
  const weightMap = new Map<string, number>();
  config.SourceConfig.forEach(source => {
    weightMap.set(source.key, source.weight ?? 0);
  });

  // 排序 apiSites：权重为主，健康度与实测耗时作为加分，提前把快源排到前面
  const sortedApiSites = [...apiSites]
    .filter((site) => !isSourceCoolingDown(site.key))
    .sort((a, b) => {
      const pa = getSourcePriority(a.key, weightMap.get(a.key) ?? 0);
      const pb = getSourcePriority(b.key, weightMap.get(b.key) ?? 0);
      return pb - pa;
    });

  // 检查是否配置了 OpenList
  const hasOpenList = !!(
    canAccessOpenList &&
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 检查是否配置了 Emby（支持多源）
  const hasEmby = !!(
    canAccessEmby &&
    config.EmbyConfig?.Sources &&
    config.EmbyConfig.Sources.length > 0 &&
    config.EmbyConfig.Sources.some(s => s.enabled && s.ServerURL)
  );
  const enabledScripts = privateOnly ? [] : await listEnabledSourceScripts();

  // 共享状态
  let streamClosed = false;

  // 创建可读流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 辅助函数：安全地向控制器写入数据
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed || (!controller.desiredSize && controller.desiredSize !== 0)) {
            // 流已标记为关闭或控制器已关闭
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          // 控制器已关闭或出现其他错误
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 获取 Emby 源数量
      // 命中共享缓存：一次性输出全部结果，秒出
      const cached = getCachedSearch(cacheKey);
      if (cached && cached.results.length > 0) {
        const cachedPayloads = [
          { type: 'start', query, totalSources: 1, timestamp: Date.now() },
          { type: 'source_result', source: 'cache', sourceName: '缓存', results: cached.results, timestamp: Date.now() },
          { type: 'complete', totalResults: cached.results.length, completedSources: 1, timestamp: Date.now() },
        ];
        for (const item of cachedPayloads) {
          if (!safeEnqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`))) {
            streamClosed = true;
            return;
          }
        }
        streamClosed = true;
        try {
          controller.close();
        } catch (error) {
          console.warn('Failed to close controller (cache):', error);
        }
        return;
      }

      let embySourcesCount = 0;
      if (hasEmby) {
        try {
          const { embyManager } = await import('@/lib/emby-manager');
          const embySourcesMap = await embyManager.getAllClients();
          embySourcesCount = embySourcesMap.size;
        } catch (error) {
          console.error('[Search WS] 获取 Emby 源数量失败:', error);
        }
      }

      const totalSourceCount = sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length;

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: totalSourceCount,
        timestamp: Date.now()
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return; // 连接已关闭，提前退出
      }

      // 记录已完成的源数量
      let completedSources = 0;
      const allResults: any[] = [];

      const maybeComplete = () => {
        if (completedSources !== totalSourceCount || streamClosed) return;
        if (allResults.length > 0) {
          setCachedSearch(cacheKey, { results: allResults });
        }
        const completeEvent = `data: ${JSON.stringify({
          type: 'complete',
          totalResults: allResults.length,
          completedSources,
          timestamp: Date.now()
        })}\n\n`;

        if (safeEnqueue(encoder.encode(completeEvent))) {
          streamClosed = true;
          try {
            controller.close();
          } catch (error) {
            console.warn('Failed to close controller:', error);
          }
        }
      };

      if (totalSourceCount === 0) {
        maybeComplete();
        return;
      }

      // 搜索 Emby（如果配置了）- 异步带超时，支持多源
      if (hasEmby) {
        (async () => {
          let embyCompletedCount = 0;
          try {
            const { embyManager } = await import('@/lib/emby-manager');
            const embySourcesMap = await embyManager.getAllClients();
            const embySources = Array.from(embySourcesMap.values());

            // 获取代理 token（用于图片代理）
            const proxyToken = await getProxyToken(request);

            // 为每个 Emby 源并发搜索，并单独发送结果
            const embySearchPromises = embySources.map(async ({ client, config: embyConfig }) => {
              try {
                const searchResult = await client.getItems({
                  searchTerm: query,
                  IncludeItemTypes: 'Movie,Series',
                  Recursive: true,
                  Fields: 'Overview,ProductionYear',
                  Limit: 50,
                });

                const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

                // 添加安全检查，确保 Items 存在且是数组
                const items = Array.isArray(searchResult?.Items) ? searchResult.Items : [];
                const results = items.map((item) => ({
                  id: item.Id,
                  source: sourceValue,
                  source_name: sourceName,
                  weight: weightMap.get(sourceValue) ?? 0,
                  title: item.Name,
                  poster: client.getImageUrl(item.Id, 'Primary', undefined, client.isProxyEnabled() ? proxyToken || undefined : undefined),
                  episodes: [],
                  episodes_titles: [],
                  year: item.ProductionYear?.toString() || '',
                  desc: item.Overview || '',
                  type_name: item.Type === 'Movie' ? '电影' : '电视剧',
                  douban_id: 0,
                }));

                // 单独发送每个源的结果
                embyCompletedCount++;
                completedSources++;
                if (!streamClosed) {
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: results,
                    timestamp: Date.now()
                  })}\n\n`;
                  if (safeEnqueue(encoder.encode(sourceEvent))) {
                    if (results.length > 0) {
                      allResults.push(...results);
                    }
                  } else {
                    streamClosed = true;
                  }
                }
                maybeComplete();

                return results;
              } catch (error) {
                console.error(`[Search WS] 搜索 ${embyConfig.name} 失败:`, error);
                embyCompletedCount++;
                completedSources++;
                // 发送空结果
                if (!streamClosed) {
                  const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                  const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: [],
                    timestamp: Date.now()
                  })}\n\n`;
                  safeEnqueue(encoder.encode(sourceEvent));
                }
                maybeComplete();
                return [];
              }
            });

            await Promise.all(embySearchPromises);
          } catch (error) {
            console.error('[Search WS] 搜索 Emby 整体失败:', error);
            // 如果整个 emby 搜索失败，需要补齐未完成的源
            const remainingSources = embySourcesCount - embyCompletedCount;
            for (let i = 0; i < remainingSources; i++) {
              completedSources++;
              if (!streamClosed) {
                const sourceEvent = `data: ${JSON.stringify({
                  type: 'source_result',
                  source: 'emby',
                  sourceName: 'Emby',
                  results: [],
                  timestamp: Date.now()
                })}\n\n`;
                safeEnqueue(encoder.encode(sourceEvent));
              }
              maybeComplete();
            }
          }
        })();
      }

      // 搜索 OpenList（如果配置了）- 异步带超时
      if (hasOpenList) {
        Promise.race([
          (async () => {
            try {
              const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
              const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
              const { db } = await import('@/lib/db');

              let metaInfo = getCachedMetaInfo();

              if (!metaInfo) {
                const metainfoJson = await db.getGlobalValue('video.metainfo');
                if (metainfoJson) {
                  metaInfo = JSON.parse(metainfoJson);
                  if (metaInfo) {
                    setCachedMetaInfo(metaInfo);
                  }
                }
              }

              if (metaInfo && metaInfo.folders) {
                return Object.entries(metaInfo.folders)
                  .filter(([key, info]: [string, any]) => {
                    const matchFolder = info.folderName.toLowerCase().includes(query.toLowerCase());
                    const matchTitle = info.title.toLowerCase().includes(query.toLowerCase());
                    return matchFolder || matchTitle;
                  })
                  .map(([key, info]: [string, any]) => ({
                    id: key,
                    source: 'openlist',
                    source_name: '私人影库',
                    weight: weightMap.get('openlist') ?? 0,
                    title: info.title,
                    poster: getTMDBImageUrl(info.poster_path),
                    episodes: [],
                    episodes_titles: [],
                    year: info.release_date.split('-')[0] || '',
                    desc: info.overview,
                    type_name: info.media_type === 'movie' ? '电影' : '电视剧',
                    douban_id: 0,
                  }));
              }
              return [];
            } catch (error) {
              console.error('[Search WS] 搜索 OpenList 失败:', error);
              return [];
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OpenList timeout')), 10000)
          ),
        ])
          .then((openlistResults: any) => {
            completedSources++;
            if (!streamClosed) {
              // 添加安全检查，确保结果是数组
              const safeResults = Array.isArray(openlistResults) ? openlistResults : [];
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: 'openlist',
                sourceName: '私人影库',
                results: safeResults,
                timestamp: Date.now()
              })}\n\n`;
              if (!safeEnqueue(encoder.encode(sourceEvent))) {
                streamClosed = true;
                return;
              }
              if (safeResults.length > 0) {
                allResults.push(...safeResults);
              }
            }
            maybeComplete();
          })
          .catch((error) => {
            console.error('[Search WS] 搜索 OpenList 超时:', error);
            completedSources++;
            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: 'openlist',
                sourceName: '私人影库',
                results: [],
                timestamp: Date.now()
              })}\n\n`;
              safeEnqueue(encoder.encode(sourceEvent));
            }
            maybeComplete();
          });
      }

      // 为每个源创建搜索 Promise
      const searchPromises = sortedApiSites.map(async (site) => {
        try {
          // 添加超时控制
          const searchPromise = Promise.race([
            (async () => {
              const searchStartedAt = Date.now();
              try {
                const siteResults = await searchFromApi(site, query);
                recordSourceSuccess(site.key, Date.now() - searchStartedAt);
                return siteResults;
              } catch (siteError) {
                recordSourceFailure(site.key);
                throw siteError;
              }
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${site.name} timeout`)), 8000)
            ),
          ]);

          const results = await searchPromise as any[];

          // 添加安全检查，确保结果是数组
          const safeResults = Array.isArray(results) ? results : [];

          // 过滤黄色内容
          let filteredResults = safeResults;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = safeResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          filteredResults = filteredResults.map((result) => ({
            ...result,
            weight: result.weight ?? (weightMap.get(result.source) ?? 0),
          }));

          // 发送该源的搜索结果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return; // 连接已关闭，停止处理
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }

        } catch (error) {
          console.warn(`搜索失败 ${site.name}:`, error);

          // 发送源错误事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失败',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return; // 连接已关闭，停止处理
            }
          }
        }

        // 本轮搜索结束（API 源路径）：写入共享缓存
        if (completedSources === totalSourceCount && allResults.length > 0) {
          setCachedSearch(cacheKey, { results: allResults });
        }

        // 检查是否所有源都已完成
        if (completedSources === totalSourceCount) {
          if (!streamClosed) {
            // 发送最终完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              // 只有在成功发送完成事件后才关闭流
              streamClosed = true;
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      const scriptPromises = enabledScripts.map(async (script) => {
        try {
          const sourcesExecution = await Promise.race([
            executeSavedSourceScript({
              key: script.key,
              hook: 'getSources',
              payload: {},
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${script.name} timeout`)), 6000)
            ),
          ]);

          const sources = normalizeScriptSources((sourcesExecution as any).result);
          const sourceResults = await Promise.all(
            sources.map(async (source) => {
              const execution = await Promise.race([
                executeSavedSourceScript({
                  key: script.key,
                  hook: 'search',
                  payload: {
                    keyword: query,
                    page: 1,
                    sourceId: source.id,
                  },
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error(`${script.name}/${source.name} timeout`)), 6000)
                ),
              ]);

              return normalizeScriptSearchResults({
                scriptKey: script.key,
                scriptName: script.name,
                sourceId: source.id,
                sourceName: source.name,
                result: (execution as any).result,
              });
            })
          );

          let filteredResults = sourceResults.flat();
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = filteredResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: `script:${script.key}`,
              sourceName: script.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }
        } catch (error) {
          console.warn(`搜索脚本失败 ${script.name}:`, error);

          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: `script:${script.key}`,
              sourceName: script.name,
              error: error instanceof Error ? error.message : '搜索失败',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        if (completedSources === totalSourceCount) {
          if (!streamClosed) {
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              streamClosed = true;
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      // 等待所有搜索完成
      await Promise.allSettled([...searchPromises, ...scriptPromises]);
    },

    cancel() {
      // 客户端断开连接时，标记流已关闭
      streamClosed = true;
      console.log('Client disconnected, cancelling search stream');
    },
  });

  // 返回流式响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
