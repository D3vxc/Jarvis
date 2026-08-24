import { loadSettings, saveSettings } from "./settings.js";
import {
  speechSupported,
  initVoices,
  suggestVoiceURI,
  setVoiceOptions,
  getVoiceOptions,
  speak,
  cancelSpeech,
} from "./voice.js";
import { ClapListener } from "./audio.js";
import { Recognizer, recognitionSupported } from "./recognizer.js";
import { handleCommand } from "./brain.js";
import {
  checkLLM,
  askLLM,
  llmReady,
  llmInfo,
  isDesktop,
  transcribe,
  transcriptionReady,
} from "./llm.js";
import { Background } from "./background.js";

const el = (id) => document.getElementById(id);

const netDot = el("netDot");
const netText = el("netText");
const micDot = el("micDot");
const micText = el("micText");
const llmDot = el("llmDot");
const llmText = el("llmText");
const reactor = el("reactor");
const reactorState = el("reactorState");
const hint = el("hint");
const levelFill = el("levelFill");
const levelThreshold = el("levelThreshold");
const listenBtn = el("listenBtn");
const wakeBtn = el("wakeBtn");
const stopBtn = el("stopBtn");
const textForm = el("textForm");
const textInput = el("textInput");
const transcript = el("transcript");
const transcriptEmpty = el("transcriptEmpty");
const errorBanner = el("errorBanner");
const clapCount = el("clapCount");
const voiceSelect = el("voiceSelect");
const themeSelect = el("themeSelect");

const controls = {
  rate: el("rate"),
  pitch: el("pitch"),
  volume: el("volume"),
  sensitivity: el("sensitivity"),
  gap: el("gap"),
  motion: el("motion"),
};
const outputs = {
  rate: el("rateOut"),
  pitch: el("pitchOut"),
  volume: el("volumeOut"),
  sensitivity: el("sensOut"),
  gap: el("gapOut"),
  motion: el("motionOut"),
};
const toggles = {
  requireOnline: el("requireOnline"),
  chimeOnWake: el("chimeOnWake"),
  reactive: el("reactive"),
};

const settings = loadSettings();
const background = new Background(el("bgCanvas"));

let awake = false;
let speaking = false;
let claps = 0;
let history = [];

const desktop = window.jarvisDesktop || null;
let sleepTimer = 0;
let errorTimer = 0;

/* ---------------------------------------------------------------- helpers */

function isOnline() {
  return navigator.onLine;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add("is-visible");
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => errorBanner.classList.remove("is-visible"), 6000);
}

function log(text, kind) {
  if (transcriptEmpty.isConnected) transcriptEmpty.remove();
  const line = document.createElement("div");
  line.className = `line line--${kind}`;
  line.textContent = text;
  transcript.appendChild(line);
  transcript.scrollTop = transcript.scrollHeight;
}

function setState(state, hintText) {
  reactorState.textContent = state;
  reactor.classList.toggle("is-awake", awake);
  reactor.classList.toggle("is-speaking", speaking);
  background.setState({ awake, speaking });
  if (hintText) hint.textContent = hintText;
}

function updateNetworkPill() {
  const online = isOnline();
  netDot.className = `dot ${online ? "dot--ok" : "dot--bad"}`;
  netText.textContent = online ? "Online" : "Offline — standby";
  return online;
}

function setLlmPill() {
  const info = llmInfo();
  llmDot.className = `dot ${info.llm ? "dot--ok" : "dot--warn"}`;
  llmText.textContent = info.llm
    ? `Claude: ${info.model}${info.webSearch ? " + web search" : ""}`
    : desktop
      ? "No API key — add one in Assistant Setup"
      : "Claude offline — built-in replies only";
}

function setMicPill(text, kind) {
  micDot.className = `dot${kind ? ` dot--${kind}` : ""}`;
  micText.textContent = text;
}

function persist() {
  saveSettings(settings);
}

/* ------------------------------------------------------------------ voice */

function applyVoiceSettings() {
  setVoiceOptions({
    voiceURI: settings.voiceURI,
    rate: settings.rate,
    pitch: settings.pitch,
    volume: settings.volume,
  });
}

