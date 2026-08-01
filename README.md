# Liar's UNO

A full-stack, real-time, multiplayer **Liar's UNO** card game for 2-7 players.

Bluff the table with face-down "liar" cards, call out bluffs, stack +2/+4 penalties, shout UNO, and race to the podium.

## Stack
- Client: React 19 + Vite + Tailwind CSS 4 + Framer Motion
- Server: Node ESM + Express 4 + Socket.io 4 (authoritative engine)
- E2E: Playwright two-tab smoke test

## Run locally

```bash
cd liars-uno/server && npm install && npm start
cd liars-uno/client && npm install && npm run dev
```

Open http://localhost:5173
