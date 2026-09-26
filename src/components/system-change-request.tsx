"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Where a designer asks for a change to their system in their own words.
 *
 * The console builder answers requests about the screen, and until this there
 * was nowhere to ask for anything else: a request about behaviour — which
 * tracks reply to IFF, how long a reload takes, how far a round reaches — came
 * back as "not here", with directions to a field in a ten-section form. This
 * box takes either, and says before anything is saved exactly what it would
 * change.
 *
 * Nothing is written until the designer presses Apply on the lines in front of
 * them. The page's server data is then refreshed, and the two things on these
 * pages that hold their own copy of it — the profile form and the console
 * builder — are keyed on that data, so they are rebuilt from it rather than
 * left stale. A stale profile form is not cosmetic: saved later, it would
 * write straight back over the change that was just made.
 */

interface Change {
  where: string;
  before: string;
  after: string;
}

interface Edit {
  op: "set" | "add" | "remove";
  path: string;
  value_json: string;
}

interface Proposal {
  summary: string;
  edits: Edit[];
  changes: Change[];
  console_request: string;
  cannot: string[];
  failed: Array<{ path: string; reason: string }>;
  invalid: string[];
  new_gaps: string | null;
  blocker: string | null;
}

export function SystemChangeRequest({
  systemId,
  hasConsole,
}: {
  systemId: string;
  /** Whether a screen request can be carried out at all. */
  hasConsole: boolean;
}) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<"proposing" | "applying" | null>(null);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const router = useRouter();
  const pathname = usePathname();

  async function propose() {
    const request = text.trim();
    if (!request || busy) return;
    setBusy("proposing");
    setError(undefined);
    setDone(undefined);
    setProposal(null);
    try {
      const response = await fetch(`/api/systems/${systemId}/change`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That did not work.");
      setAsked(request);
      setProposal(body as Proposal);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!proposal || busy) return;
    setBusy("applying");
    setError(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/change/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: asked,
          edits: proposal.edits,
          console_request: proposal.console_request,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That did not work.");

      const saved: number = body.saved ?? 0;
      const screen: { started: boolean; error?: string } = body.console ?? {
        started: false,
      };

      const lines = [
        saved > 0
          ? `Saved ${saved} change${saved === 1 ? "" : "s"} to how the system behaves. Runs from now on use it.`
          : "",
        screen.started
          ? "The console is being rebuilt — you will review it before trainees see it."
          : screen.error
            ? `The screen was not changed: ${screen.error}`
            : "",
      ].filter(Boolean);
      setDone(lines.join(" ") || "Nothing needed changing.");
      setProposal(null);
      setText("");
      setBusy(null);

      /* A screen change is reviewed where every console change is reviewed,
         and the builder there — keyed on the job — picks up the rebuild that
         is now running. Anything else stays here, with the page's data
         refreshed under it. */
      const consolePage = `/designer/systems/${systemId}/gui`;
      if (screen.started && pathname !== consolePage) {
        router.push(consolePage);
      } else {
        router.refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That did not work.");
      setBusy(null);
    }
  }

  function discard() {
    setProposal(null);
    setError(undefined);
  }

  const nothing =
    proposal &&
    proposal.changes.length === 0 &&
    !proposal.console_request;
  const blocked = !!proposal?.blocker;

  return (
    <section className="panel p-6" aria-labelledby={`change-${systemId}`}>
      <h2 id={`change-${systemId}`} className="section-title">
        Ask for a change
      </h2>
      <p className="section-note">
        How it behaves or how the screen looks — in your own words, in any
        language. You see exactly what would change before anything is saved.
      </p>

      {done ? (
        <p className="mt-4 border-l-2 border-l-ok pl-3 text-sm" role="status">
          {done}
        </p>
      ) : null}

      <label className="sr-only" htmlFor={`change-text-${systemId}`}>
        What should change
      </label>
      <textarea
        id={`change-text-${systemId}`}
        className="field mt-4 min-h-20"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void propose();
          }
        }}
        placeholder={
          hasConsole
            ? "e.g. Civil traffic answers on Mode 3 only · A reload takes 12 seconds · The radar scope should take two thirds of the screen"
            : "e.g. Civil traffic answers on Mode 3 only · A reload takes 12 seconds · The long-range round reaches 100 km"
        }
        disabled={busy !== null}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void propose()}
          disabled={!text.trim() || busy !== null}
        >
          {busy === "proposing" ? "Working out what that changes…" : "Show me the change"}
        </button>
        <span className="text-xs text-muted">
          Nothing is saved until you apply it.
        </span>
      </div>

      {error ? (
        <p className="mt-4 border-l-2 border-l-danger pl-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {proposal ? (
        <div className="mt-6 space-y-5 border-t border-line pt-5" aria-live="polite">
          <p className="text-sm font-semibold">{proposal.summary}</p>

          {proposal.changes.length > 0 ? (
            <div>
              <p className="eyebrow">
                How it behaves — {proposal.changes.length} change
                {proposal.changes.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-line">
                {proposal.changes.map((change, index) => (
                  <li key={index} className="px-4 py-2.5 text-sm">
                    <p className="text-xs text-muted">{change.where}</p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted line-through decoration-1">
                        {change.before}
                      </span>
                      <span aria-hidden className="text-muted">
                        →
                      </span>
                      <span className="sr-only">becomes</span>
                      <span className="font-medium text-accent">{change.after}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {proposal.console_request ? (
            <div>
              <p className="eyebrow">The screen</p>
              <p className="mt-2 text-sm">{proposal.console_request}</p>
              <p className="mt-1 text-xs text-muted">
                Rebuilt from your screenshots, which takes a minute or two. You
                review the new console before trainees see it.
              </p>
            </div>
          ) : null}

          {proposal.cannot.length > 0 || proposal.failed.length > 0 ? (
            <div>
              <p className="eyebrow">Not done</p>
              <ul className="mt-2 space-y-1.5">
                {proposal.cannot.map((line, index) => (
                  <li key={`c${index}`} className="border-l-2 border-l-warn pl-3 text-sm">
                    {line}
                  </li>
                ))}
                {proposal.failed.map((entry, index) => (
                  <li key={`f${index}`} className="border-l-2 border-l-warn pl-3 text-sm">
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {blocked ? (
            <p className="border-l-2 border-l-danger pl-3 text-sm" role="alert">
              This cannot be applied as it stands. {proposal.blocker}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {nothing ? (
              <p className="text-sm text-muted">
                There is nothing here that can be changed. Try saying it
                differently, or more specifically.
              </p>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void apply()}
                disabled={blocked || busy !== null}
              >
                {busy === "applying" ? "Applying…" : "Apply"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={discard}
              disabled={busy !== null}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
