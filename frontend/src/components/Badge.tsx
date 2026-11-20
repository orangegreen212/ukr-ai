import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'ukon' | 'yellow' | 'success' | 'warning' | 'danger' | 'demo';
  size?: 'sm' | 'md';
  className?: string;
}

const TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-base-800 text-slate-300 border-base-700',
  ukon: 'bg-ukon-900/40 text-ukon-200 border-ukon-700/60',
  yellow: 'bg-ukyellow-500/15 text-ukyellow-200 border-ukyellow-500/40',
  success: 'bg-success/15 text-success border-success/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  danger: 'bg-danger/15 text-danger border-danger/40',
  demo: 'bg-ukyellow-500/15 text-ukyellow-200 border-ukyellow-500/40',
};

const SIZES: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
};

export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium uppercase tracking-wider border ${TONES[tone]} ${SIZES[size]} ${className}`}
    >
      {children}
    </span>
  );
}
