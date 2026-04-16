const crypto = require("crypto");

const {
  deleteRoomSession,
  getRoomSession,
  loadRoomSession,
  persistRoomState,
} = require("./roomSessionStore");

const BOARD_ITEM_KINDS = new Set(["stroke", "shape", "text", "sticky"]);

function sanitizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase();
}

function buildParticipants(session) {
  return Array.from(session.users.values()).map(({ socketId, ...participant }) => participant);
}

function buildCursors(session) {
  return Array.from(session.cursors.values());
}

function emitRoomUsers(io, roomId, session) {
  io.to(roomId).emit("room-users", {
    count: session.users.size,
    participants: buildParticipants(session),
  });
}

function isValidItem(item) {
  return Boolean(item?.id && BOARD_ITEM_KINDS.has(item.kind));
}

function replaceItem(items, nextItem) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index === -1) {
    return items;
  }

  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
}

function removeItem(items, itemId) {
  return items.filter((item) => item.id !== itemId);
}

function applyBoardAction(items, action) {
  if (action.type === "create-item") {
    if (items.some((item) => item.id === action.item.id)) {
      return items;
    }

    return [...items, action.item];
  }

  if (action.type === "update-item") {
    return replaceItem(items, action.nextItem);
  }

  if (action.type === "delete-item") {
    return removeItem(items, action.item.id);
  }

  if (action.type === "clear-board") {
    return [];
  }

  return items;
}

function revertBoardAction(items, action) {
  if (action.type === "create-item") {
    return removeItem(items, action.item.id);
  }

  if (action.type === "update-item") {
    return replaceItem(items, action.previousItem);
  }

  if (action.type === "delete-item") {
    if (items.some((item) => item.id === action.item.id)) {
      return items;
    }

    return [...items, action.item];
  }

  if (action.type === "clear-board") {
    return action.items || [];
  }

  return items;
}

function createPayload(session, action, targetUserId) {
  const history = session.historyStack || [];
  const userHistory = targetUserId ? history.filter(a => a.senderId === targetUserId) : [];
  const userRedo = targetUserId ? (session.redoStacks?.get(targetUserId) || []) : [];

  return {
    action,
    historyCount: userHistory.length,
    redoCount: userRedo.length,
    participants: buildParticipants(session),
    savedAt: session.lastSavedAt,
  };
}

