"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ClarificationRound,
  DifficultyLevel,
  Trainee,
} from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import { formatWait, useBackgroundJob } from "@/lib/use-job";

/**
 * Screen 3, the front half: choosing what to train on.
 *
 * The free-text box is the interaction the POC exists to test, so it comes
 * first and gets the room. But it was the *only* way in, and that turned out
 * to be a tax rather than a principle: a trainee who already knows they want
 * the leaker drill should not have to describe it to a matcher and wait for it
 * to agree. So the system's approved scenarios are also listed, and picking one
 * starts a run directly.
 *
 * Matching is still what the POC is testing, which is why the box is above the
 * list and not beside it.
 *
 * Matching is quick. Building the exercise is not — it runs for over a minute,
 * which is longer than a phone will hold a connection open, and the trainee is
 * the person here most likely to be on one. So pressing "Begin training" starts
 * the work on the server and this screen asks every few seconds whether it is
 * ready, rather than waiting on a request that a locked screen would kill.
 */

type Phase =
  | { kind: "asking" }
  | { kind: "clarifying"; question: string; roundsRemaining: number }
  | {
      kind: "matched";
      scenario: { id: string; title: string };
      confidence: number;
      reasoning: string;
      difficulty: DifficultyLevel;
      settledWithoutConfidence: boolean;
      /** Whether the matcher chose it or the trainee did. */
      source: "match" | "list";
    }
  | { kind: "no_scenarios" };

/** The three shapes /api/training/match answers with. */
interface MatchReply {
  error?: string;
  status: "no_scenarios" | "needs_clarification" | "matched";
  question: string;
  rounds_remaining: number;
  scenario: { id: string; title: string };
  confidence: number;
  reasoning: string;
  suggested_difficulty: DifficultyLevel;
  settled_without_confidence: boolean;
}

const EXAMPLES = [
  "Everything arrives at once and I have to decide what to engage first.",
  "I keep hesitating when a track is unidentified but closing fast.",
  "Something hard — make me run out of interceptors.",
];

