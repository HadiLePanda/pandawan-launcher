import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface LoadingScreenProps {
  isOpen: boolean;
  status?: string;
}

export function LoadingScreen({ isOpen, status = 'Loading…' }: LoadingScreenProps) {
  const [isVisible, setIsVisible] = useState(isOpen);
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    let hideTimer: number;

    if (isOpen) {
      setShouldRender(true);
      const showTimer = window.setTimeout(() => setIsVisible(true), 10);
      return () => window.clearTimeout(showTimer);
    }

    setIsVisible(false);
    hideTimer = window.setTimeout(() => setShouldRender(false), 500);

    return () => window.clearTimeout(hideTimer);
  }, [isOpen]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-canvas/95 backdrop-blur-xl',
        'transition-all duration-500 ease-out',
        isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'
      )}
      aria-live="polite"
      aria-busy={isOpen}
    >
      <div className="flex flex-col items-center gap-6 max-w-md px-6 text-center">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-hover shadow-glow animate-glow-pulse flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M10 4h8c5.523 0 10 4.477 10 10s-4.477 10-10 10h-8V4z"
                fill="#0c0d12"
              />
              <path
                d="M14 10h4c2.21 0 4 1.79 4 4s-1.79 4-4 4h-4v-8z"
                fill="#f0dea3"
              />
            </svg>
          </div>
        </div>

        <div className="space-y-1">
          <h1 className="title-1 gradient-text-accent">Pandawan</h1>
          <p className="text-xs font-semibold tracking-[0.15em] text-ink-muted uppercase">
            Launcher
          </p>
        </div>

        <div className="w-64 h-1.5 rounded-full overflow-hidden bg-surface border border-border">
          <div className="h-full w-full shimmer" />
        </div>

        <p className="caption text-ink-dim min-h-[1.25rem]">{status}</p>
      </div>
    </div>
  );
}
