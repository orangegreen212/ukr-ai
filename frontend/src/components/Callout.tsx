import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

interface CalloutProps {
  variant?: 'info' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

const VARIANTS: Record<NonNullable<CalloutProps['variant']>, { wrap: string; icon: ReactNode }> = {
  info: {
    wrap: 'border-base-700 bg-base-850 text-slate-300',
    icon: <Info size={16} className="text-ukon-300" aria-hidden />,
  },
  warning: {
    wrap: 'border-warning/40 bg-warning/10 text-warning',
    icon: <AlertTriangle size={16} className="text-warning" aria-hidden />,
  },
  error: {
    wrap: 'border-danger/40 bg-danger/10 text-danger',
    icon: <XCircle size={16} className="text-danger" aria-hidden />,
  },
};

export function Callout({
  variant = 'info',
  title,
  children,
  className = '',
  icon,
}: CalloutProps) {
  const v = VARIANTS[variant];
  return (
    <div className={`flex gap-3 rounded-md border px-3.5 py-3 ${v.wrap} ${className}`}>
      <div className="mt-0.5 shrink-0">{icon ?? v.icon}</div>
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-sm font-semibold leading-tight">{title}</p> : null}
        <div className="text-sm leading-relaxed text-slate-300">{children}</div>
      </div>
    </div>
  );
}
