/**
 * The local dev-server list.
 *
 * A service with a `bat` field is OPENED in its own console window, not spawned.
 * The server captures no output from it, `stop()` cannot kill it (it only stops
 * offering to reopen one), and its log is not on this page - ever. So this panel:
 *
 *   - never renders a log box for one, because it would never receive anything,
 *   - says where the output actually is, rather than leaving a user hunting for a
 *     panel that was never going to fill,
 *   - labels its stop action accurately ("stop offering to reopen") instead of
 *     claiming to have killed something it cannot reach.
 *
 * `forceStop` still works for an opened service, because it kills whatever holds
 * the port rather than a pid of ours. That is offered separately and labelled as
 * what it is.
 *
 * The poll interval is 10 seconds: these are dev servers that take minutes to
 * come up, and the poll reads through the server's 30-second cache, so the header
 * shows the AGE of the reading rather than a claim that it was just taken. Only a
 * manual Refresh forces a live probe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Play, RefreshCw, Square } from 'lucide-react';
import { apiGet, messageOf, type CacheState } from '@/lib/api';
import type { ServiceStatus } from '@/types/api';
import { DataAge } from '@components/ui';
import { cx } from './cx';
import { Badge, Button, Card, EmptyState, ErrorNote, GlobalPanel, Spinner } from './ui';

/**
 * `GET /api/services`. Re-exported from the shared wire types rather than
 * redeclared, so this panel and anything else reading the same endpoint cannot
 * drift apart.
 */
export type DevService = ServiceStatus;

const POLL_MS = 10_000;

const STATE_LABELS = {
  running: 'running here',
  external: 'running elsewhere',
  stopped: 'stopped',
  failed: 'exited',
} as const;

type ServiceState = keyof typeof STATE_LABELS;

function stateOf(service: DevService): ServiceState {
  if (!service.up && service.log) return 'failed';
  if (service.up) return service.ours ? 'running' : 'external';
  return 'stopped';
}

export default function ServicesPanel() {
  const [load, setLoad] = useState<
    | { state: 'loading' }
    | { state: 'ready'; services: DevService[]; ageMs: number | null; cache: CacheState }
    | { state: 'error'; message: string }
  >({ state: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The request, with no setState in it. A loader that reaches into component
  // state makes the effect below a synchronous setState, which the react-hooks
  // set-state-in-effect rule rejects for the cascading second render it causes.
  //
  // `force` sends ?refresh=1, so a manual Refresh is a real port probe rather
  // than a re-read of the 30-second cache. The poll never forces it - reuse of
  // that cache is the point of the short TTL - so the age on screen is the age
  // of the reading, not of the last click.
  const request = useCallback(async (force: boolean) => {
    const { data, ageMs, cache } = await apiGet<ServiceStatus[]>('/api/services', {
      refresh: force,
    });
    return { services: data, ageMs, cache };
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      try {
        const { services, ageMs, cache } = await request(force);
        if (mounted.current) setLoad({ state: 'ready', services, ageMs, cache });
      } catch (err) {
        if (mounted.current) setLoad({ state: 'error', message: messageOf(err) });
      } finally {
        if (force && mounted.current) setRefreshing(false);
      }
    },
    [request]
  );

  // Both the first load and the poll are started through a resolved promise
  // rather than called directly, so the state updates land in a callback after
  // the effect body instead of synchronously inside it. The interval is still
  // registered synchronously, so a mount that unmounts within the microtask
  // still clears it - the deferred call is guarded by `mounted`, exactly as the
  // direct call was.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function act(endpoint: string, id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: 'POST' });
      // Read as text first: a refusal can be a plain string (an unknown id is a
      // 404 text body), and res.json() on that throws into the catch, which
      // would render the action as a silent no-op - the failure-as-empty-list
      // defect this panel cannot afford.
      const text = (await res.text()).trim();
      let data: { ok?: boolean; error?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { ok?: boolean; error?: string };
        } catch {
          // Not JSON. The text itself is the message.
        }
      }
      if (!res.ok || data.ok === false) {
        // Shown on the row, not swallowed: "Stop it" on a service that will not
        // stop is the one place this panel could otherwise lie.
        const message = data.error ?? (text || `HTTP ${res.status}`);
        if (mounted.current) setActionError({ id, message });
      }
    } catch (err) {
      if (mounted.current) setActionError({ id, message: messageOf(err) });
    } finally {
      if (mounted.current) setBusyId(null);
      await refresh();
    }
  }

  return (
    <GlobalPanel
      title="Services"
      actions={
        <>
          <DataAge
            ageMs={load.state === 'ready' ? load.ageMs : null}
            cache={load.state === 'ready' ? load.cache : null}
            refreshing={refreshing}
          />
          <Button
            onClick={() => void refresh(true)}
            disabled={refreshing}
            aria-label="Re-probe which ports are listening now"
          >
            <RefreshCw aria-hidden size={14} />
            Refresh
          </Button>
        </>
      }
    >
      {load.state === 'loading' ? (
        <Card>
          <Spinner label="Checking which ports are listening…" />
        </Card>
      ) : null}

      {load.state === 'error' ? (
        <ErrorNote>Could not read the service list: {load.message}</ErrorNote>
      ) : null}

      {load.state === 'ready' && !load.services.length ? (
        <EmptyState title="No dev services are configured" />
      ) : null}

      {load.state === 'ready' ? (
        <ul className="flex flex-col gap-2">
          {load.services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              busy={busyId === service.id}
              error={actionError?.id === service.id ? actionError.message : null}
              onAct={(endpoint) => void act(endpoint, service.id)}
            />
          ))}
        </ul>
      ) : null}
    </GlobalPanel>
  );
}

