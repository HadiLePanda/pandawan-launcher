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
