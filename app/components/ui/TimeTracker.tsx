"use client";

import { GameTime, GameSpeed } from "../game/types";
import { playClickSound } from "@/app/utils/sounds";

interface TimeTrackerProps {
  gameTime: GameTime;
  gameSpeed: GameSpeed;
  onSpeedChange: (speed: GameSpeed) => void;
  dayNightEnabled?: boolean;
  onDayNightToggle?: (enabled: boolean) => void;
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
  if (hour >= 5 && hour < 7) return "Dawn";
  if (hour >= 7 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 18.5) return "Sunset";
  if (hour >= 18.5 && hour < 20) return "Dusk";
  return "Night";
}

// Get color for time-of-day label based on the current phase
function getTimeOfDayColor(hour: number, dayNightEnabled: boolean): string {
  if (!dayNightEnabled) return "#00cc00"; // Default green when cycle is off
  if (hour >= 5 && hour < 7) return "#ffaa44"; // Dawn - warm orange
  if (hour >= 7 && hour < 17) return "#00cc00"; // Day - green
  if (hour >= 17 && hour < 18.5) return "#ff8844"; // Sunset - orange
  if (hour >= 18.5 && hour < 20) return "#8888cc"; // Dusk - blue-purple
  return "#6666bb"; // Night - blue
}

const GRAY_COLORS = {
  bg: "#5a5a5a",
  bgActive: "#3a3a3a",
  borderLight: "#7a7a7a",
  borderDark: "#3a3a3a",
  shadow: "#2a2a2a",
};

/**
 * TimeTracker renders inline (no absolute positioning) — the parent
 * container in GameBoard handles top-right placement.
 * Renders: time display panel, day/night toggle, speed button.
 */
export default function TimeTracker({
  gameTime,
  gameSpeed,
  onSpeedChange,
  dayNightEnabled = true,
  onDayNightToggle,
}: TimeTrackerProps) {
  const speedLabels: Record<GameSpeed, string> = {
    [GameSpeed.Paused]: "\u23F8",
    [GameSpeed.Normal]: "\u25B6",
    [GameSpeed.Fast]: "\u23E9",
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

  const toggleDayNight = () => {
    onDayNightToggle?.(!dayNightEnabled);
    playClickSound();
  };

  const timeOfDayColor = getTimeOfDayColor(gameTime.hour, dayNightEnabled);

  return (
    <>
      {/* Time Display */}
      <div
        style={{
          background: GRAY_COLORS.bg,
          border: "2px solid",
          borderColor: `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          borderTopWidth: 0,
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
              color: timeOfDayColor,
              fontSize: 12,
              fontFamily: "var(--font-pixelify), monospace",
              textShadow: "1px 1px 0 rgba(0, 0, 0, 0.9)",
              transition: "color 2s ease",
            }}
          >
            {getTimeOfDay(gameTime.hour)}
          </div>
        </div>
      </div>

      {/* Day/Night Cycle Toggle */}
      <button
        onClick={toggleDayNight}
        title={dayNightEnabled ? "Day/Night Cycle: ON" : "Day/Night Cycle: OFF"}
        style={{
          background: dayNightEnabled ? GRAY_COLORS.bgActive : GRAY_COLORS.bg,
          border: "2px solid",
          borderColor: dayNightEnabled
            ? `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`
            : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 0,
          borderTopWidth: 0,
          boxShadow: dayNightEnabled
            ? `inset 1px 1px 0px ${GRAY_COLORS.shadow}`
            : `1px 1px 0px ${GRAY_COLORS.shadow}`,
          imageRendering: "pixelated",
          transition: "filter 0.1s",
          transform: dayNightEnabled ? "translate(1px, 1px)" : "none",
          width: 48,
          height: 48,
          fontSize: 22,
          color: "#00ff00",
          fontFamily: "var(--font-pixelify), monospace",
        }}
        onMouseEnter={(e) =>
          !dayNightEnabled &&
          (e.currentTarget.style.filter = "brightness(1.1)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      >
        {dayNightEnabled ? "\uD83C\uDF19" : "\u2600\uFE0F"}
      </button>

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
          borderTopWidth: 0,
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
    </>
  );
}
