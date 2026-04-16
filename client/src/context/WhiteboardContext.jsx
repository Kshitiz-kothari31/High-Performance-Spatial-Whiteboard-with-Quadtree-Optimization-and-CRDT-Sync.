import { createContext, useContext, useMemo, useReducer } from "react";

import {
  DEFAULT_VIEWPORT,
  applyBoardAction,
  revertBoardAction,
} from "../lib/boardUtils";

const WhiteboardContext = createContext(null);

const initialState = {
  roomId: "",
  user: null,
  items: [],
  historyCount: 0,
  redoCount: 0,
  participants: [],
  cursors: [],
  tool: "select",
  lastDrawTool: "pen",
  color: "#202431",
  brushSize: 4,
  viewport: DEFAULT_VIEWPORT,
  hydrated: false,
  savedAt: null,
  selectedItemId: null,
};

function upsertById(items, nextItem, key = "id") {
  const index = items.findIndex((item) => item[key] === nextItem[key]);

  if (index === -1) {
    return [...items, nextItem];
  }

  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
}

function whiteboardReducer(state, action) {
  const drawTools = new Set(["pen", "highlighter", "eraser", "rectangle", "ellipse", "arrow"]);

  switch (action.type) {
    case "SET_USER":
      return {
        ...state,
        user: action.payload,
      };
    case "HYDRATE_ROOM":
      return {
        ...state,
        roomId: action.payload.roomId ?? state.roomId,
        items: action.payload.items ?? state.items,
        historyCount: typeof action.payload.historyCount === "number" ? action.payload.historyCount : state.historyCount,
        redoCount: typeof action.payload.redoCount === "number" ? action.payload.redoCount : state.redoCount,
        participants: action.payload.participants ?? state.participants,
        cursors: action.payload.cursors ?? state.cursors,
        savedAt: action.payload.savedAt !== undefined ? action.payload.savedAt : state.savedAt,
        hydrated: true,
      };
    case "APPLY_BOARD_ACTION":
      return {
        ...state,
        items: applyBoardAction(state.items, action.payload.action),
        historyCount: typeof action.payload.historyCount === "number" ? action.payload.historyCount : state.historyCount,
        redoCount: typeof action.payload.redoCount === "number" ? action.payload.redoCount : state.redoCount,
        savedAt: action.payload.savedAt !== undefined ? action.payload.savedAt : state.savedAt,
        selectedItemId:
          action.payload.action.type === "delete-item" &&
          state.selectedItemId === action.payload.action.item.id
            ? null
            : state.selectedItemId,
      };
    case "SET_PARTICIPANTS":
      return {
        ...state,
        participants: action.payload,
      };
    case "UPSERT_CURSOR":
      return {
        ...state,
        cursors: upsertById(state.cursors, action.payload, "userId"),
      };
    case "REMOVE_CURSOR":
      return {
        ...state,
        cursors: state.cursors.filter((cursor) => cursor.userId !== action.payload),
      };
    case "SET_TOOL":
      return {
        ...state,
        tool: action.payload,
        lastDrawTool: drawTools.has(action.payload) ? action.payload : state.lastDrawTool,
      };
    case "SET_COLOR":
      return {
        ...state,
        color: action.payload,
      };
    case "SET_BRUSH_SIZE":
      return {
        ...state,
        brushSize: action.payload,
      };
    case "SET_VIEWPORT":
      return {
        ...state,
        viewport: action.payload,
      };
    case "SET_SELECTED_ITEM":
      return {
        ...state,
        selectedItemId: action.payload,
      };
    default:
      return state;
  }
}

export function WhiteboardProvider({ children }) {
  const [state, dispatch] = useReducer(whiteboardReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <WhiteboardContext.Provider value={value}>{children}</WhiteboardContext.Provider>;
}

export function useWhiteboard() {
  const context = useContext(WhiteboardContext);

  if (!context) {
    throw new Error("useWhiteboard must be used inside WhiteboardProvider");
  }

  return context;
}
