import { useLayoutEffect, useState, type RefObject } from 'react';

export type DropdownPlacement = 'bottom' | 'top';

interface DropdownPosition {
  top: number;
  left: number;
  placement: DropdownPlacement;
}

const MARGIN = 8;

/**
 * Position a dropdown relative to its trigger using fixed positioning.
 * Picks top/bottom placement based on available viewport space and keeps the
 * menu within the viewport horizontally.
 */
export function useDropdownPosition(
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  open: boolean,
): DropdownPosition | null {
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();

      if (!trigger) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const menuWidth = menu?.width ?? 192;
      const menuHeight = menu?.height ?? 200;

      const spaceBelow = viewportHeight - trigger.bottom - MARGIN;
      const spaceAbove = trigger.top - MARGIN;

      const placement: DropdownPlacement =
        menuHeight <= spaceBelow ? 'bottom' : menuHeight <= spaceAbove ? 'top' : 'bottom';

      const top =
        placement === 'bottom'
          ? trigger.bottom + MARGIN
          : trigger.top - menuHeight - MARGIN;

      let left = trigger.left;
      if (left + menuWidth + MARGIN > viewportWidth) {
        left = Math.max(MARGIN, viewportWidth - menuWidth - MARGIN);
      }
      left = Math.max(MARGIN, left);

      setPosition({ top, left, placement });
    };

    // Defer to the next frame so the menu has rendered and has dimensions.
    const frame = requestAnimationFrame(update);

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, triggerRef, menuRef]);

  return position;
}
