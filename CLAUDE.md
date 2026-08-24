# JARVIS — working notes

Clap-activated voice assistant. Two surfaces share one codebase: an Electron
desktop app that runs in the background, and a browser version served by a small
Express server.

## Layout

```
desktop/main.js        Electron main — tray, autostart, hidden window, IPC
desktop/preload.cjs    The renderer's only bridge (context isolation is on)
desktop/settings.js    API keys in the OS app-data dir, chmod 600
desktop/transcribe.js  Optional Deepgram / Whisper speech to text
lib/claude.js          Answer engine — shared by both surfaces
server.js              Express server — browser version only
public/js/audio.js     Microphone + double-clap detector + chime
public/js/app.js       Wiring, state machine, transcript, settings panel
public/js/brain.js     Command router: local rules first, Claude second
public/js/llm.js       Transport — IPC on desktop, fetch in the browser
public/js/background.js  Animated canvas backdrop
```

## Commands

```bash
npm run desktop   # Electron app
npm start         # browser version on http://localhost:3000
npm run dist      # installer for the current OS, into dist/
```

## Decisions worth not re-litigating

- **The API key never reaches the renderer.** That is the entire reason
  `server.js` and the IPC layer exist. `settings.publicView()` returns presence
  flags only — keep it that way.
- **Clap detection runs on a 16 ms interval, not `requestAnimationFrame`.** rAF
  stops in a hidden window, and the desktop app is hidden most of the time. The
  window also sets `backgroundThrottling: false`. Background *animation* keeps
  using rAF on purpose, so it pauses when hidden.
- **A clap must clear three bars at once** (absolute peak, 3.2× the tracked noise
  floor, ≥32% of energy above 2 kHz). Dropping any one of them makes doors,
  keyboards, and speech trigger it.
- **Electron has no usable `SpeechRecognition`** — the constructor exists but
  Chromium ships without Google's credentials, so `recognitionSupported` is
  deliberately false when `window.jarvisDesktop` is present.
- **`max_tokens: 1024`** is intentional: replies are spoken aloud and short by
  design.
- Claude call shape lives in `lib/claude.js`: `claude-opus-5`, adaptive thinking
  at `effort: "low"`, `fallbacks: "default"` with beta
  `server-side-fallback-2026-07-01`, `web_search_20260209` capped at 3 uses, and
  `pause_turn` resumed up to 3 times.

## Verified so far

Browser and desktop both driven end to end under Playwright, against a mock
Anthropic endpoint (no API key was available in the build environment):
page loads clean, local commands answer, unmatched questions route to the answer
engine with history, `searched` flag surfaces in the transcript, settings
round-trip without leaking secrets, hide/wake cycles work, global shortcut
registers, clap detector fires on the interval loop.

## Not yet verified on real hardware

- A real Anthropic API key — every Claude call so far went to a mock.
- Start-at-login (`app.setLoginItemSettings`) reported false on the Linux build
  container; it is a real API on Windows and macOS.
- Speech synthesis voices — the build container has none installed.
- Double-clap tuning against actual room acoustics; the defaults are a starting
  point, and the meter under the reactor is the tuning aid.
- Deepgram / Whisper transcription paths have never run against the live APIs.

## Open ideas

- Wake word as an alternative to clapping.
- Per-command confirmation before opening tabs.
- A packaged, signed release so first launch does not warn.
