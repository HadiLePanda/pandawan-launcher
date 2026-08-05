import { X, ShieldCheck, AlertTriangle, FileCheck, FileX, FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Game, VerificationResult } from '@/types';
import { cn } from '@/lib/utils';

interface VerifyGameModalProps {
  game: Game | null;
  result: VerificationResult | null;
  error: string | null;
  onClose: () => void;
}

export function VerifyGameModal({ game, result, error, onClose }: VerifyGameModalProps) {
  const { t } = useTranslation();

  if (!game) return null;

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="modal animate-slide-up max-w-lg">
        <div className="modal-header">
          <div className="cluster cluster-md">
            <ShieldCheck className="w-5 h-5 text-ember" />
            <h3 className="title-3">{t('verifyGameModal.title', { game: game.info.name })}</h3>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label={t('common.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="modal-body">
          {!result && !error && (
            <p className="body text-ink-muted">{t('verifyGameModal.verifying')}</p>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="body">{error}</span>
            </div>
          )}

          {result && (
            <div className="stack-md">
              <div
                className={cn(
                  'p-4 rounded-xl border flex items-center gap-3',
                  result.is_valid
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                )}
              >
                {result.is_valid ? (
                  <>
                    <FileCheck className="w-5 h-5 shrink-0" />
                    <span className="body font-medium">{t('verifyGameModal.allValid')}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span className="body font-medium">{t('verifyGameModal.needsRepair')}</span>
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatBox
                  icon={FileCheck}
                  label={t('verifyGameModal.stats.valid')}
                  value={result.valid_files}
                />
                <StatBox
                  icon={FileX}
                  label={t('verifyGameModal.stats.invalid')}
                  value={result.invalid_files.length}
                />
                <StatBox
                  icon={FileQuestion}
                  label={t('verifyGameModal.stats.missing')}
                  value={result.missing_files.length}
                />
              </div>

              {(result.invalid_files.length > 0 || result.missing_files.length > 0) && (
                <div className="p-4 rounded-xl bg-surface border border-border max-h-60 overflow-auto">
                  <h4 className="title-3 mb-2">{t('verifyGameModal.problemFiles')}</h4>
                  <ul className="stack-xs">
                    {result.invalid_files.map((path) => (
                      <li key={path} className="caption text-amber-400">
                        {t('verifyGameModal.fileInvalid', { path })}
                      </li>
                    ))}
                    {result.missing_files.map((path) => (
                      <li key={path} className="caption text-red-400">
                        {t('verifyGameModal.fileMissing', { path })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-primary">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="p-3 rounded-xl bg-surface border border-border flex flex-col items-center gap-1">
      <Icon className="w-4 h-4 text-ink-muted" />
      <span className="text-lg font-semibold">{value}</span>
      <span className="caption">{label}</span>
    </div>
  );
}
