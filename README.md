# Real-Time Collaborative Whiteboard

Production-ready collaborative whiteboard built with React, HTML5 Canvas, Node.js, Express, Socket.IO, and MongoDB.

## Features

- Real-time drawing in shared rooms with Socket.IO
- Pen, eraser, color picker, and brush size controls
- Undo and redo powered by two synchronized stacks
- Persistent room history in MongoDB
- Room creation and join flow with live participant count
- Incremental drawing updates with throttled socket events
- `requestAnimationFrame` canvas rendering for smoother updates
- Live cursors for connected collaborators
- Export current board as PNG
- Clear board action synchronized for every client

## Project Structure

```text
client/
  src/
    components/
    context/
    hooks/
    pages/
server/
  controllers/
  models/
  routes/
  sockets/
```

## Prerequisites

- Node.js 18+
- npm 9+
- MongoDB running locally or a MongoDB Atlas connection string

## Environment Setup

1. Copy the server env sample:

```bash
cp server/.env.example server/.env
```

2. Copy the client env sample:

```bash
cp client/.env.example client/.env
```

3. Update values if needed:

- `server/.env`
  - `PORT=5000`
  - `MONGODB_URI=mongodb://127.0.0.1:27017/realtime-whiteboard`
  - `CLIENT_ORIGIN=http://localhost:5173`
- `client/.env`
  - `VITE_API_BASE_URL=http://localhost:5000/api`
  - `VITE_SOCKET_URL=http://localhost:5000`

## Install Dependencies

Run the installs from the repository root:

```bash
npm run install:all
```

## Run Locally

Start the backend in one terminal:

```bash
npm run dev:server
```

Start the frontend in a second terminal:

```bash
npm run dev:client
```

Open https://high-performance-spatial-whiteboard-with.onrender.com

## How Real-Time Sync Works

- Each room is identified by `/room/:id`
- New strokes are streamed as incremental point updates over the `draw` event
- The completed stroke is persisted on stroke end
- Undo pops from the active stack into the redo stack
- Redo pops from the redo stack back into the active stack
- All room actions broadcast through Socket.IO and update every connected client

## Socket Events

- `join-room`
- `draw`
- `undo`
- `redo`
- `clear-canvas`
- `cursor-move`
- `cursor-left`

## How To Test Real-Time Features

1. Open the app in two browser windows or one normal window plus one incognito window.
2. Create a room in the first window and copy the room ID.
3. Join the same room from the second window.
4. Draw in one window and confirm the stroke streams live in the other.
5. Test undo, redo, and clear board from either window.
6. Refresh one window and verify the saved strokes reload from MongoDB.
7. Move the pointer on the canvas and confirm live cursor badges appear for the other user.
8. Use Export PNG and verify the downloaded image matches the visible board.

## Production Notes

- The server serves the built React app automatically when `client/dist` exists
- Persisted room state lives in MongoDB under the `WhiteboardRoom` collection
- Strokes use normalized coordinates so drawings scale correctly across different screen sizes

## Build For Production

Build the frontend:

```bash
npm run build
```

Start the server:

```bash
npm run start
```
