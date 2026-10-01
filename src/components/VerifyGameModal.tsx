import { X, AlertTriangle, FileCheck, FileX, FileQuestion } from 'lucide-react';
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
  const running = !result && !error;
  const total = rows.length ? rows[rows.length - 1].total : 0;

  if (!game) return null;

  return (
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="modal modal-auto animate-slide-up max-w-md">
        <div className="modal-header verify-topbar">
          <h3 className="title-3">{t('verifyGameModal.title')}</h3>
          <button onClick={onClose} className="icon-btn" aria-label={t('common.close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="modal-body verify-body">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="body">{error}</span>
            </div>
          )}

          {running && <RunningView rows={rows} total={total} />}

          {result && !error && <ResultView result={result} />}
        </div>

        {result && !error && (
          <div className="verify-footer">
            <button onClick={onClose} className="btn btn-secondary">
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RunningView({ rows, total }: { rows: VerifyProgress[]; total: number }) {
  const { t } = useTranslation();
  const last = rows[rows.length - 1];
  const checked = useCountUp(rows.length);
  const valid = useCountUp(last?.valid ?? 0);
  const invalid = useCountUp(last?.invalid ?? 0);
  const missing = useCountUp(last?.missing ?? 0);
  const pct = total ? Math.round((rows.length / total) * 100) : 0;

  return (
    <div className="stack-md">
      <div className="verify-pct">{pct}%</div>

      <div className="verify-bar">
        <div className="verify-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="verify-count">{t('verifyGameModal.progress', { checked, total })}</div>

      <div className="verify-tallies">
        <Tally label={t('verifyGameModal.stats.valid')} value={valid} tone="valid" />
        <Tally label={t('verifyGameModal.stats.invalid')} value={invalid} tone="invalid" />
        <Tally label={t('verifyGameModal.stats.missing')} value={missing} tone="missing" />
      </div>

      <CurrentFile path={last?.path} />
    </div>
  );
}

function CurrentFile({ path }: { path?: string }) {
  if (!path) return null;
  return (
    <div className="verify-current" key={path}>
      <span className="verify-current-path">{path}</span>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'valid' | 'invalid' | 'missing';
}) {
  return (
    <div className={cn('verify-tally', `verify-tally-${tone}`)}>
      <span className="verify-tally-value tabular-nums" key={value}>
        {value}
      </span>
      <span className="caption">{label}</span>
    </div>
  );
}

function ResultView({ result }: { result: VerificationResult }) {
  const { t } = useTranslation();
  const valid = useCountUp(result.valid_files);

  if (result.is_valid) {
    return (
      <div className="verify-verdict verify-verdict-ok">
        <div className="verify-verdict-head">
          <FileCheck className="w-5 h-5 shrink-0" />
          <span>{t('verifyGameModal.allValid')}</span>
        </div>
        <div className="verify-verdict-detail">
          {t('verifyGameModal.stats.valid')}: {valid}
        </div>
      </div>
    );
  }

  const problems = [
    ...result.invalid_files.map((path) => ({ path, state: 'invalid' as const })),
    ...result.missing_files.map((path) => ({ path, state: 'missing' as const })),
  ];
  const shown = problems.slice(0, 5);

  return (
    <div className="stack-md">
      <div className="verify-verdict verify-verdict-bad">
        <div className="verify-verdict-head">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{t('verifyGameModal.needsRepair')}</span>
        </div>
      </div>

      <div className="cluster cluster-md">
        <Tally label={t('verifyGameModal.stats.valid')} value={result.valid_files} tone="valid" />
        <Tally
          label={t('verifyGameModal.stats.invalid')}
          value={result.invalid_files.length}
          tone="invalid"
        />
        <Tally
          label={t('verifyGameModal.stats.missing')}
          value={result.missing_files.length}
          tone="missing"
        />
      </div>

      <ul className="verify-sample">
        {shown.map(({ path, state }) => (
          <li key={path} className={cn('verify-row', `verify-row-${state}`)}>
            {state === 'invalid' ? (
              <FileX className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <FileQuestion className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">{path}</span>
          </li>
        ))}
        {problems.length > shown.length && (
          <li className="verify-row-more">+{problems.length - shown.length}</li>
        )}
      </ul>
    </div>
  );
}
