"use client";

import { GameTime, GameSpeed } from "../game/types";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

interface TimeTrackerProps {
  gameTime: GameTime;
  gameSpeed: GameSpeed;
  onSpeedChange: (speed: GameSpeed) => void;
  positionRight?: number; // Optional: position from right edge (defaults to 2)
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Format time as HH:MM
function formatTime(hour: number, minute: number): string {
  const h = hour.toString().padStart(2, "0");
  const m = minute.toString().padStart(2, "0");
  return `${h}:${m}`;
}

// Get time of day label
function getTimeOfDay(hour: number): string {
  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  if (hour >= 18 && hour < 22) return "Evening";
  return "Night";
}

export default function TimeTracker({
  gameTime,
  gameSpeed,
  onSpeedChange,
  positionRight = 2,
}: TimeTrackerProps) {
  const GRAY_COLORS = {
    bg: "#5a5a5a",
    bgActive: "#3a3a3a",
    borderLight: "#7a7a7a",
    borderDark: "#3a3a3a",
    shadow: "#2a2a2a",
  };

  const speedLabels: Record<GameSpeed, string> = {
    [GameSpeed.Paused]: "⏸",
    [GameSpeed.Normal]: "▶",
    [GameSpeed.Fast]: "⏩",
  };

  const speedTooltips: Record<GameSpeed, string> = {
    [GameSpeed.Paused]: "Paused",
    [GameSpeed.Normal]: "Normal Speed",
    [GameSpeed.Fast]: "2x Speed",
  };

  const cycleSpeed = () => {
    const nextSpeed =
      gameSpeed === GameSpeed.Paused
        ? GameSpeed.Normal
        : gameSpeed === GameSpeed.Normal
        ? GameSpeed.Fast
        : GameSpeed.Paused;
    onSpeedChange(nextSpeed);
    playClickSound();
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: positionRight,
        zIndex: 1000,
        display: "flex",
        gap: 0,
        alignItems: "flex-start",
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Time Display */}
      <div
        style={{
          background: GRAY_COLORS.bg,
          border: "2px solid",
          borderColor: `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          borderTop: "none",
          padding: "8px 12px",
          minWidth: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `1px 1px 0px ${GRAY_COLORS.shadow}`,
        }}
      >
        {/* Inner inset panel */}
        <div
          style={{
            width: "100%",
            padding: "6px 10px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            background: "#000000",
            border: "1px solid",
            borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
            gap: 4,
          }}
        >
          {/* Date */}
          <div
            style={{
              color: "#00ff00",
              fontSize: 16,
              fontWeight: "700",
              fontFamily: "var(--font-pixelify), monospace",
              textShadow: "2px 2px 0 rgba(0, 0, 0, 0.9)",
              letterSpacing: "1px",
            }}
          >
            {MONTH_NAMES[gameTime.month - 1]} {gameTime.day}, {gameTime.year}
          </div>
          {/* Time */}
          <div
            style={{
              color: "#00ff00",
              fontSize: 18,
              fontWeight: "700",
              fontFamily: "var(--font-pixelify), monospace",
              textShadow: "2px 2px 0 rgba(0, 0, 0, 0.9)",
              letterSpacing: "1px",
            }}
          >
            {formatTime(gameTime.hour, gameTime.minute)}
          </div>
          {/* Time of Day */}
          <div
            style={{
              color: "#00cc00",
              fontSize: 12,
              fontFamily: "var(--font-pixelify), monospace",
              textShadow: "1px 1px 0 rgba(0, 0, 0, 0.9)",
            }}
          >
            {getTimeOfDay(gameTime.hour)}
          </div>
        </div>
      </div>

      {/* Speed Control Button */}
      <button
        onClick={cycleSpeed}
        title={speedTooltips[gameSpeed]}
        style={{
          background: gameSpeed === GameSpeed.Paused ? GRAY_COLORS.bgActive : GRAY_COLORS.bg,
          border: "2px solid",
          borderColor:
            gameSpeed === GameSpeed.Paused
              ? `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`
              : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 0,
          borderTop: "none",
          boxShadow:
            gameSpeed === GameSpeed.Paused
              ? `inset 1px 1px 0px ${GRAY_COLORS.shadow}`
              : `1px 1px 0px ${GRAY_COLORS.shadow}`,
          imageRendering: "pixelated",
          transition: "filter 0.1s",
          transform: gameSpeed === GameSpeed.Paused ? "translate(1px, 1px)" : "none",
          width: 48,
          height: 48,
          fontSize: 24,
          color: "#00ff00",
          fontFamily: "var(--font-pixelify), monospace",
        }}
        onMouseEnter={(e) =>
          gameSpeed !== GameSpeed.Paused &&
          (e.currentTarget.style.filter = "brightness(1.1)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
        onMouseDown={(e) => {
          if (gameSpeed === GameSpeed.Paused) return;
          e.currentTarget.style.filter = "brightness(0.9)";
          e.currentTarget.style.borderColor = `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`;
          e.currentTarget.style.transform = "translate(1px, 1px)";
          e.currentTarget.style.boxShadow = `inset 1px 1px 0px ${GRAY_COLORS.shadow}`;
        }}
        onMouseUp={(e) => {
          if (gameSpeed === GameSpeed.Paused) return;
          e.currentTarget.style.filter = "brightness(1.1)";
          e.currentTarget.style.borderColor = `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`;
          e.currentTarget.style.transform = "none";
          e.currentTarget.style.boxShadow = `1px 1px 0px ${GRAY_COLORS.shadow}`;
        }}
      >
        {speedLabels[gameSpeed]}
      </button>
    </div>
  );
}
