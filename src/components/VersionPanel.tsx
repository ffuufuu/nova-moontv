'use client';

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CURRENT_VERSION } from '@/lib/version';

interface UpstreamCommit {
  sha: string;
  date: string;
  message: string;
  files: string[];
  risk: 'safe' | 'manual' | 'skip';
  reason?: string;
}

interface UpstreamReport {
  checkedAt: string;
  ourVersion: string;
  baseVersion: string;
  baseCommit: string;
  latestVersion: string;
  latestCommit: string;
  latestDate: string;
  latestMessage: string;
  upToDate: boolean;
  commits: UpstreamCommit[];
  summary: { total: number; safe: number; manual: number; skip: number };
  sync?: {
    auto: boolean;
    cadence: string;
    workflowUrl: string;
    prUrl: string;
    issueUrl: string;
    lastSyncAt: string;
    lastSyncCommit: string;
    patch?: {
      available: boolean;
      files: number;
      highRisk: number;
      safe: number;
    };
  };
}

const RISK_META: Record<
  'safe' | 'manual' | 'skip',
  { label: string; cls: string }
> = {
  safe: {
    label: '可安全摘',
    cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  },
  manual: {
    label: '需手工改',
    cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  },
  skip: {
    label: '建议别动',
    cls: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800',
  },
};

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VersionPanel: React.FC<VersionPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [report, setReport] = useState<UpstreamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/upstream/report', { cache: 'no-store' });
      const data = await res.json();
      if (data && !data.error) {
        setReport(data as UpstreamReport);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void load();
    } else {
      stopPoll();
      setChecking(false);
    }
  }, [isOpen, load]);

  const handleCheck = async () => {
    if (checking) return;
    setChecking(true);
    const before = report?.checkedAt || '';
    try {
      await fetch('/api/upstream/report', { method: 'POST' });
      let tries = 0;
      stopPoll();
      pollRef.current = window.setInterval(async () => {
        tries += 1;
        try {
          const res = await fetch('/api/upstream/report', {
            cache: 'no-store',
          });
          const data = await res.json();
          if (data && !data.error) {
            setReport(data as UpstreamReport);
            if (data.checkedAt && data.checkedAt !== before) {
              setChecking(false);
              stopPoll();
              return;
            }
          }
        } catch {}
        if (tries >= 40) {
          setChecking(false);
          stopPoll();
        }
      }, 3000);
    } catch {
      setChecking(false);
    }
  };

  if (!isOpen || !mounted) return null;

  const version = report?.ourVersion || CURRENT_VERSION;

  const overlay = (
    <div className='fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6'>
      <div
        className='absolute inset-0 bg-black/60 backdrop-blur-sm'
        onClick={onClose}
      />
      <div className='relative w-full max-w-lg max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden'>
        {/* 头部 */}
        <div className='flex items-center justify-between px-4 sm:px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 flex-shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            <h2 className='text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-100'>
              上游更新看板
            </h2>
            <span className='px-2 py-0.5 rounded-full text-[11px] font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'>
              v{version}
            </span>
          </div>
          <button
            onClick={onClose}
            className='p-1.5 rounded-lg text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors'
            aria-label='关闭'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* 内容 */}
        <div className='flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4'>
          {loading && !report && (
            <div className='flex items-center justify-center py-10 text-sm text-neutral-500'>
              <RefreshCw className='w-4 h-4 mr-2 animate-spin' />
              读取中…
            </div>
          )}

          {failed && !report && (
            <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-sm text-neutral-500'>
              还没生成报告。点下面的「立即检查」拉一次。
            </div>
          )}

          {report && (
            <>
              {/* 版本对比 */}
              <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 sm:p-4 space-y-2 text-sm'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-neutral-500'>咱们的版本</span>
                  <span className='font-mono font-semibold text-neutral-900 dark:text-neutral-100'>
                    v{report.ourVersion}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-neutral-500'>基于上游</span>
                  <span className='font-mono text-neutral-900 dark:text-neutral-100'>
                    v{report.baseVersion}
                    <span className='ml-1.5 text-[11px] text-neutral-400'>
                      {report.baseCommit}
                    </span>
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-neutral-500'>上游最新</span>
                  <span className='font-mono text-neutral-900 dark:text-neutral-100'>
                    v{report.latestVersion}
                    <span className='ml-1.5 text-[11px] text-neutral-400'>
                      {report.latestCommit}
                    </span>
                  </span>
                </div>
              </div>

              {/* 状态 */}
              {report.upToDate ? (
                <div className='rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 sm:p-4 flex items-start gap-2.5'>
                  <CheckCircle2 className='w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5' />
                  <div className='min-w-0'>
                    <p className='text-sm font-medium text-emerald-800 dark:text-emerald-200'>
                      已和上游同步
                    </p>
                    <p className='mt-1 text-xs text-emerald-700 dark:text-emerald-300 break-all'>
                      {report.latestDate} · {report.latestMessage}
                    </p>
                  </div>
                </div>
              ) : (
                <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4'>
                  <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
                    上游有 {report.summary.total} 个新提交
                  </p>
                  <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                    <span className='text-emerald-700 dark:text-emerald-300'>
                      可安全摘 {report.summary.safe}
                    </span>
                    <span className='text-amber-700 dark:text-amber-300'>
                      需手工 {report.summary.manual}
                    </span>
                    <span className='text-rose-700 dark:text-rose-300'>
                      建议别动 {report.summary.skip}
                    </span>
                  </div>
                </div>
              )}

              {/* 自动同步 */}
              {report.sync && (
                <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 sm:p-4 space-y-2 text-sm'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-neutral-500'>自动同步</span>
                    <span className='text-[11px] text-neutral-500'>
                      {report.sync.cadence}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-neutral-500'>最近同步</span>
                    <span className='font-mono text-neutral-900 dark:text-neutral-100'>
                      {report.sync.lastSyncCommit}
                      {report.sync.lastSyncAt ? (
                        <span className='ml-1.5 text-[11px] text-neutral-400'>
                          {report.sync.lastSyncAt}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-neutral-500'>该版增量</span>
                    <span className='text-[11px] text-neutral-500'>
                      {report.sync.patch && report.sync.patch.available
                        ? `共 ${report.sync.patch.files} 文件 · 高危 ${report.sync.patch.highRisk} · 可摘 ${report.sync.patch.safe}`
                        : '尚未生成补丁'}
                    </span>
                  </div>
                  <div className='flex flex-wrap gap-2 pt-1'>
                    <a
                      href={report.sync.workflowUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-md border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors'
                    >
                      检测记录
                    </a>
                    <a
                      href={report.sync.prUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-md border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors'
                    >
                      待合并 PR
                    </a>
                    <a
                      href={report.sync.issueUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-md border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors'
                    >
                      冲突 issue
                    </a>
                  </div>
                  <p className='text-[11px] text-neutral-400 leading-relaxed'>
                    流程：检测上游 → 只摘后端/接口增量 → 干净合并开 PR，冲突开 issue；合并后按规则升版本号才算新版本。
                  </p>
                </div>
              )}

              {/* 提交列表 */}
              {report.commits.length > 0 && (
                <div className='space-y-2'>
                  <h3 className='text-xs font-medium text-neutral-500'>
                    新提交
                  </h3>
                  {report.commits.map((c) => {
                    const meta = RISK_META[c.risk] || RISK_META.manual;
                    const open = expanded === c.sha;
                    return (
                      <div
                        key={c.sha}
                        className='rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden'
                      >
                        <button
                          onClick={() => setExpanded(open ? null : c.sha)}
                          className='w-full text-left px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors'
                        >
                          <div className='flex items-center gap-2'>
                            {open ? (
                              <ChevronDown className='w-4 h-4 text-neutral-400 flex-shrink-0' />
                            ) : (
                              <ChevronRight className='w-4 h-4 text-neutral-400 flex-shrink-0' />
                            )}
                            <span className='font-mono text-[11px] text-neutral-400 flex-shrink-0'>
                              {c.sha}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 ${meta.cls}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <p className='mt-1.5 text-sm text-neutral-800 dark:text-neutral-200 break-words'>
                            {c.message}
                          </p>
                          <p className='mt-1 text-[11px] text-neutral-400'>
                            {c.date}
                          </p>
                        </button>
                        {open && (
                          <div className='px-3 pb-3 pt-1 border-t border-neutral-100 dark:border-neutral-800/60 space-y-1.5'>
                            {c.reason && (
                              <p className='text-[11px] text-amber-600 dark:text-amber-400 break-words'>
                                {c.reason}
                              </p>
                            )}
                            <ul className='space-y-0.5'>
                              {c.files.slice(0, 12).map((f) => (
                                <li
                                  key={f}
                                  className='font-mono text-[11px] text-neutral-500 break-all'
                                >
                                  {f}
                                </li>
                              ))}
                              {c.files.length > 12 && (
                                <li className='text-[11px] text-neutral-400'>
                                  还有 {c.files.length - 12} 个文件…
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className='text-[11px] text-neutral-400 text-center'>
                上次检查 {report.checkedAt}　·　自动检测由 Actions 每天 02:00 执行
              </p>
            </>
          )}
        </div>

        {/* 底部按钮 */}
        <div className='px-4 sm:px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex-shrink-0'>
          <button
            onClick={handleCheck}
            disabled={checking}
            className='w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/60 text-white transition-colors'
          >
            <RefreshCw
              className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`}
            />
            {checking ? '正在检查上游…' : '立即检查'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};
