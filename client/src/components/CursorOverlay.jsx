import { worldToScreen } from "../lib/boardUtils";

const CURSOR_COLORS = [
  "#FF3366", "#FF9933", "#33CC99", "#3399FF", 
  "#9933FF", "#E91E63", "#00BCD4", "#8BC34A"
];

function getCursorColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

export default function CursorOverlay({ cursors, viewport, boardSize, currentUserId }) {
  return (
    <div className="cursor-layer" style={{ zIndex: 100 }} aria-hidden="true">
      {cursors
        .filter((cursor) => {
          const isRemote = cursor.userId !== currentUserId;
          // if (!isRemote) console.log("🔍 Filtering out local cursor:", cursor.userId);
          return isRemote;
        })
        .map((cursor) => {
          console.log("👥 Rendering remote cursor:", cursor.userId, "at world", cursor.x, cursor.y);
          const screen = worldToScreen(cursor, viewport);
          const isVisible =
            screen.x >= -40 &&
            screen.y >= -40 &&
            screen.x <= boardSize.width + 40 &&
            screen.y <= boardSize.height + 40;

          console.log("🖥️ Screen pos:", screen, "Board size:", boardSize, "Visible:", isVisible);

          if (!isVisible) {
            return null;
          }

          const color = getCursorColor(cursor.userId);

          return (
            <div
              key={cursor.userId}
              className="cursor-badge"
              style={{
                transform: `translate(${screen.x}px, ${screen.y}px)`,
              }}
            >
              <svg 
                className="cursor-pointer-icon" 
                width="24" 
                height="36" 
                viewBox="0 0 24 36" 
                fill="none" 
                style={{ 
                  color: color, 
                  filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.15))" 
                }}
              >
                <path 
                  d="M5.65376 21.2081L2.17915 2.50091C2.08332 1.98464 2.56499 1.54519 3.07223 1.68453L22.0406 6.89598C22.5694 7.0413 22.6849 7.74797 22.2541 8.0461L14.7335 13.2505C14.5422 13.383 14.4172 13.5852 14.3857 13.8213L13.1438 21.9427C13.0617 22.4795 12.3551 22.6648 11.9961 22.2471L5.65376 21.2081Z" 
                  fill="currentColor" 
                  stroke="white" 
                  strokeWidth="2" 
                  strokeLinejoin="round"
                />
              </svg>
              <span className="cursor-name" style={{ backgroundColor: color }}>{cursor.name}</span>
            </div>
          );
        })}
    </div>
  );
}
