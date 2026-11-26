# Session Ledger

Turns the Claude Code transcripts already sitting on your machine into one
searchable, self-contained page: what you worked on, what it cost, which files
you actually changed, and every word of every conversation.

No dependencies, no network, no API key. Nothing is uploaded and no transcript
is modified — the scanner only reads.

## Use it

```sh
node bin/cchistory.js            # builds dist/index.html
node bin/cchistory.js --serve    # serves it with a working Refresh button
node bin/cchistory.js --stats    # same numbers, printed to the terminal
```

Then open `dist/index.html`, or visit the URL `--serve` prints. Type `/` to jump
to the search box.

### Refreshing

A built file is a snapshot — rebuild it to update. `--serve` is the live option:
it renders the page on request and exposes `/api/sessions`, so the **Refresh**
button in the masthead (or pressing `r`) rescans every transcript and updates
the page in place, no reload. The button only appears when the server is behind
the page; a saved or published copy has nothing to ask and doesn't show it.

The server binds to `127.0.0.1` only. The page carries the full text of every
conversation on this machine, so it must not be reachable from the network.

| Flag | |
|---|---|
| `-o, --out <file>` | write the page somewhere else |
| `-s, --stats` | print a summary instead of building the page |
| `-p, --project <name>` | limit to one project |
| `--json <file>` | also dump parsed sessions as JSON |
| `--serve` | serve the page locally with live refresh |
| `--port <n>` | port for `--serve` (default 4300) |
| `--root <dir>` | read transcripts from somewhere other than `~/.claude/projects` |

## What it reads

Claude Code appends one JSONL line per event to
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The scanner streams those
files and pulls out:

- **Prompts and replies** — user turns (minus injected system reminders) and
  assistant text, kept for full-text search.
- **Token usage** — priced per model per turn, including the 5-minute and
  1-hour cache-write tiers and cache reads.
- **Tool calls** — counts by name, plus `file_path` from every `Edit`, `Write`
  and `Read`, which is how the file table works even in folders that aren't git
  repositories.
- **Timing** — gaps over 5 minutes are treated as "away", so *active time* is
  time at the keyboard rather than wall-clock session length.

## Costs are estimates

Rates live in [`src/pricing.js`](src/pricing.js) as USD per million tokens, with
cache reads at 0.1x input, 5-minute cache writes at 1.25x and 1-hour writes at
2x. Sonnet 5's introductory rate is applied to turns before 2026-09-01, and fast
mode is billed at its Opus premium. Turns from unrecognised models cost 0 rather
than a guessed rate, so a total is a floor, not a bill. Subscription usage isn't
billed per token at all — read these as "what this would have cost on the API".

## Layout

```
bin/cchistory.js   CLI
src/scan.js        JSONL -> session records (streaming)
src/aggregate.js   rollups for the terminal summary
src/pricing.js     model rates and cache multipliers
src/render.js      injects the data into the page
src/serve.js       loopback server behind the Refresh button
src/template.html  the page itself
```

`template.html` is written as a body fragment so the same file works opened
directly in a browser and published as an Artifact.
