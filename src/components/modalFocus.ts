import { useEffect, useRef, type RefObject } from 'react';

/**
 * The keyboard contract every dialog and popover in the launcher owes the user:
 * Escape closes, focus lands inside on open and returns to whatever opened it,
 * and a modal keeps Tab inside itself.
 *
 * Written once because the alternative is five copies of the same trap. `onClose`
 * is held in a ref rather than listed as a dependency on purpose: every call site
 * passes an inline arrow, so a dependency on its identity would re-run the effect
 * on every render and yank focus back out of the field being typed in.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export interface ModalDialogOptions {
  /** The dialog is in the tree and should own the keyboard. */
  open: boolean;
  /**
   * Escape handler. Omit it when the caller already listens for Escape on the
   * document - a popover opened from a chip, say - so one Escape is not handled
   * twice.
   */
  onClose?: () => void;
  /**
   * True for a true modal: Tab is trapped so it cannot reach the content behind.
   * False for a popover, which sits over the page and must stay escapable to the
   * rest of it.
   */
  trap?: boolean;
}

export function useModalDialog<T extends HTMLElement>({
  open,
  onClose,
  trap = true,
}: ModalDialogOptions): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Deliberately not a dependency: every call site passes an inline arrow, so a
  // dependency on its identity would re-run the effect on every render and yank
  // focus back out of the field being typed in. Kept fresh by an effect rather
  // than a write during render, which the react-hooks lint rule rejects.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement;
    // Land on the first control rather than the container: a dialog that opens
    // with focus on its own box makes the next Tab start from the header.
    (focusableWithin(node)[0] ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Stop before the document, or a second Escape listener closes whatever
        // is behind this dialog too.
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !trap) return;

      const items = focusableWithin(node);
      // A one-element list is both ends, and an empty one has nothing to wrap to,
      // so the length check is what makes these defined rather than optional.
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof Node && node.contains(active);

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Hand focus back, or the keyboard user is dropped at the top of the page
      // with no idea which control opened the dialog.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, trap]);

  return ref;
}
