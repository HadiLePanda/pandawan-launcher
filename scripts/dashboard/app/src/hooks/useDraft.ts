/**
 * Draft state for one editor, plus the beforeunload guard.
 *
 * This is the port of app.js's `saveMetaDraft` / `anyDirty` /
 * `window.addEventListener('beforeunload')` block. Two behaviours it must not
 * lose:
 *
 *  - a draft is restored AND clearly labelled as unpublished. Restoring is
 *    invisible by nature - the form simply holds the values it would have held
 *    anyway - so without the label a restored draft is indistinguishable from
 *    data that was always there, and an operator comparing "before" against
 *    "after" in the diff would be comparing the wrong before.
 *  - the guard persists first and warns second. The prompt must never be the
 *    thing that loses the edit it is warning about, so the write happens on
 *    `beforeunload` before the prompt is even considered.
 *
 * Draft state is LOCAL to the editor that owns it, deliberately not in a store.
 * A draft for one game is a lie on another, and a global store is exactly how
 * that would happen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { clearDraft, readDraft, saveDraft, type DraftEnvelope } from '@lib/storage';
import { savedAt } from '@lib/format';

export interface DraftApi {
  /** Whether an uncommitted edit is held. Drives the guard and the dirty bar. */
  dirty: boolean;
  /** The restored draft, or null. Rendered as the "not published yet" note. */
  restored: DraftEnvelope | null;
  /** Called on every edit. Writes only when there is something to remember. */
  persist: () => void;
  /** Drop the stored copy and the note. */
  discard: () => void;
}

/**
 * Persist a draft under `key` whenever `dirty` is true, and clear it otherwise.
 *
 * Writing only on a transition would lose the most recent keystrokes if the page
 * closed between two edits, and the whole point of the draft is that the last
 * thing typed survives. So the effect runs on every dirty value change, which is
 * the last chance to write.
 */
