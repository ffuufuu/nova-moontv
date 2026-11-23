// 弹幕搜索 API 路由
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getDanmakuApiBaseUrl } from '@/lib/danmaku/config';

export const runtime = 'nodejs';

// 上游弹幕服务常返 503；失败后 60 秒内直接短路，避免每次请求都白等超时
const FAIL_CACHE_MS = 60 * 1000;
let lastFailure: { at: number; message: string } | null = null;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const keyword = searchParams.get('keyword');

    if (!keyword) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: '缺少关键词参数',
          animes: [],
        },
        { status: 400 }
      );
    }

    if (lastFailure && Date.now() - lastFailure.at < FAIL_CACHE_MS) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: lastFailure.message,
          animes: [],
        },
        { status: 200 }
      );
    }

    // 从数据库读取弹幕配置
    const config = await getConfig();
    const baseUrl = getDanmakuApiBaseUrl(config.SiteConfig);

    const apiUrl = `${baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`;

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      lastFailure = null;

      return NextResponse.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // 如果是超时错误，返回更友好的错误信息
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('弹幕服务器请求超时，请稍后重试');
      }

      throw fetchError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '搜索失败';
    lastFailure = { at: Date.now(), message };
    console.error('弹幕搜索代理错误:', error);
    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage: error instanceof Error ? error.message : '搜索失败',
        animes: [],
      },
      { status: 500 }
    );
  }
}