/** Nudges a voice parameter by `patch` deltas and returns the new rate. */
function adjustVoice(patch) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  if (patch.rate) settings.rate = clamp(settings.rate + patch.rate, 0.5, 2);
  if (patch.pitch) settings.pitch = clamp(settings.pitch + patch.pitch, 0, 2);
  if (patch.volume) settings.volume = clamp(settings.volume + patch.volume, 0, 1);
  applyVoiceSettings();
  syncSliders();
  persist();
  return settings.rate;
}

async function say(text) {
  log(text, "bot");
  speaking = true;
  listener.setMuted(true);
  setState("SPEAKING");
  await speak(text);
  speaking = false;
  listener.setMuted(false);
  setState(awake ? "LISTENING" : "STANDBY");
}

/* ------------------------------------------------------- wake / sleep flow */

function goToSleep(silent) {
  clearTimeout(sleepTimer);
  awake = false;
  recognizer?.stop();
  listener.stopRecording?.();
  // On the desktop the window is a wake-up surface, not a place to live.
  if (desktop && !silent) desktop.hide();
  setState("STANDBY", "Clap twice to wake me, or press the button below.");
  if (!silent) setMicPill("Listening for claps", "ok");
}

function wake(source) {
  if (speaking) cancelSpeech();

  if (settings.requireOnline && !isOnline()) {
    log(`Wake ignored (${source}) — no internet connection.`, "sys");
    showError("Jarvis is set to respond only while online. Reconnect to wake it.");
    say("I am offline right now. Reconnect me and clap again.");
    return;
  }

  awake = true;
  log(`Wake trigger: ${source}`, "sys");
  if (settings.chimeOnWake) listener.chime();
  setState("LISTENING", "I am listening — say a command.");

  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    if (awake) {
      log("No command heard — back to standby.", "sys");
      goToSleep();
    }
  }, 12000);

  if (recognitionSupported && isOnline()) {
    recognizer.start();
  } else if (desktop && transcriptionReady()) {
    listenByRecording();
  } else {
    hint.textContent = desktop
      ? "Speech to text is off — type your command, or add a provider in Assistant Setup."
      : recognitionSupported
        ? "Speech recognition needs internet — type your command instead."
        : "This browser has no speech recognition — type your command instead.";
    textInput.focus();
  }
}

/**
 * Desktop path: Electron has no SpeechRecognition, so the utterance is
 * recorded and sent to the configured transcription provider instead.
 */
async function listenByRecording() {
  if (!listener.enabled) {
    hint.textContent = "Microphone is off — enable it, or type your command.";
    textInput.focus();
    return;
  }

  hint.textContent = "Listening — speak now.";
  try {
    const audio = await listener.record(6000);
    hint.textContent = "Transcribing...";
    const text = await transcribe(audio);
    if (text) {
      runCommand(text);
    } else {
      log("Nothing was transcribed.", "sys");
      goToSleep();
    }
  } catch (error) {
    showError(`Could not transcribe: ${error.message}`);
    textInput.focus();
  }
}

async function runCommand(text) {
  clearTimeout(sleepTimer);
  log(text, "user");
  setState("PROCESSING", "Working on it...");

  try {
    const result = await handleCommand(text, {
      adjustVoice,
      online: isOnline(),
      llmReady: llmReady(),
      askLLM: (question) => askLLM(question, history),
    });

    if (result.source === "claude") {
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: result.reply });
      history = history.slice(-12);
      if (result.searched) log("Claude searched the web for this answer.", "sys");
    }

    await say(result.reply);
    if (result.sleep) {
      history = [];
      goToSleep();
    } else {
      awake = true;
      setState("LISTENING", "Still listening — say another command.");
      if (recognitionSupported && isOnline()) recognizer.start();
      sleepTimer = setTimeout(() => awake && goToSleep(), 12000);
    }
  } catch (error) {
    showError(`Command failed: ${error.message}`);
    await say("Something went wrong handling that.");
    goToSleep();
  }
}

/* -------------------------------------------------------------- listeners */

const listener = new ClapListener({
  onClap: () => {
    claps += 1;
    clapCount.textContent = String(claps);
  },
  onDoubleClap: () => {
    desktop?.clapWake();
    wake("double clap");
  },
  onLevel: (level) => {
    background.setLevel(level);
    levelFill.style.width = `${Math.min(level * 100, 100)}%`;
  },
  onError: (error) => showError(error.message),
});

