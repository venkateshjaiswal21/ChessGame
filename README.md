# ChessApp

A real-time multiplayer chess game built with Node.js, Express, Socket.io, Chess.js and EJS.

## Features
- Play chess online with another player or watch as a spectator
- Real-time updates and move synchronization
- Undo/redo moves
- Spectator move navigation

## Setup
1. **Install dependencies:**
   ```
   npm install
   ```
2. **Start the server:**
   ```
   node app.js
   ```
   Or for development with auto-reload:
   ```
   npx nodemon app.js
   ```
3. **Open in your browser:**
   Visit [http://localhost:8080](http://localhost:8080)

## Notes
- The first two connections become players (white and black); others are spectators.
- Make sure `node_modules/` is not committed (see `.gitignore`).
