"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ClarificationRound,
  DifficultyLevel,
  Trainee,
} from "@/lib/domain/schemas";

/**
 * Screen 3, the front half: the trainee asks for training in their own words.
 *
 * This is the interaction the POC exists to test, so the screen is deliberately
 * a blank box rather than a menu of scenarios. If the trainee has to pick from
 * a list, the matching engine is never exercised.
 */

type Phase =
  | { kind: "asking" }
  | { kind: "clarifying"; question: string; roundsRemaining: number }
  | {
      kind: "matched";
      dilemma: { id: string; title: string };
      confidence: number;
      reasoning: string;
      difficulty: DifficultyLevel;
      settledWithoutConfidence: boolean;
    }
  | { kind: "no_dilemmas" };

const EXAMPLES = [
  "Everything arrives at once and I have to decide what to engage first.",
  "I keep hesitating when a track is unidentified but closing fast.",
  "Something hard — make me run out of interceptors.",
];

export function TrainingRequest({ trainees }: { trainees: Trainee[] }) {
  const router = useRouter();

  const [traineeId, setTraineeId] = useState(trainees[0]?.id ?? "");
  const [request, setRequest] = useState("");
  const [clarifications, setClarifications] = useState<ClarificationRound[]>([]);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "asking" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function match(rounds: ClarificationRound[]) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/training/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, clarifications: rounds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Matching failed.");

      if (payload.status === "no_dilemmas") {
        setPhase({ kind: "no_dilemmas" });
      } else if (payload.status === "needs_clarification") {
        setPhase({
          kind: "clarifying",
          question: payload.question,
          roundsRemaining: payload.rounds_remaining,
        });
      } else {
        setPhase({
          kind: "matched",
          dilemma: payload.dilemma,
          confidence: payload.confidence,
          reasoning: payload.reasoning,
          difficulty: payload.suggested_difficulty,
          settledWithoutConfidence: payload.settled_without_confidence,
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

  async function begin() {
    if (phase.kind !== "matched") return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainee_id: traineeId,
          dilemma_id: phase.dilemma.id,
          requested_text: request,
          clarifications,
          difficulty: phase.difficulty,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not start.");
      router.push(`/trainee/${payload.session_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start.");
      setBusy(false);
    }
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
          <div className="panel-header">Matched</div>
          <div className="p-4">
            {phase.settledWithoutConfidence ? (
              <p className="chip status-warn mb-3 !normal-case">
                Still not certain after three questions — going with the closest fit.
              </p>
            ) : null}

            <p className="text-sm text-muted">Based on what you asked for:</p>
            <p className="mt-1 text-lg font-semibold">{phase.dilemma.title}</p>
            <p className="mt-2 text-sm text-muted">{phase.reasoning}</p>
            <p className="data mt-2 text-xs text-muted">
              confidence {(phase.confidence * 100).toFixed(0)}%
            </p>

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
                disabled={busy}
                onClick={() => void begin()}
              >
                {busy ? "Building the scenario…" : "Begin training"}
              </button>
              <button type="button" className="btn" onClick={restart} disabled={busy}>
                Ask for something else
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Nothing to match against ------------------------------- */}
      {phase.kind === "no_dilemmas" ? (
        <div className="panel mt-4 p-4">
          <p className="text-sm">
            The knowledge base has no approved dilemmas yet, so there is nothing
            to match your request against. A system designer needs to teach and
            approve at least one first.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="chip status-danger mt-4 !normal-case">{error}</p>
      ) : null}
    </div>
  );
}