const recognizer = new Recognizer({
  onInterim: (text) => {
    hint.textContent = `"${text}"`;
  },
  onResult: (text) => runCommand(text),
  onEnd: () => {
    if (awake && !speaking) hint.textContent = "I am listening — say a command.";
  },
  onError: (code) => {
    if (code === "no-speech") return;
    if (code === "not-allowed") {
      showError("Microphone access was blocked, so speech input is unavailable.");
      return;
    }
    if (code === "network") {
      showError("Speech recognition lost its network connection.");
      return;
    }
    showError(`Speech recognition error: ${code}`);
  },
});

/* ------------------------------------------------------------ microphone */

async function armMicrophone() {
  if (listener.enabled) return true;

  listenBtn.disabled = true;
  try {
    await listener.start();
    listener.sensitivity = settings.sensitivity;
    listener.gapMs = settings.gap;
    listenBtn.textContent = "Disable Microphone";
    listenBtn.classList.remove("btn--primary");
    setMicPill("Listening for claps", "ok");
    log("Microphone armed — clap twice to wake Jarvis.", "sys");
    return true;
  } catch (error) {
    setMicPill("Microphone blocked", "bad");
    showError(`Microphone unavailable: ${error.message}`);
    return false;
  } finally {
    listenBtn.disabled = false;
  }
}

function disarmMicrophone() {
  listener.stop();
  listenBtn.textContent = "Enable Microphone";
  listenBtn.classList.add("btn--primary");
  setMicPill("Microphone idle");
  goToSleep(true);
}

/* --------------------------------------------------------------- controls */

function syncSliders() {
  controls.rate.value = settings.rate;
  controls.pitch.value = settings.pitch;
  controls.volume.value = settings.volume;
  controls.sensitivity.value = settings.sensitivity;
  controls.gap.value = settings.gap;
  controls.motion.value = settings.motion;

  outputs.rate.textContent = Number(settings.rate).toFixed(2);
  outputs.pitch.textContent = Number(settings.pitch).toFixed(2);
  outputs.volume.textContent = Number(settings.volume).toFixed(2);
  outputs.sensitivity.textContent = Number(settings.sensitivity).toFixed(2);
  outputs.gap.textContent = `${settings.gap} ms`;
  outputs.motion.textContent = Number(settings.motion).toFixed(2);

  levelThreshold.style.left = `${Math.min(listener.peakThreshold * 100, 100)}%`;
}

function bindSlider(key, transform = Number) {
  controls[key].addEventListener("input", () => {
    settings[key] = transform(controls[key].value);
    if (key === "sensitivity") listener.sensitivity = settings.sensitivity;
    if (key === "gap") listener.gapMs = settings.gap;
    if (key === "motion") background.setMotion(settings.motion);
    applyVoiceSettings();
    syncSliders();
    persist();
  });
}

function bindToggle(key, onChange) {
  toggles[key].checked = settings[key];
  toggles[key].addEventListener("change", () => {
    settings[key] = toggles[key].checked;
    if (onChange) onChange(settings[key]);
    persist();
  });
}

