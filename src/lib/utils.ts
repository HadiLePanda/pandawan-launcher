import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import i18n from './i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 0): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bps: number): string {
  return formatBytes(bps) + '/s';
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return '0 min';

  if (seconds < 3600) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }

  // Match formatBytes: one decimal, trailing .0 stripped via parseFloat.
  return `${parseFloat((seconds / 3600).toFixed(1))} h`;
}

export function formatPlaytimeDecimal(seconds: number): string {
  if (seconds <= 0) return '0h';
  return `${(seconds / 3600).toFixed(1)}h`;
}

import { useEffect, useRef, useState } from 'react';
import type { DownloadProgressSnapshot } from './download-channel';

export interface SmoothDownload {
  /** Interpolated percentage, 0-100. Glides toward the real value. */
  percent: number;
  /** Seconds remaining at the observed rate, or null when it cannot be known. */
  etaSeconds: number | null;
}

/**
 * Smooth a download snapshot for display.
 *
 * The backend reports on a 500ms cadence, which is fine for correctness but
 * renders as a bar that lurches in visible steps. This eases the displayed value
 * toward the reported one every frame, so the bar glides.
 *
 * Two details keep this honest rather than decorative:
 *
 * - It never runs *ahead* of the real value. A download can stall or be cut
 *   short, and a bar that keeps creeping upward through a stalled transfer is
 *   worse than an honest one.
 * - It snaps when close, so it does not asymptotically crawl toward a target it
 *   will never quite reach.
 *
 * The ETA uses a rolling average of observed throughput rather than the
 * instantaneous rate, because a single sample can be a burst that never repeats
 * and would produce a wildly optimistic countdown.
 */
export function useSmoothDownload(snapshot: DownloadProgressSnapshot | undefined): SmoothDownload {
  const target = snapshot?.overallProgress ?? 0;
  const [percent, setPercent] = useState(target);

  const displayedRef = useRef(target);
  const samplesRef = useRef<Array<{ at: number; bytes: number }>>([]);
  // The bytes for the current snapshot, held in a ref so the animation effect
  // does not depend on the snapshot object. It is a fresh object on every
  // backend event, so depending on it would restart the loop several times a
  // second and the easing would never get anywhere.
  const bytesRef = useRef(snapshot?.downloadedBytes ?? 0);

  useEffect(() => {
    bytesRef.current = snapshot?.downloadedBytes ?? 0;
  }, [snapshot?.downloadedBytes]);

  useEffect(() => {
    samplesRef.current.push({ at: Date.now(), bytes: bytesRef.current });
    // Keep a short window; older samples describe a transfer that is done.
    if (samplesRef.current.length > 12) samplesRef.current.shift();

    let frame = 0;
    const step = () => {
      const current = displayedRef.current;
      const delta = target - current;

      // Snap when close, or when the real value moved backwards (a retry reset).
      if (Math.abs(delta) < 0.15 || delta < 0) {
        if (current !== target) {
          displayedRef.current = target;
          setPercent(target);
        }
        return;
      }

      // Close roughly 8% of the remaining gap per frame: fast enough to feel
      // responsive, slow enough to read as motion rather than a jump.
      const next = current + delta * 0.08;
      displayedRef.current = next;
      setPercent(next);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Deliberately keyed on the reported percentage rather than the whole
    // snapshot object: the snapshot is a fresh object on every backend event, so
    // depending on it would restart the animation loop several times a second
    // and the easing would never get anywhere. The sample push reads only the
    // bytes, which change exactly when `target` does.
  }, [target]);

  // ETA from average throughput across the sample window.
  const etaSeconds = (() => {
    if (!snapshot || target >= 100 || !snapshot.totalBytes) return null;
    const samples = samplesRef.current;
    if (samples.length < 2) return null;

    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsedMs = last.at - first.at;
    if (elapsedMs <= 0) return null;

    const bytesPerSecond = ((last.bytes - first.bytes) / elapsedMs) * 1000;
    if (bytesPerSecond <= 0) return null;

    const remaining = Math.max(0, snapshot.totalBytes - snapshot.downloadedBytes);
    return Math.round(remaining / bytesPerSecond);
  })();

  return { percent, etaSeconds };
}

export function formatNewsDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getTimeAgo(dateString: string | null): string {
  if (!dateString) return i18n.t('timeAgo.never');

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return formatDate(dateString);
  }
  if (diffDays > 0) {
    if (diffDays === 1) {
      return i18n.t('timeAgo.dayAgo', { count: diffDays });
    }
    return i18n.t('timeAgo.daysAgo', { count: diffDays });
  }
  if (diffHours > 0) {
    if (diffHours === 1) {
      return i18n.t('timeAgo.hourAgo', { count: diffHours });
    }
    return i18n.t('timeAgo.hoursAgo', { count: diffHours });
  }
  if (diffMins > 0) {
    if (diffMins === 1) {
      return i18n.t('timeAgo.minuteAgo', { count: diffMins });
    }
    return i18n.t('timeAgo.minutesAgo', { count: diffMins });
  }
  return i18n.t('timeAgo.justNow');
}
