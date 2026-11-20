import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-base-800 text-slate-400">
        {icon ?? <Inbox size={22} aria-hidden />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        {description ? (
          <p className="text-sm text-slate-400 max-w-md">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
