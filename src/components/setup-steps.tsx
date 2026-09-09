import Link from "next/link";
import type { ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import {
  nextStep,
  setupProgress,
  type SetupStep,
} from "@/lib/domain/setup-sequence";

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

export function SetupSequence({
  steps,
  heading = "Set the system up",
  intro,
}: {
  steps: SetupStep[];
  heading?: string;
  intro?: ReactNode;
}) {
  /* Both counted the same way the designer's list counts them — one function,
     so the two screens cannot disagree about how far along a system is. */
  const { complete, total } = setupProgress(steps);
  const allDone = complete === total;
  const next = nextStep(steps);

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
          {total} complete
        </p>
      </div>

      <div
        className="progress-track mt-4"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${heading}: ${complete} of ${total} complete`}
      >
        <div
          className="progress-fill"
          style={{ width: `${(complete / Math.max(total, 1)) * 100}%` }}
        />
      </div>

      <ol className="mt-6 space-y-3">
        {steps.map((step, index) => (
          <Step
            key={step.title}
            step={step}
            number={index + 1}
            isNext={step === next}
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
