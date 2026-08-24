/**
 * Client for the local Claude proxy (`server.js`). The API key stays on the
 * server; the browser only ever sees these two endpoints.
 */

let ready = false;
let info = { llm: false, model: null, webSearch: false };

export function llmReady() {
  return ready;
}

export function llmInfo() {
  return { ...info };
}

/** Asks the server whether an answer engine is configured. */
export async function checkLLM() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error(`health ${response.status}`);
    info = await response.json();
    ready = Boolean(info.llm);
  } catch {
    // Opened as a plain file, or the server is not running.
    info = { llm: false, model: null, webSearch: false };
    ready = false;
  }
  return llmInfo();
}

/**
 * Sends one question plus recent turns to Claude.
 * Returns { reply, searched, model } or throws with a readable message.
 */
export async function askLLM(message, history = []) {
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
