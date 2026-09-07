"use client";

import type { ExerciseInstance } from "@/lib/domain/schemas";
import type { simConfig } from "@/lib/sim/engine";

/**
 * What the operator reads before the clock starts.
 *
 * Split out of `live-run.tsx` for the same reason `schemas.ts` was split: this
 * repository is written through an API that takes whole files rather than
 * diffs, and a change to the brief was moving the entire console — 48 KB — to
 * alter four lines of prose.
 */

export function Brief({
  exercise,
  config,
  difficulty,
  notices,
  onBegin,
}: {
  exercise: ExerciseInstance;
  config: ReturnType<typeof simConfig>;
  difficulty: string;
  notices: string[];
  onBegin: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
      <div className="panel">
        <div className="panel-header">Situation brief</div>
        <div className="p-5">
          <h2 className="text-lg font-semibold">{exercise.exercise_name}</h2>
          <p className="prose-block mt-3 whitespace-pre-wrap text-sm">
            {exercise.situation_brief}
          </p>

          {/* Before the figures, because it changes how they should be read:
              anything here is a part of the request the system could not
              honour, and the reason is always something in the profile that
              can be fixed. */}
          {notices.length > 0 ? (
            <div className="mt-4 rounded border border-warn bg-panel-raised p-4">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-warn">
                Laid out differently from the request
              </p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
                {notices.map((notice, index) => (
                  <li key={index}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <dl className="data mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Window" value={`${exercise.time_window_seconds}s`} />
            <Stat label="Rounds" value={String(config.magazine)} />
            <Stat label="At once" value={String(config.max_simultaneous)} />
            <Stat label="Level" value={difficulty} />
          </dl>

          <div className="mt-5 rounded border border-line bg-panel-raised p-4">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
              What counts as success
            </p>
            <p className="mt-2 text-sm">
              {exercise.success_criteria.statement ||
                "Keep every hostile out of the defended area."}
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted">
              <li>
                At most {exercise.success_criteria.max_leakers} hostile
                {exercise.success_criteria.max_leakers === 1 ? "" : "s"} may
                reach the defended area.
              </li>
              <li>Engaging anything friendly fails the run outright.</li>
              <li>
                Efficient is {exercise.success_criteria.max_interceptors_spent}{" "}
                rounds or fewer.
              </li>
            </ul>
          </div>

          <p className="mt-5 text-xs text-muted">
            You are the operator. Tracks close in real time, the clock does not
            pause, and nothing waits for you to decide. Select a track to read
            it, correct its identification if the system has it wrong, choose a
            round and fire.
          </p>

          {/* Said here because the window is stated three lines above and a
              trainee reading "600s" needs to know they are not committed to
              sitting through all of it. A run left by closing the tab was
              recorded as nothing at all, which is how a finished engagement
              came to have no result. */}
          <p className="mt-2 text-xs text-muted">
            The run closes itself when the air picture is clear or the window
            expires — and you can end it yourself at any point with{" "}
            <span className="text-ink">End run</span>, which scores what
            happened up to that moment.
          </p>

          <button type="button" className="btn btn-primary mt-5" onClick={onBegin}>
            Take the position
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.1em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
