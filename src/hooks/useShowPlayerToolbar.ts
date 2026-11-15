import { useEffect, useState } from 'react';

interface RuntimeConfig {
  SHOW_PLAYER_TOOLBAR?: boolean;
}

export function useShowPlayerToolbar(): boolean {
  const [showToolbar, setShowToolbar] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG as RuntimeConfig;
      setShowToolbar(runtimeConfig?.SHOW_PLAYER_TOOLBAR !== false);
    }
  }, []);

  return showToolbar;
}
