"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { threadFor } from "@/lib/domain/gui-thread";
import type {
  Revision,
  SavedScenario,
  ScenarioInstance,
} from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import { type JobView, formatWait, useBackgroundJob } from "@/lib/use-job";

/**
 * Reading one exercise, and telling the generator what is wrong with it.
 *
 * The same conversation the console builder has, for the same reason: a
 * designer can see that an engagement is no good long before they can say
 * which number to change, and "the second arrival lands while I am still
 * committing to the first" is a thing a person can say. Every complaint is
 * kept and all of them travel with each attempt, so a correction cannot
 * quietly undo one that was already made.
 *
 * Nothing is written until it is accepted. A correction lands on the job that
 * produced it and is shown beside the version it replaces, because an exercise
 * that changed under a designer who had not read it is the same failure as a
 * console that did.
 */

/** What the correction job hands back. */
interface JobResult {
  scenario: ScenarioInstance;
  notes: string;
  requests?: string[];
}

/** Complaints designers make often enough to be worth offering as a shortcut. */
const COMMON = [
  "The arrivals are too close together — space them out so each decision can be made.",
  "Too easy. Give me a real trade-off, and not enough rounds to be careless.",
  "The friendly track is obvious. Make the identification genuinely uncertain.",
  "The window is too long — nothing happens for the first two minutes.",
];

