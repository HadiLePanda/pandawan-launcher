import { useState } from 'react';
import { X, Search, Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isGamePinned } from '@/lib/pins';
import type { GameInfo } from '@/types';

interface PinManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: GameInfo[];
  unpinnedGameIds: string[];
  onTogglePin: (gameId: string) => void;
}

export function PinManagerModal({
  isOpen,
  onClose,
  games,
  unpinnedGameIds,
  onTogglePin,
}: PinManagerModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredGames = games.filter((game) =>
    game.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="modal modal-pin-manager animate-slide-up">
        <div className="modal-header">
          <div>
            <h2 className="title-2">{t('pinModal.title')}</h2>
            <p className="caption mt-1">{t('pinModal.subtitle')}</p>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label={t('common.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-4">
          <div className="pin-search-wrap">
            <Search className="pin-search-icon" />
            <input
              type="text"
              placeholder={t('pinModal.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pin-search"
            />
          </div>
        </div>

        <div className="modal-body">
          {filteredGames.length > 0 ? (
            <div className="pin-list">
              {filteredGames.map((game) => (
                <PinCard
                  key={game.id}
                  game={game}
                  pinned={isGamePinned(game.id, unpinnedGameIds)}
                  onToggle={() => onTogglePin(game.id)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Search className="w-8 h-8 text-ink-dim" />
              </div>
              <h3 className="empty-state-title">{t('pinModal.emptyTitle')}</h3>
              <p className="empty-state-desc">{t('pinModal.emptyDescription')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PinCardProps {
  game: GameInfo;
  pinned: boolean;
  onToggle: () => void;
}

function PinCard({ game, pinned, onToggle }: PinCardProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn('pin-card', pinned ? 'pin-card-pinned' : 'pin-card-unpinned')}
      title={game.name}
    >
      <div className="pin-card-icon">
        {game.iconUrl ? (
          <img src={game.iconUrl} alt="" />
        ) : (
          <span className="pin-card-icon-fallback">{game.name.charAt(0).toUpperCase()}</span>
        )}
      </div>

      <div className="pin-card-info">
        <span className="pin-card-title">{game.name}</span>
      </div>

      <span className="pin-card-toggle" aria-hidden="true">
        {pinned ? (
          <Pin className="pin-card-toggle-pinned" />
        ) : (
          <PinOff className="pin-card-toggle-off" />
        )}
      </span>
    </button>
  );
}
