import { X, User } from 'lucide-react';

interface PlayerProfileProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlayerProfile({ isOpen, onClose }: PlayerProfileProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="modal animate-slide-up max-w-md">
        <div className="modal-header">
          <h3 className="title-3">Player Profile</h3>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="modal-body">
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-24 h-24 rounded-full bg-surface border border-border flex items-center justify-center">
              <User className="w-10 h-10 text-ink-muted" />
            </div>
            <div className="text-center">
              <h4 className="title-3">Player</h4>
              <p className="caption">Offline</p>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-surface border border-border">
            <p className="body text-center">
              Account features are coming soon. Here you'll manage your Pandawan account, friends
              list, and purchases.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
