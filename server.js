/**
 * Jarvis web server.
 *
 * Serves the browser front end and proxies questions to Claude. The API key
 * lives here and never reaches the page — a key in front-end JavaScript is
 * readable by anyone who opens dev tools.
 *
 * The desktop app (`npm run desktop`) does not use this file: it talks to
 * lib/claude.js directly over IPC, with no HTTP server and no localhost.
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAnswerEngine, describeError, DEFAULT_MODEL } from "./lib/claude.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
const WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== "false";

const ask = createAnswerEngine({
  getKey: () => process.env.ANTHROPIC_API_KEY || "",
  getModel: () => MODEL,
  getWebSearch: () => WEB_SEARCH,
});

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(here, "public")));

/** Keeps a stray loop or an open port from burning through the API budget. */
const rateWindow = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateWindow.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  rateWindow.set(ip, hits);
  return hits.length > 20;
}

app.get("/api/health", (req, res) => {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  res.json({
    llm: hasKey,
    model: hasKey ? MODEL : null,
    webSearch: hasKey && WEB_SEARCH,
  });
});

app.post("/api/ask", async (req, res) => {
  if (rateLimited(req.ip)) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests." });
    return;
  }

  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "empty_message", message: "No message supplied." });
    return;
  }

  try {
    res.json(await ask(message, req.body?.history));
  } catch (error) {
    const described = describeError(error);
    if (described.code === "server_error") console.error("ask failed:", error);
    res.status(described.status).json({ error: described.code, message: described.message });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis running at http://localhost:${PORT}`);
  console.log(
    process.env.ANTHROPIC_API_KEY
      ? `LLM answers: on (${MODEL}${WEB_SEARCH ? ", web search enabled" : ""})`
      : "LLM answers: off — set ANTHROPIC_API_KEY in .env to enable them",
  );
});
