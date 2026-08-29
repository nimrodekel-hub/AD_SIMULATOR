"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SimulatedConsole } from "@/components/simulated-console";
import type {
  DecisionMade,
  ScenarioInstance,
  Session,
} from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * Screen 3, the back half: running the scenario.
 *
 * Two presentations of the same run. When the designer has approved a console
 * shell, the live pieces are rendered into its slots and the trainee sees
 * something that looks like their own equipment. Otherwise they fall back to
 * the built-in operations layout, which is plain but complete.
 *
 * Either way the pieces themselves — clock, air picture, resources, decision —
 * are the same components with the same data. Only the frame around them
 * changes.
 */

type Stage = "brief" | "running" | "submitting";

export function ScenarioRun({
  session,
  templateHtml,
  iffTones,
}: {
  session: Session;
  /** The approved console shell, when there is one. */
  templateHtml?: string;
  /** Identification state (lower-cased) to status class, from the profile. */
  iffTones?: Record<string, string>;
}) {
  const router = useRouter();
  const scenario = session.scenario_instance;

  const [stage, setStage] = useState<Stage>("brief");
  const [current, setCurrent] = useState(0);
  const [decisions, setDecisions] = useState<DecisionMade[]>([]);
  const [remaining, setRemaining] = useState(scenario.time_window_seconds);
  const [error, setError] = useState<string>();

  /**
   * Clock reading when the current decision point appeared, so time-to-answer
   * comes from the countdown rather than from a wall-clock call. Second
   * resolution is all this needs, and it keeps the component free of impure
   * calls that the React compiler cannot prove are event-only.
   */
  const shownAtRemaining = useRef<number>(scenario.time_window_seconds);
  /** Guards against the clock and the last answer both submitting. */
  const submitted = useRef(false);

  const finish = useCallback(
    async (final: DecisionMade[]) => {
      if (submitted.current) return;
      submitted.current = true;
      setStage("submitting");

      try {
        const response = await fetch(`/api/sessions/${session.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: final }),
        });
        const payload = await readJson<{ error?: string }>(response);
        if (!response.ok) throw new Error(payload.error ?? "Debrief failed.");
        router.push(`/trainee/${session.id}/debrief`);
      } catch (reason) {
        // The decisions are already stored server-side, so the run is not lost
        // even when the assessment call fails.
        setError(reason instanceof Error ? reason.message : "Debrief failed.");
        submitted.current = false;
        setStage("running");
      }
    },
    [router, session.id],
  );

  /* The clock. Running out ends the run with whatever was answered — that is
     the pressure the scenario is built around, so it has real consequences. */
  useEffect(() => {
    if (stage !== "running") return;
    const timer = setInterval(() => {
      setRemaining((seconds) => {
        if (seconds <= 1) {
          clearInterval(timer);
          void finish(decisions);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [stage, decisions, finish]);

  function choose(action: string) {
    const answered: DecisionMade[] = [
      ...decisions,
      {
        decision_point_index: current,
        chosen_action: action,
        elapsed_ms: Math.max(0, (shownAtRemaining.current - remaining) * 1000),
      },
    ];
    setDecisions(answered);

    if (current + 1 >= scenario.decision_points.length) {
      void finish(answered);
    } else {
      setCurrent(current + 1);
      shownAtRemaining.current = remaining;
    }
  }

  /* ---- Pre-run brief ------------------------------------------- */
  if (stage === "brief") {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="panel">
          <div className="panel-header">Situation brief</div>
          <div className="p-5">
            <h2 className="text-lg font-semibold">{scenario.scenario_name}</h2>
            <p className="prose-block mt-3 whitespace-pre-wrap text-sm">
              {scenario.situation_brief}
            </p>
            <dl className="data mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Readout label="Tracks" value={String(scenario.tracks.length)} />
              <Readout
                label="Decisions"
                value={String(scenario.decision_points.length)}
              />
              <Readout label="Window" value={`${scenario.time_window_seconds}s`} />
              <Readout label="Level" value={session.difficulty_level} />
            </dl>
            <p className="mt-5 text-xs text-muted">
              The clock starts when you begin and does not pause. If it runs out,
              the run ends with whatever you have answered.
            </p>
            <button
              type="button"
              className="btn btn-primary mt-5"
              onClick={() => {
                shownAtRemaining.current = scenario.time_window_seconds;
                setStage("running");
              }}
            >
              Begin
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---- The live pieces ----------------------------------------- */
  const point = scenario.decision_points[current];

  const clock = <Clock remaining={remaining} window={scenario.time_window_seconds} />;
  const tracks = <TrackTable scenario={scenario} iffTones={iffTones} />;
  const resources = <ResourceList scenario={scenario} />;
  const decision = (
    <DecisionPanel
      submitting={stage === "submitting"}
      situation={point.situation_rendered}
      actions={point.actions}
      error={error}
      onChoose={choose}
    />
  );

  /* ---- Inside the designer's console --------------------------- */
  if (templateHtml) {
    return (
      <SimulatedConsole
        html={templateHtml}
        slots={{
          "system-name": <span className="data">{scenario.scenario_name}</span>,
          clock,
          tracks,
          resources,
          decision,
        }}
      />
    );
  }

  /* ---- Built-in operations layout ------------------------------ */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-2">
        {clock}
        <span className="data text-xs text-muted">
          DECISION {current + 1} / {scenario.decision_points.length}
        </span>
        <span className="data text-xs text-muted">
          {scenario.tracks.length} TRACKS
        </span>
      </div>

      <div className="grid flex-1 gap-px bg-[var(--border)] lg:grid-cols-[1fr_18rem]">
        <section className="bg-panel">
          <div className="panel-header">Air picture</div>
          {tracks}
        </section>
        <aside className="bg-panel">
          <div className="panel-header">Resources</div>
          {resources}
        </aside>
      </div>

      <div className="border-t border-line bg-panel-raised p-4">{decision}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The pieces                                                          */
/* ------------------------------------------------------------------ */

function Clock({ remaining, window: total }: { remaining: number; window: number }) {
  const urgency =
    remaining <= total * 0.25
      ? "status-danger"
      : remaining <= total * 0.5
        ? "status-warn"
        : "status-ok";

  return (
    <span className={`chip ${urgency} data`}>
      T-{String(Math.floor(remaining / 60)).padStart(2, "0")}:
      {String(remaining % 60).padStart(2, "0")}
    </span>
  );
}

function TrackTable({
  scenario,
  iffTones,
}: {
  scenario: ScenarioInstance;
  iffTones?: Record<string, string>;
}) {
  /* The columns are whatever the system profile declared, so the table shows
     the fields this system actually shows. Taken from the first track: the
     generator produces the same readouts, in the same order, for all of them. */
  const columns = scenario.tracks[0]?.readouts.map((readout) => readout.label) ?? [];

  return (
    <>
      <div className="overflow-x-auto">
        <table className="data w-full min-w-[44rem] text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <Th>TRACK</Th>
              <Th>IFF</Th>
              <Th>CLASS</Th>
              {columns.map((label) => (
                <Th key={label} right>
                  {label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenario.tracks.map((track) => (
              <tr key={track.designator} className="border-b border-line/60">
                <Td>{track.designator}</Td>
                <Td>
                  <span className={`chip ${iffTone(track.iff_status, iffTones)}`}>
                    {track.iff_status}
                  </span>
                </Td>
                <Td>{track.classification}</Td>
                {track.readouts.map((readout, index) => (
                  <Td key={index} right>
                    {readout.value}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scenario.tracks.some((track) => track.notes) ? (
        <div className="border-t border-line p-3">
          <p className="mb-2 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
            Track notes
          </p>
          <ul className="space-y-1 text-xs text-muted">
            {scenario.tracks
              .filter((track) => track.notes)
              .map((track) => (
                <li key={track.designator}>
                  <span className="data text-ink">{track.designator}</span>{" "}
                  {track.notes}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function ResourceList({ scenario }: { scenario: ScenarioInstance }) {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {scenario.resources.map((resource) => (
        <li key={resource.name} className="px-3 py-2.5">
          <p className="text-xs">{resource.name}</p>
          <p className="data mt-1 text-sm">
            <span
              className={
                resource.available <= resource.total * 0.34
                  ? "text-danger"
                  : "text-accent"
              }
            >
              {resource.available}
            </span>
            <span className="text-muted">
              {" "}
              / {resource.total} {resource.unit}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function DecisionPanel({
  submitting,
  situation,
  actions,
  error,
  onChoose,
}: {
  submitting: boolean;
  situation: string;
  actions: Array<{ label: string; description: string }>;
  error?: string;
  onChoose: (label: string) => void;
}) {
  return (
    <>
      {submitting ? (
        <p className="text-sm text-muted">Evaluating the run…</p>
      ) : (
        <>
          <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-accent">
            Decision required
          </p>
          <p className="text-sm">{situation}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="btn max-w-sm flex-col !items-start gap-1 text-left"
                onClick={() => onChoose(action.label)}
                title={action.description}
              >
                <span className="font-semibold">{action.label}</span>
                <span className="text-xs font-normal text-muted">
                  {action.description}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {error ? (
        <p className="chip status-danger mt-3 !normal-case">{error}</p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Colour by identification state, using the system-wide status palette.
 *
 * The designer's profile decides this: they said what each state means and how
 * urgently it should read. The keyword guess below is only for a system that
 * has not been taught yet.
 */
function iffTone(status: string, tones?: Record<string, string>): string {
  const declared = tones?.[status.toLowerCase()];
  if (declared) return declared;

  const normalised = status.toLowerCase();
  if (normalised.includes("confirmed") && normalised.includes("hostile")) {
    return "status-danger";
  }
  if (normalised.includes("hostile") || normalised.includes("assumed")) {
    return "status-warn";
  }
  if (normalised.includes("friend")) return "status-ok";
  return "status-warn";
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <td className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      {children}
    </td>
  );
}