module.exports = function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("join-room", async (payload = {}, acknowledge) => {
      try {
        const roomId = sanitizeRoomId(payload.roomId);

        if (!roomId) {
          acknowledge?.({ ok: false, message: "Room ID is required." });
          return;
        }

        const session = await loadRoomSession(roomId);
        const participant = {
          socketId: socket.id,
          userId: payload.user?.id || crypto.randomUUID(),
          name: String(payload.user?.name || `Guest ${session.users.size + 1}`).slice(0, 32),
        };

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.userId = participant.userId;
        socket.data.userName = participant.name;

        session.users.set(socket.id, participant);

        socket.emit("room-state", {
          roomId,
          items: session.items,
          historyCount: session.historyStack.length,
          redoCount: session.redoStack.length,
          participants: buildParticipants(session),
          cursors: buildCursors(session),
          savedAt: session.lastSavedAt,
        });

        emitRoomUsers(io, roomId, session);
        acknowledge?.({ ok: true, roomId, participant });
      } catch (error) {
        console.error("join-room failed", error);
        acknowledge?.({ ok: false, message: "Unable to join room right now." });
      }
    });

    socket.on("draw", (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session) {
        return;
      }

      if (payload.phase === "start") {
        if (!payload.strokeId || !payload.point) {
          return;
        }

        session.activeStrokes.set(payload.strokeId, {
          id: payload.strokeId,
          kind: "stroke",
          color: payload.color,
          size: payload.size,
          tool: payload.tool,
          opacity: payload.opacity,
          points: [payload.point],
          userId: socket.data.userId,
          socketId: socket.id,
        });

        socket.to(roomId).emit("draw", {
          phase: "start",
          strokeId: payload.strokeId,
          point: payload.point,
          color: payload.color,
          size: payload.size,
          tool: payload.tool,
          opacity: payload.opacity,
          userId: socket.data.userId,
        });

        return;
      }

      if (payload.phase === "point") {
        const activeStroke = session.activeStrokes.get(payload.strokeId);

        if (!activeStroke || !payload.point) {
          return;
        }

        activeStroke.points.push(payload.point);

        socket.to(roomId).emit("draw", {
          phase: "point",
          strokeId: payload.strokeId,
          point: payload.point,
          userId: socket.data.userId,
        });

        return;
      }

      if (payload.phase === "end") {
        const stroke = {
          ...payload.stroke,
          kind: "stroke",
        };

        if (!stroke?.id || !Array.isArray(stroke.points) || stroke.points.length === 0) {
          return;
        }

        const action = {
          type: "create-item",
          item: stroke,
        };

        session.activeStrokes.delete(stroke.id);
        session.items = applyBoardAction(session.items, action);
        session.historyStack = [...session.historyStack, action];
        session.redoStack = [];

        // Broadcast immediately to all other clients
        socket.to(roomId).emit("board-action", createPayload(session, action));

        // Persist in the background
        persistRoomState(roomId).then(() => {
          io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });
        }).catch((error) => {
          console.error("persist draw failed", error);
        });
      }
    });

    socket.on("create-item", (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);
      const item = payload.item;

      if (!roomId || !session || !isValidItem(item)) {
        return;
      }

      const action = {
        type: "create-item",
        item,
      };

      session.items = applyBoardAction(session.items, action);
      session.historyStack = [...session.historyStack, action];
      session.redoStack = [];

      // Broadcast immediately
      socket.to(roomId).emit("board-action", createPayload(session, action));

      persistRoomState(roomId).then(() => {
        io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });
      }).catch((error) => {
        console.error("persist create-item failed", error);
      });
    });

    socket.on("update-item", (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);
      const { previousItem, nextItem } = payload;

      if (!roomId || !session || !isValidItem(previousItem) || !isValidItem(nextItem)) {
        return;
      }

      const action = {
        type: "update-item",
        previousItem,
        nextItem,
      };

      session.items = applyBoardAction(session.items, action);
      session.historyStack = [...session.historyStack, action];
      session.redoStack = [];

      // Broadcast immediately
      socket.to(roomId).emit("board-action", createPayload(session, action));

      persistRoomState(roomId).then(() => {
        io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });
      }).catch((error) => {
        console.error("persist update-item failed", error);
      });
    });

    socket.on("delete-item", (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);
      const item = payload.item;

      if (!roomId || !session || !isValidItem(item)) {
        return;
      }

      const action = {
        type: "delete-item",
        item,
      };

      session.items = applyBoardAction(session.items, action);
      session.historyStack = [...session.historyStack, action];
      session.redoStack = [];

      // Broadcast immediately
      socket.to(roomId).emit("board-action", createPayload(session, action));

      persistRoomState(roomId).then(() => {
        io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });
      }).catch((error) => {
        console.error("persist delete-item failed", error);
      });
    });

    socket.on("undo", async () => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);
      const userId = socket.data.userId;

      if (!roomId || !session || !userId) return;

      const history = session.historyStack || [];
      let index = -1;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].senderId === userId) {
          index = i;
          break;
        }
      }

      if (index === -1) return;

      const action = session.historyStack.splice(index, 1)[0];
      
      let userRedo = session.redoStacks.get(userId) || [];
      userRedo.push(action);
      session.redoStacks.set(userId, userRedo);

      session.items = revertBoardAction(session.items, action);
      await persistRoomState(roomId);

      io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });

      // Tell the sender their new counts
      socket.emit("undo", createPayload(session, action, userId));
      // Tell others about the action (they will recalculate counts based on their own perspective in handleBoardAction if needed, or we send specifically)
      socket.broadcast.to(roomId).emit("undo", createPayload(session, action, null)); // null target doesn't update counts
    });

    socket.on("redo", async () => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);
      const userId = socket.data.userId;

      if (!roomId || !session || !userId) return;

      let userRedo = session.redoStacks.get(userId) || [];
      if (userRedo.length === 0) return;

      const action = userRedo.pop();
      session.historyStack.push(action);

      session.items = applyBoardAction(session.items, action);
      await persistRoomState(roomId);

      io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });

      socket.emit("redo", createPayload(session, action, userId));
      socket.broadcast.to(roomId).emit("redo", createPayload(session, action, null));
    });

    socket.on("clear-canvas", async () => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session || session.items.length === 0) {
        return;
      }

      const action = {
        type: "clear-board",
        items: session.items,
        senderId: socket.data.userId
      };

      session.items = [];
      session.historyStack = [...session.historyStack, action];
      // Clear all redo stacks on a global clear? Or just the sender's? 
      // Typically global clear makes previous redos irrelevant.
      session.redoStacks.clear();

      await persistRoomState(roomId);
      io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });

      io.to(roomId).emit("clear-canvas");
      // Use socket.data.userId to get correct counts for the clearer
      io.to(roomId).emit("board-action", createPayload(session, action, socket.data.userId));
    });

    socket.on("board-action", async (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session) {
        return;
      }

      // Sync the server items array
      const action = { ...(payload.action || payload), senderId: socket.data.userId };
      session.items = applyBoardAction(session.items, action);
      
      if (action.type !== "cursor-move") {
        session.historyStack = [...session.historyStack, action];
        // Clear only the sender's redo stack
        session.redoStacks.set(socket.data.userId, []);
      }

      // Broadcast to others (they won't get updated history/redo counts from here, 
      // but they track their own anyway - Wait, we should send them their own perspective?)
      // To keep it simple, we just broadcast the action. The client's reducer will handle its own counts.
      // Wait, the client's reducer relies on historyCount from server.
      // This is the tricky part. Let's send a payload that tells the client AND others.
      
      // Send personalized payload to the sender
      socket.emit("board-action", createPayload(session, action, socket.data.userId));
      
      // Broadcast action to others (targetUserId null means counts aren't updated on their end via this message)
      socket.to(roomId).emit("board-action", createPayload(session, action, null));
      
      // Persist if it's a significant change
      if (action.type !== "cursor-move") {
        persistRoomState(roomId).then(() => {
          io.to(roomId).emit("room-saved", { savedAt: session.lastSavedAt });
        }).catch(err => console.error("persist board-action failed", err));
      }
    });

    socket.on("cursor-move", (payload = {}) => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session || typeof payload.x !== "number" || typeof payload.y !== "number") {
        return;
      }

      const cursor = {
        userId: socket.data.userId,
        name: socket.data.userName,
        x: payload.x,
        y: payload.y,
      };

      session.cursors.set(socket.id, cursor);

      socket.to(roomId).emit("cursor-move", cursor);
    });

    socket.on("cursor-leave", () => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session) {
        return;
      }

      session.cursors.delete(socket.id);

      socket.to(roomId).emit("cursor-left", {
        userId: socket.data.userId,
      });
    });

    socket.on("disconnect", async () => {
      const roomId = socket.data.roomId;
      const session = getRoomSession(roomId);

      if (!roomId || !session) {
        return;
      }

      session.users.delete(socket.id);
      session.cursors.delete(socket.id);

      for (const [strokeId, activeStroke] of session.activeStrokes.entries()) {
        if (activeStroke.socketId === socket.id) {
          session.activeStrokes.delete(strokeId);
          socket.to(roomId).emit("draw-cancel", { strokeId });
        }
      }

      socket.to(roomId).emit("cursor-left", {
        userId: socket.data.userId,
      });

      emitRoomUsers(io, roomId, session);

      if (session.users.size === 0) {
        await persistRoomState(roomId);
        deleteRoomSession(roomId);
      }
    });
  });
};
