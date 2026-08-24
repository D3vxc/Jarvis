/**
 * Microphone listener with a double-clap detector.
 *
 * A clap is a very short, very loud burst with most of its energy in the high
 * band, which is what separates it from speech or steady background noise. Two
 * onsets inside the configured gap window fire the wake callback.
 */

const FFT_SIZE = 1024;
const TICK_MS = 16;
const MIN_CLAP_GAP_MS = 120; // refractory period, also the minimum double-clap gap
const HIGH_BAND_MIN_HZ = 2000;
const HIGH_RATIO_MIN = 0.32;
const BASELINE_FACTOR = 3.2;
const BASELINE_ATTACK = 0.02;

export class ClapListener {
  constructor({ onClap, onDoubleClap, onLevel, onError } = {}) {
    this.onClap = onClap || (() => {});
    this.onDoubleClap = onDoubleClap || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onError = onError || (() => {});

    this.sensitivity = 0.55;
    this.gapMs = 700;
    this.enabled = false;
    this.muted = false;

    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.timeData = null;
    this.freqData = null;
    this.timerId = 0;

    this.baseline = 0.02;
    this.lastClapAt = 0;
    this.pendingClapAt = 0;
  }

  /** Threshold mapped so a higher sensitivity slider means an easier trigger. */
  get peakThreshold() {
    return 0.08 + (1 - this.sensitivity) * 0.42;
  }

  async start() {
    if (this.enabled) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);

    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.enabled = true;
    this.baseline = 0.02;

    // A timer rather than requestAnimationFrame: rAF stops in a hidden window,
    // and the desktop app spends most of its life hidden in the tray.
    this.timerId = setInterval(this.tick, TICK_MS);
  }

  stop() {
    this.enabled = false;
    clearInterval(this.timerId);
    this.timerId = 0;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.onLevel(0);
  }

  /** Ignores input while Jarvis is speaking, so it cannot clap at itself. */
  setMuted(muted) {
    this.muted = muted;
  }

  tick = () => {
    if (!this.enabled) return;

    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);

    let peak = 0;
    for (let i = 0; i < this.timeData.length; i += 1) {
      const value = Math.abs(this.timeData[i]);
      if (value > peak) peak = value;
    }

    this.onLevel(peak);

    if (this.muted) {
      this.baseline = Math.max(this.baseline, peak * 0.5);
      return;
    }

    const highRatio = this.highBandRatio();
    const now = performance.now();
    const isOnset =
      peak >= this.peakThreshold &&
      peak > this.baseline * BASELINE_FACTOR &&
      highRatio >= HIGH_RATIO_MIN &&
      now - this.lastClapAt > MIN_CLAP_GAP_MS;

    if (isOnset) {
      this.lastClapAt = now;
      this.onClap();

      const gap = now - this.pendingClapAt;
      if (this.pendingClapAt && gap >= MIN_CLAP_GAP_MS && gap <= this.gapMs) {
        this.pendingClapAt = 0;
        this.onDoubleClap();
      } else {
        this.pendingClapAt = now;
      }
    } else if (this.pendingClapAt && now - this.pendingClapAt > this.gapMs) {
      this.pendingClapAt = 0;
    }

    // Track the room's noise floor, rising slowly and falling quickly.
    this.baseline =
      peak > this.baseline
        ? this.baseline + (peak - this.baseline) * BASELINE_ATTACK
        : this.baseline + (peak - this.baseline) * 0.25;
    this.baseline = Math.max(this.baseline, 0.005);
  };

  highBandRatio() {
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const cutoff = Math.floor(HIGH_BAND_MIN_HZ / binHz);
    let total = 0;
    let high = 0;
    for (let i = 0; i < this.freqData.length; i += 1) {
      total += this.freqData[i];
      if (i >= cutoff) high += this.freqData[i];
    }
    return total > 0 ? high / total : 0;
  }

  /**
   * Records the next `ms` of microphone audio and resolves with the bytes.
   * Used by the desktop app, where the browser's SpeechRecognition API does
   * not exist and the utterance has to be transcribed by a provider instead.
   */
  record(ms = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.stream || typeof MediaRecorder === "undefined") {
        reject(new Error("Recording is unavailable."));
        return;
      }

      const chunks = [];
      const recorder = new MediaRecorder(this.stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => reject(event.error));
      recorder.addEventListener("stop", async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        resolve(await blob.arrayBuffer());
      });

      recorder.start();
      this.recorder = recorder;
      setTimeout(() => this.stopRecording(), ms);
    });
  }

  /** Ends an in-flight recording early — used when speech tails off. */
  stopRecording() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
  }

  /** Short two-tone chime, played through the same audio context. */
  chime() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [880, 1320].forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const at = now + index * 0.11;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    });
  }
}
