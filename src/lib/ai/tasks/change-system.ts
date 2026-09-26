import "server-only";
import { z } from "zod";
import type { SystemProfileDraft } from "../../domain/schemas";
import { EDITABLE_SECTIONS, type ProfileEdit } from "../../domain/profile-edits";
import { structured } from "../client";

/**
 * A designer's request, in their own words, turned into changes to their system.
 *
 * Until this existed, only half of a system could be changed by asking. The
 * console builder takes requests about the screen and is — correctly — not
 * allowed to touch behaviour, so everything else it was asked for came back as
 * "not here: switch this on in the profile". The profile itself had exactly
 * one way in, a form ten sections long. A designer who wrote "civil traffic
 * answers on Mode 3" or "a reload takes twelve seconds" was told where the
 * field was, and the change happened only if someone went and typed it there.
 *
 * This is the one place that can take either kind of request. It does not
 * save anything. It proposes: exact edits to the profile, and a screen
 * instruction for the console builder, which the designer sees as before and
 * after and accepts or throws away.
 */

const CHANGE_SYSTEM = `You are the change agent for one simulated air-defence system. A designer tells you, in their own words, what should be different, and you turn it into exact changes.

## Two things can change

1. **The behaviour record** — the system profile you are given. It is what the simulator runs on: the track classes with their speeds, altitudes and transponders; the identification states; the columns of the track table; IFF interrogation; which operator commands exist and the figures they run on; the radar; the engagement envelope and each interceptor. **You change it with edits.**
2. **The screen** — how the console looks: the size and place of panels, the proportions, colours, fonts, labels, chrome. You do not change it yourself. You write one instruction for the console builder in \`console_request\`, and it rebuilds the screen from the reference screenshots.

Sort every part of the request into one of those, or into \`cannot\`:

- "The scope is too small", "the track table is cut off", "the colours are wrong", "make it look more like the screenshot" — **screen**.
- "Civil traffic answers on Mode 3 only", "the long-range round reaches 100 km", "detection is 180 km" — **behaviour**.
- "Add a reload button; a reload takes 12 seconds" — **behaviour**: \`operator_commands.reload\` and \`reload_seconds\`. The simulator draws its own controls, so a control needs no screen request unless the designer also said where it goes or how it looks.
- "Add an IFF column" — **behaviour** (\`track_readout_fields\`). The simulator fills the track table from those fields; ask the builder for room only if the designer says the table is already cramped.

## Edits

Each edit is \`{ op, path, value_json }\`.

- **path** names one field, with dots. A list of named things is addressed by the name in brackets: \`track_classifications[Jet].transponder\`, \`engagement.interceptors[long range].magazine_max\`, \`track_readout_fields[IFF].description\`. A number in brackets is a position — use a name wherever there is one.
- **op "set"** replaces the value at the path with \`value_json\`: JSON — a number, a string in double quotes, true, false, null, an object or a list.
- **op "add"** appends \`value_json\` to the list at the path. No brackets on the last part. Give the whole new item, with every field the items beside it have.
- **op "remove"** removes the item named in the brackets. \`value_json\` is "".
- **Change what was asked and nothing else.** Never replace a whole section to change one field in it. Every edit is shown to the designer before it is saved, and an edit they did not ask for reads as a mistake.
- Only these top-level fields may be edited: ${EDITABLE_SECTIONS.join(", ")}.
- Text fields in the profile are English. Keep them English, in the register of what is already there.

**Keep the record consistent with itself.** When you change a figure that a note elsewhere also states — \`general_notes\` saying "detection 150 km", \`iff_interrogation.note\` describing who replies — change that note too, as its own edit, so the record never says two things.

## Figures

**Never invent a figure the designer did not give.** Switching on reload needs the seconds it takes; launchers need how many; tilt needs its limits. If the figure is missing, do not make the edit — put one line in \`cannot\` that asks for it: "Reload — how many seconds does one take? Say it and ask again."

## cannot

One short line for each part you did not turn into an edit or a screen request: a figure you need, or something the simulator does not model at all — say that plainly rather than approximating it. Empty when everything was done.

## console_request

The instruction for the console builder, **in English**, specific, as the designer would put it: "Make the radar scope take about two thirds of the width, and narrow the track table to match." Empty when the screen is not involved.

## summary

One sentence, in the language the designer wrote in, saying what will change. They read it before they approve. No preamble, no restating the request.`;

const ProposalSchema = z.object({
  summary: z.string(),
  edits: z.array(
    z.object({
      op: z.enum(["set", "add", "remove"]),
      path: z.string(),
      value_json: z.string(),
    }),
  ),
  console_request: z.string(),
  cannot: z.array(z.string()),
});

export interface ChangeProposal {
  summary: string;
  edits: ProfileEdit[];
  /** English, for the console builder. Empty when the screen is not involved. */
  console_request: string;
  /** One line per part that was not turned into a change. */
  cannot: string[];
}

export async function proposeChange({
  request,
  profile,
  systemName,
  hasConsole,
}: {
  request: string;
  /** The behaviour record only — no id, approval or interview. */
  profile: SystemProfileDraft;
  systemName: string;
  /** Whether there is a console to change at all. */
  hasConsole: boolean;
}): Promise<ChangeProposal> {
  return structured({
    system: CHANGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `The system is "${systemName}".`,
          hasConsole
            ? "It has a simulated console, so screen requests can be passed to the builder."
            : "It has no simulated console yet. A screen request cannot be carried out — say so in `cannot` rather than writing one.",
          `<system_profile>\n${JSON.stringify(profile, null, 2)}\n</system_profile>`,
          `<request>\n${request}\n</request>`,
        ].join("\n\n"),
      },
    ],
    schema: ProposalSchema,
    /* Medium, not high: the work is locating the right field and copying a
       value into it, and a designer is waiting for the answer on screen. */
    effort: "medium",
    label: "system-change",
    mock: () => mockProposal(request, hasConsole),
  });
}

/**
 * A keyless stand-in that still exercises the real path.
 *
 * Lines written as `path = value` become edits, exactly as the model's would,
 * so propose, review and apply can all be tried — and tested — without
 * spending anything. Whatever else was written is treated as a screen request.
 */
function mockProposal(request: string, hasConsole: boolean): ChangeProposal {
  const edits: ProfileEdit[] = [];
  const rest: string[] = [];
  for (const line of request.split("\n")) {
    const match = line.match(/^\s*([a-z_][\w.[\] ]*?)\s*=\s*(.+?)\s*$/i);
    const section = match?.[1].split(/[.[]/)[0].trim();
    if (match && (EDITABLE_SECTIONS as readonly string[]).includes(section ?? "")) {
      edits.push({ op: "set", path: match[1], value_json: match[2] });
    } else if (line.trim()) {
      rest.push(line.trim());
    }
  }
  const screen = rest.join(" ");
  return {
    summary:
      "Mock change — no ANTHROPIC_API_KEY is configured, so lines written as `path = value` are applied as they stand and the rest is passed to the console builder.",
    edits,
    console_request: hasConsole ? screen : "",
    cannot: !hasConsole && screen ? ["There is no console yet, so the screen part cannot be done."] : [],
  };
}
