const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Electron exposes the constructor but not the Google credentials behind it, so
 * every session fails with "not-allowed". Treat the desktop app as having no
 * recognition at all and let it use the recording path instead.
 */
export const recognitionSupported =
  Boolean(SpeechRecognitionCtor) && !window.jarvisDesktop;

/**
 * Single-shot speech recognition. Browsers stream this to a cloud service, so
 * it only works while online — the caller checks connectivity first.
 */
export class Recognizer {
  constructor({ onResult, onInterim, onEnd, onError } = {}) {
    this.onResult = onResult || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.recognition = null;

    if (!recognitionSupported) return;


    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("result", (event) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript.trim();
      if (result.isFinal) {
        this.onResult(text);
      } else {
        this.onInterim(text);
      }
    });

    recognition.addEventListener("end", () => {
      this.active = false;
      this.onEnd();
    });

    recognition.addEventListener("error", (event) => {
      this.active = false;
      this.onError(event.error);
    });

    this.recognition = recognition;
  }

  start() {
    if (!this.recognition || this.active) return;
    try {
      this.recognition.start();
      this.active = true;
    } catch {
      // start() throws if a previous session has not fully closed yet.
      this.active = false;
    }
  }

  stop() {
    if (!this.recognition || !this.active) return;
    this.recognition.stop();
  }
}
