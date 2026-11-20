import { LayoutDashboard, Newspaper, Activity, X, Menu } from 'lucide-react';
import type { Route } from '@/types/routes';
import { ROUTES } from '@/types/routes';
import { Badge } from '@/components/Badge';
import { StatusDot } from '@/components/StatusDot';
import type { BackendConnectionState } from '@/hooks/useHealth';
import { API_BASE_URL } from '@/config';

interface SidebarProps {
  active: Route;
  onNavigate: (route: Route) => void;
  connection: BackendConnectionState;
  onCloseMobile?: () => void;
}

const NAV_ITEMS: { route: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { route: 'overview', label: ROUTES.overview.label, icon: LayoutDashboard },
  { route: 'news', label: ROUTES.news.label, icon: Newspaper },
  { route: 'status', label: ROUTES.status.label, icon: Activity },
];

export function Sidebar({ active, onNavigate, connection, onCloseMobile }: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-base-900 border-r border-base-800">
      <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-base-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-base-700">
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 bg-ukon-500" />
              <div className="flex-1 bg-ukyellow-400" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white leading-tight">
              Ukrainian AI Intelligence
            </p>
            <p className="truncate text-[11px] text-slate-500 leading-tight">
              Local analysis workspace
            </p>
          </div>
        </div>
        {onCloseMobile ? (
          <button
            type="button"
            className="lg:hidden btn-ghost px-2 py-1"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.route === active;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-base-800 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-base-850'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon
                size={18}
                className={isActive ? 'text-ukon-300' : 'text-slate-500 group-hover:text-slate-300'}
                aria-hidden
              />
              <span className="truncate">{item.label}</span>
              {isActive ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ukon-400" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-base-800 px-3 py-3 space-y-2">
        <div className="flex items-center justify-between rounded-md bg-base-850 px-3 py-2 border border-base-800">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={connection} pulse={connection === 'connecting'} />
            <span className="text-[11px] text-slate-400 truncate">
              {connection === 'online'
                ? 'Local backend'
                : connection === 'connecting'
                  ? 'Connecting…'
                  : 'Not reachable'}
            </span>
          </div>
          <Badge tone="neutral" size="sm">
            LOCAL
          </Badge>
        </div>
        <p className="px-1 text-[10px] leading-snug text-slate-600">
          {API_BASE_URL}
        </p>
      </div>
    </div>
  );
}

export function MobileNavToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="lg:hidden btn-ghost px-2 py-1"
      onClick={onClick}
      aria-label="Open navigation"
    >
      <Menu size={20} />
    </button>
  );
}
