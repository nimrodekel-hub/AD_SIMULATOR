import Link from "next/link";

/**
 * The three stages of using the app, drawn as the order they happen in.
 *
 * The front door used to be three role cards side by side — Designer,
 * Instructor, Trainee — which reads as a menu of equals. They are not equals.
 * Nothing can be trained until a system has been set up, and nothing can be
 * reviewed until something has been flown, so a first-time visitor who picked
 * the middle card arrived somewhere that could only turn them away. The order
 * was real and invisible; this makes it visible.
 *
 * Deliberately *not* the setup sequence's progress bar. Setting a system up is
 * work that finishes. Training people and reviewing how they did are not: they
 * are what the app is for, and marking them "complete" with a green tick would
 * say the opposite. So a stage here carries a number it keeps, a live count of
 * what it holds, and — if it cannot be entered yet — the reason.
 */

export interface Stage {
  title: string;
  href: string;
  /** What this stage holds right now, in two or three words. */
  state: string;
  blurb: string;
  /** Something has happened here. Softens the number rather than replacing it. */
  begun: boolean;
  /** Cannot be entered yet; `note` says what it is waiting for. */
  blocked?: boolean;
  note?: string;
}

export function JourneyStages({ stages }: { stages: Stage[] }) {
  /* Where to go now: the first stage you can enter that has nothing in it
     yet. Once every stage has been used the mark disappears rather than
     landing arbitrarily — by then the order has been learned and pointing at
     one of three open doors would be noise. */
  const startIndex = stages.findIndex(
    (stage) => !stage.blocked && !stage.begun,
  );

  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => {
        const isStart = index === startIndex;
        return (
          <li key={stage.href}>
            <Link
              href={stage.href}
              className={`panel card-link flex gap-4 p-5 ${
                isStart ? "border-accent/60" : ""
              } ${stage.blocked ? "opacity-70" : ""}`}
              aria-current={isStart ? "step" : undefined}
            >
              <span
                aria-hidden
                className={`step-disc mt-0.5 ${
                  isStart
                    ? "step-disc-next"
                    : stage.blocked
                      ? "step-disc-blocked"
                      : stage.begun
                        ? "step-disc-done"
                        : ""
                }`}
              >
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="text-base font-semibold">{stage.title}</p>
                  {isStart ? (
                    <span className="chip bg-accent-dim text-accent">
                      Start here
                    </span>
                  ) : (
                    <span
                      className={`chip ${
                        stage.blocked
                          ? "bg-panel-raised text-muted"
                          : stage.begun
                            ? "status-ok"
                            : "bg-panel-raised text-muted"
                      }`}
                    >
                      {stage.state}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {stage.blurb}
                </p>

                {stage.note ? (
                  <p className="mt-2.5 border-l-2 border-l-warn pl-3 text-xs leading-relaxed text-muted">
                    {stage.note}
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
      })}
    </ol>
  );
}
