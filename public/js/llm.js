/**
 * Client for the answer engine.
 *
 * Two transports, same shape: the desktop app talks to the Electron main
 * process over IPC (no HTTP, no port, no localhost), and the browser build
 * posts to the local server. Everything above this module is identical.
 */

const desktop = typeof window !== "undefined" ? window.jarvisDesktop : null;

let ready = false;
let info = { llm: false, model: null, webSearch: false, desktop: Boolean(desktop) };

export const isDesktop = Boolean(desktop);

export function llmReady() {
  return ready;
}

export function llmInfo() {
  return { ...info };
}

/** Asks the host whether an answer engine is configured. */
export async function checkLLM() {
  try {
    info = desktop
      ? await desktop.health()
      : await (await fetch("/api/health", { cache: "no-store" })).json();
    ready = Boolean(info.llm);
  } catch {
    // Server not running, or the page was opened as a plain file.
    info = { llm: false, model: null, webSearch: false, desktop: Boolean(desktop) };
    ready = false;
  }
  return llmInfo();
}

/**
 * Sends one question plus recent turns to Claude.
 * Returns { reply, searched, model } or throws with a readable message.
 */
export async function askLLM(message, history = []) {
  if (desktop) {
    const data = await desktop.ask(message, history);
    if (data.error) {
      if (data.error === "no_api_key") ready = false;
      throw new Error(data.message);
    }
    return data;
  }

  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503) ready = false;
    throw new Error(data.message || `Answer service error ${response.status}`);
  }
  return data;
}

/** Desktop only: turns recorded audio into text via the configured provider. */
export async function transcribe(buffer) {
  if (!desktop) throw new Error("Transcription is only available in the desktop app.");
  const data = await desktop.transcribe(buffer);
  if (data.error) throw new Error(data.message);
  return data.text;
}

export function transcriptionReady() {
  return Boolean(desktop && info.transcription);
}
