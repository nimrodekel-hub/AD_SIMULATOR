import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Frame shared by every screen: it applies the screen's theme and renders a
 * consistent header, so a screen component only ever describes its own content.
 *
 * `theme` is the one thing each screen must decide. See globals.css for why the
 * two differ.
 *
 * The working header was rebuilt to carry a page rather than caption one. It
 * was a 20-pixel title on a hairline, which on a long screen read as another
 * row of text — several pages had then grown a second "← back somewhere" link
 * in the body, because the arrow up here was too quiet to find. So the title
 * is now the size of a title, the back link says where it goes, and `back`
 * exists so a screen can point it at its real parent instead of adding one of
 * its own.
 */
export function ScreenShell({
  theme,
  eyebrow,
  title,
  subtitle,
  actions,
  back,
  children,
  contained = true,
  fullHeight = false,
}: {
  theme: "ops" | "work";
  /** Small label above the title — usually the role this screen belongs to. */
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * Where "back" goes, and what to call it.
   *
   * Defaults to the role picker. A screen that sits inside something — a
   * system, an exercise — should name its parent, so the header is the way
   * out rather than one of two.
   */
  back?: { href: string; label: string };
  children: ReactNode;
  /**
   * Ops screens run edge-to-edge, because horizontal space is information
   * space. Working screens get a reading-width column instead.
   */
  contained?: boolean;
  /**
   * Pin the screen to exactly one viewport and stop the page scrolling.
   *
   * An operator's console is a fixed rectangle of glass: everything is on it
   * at once, and scrolling to find the track you are about to shoot is not a
   * thing that happens. Screens that read rather than run leave this off and
   * grow as tall as their content.
   */
  fullHeight?: boolean;
}) {
  const isOps = theme === "ops";
  const destination = back ?? { href: "/", label: "All roles" };

  return (
    <div
      className={`theme-${theme} flex flex-col bg-bg text-ink ${
        fullHeight ? "h-dvh overflow-hidden" : "min-h-full flex-1"
      }`}
    >
      {isOps ? (
        /* Unchanged: the operations header is a status strip, and every row
           of pixels it takes is a row the air picture does not get. */
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-2.5">
          <Link
            href={destination.href}
            className="text-muted transition-colors hover:text-accent"
            aria-label={destination.label}
          >
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <p className="data text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted">
              {eyebrow}
            </p>
            <h1 className="truncate text-base font-semibold">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : (
        <header className="border-b border-line">
          <div className="mx-auto w-full max-w-5xl px-6 pb-7 pt-6">
            {/* Named rather than an arrow alone. An icon-only control at the
                top of a long page is findable only by people who already
                know it is there. */}
            <Link
              href={destination.href}
              className="-ml-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden>←</span>
              {destination.label}
            </Link>

            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{eyebrow}</p>
                <h1 className="mt-1.5 text-3xl font-semibold leading-tight tracking-[-0.02em]">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
                    {subtitle}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex flex-wrap items-center gap-3">{actions}</div>
              ) : null}
            </div>
          </div>
        </header>
      )}

      <main
        className={
          contained
            ? "mx-auto w-full max-w-5xl flex-1 px-6 py-10"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        {children}
      </main>
    </div>
  );
}
