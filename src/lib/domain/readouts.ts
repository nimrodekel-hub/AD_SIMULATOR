import type { TrackReadoutField } from "./schemas";

/**
 * Candidate readout columns, offered as a list to tick rather than typed out.
 *
 * Lives here rather than beside the interview prompts because both sides need
 * it: the designer's form offers these as buttons to tick, and the model is
 * told which ones were ticked. Anything a client component imports drags its
 * whole module into the browser bundle, and the interview module is
 * `server-only` — so a shared constant has to sit somewhere shared.
 *
 * Consoles differ, so this is a starting point and not a constraint: the
 * designer adds their own, renames these, and orders them however their display
 * orders them. Offering the common ones spares them typing the obvious and,
 * more usefully, reminds them of a column they would have forgotten.
 */
export const READOUT_CATALOGUE: TrackReadoutField[] = [
  { label: "TRK", unit: "", description: "Track number or call sign." },
  { label: "ID", unit: "", description: "Identification state." },
  { label: "TYPE", unit: "", description: "What the track is." },
  { label: "AZ", unit: "°", description: "Bearing from the site." },
  { label: "RNG", unit: "km", description: "Range to the track." },
  { label: "ALT", unit: "ft", description: "Altitude." },
  { label: "SPD", unit: "kts", description: "Speed." },
  { label: "TTI", unit: "s", description: "Time to impact." },
  { label: "PK", unit: "%", description: "Probability of kill." },
  {
    label: "FIRE STATUS",
    unit: "",
    description: "How far an engagement against this track has got.",
  },
];
