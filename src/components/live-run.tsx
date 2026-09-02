"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadarScope } from "@/components/radar-scope";
import { SimulatedConsole } from "@/components/simulated-console";
import type {
  DifficultyLevel,
  ScenarioInstance,
  SystemProfile,
} from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import {
  command,
  createSim,
  end,
  simConfig,
  step,
  summarise,
  toneOf,
  viewOf,
  type Command,
  type SimState,
  type TrackView,
} from "@/lib/sim/engine";
import { seededRandom, timeToIntercept, vecToPolar } from "@/lib/sim/geometry";
import { positionOf, probabilityOfKill } from "@/lib/sim/engine";

/**
 * Screen 3: flying the engagement.
 *
 * This is the part the whole knowledge base exists to feed. A trainee is not
 * asked what they would do — they sit in front of the picture and do it, while
 * tracks close at their real speeds and the clock does not stop. Everything
 * they get wrong is something they did, at a time, with the information that
 * was on the screen at that moment, and the debrief has all of it.
 *
 * The component owns exactly two things: the tick, and which track is
 * selected. Every rule — what can be seen, what can be fired at, what a round
 * does when it arrives — lives in `lib/sim/engine`, which knows nothing about
 * React. That separation is what makes the rules testable, and it is why the
 * refusal messages are worth reading: they come from the same code that
 * enforces them.
 */

/** Simulated seconds per real second. One, because time pressure is the point. */
const RATE = 1;
/** How often the world advances. Smooth enough to read, cheap enough to run. */
const TICK_MS = 100;

const TONE_CLASS = {
  friendly: "status-ok",
  neutral: "status-warn",
  caution: "status-warn",
  hostile: "status-danger",
} as const;

type Stage = "brief" | "running" | "submitting" | "failed";

