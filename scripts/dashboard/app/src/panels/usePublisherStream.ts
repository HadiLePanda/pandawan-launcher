/**
 * One publisher stream, one implementation, for every destructive verb here.
 *
 * This is a thin React binding over `streamScript` in @lib/api, which already
 * handles the SSE frame format. It adds the three things a React caller needs
 * and the raw function cannot give it:
 *
 *   - the log as state, so it re-renders as the publisher writes,
 *   - a verdict that is separate from the log text. `done` carries the child's
 *     exit code and THAT decides success. The old client read only `output`, so a
 *     publisher that exited non-zero rendered a log that simply stopped
 *     mid-sentence and looked identical to a success - which was a real bug,
 *     because every destructive verb in this tool funnels through here,
 *   - a refusal of a second concurrent run. Two publishers writing to the same
 *     bucket with interleaved logs would be worse than a disabled button.
 *
 * Note that streamScript already appends its own verdict lines to the output it
 * reports, so the log on screen always ends on an explicit answer. The verdict
 * object here is for the coloured line above it and for the success check.
 */
import { useCallback, useRef, useState } from 'react';
import { streamScript } from '@/lib/api';

export type StreamVerdict =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok'; code: 0 }
  | { state: 'stopped'; code: number }
  | { state: 'failed'; code: number | null; reason: string };

export interface StreamHandle {
  verdict: StreamVerdict;
  log: string;
  busy: boolean;
  /** Runs one verb. Resolves to the exit code, or null when nothing ran. */
  start: (path: string, body?: unknown) => Promise<number | null>;
  reset: () => void;
}

export function usePublisherStream(): StreamHandle {
  const [log, setLog] = useState('');
  const [verdict, setVerdict] = useState<StreamVerdict>({ state: 'idle' });
  const running = useRef(false);

  const reset = useCallback(() => {
    setLog('');
    setVerdict({ state: 'idle' });
  }, []);

  const start = useCallback(async (path: string, body?: unknown): Promise<number | null> => {
    if (running.current) return null;
    running.current = true;
    setLog('');
    setVerdict({ state: 'running' });

    let code: number | null = null;
    try {
      code = await streamScript(path, body ?? {}, (chunk) => {
        setLog((previous) => previous + chunk);
      });
    } finally {
      running.current = false;
    }

    if (code === 0) {
      setVerdict({ state: 'ok', code: 0 });
    } else if (code === null) {
      setVerdict({
        state: 'failed',
        code: null,
        reason:
          'The run did not finish: the server refused it, or the connection closed before the publisher reported an exit code.',
      });
    } else if (code < 0 || code === 130) {
      // A signal kill rather than a script failure - calling an interrupt
      // "failed" would be wrong.
      setVerdict({ state: 'stopped', code });
    } else {
      setVerdict({
        state: 'failed',
        code,
        reason: `The publisher exited with code ${code}. Nothing was published.`,
      });
    }
    return code;
  }, []);

  return { verdict, log, busy: verdict.state === 'running', start, reset };
}

/** The coloured line under a finished run, or null while it is still running. */
export function verdictLine(verdict: StreamVerdict): { tone: string; text: string } | null {
  if (verdict.state === 'running') return { tone: 'text-ink-muted', text: 'Running…' };
  if (verdict.state === 'idle') return null;
  if (verdict.state === 'ok') return { tone: 'text-action', text: 'Finished with exit code 0.' };
  if (verdict.state === 'stopped') {
    return {
      tone: 'text-ember',
      text: `Stopped before it finished (exit code ${verdict.code}). Nothing was published.`,
    };
  }
  return { tone: 'text-status-error', text: verdict.reason };
}
