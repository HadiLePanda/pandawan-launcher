import { AlertTriangle, FileCheck, FileX, FileQuestion, X } from 'lucide-react';
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
      <div className="modal modal-auto animate-slide-up" role="dialog" aria-modal="true">
        <div className="verify-head">
          <h3 className="verify-title">{t('verifyGameModal.title')}</h3>
          {/* In the title row rather than pinned to the panel corner: the title is
              what identifies the dialog, so the close control belongs beside it.
              Shown while the scan runs too - closing only hides the progress, it
              does not stop the verification. */}
          <button
            type="button"
            onClick={onClose}
            className="icon-btn verify-close"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
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
            <button onClick={onClose} className="btn">
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
  const invalid = useCountUp(last?.invalid ?? 0);
  const missing = useCountUp(last?.missing ?? 0);
  const pct = total ? Math.round((rows.length / total) * 100) : 0;

  return (
    <div className="stack-md">
      <div className="verify-bar">
        <div className="verify-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="verify-count">{t('verifyGameModal.progress', { checked, total })}</div>

      {/* Only deviations. A valid count would just restate the ratio above,
          since a checked file is valid unless it is listed here. */}
      {(invalid > 0 || missing > 0) && (
        <div className="verify-tallies">
          <Tally label={t('verifyGameModal.stats.invalid')} value={invalid} tone="invalid" />
          <Tally label={t('verifyGameModal.stats.missing')} value={missing} tone="missing" />
        </div>
      )}

      <CurrentFile path={last?.path} scanning={t('verifyGameModal.scanning')} />
    </div>
  );
}

function CurrentFile({ path, scanning }: { path?: string; scanning: string }) {
  if (!path) return null;
  return (
    <div className="verify-current" key={path}>
      <span className="verify-dot" />
      <span className="verify-current-path">
        {scanning} {path}
      </span>
    </div>
  );
}

/** A zero count is dropped entirely rather than shown as a bare label: "Invalid"
 * on its own reads as a claim with no number attached, which is worse than
 * showing nothing. Absent means clear, and colour only ever means trouble. */
function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'invalid' | 'missing';
}) {
  if (value === 0) return null;
  return (
    <span className={cn('verify-tally', `verify-tally-${tone}`)}>
      <span className="verify-tally-value tabular-nums" key={value}>
        {value}
      </span>
      {label}
    </span>
  );
}

function ResultView({ result }: { result: VerificationResult }) {
  const { t } = useTranslation();
  const valid = useCountUp(result.valid_files);

  if (result.is_valid) {
    // Both branches call t() with a literal: the coverage scanner only matches
    // strings passed directly to t(), so a key chosen in a variable reads as
    // unused and fails the parity test.
    return (
      <div className="verify-verdict verify-verdict-ok">
        <FileCheck className="w-5 h-5 shrink-0" />
        <span>
          {result.valid_files === 1
            ? t('verifyGameModal.verifiedOne', { count: valid })
            : t('verifyGameModal.verifiedMany', { count: valid })}
        </span>
      </div>
    );
  }

  const problems = [
    ...result.invalid_files.map((path) => ({ path, state: 'invalid' as const })),
    ...result.missing_files.map((path) => ({ path, state: 'missing' as const })),
  ];
  const shown = problems.slice(0, 4);

  return (
    <div className="stack-md">
      <div className="verify-verdict verify-verdict-bad">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <span>
          {problems.length === 1
            ? t('verifyGameModal.issueOne', { count: problems.length })
            : t('verifyGameModal.issueMany', { count: problems.length })}
        </span>
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