export function LiveRun({
  runId,
  scenario,
  difficulty,
  profile,
  templateHtml,
  onFinish,
}: {
  /**
   * Identifies this run. It seeds the luck and, for a trainee, addresses the
   * session the result is written to.
   */
  runId: string;
  scenario: ScenarioInstance;
  difficulty: DifficultyLevel;
  profile: SystemProfile | null;
  /**
   * The designer's console shell, when there is one that can host a live
   * engagement. The page declines shells with no `scope` slot, so anything
   * arriving here is known to have somewhere to put the radar picture.
   */
  templateHtml?: string;
  /**
   * Where the run's outcome goes.
   *
   * A trainee's run is scored: left unset, the log and the tally are posted to
   * the session and the debrief opens. A designer rehearsing their console
   * passes a handler instead — nothing is written, nobody is assessed, and the
   * point is only to watch the console behave with things moving on it. Same
   * component either way, because a rehearsal against a near-copy of the real
   * thing proves nothing.
   */
  onFinish?: (final: SimState) => void;
}) {
  const router = useRouter();

  const config = useMemo(() => simConfig(profile, scenario), [profile, scenario]);
  /* Seeded from the session, so the luck of a run is fixed the moment it is
     created: the same scenario deals the same hands, and a debrief that says a
     shot missed is still true when someone reviews it. */
  const random = useMemo(() => seededRandom(runId), [runId]);

  const [stage, setStage] = useState<Stage>("brief");
  const [state, setState] = useState<SimState>(() =>
    createSim(scenario.live_tracks),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [round, setRound] = useState(config.interceptors[0]?.name ?? "");
  const [error, setError] = useState<string>();

  const submitted = useRef(false);
  const finished = useRef<SimState | null>(null);

  const remaining = Math.max(0, scenario.time_window_seconds - state.t);

  const finish = useCallback(
    async (final: SimState) => {
      if (submitted.current) return;
      submitted.current = true;

      // A rehearsal is over when it is over: nothing to write, nobody to
      // score, and the designer stays on their own page.
      if (onFinish) {
        onFinish(final);
        return;
      }

      setStage("submitting");

      const result = summarise(final, config, scenario.success_criteria);
      try {
        const response = await fetch(`/api/sessions/${runId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_log: final.events, run_result: result }),
        });
        const payload = await readJson<{ error?: string }>(response);
        if (!response.ok) throw new Error(payload.error ?? "Debrief failed.");
        router.push(`/trainee/${runId}/debrief`);
      } catch (reason) {
        // The log is written before the assessment call, so a failure here
        // costs the debrief and never the record of what the trainee did.
        setError(reason instanceof Error ? reason.message : "Debrief failed.");
        submitted.current = false;
        finished.current = final;
        setStage("failed");
      }
    },
    [config, onFinish, router, runId, scenario.success_criteria],
  );

  /* ---- The clock ------------------------------------------------ */
  useEffect(() => {
    if (stage !== "running") return;
    const timer = setInterval(() => {
      setState((current) => {
        if (current.over) return current;

        const next = step(current, (TICK_MS / 1000) * RATE, config);

        // The run ends when the window closes, or earlier when there is
        // nothing left to decide — no live track and no round still flying.
        const nothingLeft =
          next.tracks.every((track) => track.state !== "airborne") &&
          next.engagements.every((engagement) => engagement.resolved);
        const outOfTime = next.t >= scenario.time_window_seconds;

        if (outOfTime || nothingLeft) {
          const done = end(
            next,
            outOfTime ? "Time expired." : "Air picture clear.",
          );
          finished.current = done;
          return done;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [stage, config, scenario.time_window_seconds]);

  /* Submitting is a side effect of the run ending, not of the tick: doing it
     inside the interval would fire it several times before the state settled. */
  useEffect(() => {
    if (stage === "running" && state.over && finished.current) {
      void finish(finished.current);
    }
  }, [stage, state.over, finish]);

  const send = useCallback(
    (cmd: Command) => {
      setState((current) => command(current, cmd, config, random));
    },
    [config, random],
  );

  /* ---- Pre-run brief -------------------------------------------- */
  if (stage === "brief") {
    return (
      <Brief
        scenario={scenario}
        config={config}
        difficulty={difficulty}
        onBegin={() => setStage("running")}
      />
    );
  }

  /* ---- The live pieces ------------------------------------------ */
  const views = state.tracks
    .map((track) => viewOf(track, state.t, config))
    .filter((view) => view.visible)
    .sort((a, b) => a.range_km - b.range_km);

  const selectedView =
    views.find((view) => view.track.designator === selected) ?? null;

  const inFlight = state.engagements.filter((e) => !e.resolved).length;

  const scope = (
    <RadarScope
      state={state}
      config={config}
      selected={selected}
      onSelect={setSelected}
    />
  );

  const clock = (
    <Clock remaining={remaining} window={scenario.time_window_seconds} />
  );

  const trackList = (
    <TrackList
      views={views}
      config={config}
      selected={selected}
      onSelect={setSelected}
    />
  );

  const resources = (
    <Resources
      config={config}
      spent={state.spent}
      inFlight={inFlight}
      criteria={scenario.success_criteria}
    />
  );

  const controls = (
    <Controls
      view={selectedView}
      config={config}
      state={state}
      round={round}
      onRound={setRound}
      onCommand={send}
      busy={stage === "submitting"}
    />
  );

  const log = <EventLog state={state} />;

  /* ---- Inside the designer's own console ------------------------ */
  if (templateHtml) {
    return (
      <div className="console-frame">
        <SimulatedConsole
          html={templateHtml}
          slots={{
            "system-name": (
              <span className="data text-xs">{scenario.scenario_name}</span>
            ),
            clock,
            scope: (
              <div className="grid h-full min-h-0 place-items-center">
                <div className="aspect-square max-h-full max-w-full [height:100%]">
                  {scope}
                </div>
              </div>
            ),
            tracks: (
              <div className="h-full min-h-0 overflow-y-auto">{trackList}</div>
            ),
            resources,
            decision: (
              <div className="flex h-full min-h-0 gap-3">
                <div className="min-w-0 flex-1">{controls}</div>
                <div className="hidden min-h-0 w-72 overflow-y-auto lg:block">
                  {log}
                </div>
              </div>
            ),
          }}
        />
        {stage === "failed" ? (
          <Failed
            error={error}
            onRetry={() => finished.current && void finish(finished.current)}
          />
        ) : null}
      </div>
    );
  }

  /* ---- Built-in operations layout ------------------------------- */
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] gap-px bg-[var(--border)]">
      <header className="flex flex-wrap items-center gap-3 bg-panel px-4 py-2">
        {clock}
        <span className="data text-xs text-muted">
          {views.length} HELD · {inFlight} IN FLIGHT ·{" "}
          {config.magazine - state.spent} ROUNDS
        </span>
        <span className="ml-auto data text-xs text-muted">
          {scenario.scenario_name}
        </span>
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-px lg:grid-cols-[1fr_24rem]">
        {/* A plan-position display is a circle: given a wide panel it centres
            itself and leaves a third of the console empty either side.
            Squaring it hands that width back to the track list, where it
            becomes readable columns. */}
        <section className="grid min-h-0 place-items-center bg-panel p-2">
          <div className="aspect-square max-h-full max-w-full [height:100%]">
            {scope}
          </div>
        </section>
        <aside className="grid min-h-0 grid-rows-[1fr_auto] gap-px bg-[var(--border)]">
          <div className="min-h-0 overflow-y-auto bg-panel">{trackList}</div>
          <div className="bg-panel">{resources}</div>
        </aside>
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--border)] lg:grid-cols-[1fr_22rem]">
        <div className="bg-panel-raised p-3">{controls}</div>
        <div className="hidden max-h-40 overflow-y-auto bg-panel lg:block">
          {log}
        </div>
      </div>

      {stage === "failed" ? (
        <Failed
          error={error}
          onRetry={() => finished.current && void finish(finished.current)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The brief                                                           */
/* ------------------------------------------------------------------ */

function Brief({
  scenario,
  config,
  difficulty,
  onBegin,
}: {
  scenario: ScenarioInstance;
  config: ReturnType<typeof simConfig>;
  difficulty: string;
  onBegin: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
      <div className="panel">
        <div className="panel-header">Situation brief</div>
        <div className="p-5">
          <h2 className="text-lg font-semibold">{scenario.scenario_name}</h2>
          <p className="prose-block mt-3 whitespace-pre-wrap text-sm">
            {scenario.situation_brief}
          </p>

          <dl className="data mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Window" value={`${scenario.time_window_seconds}s`} />
            <Stat label="Rounds" value={String(config.magazine)} />
            <Stat label="At once" value={String(config.max_simultaneous)} />
            <Stat label="Level" value={difficulty} />
          </dl>

          <div className="mt-5 rounded border border-line bg-panel-raised p-4">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
              What counts as success
            </p>
            <p className="mt-2 text-sm">
              {scenario.success_criteria.statement ||
                "Keep every hostile out of the defended area."}
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted">
              <li>
                At most {scenario.success_criteria.max_leakers} hostile
                {scenario.success_criteria.max_leakers === 1 ? "" : "s"} may
                reach the defended area.
              </li>
              <li>Engaging anything friendly fails the run outright.</li>
              <li>
                Efficient is {scenario.success_criteria.max_interceptors_spent}{" "}
                rounds or fewer.
              </li>
            </ul>
          </div>

          <p className="mt-5 text-xs text-muted">
            You are the operator. Tracks close in real time, the clock does not
            pause, and nothing waits for you to decide. Select a track to read
            it, correct its identification if the system has it wrong, choose a
            round and fire.
          </p>

          <button type="button" className="btn btn-primary mt-5" onClick={onBegin}>
            Take the position
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The pieces                                                          */
/* ------------------------------------------------------------------ */

function Clock({ remaining, window: total }: { remaining: number; window: number }) {
  const seconds = Math.ceil(remaining);
  const urgency =
    remaining <= total * 0.25
      ? "status-danger"
      : remaining <= total * 0.5
        ? "status-warn"
        : "status-ok";
  return (
    <span className={`chip ${urgency} data`}>
      T-{String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function TrackList({
  views,
  config,
  selected,
  onSelect,
}: {
  views: TrackView[];
  config: ReturnType<typeof simConfig>;
  selected: string | null;
  onSelect: (designator: string) => void;
}) {
  if (views.length === 0) {
    return (
      <p className="p-3 text-xs text-muted">
        Nothing held. The scope is clear.
      </p>
    );
  }

  return (
    <table className="data w-full text-[0.7rem]">
      <thead className="sticky top-0 bg-panel text-muted">
        <tr className="border-b border-line">
          <th className="px-2 py-1 text-left font-medium">TRK</th>
          <th className="px-2 py-1 text-right font-medium">RNG</th>
          <th className="px-2 py-1 text-right font-medium">TTI</th>
          <th className="px-2 py-1 text-left font-medium">ID</th>
        </tr>
      </thead>
      <tbody>
        {views.map((view) => (
          <tr
            key={view.track.designator}
            onClick={() => onSelect(view.track.designator)}
            className={`cursor-pointer border-b border-line/60 ${
              view.track.designator === selected ? "bg-panel-raised" : ""
            }`}
          >
            <td className="px-2 py-1">{view.track.designator}</td>
            <td className="px-2 py-1 text-right">{view.range_km.toFixed(0)}</td>
            <td className="px-2 py-1 text-right">
              {view.tti_s === null ? "—" : `${view.tti_s.toFixed(0)}s`}
            </td>
            <td className="px-2 py-1">
              <span
                className={`chip ${TONE_CLASS[toneOf(config, view.track.displayed_iff)]}`}
              >
                {view.track.displayed_iff}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Resources({
  config,
  spent,
  inFlight,
  criteria,
}: {
  config: ReturnType<typeof simConfig>;
  spent: number;
  inFlight: number;
  criteria: ScenarioInstance["success_criteria"];
}) {
  const left = config.magazine - spent;
  return (
    <div className="space-y-2 p-3 text-xs">
      <Meter
        label="Rounds"
        value={left}
        total={config.magazine}
        warn={left <= 1}
      />
      <div className="flex justify-between text-muted">
        <span>In the air</span>
        <span className="data">
          {inFlight} / {config.max_simultaneous}
        </span>
      </div>
      <div className="flex justify-between text-muted">
        <span>Spent</span>
        <span
          className={`data ${spent > criteria.max_interceptors_spent ? "text-danger" : ""}`}
        >
          {spent} / {criteria.max_interceptors_spent}
        </span>
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  total,
  warn,
}: {
  label: string;
  value: number;
  total: number;
  warn: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between">
        <span className="text-muted">{label}</span>
        <span className={`data ${warn ? "text-danger" : ""}`}>
          {value} / {total}
        </span>
      </div>
      <div className="mt-1 h-1 w-full bg-[var(--border)]">
        <div
          className={warn ? "h-1 bg-danger" : "h-1 bg-ok"}
          style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/**
 * What the operator can actually do with the selected track.
 *
 * The order follows the workflow a real console imposes: read it, decide what
 * it is, choose a round, commit. The firing solution — time of flight and
 * probability of kill — is shown before the launch rather than after, because
 * deciding whether this is a good shot *is* the skill being trained.
 */
function Controls({
  view,
  config,
  state,
  round,
  onRound,
  onCommand,
  busy,
}: {
  view: TrackView | null;
  config: ReturnType<typeof simConfig>;
  state: SimState;
  round: string;
  onRound: (name: string) => void;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  const lastRefusal = [...state.events]
    .reverse()
    .find((entry) => entry.kind === "refused");

  if (!view) {
    return (
      <p className="text-xs text-muted">
        Select a track — on the scope or in the list — to work it.
      </p>
    );
  }

  const track = view.track;
  const chosen =
    config.interceptors.find((r) => r.name === round) ?? config.interceptors[0];

  const flight = timeToIntercept(view.at, track.velocity, chosen.speed_kts);
  const meetsAt =
    flight === null
      ? null
      : vecToPolar(positionOf(track, state.t + flight)).range_km;
  const pk = meetsAt === null ? 0 : probabilityOfKill(meetsAt, chosen);
  const engaged = state.engagements.some(
    (e) => e.target === track.designator && !e.resolved,
  );

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      {/* ---- What is it ---------------------------------------- */}
      <div>
        <p className="data text-sm font-semibold">{track.designator}</p>
        <p className="text-[0.7rem] text-muted">
          {track.classification} · {view.range_km.toFixed(0)} km ·{" "}
          {view.bearing_deg.toFixed(0)}° · {track.altitude_ft.toLocaleString()} ft ·{" "}
          {track.speed_kts} kts
        </p>
        {track.notes ? (
          <p className="mt-1 max-w-xs text-[0.7rem] text-muted">{track.notes}</p>
        ) : null}
      </div>

      {/* ---- Identification ------------------------------------ */}
      <div>
        <p className="label">Identification</p>
        <div className="flex flex-wrap gap-1">
          {Object.keys(config.tones).length === 0 ? (
            <span className="text-[0.7rem] text-muted">
              No states declared in the profile.
            </span>
          ) : (
            Object.keys(config.tones).map((name) => (
              <button
                key={name}
                type="button"
                className={`btn text-[0.7rem] ${
                  track.displayed_iff.toLowerCase() === name ? "btn-primary" : ""
                }`}
                onClick={() =>
                  onCommand({
                    kind: "classify",
                    designator: track.designator,
                    to: name,
                  })
                }
              >
                {name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ---- The round ----------------------------------------- */}
      <div>
        <p className="label">Interceptor</p>
        <div className="flex flex-wrap gap-1">
          {config.interceptors.map((option) => (
            <button
              key={option.name}
              type="button"
              className={`btn text-[0.7rem] ${option.name === chosen.name ? "btn-primary" : ""}`}
              onClick={() => onRound(option.name)}
            >
              {option.name}
              <span className="ml-1 text-muted">
                {option.min_range_km}–{option.max_range_km}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- The firing solution ------------------------------- */}
      <div className="data text-[0.7rem]">
        <p className="label">Solution</p>
        {flight === null ? (
          <p className="text-danger">No intercept — it cannot be caught.</p>
        ) : (
          <p className="text-muted">
            TOF {flight.toFixed(0)}s · meets at {meetsAt?.toFixed(0)} km · Pk{" "}
            <span
              className={pk > 0.7 ? "text-ok" : pk > 0 ? "text-warn" : "text-danger"}
            >
              {(pk * 100).toFixed(0)}%
            </span>
          </p>
        )}
      </div>

      {/* ---- Commit -------------------------------------------- */}
      <div className="ml-auto flex items-center gap-2">
        {engaged ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              onCommand({ kind: "cease", designator: track.designator })
            }
          >
            Cease fire
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            onCommand({
              kind: "engage",
              designator: track.designator,
              interceptor: chosen.name,
            })
          }
        >
          Fire {chosen.name}
        </button>
      </div>

      {lastRefusal ? (
        <p className="w-full text-[0.7rem] text-danger">{lastRefusal.detail}</p>
      ) : null}
    </div>
  );
}

/** The running record, newest first — what a real console prints as it goes. */
function EventLog({ state }: { state: SimState }) {
  const recent = [...state.events].reverse().slice(0, 40);
  return (
    <ul className="divide-y divide-line/60 text-[0.7rem]">
      {recent.map((entry, index) => (
        <li key={index} className="flex gap-2 px-3 py-1">
          <span className="data shrink-0 text-muted">
            T+{String(Math.floor(entry.t)).padStart(3, "0")}
          </span>
          <span className={entryClass(entry.kind)}>{entry.detail}</span>
        </li>
      ))}
      {recent.length === 0 ? (
        <li className="px-3 py-2 text-muted">No activity yet.</li>
      ) : null}
    </ul>
  );
}

function entryClass(kind: string): string {
  if (kind === "hit") return "text-ok";
  if (kind === "leaked" || kind === "refused" || kind === "miss")
    return "text-danger";
  if (kind === "launched" || kind === "resolved") return "text-warn";
  return "text-muted";
}

function Failed({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-danger bg-panel-raised p-4">
      <p className="text-sm text-danger">{error}</p>
      <p className="mt-1 text-xs text-muted">
        Your run is recorded. Only the assessment failed.
      </p>
      <button type="button" className="btn mt-3" onClick={onRetry}>
        Try the debrief again
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.1em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
