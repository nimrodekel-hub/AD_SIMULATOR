"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { stamped, threadFor } from "@/lib/domain/gui-thread";
import type { GuiRevision } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * The verdict on a console the designer has just asked to be changed.
 *
 * A revision used to land in the builder's own React state and nowhere else,
 * so the one button that invited the designer to go and look at it — the test,
 * which is a server page reading the stored console — showed them the version
 * from *before* their change. The change had been made and the screen said
 * otherwise, which reads exactly like a builder that ignores what it is told.
 *
 * So a finished build is now kept with the job that produced it, the test
 * renders that build rather than the stored one, and this bar sits over it to
 * close the loop: here is what you asked for, running — do you accept it, or
 * is there something else? Accepting is what finally writes it to the console,
 * because approving is a deliberate act in this app and never a side effect of
 * asking a question.
 *
 * Until it is accepted the stored console is untouched, so a trainee starting
 * a run mid-review still gets the last console their instructor approved
 * rather than an unreviewed one.
 */
export function ConsoleReview({
  systemId,
  html,
  screenshots,
  requests,
  designNotes,
  missingSlots,
  storedRevisions,
  wasApproved,
}: {
  systemId: string;
  /** The build under review. Written to the console only if accepted. */
  html: string;
  screenshots: string[];
  /** Every change this build answers, oldest first. */
  requests: string[];
  designNotes: string;
  missingSlots: string[];
  /** The thread already saved with the console, to be matched against. */
  storedRevisions: GuiRevision[];
  /** Whether the console this replaces was in use for training runs. */
  wasApproved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "draft" | null>(null);
  const [error, setError] = useState<string>();

  const newest = requests.at(-1);
  /* The whole record, not only what was just asked: the console is the sum of
     every request, and a designer deciding whether to approve it is deciding
     about all of them. Notes are kept per entry where they were recorded; the
     entry this build answers gets the notes that came back with it. */
  const record = requests.map((request, index) => ({
    request,
    notes:
      storedRevisions[index]?.request === request
        ? storedRevisions[index].notes
        : designNotes,
    at: storedRevisions[index]?.request === request ? storedRevisions[index].at : "",
    isNew: storedRevisions[index]?.request !== request,
  }));

  async function accept(approved: boolean) {
    setBusy(approved ? "approve" : "draft");
    setError(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/gui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generated_ui_code: html,
          source_screenshots: screenshots,
          approved,
          revisions: stamped(threadFor(requests, storedRevisions, designNotes)),
        }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");
      // Re-rendering the page is what clears this bar: once the console holds
      // this build there is nothing left under review.
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-b border-line bg-panel-raised px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="chip status-warn">under review</span>
        <p className="min-w-0 flex-1 text-sm">
          This is the console with your change applied. Take the position below
          and look at it with things moving on it before you decide. It is not
          saved yet
          {wasApproved
            ? " — training runs are still using the version you approved before."
            : "."}
        </p>
      </div>

      {/* Everything asked for, in order, with what came back for each. The
          console is the sum of all of it, so approving is a decision about
          the whole list and not only about the newest line. */}
      {record.length > 0 ? (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs text-muted">
            {record.length} change{record.length === 1 ? "" : "s"} asked for so
            far — what was requested, and what was done
          </summary>
          <ol className="mt-2 space-y-2">
            {record.map((entry, index) => (
              <li
                key={index}
                className={`border-l-2 pl-3 ${
                  entry.isNew ? "border-l-accent" : "border-l-line"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="data text-[0.65rem] text-muted">
                    {index + 1}.
                  </span>
                  <p className="min-w-0 flex-1 text-xs">{entry.request}</p>
                  {entry.isNew ? (
                    <span className="chip status-warn">this one</span>
                  ) : entry.at ? (
                    <span className="data text-[0.6rem] text-muted">
                      {new Date(entry.at).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                {entry.notes ? (
                  <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted">
                    <span className="text-muted/70">What was done: </span>
                    {entry.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : newest ? (
        <p className="mt-2 text-xs italic text-muted">“{newest}”</p>
      ) : null}

      {missingSlots.length > 0 ? (
        <p className="chip status-danger mt-2 !normal-case">
          This build is missing the {missingSlots.join(", ")} area, so it cannot
          be approved. Ask for it and try again.
        </p>
      ) : null}
      {error ? (
        <p className="chip status-danger mt-2 !normal-case">{error}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || missingSlots.length > 0}
          onClick={() => void accept(true)}
        >
          {busy === "approve" ? "Approving…" : "Approve these changes"}
        </button>
        <Link
          href={`/designer/systems/${systemId}/gui`}
          className="btn"
          aria-disabled={busy !== null}
        >
          Ask for another change
        </Link>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void accept(false)}
        >
          {busy === "draft" ? "Saving…" : "Keep as a draft"}
        </button>
        <span className="text-xs text-muted">
          Approving puts this console in front of trainees. A draft keeps it
          without using it.
        </span>
      </div>
    </div>
  );
}
