import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { Route } from '@/types/routes';
import { ROUTES } from '@/types/routes';
import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';
import { MobileNavToggle } from '@/components/Sidebar';
import type { BackendConnectionState } from '@/hooks/useHealth';

interface TopBarProps {
  route: Route;
  connection: BackendConnectionState;
  demoMode: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenMobileNav: () => void;
}

export function TopBar({
  route,
  connection,
  demoMode,
  refreshing,
  onRefresh,
  onOpenMobileNav,
}: TopBarProps) {
  const meta = ROUTES[route];
  return (
    <header className="sticky top-0 z-20 border-b border-base-800 bg-base-950/85 backdrop-blur supports-[backdrop-filter]:bg-base-950/70">
      <div className="flex items-center gap-3 px-4 lg:px-6 py-3">
        <MobileNavToggle onClick={onOpenMobileNav} />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-white leading-tight">
            {meta.label}
          </h1>
          <p className="truncate text-xs text-slate-500 leading-tight mt-0.5">
            {meta.description}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {demoMode ? (
            <Badge tone="demo" size="md">
              <span className="h-1.5 w-1.5 rounded-full bg-ukyellow-400" aria-hidden />
              DEMO DATA
            </Badge>
          ) : null}

          <span
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-base-800 bg-base-850 px-2.5 py-1 text-xs"
            aria-live="polite"
          >
            {connection === 'connecting' ? (
              <>
                <Spinner size={12} className="text-ukon-300" />
                <span className="text-slate-400">Connecting</span>
              </>
            ) : connection === 'online' ? (
              <>
                <Wifi size={13} className="text-success" aria-hidden />
                <span className="text-slate-300">Backend online</span>
              </>
            ) : (
              <>
                <WifiOff size={13} className="text-danger" aria-hidden />
                <span className="text-slate-400">Offline</span>
              </>
            )}
          </span>

          <button
            type="button"
            className="btn-ghost px-2 py-1.5"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh data"
            title="Refresh data"
          >
            <RefreshCw
              size={16}
              className={refreshing ? 'animate-spin-slow text-ukon-300' : 'text-slate-300'}
            />
          </button>
        </div>
      </div>
    </header>
  );
}
