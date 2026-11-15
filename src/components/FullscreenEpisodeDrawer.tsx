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

const PAGE_SIZE = 50;

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
  const [pageIndex, setPageIndex] = useState(0);

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

  // 打开时自动跳到当前集所在分段
  useEffect(() => {
    if (!open) return;
    setPageIndex(Math.floor(currentEpisodeIndex / PAGE_SIZE));
  }, [open, currentEpisodeIndex]);

  const pages = useMemo(() => {
    const count = Math.ceil(Math.max(0, totalEpisodes) / PAGE_SIZE);
    return Array.from({ length: count }, (_, i) => i);
  }, [totalEpisodes]);

  const visibleEpisodes = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, totalEpisodes);
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  }, [pageIndex, totalEpisodes]);

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
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'relative',
          width: 'min(34vw, 460px)',
          minWidth: 280,
          height: '100%',
          background: '#0b0b0d',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '0 16px',
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: '#fff',
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            选集
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.45)',
              fontSize: 20,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {sources.length > 1 && onSourceChange ? (
          <div style={{ padding: '0 16px 6px', flexShrink: 0 }}>
            <select
              value={currentSource || ''}
              onChange={(e) => {
                const item = sources.find((s) => s.source === e.target.value);
                if (item) onSourceChange(item.source, item.id, item.title);
              }}
              style={{
                width: '100%',
                background: '#16161a',
                color: 'rgba(255,255,255,0.55)',
                border: 'none',
                borderRadius: 3,
                padding: '7px 8px',
                fontSize: 12,
                outline: 'none',
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

        {pages.length > 1 ? (
          <div
            style={{
              padding: '4px 16px 10px',
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              flexShrink: 0,
            }}
          >
            {pages.map((p) => {
              const start = p * PAGE_SIZE + 1;
              const end = Math.min((p + 1) * PAGE_SIZE, totalEpisodes);
              const active = p === pageIndex;
              return (
                <button
                  key={p}
                  onClick={() => setPageIndex(p)}
                  style={{
                    flexShrink: 0,
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: active ? '#22d3ee' : '#16161a',
                    color: active ? '#04191c' : 'rgba(255,255,255,0.5)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {start}-{end}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 16px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            alignContent: 'start',
          }}
        >
          {visibleEpisodes.map((i) => {
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
                  aspectRatio: '1 / 1',
                  border: 'none',
                  borderRadius: 2,
                  background: active ? '#232327' : '#16161a',
                  color: active ? '#22d3ee' : '#fff',
                  fontSize: 15,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
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
