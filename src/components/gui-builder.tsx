"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuiTemplate } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * Setup step 3 — building the simulated console.
 *
 * The screenshots were uploaded and stored in step 1, so nothing is chosen or
 * transferred here: the model is handed the system's stored references and its
 * approved behaviour profile, and returns a console shell. The designer
 * previews it, regenerates with direction until it looks right, and approves it
 * once. Every training run on this system from then on renders inside it.
 */

const REQUIRED_SLOT_LABELS: Record<string, string> = {
  "system-name": "system name",
  clock: "clock",
  tracks: "air picture",
  resources: "resources",
  decision: "decision panel",
};

export function GuiBuilder({
  systemId,
  systemName,
  screenshotCount,
  existing,
}: {
  systemId: string;
  /** The system's own fictional name. The console is titled with it. */
  systemName: string;
  /** How many references are stored. Shown so the source is never a mystery. */
  screenshotCount: number;
  existing: GuiTemplate | null;
}) {
  const router = useRouter();

  const [guidance, setGuidance] = useState("");
  const [html, setHtml] = useState(existing?.generated_ui_code ?? "");
  const [notes, setNotes] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>(
    existing?.source_screenshots ?? [],
  );
  const [missingSlots, setMissingSlots] = useState<string[]>([]);

  const [busy, setBusy] = useState<"generating" | "saving" | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function generate() {
    setBusy("generating");
    setError(undefined);
    setNotice(undefined);

    try {
      const response = await fetch(`/api/systems/${systemId}/gui/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guidance,
          // Sending the previous attempt makes a regenerate a refinement rather
          // than a fresh roll of the dice.
          previous_html: html || undefined,
        }),
      });
      const payload = await readJson<{
        error?: string;
        html: string;
        design_notes: string;
        screenshots: string[];
        missing_slots?: string[];
      }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Generation failed.");

      setHtml(payload.html);
      setNotes(payload.design_notes);
      setScreenshots(payload.screenshots);
      setMissingSlots(payload.missing_slots ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save(approved: boolean) {
    setBusy("saving");
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
      setBusy(null);
    }
  }

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
          {html ? (
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
            disabled={busy !== null}
            onClick={() => void generate()}
          >
            {busy === "generating"
              ? "Reading the screenshots…"
              : html
                ? "Regenerate"
                : "Generate console"}
          </button>

          {busy === "generating" ? (
            <p className="text-xs text-muted">
              This is the longest step in the app — a minute or two is normal.
              Leave the page open.
            </p>
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
              disabled={busy !== null || missingSlots.length > 0}
              onClick={() => void save(true)}
            >
              {busy === "saving" ? "Saving…" : "Approve template"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
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
