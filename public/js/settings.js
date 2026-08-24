const STORAGE_KEY = "jarvis.settings.v1";

export const DEFAULTS = {
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  sensitivity: 0.55,
  gap: 700,
  requireOnline: true,
  chimeOnWake: true,
  theme: "arc",
  motion: 1,
  reactive: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode) — settings stay session-only */
  }
}
