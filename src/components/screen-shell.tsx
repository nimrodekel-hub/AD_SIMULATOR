import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Frame shared by every screen: it applies the screen's theme and renders a
 * consistent header, so a screen component only ever describes its own content.
 *
 * `theme` is the one thing each screen must decide. See globals.css for why the
 * two differ.
 */
export function ScreenShell({
  theme,
  eyebrow,
  title,
  subtitle,
  actions,
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

  return (
    <div
      className={`theme-${theme} flex flex-col bg-bg text-ink ${
        fullHeight ? "h-dvh overflow-hidden" : "min-h-full flex-1"
      }`}
    >
      <header
        className={`flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line ${
          isOps ? "px-4 py-2.5" : "px-6 py-4"
        }`}
      >
        <Link
          href="/"
          className="text-muted transition-colors hover:text-accent"
          aria-label="Back to role selection"
        >
          ←
        </Link>

        <div className="min-w-0 flex-1">
          <p
            className={`text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted ${
              isOps ? "data" : ""
            }`}
          >
            {eyebrow}
          </p>
          <h1
            className={`truncate font-semibold ${isOps ? "text-base" : "text-xl"}`}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </header>

      <main
        className={
          contained
            ? "mx-auto w-full max-w-5xl flex-1 px-6 py-8"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        {children}
      </main>
    </div>
  );
}
