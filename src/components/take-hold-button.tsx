"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/lib/http";
import type { SavedExercise } from "@/lib/domain/schemas";

/**
 * Copying an exercise out of a run so it can be corrected.
 *
 * The run itself is never touched. Its debrief and its score are the record of
 * what a trainee actually flew, and an exercise edited underneath them would
 * make that record a lie — so correcting one starts with a copy, and the copy
 * remembers which run it came from.
 */
export function TakeHoldButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function takeHold() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const payload = await readJson<{
        error?: string;
        exercise: SavedExercise;
      }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Could not copy it.");
      router.push(
        `/designer/exercises/${payload.exercise.id}?system=${payload.exercise.system_id}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not copy it.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn text-xs"
        disabled={busy}
        onClick={() => void takeHold()}
      >
        {busy ? "Copying…" : "Take hold of it to correct"}
      </button>
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : null}
    </>
  );
}
