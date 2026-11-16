/* eslint-disable no-console */

import { promises as fs } from 'fs';
import path from 'path';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 上游检查脚本把报告写到宿主机，通过卷挂载进容器
const DIR = '/app/upstream';
const REPORT = path.join(DIR, 'report.json');
const REQUEST = path.join(DIR, 'request');

export async function GET() {
  try {
    const raw = await fs.readFile(REPORT, 'utf8');
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: 'no-report' });
  }
}

export async function POST() {
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(REQUEST, String(Date.now()), 'utf8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Upstream] 写入检查请求失败:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
