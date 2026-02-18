# 16 Beads (Sholo Guti)

A 2-player Sholo Guti (16 Beads) board game with online rooms using Socket.IO.

## Features
- Online room creation and joining
- Automatic color assignment (Red/Blue)
- Turn indicators and player color badges
- Undo requires opponent approval
- Mobile-friendly layout

## Tech Stack
- Node.js
- Express
- Socket.IO
- Vanilla HTML/CSS/JS

## Getting Started

### Install

```bash
npm install
```

### Run Locally

```bash
npm start
```

Open:
- http://localhost:3000

## How To Play
1. Open the site.
2. Create a room or join with a code.
3. Colors are assigned automatically.
4. Select a bead and move to a valid point.
5. Captures happen by jumping over opponent pieces.

## Controls
- New Game: resets the board
- Undo: requests approval from opponent
- Dark / High Contrast / Shadows / Forced Capture / Sound / Low Power / Large UI

## Project Structure
- index.html
- style.css
- app.js
- server.js

## Deploy (Render)
1. Create a new Web Service on Render.
2. Connect this GitHub repo.
3. Build Command: `npm install`
4. Start Command: `npm start`

## Notes
- Free Render instances can spin down when idle.
- For mobile testing, use browser DevTools device mode.
