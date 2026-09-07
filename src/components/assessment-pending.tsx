"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunResult, SimEvent } from "@/lib/domain/schemas";

/**
 * Waits for the written assessment of a run that is already saved.
 *
 * The run closes on the engine's count and the prose is written separately,
 * after the response, so there is a window — a minute, sometimes two — where
 * the trainee has their full tally and the reading of it does not exist yet.
 *
 * This used to be a bare button labelled "Write the assessment", which was
 * wrong twice over. It asked the trainee to request something that was already
 * being written, and pressing it spent a second model call to produce the same
 * text — real money, for nothing. So the normal case is now waiting: the page
 * re-reads itself every few seconds until the prose lands, and says so.
 *
 * The button survives for the case it was actually built for — the assessment
 * failed and nothing is coming — and it only appears once waiting has stopped
 * being a reasonable explanation.
 */

/** How often to look, and for how long before assuming nothing is coming. */
const LOOK_EVERY_MS = 5000;
const GIVE_UP_AFTER_MS = 180000;

export function AssessmentPending({
  sessionId,
  log,
  result,
}: {
  sessionId: string;
  log: SimEvent[];
  result: RunResult;
}) {
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();

  /* The page is a server component: re-reading it is what shows the prose, and
     this unmounts the moment it does — the parent stops rendering it. The
     clock is read on mount rather than while rendering, because a render must
     not depend on the time or React is entitled to disagree with itself. */
  const since = useRef(0);
  useEffect(() => {
    if (since.current === 0) since.current = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - since.current;
      setWaited(elapsed);
      if (elapsed < GIVE_UP_AFTER_MS) router.refresh();
      else clearInterval(timer);
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  const stillWaiting = waited < GIVE_UP_AFTER_MS;

  const ask = useCallback(async () => {
    setBusy(true);
    setFailed(undefined);
    try {
      /* Re-posts the stored log and tally rather than recomputing anything.
         They are the record of what happened and are not up for revision; the
         only thing being retried is the writing. */
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
      since.current = Date.now();
      setWaited(0);
    } catch (reason) {
      setFailed(reason instanceof Error ? reason.message : "It failed again.");
    } finally {
      setBusy(false);
    }
  }, [log, result, sessionId]);

  if (stillWaiting) {
    return (
      <p className="text-sm text-muted">
        <span className="text-ink">Being written now.</span> Your result above
        is already final and saved — this page will show the reading of it as
        soon as it lands. Nothing is lost if you leave; it will be here when you
        come back.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm">
        The assessment has not arrived. The run itself is saved and scored —
        only the written reading of it is missing, and asking again is safe.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => void ask()}
        disabled={busy}
      >
        {busy ? "Asking…" : "Write the assessment"}
      </button>
      {failed ? <p className="mt-3 text-sm text-danger">{failed}</p> : null}
    </div>
  );
}
