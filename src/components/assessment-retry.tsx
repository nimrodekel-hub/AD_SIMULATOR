"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { RunResult, SimEvent } from "@/lib/domain/schemas";

/**
 * Asks for the written assessment again, from the run that is already saved.
 *
 * This exists because the assessment is the only part of finishing a run that
 * can fail, and it used to fail *instead of* the result: a model's bad minute
 * left the trainee on the console with no route to their own tally. Now the
 * run closes on the engine's count and the prose is fetched separately — so
 * something has to be able to fetch it, and this is that button.
 *
 * It re-posts the stored log and tally rather than recomputing anything. They
 * are the record of what happened and they are not up for revision; the only
 * thing being retried is the writing.
 */
export function AssessmentRetry({
  sessionId,
  log,
  result,
}: {
  sessionId: string;
  log: SimEvent[];
  result: RunResult;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();

  const ask = useCallback(async () => {
    setBusy(true);
    setFailed(undefined);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_log: log, run_result: result }),
      });
      const payload = (await response.json()) as {
        error?: string;
        assessment_error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "The request failed.");
      if (payload.assessment_error) throw new Error(payload.assessment_error);
      // Written and stored: the page is a server component, so re-reading it
      // is what shows the prose.
      router.refresh();
    } catch (reason) {
      setFailed(reason instanceof Error ? reason.message : "It failed again.");
    } finally {
      setBusy(false);
    }
  }, [log, result, router, sessionId]);

  return (
    <div>
      <button
        type="button"
        className="btn"
        onClick={() => void ask()}
        disabled={busy}
      >
        {busy ? "Writing it…" : "Write the assessment"}
      </button>
      {failed ? <p className="mt-3 text-sm text-danger">{failed}</p> : null}
    </div>
  );
}
