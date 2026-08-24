# The desktop app

The browser version needs a tab open at `localhost`. The desktop app does not:
it starts with your computer, sits in the tray with no window, and keeps
listening. Clap twice and it appears.

There is **no HTTP server and no port** in this mode — the window loads from
disk and questions go to Claude directly from the app's main process. "Connection
refused" is not a failure this version can have.

## Install

### Option A — download an installer (no terminal)

1. Open the repository's **Actions** tab on GitHub.
2. Choose **Build desktop apps** → **Run workflow**.
3. When it finishes, download the artifact for your system:
   `jarvis-windows` (`.exe`), `jarvis-macos` (`.dmg`), or `jarvis-linux`
   (`.AppImage` / `.deb`).
4. Run the installer.

The builds are unsigned, so the first launch shows a warning: on Windows click
**More info → Run anyway**; on macOS right-click the app and choose **Open**.

### Option B — run from source

```bash
npm install
npm run desktop
```

To build an installer locally, `npm run dist` — it produces one for the system
you are on, in `dist/`.

## First run

The window opens with an **Assistant Setup** panel at the top of the right-hand
column.

1. Paste your Anthropic API key and click **Save Setup**. It is stored in the
   app's own data directory with owner-only permissions, and never reaches the
   page — the renderer can ask *whether* a key exists, not what it is.
2. Leave **Start Jarvis when I log in** ticked.
3. Allow microphone access when asked.

Close the window. Jarvis keeps running in the tray.

## Using it

| Action | Result |
|---|---|
| **Clap twice** | The window appears and Jarvis listens |
| **Ctrl+Alt+J** (**⌘+Alt+J** on macOS) | Same, without clapping |
| **Click the tray icon** | Show or hide the window |
| Say "go to sleep" | The window hides; clap listening continues |
| Close the window | Same as hiding — it does not quit |
| Tray → **Quit** | Actually exits |

The tray menu also toggles clap listening and start-at-login.

## Speech to text

This is the one place the desktop app is weaker than the browser version, and it
is worth understanding before you pick a version.

`SpeechRecognition` in Chrome and Edge is a Google service, and the credentials
for it are not part of the Chromium that Electron ships. So the desktop app
cannot use it. Two options:

- **Leave it off** (the default). Waking opens the window with the text box
  focused; you type the command. Clap wake, spoken replies, and everything else
  work normally.
- **Add a transcription provider.** In **Assistant Setup**, pick Deepgram or
  OpenAI Whisper and paste that provider's key. After a wake, Jarvis records six
  seconds of audio, sends it to that provider, and runs the transcript as a
  command.

Adding a provider means your spoken commands go to that company, on top of the
question text that already goes to Anthropic. That is your call to make, which is
why nothing is configured by default.

## Staying awake in the background

A hidden Chromium window normally has its timers throttled to once a second,
which would leave the clap detector effectively deaf. Two things prevent that:

- `backgroundThrottling: false` on the window.
- The detector runs on a 16 ms interval rather than `requestAnimationFrame`,
  which stops entirely when a window is not being drawn.

The background *animation* still uses `requestAnimationFrame`, so it pauses while
hidden — no CPU spent drawing rings nobody can see.

A power-save blocker is held while listening is on, so the OS does not suspend
the process. Expect a small but real idle cost: the app holds the microphone
open and analyses roughly 60 frames a second.

## What the app can reach

- Microphone: granted. Every other permission the page could request is denied.
- Links from commands like "open youtube" open in your normal browser, never
  inside the assistant window.
- The renderer runs with context isolation on and no Node access. It talks to the
  app through a fixed list of channels defined in `desktop/preload.cjs`.

## Where things are stored

| What | Where |
|---|---|
| API keys, model, provider choice | `settings.json` in the app's user-data directory |
| Voice, clap, background preferences | The window's `localStorage` |

The user-data directory is `%APPDATA%\JARVIS` on Windows,
`~/Library/Application Support/JARVIS` on macOS, and `~/.config/JARVIS` on Linux.
Deleting it resets the app to a clean first run.

## Always-on microphone

While listening is on, the microphone is open continuously. Audio is analysed in
memory for the clap pattern and is never recorded, stored, or sent anywhere —
the only audio that leaves the machine is the six-second clip *after* a wake, and
only if you configured a transcription provider. If you would rather it not
listen at all times, untick **Listen for claps** in the tray menu and use
Ctrl+Alt+J to wake it instead.
