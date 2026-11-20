import type { LucideIcon } from 'lucide-react';

export interface StatusDotProps {
  status: 'online' | 'offline' | 'degraded' | 'unknown' | 'connecting' | 'demo';
  label?: string;
  pulse?: boolean;
  icon?: LucideIcon;
}

const COLORS: Record<StatusDotProps['status'], string> = {
  online: 'bg-success',
  offline: 'bg-danger',
  degraded: 'bg-warning',
  unknown: 'bg-base-500',
  connecting: 'bg-ukon-400',
  demo: 'bg-ukyellow-400',
};

export function StatusDot({ status, label, pulse = false, icon: Icon }: StatusDotProps) {
  const color = COLORS[status];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${color}`}
            style={{ animationDuration: '1.8s' }}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {Icon ? (
        <Icon size={14} className="text-slate-300" aria-hidden />
      ) : null}
      {label ? <span className="text-sm text-slate-300">{label}</span> : null}
    </span>
  );
}
