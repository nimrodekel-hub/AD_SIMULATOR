"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { pkColour, Squawk } from "@/components/run-track-list";
import { describeReply, meaningOfMode3 } from "@/lib/domain/iff-codes";
import type { ExerciseInstance } from "@/lib/domain/schemas";
import { bandsOf, IDENTITY, type Tone } from "@/lib/ops-palette";
import {
  onLauncher as roundsOnLauncher,
  positionOf,
  probabilityOfKill,
  remainingOf,
  toneOf,
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
 *
 * Drawn as instruments in the ops palette (src/lib/ops-palette.ts): each
 * interceptor band keeps one colour on the selector, the magazine, the scope's
 * envelope ring and the round in flight, so choosing a round and seeing what
 * it reaches and how many are left is one glance. The launch command is red,
 * round and apart from everything else, because it is the one control here
 * whose effect cannot be taken back.
 */

type Config = ReturnType<typeof simConfig>;

/** How long a refusal stays on the panel. Long enough to read, not forever. */
const REFUSAL_SECONDS = 8;

const css = (vars: Record<string, string>) => vars as CSSProperties;

/* ------------------------------------------------------------------ */
/* Magazines                                                           */
/* ------------------------------------------------------------------ */

export function Resources({
  config,
  state,
  reloading,
  inFlight,
  criteria,
}: {
  config: Config;
  state: SimState;
  /** When each launcher finishes reloading, or null. */
  reloading: (number | null)[];
  inFlight: number;
  criteria: ExerciseInstance["success_criteria"];
}) {
  const bands = bandsOf(config.interceptors);
  const spent = state.spent;

  return (
    <div className="ops-root flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {/* A row of rounds per band, because that is what the operator actually
          spends. One pooled counter said four rounds left and hid the fact
          that none of them could reach the high mover — which made choosing
          a round look free and taught nothing. */}
      {config.interceptors.map((round) => {
        const band = bands.get(round.name);
        const left = remainingOf(state, round.name);
        const colour = band?.colour ?? "var(--ops-phosphor)";
        return (
          <div key={round.name}>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="flex min-w-0 items-baseline gap-1.5"
                title={`${round.name}: reaches ${round.min_range_km}–${round.max_range_km} km`}
              >
                <span className="ops-tag" style={css({ "--c": colour })}>
                  {band?.short}
                </span>
                <span className="ops-dim truncate">{round.name}</span>
              </span>
              <span
                className="ops-value"
                style={{ color: left === 0 ? "var(--id-hostile)" : colour }}
              >
                {left}
                <span className="ops-dim">/{round.loaded}</span>
              </span>
            </div>
            <div className="ops-pips mt-1.5" aria-hidden>
              {Array.from({ length: round.loaded }, (_, i) => (
                <span
                  key={i}
                  className="ops-pip"
                  data-spent={i >= left}
                  style={css({ "--c": colour })}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-auto space-y-1.5 border-t border-[var(--ops-line)] pt-2">
        <Row label="In the air">
          <span className="ops-pips" aria-label={`${inFlight} of ${config.max_simultaneous}`}>
            {Array.from({ length: config.max_simultaneous }, (_, i) => (
              <span
                key={i}
                className="ops-pip"
                data-spent={i >= inFlight}
                style={css({ "--c": "var(--ops-phosphor)" })}
              />
            ))}
          </span>
        </Row>
        <Row label="Spent">
          <span
            className="ops-value"
            style={
              spent > criteria.max_interceptors_spent
                ? { color: "var(--id-hostile)" }
                : undefined
            }
          >
            {spent}
            <span className="ops-dim">/{criteria.max_interceptors_spent}</span>
          </span>
        </Row>
        {/* Which launcher holds what, once there is more than one to choose
            between — a total of four is a different picture from four on one
            rail and none on the other. */}
        {config.commands.launchers > 1 ? (
          <Row label="Launchers">
            <span className="ops-value">
              {Array.from({ length: config.commands.launchers }, (_, i) =>
                reloading[i] !== null ? "RLD" : String(roundsOnLauncher(state, i)),
              ).join(" · ")}
            </span>
          </Row>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="ops-label">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Engagement control                                                  */
/* ------------------------------------------------------------------ */

/**
 * What the operator can actually do with the selected track.
 *
 * The order follows the workflow a real console imposes, left to right: read
 * it, ask it, decide what it is, choose a round, read the solution, commit.
 * The solution — time of flight and probability of kill — is shown before the
 * launch rather than after, because deciding whether this is a good shot *is*
 * the skill being trained.
 *
 * Fire is not disabled when there is no solution. Pressing it and being told
 * "inside the minimum range" at that moment is the lesson; a button that went
 * grey would teach only that the button was grey. It is disabled when there
 * is nothing designated, and the panel says so.
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
  config: Config;
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
  const bands = bandsOf(config.interceptors);
  const chosen =
    config.interceptors.find((r) => r.name === round) ?? config.interceptors[0];
  const band = chosen ? bands.get(chosen.name) : undefined;

  const refusal = [...state.events]
    .reverse()
    .find((entry) => entry.kind === "refused");
  const freshRefusal =
    refusal && state.t - refusal.t <= REFUSAL_SECONDS ? refusal : null;

  const track = view?.track ?? null;
  const flight =
    view && chosen ? timeToIntercept(view.at, view.track.velocity, chosen.speed_kts) : null;
  const meetsAt =
    track && flight !== null
      ? vecToPolar(positionOf(track, state.t + flight)).range_km
      : null;
  const pk = meetsAt === null || !chosen ? 0 : probabilityOfKill(meetsAt, chosen);
  const engaged =
    !!track &&
    state.engagements.some((e) => e.target === track.designator && !e.resolved);

  return (
    /* One row of stations, left to right in the order of the work, each a
       label over one line of controls. A shell gives this panel a strip a
       hundred-odd pixels tall; stations that wrapped into a second row put
       half the panel below the fold, so they never wrap — a narrow screen
       scrolls the row sideways instead. */
    <div className="ops-root ops-compact flex h-full min-h-0 flex-col overflow-auto p-2">
      <div className="flex min-h-0 flex-1 flex-nowrap items-stretch">
        {/* ---- What is it ---------------------------------------- */}
        <Station label="Target" wide>
          {view && track ? (
            <Target view={view} config={config} />
          ) : (
            <p className="ops-dim max-w-[14rem]">
              No track designated. Select one on the scope or in the list.
            </p>
          )}
        </Station>

        {track ? (
          <>
            {/* ---- Interrogation --------------------------------- */}
            {config.iff.enabled ? (
              <Station label="IFF">
                <button
                  type="button"
                  className="ops-btn"
                  disabled={busy}
                  onClick={() =>
                    onCommand({ kind: "interrogate", designator: track.designator })
                  }
                >
                  Interrogate
                </button>
                {track.squawk_known ? (
                  <p
                    className="mt-1 max-w-[10rem] truncate text-[10px]"
                    title={interrogationLine(track, config)}
                  >
                    <Squawk track={track} config={config} />
                    <span className="ops-dim"> {interrogationLine(track, config)}</span>
                  </p>
                ) : null}
              </Station>
            ) : null}

            {/* ---- What kind of thing it is ---------------------- */}
            {config.commands.retype ? (
              <Station label="Type">
                <div className="flex gap-1">
                  {config.classes.length === 0 ? (
                    <span className="ops-dim">No classes declared.</span>
                  ) : (
                    config.classes.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="ops-btn"
                        aria-pressed={track.displayed_classification === name}
                        disabled={busy}
                        onClick={() =>
                          onCommand({ kind: "retype", designator: track.designator, to: name })
                        }
                      >
                        {name}
                      </button>
                    ))
                  )}
                </div>
              </Station>
            ) : null}

            {/* ---- Identification -------------------------------- */}
            <Station label="Identification">
              <div className="flex gap-1">
                {Object.keys(config.tones).length === 0 ? (
                  <span className="ops-dim">No states declared.</span>
                ) : (
                  Object.entries(config.tones).map(([name, tone]) => (
                    <button
                      key={name}
                      type="button"
                      className="ops-btn ops-choice"
                      style={css({ "--c": IDENTITY[tone as Tone] })}
                      aria-pressed={track.displayed_iff.toLowerCase() === name}
                      disabled={busy}
                      onClick={() =>
                        onCommand({ kind: "classify", designator: track.designator, to: name })
                      }
                    >
                      {name}
                    </button>
                  ))
                )}
              </div>
            </Station>
          </>
        ) : null}

        {/* ---- The round -------------------------------------------
            Shown with nothing designated too: choosing the round before the
            track is a real habit, and the counts are worth seeing anyway. */}
        <Station label="Interceptor">
          <div className="flex gap-1">
            {config.interceptors.map((option) => {
              const left = remainingOf(state, option.name);
              const own = bands.get(option.name);
              return (
                <button
                  key={option.name}
                  type="button"
                  className="ops-btn ops-choice"
                  style={css({ "--c": own?.colour ?? "var(--ops-phosphor)" })}
                  aria-pressed={option.name === chosen?.name}
                  onClick={() => onRound(option.name)}
                  title={
                    left === 0
                      ? `No ${option.name} rounds left`
                      : `${option.name}: ${left} of ${option.loaded} left · reaches ${option.min_range_km}–${option.max_range_km} km`
                  }
                >
                  <span>{own?.short}</span>
                  <span
                    className="ops-count"
                    style={left === 0 ? { color: "var(--id-hostile)" } : undefined}
                  >
                    {left}
                  </span>
                </button>
              );
            })}
          </div>
        </Station>

        {/* ---- Which launcher ------------------------------------ */}
        {config.commands.launchers > 1 ? (
          <Station label="Launcher">
            <div className="flex gap-1">
              {Array.from({ length: config.commands.launchers }, (_, index) => {
                const left = roundsOnLauncher(state, index);
                const reloading = state.reloading_until[index] !== null;
                return (
                  <button
                    key={index}
                    type="button"
                    className="ops-btn"
                    aria-pressed={index === launcher}
                    onClick={() => onLauncher(index)}
                    title={reloading ? "Reloading" : left <= 0 ? "Empty" : `${left} round(s) ready`}
                  >
                    L{index + 1}
                    <span
                      style={{
                        color: reloading
                          ? "var(--id-suspect)"
                          : left <= 0
                            ? "var(--id-hostile)"
                            : "var(--ops-dim)",
                      }}
                    >
                      {reloading ? "RLD" : left}
                    </span>
                  </button>
                );
              })}
            </div>
          </Station>
        ) : null}

        {/* ---- The firing solution ------------------------------- */}
        {track ? (
          <Station label={`Solution${band ? ` · ${band.short}` : ""}`}>
            <Refusal entry={freshRefusal} />
            {flight === null ? (
              <p className="ops-value" style={{ color: "var(--id-hostile)" }}>
                NO INTERCEPT
                <span className="ops-dim block text-[10px] font-normal normal-case">
                  Cannot be caught with this round
                </span>
              </p>
            ) : (
              <div>
                <div className="flex items-baseline gap-3">
                  <Figure label="TOF" value={`${flight.toFixed(0)}s`} />
                  <Figure label="Meet" value={`${meetsAt?.toFixed(0)} km`} />
                  <span className="flex items-baseline gap-1">
                    <span className="ops-label">Pk</span>
                    <span
                      className="text-[17px] font-bold leading-none"
                      style={{ color: pkColour(pk) }}
                    >
                      {(pk * 100).toFixed(0)}
                      <span className="text-[11px]">%</span>
                    </span>
                  </span>
                </div>
                <span className="ops-bar mt-1.5" style={css({ "--c": pkColour(pk), width: "100%" })}>
                  <span style={{ width: `${pk * 100}%` }} />
                </span>
              </div>
            )}
          </Station>
        ) : null}

        {/* ---- The system: not about any one track --------------- */}
        <Station label="System">
          <div className="flex items-center gap-1">
            {config.commands.tilt.enabled ? (
              <Tilt config={config} state={state} onCommand={onCommand} busy={busy} />
            ) : null}
            {config.commands.reload.enabled ? (
              <Reload config={config} state={state} onCommand={onCommand} busy={busy} />
            ) : null}
            <EndRun onEnd={onEnd} busy={busy} />
          </div>
        </Station>

        {/* ---- Commit -------------------------------------------- */}
        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
          {engaged && track ? (
            <button
              type="button"
              className="ops-btn ops-cease"
              disabled={busy}
              onClick={() => onCommand({ kind: "cease", designator: track.designator })}
            >
              Cease fire
            </button>
          ) : null}
          <button
            type="button"
            className="ops-fire"
            disabled={busy || !track || !chosen}
            onClick={() =>
              track && chosen
                ? onCommand({
                    kind: "engage",
                    designator: track.designator,
                    interceptor: chosen.name,
                    launcher,
                  })
                : undefined
            }
            aria-label={
              track && chosen ? `Fire ${chosen.name} at ${track.designator}` : "Fire — no track designated"
            }
          >
            FIRE
            <small>{band?.short ?? ""}</small>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The last refusal, for a few seconds, under the solution — where the "no"
 * belongs. One line; the full sentence is on the log beside it and in the
 * tooltip here.
 */
function Refusal({ entry }: { entry: { detail: string } | null }) {
  if (!entry) return null;
  return (
    <p
      className="mb-1 max-w-[15rem] truncate text-[10px]"
      style={{ color: "var(--id-hostile)" }}
      title={entry.detail}
      role="alert"
    >
      <span className="ops-tag mr-1" style={css({ "--c": "var(--id-hostile)" })}>
        Refused
      </span>
      {entry.detail.replace(/^Engagement refused:\s*/, "")}
    </p>
  );
}

function Station({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`shrink-0 border-r border-[var(--ops-line)] px-2.5 first:pl-1 ${
        wide ? "min-w-[10rem]" : ""
      }`}
    >
      <p className="ops-label mb-1.5">{label}</p>
      {children}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="ops-label">{label}</span>
      <span className="ops-value">{value}</span>
    </span>
  );
}

/** The designated track, as a card: what it is, where, how high, how fast. */
function Target({ view, config }: { view: TrackView; config: Config }) {
  const track = view.track;
  const tone = toneOf(config, track.displayed_iff) as Tone;
  const colour = IDENTITY[tone];
  return (
    <div title={track.notes || undefined}>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-bold leading-none" style={{ color: colour }}>
          {track.designator}
        </span>
        <span className="ops-tag" style={css({ "--c": colour })}>
          {track.displayed_iff}
        </span>
      </div>
      <div className="mt-1 flex gap-x-2.5 whitespace-nowrap text-[10.5px]">
        <Figure label="Brg" value={`${String(Math.round(view.bearing_deg) % 360).padStart(3, "0")}`} />
        <Figure label="Rng" value={view.range_km.toFixed(1)} />
        <Figure label="FL" value={String(Math.round(track.altitude_ft / 100)).padStart(3, "0")} />
        <Figure label="Kt" value={`${track.speed_kts}`} />
      </div>
      <div className="mt-0.5 flex gap-x-2.5 whitespace-nowrap text-[10.5px]">
        <Figure label="Typ" value={track.displayed_classification} />
        <span className="flex items-baseline gap-1">
          <span className="ops-label">TTI</span>
          <span
            className={`ops-value ${view.tti_s !== null && view.tti_s < 60 ? "ops-urgent" : ""}`}
          >
            {view.tti_s === null ? "—" : `${view.tti_s.toFixed(0)}s`}
          </span>
        </span>
      </div>
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
 * the result is posted when the run ends.
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
      <button
        type="button"
        className="ops-btn"
        disabled={busy}
        onClick={() => setAsked(true)}
        title="Close the run and score what has happened so far"
      >
        End run
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="ops-btn"
        style={{ borderColor: "var(--id-hostile)", color: "var(--id-hostile)" }}
        disabled={busy}
        onClick={onEnd}
        title="Everything so far is scored, including anything still inbound"
      >
        End it now
      </button>
      <button type="button" className="ops-btn" disabled={busy} onClick={() => setAsked(false)}>
        Keep going
      </button>
    </span>
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
  config: Config;
  state: SimState;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  return (
    <>
      {Array.from({ length: config.commands.launchers }, (_, index) => {
        const left = roundsOnLauncher(state, index);
        const until = state.reloading_until[index];
        const remaining = until === null ? null : Math.max(0, until - state.t);
        const committed = state.engagements.some((e) => !e.resolved && e.launcher === index);
        return (
          <button
            key={index}
            type="button"
            className="ops-btn"
            disabled={busy || remaining !== null}
            title={
              committed
                ? "A round from this launcher is still in the air"
                : `Takes ${config.commands.reload.seconds} s, and the clock does not stop`
            }
            onClick={() => onCommand({ kind: "reload", launcher: index })}
          >
            {config.commands.launchers > 1 ? `Reload L${index + 1}` : "Reload"}
            {remaining !== null ? (
              <span style={{ color: "var(--id-suspect)" }}>{remaining.toFixed(0)}s</span>
            ) : (
              <span className="ops-dim">{left}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

/**
 * Pointing a fixed array up or down.
 *
 * Shown with what it costs rather than as a bare number: raising the tilt to
 * reach something high drops the low approach off the scope entirely, and a
 * track that is not held cannot be engaged.
 */
function Tilt({
  config,
  state,
  onCommand,
  busy,
}: {
  config: Config;
  state: SimState;
  onCommand: (cmd: Command) => void;
  busy: boolean;
}) {
  const { min_deg, max_deg } = config.commands.tilt;
  const step = Math.max(1, Math.round((max_deg - min_deg) / 10));

  return (
    <span
      className="flex items-center gap-1"
      title={`${min_deg}°–${max_deg}°. Anything below where it points is not held.`}
    >
      <span className="ops-label">Tilt</span>
      <button
        type="button"
        className="ops-btn"
        aria-label="Tilt down"
        disabled={busy || state.tilt_deg <= min_deg}
        onClick={() => onCommand({ kind: "tilt", to_deg: state.tilt_deg - step })}
      >
        ▼
      </button>
      <span className="ops-value w-9 text-center">{state.tilt_deg}°</span>
      <button
        type="button"
        className="ops-btn"
        aria-label="Tilt up"
        disabled={busy || state.tilt_deg >= max_deg}
        onClick={() => onCommand({ kind: "tilt", to_deg: state.tilt_deg + step })}
      >
        ▲
      </button>
    </span>
  );
}

/**
 * The reply in words, because four digits are not self-explanatory.
 *
 * An operator who does not know what 7700 means has to be told, and being told
 * during a run is exactly what a training simulator is for. A code with no
 * standing meaning is left as itself rather than dressed up.
 */
function interrogationLine(track: RuntimeTrack, config: Config): string {
  const mode3 = config.iff.mode_3 ? track.mode_3 : "";
  const mode1 = config.iff.mode_1 ? track.mode_1 : "";
  const reply = describeReply(mode3, mode1);

  if (!reply.replied) {
    return "nothing came back. It carries no transponder, or is not answering.";
  }

  const meaning = meaningOfMode3(mode3);
  if (meaning) return `${meaning}.`;
  return mode1
    ? "Mode 1 replied, so it is a military transponder."
    : "Mode 3 only — a code, not an identity.";
}

/* ------------------------------------------------------------------ */
/* The log                                                             */
/* ------------------------------------------------------------------ */

/** What each kind of event is called on the log, and the colour it speaks in. */
const KINDS: Record<string, { tag: string; colour: string }> = {
  detected: { tag: "DET", colour: "var(--ops-phosphor)" },
  resolved: { tag: "RES", colour: "var(--id-unknown)" },
  classified: { tag: "ID", colour: "var(--ops-phosphor)" },
  retyped: { tag: "TYP", colour: "var(--ops-phosphor)" },
  interrogated: { tag: "IFF", colour: "var(--id-friend)" },
  launched: { tag: "LNCH", colour: "var(--band-1)" },
  refused: { tag: "REF", colour: "var(--id-hostile)" },
  hit: { tag: "KILL", colour: "var(--kill)" },
  miss: { tag: "MISS", colour: "var(--id-suspect)" },
  leaked: { tag: "LEAK", colour: "var(--id-hostile)" },
  ceased: { tag: "CEASE", colour: "var(--id-suspect)" },
  reloaded: { tag: "RLD", colour: "var(--ops-dim)" },
  tilted: { tag: "TILT", colour: "var(--ops-dim)" },
  ended: { tag: "END", colour: "var(--ops-dim)" },
};

/** The running record, newest first — what a real console prints as it goes. */
export function EventLog({ state }: { state: SimState }) {
  const recent = [...state.events].reverse().slice(0, 40);
  return (
    <ul className="ops-root ops-log">
      {recent.map((entry, index) => {
        const kind = KINDS[entry.kind] ?? { tag: entry.kind.toUpperCase(), colour: "var(--ops-dim)" };
        /* The outcomes are worth reading at a glance; working the console is
           worth finding afterwards, not shouting now. */
        const loud = ["hit", "leaked", "refused", "miss"].includes(entry.kind);
        return (
          <li key={index}>
            <time>T+{String(Math.floor(entry.t)).padStart(3, "0")}</time>
            <span className="ops-tag" style={css({ "--c": kind.colour })}>
              {kind.tag}
            </span>
            <span style={{ color: loud ? kind.colour : "var(--ops-ink)" }}>{entry.detail}</span>
          </li>
        );
      })}
      {recent.length === 0 ? (
        <li>
          <span className="ops-dim" style={{ gridColumn: "1 / -1" }}>
            No activity yet.
          </span>
        </li>
      ) : null}
    </ul>
  );
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
