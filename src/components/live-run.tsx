"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadarScope, rangeScales } from "@/components/radar-scope";
import { RangeControl } from "@/components/range-control";
import { SimulatedConsole } from "@/components/simulated-console";
import { Brief } from "@/components/run-brief";
import { Controls, EventLog, Failed, Resources } from "@/components/run-controls";
import { Clock, TrackList } from "@/components/run-track-list";
import type {
  DifficultyLevel,
  ExerciseInstance,
  SystemProfile,
} from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import {
  command,
  createSim,
  end,
  remainingOf,
  simConfig,
  step,
  summarise,
  viewOf,
  type Command,
  type SimState,
} from "@/lib/sim/engine";
import { seededRandom } from "@/lib/sim/geometry";

/**
 * Screen 3: flying the engagement.
 *
 * This is the part the whole knowledge base exists to feed. A trainee is not
 * asked what they would do — they sit in front of the picture and do it, while
 * tracks close at their real speeds and the clock does not stop. Everything
 * they get wrong is something they did, at a time, with the information that
 * was on the screen at that moment, and the debrief has all of it.
 *
 * This file owns exactly three things: the tick, which track is selected, and
 * how a run ends. Every rule — what can be seen, what can be fired at, what a
 * round does when it arrives — lives in `lib/sim/engine`, which knows nothing
 * about React. That separation is what makes the rules testable, and it is why
 * the refusal messages are worth reading: they come from the same code that
 * enforces them.
 *
 * The pieces the console is made of live beside it: `run-brief`,
 * `run-track-list`, `run-controls`. They were in here, and this file reached
 * 48 KB — which matters because this repository is written through an API that
 * takes whole files rather than diffs, so a four-line change moved all of it.
 */

/** Simulated seconds per real second. One, because time pressure is the point. */
const RATE = 1;
/** How often the world advances. Smooth enough to read, cheap enough to run. */
const TICK_MS = 100;

type Stage = "brief" | "running" | "submitting" | "failed";

export function LiveRun({
  runId,
  exercise,
  difficulty,
  profile,
  templateHtml,
  notices = [],
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
   * What the generator had to override to fit the system, in its own words.
   *
   * Read before the clock starts, because that is when it changes what the
   * trainee is looking for. A request the profile made impossible — asking
   * for transponder codes on a system that declares none — otherwise arrives
   * as an air picture that quietly lacks what was asked for, which is
   * indistinguishable from not having been read.
   */
  notices?: string[];
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
        if (!response.ok) throw new Error(payload.error ?? "Saving the run failed.");
        /* On to the result, whether or not the written assessment came back.
           The trainee has just finished flying and the tally is in; holding
           them on the console because a model call failed is how a completed
           run — every hostile destroyed — was reported to them as unfinished.
           The debrief page shows what the engine counted either way, and asks
           for the assessment again from there. */
        router.push(`/trainee/${runId}/debrief`);
      } catch (reason) {
        /* Only reached when the run itself could not be recorded. That is the
           one failure worth stopping for, because it is the part that cannot
           be reconstructed — so the state is kept in hand and offered again. */
        setError(
          reason instanceof Error ? reason.message : "Saving the run failed.",
        );
        submitted.current = false;
        finished.current = final;
        setStage("failed");
      }
    },
    [config, onFinish, router, runId, exercise.success_criteria],
  );

  /**
   * Ending the run because the operator said so.
   *
   * The third way out, and the one that was missing. A run ended when the
   * window expired or when the sky emptied, and nothing else — so on an
   * exercise whose window is ten minutes, a trainee who had finished with it
   * could only close the tab, which recorded nothing at all. The engine
   * already has `end`; it simply had nobody to call it.
   */
  const stop = useCallback(() => {
    setState((current) => {
      if (current.over) return current;
      const done = end(current, "Ended by the operator.");
      finished.current = done;
      return done;
    });
  }, []);

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
     inside the interval would fire it several times before the state settled.
     It is also how `stop` reaches the debrief — the operator ends the run, and
     the run being over is what posts it. */
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
        notices={notices}
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

  /* Three places, three sets of chrome around it. Into the shell's own range
     bar, which already draws the caption and reserves the height; into our own
     header, which does neither; or over the corner of the picture, below. */
  const rangeInShell = (
    <RangeControl
      scales={scales}
      value={rangeKm}
      onChange={setRangeKm}
      variant="slot"
    />
  );
  const rangeInHeader = (
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
            variant="overlay"
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
      state={state}
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
      onEnd={stop}
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
            range: rangeInShell,
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
          {config.interceptors.reduce(
            (sum, round) => sum + remainingOf(state, round.name),
            0,
          )}{" "}
          ROUNDS
        </span>
        {rangeInHeader}
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
