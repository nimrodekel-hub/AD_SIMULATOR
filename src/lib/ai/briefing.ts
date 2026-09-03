import "server-only";
import type { SystemProfile } from "../domain/schemas";

/**
 * What the interviewer is told before it starts asking.
 *
 * Two separate things, and the difference between them is the whole point:
 *
 *   1. `generalBriefing()` — orientation that holds across systems, edited by
 *      the designer on the general-knowledge screen. What an air-defence system
 *      is for, what flies, how the chain from sensor to engagement runs, what
 *      differs between systems and must always be asked, and the lessons that
 *      keep proving true. Identical for every system in the app.
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
 * The editable general knowledge, wrapped in the rules that make it safe.
 *
 * The prose in the middle is the designer's and changes whenever they edit it.
 * The framing around it is not editable, and must not be: it is what keeps
 * general knowledge from being mistaken for fact about a particular system. An
 * expert improving their doctrine should never be able to accidentally delete
 * the sentence that stops the model inventing.
 */
export function generalBriefing(body: string): string {
  return `# Background: how air defence works in general

This section is orientation, so that you can ask an expert sharper questions and
understand their answers. It is **not** a description of the system being
discussed, and the rules at the end of this section bind you absolutely.

${body.trim()}

---

## How you must use this section

**It tells you nothing about the system under discussion.** It is vocabulary and
shape, so you can follow the expert and ask better questions.

- **Never state any of it as a fact about this system.** Not the target types,
  not the ranges, not how many interceptors can be in the air, not the workflow.
  Every number differs between systems.
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
}

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
states, their readouts and their real actions when you ask about a scenario.

If something here looks wrong or contradicts what they tell you, say so plainly
and let them correct it; the profile can be edited.

<system_profile>
${JSON.stringify(behaviour, null, 2)}
</system_profile>`;
}
