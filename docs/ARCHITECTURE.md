# Architecture

Two processes: a small Node server, and the page it serves. Nothing else — no
build step, no bundler, no framework.

## Request paths

```
Browser                                   Server                     Anthropic
───────                                   ──────                     ─────────
clap clap ──► audio.js detects onsets
                    │
                    ▼
              app.js wake()
                    │
                    ├─ no internet? stay in standby
                    ▼
           recognizer.js (Chrome/Edge → Google speech service)
                    │  transcript
                    ▼
              brain.js router
                    │
        ┌───────────┴───────────┐
        │                       │
   local rule              no rule matched
        │                       │
        │                  llm.js POST /api/ask ──►  server.js  ──► POST /v1/messages
        │                                                 │           (claude-opus-5,
        │                                                 │            web_search tool)
        │                       ◄─────────────────────────┘
        ▼                       ▼
              voice.js speechSynthesis.speak()
```

## The clap detector

`public/js/audio.js` runs an `AnalyserNode` at `fftSize` 1024 with smoothing
disabled, sampling every animation frame. A clap has to clear three bars at once:

1. **Absolute peak** — above the threshold derived from the sensitivity slider
   (`0.08 + (1 - sensitivity) * 0.42`).
2. **Relative peak** — more than 3.2× the tracked noise floor, so the detector
   adapts to a loud room instead of firing constantly in one.
3. **Spectral shape** — at least 32% of the frame's energy above 2 kHz. This is
   what separates a clap from a door thud or a raised voice.

An onset that passes all three starts a 120 ms refractory period. A second onset
inside the configured gap (default 700 ms) is a double clap and fires the wake.

The noise floor rises slowly (2% per frame) and falls fast (25% per frame), so a
sustained noise raises the bar while a brief one does not. While Jarvis is
speaking the detector is muted, so it cannot trigger on its own output.

## State machine

`app.js` owns four states, shown in the reactor core:

| State | Entered when | Leaves on |
|---|---|---|
| `STANDBY` | Start, sleep command, or timeout | Double clap or manual wake |
| `LISTENING` | Wake accepted | Transcript received, or 12 s of silence |
| `PROCESSING` | Command dispatched | Reply ready |
| `SPEAKING` | Synthesis started | Utterance ends |

Wake is refused while offline if *Only respond while online* is set — recognition,
search, and the answer engine all need the network, so a wake would be a dead end.

## The server

`server.js` exists for one reason: an API key in front-end JavaScript is readable
by anyone who opens dev tools. It serves `public/` and exposes two endpoints.

`GET /api/health` → `{ llm, model, webSearch }`. The page calls this on load and
whenever the connection returns, and sets the answer-engine pill from it.

`POST /api/ask` → `{ message, history }` in, `{ reply, model, searched, usage }` out.

- The system prompt constrains replies for the ear: a few sentences, plain prose,
  no markdown, no URLs — a synthesiser reading a bullet list aloud is unpleasant.
- `max_tokens` is 1024. Spoken answers are short by design; this is the rare case
  where a small ceiling is correct rather than a truncation risk.
- Thinking is adaptive (the default on Opus 5) at `effort: "low"`, which keeps the
  round trip conversational.
- The `web_search_20260209` server tool is declared when `ENABLE_WEB_SEARCH` is on,
  capped at three uses per answer. When it runs, the response is flagged `searched`
  and the transcript says so.
- `fallbacks: "default"` means a request declined by a safety classifier is re-run
  server-side on a suitable model instead of returning a refusal.
- `stop_reason: "pause_turn"` — the server-tool loop hitting its internal iteration
  cap — is resumed by re-sending the turn unchanged, up to three times.
- History is capped at 12 turns and 2000 characters per turn; requests are limited
  to 20 per minute per IP.

## Failure behaviour

Every dependency is optional, and each one degrades to something usable:

| Missing | Result |
|---|---|
| API key | Health reports `llm: false`; unknown questions fall back to a web search |
| Server (page opened as a file) | Health fetch fails silently; same fallback |
| Microphone permission | Clap wake off; the *Wake Manually* button and text box still work |
| Speech recognition (Firefox) | Wake still works; the hint directs you to the text box |
| Speech synthesis voices | Replies still appear in the transcript |
| Network | Standby, with the reason in the transcript |
