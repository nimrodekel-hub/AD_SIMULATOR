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
 */

/* Room left under the platform's request limit for multipart overhead. */
const UPLOAD_BUDGET = MAX_REQUEST_BYTES - 256 * 1024;

const MIN_SCREENSHOTS = 2;
const MAX_SCREENSHOTS = 8;

export function ScreenshotUploader({
  systemId,
  systemName,
  stored,
}: {
  systemId: string;
  systemName: string;
  /** File names already stored for this system. */
  stored: string[];
}) {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [originalBytes, setOriginalBytes] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

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
      setNotice(
        `${payload.screenshots.length} stored. They will be read when your answers are interpreted, and again when the console is built.`,
      );
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = totalBytes > UPLOAD_BUDGET;
  const enough = files.length >= MIN_SCREENSHOTS && files.length <= MAX_SCREENSHOTS;
  const canUpload = enough && !tooLarge && !busy && !preparing;
  const saved = originalBytes - totalBytes;

  return (
    <div className="space-y-8">
      {stored.length > 0 ? (
        <div className="panel flex flex-wrap items-center gap-4 p-4">
          <span className="chip status-ok">{stored.length} stored</span>
          <p className="flex-1 text-sm text-muted">
            {systemName} already has references. Uploading again replaces the
            whole set.
          </p>
        </div>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold">Screenshots of the real console</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Between {MIN_SCREENSHOTS} and {MAX_SCREENSHOTS}. Layout, palette and
          density are reproduced; identifying content is not — no vendor names,
          unit markings or real call signs are carried across.
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
                  ? `None chosen. They are scaled down here before upload, so file size is rarely a problem.`
                  : `${files.length} chosen, ${formatBytes(totalBytes)}${
                      saved > 0 ? ` (down from ${formatBytes(originalBytes)})` : ""
                    }${
                      enough
                        ? ""
                        : ` — need between ${MIN_SCREENSHOTS} and ${MAX_SCREENSHOTS}`
                    }.`}
            </span>
            {tooLarge ? (
              <span className="mt-1.5 block text-xs text-warn">
                That is over the {formatBytes(UPLOAD_BUDGET)} the server accepts
                in one request. Choose fewer screenshots.
              </span>
            ) : null}
          </label>

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
