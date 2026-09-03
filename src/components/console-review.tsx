"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { stamped, threadFor } from "@/lib/domain/gui-thread";
import type { GuiRevision } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * The verdict on a console the designer has just asked to be changed — asked
 * for **after** they have flown it, never before.
 *
 * The order took three goes to get right, and the reason is worth keeping.
 * First the rebuilt console was not stored at all, so going to look at it
 * showed the version from before the change. Then it was stored and the trip
 * was offered, but this panel sat *above* the console as a header, with its
 * approve button live from the moment the page opened — so the question
 * "do you accept this?" arrived while the thing being accepted was still an
 * unflown brief further down the page. Which is no better than approving from
 * an empty preview: it just moved the empty preview.
 *
 * So this is now the closing panel of the test. It appears when the run is
 * over — or when the designer says they have seen enough — and it goes in the
 * order a person actually needs: here is what you asked for and what was done,
 * is there anything else, and only then the approval.
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
    <div className="panel mt-8 border-l-2 border-l-accent p-5">
      <h2 className="text-sm font-semibold">
        You have just flown the change. Is it right?
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {wasApproved
          ? "Nothing has been saved — training runs are still using the console you approved before."
          : "Nothing has been saved yet."}
      </p>

      {/* Everything asked for, in order, with what came back for each. The
          console is the sum of all of it, so approving is a decision about
          the whole list and not only about the newest line. */}
      {record.length > 0 ? (
        <div className="mt-4">
          <h3 className="label">What you asked for, and what was done</h3>
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
        </div>
      ) : newest ? (
        <p className="mt-4 text-xs italic text-muted">“{newest}”</p>
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

      {/* The question before the verdict. Something to change is the more
          likely answer on a first look, and asking it second would be asking
          it after the decision had already been offered. */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm">Anything you want changed?</p>
        <Link
          href={`/designer/systems/${systemId}/gui`}
          className="btn mt-2"
          aria-disabled={busy !== null}
        >
          Ask for another change
        </Link>
      </div>

      {/* Only now. */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm">
          Happy with it? Approving is what puts this console in front of
          trainees.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || missingSlots.length > 0}
            onClick={() => void accept(true)}
          >
            {busy === "approve" ? "Approving…" : "Approve these changes"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void accept(false)}
          >
            {busy === "draft" ? "Saving…" : "Keep as a draft"}
          </button>
          <span className="text-xs text-muted">
            A draft keeps the change without using it.
          </span>
        </div>
      </div>
    </div>
  );
}