function populateVoices(list) {
  voiceSelect.innerHTML = "";

  if (!list.length) {
    const option = document.createElement("option");
    option.textContent = speechSupported
      ? "No voices installed"
      : "Speech synthesis unsupported";
    voiceSelect.appendChild(option);
    voiceSelect.disabled = true;
    return;
  }

  voiceSelect.disabled = false;
  for (const voice of list) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} — ${voice.lang}${voice.default ? " (default)" : ""}`;
    voiceSelect.appendChild(option);
  }

  const known = list.some((voice) => voice.voiceURI === settings.voiceURI);
  if (!known) settings.voiceURI = suggestVoiceURI(list);
  voiceSelect.value = settings.voiceURI;
  applyVoiceSettings();
  persist();
}

/* ----------------------------------------------------------- desktop only */

async function initDesktop() {
  if (!desktop) return;

  const block = el("desktopBlock");
  const apiKeyInput = el("apiKeyInput");
  const keyState = el("keyState");
  const sttProvider = el("sttProvider");
  const sttKeyInput = el("sttKeyInput");
  const sttKeyState = el("sttKeyState");
  const sttKeyField = el("sttKeyField");
  const autoStart = el("autoStart");

  block.classList.remove("panel-block--hidden");
  hint.textContent = "Clap twice anywhere — Jarvis is listening in the background.";

  function render(view) {
    keyState.textContent = view.hasApiKey ? "saved" : "not set";
    sttKeyState.textContent = view.hasTranscribeKey ? "saved" : "not set";
    sttProvider.value = view.transcribeProvider;
    autoStart.checked = view.autoStart;
    sttKeyField.style.display = view.transcribeProvider === "none" ? "none" : "block";
  }

  render(await desktop.settings());

  sttProvider.addEventListener("change", () => {
    sttKeyField.style.display = sttProvider.value === "none" ? "none" : "block";
  });

  el("saveSetupBtn").addEventListener("click", async () => {
    const patch = {
      transcribeProvider: sttProvider.value,
      autoStart: autoStart.checked,
    };
    // Blank inputs mean "leave the stored secret alone", not "erase it".
    if (apiKeyInput.value.trim()) patch.apiKey = apiKeyInput.value.trim();
    if (sttKeyInput.value.trim()) patch.transcribeKey = sttKeyInput.value.trim();

    render(await desktop.settings(patch));
    apiKeyInput.value = "";
    sttKeyInput.value = "";
    await checkLLM();
    setLlmPill();
    log("Setup saved.", "sys");
  });

  desktop.onWake(() => wake("tray"));
  desktop.onOpenSettings(() => el("apiKeyInput").focus());
  desktop.onListening(async (on) => {
    if (on) {
      await armMicrophone();
    } else if (listener.enabled) {
      disarmMicrophone();
    }
  });
}

/* ------------------------------------------------------------------- init */

function bindEvents() {
  voiceSelect.addEventListener("change", () => {
    settings.voiceURI = voiceSelect.value;
    applyVoiceSettings();
    persist();
  });

  themeSelect.addEventListener("change", () => {
    settings.theme = themeSelect.value;
    document.body.dataset.theme = settings.theme;
    background.setTheme(settings.theme);
    persist();
  });

  ["rate", "pitch", "volume", "sensitivity", "gap", "motion"].forEach((key) =>
    bindSlider(key),
  );

  bindToggle("requireOnline");
  bindToggle("chimeOnWake");
  bindToggle("reactive", (value) => background.setReactive(value));

  el("previewBtn").addEventListener("click", () => {
    const { rate, pitch } = getVoiceOptions();
    say(
      `Voice check. Rate ${rate.toFixed(2)}, pitch ${pitch.toFixed(2)}. ` +
        "This is how I will sound.",
    );
  });

  listenBtn.addEventListener("click", () => {
    if (listener.enabled) {
      disarmMicrophone();
    } else {
      armMicrophone();
    }
  });

  wakeBtn.addEventListener("click", () => wake("manual"));

  stopBtn.addEventListener("click", () => {
    cancelSpeech();
    speaking = false;
    listener.setMuted(false);
    goToSleep();
  });

  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = "";
    runCommand(text);
  });

  window.addEventListener("online", () => {
    updateNetworkPill();
    log("Network connection restored.", "sys");
    checkLLM().then(() => {
    setLlmPill();
    initDesktop();
  });
  });

  window.addEventListener("offline", () => {
    updateNetworkPill();
    log("Network connection lost.", "sys");
    if (settings.requireOnline && awake) goToSleep();
  });

  window.addEventListener("beforeunload", () => {
    cancelSpeech();
    listener.stop();
  });
}

function init() {
  document.body.dataset.theme = settings.theme;
  themeSelect.value = settings.theme;

  background.setTheme(settings.theme);
  background.setMotion(settings.motion);
  background.setReactive(settings.reactive);
  background.start();

  listener.sensitivity = settings.sensitivity;
  listener.gapMs = settings.gap;

  syncSliders();
  bindEvents();
  initVoices(populateVoices);
  applyVoiceSettings();
  updateNetworkPill();
  setState("STANDBY");
  checkLLM().then(() => {
    setLlmPill();
    initDesktop();
  });

  if (!speechSupported) {
    showError("This browser cannot synthesise speech — replies will be text only.");
  }
  if (!recognitionSupported) {
    log("Speech recognition is unavailable here — use the text box.", "sys");
  }
}

init();
