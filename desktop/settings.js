/**
 * Desktop settings, stored as JSON in the OS app-data directory.
 *
 * The API key is entered in the app's own settings panel rather than a .env
 * file, so running the desktop app never requires a terminal.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULTS = {
  apiKey: "",
  model: "claude-opus-5",
  webSearch: true,
  autoStart: true,
  listenOnLaunch: true,
  transcribeProvider: "none", // none | deepgram | openai
  transcribeKey: "",
};

export class Store {
  constructor(dir) {
    this.file = path.join(dir, "settings.json");
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      // First run, or a corrupted file — defaults are the right answer either way.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get(key) {
    return this.data[key];
  }

  update(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULTS) this.data[key] = value;
    }
    this.save();
    return this.data;
  }

  /** Never send raw secrets to the renderer — only whether they are present. */
  publicView() {
    return {
      hasApiKey: Boolean(this.data.apiKey),
      model: this.data.model,
      webSearch: this.data.webSearch,
      autoStart: this.data.autoStart,
      listenOnLaunch: this.data.listenOnLaunch,
      transcribeProvider: this.data.transcribeProvider,
      hasTranscribeKey: Boolean(this.data.transcribeKey),
    };
  }
}
