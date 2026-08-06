import { describe, it, expect, beforeEach } from 'vitest';
import i18n, { applyLanguage } from './i18n';

describe('i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('initializes with English as the default and fallback language', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(i18n.options.fallbackLng).toContain('en');
  });

  it('resolves the core chrome keys in English', () => {
    expect(i18n.t('topBar.games')).toBe('Games');
    expect(i18n.t('common.retry')).toBe('Retry');
    expect(i18n.t('app.connectionBanner')).toContain('unreachable');
    expect(i18n.t('gamesPage.emptyTitle')).toBe('No Games Yet');
    expect(i18n.t('windowControls.close')).toBe('Close');
  });

  it.each([['fr', 'Jeux', 'Fermer', 'Aucun jeu pour le moment', 'Réessayer']])(
    'resolves the core chrome keys in %s',
    async (language, games, close, emptyTitle, retry) => {
      await i18n.changeLanguage(language);

      expect(i18n.t('topBar.games')).toBe(games);
      expect(i18n.t('windowControls.close')).toBe(close);
      expect(i18n.t('gamesPage.emptyTitle')).toBe(emptyTitle);
      expect(i18n.t('common.retry')).toBe(retry);
    }
  );

  it('interpolates values into translated strings', () => {
    expect(i18n.t('gamePage.filesProgress', { completed: 1, total: 3 })).toBe('1 / 3 files');
  });

  it('falls back to English for keys missing in the active language', async () => {
    i18n.addResource('en', 'translation', 'test.onlyEnglish', 'Only in English');
    await i18n.changeLanguage('fr');

    expect(i18n.t('test.onlyEnglish')).toBe('Only in English');
  });

  it('returns the key itself for completely unknown keys', () => {
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
  });

  describe('applyLanguage', () => {
    it('applies a supported language from settings', async () => {
      await applyLanguage('fr');

      expect(i18n.language).toBe('fr');
      expect(i18n.t('topBar.games')).toBe('Jeux');
    });

    it('falls back to English for an unknown language code', async () => {
      await applyLanguage('fr');
      await applyLanguage('xx');

      expect(i18n.language).toBe('en');
    });

    it('defaults to English when settings are missing', async () => {
      await applyLanguage('fr');
      await applyLanguage(undefined);

      expect(i18n.language).toBe('en');
    });
  });
});
