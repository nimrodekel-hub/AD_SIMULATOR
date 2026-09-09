import type { GuiTemplate, ScenarioEntry, SystemProfile } from "./schemas";

/**
 * The order in which a system gets set up — written down once.
 *
 * The sequence was defined inside the page that drew it, so every other screen
 * that wanted to say where a system had got to re-derived it by hand. The
 * designer's list did exactly that, and it drifted: the list said "Behaviour /
 * Console / Scenarios" while the system's own page counted five steps
 * including the screenshots that come before all of them and the test flight
 * that comes after. Two screens, two answers to "what now", neither wrong on
 * its own terms.
 *
 * So the sequence lives here and both screens read it. Changing the order —
 * or adding a step — happens in one place, and no screen can fall behind.
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

export interface SetupState {
  systemId: string;
  screenshotCount: number;
  profile: SystemProfile | null;
  gui: GuiTemplate | null;
  scenarios: ScenarioEntry[];
}

/**
 * The five steps, in the order they have to happen.
 *
 * The order is not presentation. The screenshots come first because the
 * questions in step 2 ask what the display shows, and those answers are read
 * far more accurately with the display in hand. The profile comes before the
 * console and before any scenario because a scenario is a judgement call
 * *within* a system: teach one first and every exercise after it is built
 * against a system the model invented, which looks right and is not.
 */
export function setupSteps({
  systemId,
  screenshotCount,
  profile,
  gui,
  scenarios,
}: SetupState): SetupStep[] {
  const base = `/designer/systems/${systemId}`;
  const referencesReady = screenshotCount > 0;
  const profileReady = profile?.approved === true;
  const consoleReady = gui?.approved === true;
  const approvedScenarios = scenarios.filter(
    (entry) => entry.status === "approved",
  ).length;

  return [
    {
      title: "Store reference screenshots",
      href: `${base}/screenshots`,
      done: referencesReady,
      state: referencesReady ? `${screenshotCount} stored` : "None yet",
      blurb:
        "Screenshots of the real console. They are read twice — once while your answers below are interpreted, and again when the console is built — so they come first.",
    },
    {
      title: "Describe how it behaves",
      href: `${base}/profile`,
      done: profileReady,
      state: profileReady ? "Approved" : profile ? "Draft" : "Not started",
      blurb:
        "Track classes, identification, what the operator can do, the engagement envelope. Everything downstream is built from this — without it the model invents a system, and the exercises look right without being right.",
      note: referencesReady
        ? undefined
        : "The questions about the display are much easier to answer with the screenshots stored first.",
    },
    {
      title: "Build the simulated console",
      href: `${base}/gui`,
      done: consoleReady,
      blocked: !profileReady || !referencesReady,
      state: consoleReady ? "Approved" : gui ? "Draft" : "Not built",
      blurb:
        "Generated from the screenshots and the behaviour profile together, so it shows the right columns and the right controls — not just the right colours.",
      note:
        !profileReady || !referencesReady
          ? referencesReady
            ? "Waiting on the behaviour profile."
            : "Waiting on the screenshots and the behaviour profile."
          : undefined,
    },
    {
      title: "Fly it yourself",
      href: `${base}/test`,
      done: false,
      repeatable: true,
      blocked: profile === null,
      state:
        profile === null
          ? "Needs the profile"
          : consoleReady
            ? "On your console"
            : "Built-in layout",
      blurb:
        "Targets, real controls, the clock running. This is where you find out whether the detection range gives an operator any warning and whether your console holds up with a live picture in it. Nothing is recorded — run it as often as you like.",
      note:
        profile === null
          ? "Fill in the behaviour profile first — the test flies this system's own figures. A draft is enough."
          : undefined,
    },
    {
      title: "Teach it a scenario",
      href: `${base}/learn`,
      done: approvedScenarios > 0,
      state:
        scenarios.length === 0
          ? "None captured"
          : `${approvedScenarios} approved`,
      blurb:
        "Talk a real operational scenario through, review the record extracted from it, correct it, approve it.",
      note: profileReady
        ? undefined
        : "You can start now, but exercises built from this scenario will use an invented system until the profile is approved.",
    },
  ];
}

/**
 * The one to do next.
 *
 * A step you finish always outranks one you merely repeat, so the test flight
 * is never offered ahead of unfinished setup. Once the finishable ones are
 * done it becomes the answer, which is right: with the system built, flying it
 * is the next thing worth doing.
 */
export function nextStep(steps: SetupStep[]): SetupStep | null {
  const startable = (step: SetupStep) => !step.done && !step.blocked;
  return (
    steps.find((step) => startable(step) && !step.repeatable) ??
    steps.find(startable) ??
    null
  );
}

/** How far along, counting only the steps that can actually be finished. */
export function setupProgress(steps: SetupStep[]): {
  complete: number;
  total: number;
} {
  const counted = steps.filter((step) => !step.repeatable);
  return {
    complete: counted.filter((step) => step.done).length,
    total: counted.length,
  };
}

/** A system is trainable once it has a profile in force and something to teach. */
export function readyForTraining(
  profile: SystemProfile | null,
  scenarios: ScenarioEntry[],
): boolean {
  return (
    profile?.approved === true &&
    scenarios.some((entry) => entry.status === "approved")
  );
}
