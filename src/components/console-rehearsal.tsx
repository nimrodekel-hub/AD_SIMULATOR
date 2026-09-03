"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ConsoleReview } from "@/components/console-review";
import { LiveRun } from "@/components/live-run";
import type { GuiRevision, SystemProfile } from "@/lib/domain/schemas";
import { simConfig, summarise, type SimState } from "@/lib/sim/engine";
import { rehearsalExercise } from "@/lib/sim/rehearsal";

/**
 * The designer flying their own system.
 *
 * Same `LiveRun` a trainee gets, same engine, same console shell — the only
 * difference is where the outcome goes: nowhere. Nothing is written, nobody is
 * scored, and when the run ends the designer lands back here with a tally and
 * a button to go again.
 *
 * The tally is shown because it answers questions no earlier step can: whether
 * the figures in the profile make a runnable engagement, and whether the
 * controls in this console can actually be *used*. A designer whose detection
 * range gave them no warning, or who could not find the fire command, or could
 * not tell the friendly from the hostile, sees it in the numbers.
 *
 * When the console being flown is a change waiting to be accepted, this screen
 * also owns the order of that decision: **fly it, then read what was done,
 * then say whether anything else needs changing, and only then approve.** The
 * approval used to sit in a header above the run, live from the moment the
 * page opened — which asked "do you accept this?" about something the designer
 * had not yet seen move. Flying it first is the whole point of being here.
 */
export function ConsoleRehearsal({
  systemId,
  profile,
  templateHtml,
  review,
}: {
  systemId: string;
  profile: SystemProfile | null;
  /** The console being tested, approved or not. Undefined means the built-in one. */
  templateHtml?: string;
  /**
   * Set when the console being flown is a change that has not been accepted.
   *
   * Its presence is what turns this screen into the review: a line over the
   * run saying what is being looked at, and the verdict afterwards.
   */
  review?: {
    html: string;
    screenshots: string[];
    requests: string[];
    designNotes: string;
    missingSlots: string[];
    storedRevisions: GuiRevision[];
    wasApproved: boolean;
  };
}) {
  /** Bumped to start a fresh run — it reseeds the luck and remounts the sim. */
  const [attempt, setAttempt] = useState(1);
  const [done, setDone] = useState<SimState>();
  /**
   * Set when the designer stops the look early.
   *
   * A test exercise runs for minutes, and someone judging a layout change
   * often knows inside twenty seconds. Without this the only ways to the
   * verdict were to sit out the whole engagement or to leave the page, so the
   * order being enforced here would have become an obstacle rather than a
   * sequence.
   */
  const [seenEnough, setSeenEnough] = useState(false);

  const exercise = useMemo(() => rehearsalExercise(profile), [profile]);
  const config = useMemo(() => simConfig(profile, exercise), [profile, exercise]);

  if (done || seenEnough) {
    return (
      /* Scrolls in its own right.
       *
       * The test screen is pinned to one viewport and hides its overflow,
       * which is right while a console is running — an operator's position is
       * a fixed rectangle of glass. It is wrong the moment the run ends and
       * this becomes a page to read: the tally, the account of what was
       * changed and the approval all sat below the fold of a container that
       * would not scroll, so the verdict this screen exists to collect could
       * not be reached at all.
       */
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <h2 className="text-sm font-semibold">
            {done ? "Test over" : "Test stopped"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Nothing was recorded.
            {done
              ? " What the run added up to, only so you can see the controls did what you pressed:"
              : " You stopped it early, so there is no tally — the point was to look at the console."}
          </p>

          {done ? <Tally done={done} config={config} exercise={exercise} /> : null}

          {/* The verdict on a change, in the order it is useful: what was done,
              then anything else, then the approval. */}
          {review ? <ConsoleReview systemId={systemId} {...review} /> : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDone(undefined);
                setSeenEnough(false);
                setAttempt((current) => current + 1);
              }}
            >
              {review ? "Fly it again" : "Run it again"}
            </button>
            <Link href={`/designer/systems/${systemId}`} className="btn">
              Back to the system
            </Link>
            <Link href={`/designer/systems/${systemId}/gui`} className="btn">
              The console
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {review ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel-raised px-6 py-2">
          <span className="chip status-warn">your change</span>
          {/* What to look for, in the designer's own words.
              "Fly it and see" on its own left them hunting a change they
              could no longer remember the wording of, which is most of how a
              change that was made comes to look like one that was not. The
              account of what was done to get it waits on the closing panel,
              where it can be read rather than skimmed mid-run. */}
          <p className="min-w-0 flex-1 text-xs text-muted">
            {review.requests.at(-1) ? (
              <>
                Look for:{" "}
                <span className="italic">“{review.requests.at(-1)}”</span>
              </>
            ) : (
              "This is the console with your change in it. Fly it and see."
            )}
          </p>
          <button
            type="button"
            className="btn text-xs"
            onClick={() => setSeenEnough(true)}
          >
            Seen enough →
          </button>
        </div>
      ) : null}

      <LiveRun
        // A new id each attempt, so a second run is not handed the same luck
        // as the first — a designer testing a miss should be able to get one.
        key={attempt}
        runId={`rehearsal-${systemId}-${attempt}`}
        exercise={exercise}
        difficulty="medium"
        profile={profile}
        templateHtml={templateHtml}
        onFinish={setDone}
      />
    </div>
  );
}

/** What the run added up to. Shown only when there was a whole run. */
function Tally({
  done,
  config,
  exercise,
}: {
  done: SimState;
  config: ReturnType<typeof simConfig>;
  exercise: ReturnType<typeof rehearsalExercise>;
}) {
  const result = summarise(done, config, exercise.success_criteria);
  return (
    <>
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
    </>
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