function ServiceRow({
  service,
  busy,
  error,
  onAct,
}: {
  service: DevService;
  busy: boolean;
  error: string | null;
  onAct: (endpoint: string) => void;
}) {
  const state = stateOf(service);
  // ink-muted (a step lighter than the ink-subtle "stopped" uses) is a real
  // token; an undefined colour like `bg-blue` emits no CSS and renders invisible.
  const dot =
    state === 'running'
      ? 'bg-action'
      : state === 'external'
        ? 'bg-ink-muted'
        : state === 'failed'
          ? 'bg-status-error'
          : 'bg-ink-subtle';

  return (
    <li
      className={cx(
        'rounded-lg border p-3',
        service.up ? 'border-border bg-surface' : 'border-border bg-surface/60'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', dot)} />
            <span className="text-sm font-medium text-ink">{service.name}</span>
            <Badge
              tone={
                state === 'running'
                  ? 'good'
                  : state === 'external'
                    ? 'info'
                    : state === 'failed'
                      ? 'bad'
                      : 'neutral'
              }
            >
              {STATE_LABELS[state]}
            </Badge>
            {service.opened ? (
              // Stated, because it changes what the buttons below will do.
              <Badge tone="warn">own console window</Badge>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-ink-muted">{service.note}</p>

          <p className="mt-1 text-xs text-ink-dim">
            {service.url ? (
              <>
                <a
                  href={service.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline decoration-dotted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  {service.url}
                </a>
                {service.up ? '' : ' - nothing is listening there yet'}
              </>
            ) : service.opened ? (
              'output in its own window, not captured here'
            ) : (
              `port ${service.port}`
            )}
          </p>

          {/* A log only where one exists. An opened service has no tail to show,
              and rendering an empty box would imply the output was lost rather
              than never captured. */}
          {service.log ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-status-error/40 bg-canvas p-2 font-mono text-xs whitespace-pre-wrap text-ink-muted">
              {service.log}
            </pre>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {service.url ? (
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${service.name} in a browser`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-light px-2 text-xs text-ink hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <ExternalLink aria-hidden size={12} />
              Open
            </a>
          ) : null}

          {/* An opened service has no pid of ours, so the normal stop path
              cannot kill it - only forceStop, which kills whatever holds the
              port, can. It is offered on its own rather than behind a stop that
              would not work. */}
          {service.opened && service.up ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onAct('/api/service/force-stop')}
              busy={busy}
              disabled={busy}
              aria-label={`Force stop ${service.name}`}
              title="Kill the process holding this port. Its console window stays open and will say the server stopped."
            >
              <Square aria-hidden size={12} />
              Stop it
            </Button>
          ) : null}

          {service.ours ? (
            <Button
              size="sm"
              onClick={() => onAct('/api/service/stop')}
              busy={busy}
              disabled={busy}
              aria-label={
                service.opened ? `Stop offering to reopen ${service.name}` : `Stop ${service.name}`
              }
            >
              <Square aria-hidden size={12} />
              {service.opened ? 'Forget' : 'Stop'}
            </Button>
          ) : service.up ? (
            // Up, but this dashboard did not start it (an opened service is
            // already covered above). Offered because a half-dead tree can leave
            // a process holding the port with nothing left to trace it back to,
            // and hunting for that pid by hand is the chore this list exists to
            // remove. Kills whatever holds the port, whoever started it.
            service.opened ? null : (
              <Button
                size="sm"
                variant="danger"
                onClick={() => onAct('/api/service/force-stop')}
                busy={busy}
                disabled={busy}
                aria-label={`Force stop ${service.name}`}
                title="Stop the process holding this port, whoever started it."
              >
                <Square aria-hidden size={12} />
                Stop it
              </Button>
            )
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onAct('/api/service/start')}
              busy={busy}
              disabled={busy}
              aria-label={`${state === 'failed' ? 'Retry' : 'Start'} ${service.name}`}
            >
              <Play aria-hidden size={12} />
              {state === 'failed' ? 'Retry' : 'Start'}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
