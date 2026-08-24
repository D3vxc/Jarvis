/**
 * Speech-to-text for the desktop app.
 *
 * The browser's SpeechRecognition API is a Chrome/Edge feature backed by
 * Google's servers; Electron ships Chromium without those credentials, so it
 * is simply not available here. Instead the renderer records the utterance
 * after a wake and sends the audio through one of these providers.
 *
 * Both are optional. With no provider configured the app wakes into its text
 * box instead, which needs no key and no network.
 */

const DEEPGRAM_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true";
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

export function transcriptionAvailable(store) {
  const provider = store.get("transcribeProvider");
  return provider !== "none" && Boolean(store.get("transcribeKey"));
}

/**
 * @param {Buffer} audio  webm/opus bytes from MediaRecorder
 * @returns {Promise<string>} the transcript, possibly empty
 */
export async function transcribe(store, audio) {
  const provider = store.get("transcribeProvider");
  const key = store.get("transcribeKey");

  if (!key || provider === "none") {
    const error = new Error("No transcription provider is configured.");
    error.code = "no_transcriber";
    throw error;
  }

  if (provider === "deepgram") {
    const response = await fetch(DEEPGRAM_URL, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "audio/webm" },
      body: audio,
    });
    if (!response.ok) throw new Error(`Deepgram error ${response.status}`);
    const data = await response.json();
    return (
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ""
    ).trim();
  }

  if (provider === "openai") {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/webm" }), "speech.webm");
    form.append("model", "whisper-1");
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) throw new Error(`Transcription error ${response.status}`);
    const data = await response.json();
    return (data?.text || "").trim();
  }

  throw new Error(`Unknown transcription provider: ${provider}`);
}
