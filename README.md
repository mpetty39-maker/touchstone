# Touchstone Race

Multiplayer puzzle race. Everyone in a game gets the same 5 puzzles (4x4 growing to 6x6);
first to light every gem on all five levels wins.

## Run locally
    npm install
    npm start          # http://localhost:3000

## Deploy on Render
Push this folder to a GitHub repo, then in Render: New > Web Service > pick the repo.
`render.yaml` already sets build (`npm install`), start (`npm start`) and the health check.
WebSockets work on Render web services with no extra setup.
Free instances sleep after ~15 min idle (first load then takes up to a minute) and
active games are lost on restart/deploy.

## Tests
    node test/gen-stats.js     # puzzle generation speed and par spread
    node test/verify-par.js    # par solver vs. brute force (4x4) + dead-end check
    node test/protocol.js      # lobby/race protocol with bot clients
    node test/e2e.js /tmp      # two real browsers race all five levels (needs playwright)

## Tuning
- `public/shared.js` LEVELS: grid size, number of shape buttons, shape sizes, and par range per level.
- `public/audio.js` VOICES: each player's instrument.
- `server.js`: MAX_PLAYERS, COUNTDOWN_MS.
