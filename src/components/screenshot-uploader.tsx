"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_REQUEST_BYTES, formatBytes, readJson } from "@/lib/http";
import { prepareImage } from "@/lib/images";

/**
 * Setup step 1 — the system's reference screenshots.
 *
 * They are uploaded before the system is described, because the questions that
 * follow ask what the display shows, and those answers are far easier to read
 * correctly with the display itself in hand. The same images are used again
 * when the console is generated, so they are stored against the system rather
 * than passed through the console step.
 *
 * The console is *copied* from these, and the copy is only as good as what it
 * had to look at. The first version of this step accepted eight and replaced
 * the set on every upload, which quietly capped a system at whatever fitted in
 * one 4.5 MB request. Now uploads add to what is there, and a single reference
 * can be dropped on its own — so gathering twenty views is a matter of a few
 * trips rather than something the form forbids.
 */

/* Room left under the platform's request limit for multipart overhead. */
const UPLOAD_BUDGET = MAX_REQUEST_BYTES - 256 * 1024;

const MIN_SCREENSHOTS = 2;
const MAX_SCREENSHOTS = 20;

/** What is worth photographing, in the order a designer will think of it. */
const WORTH_CAPTURING = [
  "the whole screen, at least once — the layout is taken from this",
  "each panel close up, so the type and the borders are readable",
  "the display with tracks on it, and with none",
  "a track selected, and an alert state if the system has one",
  "any menu, key or legend the operator reads",
];

export function ScreenshotUploader({
  systemId,
  systemName,
  stored,
}: {
  systemId: string;
  systemName: string;
  /** Stored paths for this system, newest last. */
  stored: string[];
}) {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [originalBytes, setOriginalBytes] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  /** Adding is the default once anything is stored; replacing is deliberate. */
  const [replace, setReplace] = useState(false);

  /**
   * Scales the chosen screenshots down before anything is sent.
   *
   * Done on selection rather than on submit so the size shown next to the
   * chooser is the size that will actually be uploaded.
   */
  async function choose(chosen: File[]) {
    setPreparing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const prepared = await Promise.all(chosen.map(prepareImage));
      setFiles(prepared.map((entry) => entry.file));
      setOriginalBytes(prepared.reduce((sum, e) => sum + e.originalBytes, 0));
    } finally {
      setPreparing(false);
    }
  }

  async function upload() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const form = new FormData();
      for (const file of files) form.append("screenshots", file);
      if (!replace && stored.length > 0) form.append("mode", "add");

      const response = await fetch(`/api/systems/${systemId}/screenshots`, {
        method: "POST",
        body: form,
      });
      const payload = await readJson<{ error?: string; screenshots: string[] }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error ?? "Upload failed.");

      setFiles([]);
      setOriginalBytes(0);
      setReplace(false);
      setNotice(
        `${payload.screenshots.length} reference${payload.screenshots.length === 1 ? "" : "s"} stored. Add more whenever you have them — the console is copied from these, and every extra view makes the copy closer.`,
      );
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    setRemoving(path);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/systems/${systemId}/screenshots?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Could not remove it.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove it.");
    } finally {
      setRemoving(undefined);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = totalBytes > UPLOAD_BUDGET;
  const adding = !replace && stored.length > 0;
  const willHold = (adding ? stored.length : 0) + files.length;
  const room = MAX_SCREENSHOTS - (adding ? stored.length : 0);

  const enough = willHold >= MIN_SCREENSHOTS && willHold <= MAX_SCREENSHOTS;
  const canUpload =
    files.length > 0 && enough && !tooLarge && !busy && !preparing;
  const saved = originalBytes - totalBytes;

  return (
    <div className="space-y-8">
      {/* ---- What is already here ----------------------------------- */}
      {stored.length > 0 ? (
        <section>
          <div className="panel flex flex-wrap items-center gap-4 p-4">
            <span
              className={`chip ${stored.length >= 6 ? "status-ok" : "status-warn"}`}
            >
              {stored.length} stored
            </span>
            <p className="flex-1 text-sm text-muted">
              {stored.length >= 6
                ? `${systemName} has enough reference for a close copy. More still helps.`
                : `${systemName} has ${stored.length}. The console is copied from these — with only a few views the copy is a guess in the gaps.`}
            </p>
          </div>

          <ul className="mt-3 space-y-1">
            {stored.map((path) => (
              <li
                key={path}
                className="flex items-center gap-3 text-xs text-muted"
              >
                <span className="min-w-0 flex-1 truncate">
                  {path.split("/").pop()}
                </span>
                <button
                  type="button"
                  className="px-2 py-1 transition-colors hover:text-danger disabled:opacity-40"
                  disabled={removing !== undefined || busy}
                  onClick={() => void remove(path)}
                  aria-label={`Remove ${path.split("/").pop()}`}
                  title="Remove this reference"
                >
                  {removing === path ? "…" : "✕"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Adding more -------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">
          {stored.length > 0
            ? "Add more views of the real console"
            : "Screenshots of the real console"}
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The console a trainee sits at is <strong>copied</strong> from these —
          layout, proportions, palette, borders, typography. Send as many as you
          can, up to {MAX_SCREENSHOTS}: different views show different panels
          and states, and a colour that only appears during an alert cannot be
          copied from a screenshot taken when nothing was happening.
        </p>
        <ul className="mt-2 max-w-2xl space-y-1">
          {WORTH_CAPTURING.map((item) => (
            <li key={item} className="text-xs leading-relaxed text-muted">
              — {item}
            </li>
          ))}
        </ul>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
          Identifying content is not carried across: no vendor names, unit
          markings or real call signs. Only the appearance is copied.
        </p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="label">Screenshots</span>
            <input
              type="file"
              className="field"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={(event) =>
                void choose(Array.from(event.target.files ?? []))
              }
            />
            <span className="mt-1.5 block text-xs text-muted">
              {preparing
                ? "Scaling them down…"
                : files.length === 0
                  ? "None chosen. They are scaled down here before upload, so file size is rarely a problem."
                  : `${files.length} chosen, ${formatBytes(totalBytes)}${
                      saved > 0 ? ` (down from ${formatBytes(originalBytes)})` : ""
                    }${
                      adding
                        ? ` — ${willHold} in total`
                        : willHold < MIN_SCREENSHOTS
                          ? ` — a system needs at least ${MIN_SCREENSHOTS}`
                          : ""
                    }.`}
            </span>

            {willHold > MAX_SCREENSHOTS ? (
              <span className="mt-1.5 block text-xs text-warn">
                That would be {willHold}, and {MAX_SCREENSHOTS} is the most a
                system holds. Room for {room > 0 ? room : 0} more — or remove
                some above.
              </span>
            ) : null}

            {tooLarge ? (
              <span className="mt-1.5 block text-xs text-warn">
                That is over the {formatBytes(UPLOAD_BUDGET)} the server accepts
                in one request. Send them in two batches — the second one adds
                to the first rather than replacing it.
              </span>
            ) : null}
          </label>

          {stored.length > 0 ? (
            <label className="flex items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
              />
              <span>
                Replace the {stored.length} stored reference
                {stored.length === 1 ? "" : "s"} instead of adding to them.
              </span>
            </label>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!canUpload}
            onClick={() => void upload()}
          >
            {preparing
              ? "Preparing…"
              : busy
                ? "Storing…"
                : adding
                  ? `Add ${files.length || ""} to the references`.replace("  ", " ")
                  : stored.length > 0
                    ? "Replace the references"
                    : "Store the references"}
          </button>
        </div>
      </section>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}
    </div>
  );
}
