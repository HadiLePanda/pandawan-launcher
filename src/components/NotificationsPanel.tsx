import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, Bell } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { LauncherNotification } from '@/lib/store';

interface NotificationsPanelProps {
  notifications: LauncherNotification[];
  onMarkAllRead: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function NotificationsPanel({
  notifications,
  onMarkAllRead,
  onClear,
  onClose,
}: NotificationsPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
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
    <div ref={panelRef} className="notifications-panel">
      <div className="notifications-panel-header">
        <span className="notifications-panel-title">{t('notificationsPanel.title')}</span>
        <div className="notifications-panel-actions">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="notifications-panel-action"
            title={t('notificationsPanel.markAllRead')}
            aria-label={t('notificationsPanel.markAllRead')}
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClear}
            className="notifications-panel-action"
            title={t('notificationsPanel.clear')}
            aria-label={t('notificationsPanel.clear')}
          >
            <Trash2 className="w-4 h-4" />
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
              className={cn('notifications-panel-item', !n.read && 'notifications-panel-item-unread')}
            >
              <div className="notifications-panel-item-body">
                <span className="notifications-panel-item-title">{n.title}</span>
                <span className="notifications-panel-item-text">{n.body}</span>
                <span className="notifications-panel-item-date">{formatDate(n.date)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
