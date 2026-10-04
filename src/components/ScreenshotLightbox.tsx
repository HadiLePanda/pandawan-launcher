import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { useModalDialog } from './modalFocus';
import { cn } from '@/lib/utils';

export function ScreenshotLightbox({
  shots,
  name,
  index,
  onIndex,
  onClose,
}: {
  shots: string[];
  name: string;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose });

  const multiple = shots.length > 1;
  const go = (delta: number) => onIndex((index + delta + shots.length) % shots.length);

  // Measured on the stage, not the image: a letterboxed shot still splits evenly.
  const step = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!multiple) return;
    const box = event.currentTarget.getBoundingClientRect();
    go(event.clientX - box.left < box.width / 2 ? -1 : 1);
  };

  return (
    <div className="shot-lightbox-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="shot-lightbox"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('gamePage.screenshots')}
      >
        <div className="shot-lightbox-bar">
          <span className="shot-lightbox-count">
            {index + 1} / {shots.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shot-lightbox-close"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="shot-lightbox-stage" onClick={step}>
          <img
            src={shots[index]}
            alt={`${name} ${index + 1}`}
            className="shot-lightbox-image"
            draggable={false}
          />

          {multiple && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                className="shot-lightbox-nav shot-lightbox-prev"
                title={t('gamePage.previousScreenshot')}
                aria-label={t('gamePage.previousScreenshot')}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                className="shot-lightbox-nav shot-lightbox-next"
                title={t('gamePage.nextScreenshot')}
                aria-label={t('gamePage.nextScreenshot')}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Thumbnails, so a shot is reachable without stepping through every one. */}
      {multiple && (
        <div className="shot-lightbox-thumbs">
          {shots.map((shot, i) => (
            <button
              key={shot}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onIndex(i);
              }}
              className={cn('shot-lightbox-thumb', i === index && 'shot-lightbox-thumb-active')}
              aria-label={`${name} ${i + 1}`}
              aria-current={i === index}
            >
              <img src={shot} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
