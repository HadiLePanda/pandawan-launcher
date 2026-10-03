/**
 * The single fetch helper.
 *
 * Every read in this app goes through `apiGet`, because the cache headers live
 * in exactly one place and a second reader is a second thing to forget. The
 * server answers cached GETs with:
 *
 *   x-cache: hit | miss | stale
 *   x-cache-age-ms: <number>
 *
 * and honours `?refresh=1` to force a re-read. Neither header exists on the
 * POST verbs (which run a script) and neither may exist on a server that has
 * not been updated yet, so every field here is optional and absence is normal.
 */

/** Which of the three states the server reported. Null when it said nothing. */
export type CacheState = 'hit' | 'miss' | 'stale' | null;

export interface ApiResult<T> {
  data: T;
  /** The server's verdict, or null when the headers were absent. */
  cache: CacheState;
  /** How old the data is, in ms. Null when the header was absent or unparseable. */
  ageMs: number | null;
}

/** Query parameters, so callers never hand-build a query string. */
export type Query = Record<string, string | number | null | undefined>;

/**
 * The exit code carried by a `done` frame.
 *
 * A frame reporting `ok:false` with no `code` is still a failure. Reading only
 * `code` returned 0 for it, which rendered a rejected publish as a clean run.
 */
export function exitCodeFromDone(data: string): number {
  try {
    const parsed = JSON.parse(data) as { code?: unknown; ok?: unknown } | null;
    const code = parsed?.code;
    if (Number.isFinite(Number(code))) return Number(code);
    return parsed?.ok === false ? 1 : 0;
  } catch {
    return 0;
  }
}

function withQuery(path: string, query: Query | undefined): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function parseCacheState(header: string | null): CacheState {
  if (header === 'hit' || header === 'miss' || header === 'stale') return header;
  // Anything else - including an absent header - is treated as "did not say",
  // so a newer server that adds a fourth state degrades to no badge rather than
  // to a wrong one.
  return null;
}

function parseAge(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * GET a JSON endpoint and report what the cache said about it.
 *
 * Throws on a transport failure or a non-2xx status so the caller can show the
 * reason. The server answers some operator mistakes with a plain string rather
 * than JSON (`res.writeHead(400).end('gameId and channel are required')`), so the
 * body is read as text first and only parsed when it looks like JSON - otherwise
 * a perfectly readable error message becomes a JSON parse failure.
 */
export async function apiGet<T>(
  path: string,
  options: { refresh?: boolean; query?: Query } = {}
): Promise<ApiResult<T>> {
  const pathWithQuery = withQuery(path, options.query);
  const url = options.refresh
    ? `${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}refresh=1`
    : pathWithQuery;

  const res = await fetch(url, { headers: { accept: 'application/json' } });

  const cache = parseCacheState(res.headers.get('x-cache'));
  const ageMs = parseAge(res.headers.get('x-cache-age-ms'));

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON. Falls through to the status check below, which will raise it
      // as the operator error it almost always is.
    }
  }

  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : text.trim() || `HTTP ${res.status}`;
    throw new Error(detail);
  }

  if (parsed === undefined) {
    throw new Error(
      res.status === 204 ? 'the server returned nothing' : 'the server returned a non-JSON response'
    );
  }

  return { data: parsed as T, cache, ageMs };
}

/** POST JSON. Used by the publish verbs, which stream their output separately. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : text.trim() || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return (parsed ?? {}) as T;
}

/**
 * Run a publishing verb and collect its output stream.
 *
 * The server answers with server-sent events, and only the `done` frame carries
 * the child's exit code. That distinction is load-bearing: a script that failed
 * to spawn and one that succeeded used to produce an identical page, which
 * matters because every destructive verb in this tool - publish, prune - comes
 * through here. `done` decides success, and a connection that dies before a
 * `done` is reported as a failure rather than silently treated as a no-op.
 *
 * A validation error comes back as a plain string on purpose, so the non-SSE
 * branch has to surface that text rather than trying to parse frames from it.
 */
export async function streamScript(
  path: string,
  body: unknown,
  onOutput: (chunk: string) => void
): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    onOutput(`Could not reach the dashboard server: ${message(err)}\n`);
    onOutput('FAILED - the request never started.\n');
    return null;
  }

  const contentType = String(res.headers.get('content-type') ?? '');

  if (!contentType.includes('text/event-stream')) {
    const text = (await res.text()).trim();
    if (text) onOutput(`${text}\n`);
    else onOutput(`HTTP ${res.status}\n`);
    if (!res.ok) onOutput('FAILED - the server refused the request.\n');
    return res.ok ? 0 : null;
  }

  if (!res.body) {
    onOutput(`HTTP ${res.status} ${res.statusText}\n`);
    onOutput('FAILED - the server refused the request.\n');
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode: number | null = null;
  let spawnError = '';

  const frameData = (frame: string) => /^data: ([\s\S]*)$/m.exec(frame)?.[1] ?? '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      if (/^event: output$/m.test(frame)) onOutput(frameData(frame));
      // Recorded rather than printed inline, so the `done` frame can still
      // describe the run accurately.
      else if (/^event: error$/m.test(frame)) spawnError = frameData(frame);
      else if (/^event: done$/m.test(frame)) {
        exitCode = exitCodeFromDone(frameData(frame));
      }
    }
  }

  // Always end on an explicit verdict line. The script's own output was written
  // by the script and may end on a progress line or nothing at all, and the
  // reader has to be able to trust that the last line is the answer.
  if (spawnError) {
    onOutput(`\nThe script could not be started: ${spawnError}\n`);
    onOutput('FAILED - nothing was published.\n');
    return exitCode;
  }
  if (exitCode === null) {
    onOutput('\nFAILED - the connection closed before the script reported an exit code.\n');
    return null;
  }
  if (exitCode === 0) {
    onOutput('\nFinished with exit code 0.\n');
    return 0;
  }
  if (exitCode < 0 || exitCode === 130) {
    onOutput(`\nStopped before it finished (exit code ${exitCode}). Nothing was published.\n`);
    return exitCode;
  }
  onOutput(`\nFAILED - the script exited with code ${exitCode}. Nothing was published.\n`);
  return exitCode;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
