# Touchstone Race

Multiplayer puzzle race. Everyone in a game gets the same 5 puzzles (three 4x4, then two 5x5).
Tap a gem to preview, tap it again to place the glowing shape. The host picks a race length
(2, 5, 10 or 15 minutes). First to light every gem on all five levels wins and ends the race.
If time runs out, whoever got farthest wins: most levels cleared, then most lit gems on the
level in progress. Equal progress is a shared rank.

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
    E2E_MODE=timeup DURATION_MS=16000 node test/e2e.js /tmp   # same, but time runs out

## Tuning
- `public/shared.js` LEVELS: grid size, number of shape buttons, shape sizes, and par range per level.
- `public/audio.js` VOICES: each player's instrument.
- `server.js`: MAX_PLAYERS, COUNTDOWN_MS, MINUTES (race length choices).
