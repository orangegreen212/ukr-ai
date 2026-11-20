import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import type { Route } from '@/types/routes';
import type { BackendConnectionState } from '@/hooks/useHealth';

interface AppShellProps {
  active: Route;
  onNavigate: (route: Route) => void;
  connection: BackendConnectionState;
  demoMode: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}

export function AppShell({
  active,
  onNavigate,
  connection,
  demoMode,
  refreshing,
  onRefresh,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-base-950">
      <aside className="hidden lg:flex w-64 shrink-0">
        <Sidebar active={active} onNavigate={onNavigate} connection={connection} />
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Primary navigation"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[80%] shadow-elevated animate-fade-in">
            <Sidebar
              active={active}
              onNavigate={(r) => {
                onNavigate(r);
                setMobileOpen(false);
              }}
              connection={connection}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          route={active}
          connection={connection}
          demoMode={demoMode}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
