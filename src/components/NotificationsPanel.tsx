import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Mail, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { LauncherNotification } from '@/lib/store';

interface NotificationsPanelProps {
  notifications: LauncherNotification[];
  onMarkAllRead: () => void;
  /** Remove one notification. */
  onDismiss: (id: string) => void;
  /** Empty the whole list, once everything in it is already read. */
  onClearAll: () => void;
  onClose: () => void;
}

export function NotificationsPanel({
  notifications,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onClose,
}: NotificationsPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  // One button, two jobs, chosen by what is left to read. Mark-all-read and
  // clear-all were two permanently visible icons whose meaning depended on
  // state the user had to infer; this one states its own state.
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Only the bell re-toggles this panel; clicking any other panel trigger
      // (the profile button) must close it, or two popovers end up stacked in
      // the same corner.
      if ((e.target as Element).closest('[data-panel-trigger="notifications"]')) return;
      if (!panelRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="notifications-panel"
      role="dialog"
      aria-labelledby="notifications-panel-title"
    >
      <div className="notifications-panel-header">
        <span id="notifications-panel-title" className="notifications-panel-title">
          {t('notificationsPanel.title')}
        </span>
        <div className="notifications-panel-actions">
          {/* Mark all read while there is anything to mark. Once everything is
                        read the same control clears the list, and its icon becomes an
                        X so the button never shows one that disagrees with what
                        pressing it does. */}
          <button
            type="button"
            onClick={unread > 0 ? onMarkAllRead : onClearAll}
            className="notifications-panel-action notifications-panel-action-adaptive"
            title={unread > 0 ? t('notificationsPanel.markAllRead') : t('notificationsPanel.clear')}
            aria-label={
              unread > 0 ? t('notificationsPanel.markAllRead') : t('notificationsPanel.clear')
            }
            data-state={unread > 0 ? 'unread' : 'read'}
          >
            {unread > 0 ? (
              <Mail className="w-4 h-4 notifications-panel-action-read-icon" />
            ) : (
              <X className="w-4 h-4 notifications-panel-action-clear-icon" />
            )}
          </button>
        </div>
      </div>

      <div className="notifications-panel-list">
        {notifications.length === 0 ? (
          <div className="notifications-panel-empty">
            <Bell className="w-8 h-8 mb-2 opacity-40" />
            <p>{t('notificationsPanel.empty')}</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                'notifications-panel-item',
                !n.read && 'notifications-panel-item-unread'
              )}
              // Unread is a 2px blue border and nothing else, so it is invisible to
              // anyone not distinguishing that blue. The word is the signal.
              aria-label={!n.read ? `${n.title} - ${t('notificationsPanel.unread')}` : n.title}
            >
              <div className="notifications-panel-item-body">
                <span className="notifications-panel-item-title">{n.title}</span>
                <span className="notifications-panel-item-text">{n.body}</span>
                <span className="notifications-panel-item-date">{formatDate(n.date)}</span>
              </div>
              {/* Revealed on hover so a list stays quiet, but not
                  display:none: a keyboard user still has to reach it, and
                  opacity keeps it in the tab order and hit-testable. */}
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                className="notifications-panel-item-dismiss"
                title={t('notificationsPanel.dismiss')}
                aria-label={`${t('notificationsPanel.dismiss')}: ${n.title}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
