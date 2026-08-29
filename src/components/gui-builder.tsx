"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuiTemplate } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import { type JobView, formatWait, useBackgroundJob } from "@/lib/use-job";

/**
 * Setup step 3 — building the simulated console.
 *
 * The screenshots were uploaded and stored in step 1, so nothing is chosen or
 * transferred here: the model is handed the system's stored references and its
 * approved behaviour profile, and returns a console shell.
 *
 * Pressing the button does not hold a connection open. Generation takes a
 * minute or more, and a phone will not wait that long — the screen locks, the
 * tab is suspended, and the request dies even though the server is working. So
 * the button starts the work and this screen asks every few seconds whether it
 * has finished. Closing the page and coming back is free: the answer is waiting
 * when you return.
 */

const REQUIRED_SLOT_LABELS: Record<string, string> = {
  "system-name": "system name",
  clock: "clock",
  tracks: "air picture",
  resources: "resources",
  decision: "decision panel",
};

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

  const [guidance, setGuidance] = useState("");
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

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

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
    },
  });

  function generate() {
    setNotice(undefined);
    return start({
      guidance,
      // Sending the previous attempt makes a regenerate a refinement rather
      // than a fresh roll of the dice.
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
        }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");

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

      {/* ---- What it is built from ---------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Sources</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Built from the {screenshotCount} stored screenshot
          {screenshotCount === 1 ? "" : "s"} and the approved behaviour profile
          together. The screenshots give it a look; the profile decides which
          columns appear, what each identification colour means, and which
          controls the operator gets. Where they disagree, the profile wins — a
          screenshot shows one moment.
        </p>
        <p className="mt-2 text-xs text-muted">
          <Link
            href={`/designer/systems/${systemId}/screenshots`}
            className="hover:text-accent"
          >
            Change the screenshots →
          </Link>
        </p>

        <div className="mt-4 space-y-4">
          {html && !generating ? (
            <label className="block">
              <span className="label">Direction for the next attempt</span>
              <textarea
                className="field min-h-20"
                placeholder="e.g. make the air picture taller, move the resource panel to the left, use amber rather than green for the header"
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
              />
            </label>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void generate()}
          >
            {generating
              ? "Building…"
              : html
                ? "Regenerate"
                : "Generate console"}
          </button>

          {generating ? (
            <div className="panel p-4">
              <p className="text-sm">
                Building the console
                {waited > 0 ? ` — ${formatWait(waited)} so far` : "…"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                This is the longest step in the app; a minute or two is normal.
                It is running on the server, so you can lock your phone, switch
                tabs or close this page — the console will be waiting here when
                you come back.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}

      {/* ---- Preview ------------------------------------------------- */}
      {html ? (
        <section>
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="mt-1 text-xs text-muted">
            The panels are empty here. During a run the air picture, resources
            and decision prompts are rendered into them.
          </p>

          {missingSlots.length > 0 ? (
            <p className="chip status-danger mt-3 !normal-case">
              Missing the{" "}
              {missingSlots
                .map((slot) => REQUIRED_SLOT_LABELS[slot] ?? slot)
                .join(", ")}{" "}
              area — regenerate before approving, or that part of the run will
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

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missingSlots.length > 0}
              onClick={() => void save(true)}
            >
              {saving ? "Saving…" : "Approve template"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Save as draft
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
