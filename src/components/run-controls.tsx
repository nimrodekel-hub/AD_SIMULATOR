"use client";

import { useState } from "react";
import { Squawk } from "@/components/run-track-list";
import { describeReply, meaningOfMode3 } from "@/lib/domain/iff-codes";
import type { ExerciseInstance } from "@/lib/domain/schemas";
import {
  onLauncher as roundsOnLauncher,
  positionOf,
  probabilityOfKill,
  remainingOf,
  type Command,
  type RuntimeTrack,
  type SimState,
  type TrackView,
  type simConfig,
} from "@/lib/sim/engine";
import { timeToIntercept, vecToPolar } from "@/lib/sim/geometry";

/**
 * Everything the operator can press, and the running record beside it.
 *
 * Split out of `live-run.tsx`, which had grown to 48 KB — and every touch of
 * it moved all 48 KB, because this repository is written through an API that
 * takes whole files rather than diffs.
 */

export function Resources({
  config,
  state,
  reloading,
  inFlight,
  criteria,
}: {
  config: ReturnType<typeof simConfig>;
  state: SimState;
  /** When each launcher finishes reloading, or null. */
  reloading: (number | null)[];
  inFlight: number;
  criteria: ExerciseInstance["success_criteria"];
}) {
  const spent = state.spent;
  const left = config.interceptors.reduce(
    (sum, round) => sum + remainingOf(state, round.name),
    0,
  );

  return (
    <div className="space-y-2 p-3 text-xs">
      {/* A meter per round, because that is what the operator actually
          spends. One pooled counter said four rounds left and hid the fact
          that none of them could reach the high mover — which made choosing
          a round look free and taught nothing. */}
      {config.interceptors.map((round) => {
        const remaining = remainingOf(state, round.name);
        return (
          <Meter
            key={round.name}
            label={round.name}
            value={remaining}
            total={round.loaded}
            warn={remaining === 0}
          />
        );
      })}

      {config.interceptors.length > 1 ? (
        <div className="flex justify-between text-muted">
          <span>All rounds</span>
          <span className={`data ${left === 0 ? "text-danger" : ""}`}>
            {left} / {config.magazine}
          </span>
        </div>
      ) : null}

      {/* Which launcher holds what, once there is more than one to choose
          between — a total of four is a different picture from four on one
          rail and none on the other. */}
      {config.commands.launchers > 1 ? (
        <div className="flex justify-between text-muted">
          <span>By launcher</span>
          <span className="data">
            {Array.from({ length: config.commands.launchers }, (_, i) =>
              reloading[i] !== null ? "RLD" : String(roundsOnLauncher(state, i)),
            ).join(" · ")}
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
export function Controls({
  view,
  config,
  state,
  round,
  launcher,
  onRound,
  onLauncher,
  onCommand,
  onEnd,
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
  /** Closes the run on what has happened so far. See `EndRun`. */
  onEnd: () => void;
  busy: boolean;
}) {
  const lastRefusal = [...state.events]
    .reverse()
    .find((entry) => entry.kind === "refused");

  /* Reload and tilt are about the system, not about a track, and they are
     exactly the things wanted when nothing is selected — a magazine emptied
     on the last engagement is reloaded before the next track is worked, not
     after. So they render either way, and only what needs a track waits for
     one. Ending the run belongs to the same group and for the same reason:
     it is never about the track under the cursor. */
  const system = (
    <>
      {config.commands.tilt.enabled ? (
        <Tilt config={config} state={state} onCommand={onCommand} busy={busy} />
      ) : null}
      {config.commands.reload.enabled ? (
        <Reload config={config} state={state} onCommand={onCommand} busy={busy} />
      ) : null}
      <EndRun onEnd={onEnd} busy={busy} />
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
          {/* Each round carries its own count on its own button. Choosing a
              round is only a decision if what it costs is visible at the
              moment of choosing — a pooled total two panels away is not. */}
          {config.interceptors.map((option) => {
            const left = remainingOf(state, option.name);
            return (
              <button
                key={option.name}
                type="button"
                className={`btn text-[0.7rem] ${option.name === chosen.name ? "btn-primary" : ""}`}
                onClick={() => onRound(option.name)}
                title={
                  left === 0
                    ? `No ${option.name} rounds left`
                    : `${left} of ${option.loaded} left · reaches ${option.min_range_km}–${option.max_range_km} km`
                }
              >
                {option.name}
                <span
                  className={`ml-1 ${left === 0 ? "text-danger" : "text-ok"}`}
                >
                  {left}
                </span>
                <span className="ml-1 text-muted">
                  {option.min_range_km}–{option.max_range_km}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Which launcher ------------------------------------ */}
      {config.commands.launchers > 1 ? (
        <div>
          <p className="label">Launcher</p>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: config.commands.launchers }, (_, index) => {
              const left = roundsOnLauncher(state, index);
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
 * Stopping the run on purpose.
 *
 * The reason this had to exist: a run ended in exactly two ways, when the
 * window expired or when the sky emptied, and the generator places the last
 * arrival at nine tenths of a window it clamps to as much as ten minutes. A
 * trainee who had seen what they came to see, or who simply had to stop, had
 * no way to finish — and leaving the page recorded *nothing at all*, because
 * the result is posted when the run ends. Six of the nine runs on the live
 * branch are in that state: created, flown into, and holding an empty log.
 *
 * So this closes the run where it stands and scores what happened. It is not
 * an escape hatch from a bad result — everything up to the moment of pressing
 * it counts, including the hostiles still inbound, which is exactly what
 * stopping early means.
 *
 * Two presses, because one press would be a misclick that ends an engagement
 * irreversibly, and a browser `confirm()` in the middle of a live run stops
 * the clock the run is supposed to be teaching.
 */
function EndRun({ onEnd, busy }: { onEnd: () => void; busy: boolean }) {
  const [asked, setAsked] = useState(false);

  if (!asked) {
    return (
      <div>
        <p className="label">Run</p>
        <button
          type="button"
          className="btn text-[0.7rem]"
          disabled={busy}
          onClick={() => setAsked(true)}
          title="Close the run and score what has happened so far"
        >
          End run
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="label">End the run?</p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="btn btn-primary text-[0.7rem]"
          disabled={busy}
          onClick={onEnd}
        >
          End it now
        </button>
        <button
          type="button"
          className="btn text-[0.7rem]"
          disabled={busy}
          onClick={() => setAsked(false)}
        >
          Keep going
        </button>
      </div>
      <p className="mt-1 max-w-xs text-[0.7rem] text-muted">
        Everything so far is scored, including anything still inbound.
      </p>
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
        {Array.from({ length: config.commands.launchers }, (_, index) => {
          const left = roundsOnLauncher(state, index);
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
export function EventLog({ state }: { state: SimState }) {
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

export function Failed({
  error,
  onRetry,
}: {
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-danger bg-panel-raised p-4">
      <p className="text-sm text-danger">{error}</p>
      <p className="mt-1 text-xs text-muted">
        {/* This panel now means what it says. It used to appear when only the
            written assessment had failed — the run was safely recorded and the
            trainee was told so while being kept off their own result page. It
            appears only when the run could not be saved, which is the one thing
            here that cannot be recovered by asking again later. */}
        Nothing has been saved yet, so this is worth another go before you
        leave the page.
      </p>
      <button type="button" className="btn mt-3" onClick={onRetry}>
        Save the run again
      </button>
    </div>
  );
}
