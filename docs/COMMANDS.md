# Commands and tuning

## Two tiers

Commands are matched against local rules first. They are instant, free, and work
without a network where the underlying action allows it. Whatever does not match
goes to Claude.

### Local rules

| Pattern | Example | Needs internet |
|---|---|---|
| greeting | "hello", "hey", "good morning" | no |
| identity | "who are you", "what's your name" | no |
| time | "what time is it" | no |
| date | "what's the date", "what day is it" | no |
| weather | "weather", "how hot is it" | yes — geolocation + Open-Meteo |
| open | "open youtube", "open github", "open example.com" | yes |
| search | "search for hand tracking", "google mediapipe" | yes |
| play | "play daft punk on youtube" | yes |
| voice | "speak faster", "slower", "louder", "quieter", "deeper", "higher pitch" | no |
| sleep | "go to sleep", "goodbye", "that's all" | no |

Known site shortcuts: `youtube`, `google`, `github`, `gmail`, `maps`,
`wikipedia`, `chat gpt`, `claude`. Anything shaped like a domain is opened
directly; anything else is searched.

### Everything else → Claude

Open questions, explanations, comparisons, current events, arithmetic, drafting —
all of it goes to the answer engine and comes back spoken. The last twelve turns
travel with each question, so follow-ups work:

> "who designed the sydney opera house"
> "how long did it take to build"

When Claude used web search for an answer, the transcript logs
*Claude searched the web for this answer.*

## Tuning the clap trigger

The meter under the reactor shows live microphone level; the yellow marker is the
current trigger threshold. Clap once and watch where the bar lands.

- **Bar never reaches the marker** → raise **Sensitivity** (moves the marker left).
- **Random wakes** → lower it. Typing and music are the usual culprits.
- **Two claps read as one** → you are clapping faster than the 120 ms refractory
  period; slow down slightly.
- **Two claps never pair up** → raise **Max gap between claps**.

*Claps detected* in the panel counts every single clap the detector accepted, which
is the fastest way to tell "it never hears me" from "it hears me but the pairing
window is wrong".

## Voice

The dropdown lists the speech voices your browser and OS provide — the set differs
between Chrome, Edge, Safari, and machines. Chrome ships its own network voices,
which are usually the best-sounding option; Windows and macOS system voices work
offline. Rate, pitch, and volume apply live; **Preview Voice** reads a test line
with the current settings. Everything is saved per browser.

## Background

| Theme | Look |
|---|---|
| Arc Reactor | Cyan, the default |
| Plasma | Magenta |
| Grid | Green |
| Void | Desaturated, minimal |

**Motion** scales the animation speed — set it to 0 to freeze the backdrop.
**React to microphone level** makes the rings and radial bars breathe with input,
which doubles as a visual confirmation that the microphone is live.
