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
          <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
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
