/**
 * The answer engine, shared by the web server and the desktop app.
 *
 * Both surfaces need the same Claude call; only the way they get the API key
 * differs (an env var for the server, a settings file for the desktop app),
 * so the key arrives through a getter rather than being read here.
 */

import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5";

// Spoken replies are read aloud, so they are deliberately short. This is the
// rare case where a small ceiling is correct rather than a truncation risk.
const MAX_TOKENS = 1024;
const MAX_HISTORY_TURNS = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_CONTINUATIONS = 3;

export const SYSTEM_PROMPT = [
  "You are JARVIS, a voice assistant. Your answers are spoken aloud by a",
  "speech synthesiser, so write for the ear:",
  "- Two or three sentences at most, under about 60 words, unless the user asks for detail.",
  "- Plain prose only. No markdown, no bullet points, no code blocks, no emoji, no URLs.",
  "- Spell out symbols and units the way a person would say them.",
  "- Be direct and specific. If you do not know, say so in one sentence.",
  "- If a question depends on current facts, search the web before answering.",
  "You may say a brief sentence before using a tool.",
].join("\n");

/** Trims caller-supplied history to a shape the API will accept. */
export function sanitizeHistory(history) {
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

/**
 * Builds an ask() bound to a key source.
 *
 * `options.getKey()` is read on every call so a key entered at runtime takes
 * effect without a restart.
 */
export function createAnswerEngine({ getKey, getModel, getWebSearch }) {
  let cached = { key: null, client: null };

  function clientFor(key) {
    if (cached.key !== key) {
      cached = { key, client: new Anthropic({ apiKey: key }) };
    }
    return cached.client;
  }

  function buildRequest(messages, model, webSearch) {
    const request = {
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      // Adaptive thinking is on by default for Opus 5; low effort keeps the
      // round trip short enough to feel conversational.
      output_config: { effort: "low" },
      // If a safety classifier declines the request, Anthropic re-runs it on a
      // suitable model server-side instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    };

    if (webSearch) {
      request.tools = [
        { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      ];
    }

    return request;
  }

  return async function ask(message, history) {
    const key = getKey();
    if (!key) {
      const error = new Error("No Anthropic API key is configured.");
      error.code = "no_api_key";
      throw error;
    }

    const model = getModel() || DEFAULT_MODEL;
    const webSearch = getWebSearch();
    const client = clientFor(key);

    const messages = [
      ...sanitizeHistory(history),
      { role: "user", content: String(message).slice(0, MAX_MESSAGE_CHARS) },
    ];

    let response = await client.beta.messages.create(
      buildRequest(messages, model, webSearch),
    );

    // Server-side tools pause after ten internal iterations; resending the turn
    // unchanged lets the server pick up where it stopped.
    for (
      let i = 0;
      i < MAX_CONTINUATIONS && response.stop_reason === "pause_turn";
      i += 1
    ) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.beta.messages.create(
        buildRequest(messages, model, webSearch),
      );
    }

    if (response.stop_reason === "refusal") {
      return {
        reply: "I am not able to answer that one.",
        refused: true,
        model: response.model,
      };
    }

    return {
      reply: textOf(response.content) || "I did not have an answer for that.",
      model: response.model,
      searched: response.content.some(
        (block) => block.type === "web_search_tool_result",
      ),
      usage: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens,
      },
    };
  };
}

/** Maps an SDK error onto a message worth speaking aloud. */
export function describeError(error) {
  if (error?.code === "no_api_key") {
    return { status: 503, code: "no_api_key", message: error.message };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 502, code: "auth", message: "The Anthropic API key was rejected." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, code: "upstream_rate_limit", message: "Claude is rate limiting; try again shortly." };
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, code: "api_error", message: `Claude API error ${error.status}.` };
  }
  return { status: 500, code: "server_error", message: "Something went wrong." };
}
