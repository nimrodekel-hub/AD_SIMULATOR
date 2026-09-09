"use client";

import { useEffect, useState } from "react";

/**
 * A way around a form nine screens long.
 *
 * The behaviour profile is ten sections and nearly ten thousand pixels of
 * continuous scroll, and it had no navigation of any kind. A designer coming
 * back to fix one figure — the detection range, one round's reach — had to
 * scroll for it, and a designer told at the foot of the page that three
 * sections were incomplete had to hunt for all three. Neither is a hard
 * problem; both are the sort that make somebody put a form down.
 *
 * So the sections are listed across the top, they stick while you scroll, each
 * says whether it still has something missing, and the one you are looking at
 * is marked. Nothing here changes what the form asks — it is the map, not the
 * territory.
 */

/**
 * One heading, one id.
 *
 * Exported so the sections and the navigator over them derive the anchor the
 * same way. A pill that points at an id nothing carries scrolls nowhere, and
 * nothing about the page looks wrong when it happens.
 */
export function anchorFor(title: string): string {
  return (
    "section-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

export interface NavSection {
  /** Anchor id on the corresponding <section>. */
  id: string;
  /** The heading, exactly as it reads on the page. */
  title: string;
  /** How many answers this section is still missing. */
  missing: number;
}

export function FormSectionNav({ sections }: { sections: NavSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");

  /* Which section the reader is in. Watched rather than computed from scroll
     position, so it stays right when a section is short or the window is
     resized. The top third of the viewport is the "reading line": a section
     counts as current once its heading reaches it. */
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set(entry.target.id, entry.isIntersecting);
        }
        const first = sections.find((section) => seen.get(section.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-96px 0px -66% 0px" },
    );

    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  const outstanding = sections.filter((section) => section.missing > 0).length;

  return (
    <nav
      aria-label="Sections of this form"
      /* Sticky rather than fixed: it belongs to the form, and a fixed bar
         would sit over the page header on the way past. */
      className="sticky top-0 z-20 -mx-6 mb-8 border-b border-line bg-bg/90 px-6 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-muted">
          {outstanding === 0 ? (
            <span className="text-ok">Nothing outstanding</span>
          ) : (
            <>
              <span className="text-warn">{outstanding}</span>
              {outstanding === 1 ? " section needs" : " sections need"} an answer
            </>
          )}
        </p>

        <ul className="flex flex-1 flex-wrap gap-1.5">
          {sections.map((section) => {
            const active = section.id === current;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    active
                      ? "border-accent bg-accent-dim text-accent"
                      : "border-line text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${
                      section.missing > 0 ? "bg-warn" : "bg-ok"
                    }`}
                  />
                  {section.title}
                  {section.missing > 0 ? (
                    <span className="data text-warn">{section.missing}</span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
