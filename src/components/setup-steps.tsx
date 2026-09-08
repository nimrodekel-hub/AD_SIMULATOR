import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon } from "@/components/icons";

/**
 * The sequence that turns a described system into one a trainee can fly.
 *
 * It was already five ordered steps, and the screen already said which were
 * finished. What it never said was the shape of the whole: how many there
 * are, how many are done, and — the one a designer actually wants — **which
 * one to do next.** That had to be worked out by reading five cards, every
 * time, because a finished step and an unfinished one differed by the colour
 * of a small chip.
 *
 * So the sequence is drawn as a sequence. A bar across the top counts it off,
 * every step keeps its number rather than dissolving into an identical tick,
 * the next one to do is marked and says so, and a step that cannot be started
 * yet is visibly held back with the reason attached.
 */

export interface SetupStep {
  /** Short, and a thing you do. This is the largest text on the card. */
  title: string;
  href: string;
  /** Where this step has got to, in three or four words. */
  state: string;
  /** What the step is for, in one or two sentences. */
  blurb: string;
  done: boolean;
  /**
   * A step you *do* rather than one you finish.
   *
   * Testing has no completed state — it is worth running again after every
   * change — so it never counts against the total and never shows as missing.
   */
  repeatable?: boolean;
  /** Cannot be started yet. `note` says what it is waiting for. */
  blocked?: boolean;
  /** A caution that does not block: the step works, but works better later. */
  note?: string;
}

export function SetupSequence({
  steps,
  heading = "Set the system up",
  intro,
}: {
  steps: SetupStep[];
  heading?: string;
  intro?: ReactNode;
}) {
  /* Repeatable steps are excluded from the count in both directions: they can
     never be finished, so counting them would cap the bar below full and tell
     a designer who has done everything that they have not. */
  const counted = steps.filter((step) => !step.repeatable);
  const complete = counted.filter((step) => step.done).length;
  const allDone = complete === counted.length;

  /* The first thing that can actually be started. Marked rather than merely
     available, because "what now" is the question this screen exists to
     answer and it was the one thing it did not say. */
  const nextIndex = steps.findIndex(
    (step) => !step.done && !step.blocked && !step.repeatable,
  );

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="section-title">{heading}</h2>
          {intro ? <p className="section-note">{intro}</p> : null}
        </div>
        <p className="data text-sm text-muted">
          <span className={allDone ? "text-ok" : "text-ink"}>{complete}</span>
          {" of "}
          {counted.length} complete
        </p>
      </div>

      <div
        className="progress-track mt-4"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={counted.length}
        aria-label={`${heading}: ${complete} of ${counted.length} complete`}
      >
        <div
          className="progress-fill"
          style={{ width: `${(complete / Math.max(counted.length, 1)) * 100}%` }}
        />
      </div>

      <ol className="mt-6 space-y-3">
        {steps.map((step, index) => (
          <Step
            key={step.title}
            step={step}
            number={index + 1}
            isNext={index === nextIndex}
          />
        ))}
      </ol>
    </section>
  );
}

function Step({
  step,
  number,
  isNext,
}: {
  step: SetupStep;
  number: number;
  isNext: boolean;
}) {
  const disc = step.done
    ? "step-disc-done"
    : isNext
      ? "step-disc-next"
      : step.blocked
        ? "step-disc-blocked"
        : "";

  return (
    <li>
      <Link
        href={step.href}
        className={`panel card-link flex gap-4 p-5 ${
          isNext ? "border-accent/60" : ""
        } ${step.blocked ? "opacity-70" : ""}`}
        aria-current={isNext ? "step" : undefined}
      >
        <span className={`step-disc mt-0.5 ${disc}`} aria-hidden>
          {step.done ? <CheckIcon /> : number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-base font-semibold">{step.title}</p>

            {/* One chip, and it says the state rather than repeating the
                title. "Next" wins where it applies: a designer scanning for
                where to resume should find one word, not five states to
                compare. */}
            {isNext ? (
              <span className="chip bg-accent-dim text-accent">Do this next</span>
            ) : (
              <span
                className={`chip ${
                  step.done
                    ? "status-ok"
                    : step.blocked
                      ? "bg-panel-raised text-muted"
                      : step.repeatable
                        ? "bg-panel-raised text-muted"
                        : "status-warn"
                }`}
              >
                {step.state}
              </span>
            )}
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted">{step.blurb}</p>

          {step.note ? (
            <p className="mt-2.5 border-l-2 border-l-warn pl-3 text-xs leading-relaxed text-muted">
              {step.note}
            </p>
          ) : null}
        </div>

        <span
          aria-hidden
          className="self-center text-lg text-muted transition-transform"
        >
          →
        </span>
      </Link>
    </li>
  );
}
