import "server-only";
import { randomUUID } from "node:crypto";
import {
  GeneralKnowledgeSchema,
  type GeneralKnowledge,
  type Lesson,
} from "../domain/schemas";
import { DATA_PATHS } from "../config";
import { repoFiles } from "./repo-files";

/**
 * The knowledge that sits above every system.
 *
 * One document for the whole app, not one per system: how air defence works in
 * general, and the lessons that keep proving true whichever console you are
 * sitting at. It is handed to the interviewer before any particular system is
 * discussed, so it can follow an expert instead of asking them to explain the
 * field from first principles.
 *
 * It is editable on purpose. The seed below is a starting point written by the
 * model; everything after that is the domain expert's, and a lesson learned in
 * one interview belongs here rather than in one person's memory.
 *
 * What it is not: authority about any particular system. Where it and a
 * system's approved profile disagree, the profile wins. Where it and the expert
 * disagree, the expert wins. The prompt that carries it says so explicitly.
 */

const SEED_BRIEFING = `## What an air-defence system is for

An air-defence system denies airspace over something worth protecting — a site,
a formation, a corridor, an area. Its job is to notice what is coming, work out
what it is, decide whether it is a threat, and stop it before it reaches what is
being defended. Every design is a compromise between how early it can see, how
far out it can reach, and how many things it can handle at once.

## What appears in the air picture

Broadly: fast fixed-wing aircraft; rotary-wing, which is slow and often low;
cruise missiles, which are fast, low and steady; ballistic threats, which arrive
steeply and quickly; and uncrewed aircraft, which range from large and
aircraft-like down to small, slow, low and hard to see, including loitering
munitions that behave like a missile only at the end.

Not everything in the air is a threat. Civil traffic, friendly aircraft,
returning patrols and plain sensor clutter all appear too, and telling them
apart is usually where the difficulty lives.

## The chain from sensor to engagement

Sensors produce returns; returns are correlated into tracks; tracks are
identified; identified tracks are evaluated for threat; a weapon is assigned to
the ones that warrant it; the engagement is carried out; the result is assessed.

Systems differ enormously in which of those steps are automatic and which the
operator performs — and that difference is precisely what to ask about rather
than assume.

## What differs between systems, and must always be asked

These exist in some form everywhere, but the numbers and the answers are never
transferable. Treat every one of them as a question, never as something already
known:

- **How far it detects**, which is not how far it can shoot. Detection range
  sets how much warning the operator gets, and therefore the clock on every
  dilemma about time.
- **How far it can engage**, maximum *and* minimum. Many systems cannot engage
  something too close.
- **How many interceptors may be in the air at once**, and how deep the
  magazine is.
- **Time of flight**, which forces the decision earlier than the moment of
  impact.
- **The altitude envelope**, top and bottom.
- **Sensor coverage**: arcs, horizons and terrain shadows. Low and close is
  often seen late.
- **Who may authorise an engagement**, and what changes that — pressure, loss
  of communications, self-defence.
- **Which steps are automatic** and which the operator performs.`;

/** Lessons that hold across systems. The designer owns this list. */
const SEED_LESSONS: Array<Omit<Lesson, "id">> = [
  {
    title: "Dilemmas come from incomplete information under a clock",
    body: `The recurring shape is not "what is the right answer" but "there is no
time to find out". Identification that will not resolve; more threats than
interceptors; a threat that must be engaged now or not at all; authority that is
unavailable at the moment it is needed. When an expert describes a decision that
was obvious in hindsight, ask what was not known at the time — that is the part
worth training.`,
  },
  {
    title: "Engaging an unknown is often the operator's own call",
    body: `On many systems nothing decides an unresolved track for the operator:
they may engage it or hold, and both are defensible. That makes it one of the
richest dilemmas to simulate, because the trainee has to commit without the
answer and can be asked afterwards why. Worth asking about explicitly rather
than assuming a rule exists.`,
  },
  {
    title: "A visible control is not proof of who decides",
    body: `A button on a screen shows that the system can do a thing. It does not
show that the operator is the one who chooses it, or when. Who decides comes
from asking, never from the display.`,
  },
  {
    title: "The rationale matters more than the answer",
    body: `A captured dilemma whose preferred action is recorded without the
reasoning behind it produces a worthless debrief: the trainee is told they were
wrong and not why. Push for the reasoning, and for the mistakes the expert has
actually watched people make — those two are what a trainee reads afterwards.`,
  },
];

const PATH = DATA_PATHS.generalKnowledge;

/** The seed, materialised. Used when nothing has been saved yet. */
function seed(): GeneralKnowledge {
  return {
    briefing: SEED_BRIEFING,
    lessons: SEED_LESSONS.map((lesson) => ({ ...lesson, id: randomUUID() })),
    updated_at: new Date().toISOString(),
  };
}

/**
 * The stored document, or the seed when there is none.
 *
 * Never writes on read. A first-time reader gets the seed and the file only
 * appears once someone actually edits it, so an unedited install does not
 * accumulate commits it did not ask for.
 */
export async function getGeneralKnowledge(): Promise<GeneralKnowledge> {
  const raw = await repoFiles().read(PATH);
  if (raw === null) return seed();

  const parsed = GeneralKnowledgeSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // A corrupt document must not take the interview down with it. Falling
    // back to the seed keeps every screen working; the designer can re-save.
    console.error("Ignoring malformed general knowledge; using the seed.");
    return seed();
  }
  return parsed.data;
}

export async function saveGeneralKnowledge(
  next: Omit<GeneralKnowledge, "updated_at">,
): Promise<GeneralKnowledge> {
  const document: GeneralKnowledge = {
    ...next,
    // Ids are minted here rather than in the browser, so a lesson added from
    // two tabs cannot end up sharing an id with another.
    lessons: next.lessons.map((lesson) => ({
      ...lesson,
      id: lesson.id || randomUUID(),
    })),
    updated_at: new Date().toISOString(),
  };

  await repoFiles().write(
    PATH,
    `${JSON.stringify(GeneralKnowledgeSchema.parse(document), null, 2)}\n`,
    "Update general air-defence knowledge",
  );
  return document;
}

/**
 * The document as one block of prompt text.
 *
 * Assembled here rather than in the prompt module so that the shape of the
 * stored record and the shape the model reads stay in one place.
 */
export function asPromptSection(knowledge: GeneralKnowledge): string {
  const lessons = knowledge.lessons
    .map((lesson) => `### ${lesson.title}\n\n${lesson.body.trim()}`)
    .join("\n\n");

  return [
    knowledge.briefing.trim(),
    lessons ? `## Lessons that hold across systems\n\n${lessons}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
