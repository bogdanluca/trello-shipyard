# Shipyard

A TypeScript agent that watches a list of GitHub repositories for commits that reach `main` or `master`, asks a local LM Studio model whether the work finishes a Trello card (title and description), and moves matching cards to **Done**. Agent state is stored in a local SQLite file.

Dry run is on by default. The agent records matches without moving cards until you turn that off.

## Do you need LM Studio?

Only if you want the local-LLM matcher.

1. Install [LM Studio](https://lmstudio.ai/) on the same machine that will run this agent.
2. Download a model and load it.
3. Start **Developer → Local Server** (OpenAI-compatible, usually `http://127.0.0.1:1234/v1`).

If LM Studio is not running, Shipyard still polls GitHub and Trello. It falls back to keyword matching (card title, description, and Trello short links in the commit message).

You do **not** need to download LM Studio just to open the dashboard, save tokens, or try a dry-run poll.

## What it does

1. Polls each configured repo for recent commits on the default branch (`main` / `master`) or a branch you set with `owner/repo:branch`.
2. Skips SHAs already stored in SQLite.
3. Loads open Trello cards that are not already on the Done list.
4. Sends the commit and cards to LM Studio (`/chat/completions`). If the server is down, uses keyword overlap instead.
5. Moves matches above the confidence floor to the Done list, unless dry run is enabled.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The dashboard listens on [http://127.0.0.1:48731](http://127.0.0.1:48731). Paste a GitHub token, Trello key/token/board id, and repos, then click **Save settings** and **Run now**.

Standalone poller (same SQLite file):

```bash
npx tsx src/scripts/agent.ts --once
npx tsx src/scripts/agent.ts
```

## Credentials

| Service | What you need |
| --- | --- |
| GitHub | Fine-grained or classic PAT with read access to the listed repositories |
| Trello | [API key and token](https://trello.com/power-ups/admin) plus the board id from the board URL |
| LM Studio | Local server running, optional model id |

Settings entered in the UI are stored in `data/shipyard.db`. Environment variables in `.env` are used as defaults when a key has not been saved yet.

## Tests

```bash
npm test
```
