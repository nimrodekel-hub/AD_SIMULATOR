"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DifficultyLevel } from "@/lib/domain/schemas";

/**
 * The designer's brief for a new exercise.
 *
 * Four questions rather than one box. A single "describe the exercise" field
 * is the version that gets left blank: a designer knows their subject and does
 * not necessarily know what a generator needs to hear, so the questions do
 * that work. Each one changes the engagement in a different way — what it is
 * for, what it examines, how hard it presses, which decisions must arise — and
 * asking them apart means a blank is a decision rather than an oversight.
 *
 * Building takes the model over a minute, so the press starts a job and this
 * asks how it is getting on. Leaving the page does not cancel it; coming back
 * to the form and pressing again joins the same wait rather than paying twice.
 */

/** One system, with the scenarios that are approved to build against. */
export interface BuildTarget {
  id: string;
  name: string;
  scenarios: { id: string; title: string }[];
}

const DIFFICULTIES: { value: DifficultyLevel; label: string; hint: string }[] = [
  {
    value: "easy",
    label: "Easy",
    hint: "Arrivals separated, one decision at a time, room to think.",
  },
  {
    value: "medium",
    label: "Medium",
    hint: "At least one moment where two things need attention at once.",
  },
  {
    value: "hard",
    label: "Hard",
    hint: "Overlapping arrivals and not enough rounds to be careless.",
  },
];

type Reported =
  | { status: "idle" }
  | {
      status: "running" | "done" | "failed";
      error: string | null;
      result: {
        exercise_id: string;
        system_id: string;
        exercise_name: string;
        notes: string;
        adjustments: string[];
      } | null;
    };

