import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function useCountUp(target: number, durationMs = 260): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  // Under prefers-reduced-motion the number must land on its target without
  // animating, so the snap is applied during render rather than from an effect -
  // an effect would paint the pre-change number for one frame first. The effect
  // below still runs, and skips the animation, so `fromRef` is kept in step
  // either way.
  if (prefersReducedMotion() && value !== target) {
    setValue(target);
  }

  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (target - from) * eased);
      setValue(next);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}
