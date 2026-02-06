"use client";

import { useEffect, useRef } from "react";
import { AchievementDefinition } from "@/app/data/achievements";
import { playOpenSound } from "@/app/utils/sounds";

interface AchievementToastProps {
  achievement: AchievementDefinition | null;
  onDismiss: () => void;
}

export default function AchievementToast({ achievement, onDismiss }: AchievementToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const lastPlayedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!achievement) return;
    // Only play sound once per unique achievement
    if (lastPlayedIdRef.current === achievement.id) return;
    lastPlayedIdRef.current = achievement.id;
    playOpenSound();
    const timer = setTimeout(() => onDismissRef.current(), 4000);
    return () => clearTimeout(timer);
  }, [achievement]);

  if (!achievement) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 70,
        right: 10,
        zIndex: 2000,
        animation: "slideInRight 0.3s ease-out",
      }}
    >
      <div
        style={{
          background: "#4a3a10",
          border: "2px solid",
          borderColor: "#c8a832 #6b5a20 #6b5a20 #c8a832",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow: "2px 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,215,0,0.2)",
          minWidth: 280,
          maxWidth: 360,
        }}
      >
        {/* Trophy icon */}
        <div style={{ fontSize: 28, flexShrink: 0 }}>
          {achievement.icon}
        </div>

        {/* Text */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: "#ffd700",
              fontSize: 11,
              fontFamily: "var(--font-pixelify), monospace",
              fontWeight: "700",
              letterSpacing: "1px",
              textTransform: "uppercase",
              textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
            }}
          >
            Achievement Unlocked!
          </div>
          <div
            style={{
              color: "#fff",
              fontSize: 14,
              fontFamily: "var(--font-pixelify), monospace",
              fontWeight: "700",
              textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
              marginTop: 2,
            }}
          >
            {achievement.title}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            color: "#c8a832",
            fontSize: 16,
            cursor: "pointer",
            padding: "0 4px",
            fontFamily: "var(--font-pixelify), monospace",
          }}
        >
          X
        </button>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
