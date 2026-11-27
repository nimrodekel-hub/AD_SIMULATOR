"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders the designer's console shell and puts the live exercise inside it.
 *
 * The shell is static markup generated once from reference screenshots. It
 * carries `data-slot` markers where information belongs; this component finds
 * them and renders real React into each one through a portal.
 *
 * That split is the point: the appearance comes from the model, the behaviour
 * does not. The track table stays a real component with real data — it is not
 * markup the model wrote and it cannot be broken by the model getting the
 * shell wrong.
 *
 * **Each slot is sealed.** The split used to stop at the slot's edge: the
 * instruments were rendered straight into the shell's DOM, so the shell's
 * stylesheet reached into them — and a generated shell carries a lot of
 * stylesheet. One approved console had 46 `!important` rules aimed at
 * whatever the simulator might render, matched by guesses at class names
 * (`button[class*="fire" i]`). It restyled every button it hit, missed the
 * one it was asked to make red, and clipped the engagement panel. The
 * designer's request — "make the fire button red and round" — was answered
 * with CSS that could never match anything, and nothing said so.
 *
 * So the instruments now live in a shadow root on each slot. The shell still
 * decides where each slot is and how big — the frame, the borders, the panel
 * headings — and nothing more. Inside, the app's own stylesheets apply and the
 * shell's cannot. Theme variables still arrive, because custom properties
 * inherit across the boundary.
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
      if (name) found[name] = seal(element);
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

/**
 * Gives one slot a shadow root with the app's styles in it, and returns the
 * element to render into.
 *
 * The stylesheets are the document's own, copied from `<head>` — never the
 * shell's, which lives in the body beside the slots. A slot sealed once keeps
 * its mount, so a second pass over the same markup (React's development
 * double-run of effects) does not stack a second copy.
 *
 * React events still arrive: a portal attaches React's listeners to its own
 * container, which here is inside the shadow root, so clicks are seen before
 * the shadow boundary retargets them.
 */
function seal(slot: HTMLElement): HTMLElement {
  const shadow = slot.shadowRoot ?? slot.attachShadow({ mode: "open" });
  const existing = shadow.querySelector<HTMLElement>(".ops-mount");
  if (existing) return existing;

  document.head
    .querySelectorAll('link[rel="stylesheet"], style')
    .forEach((sheet) => shadow.appendChild(sheet.cloneNode(true)));

  const mount = document.createElement("div");
  /* `theme-ops` here as well as outside: selectors written as
     `.theme-ops .x` cannot see across the boundary, so the theme has to be
     restated on this side of it. */
  mount.className = "ops-mount theme-ops ops-root";
  mount.style.cssText =
    "height:100%;width:100%;min-height:0;min-width:0;display:flex;flex-direction:column;";
  shadow.appendChild(mount);
  return mount;
}
