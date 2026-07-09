import { useState } from 'react';
import { X, Search, Download, Globe, HardDrive } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { GameInfo } from '@/types';

interface AddGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: (gameId: string) => void;
  availableGames: GameInfo[];
}

export function AddGameModal({ isOpen, onClose, onInstall, availableGames }: AddGameModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGame, setSelectedGame] = useState<GameInfo | null>(null);

  if (!isOpen) return null;

  const filteredGames = availableGames.filter((game) =>
    game.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="modal animate-slide-up max-w-4xl h-[700px] flex-col">
        <div className="modal-header">
          <div>
            <h2 className="title-2">Install a Game</h2>
            <p className="caption mt-1">Select a game to install from your library</p>
          </div>
          <button onClick={onClose} className="icon-btn">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 pb-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-muted" />
            <input
              type="text"
              placeholder="Search games..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl"
            />
          </div>
        </div>

        <div className="modal-body">
          {filteredGames.length > 0 ? (
            <div className="game-list-grid">
              {filteredGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  isSelected={selectedGame?.id === game.id}
                  onClick={() => setSelectedGame(game)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Search className="w-8 h-8 text-ink-dim" />
              </div>
              <h3 className="empty-state-title">No games found</h3>
              <p className="empty-state-desc">Try a different search term</p>
            </div>
          )}
        </div>

        <div className="modal-footer justify-between">
          <div>
            {selectedGame && (
              <div className="cluster cluster-md text-sm body">
                <span className="cluster cluster-sm">
                  <HardDrive className="w-4 h-4" />
                  {formatBytes(selectedGame.sizeBytes)}
                </span>
                <span className="cluster cluster-sm">
                  <Globe className="w-4 h-4" />
                  {selectedGame.developer}
                </span>
              </div>
            )}
          </div>
          <div className="cluster cluster-md">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={() => selectedGame && onInstall(selectedGame.id)}
              disabled={!selectedGame}
              className={cn(
                'btn',
                selectedGame ? 'btn-primary' : 'btn-secondary cursor-not-allowed'
              )}
            >
              <Download className="w-4 h-4" />
              Install
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GameCardProps {
  game: GameInfo;
  isSelected: boolean;
  onClick: () => void;
}

function GameCard({ game, isSelected, onClick }: GameCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn('game-list-item', isSelected && 'game-list-item-selected')}
    >
      <div className="game-list-icon">
        {game.iconUrl ? (
          <img src={game.iconUrl} alt={game.name} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-light to-surface flex items-center justify-center">
            <span className="text-xl font-bold text-ink-muted">
              {game.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="game-list-info">
        <h3 className="game-list-title">{game.name}</h3>
        <p className="game-list-subtitle">{game.developer}</p>
        <div className="game-list-meta">
          <span>{formatBytes(game.sizeBytes)}</span>
          <span className="game-list-meta-dot" />
          <span>v{game.version}</span>
        </div>
      </div>
    </button>
  );
}
