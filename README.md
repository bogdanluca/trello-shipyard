# Shipyard

A TypeScript agent that watches a list of GitHub repositories for commits that reach `main` or `master`, asks a local model whether the work finishes a Trello card (title and description), and moves matching cards to **Done**. Agent state is stored in a local SQLite file.

Dry run is on by default. The agent records matches without moving cards until you turn that off.

## Local models (LM Studio is optional)

Shipyard talks to any **OpenAI-compatible** server (`/v1/models` and `/v1/chat/completions`). LM Studio is one option. It is not required.

If you are on an **Intel Mac**, skip LM Studio (Apple silicon only) and use one of these:

| Runtime | Typical URL | Notes |
| --- | --- | --- |
| [Ollama](https://ollama.com/) | `http://127.0.0.1:11434/v1` | Best default on Intel Mac, Windows, and Linux. `ollama pull llama3.2:3b` then `ollama serve`. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` | `http://127.0.0.1:8080/v1` | Direct GGUF server. Fastest if you want full control. |
| [Jan](https://jan.ai/) | `http://127.0.0.1:1337/v1` | Desktop app, OpenAI-compatible local API. |
| [GPT4All](https://www.nomic.ai/gpt4all) | app-local | Easy desktop installer; use its local API if you enable it. |
| [LocalAI](https://localai.io/) | `http://127.0.0.1:8080/v1` | Docker-friendly, good on a Linux box. |

On **CPU-only** machines, use a small instruct model (Llama 3.2 1B/3B, Qwen2.5 1.5B/3B, Phi-3 mini). 7B+ is usually too slow without a GPU.

You can also run the model on **another machine** (a Windows/Linux PC with an NVIDIA GPU, or a server) and paste that host’s `/v1` URL into the dashboard.

If no local server is running, Shipyard still polls GitHub and Trello. It falls back to keyword matching (card title, description, and Trello short links in the commit message).

## What it does

1. Polls each configured repo for recent commits on the default branch (`main` / `master`) or a branch you set with `owner/repo:branch`.
2. Skips SHAs already stored in SQLite.
3. Loads open Trello cards that are not already on the Done list.
4. Sends the commit and cards to the configured local model server (`/chat/completions`). If the server is down, uses keyword overlap instead.
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
| Local model | Optional. Ollama, llama.cpp, LM Studio, or any OpenAI-compatible `/v1` URL |

Settings entered in the UI are stored in `data/shipyard.db`. Environment variables in `.env` are used as defaults when a key has not been saved yet.

## Tests

```bash
npm test
```
