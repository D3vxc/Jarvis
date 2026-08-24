const SITES = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  github: "https://github.com",
  gmail: "https://mail.google.com",
  maps: "https://maps.google.com",
  wikipedia: "https://www.wikipedia.org",
  "chat gpt": "https://chat.openai.com",
  claude: "https://claude.ai",
};

const WEATHER_CODES = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "heavy rain showers",
  82: "violent rain showers",
  95: "a thunderstorm",
  96: "a thunderstorm with hail",
  99: "a severe thunderstorm with hail",
};

function openTab(url) {
  window.open(url, "_blank", "noopener");
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

async function fetchWeather() {
  const position = await getPosition();
  const { latitude, longitude } = position.coords;
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}` +
    "&current=temperature_2m,apparent_temperature,weather_code";

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather service returned ${response.status}`);

  const data = await response.json();
  const current = data.current || {};
  const description = WEATHER_CODES[current.weather_code] || "unclear conditions";
  return (
    `It is currently ${Math.round(current.temperature_2m)} degrees with ${description}. ` +
    `It feels like ${Math.round(current.apparent_temperature)} degrees.`
  );
}

/**
 * Turns a transcript into a spoken reply.
 *
 * Deterministic commands (time, launching sites, voice tuning) are handled
 * locally so they stay instant and work offline; anything else falls through
 * to the Claude-backed answer engine.
 *
 * `ctx` carries what a command may need:
 *   { adjustVoice(patch), online, llmReady, askLLM(text) }
 * Returns { reply, sleep?, searched?, source? }.
 */
export async function handleCommand(rawText, ctx) {
  const text = rawText.trim().toLowerCase();
  if (!text) return { reply: "I did not catch that." };

  if (/\b(hello|hi|hey|good (morning|evening|afternoon))\b/.test(text)) {
    return { reply: "At your service. What do you need?" };
  }

  if (/\b(who are you|your name|what are you)\b/.test(text)) {
    return {
      reply:
        "I am Jarvis, a browser-based voice assistant. Clap twice and I will listen.",
    };
  }

  if (/\b(time|clock)\b/.test(text)) {
    const now = new Date();
    return {
      reply: `It is ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
    };
  }

  if (/\b(date|day is it|today)\b/.test(text)) {
    const now = new Date();
    return {
      reply: `Today is ${now.toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })}.`,
    };
  }

  if (/\b(weather|temperature|how hot|how cold)\b/.test(text)) {
    if (!ctx.online) {
      return { reply: "I need an internet connection to check the weather." };
    }
    try {
      return { reply: await fetchWeather() };
    } catch (error) {
      return { reply: `I could not fetch the weather. ${error.message}` };
    }
  }

  const playMatch = text.match(/^(?:play|put on)\s+(.+?)(?:\s+on\s+youtube)?$/);
  if (playMatch) {
    if (!ctx.online) return { reply: "That needs an internet connection." };
    const query = playMatch[1];
    openTab(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    return { reply: `Searching YouTube for ${query}.` };
  }

  const openMatch = text.match(/^(?:open|launch|go to)\s+(.+)$/);
  if (openMatch) {
    if (!ctx.online) return { reply: "That needs an internet connection." };
    const target = openMatch[1].replace(/\.$/, "").trim();
    const site = Object.keys(SITES).find((key) => target.includes(key));
    if (site) {
      openTab(SITES[site]);
      return { reply: `Opening ${site}.` };
    }
    if (/^[\w-]+(\.[\w-]+)+$/.test(target)) {
      openTab(`https://${target}`);
      return { reply: `Opening ${target}.` };
    }
    openTab(`https://www.google.com/search?q=${encodeURIComponent(target)}`);
    return { reply: `I do not know that site, so I searched for ${target}.` };
  }

  const searchMatch = text.match(/^(?:search|look up|google)\s+(?:for\s+)?(.+)$/);
  if (searchMatch) {
    if (!ctx.online) return { reply: "Searching needs an internet connection." };
    const query = searchMatch[1];
    openTab(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return { reply: `Here are the results for ${query}.` };
  }

  if (/\b(faster|speed up)\b/.test(text)) {
    const rate = ctx.adjustVoice({ rate: 0.15 });
    return { reply: `Speaking faster, rate ${rate.toFixed(2)}.` };
  }

  if (/\b(slower|slow down)\b/.test(text)) {
    const rate = ctx.adjustVoice({ rate: -0.15 });
    return { reply: `Speaking slower, rate ${rate.toFixed(2)}.` };
  }

  if (/\b(louder|volume up)\b/.test(text)) {
    ctx.adjustVoice({ volume: 0.15 });
    return { reply: "Volume raised." };
  }

  if (/\b(quieter|softer|volume down)\b/.test(text)) {
    ctx.adjustVoice({ volume: -0.15 });
    return { reply: "Volume lowered." };
  }

  if (/\b(deeper|lower pitch)\b/.test(text)) {
    ctx.adjustVoice({ pitch: -0.15 });
    return { reply: "Pitch lowered." };
  }

  if (/\b(higher pitch|brighter)\b/.test(text)) {
    ctx.adjustVoice({ pitch: 0.15 });
    return { reply: "Pitch raised." };
  }

  if (/\b(sleep|stand ?by|goodbye|bye|that's all|thank you)\b/.test(text)) {
    return { reply: "Going back to standby. Clap twice when you need me.", sleep: true };
  }

  if (!ctx.online) {
    return {
      reply: "I am offline, so I can only handle time, date, and voice controls.",
    };
  }

  // Anything the rules above do not cover goes to Claude, which answers in the
  // assistant's own voice instead of dumping the user into a search page.
  if (ctx.llmReady) {
    try {
      const answer = await ctx.askLLM(rawText);
      return { reply: answer.reply, searched: answer.searched, source: "claude" };
    } catch (error) {
      return {
        reply: `My answer engine is unavailable. ${error.message}`,
      };
    }
  }

  openTab(`https://www.google.com/search?q=${encodeURIComponent(rawText)}`);
  return { reply: `I am not sure, so I searched the web for ${rawText}.` };
}
