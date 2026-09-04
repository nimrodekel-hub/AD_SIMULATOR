"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadarScope, rangeScales } from "@/components/radar-scope";
import { RangeControl } from "@/components/range-control";
import { SimulatedConsole } from "@/components/simulated-console";
import type {
  DifficultyLevel,
  ExerciseInstance,
  SystemProfile,
} from "@/lib/domain/schemas";
import { describeReply, meaningOfMode3 } from "@/lib/domain/iff-codes";
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
  type RuntimeTrack,
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
  exercise,
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
  exercise: ExerciseInstance;
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

  const config = useMemo(() => simConfig(profile, exercise), [profile, exercise]);
  /* Seeded from the session, so the luck of a run is fixed the moment it is
     created: the same exercise deals the same hands, and a debrief that says a
     shot missed is still true when someone reviews it. */
  const random = useMemo(() => seededRandom(runId), [runId]);

  const [stage, setStage] = useState<Stage>("brief");
  const [state, setState] = useState<SimState>(() =>
    createSim(exercise.live_tracks, config),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [round, setRound] = useState(config.interceptors[0]?.name ?? "");
  /* Which launcher the next round comes out of. Meaningless — and never
     shown — on a system that declares one launcher. */
  const [launcher, setLauncher] = useState(0);
  /* The scope's range scale. Owned here rather than inside the scope so the
     switch and the picture are the same piece of state, wherever the shell
     happens to put the switch. Opens on the full picture. */
  const scales = useMemo(
    () => rangeScales(config.detection_range_km),
    [config.detection_range_km],
  );
  const [rangeKm, setRangeKm] = useState(scales[scales.length - 1]);
  const [error, setError] = useState<string>();

  const submitted = useRef(false);
  const finished = useRef<SimState | null>(null);

  const remaining = Math.max(0, exercise.time_window_seconds - state.t);

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

      const result = summarise(final, config, exercise.success_criteria);
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
    [config, onFinish, router, runId, exercise.success_criteria],
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
        const outOfTime = next.t >= exercise.time_window_seconds;

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
  }, [stage, config, exercise.time_window_seconds]);

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
        exercise={exercise}
        config={config}
        difficulty={difficulty}
        onBegin={() => setStage("running")}
      />
    );
  }

  /* ---- The live pieces ------------------------------------------ */
  const hostsRangeSlot = templateHtml?.includes('data-slot="range"') === true;

  const views = state.tracks
    .map((track) => viewOf(track, state.t, config, state.tilt_deg))
    .filter((view) => view.visible)
    .sort((a, b) => a.range_km - b.range_km);

  const selectedView =
    views.find((view) => view.track.designator === selected) ?? null;

  const inFlight = state.engagements.filter((e) => !e.resolved).length;

  const rangeControl = (
    <RangeControl scales={scales} value={rangeKm} onChange={setRangeKm} />
  );

  const scope = (
    <RadarScope
      state={state}
      config={config}
      selected={selected}
      onSelect={setSelected}
      rangeKm={rangeKm}
    />
  );

  /* Consoles built before the range slot existed have nowhere to put the
     switch, and the designer should not have to rebuild their console to get
     a working one. So it sits over the corner of the picture instead. */
  const scopeWithRange = (
    <div className="relative h-full min-h-0 w-full">
      {scope}
      {hostsRangeSlot ? null : (
        <div className="pointer-events-auto absolute left-0 top-0">
          <RangeControl
            scales={scales}
            value={rangeKm}
            onChange={setRangeKm}
            compact
          />
        </div>
      )}
    </div>
  );

  const clock = (
    <Clock remaining={remaining} window={exercise.time_window_seconds} />
  );

  const trackList = (
    <TrackList
      views={views}
      config={config}
      state={state}
      round={round}
      selected={selected}
      onSelect={setSelected}
    />
  );

  const resources = (
    <Resources
      config={config}
      spent={state.spent}
      rounds={state.launcher_rounds}
      reloading={state.reloading_until}
      inFlight={inFlight}
      criteria={exercise.success_criteria}
    />
  );

  const controls = (
    <Controls
      view={selectedView}
      config={config}
      state={state}
      round={round}
      launcher={launcher}
      onRound={setRound}
      onLauncher={setLauncher}
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
              <span className="data text-xs">{exercise.exercise_name}</span>
            ),
            clock,
            scope: (
              <div className="grid h-full min-h-0 place-items-center">
                <div className="aspect-square max-h-full max-w-full [height:100%]">
                  {scopeWithRange}
                </div>
              </div>
            ),
            range: rangeControl,
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
          {state.launcher_rounds.reduce((sum, x) => sum + x, 0)} ROUNDS
        </span>
        {rangeControl}
        <span className="ml-auto data text-xs text-muted">
          {exercise.exercise_name}
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
  exercise,
  config,
  difficulty,
  onBegin,
}: {
  exercise: ExerciseInstance;
  config: ReturnType<typeof simConfig>;
  difficulty: string;
  onBegin: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
      <div className="panel">
        <div className="panel-header">Situation brief</div>
        <div className="p-5">
          <h2 className="text-lg font-semibold">{exercise.exercise_name}</h2>
          <p className="prose-block mt-3 whitespace-pre-wrap text-sm">
            {exercise.situation_brief}
          </p>

          <dl className="data mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="Window" value={`${exercise.time_window_seconds}s`} />
            <Stat label="Rounds" value={String(config.magazine)} />
            <Stat label="At once" value={String(config.max_simultaneous)} />
            <Stat label="Level" value={difficulty} />
          </dl>

          <div className="mt-5 rounded border border-line bg-panel-raised p-4">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
              What counts as success
            </p>
            <p className="mt-2 text-sm">
              {exercise.success_criteria.statement ||
                "Keep every hostile out of the defended area."}
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted">
              <li>
                At most {exercise.success_criteria.max_leakers} hostile
                {exercise.success_criteria.max_leakers === 1 ? "" : "s"} may
                reach the defended area.
              </li>
              <li>Engaging anything friendly fails the run outright.</li>
              <li>
                Efficient is {exercise.success_criteria.max_interceptors_spent}{" "}
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

/**
 * The columns whose values the simulation can actually produce.
 *
 * Matched on the label the designer typed, upper-cased, so the catalogue they
 * ticked from lines up without a second identifier to keep in step. A column
 * outside this set is still shown — it is their console and they may have
 * reasons — but with a dash and a tooltip, because a blank cell reads as a
 * value of nothing rather than as a figure the simulator does not hold.
 */
const KNOWN_READOUTS = new Set([
  "TRK",
  "ID",
  "TYPE",
  "CLASS",
  "AZ",
  "BRG",
  "RNG",
  "ALT",
  "SPD",
  "TTI",
  "IFF",
  "MODE 1",
  "MODE1",
  "PK",
  "FIRE STATUS",
]);

/** Which way a column reads. Numbers right, words left, as a console does. */
const RIGHT_ALIGNED = new Set([
  "AZ",
  "BRG",
  "RNG",
  "ALT",
  "SPD",
  "TTI",
  "PK",
]);

function TrackList({
  views,
  config,
  state,
  round,
  selected,
  onSelect,
}: {
  views: TrackView[];
  config: ReturnType<typeof simConfig>;
  /** For the columns that describe an engagement rather than a track. */
  state: SimState;
  /** The round currently selected, which is what a Pk column is about. */
  round: string;
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
          {config.readouts.map((field, index) => (
            <th
              key={`${field.label}-${index}`}
              title={field.description || undefined}
              className={`px-2 py-1 font-medium ${
                RIGHT_ALIGNED.has(field.label.toUpperCase())
                  ? "text-right"
                  : "text-left"
              }`}
            >
              {field.label}
            </th>
          ))}
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
            {config.readouts.map((field, index) => (
              <td
                key={`${field.label}-${index}`}
                className={`px-2 py-1 ${
                  RIGHT_ALIGNED.has(field.label.toUpperCase())
                    ? "text-right"
                    : ""
                }`}
              >
                <Readout
                  field={field.label}
                  view={view}
                  config={config}
                  state={state}
                  round={round}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One cell: whatever this console calls this column, as it stands now. */
function Readout({
  field,
  view,
  config,
  state,
  round,
}: {
  field: string;
  view: TrackView;
  config: ReturnType<typeof simConfig>;
  state: SimState;
  round: string;
}) {
  const track = view.track;

  switch (field.trim().toUpperCase()) {
    case "TRK":
      return <>{track.designator}</>;

    /* What the console believes, not what the track is. The two differ only
       on a system that can be wrong about it and lets the operator say so. */
    case "TYPE":
    case "CLASS":
      return (
        <span className={track.typed_by_operator ? "text-accent" : undefined}>
          {track.displayed_classification}
        </span>
      );

    case "AZ":
    case "BRG":
      return <>{view.bearing_deg.toFixed(0)}</>;

    case "RNG":
      return <>{view.range_km.toFixed(0)}</>;

    case "ALT":
      return <>{track.altitude_ft.toLocaleString()}</>;

    case "SPD":
      return <>{track.speed_kts}</>;

    case "TTI":
      return <>{view.tti_s === null ? "—" : `${view.tti_s.toFixed(0)}s`}</>;

    case "ID":
      return (
        <span
          className={`chip ${TONE_CLASS[toneOf(config, track.displayed_iff)]}`}
        >
          {track.displayed_iff}
        </span>
      );

    /* The whole point of the column: a code, silence, or the fact that
       nobody has asked yet — never one standing in for another. */
    case "IFF":
      return config.iff.enabled ? (
        <Squawk track={track} config={config} />
      ) : (
        <span className="text-muted" title="This system has no interrogator">
          —
        </span>
      );

    case "MODE 1":
    case "MODE1":
      if (!config.iff.enabled || !config.iff.mode_1) {
        return (
          <span className="text-muted" title="This system does not read Mode 1">
            —
          </span>
        );
      }
      if (!track.squawk_known) {
        return <span className="text-muted" title="Not interrogated">·</span>;
      }
      return track.mode_1 ? (
        <span className="text-ok">{track.mode_1}</span>
      ) : (
        <span className="text-warn">—</span>
      );

    case "PK": {
      const chosen =
        config.interceptors.find((r) => r.name === round) ??
        config.interceptors[0];
      if (!chosen) return <>—</>;
      const flight = timeToIntercept(view.at, track.velocity, chosen.speed_kts);
      if (flight === null) return <span className="text-danger">—</span>;
      const meetsAt = vecToPolar(
        positionOf(track, state.t + flight),
      ).range_km;
      const pk = probabilityOfKill(meetsAt, chosen);
      return (
        <span
          className={pk > 0.7 ? "text-ok" : pk > 0 ? "text-warn" : "text-danger"}
        >
          {(pk * 100).toFixed(0)}
        </span>
      );
    }

    case "FIRE STATUS": {
      if (track.state === "destroyed") return <span className="text-ok">KILL</span>;
      if (track.state === "leaked") return <span className="text-danger">LEAK</span>;
      const inFlight = state.engagements.some(
        (e) => e.target === track.designator && !e.resolved,
      );
      if (inFlight) return <span className="text-warn">IN FLIGHT</span>;
      const spent = state.engagements.some(
        (e) => e.target === track.designator,
      );
      return spent ? <span className="text-muted">MISS</span> : <>—</>;
    }

    default:
      /* Declared by the designer, and nothing in the simulation produces it.
         Said as a dash with a reason rather than left blank, so it reads as
         "no value here" instead of as a value. */
      return (
        <span
          className="text-muted"
          title={
            KNOWN_READOUTS.has(field.trim().toUpperCase())
              ? "No value for this yet"
              : `The simulation holds no figure called “${field}”`
          }
        >
          —
        </span>
      );
  }
}

/**
 * What the transponder said, or the fact that nobody has asked.
 *
 * Three states, and the difference between the last two is the whole point:
 * not interrogated, interrogated and silent, interrogated and answering. A
 * console that showed a blank for both of the first two would be telling the
 * operator that a track refused to reply when in fact nobody asked it.
 */
function Squawk({
  track,
  config,
}: {
  track: RuntimeTrack;
  config: ReturnType<typeof simConfig>;
}) {
  if (!track.squawk_known) {
    return <span className="text-muted" title="Not interrogated">·</span>;
  }

  const mode3 = config.iff.mode_3 ? track.mode_3 : "";
  const mode1 = config.iff.mode_1 ? track.mode_1 : "";
  const reply = describeReply(mode3, mode1);

  if (!reply.replied) {
    return (
      <span className="text-warn" title="Interrogated — nothing came back">
        NO RPLY
      </span>
    );
  }

  const meaning = meaningOfMode3(mode3);
  return (
    <span
      className={meaning ? "text-danger" : "text-ok"}
      title={meaning ?? "Transponder reply"}
    >
      {mode3 || `M1 ${mode1}`}
    </span>
  );
}

function Resources({
  config,
  spent,
  rounds,
  reloading,
  inFlight,
  criteria,
}: {
  config: ReturnType<typeof simConfig>;
  spent: number;
  /** Rounds still in each launcher. */
  rounds: number[];
  /** When each launcher finishes reloading, or null. */
  reloading: (number | null)[];
  inFlight: number;
  criteria: ExerciseInstance["success_criteria"];
}) {
  const left = rounds.reduce((sum, x) => sum + x, 0);
  return (
    <div className="space-y-2 p-3 text-xs">
      <Meter
        label="Rounds"
        value={left}
        total={config.magazine}
        warn={left <= 1}
      />
      {/* Which launcher holds what, once there is more than one to choose
          between — a total of four is a different picture from four on one
          rail and none on the other. */}
      {rounds.length > 1 ? (
        <div className="flex justify-between text-muted">
          <span>By launcher</span>
          <span className="data">
            {rounds
              .map((n, i) => (reloading[i] !== null ? "RLD" : String(n)))
              .join(" · ")}
          </span>
        </div>
      ) : null}
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
  launcher,
  onRound,
  onLauncher,
  onCommand,
  busy,
}: {
  view: TrackView | null;
  config: ReturnType<typeof simConfig>;
  state: SimState;
  round: string;
  launcher: number;
  onRound: (name: string) => void;
  onLauncher: (index: number) => void;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  const lastRefusal = [...state.events]
    .reverse()
    .find((entry) => entry.kind === "refused");

  /* Reload and tilt are about the system, not about a track, and they are
     exactly the things wanted when nothing is selected — a magazine emptied
     on the last engagement is reloaded before the next track is worked, not
     after. So they render either way, and only what needs a track waits for
     one. */
  const system = (
    <>
      {config.commands.tilt.enabled ? (
        <Tilt config={config} state={state} onCommand={onCommand} busy={busy} />
      ) : null}
      {config.commands.reload.enabled ? (
        <Reload config={config} state={state} onCommand={onCommand} busy={busy} />
      ) : null}
    </>
  );

  if (!view) {
    return (
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <p className="text-xs text-muted">
          Select a track — on the scope or in the list — to work it.
        </p>
        {system}
        {lastRefusal ? (
          <p className="w-full text-[0.7rem] text-danger">{lastRefusal.detail}</p>
        ) : null}
      </div>
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
        {/* The squawk belongs on this line rather than only beside the
            button: this is the row an operator's eye lands on once a track is
            locked, and a reading kept somewhere else is a reading nobody
            reads. */}
        <p className="text-[0.7rem] text-muted">
          {track.classification} · {view.range_km.toFixed(0)} km ·{" "}
          {view.bearing_deg.toFixed(0)}° · {track.altitude_ft.toLocaleString()} ft ·{" "}
          {track.speed_kts} kts
          {config.iff.enabled ? (
            <>
              {" · IFF "}
              <Squawk track={track} config={config} />
            </>
          ) : null}
        </p>
        {track.notes ? (
          <p className="mt-1 max-w-xs text-[0.7rem] text-muted">{track.notes}</p>
        ) : null}
      </div>

      {/* ---- Interrogation ------------------------------------- */}
      {config.iff.enabled ? (
        <div>
          <p className="label">IFF</p>
          {/* Only the action here. The code itself reads off the line above,
              and the sentence below says what it means. */}
          <button
            type="button"
            className="btn text-[0.7rem]"
            disabled={busy}
            onClick={() =>
              onCommand({ kind: "interrogate", designator: track.designator })
            }
          >
            {track.squawk_known ? "Interrogate again" : "Interrogate"}
          </button>
          {track.squawk_known ? (
            <p className="mt-1 max-w-xs text-[0.7rem] text-muted">
              {interrogationLine(track, config)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---- What kind of thing it is -------------------------- */}
      {config.commands.retype ? (
        <div>
          <p className="label">Type</p>
          <div className="flex flex-wrap gap-1">
            {config.classes.length === 0 ? (
              <span className="text-[0.7rem] text-muted">
                No classes declared in the profile.
              </span>
            ) : (
              config.classes.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`btn text-[0.7rem] ${
                    track.displayed_classification === name ? "btn-primary" : ""
                  }`}
                  disabled={busy}
                  onClick={() =>
                    onCommand({
                      kind: "retype",
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
      ) : null}

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

      {/* ---- Which launcher ------------------------------------ */}
      {config.commands.launchers > 1 ? (
        <div>
          <p className="label">Launcher</p>
          <div className="flex flex-wrap gap-1">
            {state.launcher_rounds.map((left, index) => {
              const reloading = state.reloading_until[index] !== null;
              return (
                <button
                  key={index}
                  type="button"
                  className={`btn text-[0.7rem] ${index === launcher ? "btn-primary" : ""}`}
                  onClick={() => onLauncher(index)}
                  title={
                    reloading
                      ? "Reloading"
                      : left <= 0
                        ? "Empty"
                        : `${left} round(s) ready`
                  }
                >
                  {index + 1}
                  <span
                    className={`ml-1 ${
                      reloading
                        ? "text-warn"
                        : left <= 0
                          ? "text-danger"
                          : "text-muted"
                    }`}
                  >
                    {reloading ? "RLD" : left}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
              launcher,
            })
          }
        >
          Fire {chosen.name}
        </button>
      </div>

      {system}

      {lastRefusal ? (
        <p className="w-full text-[0.7rem] text-danger">{lastRefusal.detail}</p>
      ) : null}
    </div>
  );
}

/**
 * Refilling a launcher, and what it costs.
 *
 * The countdown is the point of the control: an operator watching "18 s" run
 * down while a track closes is being taught the thing a reload button without
 * a clock would hide. On a single-launcher system this is one button; the
 * declared count decides.
 */
function Reload({
  config,
  state,
  onCommand,
  busy,
}: {
  config: ReturnType<typeof simConfig>;
  state: SimState;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  return (
    <div>
      <p className="label">Reload</p>
      <div className="flex flex-wrap gap-1">
        {state.launcher_rounds.map((left, index) => {
          const until = state.reloading_until[index];
          const remaining = until === null ? null : Math.max(0, until - state.t);
          const committed = state.engagements.some(
            (e) => !e.resolved && e.launcher === index,
          );
          return (
            <button
              key={index}
              type="button"
              className="btn text-[0.7rem]"
              disabled={busy || remaining !== null}
              title={
                committed
                  ? "A round from this launcher is still in the air"
                  : `Takes ${config.commands.reload.seconds} s, and the clock does not stop`
              }
              onClick={() => onCommand({ kind: "reload", launcher: index })}
            >
              {config.commands.launchers > 1 ? `Reload ${index + 1}` : "Reload"}
              {remaining !== null ? (
                <span className="ml-1 text-warn">{remaining.toFixed(0)}s</span>
              ) : (
                <span className="ml-1 text-muted">{left}</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1 max-w-xs text-[0.7rem] text-muted">
        {config.commands.reload.seconds} s, and the clock does not stop.
      </p>
    </div>
  );
}

/**
 * Pointing a fixed array up or down.
 *
 * Shown with what it costs rather than as a bare number: raising the tilt to
 * reach something high drops the low approach off the scope entirely, and a
 * track that is not held cannot be engaged. The count of what is currently
 * held is the honest readout of that trade.
 */
function Tilt({
  config,
  state,
  onCommand,
  busy,
}: {
  config: ReturnType<typeof simConfig>;
  state: SimState;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  const { min_deg, max_deg } = config.commands.tilt;
  const step = Math.max(1, Math.round((max_deg - min_deg) / 10));

  return (
    <div>
      <p className="label">Radar tilt</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn text-[0.7rem]"
          disabled={busy || state.tilt_deg <= min_deg}
          onClick={() =>
            onCommand({ kind: "tilt", to_deg: state.tilt_deg - step })
          }
        >
          ▼
        </button>
        <span className="data w-12 text-center text-[0.7rem]">
          {state.tilt_deg}°
        </span>
        <button
          type="button"
          className="btn text-[0.7rem]"
          disabled={busy || state.tilt_deg >= max_deg}
          onClick={() =>
            onCommand({ kind: "tilt", to_deg: state.tilt_deg + step })
          }
        >
          ▲
        </button>
      </div>
      <p className="mt-1 max-w-xs text-[0.7rem] text-muted">
        {min_deg}°–{max_deg}°. Anything below where it points is not held.
      </p>
    </div>
  );
}

/**
 * The reply in words, because four digits are not self-explanatory.
 *
 * An operator who does not know what 7700 means has to be told, and being told
 * during a run is exactly what a training simulator is for. A code with no
 * standing meaning is left as itself rather than dressed up.
 */
function interrogationLine(
  track: RuntimeTrack,
  config: ReturnType<typeof simConfig>,
): string {
  const mode3 = config.iff.mode_3 ? track.mode_3 : "";
  const mode1 = config.iff.mode_1 ? track.mode_1 : "";
  const reply = describeReply(mode3, mode1);

  if (!reply.replied) {
    return "Nothing came back. It carries no transponder, or is not answering.";
  }

  const meaning = meaningOfMode3(mode3);
  const military = mode1
    ? " Mode 1 replied, so it is a military transponder."
    : "";
  return `${reply.text}.${meaning ? ` ${meaning}.` : ""}${military}`;
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
  // Working the console: worth finding afterwards, not worth shouting now.
  if (kind === "retyped" || kind === "reloaded" || kind === "tilted")
    return "text-accent";
  // An interrogation is a reading, not an outcome: worth finding in the log
  // afterwards, not worth shouting while the run is on.
  if (kind === "interrogated") return "text-accent";
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
