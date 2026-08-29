"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/http";

/**
 * Waiting for work the server does without holding the connection open.
 *
 * Three steps here take longer than a phone will keep a request alive:
 * extracting a dilemma from an interview, generating a scenario, and building
 * a console. Each of them answers a press immediately with a job record and
 * carries on server-side; this hook does the other half — start it, ask every
 * few seconds how it is getting on, and hand back the result when it lands.
 *
 * Dropped polls are ignored on purpose. Losing one says nothing about the
 * work: the whole point of not holding the connection is that the wait can
 * survive a locked screen, a tunnel, or a closed tab.
 */

export interface JobView<TResult> {
  status: "idle" | "running" | "done" | "failed";
  error?: string | null;
  result?: TResult | null;
}

/** Often enough to feel responsive, rare enough to be free. */
const POLL_MS = 3000;

export function useBackgroundJob<TResult>({
  startUrl,
  pollUrl = startUrl,
  initial,
  onDone,
}: {
  /** POSTed to in order to start the work. */
  startUrl: string;
  /** GET while it runs. Defaults to the same place. */
  pollUrl?: string;
  /** Whatever was already under way when the page loaded. */
  initial?: JobView<TResult>;
  /** Called once, with the result, when the work finishes. */
  onDone: (result: TResult) => void;
}) {
  const [running, setRunning] = useState(initial?.status === "running");
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | undefined>(
    initial?.status === "failed" ? (initial.error ?? undefined) : undefined,
  );

  // Held in a ref so that passing a fresh closure on every render — which every
  // caller does — does not restart the polling it is waiting on. Synced in an
  // effect rather than during render: a ref written while rendering is a ref
  // the compiler cannot reason about.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const startedAt = Date.now();

    const clock = setInterval(
      () => setWaited(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );

    const poll = setInterval(async () => {
      try {
        const response = await fetch(pollUrl, { cache: "no-store" });
        const job = await readJson<JobView<TResult>>(response);
        if (cancelled) return;

        if (job.status === "done" && job.result) {
          setRunning(false);
          done.current(job.result);
        } else if (job.status === "failed") {
          setError(job.error ?? "It did not finish.");
          setRunning(false);
        } else if (job.status === "idle") {
          // Nothing is recorded as running. Whatever we were waiting on is
          // gone, so stop rather than ask for ever.
          setRunning(false);
        }
      } catch {
        // A dropped poll says nothing about the work. Keep waiting.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [running, pollUrl]);

  const start = useCallback(
    async (body: unknown) => {
      setError(undefined);
      setWaited(0);
      try {
        const response = await fetch(startUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const job = await readJson<JobView<TResult> & { error?: string }>(
          response,
        );
        if (!response.ok) throw new Error(job.error ?? "Could not start.");

        // A press that lands on already-finished work should not sit waiting
        // for a poll that will only repeat what the answer already said.
        if (job.status === "done" && job.result) {
          done.current(job.result);
          return;
        }
        setRunning(true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not start.");
      }
    },
    [startUrl],
  );

  return { running, waited, error, setError, start };
}

/** A wait, in the shortest form that still reads as a duration. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
