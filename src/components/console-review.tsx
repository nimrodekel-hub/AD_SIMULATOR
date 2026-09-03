"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
          revisions: threadFor(requests, storedRevisions, designNotes),
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
          This is the console with your change applied, running with live
          targets. It is not saved yet
          {wasApproved
            ? " — training runs are still using the version you approved before."
            : "."}
        </p>
      </div>

      {newest ? (
        <p className="mt-2 text-xs italic text-muted">“{newest}”</p>
      ) : null}
      {designNotes ? (
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          {designNotes}
        </p>
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

/**
 * The conversation to store with an accepted build.
 *
 * The build carries the requests it answers; the console carries the notes and
 * timestamps recorded when each was applied. Matching them by position keeps
 * the history that already exists and adds an entry only for the request that
 * has not been recorded yet — so accepting a revision on this page leaves the
 * same thread the builder would have left.
 */
function threadFor(
  requests: string[],
  stored: GuiRevision[],
  designNotes: string,
): GuiRevision[] {
  const now = new Date().toISOString();
  return requests.map((request, index) =>
    stored[index]?.request === request
      ? stored[index]
      : { request, notes: designNotes, at: now },
  );
}
