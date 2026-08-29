import "server-only";
import type { SystemProfile } from "../domain/schemas";

/**
 * What the interviewer is told before it starts asking.
 *
 * Two separate things, and the difference between them is the whole point:
 *
 *   1. `AIR_DEFENCE_BRIEFING` — generic orientation. The shape of the field:
 *      what an air-defence system is for, what flies, how the chain from
 *      sensor to engagement generally runs, and the constraints every weapon
 *      system has. Constant for every system and every conversation.
 *   2. `describeSystem()` — this system, from its approved profile. Authoritative,
 *      because the designer wrote it and approved it.
 *
 * Both go to the **interview only**. The extraction call — the one that
 * produces the record actually stored in the knowledge base — still sees
 * nothing but the transcript. That separation is deliberate and load-bearing:
 * background may shape the questions asked, and must never become an answer
 * the expert did not give. An interviewer that knows the vocabulary asks
 * sharper questions; an extractor that knows the vocabulary fills gaps with it.
 *
 * Both are placed in the cached prefix. The briefing is identical across every
 * system so it is paid for once and read back at a fraction of the price; the
 * profile is per-system and cached per-system.
 */

/**
 * Generic background. Deliberately the sort of thing written in an open
 * textbook — no doctrine belonging to any force, no performance figures, and
 * nothing specific enough to substitute for what an expert would tell you.
 */
export const AIR_DEFENCE_BRIEFING = `# Background: how air defence works in general

This section is orientation, so that you can ask an expert sharper questions
and understand their answers. It is **not** a description of the system being
discussed, and the rules at the end of this section bind you absolutely.

## What an air-defence system is for

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
operator performs — and that difference is precisely what you must ask about
rather than assume.

## Constraints every system has, in some form

- **A reach**: a maximum range, and a minimum below which it cannot engage.
- **An altitude envelope**, top and bottom.
- **Time of flight**: an interceptor takes time to arrive, so a decision has to
  be made earlier than the moment of impact.
- **Capacity**: a limited number of engagements at once, and a limited magazine.
- **Coverage**: sensors have arcs, horizons and terrain shadows; low and close
  is often seen late.
- **Authority**: someone is permitted to authorise an engagement, and that
  someone can change under pressure, on loss of communications, or in
  self-defence.

## Where operator dilemmas usually come from

Identification that will not resolve in the time available. More threats than
interceptors. A threat that must be engaged now or not at all. Authority that is
unavailable at the moment it is needed. The common thread is that the operator
must act on incomplete information under a clock — which is what makes it worth
training and worth capturing.

---

## How you must use this section

**It tells you nothing about the system under discussion.** It is vocabulary and
shape, so you can follow the expert and ask better questions.

- **Never state any of it as a fact about this system.** Not the target types,
  not the constraints, not the workflow.
- **Never let it answer a question for the expert.** If you need to know
  something, ask. An assumption that goes unchallenged becomes a false record.
- **Never record anything from here.** Your transcript is the sole source for
  the structured record built afterwards, so anything you assert in the
  conversation can end up in the knowledge base as though the expert said it.
- **Where this and the expert disagree, the expert is right**, without argument.
  Real systems routinely violate the general case, and that violation is usually
  the interesting part.

Use it to ask "you mentioned identification is unresolved — is that the sensor,
the IFF, or the time?" rather than "how does identification work?".`;

/**
 * The system under discussion, as the designer described and approved it.
 *
 * Unlike the briefing above this *is* authoritative: it is the designer's own
 * account of their system, reviewed and approved by them before it was stored.
 * The interviewer may rely on it, and should — every question it makes
 * unnecessary is a question the expert does not have to answer twice.
 */
export function describeSystem(
  systemName: string,
  profile: SystemProfile | null,
): string {
  if (!profile?.approved) {
    return `# The system under discussion

It is called "${systemName}". Its behaviour profile has not been approved yet,
so you know nothing else about it — ask about anything you need, and do not
assume it resembles the general case described above.`;
  }

  // Provenance and timestamps say nothing about behaviour, and would push the
  // useful part further down a prompt the model has to read on every turn.
  const {
    id,
    approved,
    source_answers,
    created_at,
    approved_at,
    ...behaviour
  } = profile;
  void id;
  void approved;
  void source_answers;
  void created_at;
  void approved_at;

  return `# The system under discussion

It is called "${systemName}", and the designer has already described how it
behaves. The record below is theirs and they approved it, so treat it as fact
about this system and rely on it.

**Do not ask about anything answered here.** Asking an expert to repeat what
they have already written is the fastest way to lose their patience and their
time. Use it instead to make your questions specific — name their identification
states, their readouts and their real actions when you ask about a dilemma.

If something here looks wrong or contradicts what they tell you, say so plainly
and let them correct it; the profile can be edited.

<system_profile>
${JSON.stringify(behaviour, null, 2)}
</system_profile>`;
}
