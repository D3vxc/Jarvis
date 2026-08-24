# JARVIS

A browser voice assistant that wakes on a **double clap**, answers in a **voice you
choose and tune**, runs against its **own animated background**, and falls back to
**Claude** for anything its built-in commands do not cover.

```
clap clap  →  microphone wakes  →  speech recognition  →  command router
                                                              ├── local rules  (time, date, launch, voice tuning)
                                                              └── Claude       (everything else, with web search)
                                                                      ↓
                                                              spoken reply
```

## Features

| | |
|---|---|
| **Double-clap wake** | Web Audio transient detector: two short, loud, high-frequency bursts inside an adjustable window. Sensitivity and gap are sliders; a live meter shows input against the trigger threshold. |
| **Selectable, adjustable voice** | Every speech-synthesis voice installed in the browser, plus rate, pitch, and volume sliders — changeable by hand or by saying "speak faster", "louder", "deeper". |
| **Internet aware** | "Only respond while online" keeps Jarvis in standby when the connection drops. Status pills track network, microphone, and the answer engine. |
| **Its own background** | A canvas HUD: rotating arc-reactor rings, perspective grid, drifting particles, radial level bars. Four themes, a motion slider, and optional reactivity to your microphone level. |
| **Claude-powered answers** | Unmatched questions go to `claude-opus-5` through a local proxy, with server-side web search for current facts. The API key stays on the server. |
| **Works degraded** | No key, no server, no microphone, or no speech recognition — it still runs, with a text box and built-in commands. |

## Quick start

```bash
git clone https://github.com/D3vxc/Jarvis.git
cd Jarvis
npm install

cp .env.example .env      # then paste your Anthropic API key into .env
npm start                 # http://localhost:3000
```

Then, in the browser:

1. Click **Enable Microphone** and allow access.
2. **Clap twice.** The chime plays and the core reads `LISTENING`.
3. Ask something — "what time is it", "what's the weather", "who won the last Formula One world championship".
4. Say "go to sleep", or wait, to return to standby.

The API key is optional. Without one the server still serves the app and the
built-in commands work; the answer-engine pill reads *Claude offline* and unknown
questions fall back to a web search.

### Configuration

All settings live in `.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude answers. Get one at [console.anthropic.com](https://console.anthropic.com/). |
| `CLAUDE_MODEL` | `claude-opus-5` | Model used for answers. |
| `ENABLE_WEB_SEARCH` | `true` | Lets Claude search the web before answering. |
| `PORT` | `3000` | Server port. |

Voice, clap, and background choices are stored per browser in `localStorage`.

## Commands

Handled locally, instantly, and offline where possible:

| Say | Result |
|---|---|
| `what time is it` / `what's the date` | Spoken from the system clock. |
| `weather` | Geolocation plus the Open-Meteo API — no key needed. |
| `open youtube` / `open github` / `open example.com` | Opens a new tab. |
| `search for <query>` | Google results in a new tab. |
| `play <song> on youtube` | YouTube results in a new tab. |
| `speak faster` / `slower` / `louder` / `quieter` / `deeper` | Adjusts the voice live and saves it. |
| `go to sleep` | Back to standby. |

**Anything else** goes to Claude and comes back as a spoken answer. The transcript
notes when an answer used web search.

## How the parts fit together

```
server.js                 Express: serves public/, proxies POST /api/ask to Claude
public/js/app.js          Wiring, state machine, transcript, settings panel
public/js/audio.js        Microphone + double-clap detector + wake chime
public/js/recognizer.js   Web Speech API recognition (Chrome/Edge)
public/js/voice.js        Speech synthesis: voice pick, rate, pitch, volume
public/js/brain.js        Command router — local rules first, Claude second
public/js/llm.js          Talks to /api/ask and /api/health
public/js/background.js   Animated canvas backdrop
public/js/settings.js     localStorage persistence
```

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the full command
grammar and the clap-tuning guide are in [`docs/COMMANDS.md`](docs/COMMANDS.md).

## Browser support

| | Clap wake | Speech output | Speech input |
|---|---|---|---|
| Chrome / Edge | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ⚠️ partial |
| Firefox | ✅ | ✅ | ❌ — use the text box |

Microphone access requires `http://localhost` or an HTTPS origin. `npm start`
serves on localhost, so it works out of the box.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Claps do nothing | Threshold too high for your room | Raise **Sensitivity**; the meter's yellow marker is the trigger point |
| It wakes at random | Threshold too low | Lower **Sensitivity**, or shorten the gap window |
| Pill reads *Claude offline* | No `ANTHROPIC_API_KEY`, or the page was opened as a file | Put the key in `.env`, restart, and load via `http://localhost:3000` |
| "The Anthropic API key was rejected" | Bad or expired key | Re-issue it in the Anthropic console |
| No voices in the dropdown | The OS has no speech voices installed | Install system voices, or use Chrome, which ships its own |

## Privacy

The microphone stream is analysed in the browser and never uploaded by this app.
Speech **recognition** is different: Chrome and Edge send audio to Google's servers,
which is why recognition needs an internet connection. When a question reaches the
answer engine, that question text — and the recent turns of the conversation — go to
the Anthropic API. Everything else stays local.
