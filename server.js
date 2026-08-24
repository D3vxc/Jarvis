/**
 * Jarvis backend.
 *
 * Serves the static front end and exposes a small Claude proxy. The API key
 * lives here and never reaches the browser, which is the whole reason this
 * server exists — a browser-side key would be readable by anyone who opens
 * dev tools.
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== "false";
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// Spoken replies are read aloud, so they are deliberately short. This is the
// one place a small max_tokens is the right call.
const MAX_TOKENS = 1024;
const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_CONTINUATIONS = 3;

const SYSTEM_PROMPT = [
  "You are JARVIS, a voice assistant. Your answers are spoken aloud by a",
  "browser speech synthesiser, so write for the ear:",
  "- Two or three sentences at most, under about 60 words, unless the user asks for detail.",
  "- Plain prose only. No markdown, no bullet points, no code blocks, no emoji, no URLs.",
  "- Spell out symbols and units the way a person would say them.",
  "- Be direct and specific. If you do not know, say so in one sentence.",
  "- If a question depends on current facts, search the web before answering.",
  "You may say a brief sentence before using a tool.",
].join("\n");

const client = HAS_KEY ? new Anthropic() : null;

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

/** Trims client-supplied history to a shape the API will accept. */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (turn) =>
        turn &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim(),
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_MESSAGE_CHARS),
    }));
}

function textOf(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .trim();
}

function buildRequest(messages) {
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    // Adaptive thinking is on by default for Opus 5; low effort keeps the
    // round trip short enough to feel conversational.
    output_config: { effort: "low" },
    // Server-side fallback: if a safety classifier declines the request,
    // Anthropic re-runs it on a suitable model instead of returning a refusal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages,
  };

  if (WEB_SEARCH) {
    request.tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
    ];
  }

  return request;
}

app.get("/api/health", (req, res) => {
  res.json({
    llm: HAS_KEY,
    model: HAS_KEY ? MODEL : null,
    webSearch: HAS_KEY && WEB_SEARCH,
  });
});

app.post("/api/ask", async (req, res) => {
  if (!client) {
    res.status(503).json({
      error: "no_api_key",
      message: "ANTHROPIC_API_KEY is not set on the server.",
    });
    return;
  }

  if (rateLimited(req.ip)) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests." });
    return;
  }

  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "empty_message", message: "No message supplied." });
    return;
  }

  const messages = [
    ...sanitizeHistory(req.body?.history),
    { role: "user", content: message.slice(0, MAX_MESSAGE_CHARS) },
  ];

  try {
    let response = await client.beta.messages.create(buildRequest(messages));

    // Server-side tools pause after ten internal iterations; resending the
    // turn unchanged lets the server pick up where it stopped.
    for (let i = 0; i < MAX_CONTINUATIONS && response.stop_reason === "pause_turn"; i += 1) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.beta.messages.create(buildRequest(messages));
    }

    if (response.stop_reason === "refusal") {
      res.json({
        reply: "I am not able to answer that one.",
        refused: true,
        model: response.model,
      });
      return;
    }

    const searched = response.content.some(
      (block) => block.type === "web_search_tool_result",
    );

    res.json({
      reply: textOf(response.content) || "I did not have an answer for that.",
      model: response.model,
      searched,
      usage: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(502).json({ error: "auth", message: "The Anthropic API key was rejected." });
      return;
    }
    if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "upstream_rate_limit", message: "Claude is rate limiting; try again shortly." });
      return;
    }
    if (error instanceof Anthropic.APIError) {
      res.status(502).json({ error: "api_error", message: `Claude API error ${error.status}.` });
      return;
    }
    console.error("ask failed:", error);
    res.status(500).json({ error: "server_error", message: "Something went wrong." });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis running at http://localhost:${PORT}`);
  console.log(
    HAS_KEY
      ? `LLM answers: on (${MODEL}${WEB_SEARCH ? ", web search enabled" : ""})`
      : "LLM answers: off — set ANTHROPIC_API_KEY in .env to enable them",
  );
});