export function ExerciseBuildForm({ targets }: { targets: BuildTarget[] }) {
  const router = useRouter();

  const [systemId, setSystemId] = useState(targets[0]?.id ?? "");
  const system = targets.find((entry) => entry.id === systemId);
  const [scenarioId, setScenarioId] = useState(
    targets[0]?.scenarios[0]?.id ?? "",
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [tested, setTested] = useState("");
  const [load, setLoad] = useState("");
  const [dilemmas, setDilemmas] = useState("");
  const [notes, setNotes] = useState("");

  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string>();
  const [built, setBuilt] = useState<Reported | null>(null);

  /* Changing the system invalidates the scenario, which belongs to it. */
  const chooseSystem = useCallback(
    (id: string) => {
      setSystemId(id);
      setScenarioId(targets.find((entry) => entry.id === id)?.scenarios[0]?.id ?? "");
    },
    [targets],
  );

  /* ---- Asking how it is getting on ------------------------------- */
  const polling = useRef(false);
  useEffect(() => {
    if (!building || !systemId || polling.current) return;
    polling.current = true;

    let live = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/exercises/build?system=${encodeURIComponent(systemId)}`,
        );
        const job = (await response.json()) as Reported;
        if (!live || job.status === "running" || job.status === "idle") return;

        clearInterval(timer);
        polling.current = false;
        setBuilding(false);
        if (job.status === "failed") {
          setError(job.error ?? "Building it failed.");
          return;
        }
        setBuilt(job);
      } catch {
        /* A dropped poll is not a failed build. Ask again in a moment. */
      }
    }, 4000);

    return () => {
      live = false;
      polling.current = false;
      clearInterval(timer);
    };
  }, [building, systemId]);

  const build = useCallback(async () => {
    setError(undefined);
    setBuilt(null);
    setBuilding(true);
    try {
      const response = await fetch("/api/exercises/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_id: systemId,
          scenario_id: scenarioId,
          difficulty,
          name,
          objective,
          tested,
          load,
          dilemmas,
          notes,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok && response.status !== 202) {
        throw new Error(payload.error ?? "Building it failed.");
      }
    } catch (reason) {
      setBuilding(false);
      setError(reason instanceof Error ? reason.message : "Building it failed.");
    }
  }, [systemId, scenarioId, difficulty, name, objective, tested, load, dilemmas, notes]);

  if (targets.length === 0) {
    return (
      <p className="panel p-5 text-sm text-muted">
        There is nothing to build against yet. An exercise is laid out from an
        approved scenario on a system whose profile has been taught — teach a
        system and approve a scenario first.
      </p>
    );
  }

  /* ---- Built ------------------------------------------------------ */
  if (built?.status === "done" && built.result) {
    const { result } = built;
    return (
      <div className="panel p-5">
        <span className="chip status-ok">Built</span>
        <p className="mt-3 text-sm">
          <span className="font-semibold">{result.exercise_name}</span> is in
          the library.
        </p>
        {result.notes ? (
          <p className="prose-block mt-3 text-sm text-muted">{result.notes}</p>
        ) : null}

        {/* The half the model cannot know. Said here rather than found later
            by a trainee: a brief the profile could not honour is worth one
            sentence at the moment it is built. */}
        {result.adjustments.length > 0 ? (
          <div className="mt-4">
            <p className="label !mb-2">What the system would not allow</p>
            <ul className="space-y-2">
              {result.adjustments.map((entry, index) => (
                <li
                  key={index}
                  className="border-l-2 border-l-warn pl-3 text-xs leading-relaxed text-muted"
                >
                  {entry}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              router.push(
                `/designer/exercises/${result.exercise_id}?system=${result.system_id}`,
              )
            }
          >
            Open it
          </button>
          <button type="button" className="btn" onClick={() => setBuilt(null)}>
            Build another
          </button>
        </div>
      </div>
    );
  }

  /* ---- The brief -------------------------------------------------- */
  return (
    <div className="space-y-6">
      <div className="panel space-y-5 p-5">
        <Field label="Name" hint="What you will look for in the list later.">
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Leave blank and it will be named for you"
            disabled={building}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="System" hint="Its profile bounds everything below.">
            <select
              className="field"
              value={systemId}
              onChange={(event) => chooseSystem(event.target.value)}
              disabled={building}
            >
              {targets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Scenario"
            hint="The dilemmas it names are the ones this must actually produce."
          >
            <select
              className="field"
              value={scenarioId}
              onChange={(event) => setScenarioId(event.target.value)}
              disabled={building || !system?.scenarios.length}
            >
              {system?.scenarios.length ? (
                system.scenarios.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))
              ) : (
                <option value="">No approved scenario on this system</option>
              )}
            </select>
          </Field>
        </div>

        <Group label="Difficulty" hint="The band the scenario is scaled to.">
          <div className="grid gap-2 sm:grid-cols-3">
            {DIFFICULTIES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                disabled={building}
                onClick={() => setDifficulty(entry.value)}
                className={`rounded border p-3 text-left transition-colors ${
                  difficulty === entry.value
                    ? "border-accent bg-accent-dim"
                    : "border-line hover:border-accent"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {entry.label}
                </span>
                <span className="mt-1 block text-xs leading-snug text-muted">
                  {entry.hint}
                </span>
              </button>
            ))}
          </div>
        </Group>
      </div>

      <div className="panel space-y-5 p-5">
        <p className="text-xs leading-relaxed text-muted">
          The four answers below are the brief. They shape the engagement itself
          — the geometry, the timing, what is issued — not the wording of the
          brief the trainee reads. Anything the scenario or the system will not
          allow is reported back to you rather than quietly dropped.
        </p>

        <Field
          label="What this exercise is for"
          hint="What should the trainee come away able to do?"
        >
          <textarea
            className="field min-h-20"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Commit to a closing track before it reaches the inner ring, rather than waiting for the system to resolve it."
            disabled={building}
          />
        </Field>

        <Field
          label="What it examines"
          hint="The thing this is a test of. Name it plainly."
        >
          <textarea
            className="field min-h-20"
            value={tested}
            onChange={(event) => setTested(event.target.value)}
            placeholder="Whether they interrogate before committing, and whether they read a silent transponder as evidence rather than proof."
            disabled={building}
          />
        </Field>

        <Field
          label="How hard it should press"
          hint="Arrivals, stock, time. What makes it uncomfortable."
        >
          <textarea
            className="field min-h-20"
            value={load}
            onChange={(event) => setLoad(event.target.value)}
            placeholder="Two hostiles converging while an unknown sits closer. Fewer rounds than hostiles, so a wasted shot is felt."
            disabled={building}
          />
        </Field>

        <Field
          label="The decisions that must arise"
          hint="A dilemma that never happens has not been trained."
        >
          <textarea
            className="field min-h-20"
            value={dilemmas}
            onChange={(event) => setDilemmas(event.target.value)}
            placeholder="A friendly shown as unknown, arriving when a decision cannot be deferred. A long-range shot available seconds before a better one."
            disabled={building}
          />
        </Field>

        <Field label="Anything else" hint="Optional.">
          <textarea
            className="field min-h-16"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={building}
          />
        </Field>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void build()}
          disabled={building || !scenarioId}
        >
          {building ? "Laying out the engagement…" : "Build the exercise"}
        </button>
        {building ? (
          <p className="text-xs text-muted">
            This takes a minute or two. You can leave this page — it carries on,
            and the exercise appears in the library when it is done.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One labelled question, with the sentence that says why it is being asked. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label !mb-1">{label}</span>
      <span className="mb-2 block text-xs leading-snug text-muted">{hint}</span>
      {children}
    </label>
  );
}

/**
 * The same thing for a set of controls rather than one.
 *
 * A `<label>` names exactly one control. Wrapping a group of buttons in one
 * folds the label's text into every button's accessible name — so the
 * difficulty buttons announced themselves as "Difficulty The band the scenario
 * is scaled to. Hard …", and could not be told apart by name at all. A
 * fieldset is what actually means "these belong together".
 */
function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="block">
      <legend className="label !mb-1">{label}</legend>
      <p className="mb-2 text-xs leading-snug text-muted">{hint}</p>
      {children}
    </fieldset>
  );
}
