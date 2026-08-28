"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders the designer's console shell and puts the live scenario inside it.
 *
 * The shell is static markup generated once from reference screenshots. It
 * carries `data-slot` markers where information belongs; this component finds
 * them and renders real React into each one through a portal.
 *
 * That split is the point: the appearance comes from the model, the behaviour
 * does not. The track table stays a real component with real data — it is not
 * markup the model wrote and it cannot be broken by the model getting the
 * shell wrong.
 */
export function SimulatedConsole({
  html,
  slots,
}: {
  html: string;
  /** Keyed by the `data-slot` value each node should be rendered into. */
  slots: Record<string, ReactNode>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<Record<string, HTMLElement>>({});

  /* Collect the slot elements once the shell is in the DOM. Depends on the
     markup alone — `slots` is rebuilt on every render, and depending on it
     would re-run this forever. */
  useEffect(() => {
    const root = host.current;
    if (!root) return;

    const found: Record<string, HTMLElement> = {};
    root.querySelectorAll<HTMLElement>("[data-slot]").forEach((element) => {
      const name = element.dataset.slot;
      if (name) found[name] = element;
    });
    setTargets(found);
  }, [html]);

  return (
    <>
      {/* The shell is stripped of scripts, handlers and javascript: URLs
          before it is ever stored — see sanitiseHtml in ai/tasks/generate-gui. */}
      <div
        ref={host}
        className="flex min-h-0 flex-1 flex-col"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {Object.entries(targets).map(([name, element]) =>
        slots[name] ? createPortal(slots[name], element, name) : null,
      )}
    </>
  );
}
