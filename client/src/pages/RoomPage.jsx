import { WhiteboardManager, VectorInt } from "../lib/CrdtManager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import BoardIcon from "../components/BoardIcon";
import CanvasBoard from "../components/CanvasBoard";
import { useWhiteboard } from "../context/WhiteboardContext";
import { useSocket } from "../hooks/useSocket";
import {
  DEFAULT_VIEWPORT,
  clampZoom,
  formatLastSaved,
  zoomViewportAtPoint,
} from "../lib/boardUtils";
import { SOCKET_URL } from "../lib/api";

const primaryTools = [
  { id: "select", label: "Select" },
  { id: "draw", label: "Draw" },
  { id: "sticky", label: "Sticky" },
  { id: "text", label: "Text" },
  { id: "hand", label: "Hand" },
];

const drawTools = [
  { id: "pen", label: "Pen" },
  { id: "highlighter", label: "Highlight" },
  { id: "eraser", label: "Eraser" },
  { id: "rectangle", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "arrow", label: "Arrow" },
];

const swatches = ["#202431", "#4B67FF", "#FF6B57", "#2BBE60", "#F4B942", "#CB69FF"];

function getFallbackUser() {
  const sessionId = sessionStorage.getItem("pulseboard-session-id") || crypto.randomUUID();
  sessionStorage.setItem("pulseboard-session-id", sessionId);
  
  return {
    id: sessionId,
    name: window.localStorage.getItem("pulseboard-name") || "Guest",
  };
}

