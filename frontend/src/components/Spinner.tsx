import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  className?: string;
  'aria-label'?: string;
}

export function Spinner({ size = 16, className = '', 'aria-label': label }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      className={`animate-spin-slow ${className}`}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  );
}
