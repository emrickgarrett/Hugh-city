"use client";

import { useEffect, useRef } from "react";
import { playAchievementSound } from "@/app/utils/sounds";

interface UnlockToastProps {
  unlock: { tierName: string; count: number } | null;
  onDismiss: () => void;
}

export default function UnlockToast({ unlock, onDismiss }: UnlockToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const lastShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!unlock) return;
    const key = `${unlock.tierName}_${unlock.count}`;
    if (lastShownRef.current === key) return;
    lastShownRef.current = key;
    playAchievementSound();
    const timer = setTimeout(() => onDismissRef.current(), 4000);
    return () => clearTimeout(timer);
  }, [unlock]);

  if (!unlock) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 130,
        right: 10,
        zIndex: 2000,
        animation: "slideInRight 0.3s ease-out",
      }}
    >
      <div
        style={{
          background: "#1a3a4a",
          border: "2px solid",
          borderColor: "#32a8c8 #1a5a6b #1a5a6b #32a8c8",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          boxShadow:
            "2px 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(50,168,200,0.2)",
          minWidth: 280,
          maxWidth: 360,
        }}
      >
        <div style={{ fontSize: 28, flexShrink: 0 }}>🔓</div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              color: "#32c8e8",
              fontSize: 11,
              fontFamily: "var(--font-pixelify), monospace",
              fontWeight: "700",
              letterSpacing: "1px",
              textTransform: "uppercase",
              textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
            }}
          >
            Tier Unlocked!
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
            {unlock.tierName}
          </div>
          <div
            style={{
              color: "#88ccdd",
              fontSize: 10,
              fontFamily: "var(--font-pixelify), monospace",
              textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
              marginTop: 1,
            }}
          >
            {unlock.count} new building{unlock.count !== 1 ? "s" : ""} available
          </div>
        </div>

        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            color: "#32a8c8",
            fontSize: 16,
            cursor: "pointer",
            padding: "0 4px",
            fontFamily: "var(--font-pixelify), monospace",
          }}
        >
          X
        </button>
      </div>
    </div>
  );
}