export function TrainingRequest({
  systemId,
  systemName,
  trainees,
  catalogue,
  preselectedTraineeId,
}: {
  /** The system chosen on the previous screen. Matching is scoped to it. */
  systemId: string;
  systemName: string;
  trainees: Trainee[];
  /**
   * This system's approved scenarios, for the trainee who would rather choose
   * than describe. Empty means there is nothing to train on at all.
   */
  catalogue: Array<{ id: string; title: string; tag: string; when: string }>;
  /** Set when an instructor started this run from a trainee's history. */
  preselectedTraineeId?: string;
}) {
  const router = useRouter();

  const [traineeId, setTraineeId] = useState(
    preselectedTraineeId ?? trainees[0]?.id ?? "",
  );
  const [request, setRequest] = useState("");
  const [clarifications, setClarifications] = useState<ClarificationRound[]>([]);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "asking" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const {
    running: building,
    waited,
    error: buildError,
    start: startExercise,
  } = useBackgroundJob<{ session_id: string }>({
    startUrl: "/api/training/start",
    pollUrl: `/api/training/start?trainee_id=${encodeURIComponent(traineeId)}`,
    onDone: ({ session_id }) => router.push(`/trainee/${session_id}`),
  });

  /** Whichever step failed most recently. Only one is ever on screen. */
  const shownError = error ?? buildError;

  async function match(rounds: ClarificationRound[]) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/training/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_id: systemId,
          request,
          clarifications: rounds,
        }),
      });
      const payload = await readJson<MatchReply>(response);
      if (!response.ok) throw new Error(payload.error ?? "Matching failed.");

      if (payload.status === "no_scenarios") {
        setPhase({ kind: "no_scenarios" });
      } else if (payload.status === "needs_clarification") {
        setPhase({
          kind: "clarifying",
          question: payload.question,
          roundsRemaining: payload.rounds_remaining,
        });
      } else {
        setPhase({
          kind: "matched",
          scenario: payload.scenario,
          confidence: payload.confidence,
          reasoning: payload.reasoning,
          difficulty: payload.suggested_difficulty,
          settledWithoutConfidence: payload.settled_without_confidence,
          source: "match",
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Matching failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (phase.kind !== "clarifying" || answer.trim().length === 0) return;
    const rounds = [
      ...clarifications,
      { question: phase.question, answer: answer.trim() },
    ];
    setClarifications(rounds);
    setAnswer("");
    await match(rounds);
  }

  /** Skips the matcher: the trainee already knows what they want. */
  function choose(entry: { id: string; title: string }) {
    setError(undefined);
    setClarifications([]);
    setPhase({
      kind: "matched",
      scenario: entry,
      confidence: 1,
      reasoning: "",
      difficulty: "medium",
      settledWithoutConfidence: false,
      source: "list",
    });
  }

  function begin() {
    if (phase.kind !== "matched") return;
    setError(undefined);
    return startExercise({
      trainee_id: traineeId,
      system_id: systemId,
      scenario_id: phase.scenario.id,
      // The record of why this run happened. A list pick has no request of its
      // own, and leaving it blank would make the debrief and the instructor's
      // history read as though nobody asked for anything.
      requested_text:
        phase.source === "list"
          ? `Chose “${phase.scenario.title}” from the list.`
          : request,
      clarifications,
      difficulty: phase.difficulty,
    });
  }

  function restart() {
    setClarifications([]);
    setAnswer("");
    setPhase({ kind: "asking" });
    setError(undefined);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="panel">
        <div className="panel-header">Console operator</div>
        <div className="p-4">
          <select
            className="field data"
            value={traineeId}
            onChange={(event) => setTraineeId(event.target.value)}
            aria-label="Trainee"
          >
            {trainees.map((trainee) => (
              <option key={trainee.id} value={trainee.id}>
                {trainee.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- The request ------------------------------------------- */}
      <div className="panel mt-4">
        <div className="panel-header">Training request</div>
        <div className="p-4">
          <textarea
            className="field min-h-28 resize-y"
            placeholder="What do you want to practise? Say it however you would say it out loud."
            value={request}
            disabled={phase.kind !== "asking" || busy}
            onChange={(event) => setRequest(event.target.value)}
          />

          {phase.kind === "asking" ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="btn text-xs"
                    onClick={() => setRequest(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-primary mt-4"
                disabled={busy || request.trim().length === 0}
                onClick={() => void match([])}
              >
                {busy ? "Matching…" : "Find my training"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* ---- Or pick one ------------------------------------------- */}
      {phase.kind === "asking" && catalogue.length > 0 ? (
        <div className="panel mt-4">
          <div className="panel-header">
            Or pick a drill · {catalogue.length} available
          </div>
          <div className="p-4">
            <p className="text-xs leading-relaxed text-muted">
              Every drill {systemName} has been taught. The situation is still
              generated fresh each time, so running the same one twice is not
              the same run twice.
            </p>
            <ul className="mt-3 space-y-2">
              {catalogue.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="panel w-full p-3 text-left transition-colors hover:border-accent"
                    disabled={busy}
                    onClick={() => choose(entry)}
                  >
                    <p className="text-sm font-medium">{entry.title}</p>
                    {entry.when ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                        {entry.when}
                      </p>
                    ) : null}
                    {entry.tag ? (
                      <span className="chip data mt-2">{entry.tag}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* ---- Clarification ----------------------------------------- */}
      {phase.kind === "clarifying" ? (
        <div className="panel is-active mt-4">
          <div className="panel-header">
            One question · {phase.roundsRemaining} round
            {phase.roundsRemaining === 1 ? "" : "s"} left
          </div>
          <div className="p-4">
            <p className="text-sm">{phase.question}</p>
            <textarea
              className="field mt-3 min-h-20 resize-y"
              value={answer}
              disabled={busy}
              autoFocus
              onChange={(event) => setAnswer(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || answer.trim().length === 0}
                onClick={() => void submitAnswer()}
              >
                {busy ? "Matching…" : "Answer"}
              </button>
              <button type="button" className="btn" onClick={restart} disabled={busy}>
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Matched ------------------------------------------------ */}
      {phase.kind === "matched" ? (
        <div className="panel is-active mt-4">
          <div className="panel-header">
            {phase.source === "list" ? "Chosen" : "Matched"}
          </div>
          <div className="p-4">
            {phase.settledWithoutConfidence ? (
              <p className="chip status-warn mb-3 !normal-case">
                Still not certain after three questions — going with the closest fit.
              </p>
            ) : null}

            {phase.source === "match" ? (
              <p className="text-sm text-muted">Based on what you asked for:</p>
            ) : null}
            <p className="mt-1 text-lg font-semibold">{phase.scenario.title}</p>
            {phase.source === "match" ? (
              <>
                <p className="mt-2 text-sm text-muted">{phase.reasoning}</p>
                <p className="data mt-2 text-xs text-muted">
                  confidence {(phase.confidence * 100).toFixed(0)}%
                </p>
              </>
            ) : null}

            <div className="mt-5">
              <span className="label">Difficulty</span>
              <div className="flex flex-wrap gap-2">
                {(["easy", "medium", "hard"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`btn text-xs ${
                      phase.difficulty === level ? "btn-primary" : ""
                    }`}
                    onClick={() => setPhase({ ...phase, difficulty: level })}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || building}
                onClick={() => void begin()}
              >
                {building ? "Building the exercise…" : "Begin training"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={restart}
                disabled={busy || building}
              >
                {phase.source === "list" ? "Pick something else" : "Ask for something else"}
              </button>
            </div>

            {building ? (
              <div className="panel mt-4 p-4">
                <p className="text-sm">
                  Building your exercise
                  {waited > 0 ? ` — ${formatWait(waited)} so far` : "…"}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  A minute or two is normal — the situation is written for this
                  request, not picked off a shelf. It is running on the server,
                  so you can lock your phone or switch tabs; this screen opens
                  the run as soon as it is ready.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ---- Nothing to match against ------------------------------- */}
      {phase.kind === "no_scenarios" ? (
        <div className="panel mt-4 p-4">
          <p className="text-sm">
            {systemName} has no approved scenarios yet, so there is nothing to
            match your request against. A system designer needs to teach and
            approve at least one for this system first — scenarios taught on
            another system do not carry across.
          </p>
        </div>
      ) : null}

      {shownError ? (
        <p className="chip status-danger mt-4 !normal-case">{shownError}</p>
      ) : null}
    </div>
  );
}
