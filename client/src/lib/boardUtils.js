export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  scale: 1,
};

export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 2.4;

export function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function applyBoardAction(items, action) {
  if (action.type === "create-item") {
    if (items.some((item) => item.id === action.item.id)) {
      return items;
    }

    return [...items, action.item];
  }

  if (action.type === "update-item") {
    return items.map((item) => (item.id === action.nextItem.id ? action.nextItem : item));
  }

  if (action.type === "delete-item") {
    return items.filter((item) => item.id !== action.item.id);
  }

  if (action.type === "clear-board") {
    return [];
  }

  return items;
}

export function revertBoardAction(items, action) {
  if (action.type === "create-item") {
    return items.filter((item) => item.id !== action.item.id);
  }

  if (action.type === "update-item") {
    return items.map((item) => (item.id === action.previousItem.id ? action.previousItem : item));
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

export function worldToScreen(point, viewport) {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function screenToWorld(point, viewport) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function zoomViewportAtPoint(viewport, nextScale, anchorPoint) {
  const worldPoint = screenToWorld(anchorPoint, viewport);

  return {
    scale: nextScale,
    x: anchorPoint.x - worldPoint.x * nextScale,
    y: anchorPoint.y - worldPoint.y * nextScale,
  };
}

export function getRectFromPoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );

  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;

  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

function estimateTextMetrics(item) {
  const fontSize = item.fontSize || 24;
  const lines = String(item.text || "")
    .split("\n")
    .filter(Boolean);

  return {
    width: Math.max(160, ...lines.map((line) => line.length * fontSize * 0.54), 160),
    height: Math.max(fontSize * 1.6, lines.length * fontSize * 1.35),
  };
}

export function getItemBounds(item) {
  if (item.kind === "stroke") {
    const padding = (item.size || 4) * 1.5;
    const xs = item.points.map((point) => point.x);
    const ys = item.points.map((point) => point.y);

    return {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(...xs) - Math.min(...xs) + padding * 2,
      height: Math.max(...ys) - Math.min(...ys) + padding * 2,
    };
  }

  if (item.kind === "shape") {
    const rect = getRectFromPoints(item.start, item.end);

    return {
      x: rect.x - (item.size || 3),
      y: rect.y - (item.size || 3),
      width: rect.width + (item.size || 3) * 2,
      height: rect.height + (item.size || 3) * 2,
    };
  }

  if (item.kind === "text") {
    const metrics = estimateTextMetrics(item);

    return {
      x: item.x - 8,
      y: item.y - (item.fontSize || 24),
      width: metrics.width + 16,
      height: metrics.height + 12,
    };
  }

  if (item.kind === "sticky") {
    return {
      x: item.x,
      y: item.y,
      width: item.width || 220,
      height: item.height || 180,
    };
  }

  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
}

export function translateItem(item, dx, dy) {
  if (item.kind === "stroke") {
    return {
      ...item,
      points: item.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      })),
    };
  }

  if (item.kind === "shape") {
    return {
      ...item,
      start: {
        x: item.start.x + dx,
        y: item.start.y + dy,
      },
      end: {
        x: item.end.x + dx,
        y: item.end.y + dy,
      },
    };
  }

  if (item.kind === "text") {
    return {
      ...item,
      x: item.x + dx,
      y: item.y + dy,
    };
  }

  if (item.kind === "sticky") {
    return {
      ...item,
      x: item.x + dx,
      y: item.y + dy,
    };
  }

  return item;
}

export function hitTestItem(point, item) {
  if (item.kind === "stroke") {
    for (let index = 0; index < item.points.length - 1; index += 1) {
      const distance = pointToSegmentDistance(point, item.points[index], item.points[index + 1]);

      if (distance <= (item.size || 4) + 6) {
        return true;
      }
    }

    return false;
  }

  if (item.kind === "shape") {
    const rect = getRectFromPoints(item.start, item.end);
    const tolerance = (item.size || 3) + 8;

    if (item.shapeType === "rectangle") {
      const onVerticalEdge =
        point.x >= rect.x - tolerance &&
        point.x <= rect.x + rect.width + tolerance &&
        (Math.abs(point.y - rect.y) <= tolerance ||
          Math.abs(point.y - (rect.y + rect.height)) <= tolerance);
      const onHorizontalEdge =
        point.y >= rect.y - tolerance &&
        point.y <= rect.y + rect.height + tolerance &&
        (Math.abs(point.x - rect.x) <= tolerance ||
          Math.abs(point.x - (rect.x + rect.width)) <= tolerance);

      return onVerticalEdge || onHorizontalEdge;
    }

    if (item.shapeType === "ellipse") {
      const radiusX = Math.max(rect.width / 2, 1);
      const radiusY = Math.max(rect.height / 2, 1);
      const centerX = rect.x + radiusX;
      const centerY = rect.y + radiusY;
      const value =
        ((point.x - centerX) * (point.x - centerX)) / (radiusX * radiusX) +
        ((point.y - centerY) * (point.y - centerY)) / (radiusY * radiusY);

      return value >= 0.76 && value <= 1.24;
    }

    return pointToSegmentDistance(point, item.start, item.end) <= tolerance;
  }

  const bounds = getItemBounds(item);

  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let nextY = y;

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;

    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, nextY);
      line = word;
      nextY += lineHeight;
      return;
    }

    line = candidate;
  });

  if (line) {
    context.fillText(line, x, nextY);
  }
}

