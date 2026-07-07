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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-canvas/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl h-[700px] bg-canvas border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold">Install a Game</h2>
            <p className="text-sm text-ink-muted mt-1">
              Select a game to install from your library
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 pb-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-muted" />
            <input
              type="text"
              placeholder="Search games..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-border focus:outline-none focus:border-accent text-ink placeholder:text-ink-dim bg-transparent"
            />
          </div>
        </div>

        {/* Game Grid */}
        <div className="flex-1 overflow-auto p-6">
          {filteredGames.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
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
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-surface-light flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-ink-dim" />
              </div>
              <h3 className="font-semibold mb-2">No games found</h3>
              <p className="text-sm text-ink-muted">
                Try a different search term
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex items-center justify-between">
          <div>
            {selectedGame && (
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <HardDrive className="w-4 h-4" />
                  {formatBytes(selectedGame.sizeBytes)}
                </span>
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Globe className="w-4 h-4" />
                  {selectedGame.developer}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-ink-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedGame && onInstall(selectedGame.id)}
              disabled={!selectedGame}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors',
                selectedGame
                  ? 'bg-action hover:bg-action-hover text-white'
                  : 'bg-surface-light text-ink-muted cursor-not-allowed'
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
      className={cn(
        'flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
        isSelected
          ? 'bg-accent-muted border-accent'
          : 'bg-transparent border-border hover:border-ink-muted'
      )}
    >
      {/* Icon */}
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface flex-shrink-0">
        {game.iconUrl ? (
          <img
            src={game.iconUrl}
            alt={game.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-light to-surface flex items-center justify-center">
            <span className="text-xl font-bold text-ink-muted">
              {game.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold truncate">{game.name}</h3>
        <p className="text-sm text-ink-muted truncate">{game.developer}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-ink-dim">
          <span>{formatBytes(game.sizeBytes)}</span>
          <span className="w-1 h-1 rounded-full bg-ink-dim" />
          <span>v{game.version}</span>
        </div>
      </div>
    </button>
  );
}
