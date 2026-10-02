import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { formatNewsDate } from '@/lib/utils';
import { handleImageError, resolveNewsImage } from '@/lib/cdn';
import type { NewsItem } from '@/types';

interface NewsArticleViewProps {
  article: NewsItem;
  gameName: string;
  gameIconUrl?: string | null;
  /** The game's banner, used as the article image when the item has none of its own. */
  gameBannerUrl?: string | null;
  onBack: () => void;
  onClose: () => void;
}

export function NewsArticleView({
  article,
  gameName,
  gameIconUrl,
  gameBannerUrl,
  onBack,
  onClose,
}: NewsArticleViewProps) {
  const { t } = useTranslation();

  return (
    <div className="h-full overflow-auto news-article-view">
      <div className="news-article-header">
        <button
          type="button"
          onClick={onBack}
          className="news-article-header-btn"
          aria-label={t('news.backToNews')}
          title={t('news.backToNews')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="news-article-header-btn"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/*
       * Always rendered, for the same reason as the news cards: an article with no
       * image shows its game's artwork, or a placeholder, rather than the page starting
       * mid-sentence.
       *
       * decoding="async" for the same reason, and more important here: this is the
       * largest image in the app, so decoding it on the main thread stalls the scroll
       * that just opened it.
       */}
      <div className="news-article-banner">
        <img
          decoding="async"
          src={resolveNewsImage(article, { bannerUrl: gameBannerUrl, iconUrl: gameIconUrl })}
          alt=""
          onError={handleImageError}
        />
      </div>

      <article className="news-article-body">
        <div className="news-article-game">
          {gameIconUrl ? (
            <img src={gameIconUrl} alt="" className="news-article-game-icon" />
          ) : (
            <div className="news-article-game-icon fallback" />
          )}
          <span className="news-article-game-name">{gameName}</span>
        </div>

        <h1 className="news-article-title">{article.title}</h1>
        <time className="news-article-date" dateTime={article.date}>
          {formatNewsDate(article.date)}
        </time>

        {article.excerpt && <p className="news-article-excerpt">{article.excerpt}</p>}

        {article.content && <div className="news-article-content">{article.content}</div>}
      </article>
    </div>
  );
}
