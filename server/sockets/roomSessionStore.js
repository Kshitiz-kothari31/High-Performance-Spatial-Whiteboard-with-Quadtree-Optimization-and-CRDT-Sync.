const WhiteboardRoom = require("../models/WhiteboardRoom");

const sessions = new Map();

function normalizeLegacyStroke(stroke) {
  return {
    ...stroke,
    kind: "stroke",
    opacity: typeof stroke.opacity === "number" ? stroke.opacity : 1,
  };
}

async function loadRoomSession(roomId) {
  if (sessions.has(roomId)) {
    return sessions.get(roomId);
  }

  const room = await WhiteboardRoom.findOneAndUpdate(
    { roomId },
    {
      $setOnInsert: {
        roomId,
        items: [],
        historyStack: [],
        redoStack: [],
      },
    },
    { new: true, upsert: true, lean: true },
  );

  const items =
    room.items?.length > 0
      ? room.items
      : (room.strokes || []).map(normalizeLegacyStroke);
  const historyStack =
    room.historyStack?.length > 0
      ? room.historyStack
      : items.map((item) => ({
          type: "create-item",
          item,
        }));

  const session = {
    roomId,
    items,
    historyStack,
    redoStack: room.redoStack || [],
    activeStrokes: new Map(),
    users: new Map(),
    cursors: new Map(),
    redoStacks: new Map(),
    lastSavedAt: room.updatedAt || new Date().toISOString(),
  };

  sessions.set(roomId, session);

  return session;
}

function getRoomSession(roomId) {
  return sessions.get(roomId);
}

async function persistRoomState(roomId) {
  const session = sessions.get(roomId);

  if (!session) {
    return;
  }

  const updatedRoom = await WhiteboardRoom.findOneAndUpdate(
    { roomId },
    {
      roomId,
      items: session.items,
      historyStack: session.historyStack,
      redoStack: session.redoStack,
    },
    { upsert: true, new: true },
  );

  session.lastSavedAt = updatedRoom.updatedAt?.toISOString?.() || new Date().toISOString();
}

function deleteRoomSession(roomId) {
  sessions.delete(roomId);
}

module.exports = {
  deleteRoomSession,
  getRoomSession,
  loadRoomSession,
  persistRoomState,
};
