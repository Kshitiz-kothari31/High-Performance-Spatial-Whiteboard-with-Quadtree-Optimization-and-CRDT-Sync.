import { useEffect, useRef, useState } from "react";
import {
  clampZoom,
  drawBoardItem,
  drawGrid,
  drawSelectionOutline,
  getItemBounds,
  hitTestItem,
  screenToWorld,
  worldToScreen,
  translateItem,
  zoomViewportAtPoint,
} from "../lib/boardUtils";
import { useThrottle } from "../hooks/useThrottle";
import CursorOverlay from "./CursorOverlay";

function getCanvasPoint(event, canvas) {
  const bounds = canvas.getBoundingClientRect();

  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function buildStroke(tool, color, brushSize, userId, point) {
  return {
    id: `${userId}-${crypto.randomUUID()}`,
    kind: "stroke",
    tool,
    color,
    size: tool === "highlighter" ? Math.max(brushSize * 2.2, 12) : brushSize,
    opacity: tool === "highlighter" ? 0.22 : 1,
    userId,
    points: [point],
  };
}

function buildShape(tool, color, brushSize, userId, point) {
  return {
    id: `${userId}-${crypto.randomUUID()}`,
    kind: "shape",
    shapeType: tool,
    color,
    size: Math.max(2, brushSize - 1),
    userId,
    start: point,
    end: point,
  };
}

function getTopItemAtPoint(items, point) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (hitTestItem(point, items[index])) {
      return items[index];
    }
  }

  return null;
}