export function drawBoardItem(context, item) {
  context.save();

  if (item.kind === "stroke") {
    context.globalAlpha = typeof item.opacity === "number" ? item.opacity : 1;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = item.color;
    context.fillStyle = item.color;
    context.lineWidth = item.size || 4;

    if (item.points.length === 1) {
      const point = item.points[0];
      context.beginPath();
      context.arc(point.x, point.y, (item.size || 4) / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    context.beginPath();
    context.moveTo(item.points[0].x, item.points[0].y);

    if (item.points.length === 2) {
      context.lineTo(item.points[1].x, item.points[1].y);
    } else {
      let i = 1;
      for (; i < item.points.length - 1; i++) {
        const xc = (item.points[i].x + item.points[i + 1].x) / 2;
        const yc = (item.points[i].y + item.points[i + 1].y) / 2;
        context.quadraticCurveTo(item.points[i].x, item.points[i].y, xc, yc);
      }
      context.lineTo(item.points[i].x, item.points[i].y);
    }

    context.stroke();
    context.restore();
    return;
  }

  if (item.kind === "shape") {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = item.color;
    context.lineWidth = item.size || 3;
    const rect = getRectFromPoints(item.start, item.end);

    if (item.shapeType === "rectangle") {
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    } else if (item.shapeType === "ellipse") {
      context.beginPath();
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        Math.max(rect.width / 2, 1),
        Math.max(rect.height / 2, 1),
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else {
      const angle = Math.atan2(item.end.y - item.start.y, item.end.x - item.start.x);
      const arrowSize = 14 + (item.size || 3);

      context.beginPath();
      context.moveTo(item.start.x, item.start.y);
      context.lineTo(item.end.x, item.end.y);
      context.stroke();

      context.beginPath();
      context.moveTo(item.end.x, item.end.y);
      context.lineTo(
        item.end.x - arrowSize * Math.cos(angle - Math.PI / 7),
        item.end.y - arrowSize * Math.sin(angle - Math.PI / 7),
      );
      context.lineTo(
        item.end.x - arrowSize * Math.cos(angle + Math.PI / 7),
        item.end.y - arrowSize * Math.sin(angle + Math.PI / 7),
      );
      context.closePath();
      context.fillStyle = item.color;
      context.fill();
    }

    context.restore();
    return;
  }

  if (item.kind === "text") {
    const fontSize = item.fontSize || 24;
    context.font = `700 ${fontSize}px "Avenir Next", "Segoe UI", sans-serif`;
    context.fillStyle = item.color;
    context.textBaseline = "alphabetic";
    item.text.split("\n").forEach((line, index) => {
      context.fillText(line, item.x, item.y + index * fontSize * 1.28);
    });
    context.restore();
    return;
  }

  if (item.kind === "sticky") {
    const width = item.width || 220;
    const height = item.height || 180;
    drawRoundedRect(context, item.x, item.y, width, height, 24);
    context.fillStyle = item.color;
    context.fill();
    context.shadowColor = "rgba(23, 31, 56, 0.08)";
    context.shadowBlur = 22;
    context.shadowOffsetY = 10;
    context.fill();
    context.shadowColor = "transparent";

    context.fillStyle = "#2B2F3A";
    context.font = `700 22px "Avenir Next", "Segoe UI", sans-serif`;
    drawWrappedText(context, item.text, item.x + 18, item.y + 36, width - 36, 28);
    context.restore();
  }
}

export function drawSelectionOutline(context, item) {
  const bounds = getItemBounds(item);

  context.save();
  context.strokeStyle = "#4B67FF";
  context.lineWidth = 2;
  context.setLineDash([10, 8]);
  context.strokeRect(bounds.x - 8, bounds.y - 8, bounds.width + 16, bounds.height + 16);
  context.restore();
}

export function drawGrid(context, width, height, viewport) {
  context.save();
  context.fillStyle = "#f7f5ef";
  context.fillRect(0, 0, width, height);

  const minorGap = 48;
  const majorGap = minorGap * 5;

  const drawLines = (gap, color) => {
    const offsetX = ((viewport.x % gap) + gap) % gap;
    const offsetY = ((viewport.y % gap) + gap) % gap;

    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 1;

    for (let x = offsetX; x <= width; x += gap) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }

    for (let y = offsetY; y <= height; y += gap) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }

    context.stroke();
  };

  drawLines(minorGap, "#ece7db");
  drawLines(majorGap, "#e2dccd");
  context.restore();
}

export function formatLastSaved(savedAt) {
  if (!savedAt) {
    return "Autosave pending";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - new Date(savedAt).getTime()) / 1000));

  if (seconds < 5) {
    return "Saved just now";
  }

  if (seconds < 60) {
    return `Saved ${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  return `Saved ${minutes}m ago`;
}
