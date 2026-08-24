/**
 * Jarvis desktop app.
 *
 * Runs in the background with no window and no HTTP server: it starts with the
 * OS, sits in the tray, and keeps the clap detector listening. A double clap
 * (or the global shortcut) brings the window forward; going to sleep hides it
 * again. Questions reach Claude directly from this process, so the API key
 * never enters the renderer and there is no localhost port to refuse a
 * connection.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  shell,
} from "electron";
import { Store } from "./settings.js";
import { transcribe, transcriptionAvailable } from "./transcribe.js";
import { createAnswerEngine, describeError, DEFAULT_MODEL } from "../lib/claude.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const store = new Store(app.getPath("userData"));

let win = null;
let tray = null;
let blockerId = null;
let listening = store.get("listenOnLaunch");
let quitting = false;

const ask = createAnswerEngine({
  getKey: () => store.get("apiKey"),
  getModel: () => store.get("model") || DEFAULT_MODEL,
  getWebSearch: () => Boolean(store.get("webSearch")),
});

/* ----------------------------------------------------------------- window */

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#03060c",
    title: "JARVIS",
    icon: path.join(root, "build", "icon.png"),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Without this Chromium throttles timers in a hidden window down to once
      // a second, which would stop the clap detector the moment Jarvis hides.
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(root, "public", "index.html"));

  // The renderer only ever asks for the microphone; nothing else is granted.
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === "media" || permission === "audioCapture");
  });

  // Links open in the real browser, never inside the assistant window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Closing the window is "get out of my way", not "quit".
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideWindow();
  });

  win.on("ready-to-show", () => {
    win.webContents.send("jarvis:listening", listening);
  });
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function hideWindow() {
  if (!win) return;
  win.hide();
}

/* ------------------------------------------------------------------- tray */

function trayIcon() {
  const file = path.join(root, "build", "trayTemplate.png");
  const image = nativeImage.createFromPath(file);
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("JARVIS");
  refreshTray();
  tray.on("click", () => (win?.isVisible() ? hideWindow() : showWindow()));
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win?.isVisible() ? "Hide Jarvis" : "Show Jarvis", click: () => (win?.isVisible() ? hideWindow() : showWindow()) },
      { label: "Wake now", accelerator: "CommandOrControl+Alt+J", click: () => wake("tray") },
      { type: "separator" },
      {
        label: "Listen for claps",
        type: "checkbox",
        checked: listening,
        click: (item) => setListening(item.checked),
      },
      {
        label: "Start at login",
        type: "checkbox",
        checked: Boolean(store.get("autoStart")),
        click: (item) => setAutoStart(item.checked),
      },
      { type: "separator" },
      { label: "Settings…", click: () => { showWindow(); win?.webContents.send("jarvis:open-settings"); } },
      { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.setToolTip(listening ? "JARVIS — listening for claps" : "JARVIS — paused");
}

/* ------------------------------------------------------------ app control */

function setListening(next) {
  listening = next;
  win?.webContents.send("jarvis:listening", listening);

  // Stop the OS suspending the process while it is supposed to be listening.
  if (listening && blockerId === null) {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!listening && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
  refreshTray();
}

function setAutoStart(next) {
  store.update({ autoStart: next });
  app.setLoginItemSettings({
    openAtLogin: next,
    openAsHidden: true,
    args: ["--hidden"],
  });
  refreshTray();
}

function wake(source) {
  showWindow();
  win?.webContents.send("jarvis:wake", source);
}

/* -------------------------------------------------------------------- IPC */

ipcMain.handle("jarvis:health", () => ({
  llm: Boolean(store.get("apiKey")),
  model: store.get("apiKey") ? store.get("model") : null,
  webSearch: Boolean(store.get("apiKey") && store.get("webSearch")),
  transcription: transcriptionAvailable(store) ? store.get("transcribeProvider") : null,
  desktop: true,
}));

ipcMain.handle("jarvis:ask", async (event, { message, history }) => {
  try {
    return await ask(String(message || ""), history);
  } catch (error) {
    const described = describeError(error);
    if (described.code === "server_error") console.error("ask failed:", error);
    return { error: described.code, message: described.message };
  }
});

ipcMain.handle("jarvis:transcribe", async (event, buffer) => {
  try {
    return { text: await transcribe(store, Buffer.from(buffer)) };
  } catch (error) {
    return { error: error.code || "transcribe_failed", message: error.message };
  }
});

ipcMain.handle("jarvis:settings", (event, patch) => {
  if (patch) {
    store.update(patch);
    if ("autoStart" in patch) setAutoStart(patch.autoStart);
  }
  return store.publicView();
});

ipcMain.on("jarvis:hide", hideWindow);
ipcMain.on("jarvis:show", showWindow);

// The renderer heard a double clap while hidden — bring the window forward.
ipcMain.on("jarvis:clap-wake", () => showWindow());

/* ----------------------------------------------------------------- launch */

// A second launch should surface the running assistant, not start a rival one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    createWindow();
    buildTray();
    setListening(listening);
    setAutoStart(Boolean(store.get("autoStart")));

    globalShortcut.register("CommandOrControl+Alt+J", () => wake("shortcut"));

    // Launched by the OS at login, or with no key yet: stay out of the way
    // unless there is something the user still has to do.
    const hidden = process.argv.includes("--hidden");
    if (!hidden || !store.get("apiKey")) showWindow();

    app.on("activate", () => showWindow());
  });

  app.on("window-all-closed", (event) => {
    // Background assistant: closing the window must not end the process.
    event?.preventDefault?.();
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
}
