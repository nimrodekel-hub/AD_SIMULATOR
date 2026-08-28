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
| Hosting | Vercel — deploys on every push |
| Knowledge base | JSON files committed to this repository, written via the GitHub API |
| Session log | libSQL (SQLite) — a local file in development, Turso in production |
| AI | Anthropic API, five separate task modules each with its own system prompt |

**Why the knowledge base is in git and the sessions are not.** Dilemmas are
authored content that a domain expert cares about keeping: a commit per approval
gives a reviewable history of how the operational knowledge evolved, and the
files stay hand-editable if extraction ever misreads an expert. Session logs are
high-churn operational records, which belong in a database.

**Why Turso rather than a SQLite file.** Serverless functions have no writable
disk, so a file-based database would silently lose every write. Turso is the same
SQLite engine over the network; the schema and queries are unchanged.

## Running it locally

```bash
npm install
npm run dev
```

Without an API key the app starts in **mock mode**: every screen works and is
clickable, but AI responses are canned and labelled as such. The home screen
shows the current mode.

### Environment variables

Create `.env.local` in the project root.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Drives every AI feature. Unset ⇒ mock mode. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5`. |
| `AI_MOCK` | No | Set to `1` to force mock mode even with a key. |
| `GITHUB_TOKEN` | In production | Fine-grained token with `contents: read and write` on this repository. |
| `GITHUB_REPO` | In production | `owner/name`, e.g. `nimrodekel-hub/ad_simulator`. |
| `GITHUB_BRANCH` | No | Branch the knowledge base is committed to. |
| `TURSO_DATABASE_URL` | In production | Unset ⇒ local file at `data/local.db`. |
| `TURSO_AUTH_TOKEN` | In production | Turso database token. |

The GitHub variables are **required in production**: without them the app falls
back to the local filesystem, and on Vercel that filesystem is read-only, so
nothing a designer saved would survive.

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
    store/              knowledge base (git) and session log (libSQL)
    config.ts           the only module that reads process.env
data/kb/                the knowledge base, committed
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
