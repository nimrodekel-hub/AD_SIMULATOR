"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuiRevision, GuiTemplate } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import { type JobView, formatWait, useBackgroundJob } from "@/lib/use-job";

/**
 * Setup step 3 — rebuilding the console.
 *
 * The screenshots were uploaded and stored in step 1, so nothing is chosen or
 * transferred here: the model is handed the system's stored references and its
 * approved behaviour profile, and returns a console shell copied from them.
 *
 * The first version of this screen offered one box of "direction" and a
 * Regenerate button, which made every attempt a fresh roll of the dice: the
 * designer would fix the header and lose the panel they had fixed before. It
 * is a conversation now. Every request is kept, all of them are sent with each
 * attempt, and the thread is saved with the console — so a change asked for on
 * Tuesday is still in force on Friday.
 *
 * Pressing send does not hold a connection open. A revision takes a minute or
 * more, and a phone will not wait that long — the screen locks, the tab is
 * suspended, and the request dies even though the server is working. So the
 * message starts the work and this screen asks every few seconds whether it
 * has finished. Closing the page and coming back is free.
 */

const REQUIRED_SLOT_LABELS: Record<string, string> = {
  "system-name": "system name",
  clock: "clock",
  scope: "radar picture",
  tracks: "track list",
  resources: "resources",
  decision: "decision panel",
};

/** Changes designers ask for often enough to be worth offering as a shortcut. */
const COMMON_REQUESTS = [
  "Make the radar picture larger and closer to square.",
  "Match the header colour to the reference more closely.",
  "Move the track list to the other side of the scope.",
  "Tighten the padding — the real console is denser than this.",
];

interface JobResult {
  html: string;
  design_notes: string;
  screenshots: string[];
  missing_slots: string[];
}

