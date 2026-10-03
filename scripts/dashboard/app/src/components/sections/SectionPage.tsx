/**
 * The frame for a section that owns the whole page: Website, Services, Commands.
 *
 * Two jobs, and the second one is why `title` is optional.
 *
 *  1. It supplies the tabpanel element. SectionRail's `aria-controls` points at
 *    `section-<id>`, so on every section the element that IS the tabpanel and the
 *    element the tab CONTROLS have to be the same one - a page that breaks that
 *    looks identical and reads as broken to assistive tech.
 * 2. It optionally supplies a page header. A panel that already titles itself
 *    (Services, Commands - both wrap themselves in GlobalPanel, which carries a
 *    title and a subtitle) must NOT be given a second one: "Services" twice, once
 *    as the h1 and once as the h2 right below it, reads as a rendering bug rather
 *    than as a page and its content. So those entries pass no title and their
 *    panel's own header is the page header; Website, which has no header of its
 *    own, gets one here.
 *
 * `lede` is required whenever `title` is. A page header that names a section
 * without saying what it is for is the thing this file exists to prevent.
 */

import type { ReactNode } from 'react';

export function SectionPage({
  section,
  title,
  lede,
  aside,
  children,
}: {
  /** The section id. The tabpanel element's id is `section-<section>`. */
  section: string;
  /** Omit when the content supplies its own header. See the file header. */
  title?: string;
  /** Required with `title`: what this page is for, in the operator's terms. */
  lede?: string;
  /** Rendered right of the title. Anything with a control in it needs a name. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main
      id={`section-${section}`}
      role="tabpanel"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {title ? (
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-edge px-8 pb-4 pt-5">
          <div className="min-w-0">
            <h1 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">{title}</h1>
            {lede ? (
              <p className="m-0 mt-1 max-w-2xl text-[12.5px] text-ink-subtle">{lede}</p>
            ) : null}
          </div>
          {aside ? <div className="flex shrink-0 items-center gap-3 pt-1">{aside}</div> : null}
        </header>
      ) : null}

      <div className="dw-scroll flex-1 px-8 py-5">{children}</div>
    </main>
  );
}
