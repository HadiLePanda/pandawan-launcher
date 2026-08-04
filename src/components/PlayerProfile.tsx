import { useTranslation } from 'react-i18next';
import { X, User } from 'lucide-react';

interface PlayerProfileProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlayerProfile({ isOpen, onClose }: PlayerProfileProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="modal animate-slide-up max-w-md">
        <div className="modal-header">
          <h3 className="title-3">{t('playerProfile.title')}</h3>
          <button onClick={onClose} className="icon-btn" aria-label={t('common.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="modal-body">
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-24 h-24 rounded-full bg-surface border border-border flex items-center justify-center">
              <User className="w-10 h-10 text-ink-muted" />
            </div>
            <div className="text-center">
              <h4 className="title-3">{t('playerProfile.playerName')}</h4>
              <p className="caption">{t('playerProfile.statusOffline')}</p>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-surface border border-border">
            <p className="body text-center">{t('playerProfile.comingSoonDescription')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