export function GuiBuilder({
  systemId,
  systemName,
  screenshotCount,
  existing,
  initialJob,
}: {
  systemId: string;
  /** The system's own fictional name. The console is titled with it. */
  systemName: string;
  /** How many references are stored. Shown so the source is never a mystery. */
  screenshotCount: number;
  existing: GuiTemplate | null;
  /** Whatever generation was already under way when this page loaded. */
  initialJob: JobView<JobResult>;
}) {
  const router = useRouter();

  const [html, setHtml] = useState(
    initialJob.result?.html ?? existing?.generated_ui_code ?? "",
  );
  const [notes, setNotes] = useState(initialJob.result?.design_notes ?? "");
  const [screenshots, setScreenshots] = useState<string[]>(
    initialJob.result?.screenshots ?? existing?.source_screenshots ?? [],
  );
  const [missingSlots, setMissingSlots] = useState<string[]>(
    initialJob.result?.missing_slots ?? [],
  );

  /** The thread so far, oldest first. Every attempt is sent all of it. */
  const [revisions, setRevisions] = useState<GuiRevision[]>(
    existing?.revisions ?? [],
  );
  /** What was just asked for and is still in flight. */
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState("");

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);

  const {
    running: generating,
    waited,
    error,
    setError,
    start,
  } = useBackgroundJob<JobResult>({
    startUrl: `/api/systems/${systemId}/gui/generate`,
    initial: initialJob,
    onDone: (result) => {
      setHtml(result.html);
      setNotes(result.design_notes);
      setScreenshots(result.screenshots);
      setMissingSlots(result.missing_slots);
      setDirty(true);
      // The request is only recorded once something came back for it, so a
      // failed attempt does not leave a change in the thread that was never
      // applied.
      setPending((asked) => {
        if (asked) {
          setRevisions((current) => [
            ...current,
            {
              request: asked,
              notes: result.design_notes,
              at: new Date().toISOString(),
            },
          ]);
        }
        return undefined;
      });
    },
  });

  /** Builds the first console, or asks for a change to the one on screen. */
  function send(request?: string) {
    const asked = (request ?? "").trim();
    setNotice(undefined);
    setPending(asked || undefined);
    setMessage("");
    return start({
      requests: [...revisions.map((entry) => entry.request), asked].filter(
        (entry) => entry.length > 0,
      ),
      // Sending the previous attempt makes this a revision rather than a
      // fresh roll of the dice.
      previous_html: html || undefined,
    });
  }

  async function save(approved: boolean) {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const response = await fetch(`/api/systems/${systemId}/gui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generated_ui_code: html,
          source_screenshots: screenshots,
          approved,
          revisions,
        }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");

      setDirty(false);
      setNotice(
        approved
          ? "Approved. Training runs will render inside this console."
          : "Saved as a draft. Not yet in use.",
      );
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const busy = generating || saving;
  const thin = screenshotCount < 6;

  return (
    <div className="space-y-8">
      {existing ? (
        <div className="panel flex flex-wrap items-center gap-4 p-4">
          <span className={`chip ${existing.approved ? "status-ok" : "status-warn"}`}>
            {existing.approved ? "approved" : "draft"}
          </span>
          <p className="flex-1 text-sm text-muted">
            {existing.approved
              ? `In use for every training run on ${systemName}.`
              : "Not yet in use — training runs still use the built-in console."}
          </p>
        </div>
      ) : null}

      {/* ---- What it is copied from --------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Sources</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Copied from the {screenshotCount} stored screenshot
          {screenshotCount === 1 ? "" : "s"} and built to the approved behaviour
          profile. The screenshots decide how it looks — layout, proportions,
          palette, borders, typography. The profile decides how it behaves —
          which columns appear, what each identification colour means, which
          controls the operator gets.
        </p>

        {thin ? (
          <div className="panel mt-3 border-l-2 border-l-warn p-4">
            <p className="text-sm">
              <strong>
                {screenshotCount} reference
                {screenshotCount === 1 ? "" : "s"} is not much to copy from.
              </strong>{" "}
              This is the usual reason a console comes back looking only roughly
              like the real one — with few views the model is guessing at
              whatever the images do not show.
            </p>
            <p className="mt-2 text-xs text-muted">
              Worth adding: the whole screen, each panel close up, the display
              with tracks and without, and any alert state.
            </p>
            <Link
              href={`/designer/systems/${systemId}/screenshots`}
              className="btn mt-3 text-xs"
            >
              Add more references
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            <Link
              href={`/designer/systems/${systemId}/screenshots`}
              className="hover:text-accent"
            >
              Add or change the screenshots →
            </Link>
          </p>
        )}
      </section>

      {/* ---- First build ------------------------------------------- */}
      {!html ? (
        <section>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void send()}
          >
            {generating ? "Building…" : "Build the console"}
          </button>
        </section>
      ) : null}

      {generating ? (
        <div className="panel p-4">
          <p className="text-sm">
            {pending ? "Applying your change" : "Building the console"}
            {waited > 0 ? ` — ${formatWait(waited)} so far` : "…"}
          </p>
          {pending ? (
            <p className="mt-2 text-xs italic text-muted">“{pending}”</p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            This is the longest step in the app; a minute or two is normal. It
            is running on the server, so you can lock your phone, switch tabs or
            close this page — the result will be waiting here when you come
            back.
          </p>
        </div>
      ) : null}

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}

      {/* ---- Preview ------------------------------------------------- */}
      {html ? (
        <section>
          <h2 className="text-sm font-semibold">The console</h2>
          <p className="mt-1 text-xs text-muted">
            The panels are empty here. During a run the radar picture, the track
            list, the resources and the controls are rendered into them.
          </p>

          {missingSlots.length > 0 ? (
            <p className="chip status-danger mt-3 !normal-case">
              Missing the{" "}
              {missingSlots
                .map((slot) => REQUIRED_SLOT_LABELS[slot] ?? slot)
                .join(", ")}{" "}
              area — ask for it before approving, or that part of the run will
              have nowhere to render.
            </p>
          ) : null}

          {notes ? (
            <p className="panel mt-3 p-3 text-xs leading-relaxed text-muted">
              {notes}
            </p>
          ) : null}

          {/* Sandboxed: the preview cannot run scripts or reach this page. */}
          <iframe
            title="Simulated console preview"
            className="mt-4 h-[32rem] w-full rounded border border-line bg-black"
            sandbox=""
            srcDoc={`<style>body{margin:0;background:#0a0e14;min-height:100vh}</style>${html}`}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href={`/designer/systems/${systemId}/gui/rehearse`}
              className="btn text-xs"
            >
              Fly targets on it →
            </Link>
            <span className="text-xs text-muted">
              Runs tracks and interceptions on this console, with the real
              controls, without involving a trainee.
            </span>
          </div>
        </section>
      ) : null}

      {/* ---- The conversation --------------------------------------- */}
      {html ? (
        <section>
          <h2 className="text-sm font-semibold">Ask for changes</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Say what is wrong and it is rebuilt with that change — and with
            everything you asked for before, so nothing you have already fixed
            comes undone.
          </p>

          {revisions.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {revisions.map((entry, index) => (
                <li key={index} className="panel p-3">
                  <p className="text-sm">
                    <span className="mr-2 text-muted">{index + 1}.</span>
                    {entry.request}
                  </p>
                  {entry.notes ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {entry.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="label">What should be different?</span>
              <textarea
                className="field min-h-20"
                placeholder="e.g. the scope should fill the left two thirds, the header is too light, put the resource readout under the track list"
                value={message}
                disabled={busy}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {COMMON_REQUESTS.map((request) => (
                <button
                  key={request}
                  type="button"
                  className="btn text-xs"
                  disabled={busy}
                  onClick={() => setMessage(request)}
                >
                  {request}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || message.trim().length === 0}
              onClick={() => void send(message)}
            >
              {generating ? "Rebuilding…" : "Send the change"}
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- Keeping it --------------------------------------------- */}
      {html ? (
        <section className="border-t border-line pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missingSlots.length > 0}
              onClick={() => void save(true)}
            >
              {saving ? "Saving…" : "Approve console"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Save as draft
            </button>
            {dirty ? (
              <span className="text-xs text-warn">
                This version is not saved yet.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
