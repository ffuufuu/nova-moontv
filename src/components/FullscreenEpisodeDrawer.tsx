'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

interface SourceItem {
  id: string;
  title: string;
  source: string;
  source_name?: string;
}

interface FullscreenEpisodeDrawerProps {
  open: boolean;
  onClose: () => void;
  totalEpisodes: number;
  episodesTitles?: string[];
  currentEpisodeIndex: number;
  onEpisodeChange: (index: number) => void;
  sources?: SourceItem[];
  currentSource?: string;
  onSourceChange?: (source: string, id: string, title: string) => void;
}

/**
 * 全屏(横屏)选集抽屉：
 * 全屏 API 下页面 DOM 被排除在 fullscreenElement 之外，
 * 所以这里用 createPortal 挂到 document.fullscreenElement 上，
 * 保证横屏全屏时也能看到选集面板。
 */
export default function FullscreenEpisodeDrawer({
  open,
  onClose,
  totalEpisodes,
  episodesTitles = [],
  currentEpisodeIndex,
  onEpisodeChange,
  sources = [],
  currentSource,
  onSourceChange,
}: FullscreenEpisodeDrawerProps) {
  const [portalHost, setPortalHost] = useState<Element | null>(null);

  useEffect(() => {
    const sync = () => {
      setPortalHost((document.fullscreenElement as Element | null) || null);
    };
    if (open) sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [open]);

  const episodes = useMemo(
    () => Array.from({ length: Math.max(0, totalEpisodes) }, (_, i) => i),
    [totalEpisodes]
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;
  const host = portalHost || document.body;
  if (!host) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 'min(48vw, 540px)',
          minWidth: 300,
          height: '100%',
          background: 'rgba(18,18,18,0.97)',
          borderLeft: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-12px 0 32px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0,
          }}
        >
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
            选集
            <span
              style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}
            >
              {currentEpisodeIndex + 1} / {totalEpisodes}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 8px',
            }}
          >
            ×
          </button>
        </div>

        {sources.length > 1 && onSourceChange ? (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              flexShrink: 0,
            }}
          >
            <select
              value={currentSource || ''}
              onChange={(e) => {
                const item = sources.find((s) => s.source === e.target.value);
                if (item) {
                  onSourceChange(item.source, item.id, item.title);
                }
              }}
              style={{
                width: '100%',
                background: '#242424',
                color: '#e5e7eb',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                padding: '6px 8px',
                fontSize: 13,
              }}
            >
              {sources.map((s) => (
                <option key={s.source + s.id} value={s.source}>
                  {s.source_name || s.source}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
            gap: 8,
            alignContent: 'start',
          }}
        >
          {episodes.map((i) => {
            const active = i === currentEpisodeIndex;
            const title = episodesTitles[i];
            return (
              <button
                key={i}
                onClick={() => {
                  onEpisodeChange(i);
                  onClose();
                }}
                title={title || '第' + (i + 1) + '集'}
                style={{
                  height: 38,
                  borderRadius: 8,
                  border: active
                    ? '1px solid #22c55e'
                    : '1px solid rgba(255,255,255,0.12)',
                  background: active ? '#16a34a' : 'rgba(255,255,255,0.06)',
                  color: active ? '#fff' : '#d1d5db',
                  fontSize: 13,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    host
  );
}