export function useDraft(options: {
  /** The draft's storage key, or '' when there is nothing to key against. */
  key: string;
  /** What the draft is FOR, named in the resume banner. */
  target: string;
  /** The values to remember, only read when dirty. */
  values: () => Record<string, string>;
  /**
   * Whether anything is worth remembering.
   *
   * Also the trigger: the persist effect keys on the VALUES, not just on this
   * boolean. Keying on the boolean alone writes only on the keystroke that flips
   * it and then never again, so the stored draft silently freezes at whatever the
   * second keypress happened to be - which loses the edit the draft exists to
   * protect. (Found by exercising the built bundle, not by reading it.)
   */
  dirty: boolean;
  /** Extra envelope fields, e.g. gameId/channel so a resume can navigate. */
  meta?: { gameId?: string; channel?: string };
  /**
   * Called ONCE per target with the stored draft's values, in the same pass that
   * publishes the note.
   *
   * Adoption has to be a single pass. If the editor applied the values in an
   * effect of its own, React would run that effect and this hook's effects in
   * declaration order without either knowing about the other, and the persist
   * pass would get a commit in which the note said "restored" while the form
   * still held the loaded values - on which `dirty` is false - and would clear
   * the draft it was meant to be restoring.
   */
  onAdopt?: (values: Record<string, string>) => void;
}): DraftApi {
  const { key, target, dirty, onAdopt } = options;

  const [restored, setRestored] = useState<DraftEnvelope | null>(null);
  // Read inside `persist` without making them dependencies: `values` is a fresh
  // closure every render, and depending on the function itself would write
  // storage on every render rather than on every edit. `meta` is a fresh object
  // literal every render for the same reason.
  const valuesRef = useRef(options.values);
  const metaRef = useRef(options.meta);
  // Both are filled in an effect rather than in the render body. The ref itself
  // is unavoidable - see above - but the WRITE is not. A render is a draft of
  // what might still be thrown away, so writing from one leaves the ref
  // describing a render that never committed; an effect only ever runs for a
  // commit that did happen. No dependencies, so this runs after every commit,
  // and being declared before the persist effect it is always current by the
  // time `persist` reads it.
  useEffect(() => {
    valuesRef.current = options.values;
    metaRef.current = options.meta;
  });

  // A stable fingerprint of the values. The persist effect depends on THIS rather
  // than on the values object, so it re-runs once per edit however many fields
  // changed in a commit, and not once per render.
  const valuesJson = JSON.stringify(options.values());

  // Adopt any stored draft for this target, and mark the first pass so the
  // persisting effect below does not immediately clear what it just adopted.
  //
  // `ready` is the load-bearing part and it is a REF, not state, because it must
  // be readable synchronously by the persist effect in the same commit. React
  // runs effects in declaration order, so adoption runs first and flips this; the
  // persist effect then sees it and skips its very first pass.
  //
  // Without it there is a race that deletes the draft on load: adoption is an
  // effect, so on the commit where the tab first mounts `ready` is still false and
  // the form still holds the LOADED values, on which `dirty` is false. A persist
  // pass at that moment sees "nothing changed" and calls clearDraft - so the
  // stored draft is destroyed before it is ever restored. That is exactly the
  // "draft restore does nothing" failure the note exists to prevent, and it is
  // invisible in review because the code looks correct.
  const adopted = useRef<string | null>(null);
  const ready = useRef(false);
  useEffect(() => {
    if (adopted.current === key) return;
    adopted.current = key;
    ready.current = true;
    const stored = key ? readDraft(key) : null;
    setRestored(stored);
    // Lay the values down in the same pass. This is a parent state update, so it
    // schedules a re-render; `ready` is already true by then, so the persist
    // effect's next run sees the restored values rather than the loaded ones.
    //
    // `onAdopt` is a plain dependency rather than a ref: this effect only ever
    // does anything on a key change, and the guard above is what makes that so,
    // so a changed callback identity cannot re-adopt anything - it just re-runs a
    // body that returns immediately.
    if (stored) onAdopt?.(stored.values);
  }, [key, onAdopt]);

  const persist = useCallback(() => {
    if (!key) return;
    // Nothing changed, so there is nothing to remember. Writing anyway would keep
    // resurrecting a draft that says "unsaved changes" over a form with none.
    //
    // `restored` is deliberately NOT cleared here. This branch is reached twice
    // for a restored draft: once before adoption (guarded by `ready`, so it does
    // not happen) and once on the commit AFTER the values are laid down, when the
    // form is dirty and the draft has just been rewritten with those values. The
    // note has to outlive that, or a restored edit silently becomes an ordinary
    // unlabelled one - which is the exact failure the note exists to prevent.
    // Clearing belongs to `discard`, which the operator asked for by name.
    if (!dirty) {
      clearDraft(key);
      return;
    }
    saveDraft(key, { target, ...(metaRef.current ?? {}), values: valuesRef.current() });
  }, [dirty, key, target]);

  const discard = useCallback(() => {
    if (!key) return;
    clearDraft(key);
    setRestored(null);
    // Re-adopt the (now absent) draft so the note stays gone rather than
    // reappearing on the next key change.
    adopted.current = key;
  }, [key]);

  // Runs on every edit, not just on mount and not only when `dirty` flips. The
  // last keystroke before a crash is only saved if the write happens as the value
  // changes, and `valuesJson` is what makes "a value changed" something this
  // effect can actually see as a dependency.
  //
  // The `ready` guard is what keeps the mount pass from wiping a stored draft
  // before it has been read; see the note on `ready` above. It is deliberately a
  // ref read rather than a state dependency, so consulting it here cannot itself
  // schedule another pass.
  useEffect(() => {
    if (!ready.current) return;
    persist();
  }, [key, persist, valuesJson]);

  // The browser's guard. Persist first, then decide whether to warn: this is the
  // last chance to write, and a prompt that appears only when the edit is already
  // at risk is too late to be the thing that saved it.
  //
  // `dirty` and `persist` are dependencies of this effect, so the listener is
  // torn down and replaced when either changes. That is deliberate: a beforeunload
  // listener that closed over one commit's `dirty` would warn about an edit that
  // no longer exists and stay silent about one that does. React runs the cleanup
  // and the new effect together, so there is no window in which no listener is
  // attached - and the listener only ever runs on a real unload, never during a
  // commit, so it cannot observe the gap anyway.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      if (!dirty) return;
      event.preventDefault();
      // The browser ignores this text and shows its own wording, but returning a
      // non-empty value is what makes it show one at all.
      event.returnValue = 'You have unsaved changes that have not been published.';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, persist]);

  return { dirty, restored, persist, discard };
}

/** The sentence shown above a form whose values came from a draft. */
export function draftNoteText(draft: DraftEnvelope): string {
  return `Unsaved draft restored for ${draft.target}, saved ${savedAt(draft.savedAt)}. It is not published - review the diff before you publish.`;
}
