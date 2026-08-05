import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import { logger } from './logger';

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes interpolated values.
    escapeValue: false,
  },
  returnEmptyString: false,
});

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Applies the persisted settings language to i18next. Unknown or missing
 * codes fall back to English so a stale setting can never blank the UI.
 */
export function applyLanguage(language: string | null | undefined): Promise<unknown> {
  let target: SupportedLanguage = DEFAULT_LANGUAGE;
  if (language) {
    if (isSupportedLanguage(language)) {
      target = language;
    } else {
      logger.warn('Unknown language code in settings, falling back to English', { language });
    }
  }
  if (i18n.language === target) {
    return Promise.resolve();
  }
  return i18n.changeLanguage(target);
}

export default i18n;
