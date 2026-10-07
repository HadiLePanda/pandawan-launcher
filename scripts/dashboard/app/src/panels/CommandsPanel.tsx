/**
 * The copyable command reference.
 *
 * Held as data rather than prose so each entry stays next to the description of
 * what it does, and each names the npm script the forms in this dashboard mirror.
 * Global: it is a reference, not an action against a selection.
 */
import { useMemo, useState } from 'react';
import { Check, Copy, Search } from 'lucide-react';
import { cx } from './cx';
import { Button, EmptyState, GlobalPanel, TextInput } from './ui';

interface CommandEntry {
  cmd: string;
  about: string;
  hint?: string;
}

interface CommandGroup {
  group: string;
  items: CommandEntry[];
}

const COMMANDS: CommandGroup[] = [
  {
    group: 'Launcher releases',
    items: [
      {
        cmd: 'npm run release',
        about: 'Bump patch, tag, push. Triggers the CI build for all three platforms.',
        hint: 'Also: -- minor | major | 0.2.0-beta.1 | --dry-run',
      },
      {
        cmd: 'npm run retag',
        about: 'Move the current tag onto HEAD and re-trigger CI, without a bump.',
        hint: 'Use when the tagged commit failed CI. Dry run without --confirm.',
      },
      {
        cmd: 'npm run release:local -- --confirm',
        about: 'Upload the locally built Windows bundle to R2 and merge latest.json.',
        hint: 'Build first with npm run tauri:build. Dry run without --confirm.',
      },
      {
        cmd: 'npm run release:publish -- --tag v0.1.0 --confirm',
        about: 'Upload the built, signed launcher to R2. Dry run without --confirm.',
      },
      { cmd: 'npm run keys:check', about: 'Prove the signing key works and the pubkey is synced.' },
      {
        cmd: 'npm run keys:generate',
        about: 'New signing keypair. Refuses to overwrite an existing one.',
      },
      {
        cmd: 'npm run sync:updater-key',
        about: 'Copy updater.pub into tauri.conf.json. Runs before builds.',
      },
      { cmd: 'npm run tauri:build', about: 'Local signed build. ~5 minutes on Windows.' },
      { cmd: 'npm run tauri:dev', about: 'Run the launcher in dev mode.' },
    ],
  },
  {
    group: 'Game builds',
    items: [
      {
        cmd: 'npm run publish:game -- --game-id pandawan-rising --channel alpha --version 1.2.0 --build-number 102 --executable "Game.exe" --name "Pandawan Rising" --input-dir ./Builds',
        about: 'Upload a game build and make it visible to the launcher.',
      },
      {
        cmd: 'npm run publish:catalog',
        about: 'Upload catalog.json. New games stay invisible until this runs.',
      },
      {
        cmd: 'npm run prune:builds -- --game-id pandawan-rising --keep 3',
        about: 'Delete all but the 3 newest builds. Dry run unless --yes.',
        hint: 'Pinned versions are never deleted.',
      },
      {
        cmd: 'npm run backfill:latest',
        about: 'Rewrite latest.json from what is already in the bucket.',
      },
      { cmd: 'npm run dashboard', about: 'Open this dashboard.' },
    ],
  },
  {
    group: 'Checks',
    items: [
      { cmd: 'npm test', about: 'Frontend unit tests.' },
      { cmd: 'npm run lint', about: 'ESLint.' },
      { cmd: 'npm run build', about: 'Typecheck and production frontend build.' },
      { cmd: 'npm run format:check', about: 'Prettier check.' },
      { cmd: 'npm run format', about: 'Apply Prettier.' },
      {
        cmd: 'cd src-tauri; cargo test',
        about: 'Rust tests, including the updater signing checks.',
      },
    ],
  },
  {
    group: 'Troubleshooting in CI',
    items: [
      {
        cmd: 'gh run list --workflow=release.yml',
        about: 'Recent release builds and whether they passed.',
      },
      { cmd: 'gh run view <id> --log-failed', about: 'Read why a CI step failed.' },
      {
        cmd: 'gh run rerun <id> --failed',
        about: 'Re-run only the failed steps.',
        hint: 'Uses the tagged commit, not main - check the fix is in the tag.',
      },
      {
        cmd: 'gh secret list',
        about: 'Secret names and when they were set. Values are never shown.',
      },
      {
        cmd: 'gh workflow run release.yml -f publish_only=true -f tag=v0.1.0',
        about: 'Re-publish to R2 from CI without rebuilding. ~30 seconds.',
      },
    ],
  },
];

export default function CommandsPanel() {
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.map((group) => ({
      group: group.group,
      items: group.items.filter((item) =>
        `${item.cmd} ${item.about} ${item.hint ?? ''}`.toLowerCase().includes(needle)
      ),
    })).filter((group) => group.items.length > 0);
  }, [filter]);

  const matches = groups.reduce((total, group) => total + group.items.length, 0);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      // Clipboard needs a secure context or permission. Selecting the text is a
      // working fallback rather than failing silently - the user can copy it
      // themselves from the selection.
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const node = document.getElementById(`cmd-${slug(text)}`);
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection?.addRange(range);
      }
    }
  }

  return (
    <GlobalPanel title="Commands">
      <div className="relative">
        <Search
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-subtle"
        />
        <TextInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter commands"
          aria-label="Filter commands"
          className="pl-8"
        />
      </div>

      {filter.trim() ? (
        <p className="text-xs text-ink-muted">
          {matches} command{matches === 1 ? '' : 's'} match “{filter.trim()}”
        </p>
      ) : null}

      {!groups.length ? (
        <EmptyState title="No commands match that" />
      ) : (
        groups.map((group) => (
          <section key={group.group}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {group.group}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.items.map((item) => {
                const isCopied = copied === item.cmd;
                return (
                  <li key={item.cmd} className="rounded-md border border-border bg-surface p-2.5">
                    <div className="flex items-start gap-2">
                      <code
                        id={`cmd-${slug(item.cmd)}`}
                        className="min-w-0 flex-1 font-mono text-xs break-all text-ink"
                      >
                        {item.cmd}
                      </code>
                      <Button
                        size="sm"
                        iconOnly
                        onClick={() => void copy(item.cmd)}
                        aria-label={isCopied ? `Copied: ${item.cmd}` : `Copy: ${item.cmd}`}
                        title={isCopied ? 'Copied' : 'Copy'}
                        className={cx('shrink-0', isCopied && 'text-action')}
                      >
                        {isCopied ? (
                          <Check aria-hidden size={12} />
                        ) : (
                          <Copy aria-hidden size={12} />
                        )}
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{item.about}</p>
                    {item.hint ? <p className="mt-0.5 text-xs text-ink-dim">{item.hint}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </GlobalPanel>
  );
}

/** A DOM id from a command, so the clipboard fallback has something to select. */
function slug(text: string): string {
  return text
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