function initials(name) {
  return String(name || "Guest")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const generateNewPosition = (items, index = -1) => {
  const targetIndex = index === -1 ? items.length : index;
  const prevItem = items[targetIndex - 1];
  const nextItem = items[targetIndex];
  return {
    p1: prevItem?.fractionalPosition || [],
    p2: nextItem?.fractionalPosition || []
  };
};

export default function RoomPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const { state, dispatch } = useWhiteboard();
  const { socket, isConnected } = useSocket(SOCKET_URL);
  const boardApiRef = useRef(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [shareMessage, setShareMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [wasmEngine, setWasmEngine] = useState(null);

  // 1. Initialize Wasm Engine
  useEffect(() => {
    const instance = new WhiteboardManager();
    const Module = { VectorInt };
    setWasmEngine({ instance, Module });
    console.log("🚀 CRDT JS Engine Active");
  }, []);

  const user = useMemo(() => {
    const nextUser = location.state?.user || getFallbackUser();
    window.localStorage.setItem("pulseboard-user-id", nextUser.id);
    window.localStorage.setItem("pulseboard-name", nextUser.name);
    return nextUser;
  }, [location.state]);

  useEffect(() => {
    dispatch({ type: "SET_USER", payload: user });
  }, [dispatch, user]);

  // 2. CRDT Action Handler
  const handleBoardAction = useCallback((payload) => {
    if (!wasmEngine) return;
    const { instance, Module } = wasmEngine;

    // Standardize: Extract action from payload (server wraps it, local might not)
    const action = payload.action || payload;
    const item = action.item || action.nextItem;

    if (action.type === "create-item" || action.type === "update-item") {
      const vectorPos = new Module.VectorInt();
      const position = item.fractionalPosition || [50];
      position.forEach(val => vectorPos.push_back(val));
      
      instance.addElement(item.id, vectorPos, item.userId, JSON.stringify(item));
      vectorPos.delete();
    } else if (action.type === "delete-item") {
      instance.deleteElement(item.id);
    } else if (action.type === "clear-board") {
      instance.clearBoard();
    }

    const orderedItems = JSON.parse(instance.getOrderedElements());

    dispatch({
      type: "HYDRATE_ROOM",
      payload: {
        ...stateRef.current,
        items: orderedItems,
        historyCount: payload.historyCount || stateRef.current.historyCount,
        redoCount: payload.redoCount || stateRef.current.redoCount
      }
    });

    // If it's a cursor move, we don't need to re-sort or hydrate the board items necessarily,
    // but the reducer handles UPSERT_CURSOR separately.
  }, [wasmEngine, dispatch]);

  // 3. Socket Listeners with proper State Sync
  useEffect(() => {
    if (!socket || !roomId || !isConnected || !wasmEngine) return;

    socket.emit("join-room", { roomId, user }, (res) => {
      setStatusMessage(res?.ok ? "Live collaboration active" : "Join failed");
    });

    const handleRoomState = (payload) => {
      // SYNC: Feed existing database items into the C++ Manager
      const { instance, Module } = wasmEngine;
      instance.clearBoard();

      if (payload.items) {
        payload.items.forEach(item => {
          const v = new Module.VectorInt();
          (item.fractionalPosition || [50]).forEach(val => v.push_back(val));
          instance.addElement(item.id, v, item.userId, JSON.stringify(item));
          v.delete();
        });
      }

      dispatch({ type: "HYDRATE_ROOM", payload });
    };

    const handleRoomUsers = (p) => {
      dispatch({ type: "SET_PARTICIPANTS", payload: p.participants || [] });
    };

    const handleUndo = (p) => dispatch({ type: "APPLY_UNDO", payload: p });
    const handleRedo = (p) => dispatch({ type: "APPLY_REDO", payload: p });
    const handleCursorMove = (p) => {
      console.log("📍 Received cursor move:", p);
      dispatch({ type: "UPSERT_CURSOR", payload: p });
    };
    const handleCursorLeft = (p) => dispatch({ type: "REMOVE_CURSOR", payload: p.userId });

    socket.on("room-state", handleRoomState);
    socket.on("room-users", handleRoomUsers);
    socket.on("board-action", handleBoardAction);
    socket.on("undo", handleUndo);
    socket.on("redo", handleRedo);
    socket.on("cursor-move", handleCursorMove);
    socket.on("cursor-left", handleCursorLeft);

    return () => {
      socket.off("room-state", handleRoomState);
      socket.off("room-users", handleRoomUsers);
      socket.off("board-action", handleBoardAction);
      socket.off("undo", handleUndo);
      socket.off("redo", handleRedo);
      socket.off("cursor-move", handleCursorMove);
      socket.off("cursor-left", handleCursorLeft);
    };
  }, [isConnected, roomId, socket, user, handleBoardAction, wasmEngine, dispatch]);

  // 4. Local Drawing Logic
  const handleLocalDraw = (shapeData) => {
    if (!wasmEngine || !socket) return;
    const { instance, Module } = wasmEngine;

    const { p1, p2 } = generateNewPosition(state.items);
    const v1 = new Module.VectorInt();
    const v2 = new Module.VectorInt();
    p1.forEach(n => v1.push_back(n));
    p2.forEach(n => v2.push_back(n));

    const newPosVector = instance.generateIntermediate(v1, v2);
    const newPosArray = [];
    for (let i = 0; i < newPosVector.size(); i++) {
      newPosArray.push(newPosVector.get(i));
    }

    const payload = {
      type: "create-item",
      item: {
        ...shapeData,
        fractionalPosition: newPosArray,
        userId: user.id,
        id: shapeData.id || crypto.randomUUID()
      }
    };

    socket.emit("board-action", payload);
    handleBoardAction(payload); // Immediate local update

    v1.delete(); v2.delete(); newPosVector.delete();
  };

  // Helper Functions
  const setTool = (t) => dispatch({ type: "SET_TOOL", payload: t });
  const isDrawToolActive = drawTools.some((e) => e.id === state.tool);
  const handlePrimaryToolSelect = (t) => t === "draw" ? setTool(state.lastDrawTool || "pen") : setTool(t);
  const setViewport = (v) => dispatch({ type: "SET_VIEWPORT", payload: v });
  const zoom = (m) => setViewport(zoomViewportAtPoint(state.viewport, clampZoom(state.viewport.scale * m), { x: window.innerWidth / 2, y: window.innerHeight / 2 }));

  const handleShare = () => {
    const link = state.roomId || roomId;
    navigator.clipboard?.writeText ? navigator.clipboard.writeText(link).then(() => setShareMessage("Room ID copied")) : (window.prompt("Copy ID:", link), setShareMessage("Room ID ready"));
    setTimeout(() => setShareMessage(""), 1800);
  };

  return (
    <main className="room-page">
      <CanvasBoard
        onDraw={handleLocalDraw}
        items={state.items}
        cursors={state.cursors}
        socket={socket}
        roomId={state.roomId || roomId}
        user={state.user}
        tool={state.tool}
        color={state.color}
        brushSize={state.brushSize}
        viewport={state.viewport}
        selectedItemId={state.selectedItemId}
        dispatch={dispatch}
        apiRef={boardApiRef}
      />

      <header className="floating-topbar floating-topbar--left">
        <div>
          <h1>Web whiteboard</h1>
          <p>C++ CRDT Enabled</p>
        </div>
        <button type="button" className="icon-action" onClick={() => boardApiRef.current?.exportAsImage()} aria-label="Export board">
          <BoardIcon name="share" />
        </button>
      </header>

      <section className="floating-topbar floating-topbar--center">
        <span className="floating-badge floating-badge--save">
          <BoardIcon name="target" />
          {formatLastSaved(state.savedAt)}
        </span>
        <button type="button" className="cta-button" onClick={handleShare}>
          {shareMessage || "Share Room ID"}
        </button>
      </section>

      <section className="floating-dock floating-dock--left">
        <button 
          type="button" 
          className="dock-button" 
          onClick={() => socket?.emit("undo")}
          disabled={state.historyCount === 0}
          title="Undo"
        >
          <BoardIcon name="undo" />
        </button>
        <button 
          type="button" 
          className="dock-button" 
          onClick={() => socket?.emit("redo")}
          disabled={state.redoCount === 0}
          title="Redo"
        >
          <BoardIcon name="redo" />
        </button>
      </section>

      <section className="floating-dock floating-dock--right">
        <button 
          type="button" 
          className="dock-button" 
          onClick={() => zoom(0.8)}
          title="Zoom out"
        >
          <BoardIcon name="minus" />
        </button>
        <span className="zoom-readout">{Math.round(state.viewport.scale * 100)}%</span>
        <button 
          type="button" 
          className="dock-button" 
          onClick={() => zoom(1.2)}
          title="Zoom in"
        >
          <BoardIcon name="plus" />
        </button>
        <button 
          type="button" 
          className="dock-button" 
          onClick={() => setShowHelp(true)}
          title="Board Guide"
        >
          <BoardIcon name="help" />
        </button>
      </section>

      <section className="floating-topbar floating-topbar--right">
        <div className="presence-stack">
          {state.participants.slice(0, 3).map((participant) => (
            <span key={participant.userId} className="avatar-chip" title={participant.name}>
              {initials(participant.name)}
            </span>
          ))}
          <span className="presence-meta">{state.participants.length || 1} online</span>
        </div>
      </section>

      <aside className="floating-rail floating-rail--primary">
        {primaryTools.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={(entry.id === "draw" ? isDrawToolActive : state.tool === entry.id) ? "rail-button rail-button--compact is-active" : "rail-button rail-button--compact"}
            onClick={() => handlePrimaryToolSelect(entry.id)}
          >
            <BoardIcon name={entry.id} />
          </button>
        ))}
      </aside>

      {isDrawToolActive && (
        <aside className="floating-rail floating-rail--secondary">
          <span className="rail-title">Draw</span>
          <div className="draw-tool-grid">
            {drawTools.map((entry) => (
              <button key={entry.id} type="button" className={state.tool === entry.id ? "rail-button rail-button--card is-active" : "rail-button rail-button--card"} onClick={() => setTool(entry.id)}>
                <span className="rail-button__icon"><BoardIcon name={entry.id} /></span>
                <span className="rail-button__label">{entry.label}</span>
              </button>
            ))}
          </div>
          <div className="rail-divider" />

          <div className="brush-control">
            <span className="brush-control__value">{state.brushSize}px</span>
            <input 
              type="range" 
              min="1" 
              max="20" 
              step="1" 
              value={state.brushSize} 
              onChange={(e) => dispatch({type: "SET_BRUSH_SIZE", payload: parseInt(e.target.value, 10)})}
            />
          </div>
          
          <div className="palette-group">
            <span className="palette-title">Colors</span>
            <div className="swatch-column">
                 <button 
                   key={color} 
                   type="button" 
                   className={state.color === color ? "color-dot is-selected" : "color-dot"} 
                   style={{backgroundColor: color}} 
                   onClick={() => dispatch({type: "SET_COLOR", payload: color})} 
                 />
               ))}
            </div>
          </div>
        </aside>
      )}

      <section className="board-status">
        <span className={isConnected ? "status-pill is-live" : "status-pill"}>{statusMessage}</span>
        <Link className="leave-link" to="/">Leave room</Link>
      </section>

      {showHelp && (
        <div className="help-modal">
          <div className="help-card" onClick={(e) => e.stopPropagation()}>
            <div className="help-card__header">
              <div>
                <h3 className="eyebrow">Board Guide</h3>
                <h2>Tools now available</h2>
              </div>
              <button 
                type="button" 
                className="icon-action" 
                onClick={() => setShowHelp(false)} 
                style={{ borderRadius: "50%", width: "40px", height: "40px", background: "rgba(75, 103, 255, 0.1)", color: "var(--blue)" }}
              >
                <BoardIcon name="minus" />
              </button>
            </div>
            <ul className="help-list">
              <li>`Select` lets you pick and drag existing notes, text, shapes, and strokes.</li>
              <li>`Pen` and `Highlight` stream live freehand strokes to everyone in the room.</li>
              <li>`Rectangle`, `Ellipse`, and `Arrow` create shapes by click-dragging on the board.</li>
              <li>`Sticky` and `Text` place editable content blocks using quick prompts.</li>
              <li>`Eraser` removes the item under the cursor and syncs that delete instantly.</li>
              <li>`Hand` pans the board, while mouse wheel zooms around the pointer.</li>
              <li>`Share board` copies the room URL, and `Export` downloads the visible canvas as PNG.</li>
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}