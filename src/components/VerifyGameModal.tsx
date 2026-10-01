import { useEffect, useRef } from 'react';
import { X, ShieldCheck, AlertTriangle, FileCheck, FileX, FileQuestion, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Game, VerificationResult, VerifyProgress } from '@/types';
import { cn } from '@/lib/utils';
import { useCountUp } from '@/lib/useCountUp';

interface VerifyGameModalProps {
  game: Game | null;
  result: VerificationResult | null;
  error: string | null;
  rows: VerifyProgress[];
  onClose: () => void;
}

export function VerifyGameModal({ game, result, error, rows, onClose }: VerifyGameModalProps) {
  const { t } = useTranslation();
  const streamRef = useRef<HTMLDivElement>(null);
  const running = !result && !error;
  const total = rows.length ? rows[rows.length - 1].total : 0;

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

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
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="body">{error}</span>
            </div>
          )}

          {running && (
            <div className="stack-md">
              <VerifyTally rows={rows} total={total} />
              <div className="verify-stream" ref={streamRef}>
                {rows.map((row) => (
                  <div key={row.path} className={cn('verify-row', `verify-row-${row.state}`)}>
                    <RowIcon state={row.state} />
                    <span className="truncate">{row.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && !error && <ResultView result={result} />}
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

function RowIcon({ state }: { state: VerifyProgress['state'] }) {
  if (state === 'valid') return <Check className="w-3.5 h-3.5 shrink-0" />;
  if (state === 'missing') return <FileQuestion className="w-3.5 h-3.5 shrink-0" />;
  return <FileX className="w-3.5 h-3.5 shrink-0" />;
}

function VerifyTally({ rows, total }: { rows: VerifyProgress[]; total: number }) {
  const { t } = useTranslation();
  const last = rows[rows.length - 1];
  const checked = useCountUp(rows.length);
  const valid = useCountUp(last?.valid ?? 0);
  const invalid = useCountUp(last?.invalid ?? 0);
  const missing = useCountUp(last?.missing ?? 0);
  const pct = total ? Math.round((rows.length / total) * 100) : 0;

  return (
    <div className="stack-sm">
      <div className="cluster cluster-between">
        <span className="body font-medium tabular-nums">
          {t('verifyGameModal.progress', { checked, total })}
        </span>
        <span className="caption tabular-nums">{pct}%</span>
      </div>
      <div className="verify-bar">
        <div className="verify-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="cluster cluster-md caption tabular-nums">
        <span className="text-emerald-400">
          {t('verifyGameModal.stats.valid')}: {valid}
        </span>
        <span className="text-amber-400">
          {t('verifyGameModal.stats.invalid')}: {invalid}
        </span>
        <span className="text-red-400">
          {t('verifyGameModal.stats.missing')}: {missing}
        </span>
      </div>
    </div>
  );
}

function ResultView({ result }: { result: VerificationResult }) {
  const { t } = useTranslation();
  const valid = useCountUp(result.valid_files);

  if (result.is_valid) {
    return (
      <div className="verify-verdict verify-verdict-ok">
        <FileCheck className="w-5 h-5 shrink-0" />
        <span className="body font-medium">{t('verifyGameModal.allValid')}</span>
        <span className="verify-verdict-count tabular-nums">{valid}</span>
      </div>
    );
  }

  const problems = [
    ...result.invalid_files.map((path) => ({ path, state: 'invalid' as const })),
    ...result.missing_files.map((path) => ({ path, state: 'missing' as const })),
  ];

  return (
    <div className="stack-md">
      <div className="verify-verdict verify-verdict-bad">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <span className="body font-medium">{t('verifyGameModal.needsRepair')}</span>
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

      <div className="verify-stream verify-stream-final">
        {problems.map(({ path, state }) => (
          <div key={path} className={cn('verify-row', `verify-row-${state}`)}>
            <RowIcon state={state} />
            <span className="truncate">{path}</span>
          </div>
        ))}
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
  const animated = useCountUp(value);
  return (
    <div className="p-3 rounded-xl bg-surface border border-border flex flex-col items-center gap-1">
      <Icon className="w-4 h-4 text-ink-muted" />
      <span className="text-lg font-semibold tabular-nums">{animated}</span>
      <span className="caption">{label}</span>
    </div>
  );
}
