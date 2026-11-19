# HGSE Survival

**How many days can your student survive at the Harvard Graduate School of Education?**

A multiplayer 2D top-down survival game in the browser. Each player creates a student, picks a concentration, housing, dream job and four courses, then tries to make it to graduation. Every day is harder than the one before: energy drains faster and random events come more often. An AI narrator (Claude) describes the chaos as it happens.

> Fan-made satire for a class project. Not affiliated with or endorsed by Harvard University.

## How to play

1. Create your student, then join the **waiting room** (1 to 8 players).
2. **Any player can press Start** whenever they like, and everyone in the room joins that game. A room that reaches 8 players starts on its own.
3. Walk with **WASD / arrow keys**. Walk into a building and press **1–9** (or click) to do something there.
4. Survive until midnight on the last day to graduate. At graduation, a weighted random roll decides whether you land your dream job.

### Losing
If your energy hits 0 before midnight, you **burn out**: you collapse at home until the next morning. Burn out **more than 3 times** and your run is over. You have to start again from the beginning, with no extra chances.

### What makes each day harder
- Energy drains faster every day (shown in the HUD).
- The chance of random events rises every day:
  stove fire, dead laptop, too many opportunities, surprise expenses, the afternoon slump, a lost Harvard ID, and a TF/professor strike.
- Difficulty spikes: **midterms** (middle of the semester) and **finals** (last day) at 10:00 in Longfellow Hall, plus a **presentation** for each course at 14:00 in Larsen Hall. If you aren't there, you score zero.
- Money is limited: rent is charged every night, and debt costs you energy.

### Concentrations (difficulty settings)
| | Difficulty | Strength | Weakness |
|---|---|---|---|
| ELOE | Medium | Networking +40%, i-lab +30% | Opportunities cost more energy, studying −10% |
| LDIT | Hard | Studying +20%, GSD alliance +30% | A dead laptop cripples study *and* class |
| EPA | Medium | HKS alliance +50%, networking +10% | Strikes drain 15 energy |
| HDE | Easy | +10 overnight recovery, social events restore energy | Networking −10%, MIT hits harder |
| TTF | Hard | Class attendance +30%, +10 on presentations | Classes cost more energy, −$100 at start |

### Factions
- **Allies:** Harvard Kennedy School, Graduate School of Design. They give you energy, contacts and help with projects.
- **Enemies:** Harvard Business School, Harvard Law School. They take your contacts and your energy, but their events can pay off.
- **Hardcore rival:** MIT. Huge learning rewards, brutal failures.
- All other schools are neutral.

### Housing
| | Walk to HGSE | Rent/night | Perk |
|---|---|---|---|
| Kronkite | ~2 min | $40 | Closest |
| Peabody Terrace | ~25 min | $28 | Best sleep, river walks restore extra energy |
| 100 South Campus Drive | across the river | $32 | i-lab events +20% |
| Somerville | ~12 min | $22 | Cheapest, but HLS neighbors start arguments |

### Dream job (the final roll)
Your odds (5% to 95%) come from everything you did:

| Factor | Weight |
|---|---|
| Grades (mastery, midterm, final, presentation) | 25% |
| Energy management (average end-of-day energy, −15 per burnout) | 20% |
| Course relevance to your dream job | 15% |
| Networking | 15% |
| Career prep (career services, pitch nights, debates) | 15% |
| Allies (the alliance your job values counts most) | 10% |

## Running it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
cp .env.example .env        # optionally add your Anthropic API key
npm start                   # http://localhost:3000
```

Open several browser tabs to test multiplayer. To test quickly, set `DAY_REAL_MINUTES=3` and `SEMESTER_DAYS=4` in `.env`.

Without an API key, the game runs fully on built-in event text. With a key, Claude writes the event narration and judges the free-text **Improvise** actions.

```bash
npm test                    # engine + multiplayer tests
```

## How the AI is used, and why it doesn't keep score
All numbers (energy, money, grades, burnouts) are tracked by the server code in `src/world.js`. The AI only:
1. **Narrates** events the engine already decided (`src/narrator.js`). It is told not to invent numbers or consequences.
2. **Judges Improvise actions** into one of three fixed outcomes (`great` / `ok` / `bad`). The code then applies a fixed reward or penalty.

This keeps the game fair and stops players from talking the AI into free money. Narration calls are throttled, and if the AI is slow or fails, the built-in text is used instead.

## Project layout
```
server.js              entry point
src/config.js          ALL balance numbers (day length, drain, event odds…)
src/data/catalog.js    concentrations, housing, courses, dream jobs
src/data/map.js        campus layout, river and bridges
src/activities.js      what you can do in each building
src/events.js          random events and faction encounters
src/world.js           the game engine: clock, movement, exams, burnout, graduation
src/dreamJob.js        the weighted final roll
src/lobby.js           waiting room → game
src/narrator.js        Claude integration (+ mock)
public/                browser client (canvas map + HUD)
test/                  node:test suites
```

## Deploying
This game needs a running Node server for WebSockets and to keep the API key secret, so **GitHub Pages will not work**. Use a Node host such as Render, Railway or Fly.io: connect the GitHub repo, set the start command to `npm start`, and add `ANTHROPIC_API_KEY` as a secret environment variable.

## Known limitations / next steps
- Balance numbers are first-pass and untested by real players. Expect to tune `src/config.js` and `src/activities.js`.
- Game state lives in memory: restarting the server ends all games. There are no accounts and no saves.
- If you refresh mid-game, you leave that game.
- Movement is server-side at 10 updates per second, which is fine on campus Wi-Fi but laggy on slow connections.
- The map is stylized, not to scale.
- The TTF program's full name is a TODO in `src/data/catalog.js`.