export function ScenarioWorkbench({
  saved,
  canRevise,
  profileApproved,
  initialJob,
}: {
  saved: SavedScenario;
  /** False when the dilemma is gone: nothing to lay the exercise out from. */
  canRevise: boolean;
  profileApproved: boolean;
  initialJob: JobView<JobResult>;
}) {
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

  /** The correction waiting to be read, if one has come back. */
  const [proposed, setProposed] = useState<JobResult | null>(() =>
    initialJob.status === "done" && initialJob.result
      ? initialJob.result
      : null,
  );

  const [revisions, setRevisions] = useState<Revision[]>(saved.revisions);
  const [pending, setPending] = useState<string>();
  const askedRef = useRef<string | undefined>(undefined);

  const {
    running,
    waited,
    error,
    setError,
    start,
  } = useBackgroundJob<JobResult>({
    startUrl: `/api/scenarios/${saved.id}/revise`,
    initial: initialJob,
    onDone: (result) => {
      setPending(undefined);
      askedRef.current = undefined;
      setProposed(result);
    },
  });

  function send(request: string) {
    const asked = request.trim();
    if (!asked) return;
    setNotice(undefined);
    setPending(asked);
    askedRef.current = asked;
    setMessage("");
    return start({
      system_id: saved.system_id,
      requests: [...revisions.map((entry) => entry.request), asked],
    });
  }

  /** Accepting is the only thing that writes to the exercise. */
  async function accept() {
    if (!proposed) return;
    setSaving(true);
    setError(undefined);
    try {
      const thread = threadFor(
        proposed.requests ?? revisions.map((entry) => entry.request),
        revisions,
        proposed.notes,
      ).map((entry) =>
        entry.at ? entry : { ...entry, at: new Date().toISOString() },
      );

      const response = await fetch(`/api/scenarios/${saved.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_id: saved.system_id,
          scenario_instance: proposed.scenario,
          revisions: thread,
        }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Could not save it.");

      setRevisions(thread);
      setProposed(null);
      setNotice("Saved. This is the exercise now.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  }

  const busy = running || saving;
  /* What is on screen: the correction if one is waiting to be read, otherwise
     the exercise as it stands. */
  const showing = proposed?.scenario ?? saved.scenario_instance;

  return (
    <div className="space-y-8">
      {!profileApproved ? (
        <p className="chip status-warn !normal-case">
          This system has no approved profile, so a correction would be laid out
          against the simulator&apos;s own defaults rather than this
          system&apos;s figures.
        </p>
      ) : null}
      {!canRevise ? (
        <p className="chip status-danger !normal-case">
          The dilemma this exercise teaches is gone from the knowledge base, so
          it can be read but not laid out again.
        </p>
      ) : null}

      {/* ---- The exercise as it stands, or as proposed --------------- */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">The exercise</h2>
          {proposed ? (
            <span className="chip status-warn">corrected — not saved</span>
          ) : null}
        </div>

        {proposed ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            This is the corrected version. Read it, and accept it at the bottom
            of the page if it is right — nothing has been written yet.
          </p>
        ) : null}

        <ScenarioView scenario={showing} />
      </section>

      {/* ---- The record --------------------------------------------- */}
      {revisions.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold">
            What you asked for, and what was done
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Saved with the exercise, and sent with every further correction —
            which is why a fix made earlier does not come undone later.
          </p>
          <ol className="mt-3 space-y-2">
            {revisions.map((entry, index) => (
              <li key={index} className="panel p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="data text-xs text-muted">{index + 1}.</span>
                  <p className="min-w-0 flex-1 text-sm">{entry.request}</p>
                  {entry.at ? (
                    <span className="data text-[0.65rem] text-muted">
                      {new Date(entry.at).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                {entry.notes ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    <span className="text-muted/70">What was done: </span>
                    {entry.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {running ? (
        <div className="panel p-4">
          <p className="text-sm">
            Laying it out again
            {waited > 0 ? ` — ${formatWait(waited)} so far` : "…"}
          </p>
          {pending ? (
            <p className="mt-2 text-xs italic text-muted">“{pending}”</p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            A minute or more is normal. It runs on the server, so you can lock
            your phone, switch tabs or close this page — the result will be
            here when you come back.
          </p>
        </div>
      ) : null}

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip !normal-case">{notice}</p> : null}

      {/* ---- Saying what is wrong ------------------------------------ */}
      {canRevise ? (
        <section>
          <h2 className="text-sm font-semibold">What is wrong with it?</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Say it in your own words. Everything you have said before still
            applies, so a fix you already have does not come undone.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="label">The complaint</span>
              <textarea
                className="field min-h-20"
                placeholder="e.g. the second inbound arrives while I am still committing to the first — give me time to resolve one before the next appears"
                value={message}
                disabled={busy}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {COMMON.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="btn text-xs"
                  disabled={busy}
                  onClick={() => setMessage(entry)}
                >
                  {entry.split("—")[0].trim()}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || message.trim().length === 0}
              onClick={() => void send(message)}
            >
              {running ? "Laying it out…" : "Lay it out again"}
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- Accepting ---------------------------------------------- */}
      {proposed ? (
        <section className="border-t border-line pt-6">
          {proposed.notes ? (
            <p className="panel mb-4 p-3 text-xs leading-relaxed text-muted">
              <span className="text-muted/70">What was changed: </span>
              {proposed.notes}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void accept()}
            >
              {saving ? "Saving…" : "Accept this version"}
            </button>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
              Or say what is still wrong above and it will be laid out again.
              Nothing is written until you accept.
            </span>
          </div>
        </section>
      ) : (
        <section className="border-t border-line pt-6">
          <Link
            href={`/designer/systems/${saved.system_id}/test`}
            className="btn"
          >
            ▶ Test the system with live targets
          </Link>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
            The test flies its own built-in engagement rather than this one, so
            it checks the console and the figures rather than this exercise.
          </p>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** The exercise, laid out to be read rather than to be flown. */
function ScenarioView({ scenario }: { scenario: ScenarioInstance }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="panel p-4">
        <p className="label">The brief the trainee reads</p>
        <p className="prose-block mt-2 whitespace-pre-wrap text-sm">
          {scenario.situation_brief}
        </p>
      </div>

      <dl className="data grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Window" value={`${scenario.time_window_seconds}s`} />
        <Stat label="Tracks" value={String(scenario.live_tracks.length)} />
        <Stat
          label="Boresight"
          value={`${Math.round(scenario.radar_boresight_deg)}°`}
        />
        <Stat
          label="Rounds allowed"
          value={String(scenario.success_criteria.max_interceptors_spent)}
        />
      </dl>

      <div className="panel p-4">
        <p className="label">What counts as success</p>
        <p className="mt-1 text-sm">
          {scenario.success_criteria.statement || "Not stated."}
        </p>
        <p className="mt-1 text-xs text-muted">
          At most {scenario.success_criteria.max_leakers} hostile
          {scenario.success_criteria.max_leakers === 1 ? "" : "s"} may reach the
          defended area.
        </p>
      </div>

      {scenario.live_tracks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="data w-full text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="px-2 py-1 text-left font-medium">TRK</th>
                <th className="px-2 py-1 text-left font-medium">CLASS</th>
                <th className="px-2 py-1 text-right font-medium">APPEARS</th>
                <th className="px-2 py-1 text-right font-medium">BRG</th>
                <th className="px-2 py-1 text-right font-medium">RNG</th>
                <th className="px-2 py-1 text-right font-medium">ALT</th>
                <th className="px-2 py-1 text-right font-medium">SPD</th>
                <th className="px-2 py-1 text-left font-medium">SHOWN AS</th>
                <th className="px-2 py-1 text-left font-medium">REALLY</th>
              </tr>
            </thead>
            <tbody>
              {scenario.live_tracks.map((track) => (
                <tr
                  key={track.designator}
                  className="border-b border-line/60 align-top"
                >
                  <td className="px-2 py-1">{track.designator}</td>
                  <td className="px-2 py-1">{track.classification}</td>
                  <td className="px-2 py-1 text-right">
                    T+{track.appears_at_s}s
                  </td>
                  <td className="px-2 py-1 text-right">
                    {Math.round(track.spawn_bearing_deg)}°
                  </td>
                  <td className="px-2 py-1 text-right">
                    {Math.round(track.spawn_range_km)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {track.altitude_ft.toLocaleString()}
                  </td>
                  <td className="px-2 py-1 text-right">{track.speed_kts}</td>
                  <td className="px-2 py-1">{track.initial_iff}</td>
                  <td className="px-2 py-1">{track.truth_iff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            <strong>Shown as</strong> is what the console displays at first;{" "}
            <strong>really</strong> is the truth, which the trainee never sees.
            Where the two differ, the identification is the exercise.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <dt className="label !mb-1">{label}</dt>
      <dd className="text-lg tabular-nums">{value}</dd>
    </div>
  );
}
