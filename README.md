# Air Defence Training Simulator

A proof of concept for a **generic** operational trainer for air-defence
operators — not tied to any vendor or weapon system.

The idea it exists to test: a domain expert teaches the system real operational
dilemmas by talking through them, and the system then takes a trainee's
free-text request ("I want to practise deciding what to engage first when
everything arrives at once"), matches it to the right captured expertise,
generates a plausible scenario from it, and debriefs the trainee against the
expert's own recorded reasoning.

## How it is put together

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| Hosting | Vercel — rebuilds on every push |
| Storage | JSON files committed to this repository, written through the GitHub API |
| AI | Anthropic API, five integration points each with its own system prompt |

**Everything lives in git.** Dilemmas, the simulated-console template, the
trainee roster and every training run are all JSON files in `data/`. There is no
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
2. Set **Production Branch** to `claude/air-defense-simulator-bwmstp`.
3. Add the environment variables below.
4. Deploy. Every later push rebuilds automatically.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Drives every AI feature. Unset ⇒ mock mode. |
| `GITHUB_TOKEN` | In production | Fine-grained token with `contents: read and write` on this repository. |
| `GITHUB_REPO` | In production | `owner/name`, e.g. `nimrodekel-hub/ad_simulator`. |
| `GITHUB_BRANCH` | In production | Branch that data is committed to. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5`. |
| `AI_MOCK` | No | Set to `1` to force mock mode even with a key. |

The GitHub variables are **required in production**. Without them the app falls
back to the local filesystem, and a serverless filesystem is read-only — so
nothing anyone saved would survive the request that saved it.

## The four screens

1. **System Designer** — teach a dilemma through conversation, review the
   structured record extracted from it, correct it, approve it. Also builds the
   simulated console from reference screenshots.
2. **Instructor** — trainee roster, scores, trend, and the full history of every
   session and debrief.
3. **Trainee** — request training in plain language; the system matches, asks a
   clarifying question if unsure, and generates a scenario.
4. **Debrief** — score, what went wrong and why, and what to practise next.

Screens 1 and 4 are read while thinking, so they use a calm, roomy layout.
Screens 2 and 3 are read under time pressure, so they use a dense
operations-room layout. Both are defined as token sets in `src/app/globals.css`.

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
      kb.ts             dilemmas and the console template
      sessions.ts       training runs and the trainee roster
    config.ts           the only module that reads process.env
data/
  kb/                   the knowledge base
  sessions/             one file per training run
  trainees.json         the roster (defaults are used until this file exists)
```

## Build status

| Stage | State |
| --- | --- |
| 1. Skeleton, data model, storage, AI layer | Done |
| 2. Designer — learn a dilemma | Done |
| 3. Trainee — matching and scenario generation | Done |
| 4. Debrief | Done |
| 5. Simulated console builder | Not started |
| 6. Instructor board | Not started |
