const synth = window.speechSynthesis;

let voices = [];
let onVoicesChanged = null;
let current = { voiceURI: "", rate: 1, pitch: 1, volume: 1 };

export const speechSupported = Boolean(synth);

function refreshVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  if (onVoicesChanged) onVoicesChanged(voices);
}

export function initVoices(callback) {
  onVoicesChanged = callback;
  if (!synth) {
    callback([]);
    return;
  }
  refreshVoices();
  // Chrome populates the list asynchronously after the first call.
  synth.addEventListener("voiceschanged", refreshVoices);
}

export function getVoices() {
  return voices;
}

/** Ranks voices so the default pick sounds closest to an assistant. */
export function suggestVoiceURI(list) {
  if (!list.length) return "";
  const preferred = [
    /google uk english male/i,
    /daniel/i,
    /google us english/i,
    /microsoft (guy|david|mark)/i,
    /english/i,
  ];
  for (const pattern of preferred) {
    const match = list.find((v) => pattern.test(v.name) || pattern.test(v.voiceURI));
    if (match) return match.voiceURI;
  }
  const en = list.find((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  return (en || list[0]).voiceURI;
}

export function setVoiceOptions(options) {
  current = { ...current, ...options };
}

export function getVoiceOptions() {
  return { ...current };
}

export function cancelSpeech() {
  if (synth) synth.cancel();
}

/**
 * Speaks `text` with the currently selected voice.
 * Resolves when playback ends (or immediately when synthesis is unavailable).
 */
export function speak(text, { onStart, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) {
      resolve();
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.find((v) => v.voiceURI === current.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = current.rate;
    utterance.pitch = current.pitch;
    utterance.volume = current.volume;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (onEnd) onEnd();
      resolve();
    };

    utterance.addEventListener("start", () => {
      if (onStart) onStart();
    });
    utterance.addEventListener("end", finish);
    utterance.addEventListener("error", finish);

    synth.speak(utterance);
  });
}
