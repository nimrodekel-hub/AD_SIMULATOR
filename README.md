# Air Defence Training Simulator

A proof of concept for a **generic** operational trainer for air-defence
operators — not tied to any vendor or weapon system.

The idea it exists to test: a domain expert teaches the system real operational
dilemmas by talking through them, and the system then takes a trainee's
free-text request ("I want to practise deciding what to engage first when
everything arrives at once"), matches it to the right captured expertise,
generates a plausible scenario from it, and debriefs the trainee against the
expert's own recorded reasoning.

## Architecture

[`ARCHITECTURE.md`](ARCHITECTURE.md) (Hebrew) is the reference document: what runs
where, how data flows through the system, what is stored on which branch, and why
the design decisions were made.

## How it is put together

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| Hosting | Vercel — rebuilds on every push |
| Storage | JSON files committed to this repository, written through the GitHub API |
| AI | Anthropic API, seven integration points each with its own system prompt |

**Everything lives in git.** Every simulated system — its behaviour profile,
its console template, its screenshots and its dilemmas — plus the trainee
roster and every training run are all JSON files in `data/`. There is no
database to provision and nothing to keep in sync: one storage mechanism, one
place to look, and a permanent inspectable history of both the operational
knowledge and the training that came out of it.

The cost is that a training run makes a few commits and each write takes about a
second. At the scale this is built for that is invisible, and the audit trail is
worth more than the milliseconds.

## Running it locally

```bash
npm install
npm run dev
```

Without an API key the app starts in **mock mode**: every screen works and is
clickable, but AI responses are canned and labelled as such. The home screen
shows the current mode.

Locally, `data/` is written on the filesystem. In production the same code
writes through the GitHub API instead — see below.

## Deploying

1. On [vercel.com](https://vercel.com), **Add New → Project**, and import this
   repository.
2. Add the environment variables below.
3. Deploy. Every later push to `main` rebuilds automatically.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Drives every AI feature. Unset ⇒ mock mode. |
| `GITHUB_TOKEN` | In production | Fine-grained token with `contents: read and write` on this repository. |
| `GITHUB_REPO` | In production | `owner/name`, e.g. `nimrodekel-hub/AD_SIMULATOR`. |
| `GITHUB_BRANCH` | In production | Branch that data is committed to — use `data`. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5`. |
| `AI_MOCK` | No | Set to `1` to force mock mode even with a key. |

Names are case-sensitive. The GitHub variables are **required in production**:
without them the app falls back to the local filesystem, and a serverless
filesystem is read-only — so nothing anyone saved would survive the request that
saved it. The home screen's status board names any that are missing.

Data is written to the `data` branch rather than `main`, so training runs do not
trigger a rebuild of the site.

## The four screens

1. **System Designer** — the list of simulated systems, and inside each one a
   setup sequence: describe how it behaves, build its console from reference
   screenshots, then teach dilemmas through conversation and approve the
   records extracted from them.
2. **Instructor** — trainee roster, scores, trend, and the full history of every
   session and debrief.
3. **Trainee** — pick the system you operate, then request training in plain
   language; the system matches within that system's dilemmas, asks a
   clarifying question if unsure, and generates a scenario.
4. **Debrief** — score, what went wrong and why, and what to practise next.

Screens 1 and 4 are read while thinking, so they use a calm, roomy layout.
Screens 2 and 3 are read under time pressure, so they use a dense
operations-room layout. Both are defined as token sets in `src/app/globals.css`.

## Many systems, side by side

The app holds as many simulated systems as you like, and they are independent.
Each one owns how it behaves, what its console looks like, the screenshots it
was built from, and the dilemmas taught inside it — so a second system can be
started before the first is finished, and neither leaks into the other.

That separation is not tidiness, it is correctness. A dilemma's plausible
numbers, its identification states and the actions it offers only mean anything
inside one system, so a dilemma taught on one is never offered against another.
A trainee therefore picks their system first, and matching only ever searches
that system's approved dilemmas.

The designer names each system when they create it. That name is the fictional
one shown on the console and used in every prompt — the model never invents or
changes it.

## How a system behaves

A dilemma is a judgement call *within* a system, so each system has to be
described before its dilemmas. The designer answers eight guided questions —
what is defended and against what, what track classes exist and what tells them apart, what
identification states there are and what puts a track into each one, what the
operator reads for every track, what the operator may do and in what order, what
the system does by itself, the engagement envelope, and who authorises a shot —
plus an open section for everything the questions did not ask about.

The model turns the answers into a structured **behaviour profile**, and the
designer corrects it field by field before approving it. Nothing else runs on
guesses after that:

- **Scenarios** may only use the classifications and identification states the
  profile declares, inside its speed, altitude and range bands, and may only ask
  a trainee to do something the profile lists as an operator responsibility.
- **Track readouts are the profile's columns.** Tracks carry one readout per
  declared field, in the declared order — so the air picture shows what this
  system's operators actually read, not a fixed set of columns.
- **The console** is generated from the screenshots *and* the profile, so it
  shows the right columns, the right identification colours, and controls for
  the operator's real workflow.
- **The debrief** knows what the operator could have done.

Without this the model invents an air-defence system, and the scenarios look
right without being right — the worst failure mode for a trainer, because nobody
can see it. So a system's console step is blocked until its profile is approved,
and the status board says plainly which systems are ready and which are not.

## The simulated console

The designer uploads two to five screenshots of a real console and the model
reproduces its look and feel as a static HTML shell — layout, palette, density
and typography, but explicitly not identifying content. Where the screenshots
and the behaviour profile disagree, the profile wins: the screenshots show one
moment, the profile describes the system.

The shell is chrome only. It carries five `data-slot` markers, and the trainee
screen renders real React into them through portals. The appearance comes from
the model; the behaviour does not. Scripts, inline handlers and `javascript:`
URLs are stripped before the markup is stored, and a shell missing any slot
cannot be approved.

## Where things live

```
src/
  app/                  routes: pages and API route handlers
  components/           shared UI
  lib/
    ai/
      client.ts         the only module that talks to the Anthropic API
      tasks/            one module per AI task, each with its own system prompt
    domain/schemas.ts   Zod schemas — validation and AI output format in one place
    store/
      repo-files.ts     git as the storage medium: GitHub API or local filesystem
      kb.ts             systems, their profiles, consoles and dilemmas
      sessions.ts       training runs and the trainee roster
    stats.ts            the instructor's numbers, derived from the session log
    config.ts           the only module that reads process.env
data/
  kb/systems/<id>/
    system.json         the system's identity: name, note, when it was created
    profile.json        how it behaves — read by everything downstream
    gui.json            its console template
    screenshots/        the references the console was built from
    dilemmas/           one file per dilemma taught inside this system
  sessions/             one file per training run, recording which system
  trainees.json         the roster (defaults are used until this file exists)
```

Everything about one system sits in its own directory, so listing its dilemmas
is a single directory read rather than a scan of every dilemma in the
repository.

## Build status

| Stage | State |
| --- | --- |
| 1. Skeleton, data model, storage, AI layer | Done |
| 2. Designer — learn a dilemma | Done |
| 3. Trainee — matching and scenario generation | Done |
| 4. Debrief | Done |
| 5. Simulated console builder | Done |
| 6. Instructor board | Done |
| 7. System behaviour profile, and a console built from it | Done |
| 8. Many simulated systems side by side | Done |