export default function CanvasBoard({
  items,
  cursors,
  socket,
  roomId,
  user,
  tool,
  color,
  brushSize,
  viewport,
  selectedItemId,
  dispatch,
  apiRef,
  onDraw,
}) {
  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  const renderFrameRef = useRef(null);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const draftItemRef = useRef(null);
  const previewMoveRef = useRef(null);
  const remoteStrokesRef = useRef(new Map());
  const interactionRef = useRef(null);
  const erasedIdsRef = useRef(new Set());
  
  const [editingText, setEditingText] = useState(null);
  const editingTextRef = useRef(null);
  const textAreaRef = useRef(null);

  useEffect(() => {
    if (editingText && textAreaRef.current) {
      const timer = setTimeout(() => {
        textAreaRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [editingText]);

  const emitCursorMove = useThrottle((point) => {
    socket?.emit("cursor-move", point);
  }, 24);

  const emitDrawPoint = useThrottle((strokeId, point) => {
    socket?.emit("draw", {
      phase: "point",
      strokeId,
      point,
    });
  }, 16);

  function scheduleRender() {
    if (renderFrameRef.current) {
      return;
    }

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");
      const { width, height } = sizeRef.current;

      context.clearRect(0, 0, width, height);
      drawGrid(context, width, height, viewport);

      context.save();
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.scale, viewport.scale);

      console.log('Rendering items:', items); items.forEach((item) => drawBoardItem(context, item));
      remoteStrokesRef.current.forEach((item) => drawBoardItem(context, item));

      if (draftItemRef.current) {
        drawBoardItem(context, draftItemRef.current);
      }

      if (previewMoveRef.current) {
        drawBoardItem(context, previewMoveRef.current);
      }

      const selectedItem =
        previewMoveRef.current ||
        (interactionRef.current?.type === "move"
          ? items.find((item) => item.id === selectedItemId)
          : null) ||
        (tool === "select" ? items.find((item) => item.id === selectedItemId) : null);

      if (selectedItem) {
        drawSelectionOutline(context, selectedItem);
      }

      context.restore();
    });
  }

  useEffect(() => {
    for (const item of items) {
      remoteStrokesRef.current.delete(item.id);
    }

    scheduleRender();
  }, [items, selectedItemId, viewport]);

  useEffect(() => {
    const board = boardRef.current;
    const canvas = canvasRef.current;

    if (!board || !canvas) {
      return undefined;
    }

    function resizeCanvas() {
      const bounds = board.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");

      sizeRef.current = {
        width: bounds.width,
        height: bounds.height,
      };
      setBoardSize({
        width: bounds.width,
        height: bounds.height,
      });

      canvas.width = Math.floor(bounds.width * devicePixelRatio);
      canvas.height = Math.floor(bounds.height * devicePixelRatio);
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      scheduleRender();
    }

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(board);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function handleRemoteDraw(payload) {
      if (payload.phase === "start") {
        remoteStrokesRef.current.set(payload.strokeId, {
          id: payload.strokeId,
          kind: "stroke",
          color: payload.color,
          size: payload.size,
          tool: payload.tool,
          opacity: payload.opacity,
          userId: payload.userId,
          points: [payload.point],
        });
        scheduleRender();
        return;
      }

      if (payload.phase === "point") {
        const stroke = remoteStrokesRef.current.get(payload.strokeId);

        if (!stroke) {
          return;
        }

        stroke.points = [...stroke.points, payload.point];
        scheduleRender();
      }
    }

    function handleDrawCancel(payload) {
      remoteStrokesRef.current.delete(payload.strokeId);
      scheduleRender();
    }

    function handleClearCanvas() {
      remoteStrokesRef.current.clear();
      draftItemRef.current = null;
      previewMoveRef.current = null;
      scheduleRender();
    }

    socket.on("draw", handleRemoteDraw);
    socket.on("draw-cancel", handleDrawCancel);
    socket.on("clear-canvas", handleClearCanvas);

    return () => {
      socket.off("draw", handleRemoteDraw);
      socket.off("draw-cancel", handleDrawCancel);
      socket.off("clear-canvas", handleClearCanvas);
    };
  }, [socket, viewport]);

  useEffect(() => {
    apiRef.current = {
      exportAsImage() {
        const width = sizeRef.current.width || 1600;
        const height = sizeRef.current.height || 1000;
        const exportCanvas = document.createElement("canvas");
        const exportContext = exportCanvas.getContext("2d");
        const scale = 2;

        exportCanvas.width = width * scale;
        exportCanvas.height = height * scale;
        exportContext.scale(scale, scale);
        drawGrid(exportContext, width, height, viewport);

        exportContext.save();
        exportContext.translate(viewport.x, viewport.y);
        exportContext.scale(viewport.scale, viewport.scale);
        items.forEach((item) => drawBoardItem(exportContext, item));
        exportContext.restore();

        const link = document.createElement("a");
        link.href = exportCanvas.toDataURL("image/png");
        link.download = `pulseboard-${roomId}.png`;
        link.click();
      },
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, items, roomId, viewport]);

  function emitViewport(nextViewport) {
    dispatch({
      type: "SET_VIEWPORT",
      payload: nextViewport,
    });
  }

  function commitCreate(item) {
    if (onDraw) {
      onDraw(item);
    } else {
      socket?.emit("create-item", { item });
    }
  }

  function commitUpdate(previousItem, nextItem) {
    socket?.emit("update-item", { previousItem, nextItem });
  }

  function commitDelete(item) {
    socket?.emit("delete-item", { item });
  }

  function deleteAtPoint(worldPoint) {
    const target = getTopItemAtPoint(items, worldPoint);

    if (!target || erasedIdsRef.current.has(target.id)) {
      return;
    }

    erasedIdsRef.current.add(target.id);

    if (selectedItemId === target.id) {
      dispatch({ type: "SET_SELECTED_ITEM", payload: null });
    }

    commitDelete(target);
  }

  function startTextPlacement(worldPoint, kind, existingItem = null) {
    const newState = { 
      worldPoint: existingItem ? { x: existingItem.x, y: existingItem.y } : worldPoint, 
      kind, 
      text: existingItem ? existingItem.text : "",
      originalItem: existingItem,
      token: crypto.randomUUID()
    };
    setEditingText(newState);
    editingTextRef.current = newState;
  }

  function finishTextPlacement(tokenToFinish) {
    const current = editingTextRef.current;
    if (!current) return;
    if (tokenToFinish && current.token !== tokenToFinish) return;
    
    editingTextRef.current = null;
    setEditingText(null);

    const { worldPoint, kind, text, originalItem } = current;

    if (!text.trim()) {
      if (originalItem) {
        commitDelete(originalItem);
      }
      return;
    }

    const finalId = originalItem ? originalItem.id : `${user.id}-${crypto.randomUUID()}`;
    const item =
      kind === "sticky"
        ? {
            id: finalId,
            kind: "sticky",
            x: worldPoint.x,
            y: worldPoint.y,
            width: 220,
            height: 180,
            color: originalItem ? originalItem.color : color,
            text: text.trim(),
            userId: user.id,
          }
        : {
            id: finalId,
            kind: "text",
            x: worldPoint.x,
            y: worldPoint.y,
            color: originalItem ? originalItem.color : color,
            fontSize: originalItem ? originalItem.fontSize : Math.max(18, brushSize * 5),
            text: text.trim(),
            userId: user.id,
          };

    if (originalItem) {
      commitUpdate(originalItem, item);
    } else {
      commitCreate(item);
    }
    dispatch({ type: "SET_SELECTED_ITEM", payload: item.id });
  }

  function cancelTextPlacement() {
    editingTextRef.current = null;
    setEditingText(null);
  }

  function updateEditingText(newText) {
    if (editingTextRef.current) {
        editingTextRef.current.text = newText;
        setEditingText({ ...editingTextRef.current });
    }
  }

  function handlePointerDown(event) {
    if (editingText) {
      finishTextPlacement(editingText.token);
    }

    if (!socket || !user) {
      return;
    }

    const screenPoint = getCanvasPoint(event, canvasRef.current);
    const worldPoint = screenToWorld(screenPoint, viewport);
    erasedIdsRef.current.clear();

    if (tool === "sticky" || tool === "text") {
      startTextPlacement(worldPoint, tool);
      return;
    }

    if (tool === "eraser") {
      interactionRef.current = { type: "erase" };
      deleteAtPoint(worldPoint);
      return;
    }

    if (tool === "hand") {
      interactionRef.current = {
        type: "pan",
        originViewport: viewport,
        startPoint: screenPoint,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "select") {
      const target = getTopItemAtPoint(items, worldPoint);
      dispatch({ type: "SET_SELECTED_ITEM", payload: target?.id || null });

      if (target) {
        interactionRef.current = {
          type: "move",
          originItem: target,
          startWorldPoint: worldPoint,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }

    if (tool === "pen" || tool === "highlighter") {
      const stroke = buildStroke(tool, color, brushSize, user.id, worldPoint);
      draftItemRef.current = stroke;
      interactionRef.current = { type: "draw" };
      event.currentTarget.setPointerCapture(event.pointerId);

      socket.emit("draw", {
        phase: "start",
        strokeId: stroke.id,
        point: worldPoint,
        color: stroke.color,
        size: stroke.size,
        tool: stroke.tool,
        opacity: stroke.opacity,
      });

      scheduleRender();
      return;
    }

    if (tool === "rectangle" || tool === "ellipse" || tool === "arrow") {
      const shape = buildShape(tool, color, brushSize, user.id, worldPoint);
      draftItemRef.current = shape;
      interactionRef.current = { type: "shape" };
      event.currentTarget.setPointerCapture(event.pointerId);
      scheduleRender();
    }
  }

  function handlePointerMove(event) {
    const screenPoint = getCanvasPoint(event, canvasRef.current);
    const worldPoint = screenToWorld(screenPoint, viewport);

    emitCursorMove(worldPoint);

    if (!interactionRef.current) {
      return;
    }

    if (interactionRef.current.type === "pan") {
      emitViewport({
        ...viewport,
        x:
          interactionRef.current.originViewport.x +
          (screenPoint.x - interactionRef.current.startPoint.x),
        y:
          interactionRef.current.originViewport.y +
          (screenPoint.y - interactionRef.current.startPoint.y),
      });
      return;
    }

    if (interactionRef.current.type === "move" && interactionRef.current.originItem) {
      const dx = worldPoint.x - interactionRef.current.startWorldPoint.x;
      const dy = worldPoint.y - interactionRef.current.startWorldPoint.y;
      previewMoveRef.current = translateItem(interactionRef.current.originItem, dx, dy);
      scheduleRender();
      return;
    }

    if (interactionRef.current.type === "erase") {
      deleteAtPoint(worldPoint);
      return;
    }

    if (interactionRef.current.type === "draw" && draftItemRef.current) {
      const previousPoint = draftItemRef.current.points[draftItemRef.current.points.length - 1];
      const distance =
        Math.abs(previousPoint.x - worldPoint.x) + Math.abs(previousPoint.y - worldPoint.y);

      if (distance < 1.2) {
        return;
      }

      draftItemRef.current = {
        ...draftItemRef.current,
        points: [...draftItemRef.current.points, worldPoint],
      };

      emitDrawPoint(draftItemRef.current.id, worldPoint);
      scheduleRender();
      return;
    }

    if (interactionRef.current.type === "shape" && draftItemRef.current) {
      draftItemRef.current = {
        ...draftItemRef.current,
        end: worldPoint,
      };
      scheduleRender();
    }
  }

  function handlePointerUp(event) {
    const screenPoint = getCanvasPoint(event, canvasRef.current);
    const worldPoint = screenToWorld(screenPoint, viewport);
    const interaction = interactionRef.current;
    interactionRef.current = null;
    erasedIdsRef.current.clear();

    if (!interaction) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (interaction.type === "draw" && draftItemRef.current) {
      const nextStroke = {
        ...draftItemRef.current,
        points: [...draftItemRef.current.points, worldPoint],
      };

      draftItemRef.current = null;

      if (nextStroke.points.length > 1) {
        // UPDATE: Route through onDraw for CRDT indexing
        if (onDraw) {
          onDraw(nextStroke);
        } else {
          socket.emit("draw", {
            phase: "end",
            stroke: nextStroke,
          });
        }
      }

      scheduleRender();
      return;
    }

    if (interaction.type === "shape" && draftItemRef.current) {
      const bounds = getItemBounds(draftItemRef.current);
      const nextShape = {
        ...draftItemRef.current,
        end: worldPoint,
      };

      draftItemRef.current = null;

      if (bounds.width > 12 || bounds.height > 12) {
        commitCreate(nextShape);
        dispatch({ type: "SET_SELECTED_ITEM", payload: nextShape.id });
      }

      scheduleRender();
      return;
    }

    if (interaction.type === "move" && previewMoveRef.current) {
      const nextItem = previewMoveRef.current;
      previewMoveRef.current = null;

      if (interaction.originItem.id !== nextItem.id) {
        scheduleRender();
        return;
      }

      commitUpdate(interaction.originItem, nextItem);
      dispatch({ type: "SET_SELECTED_ITEM", payload: nextItem.id });
      scheduleRender();
      return;
    }

    previewMoveRef.current = null;
    scheduleRender();
  }

  function handlePointerLeave() {
    socket?.emit("cursor-leave");
  }

  function handleWheel(event) {
    event.preventDefault();
    const multiplier = event.deltaY < 0 ? 1.1 : 0.92;
    const nextScale = clampZoom(viewport.scale * multiplier);
    const anchorPoint = {
      x: sizeRef.current.width / 2,
      y: sizeRef.current.height / 2,
    };

    emitViewport(zoomViewportAtPoint(viewport, nextScale, anchorPoint));
  }

  function handleDoubleClick(event) {
    if (!socket || !user) return;
    const screenPoint = getCanvasPoint(event, canvasRef.current);
    const worldPoint = screenToWorld(screenPoint, viewport);
    const target = getTopItemAtPoint(items, worldPoint);

    if (target && (target.kind === "text" || target.kind === "sticky")) {
      startTextPlacement(worldPoint, target.kind, target);
    }
  }

  return (
    <div className="board-surface" ref={boardRef}>
      <canvas
        ref={canvasRef}
        className={`board-canvas board-canvas--${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />
      <CursorOverlay
        cursors={cursors}
        viewport={viewport}
        boardSize={boardSize}
        currentUserId={user?.id}
      />
      {editingText && (
        <textarea
          ref={textAreaRef}
          value={editingText.text}
          onChange={(e) => updateEditingText(e.target.value)}
          onBlur={() => finishTextPlacement(editingText.token)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              finishTextPlacement(editingText.token);
            } else if (e.key === "Escape") {
              cancelTextPlacement();
            }
          }}
          style={{
            position: "absolute",
            left: worldToScreen(editingText.worldPoint, viewport).x,
            top: worldToScreen(editingText.worldPoint, viewport).y,
            transform: `scale(${viewport.scale})`,
            transformOrigin: "top left",
            padding: editingText.kind === "sticky" ? "36px 18px 18px 18px" : "8px",
            marginTop: editingText.kind === "text" ? `-${Math.max(18, brushSize * 5)}px` : "0",
            marginLeft: editingText.kind === "text" ? "-8px" : "0",
            width: editingText.kind === "sticky" ? "220px" : "300px",
            height: editingText.kind === "sticky" ? "180px" : "150px",
            fontSize: editingText.kind === "sticky" ? "22px" : `${Math.max(18, brushSize * 5)}px`,
            fontWeight: 700,
            fontFamily: `"Avenir Next", "Segoe UI", sans-serif`,
            color: editingText.kind === "sticky" ? "#2B2F3A" : color,
            background: editingText.kind === "sticky" ? color : "rgba(255, 255, 255, 0.9)",
            boxShadow: editingText.kind === "sticky" ? "0 10px 22px rgba(23, 31, 56, 0.08)" : "0 4px 12px rgba(0,0,0,0.1)",
            border: editingText.kind === "text" ? `2px solid var(--blue)` : "none",
            borderRadius: editingText.kind === "sticky" ? "24px" : "8px",
            outline: "none",
            resize: editingText.kind === "text" ? "both" : "none",
            zIndex: 100,
            whiteSpace: "pre-wrap",
            lineHeight: editingText.kind === "sticky" ? "28px" : "1.28",
          }}
          placeholder={editingText.kind === "sticky" ? "Write the sticky note text..." : "Write text..."}
        />
      )}
    </div>
  );
}
