"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LiveRun } from "@/components/live-run";
import type { SystemProfile } from "@/lib/domain/schemas";
import { simConfig, summarise, type SimState } from "@/lib/sim/engine";
import { rehearsalScenario } from "@/lib/sim/rehearsal";

/**
 * The designer flying their own console.
 *
 * Same `LiveRun` a trainee gets, same engine, same console shell — the only
 * difference is where the outcome goes: nowhere. Nothing is written, nobody is
 * scored, and when the run ends the designer lands back here with a tally and
 * a button to go again.
 *
 * The tally is shown because it answers a question the empty preview cannot:
 * whether the controls in this console can actually be *used*. A designer who
 * could not find the fire command, or could not tell the friendly from the
 * hostile, sees it in the numbers.
 */
export function ConsoleRehearsal({
  systemId,
  profile,
  templateHtml,
}: {
  systemId: string;
  profile: SystemProfile | null;
  /** The console being tested, approved or not. Undefined means the built-in one. */
  templateHtml?: string;
}) {
  /** Bumped to start a fresh run — it reseeds the luck and remounts the sim. */
  const [attempt, setAttempt] = useState(1);
  const [done, setDone] = useState<SimState>();

  const scenario = useMemo(() => rehearsalScenario(profile), [profile]);
  const config = useMemo(() => simConfig(profile, scenario), [profile, scenario]);

  if (done) {
    const result = summarise(done, config, scenario.success_criteria);

    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h2 className="text-sm font-semibold">Rehearsal over</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Nothing was recorded. What the run added up to, only so you can see
          the controls did what you pressed:
        </p>

        <dl className="panel mt-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
          <Figure label="Destroyed" value={result.hostiles_destroyed} />
          <Figure label="Leaked through" value={result.leakers} />
          <Figure label="Rounds spent" value={result.interceptors_spent} />
          <Figure label="Friendly engaged" value={result.friendly_engaged} />
          <Figure label="Unknown engaged" value={result.unknown_engaged} />
          <Figure
            label="Mean reaction"
            value={
              result.mean_reaction_s === null
                ? "—"
                : `${Math.round(result.mean_reaction_s)}s`
            }
          />
        </dl>

        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-muted hover:text-accent">
            What happened, second by second ({done.events.length} entries)
          </summary>
          <ul className="mt-3 space-y-1">
            {done.events.map((entry, index) => (
              <li key={index} className="text-xs text-muted">
                <span className="mr-2 tabular-nums">
                  T+{String(Math.floor(entry.t)).padStart(3, "0")}
                </span>
                {entry.detail}
              </li>
            ))}
          </ul>
        </details>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDone(undefined);
              setAttempt((current) => current + 1);
            }}
          >
            Fly it again
          </button>
          <Link href={`/designer/systems/${systemId}/gui`} className="btn">
            Back to the console
          </Link>
        </div>
      </div>
    );
  }

  return (
    <LiveRun
      // A new id each attempt, so a second run is not handed the same luck as
      // the first — a designer testing a miss should be able to get one.
      key={attempt}
      runId={`rehearsal-${systemId}-${attempt}`}
      scenario={scenario}
      difficulty="medium"
      profile={profile}
      templateHtml={templateHtml}
      onFinish={setDone}
    />
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="label !mb-1">{label}</dt>
      <dd className="text-lg tabular-nums">{value}</dd>
    </div>
  );
}
