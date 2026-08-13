import { useTranslation } from 'react-i18next';
import { Coins, Gamepad2, Package } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { logger } from '@/lib/logger';

const STORE_URL = 'https://pandawancorp.com/store';

interface StoreCardProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  visitLabel: string;
}

function StoreCard({ icon, name, description, visitLabel }: StoreCardProps) {
  const handleClick = async () => {
    try {
      await open(STORE_URL);
    } catch (err) {
      logger.error('Failed to open store URL', { url: STORE_URL, error: String(err) });
    }
  };

  return (
    <button type="button" className="store-card" onClick={handleClick}>
      <div className="store-card-icon">{icon}</div>
      <h3 className="store-card-title">{name}</h3>
      <p className="store-card-desc">{description}</p>
      <span className="store-card-btn">{visitLabel}</span>
    </button>
  );
}

export function StorePlaceholder() {
  const { t } = useTranslation();

  return (
    <div className="store-page">
      <div className="store-header">
        <h1 className="store-title">{t('store.title')}</h1>
        <p className="store-subtitle">{t('store.subtitle')}</p>
      </div>
      <div className="store-grid">
        <StoreCard
          icon={<Coins className="w-8 h-8" />}
          name={t('store.card.currency.name')}
          description={t('store.card.currency.description')}
          visitLabel={t('store.visitButton')}
        />
        <StoreCard
          icon={<Gamepad2 className="w-8 h-8" />}
          name={t('store.card.game.name')}
          description={t('store.card.game.description')}
          visitLabel={t('store.visitButton')}
        />
        <StoreCard
          icon={<Package className="w-8 h-8" />}
          name={t('store.card.bundle.name')}
          description={t('store.card.bundle.description')}
          visitLabel={t('store.visitButton')}
        />
      </div>
    </div>
  );
}
