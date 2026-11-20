import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { OverviewPage } from '@/pages/OverviewPage';
import { NewsPage } from '@/pages/NewsPage';
import { StatusPage } from '@/pages/StatusPage';
import { useHealth } from '@/hooks/useHealth';
import { getAppMode } from '@/services/api';
import type { Route } from '@/types/routes';

function App() {
  const [route, setRoute] = useState<Route>('overview');
  const health = useHealth(30_000);
  /** Actual backend data-mode selection ('live' | 'demo'); 'unknown' when the
   * backend is unreachable or has not answered yet. No heuristic guessing:
   * the DEMO DATA badge only shows what the backend explicitly reports. */
  const [appMode, setAppMode] = useState<'live' | 'demo' | 'unknown'>('unknown');

  const refreshAppMode = useCallback((online: boolean) => {
    if (!online) {
      setAppMode('unknown');
      return;
    }
    let cancelled = false;
    getAppMode().then((payload) => {
      if (!cancelled) setAppMode(payload.mode);
    }).catch(() => {
      if (!cancelled) setAppMode('unknown');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = refreshAppMode(health.connection === 'online');
    return cleanup;
  }, [health.connection, health.lastUpdated, refreshAppMode]);

  // NewsPage's mode switch dispatches this so the shell badge is never stale.
  useEffect(() => {
    const handler = (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (mode === 'live' || mode === 'demo') setAppMode(mode);
    };
    window.addEventListener('app-mode-changed', handler);
    return () => window.removeEventListener('app-mode-changed', handler);
  }, []);

  const demoMode = appMode === 'demo';

  const handleRefresh = useCallback(() => {
    health.refresh();
  }, [health]);

  return (
    <AppShell
      active={route}
      onNavigate={setRoute}
      connection={health.connection}
      demoMode={demoMode}
      refreshing={health.connection === 'connecting'}
      onRefresh={handleRefresh}
    >
      {route === 'overview' ? (
        <OverviewPage
          health={health.app}
          connection={health.connection}
          healthError={health.error}
          onNavigate={setRoute}
        />
      ) : null}
      {route === 'news' ? (
        <NewsPage />
      ) : null}
      {route === 'status' ? (
        <StatusPage
          app={health.app}
          service={health.service}
          connection={health.connection}
          error={health.error}
          lastUpdated={health.lastUpdated}
        />
      ) : null}
    </AppShell>
  );
}

export default App;