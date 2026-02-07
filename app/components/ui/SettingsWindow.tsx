"use client";

import React, { useState, useRef, useEffect } from "react";
import { playDoubleClickSound } from "@/app/utils/sounds";

interface SettingsWindowProps {
  isVisible: boolean;
  onClose: () => void;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  onMasterVolumeChange: (v: number) => void;
  onSfxVolumeChange: (v: number) => void;
  onMusicVolumeChange: (v: number) => void;
}

const GRAY_COLORS = {
  bg: "#B0B0B0",
  bgActive: "#909090",
  borderLight: "#D0D0D0",
  borderDark: "#707070",
  shadow: "#505050",
};

const HOTKEYS: { key: string; action: string }[] = [
  { key: "ESC", action: "Close window / Deselect tool" },
  { key: "1", action: "Toggle Build menu" },
  { key: "2", action: "Toggle Eraser" },
  { key: "3", action: "Toggle Road tool" },
  { key: "R", action: "Rotate building" },
  { key: "Space / P", action: "Pause / Unpause" },
  { key: "+ / =", action: "Speed up" },
  { key: "-", action: "Slow down" },
  { key: "Right-click", action: "Close window / Deselect" },
  { key: "Scroll", action: "Zoom in / out" },
];

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 0",
      }}
    >
      <span
        style={{
          width: 100,
          fontSize: 13,
          fontFamily: "var(--font-pixelify), monospace",
          fontWeight: "bold",
          color: "#fff",
          textShadow: "1px 1px 0 rgba(0,0,0,0.5)",
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(parseInt(e.target.value) / 100)}
        className="settings-volume-slider"
        style={{
          flex: 1,
          height: 20,
          cursor: "pointer",
        }}
      />
      <span
        style={{
          width: 36,
          fontSize: 12,
          fontFamily: "var(--font-pixelify), monospace",
          color: "#00ff00",
          textAlign: "right",
          textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
        }}
      >
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export default function SettingsWindow({
  isVisible,
  onClose,
  masterVolume,
  sfxVolume,
  musicVolume,
  onMasterVolumeChange,
  onSfxVolumeChange,
  onMusicVolumeChange,
}: SettingsWindowProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);

  // Reset position when window opens
  useEffect(() => {
    if (isVisible) {
      setPosition({ x: 0, y: 0 });
    }
  }, [isVisible]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      });
      setIsDragging(true);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - window.innerWidth / 2 - dragOffset.x,
          y: e.clientY - window.innerHeight / 2 - dragOffset.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        ref={windowRef}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{
          background: GRAY_COLORS.bg,
          border: "3px solid",
          borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
          boxShadow: `inset 2px 2px 0px ${GRAY_COLORS.shadow}, 4px 4px 0px rgba(0,0,0,0.3)`,
          padding: "20px",
          minWidth: 380,
          maxWidth: 440,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      >
        {/* Title */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            fontSize: 24,
            fontWeight: "bold",
            fontFamily: "var(--font-pixelify), monospace",
            marginBottom: 15,
            textAlign: "center",
            color: "#000",
            textShadow: "1px 1px 0 rgba(255,255,255,0.5)",
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          SETTINGS
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Volume Section */}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: "bold",
                fontFamily: "var(--font-pixelify), monospace",
                color: "#000",
                marginBottom: 8,
                textShadow: "1px 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              Volume
            </div>
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <VolumeSlider
                label="Master"
                value={masterVolume}
                onChange={onMasterVolumeChange}
              />
              <VolumeSlider
                label="Sound Effects"
                value={sfxVolume}
                onChange={onSfxVolumeChange}
              />
              <VolumeSlider
                label="Music"
                value={musicVolume}
                onChange={onMusicVolumeChange}
              />
            </div>
          </div>

          {/* Controls Section */}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: "bold",
                fontFamily: "var(--font-pixelify), monospace",
                color: "#000",
                marginBottom: 8,
                textShadow: "1px 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              Controls
            </div>
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "10px 14px",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "var(--font-pixelify), monospace",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        color: "#888",
                        fontSize: 10,
                        fontWeight: "bold",
                        paddingBottom: 6,
                        borderBottom: "1px solid #333",
                      }}
                    >
                      KEY
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        color: "#888",
                        fontSize: 10,
                        fontWeight: "bold",
                        paddingBottom: 6,
                        borderBottom: "1px solid #333",
                      }}
                    >
                      ACTION
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {HOTKEYS.map((hotkey, i) => (
                    <tr key={i}>
                      <td
                        style={{
                          padding: "4px 8px 4px 0",
                          color: "#00ff00",
                          fontWeight: "bold",
                          whiteSpace: "nowrap",
                          borderBottom: i < HOTKEYS.length - 1 ? "1px solid #222" : "none",
                        }}
                      >
                        {hotkey.key}
                      </td>
                      <td
                        style={{
                          padding: "4px 0",
                          color: "#ccc",
                          borderBottom: i < HOTKEYS.length - 1 ? "1px solid #222" : "none",
                        }}
                      >
                        {hotkey.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Close button */}
        <div style={{ marginTop: 15, textAlign: "center" }}>
          <button
            onClick={() => {
              onClose();
              playDoubleClickSound();
            }}
            style={{
              background: "#6b2a2a",
              border: "2px solid",
              borderColor: "#ab6a6a #4a1a1a #4a1a1a #ab6a6a",
              padding: "10px 20px",
              cursor: "pointer",
              fontFamily: "var(--font-pixelify), monospace",
              fontSize: 16,
              fontWeight: "bold",
              color: "#fff",
              boxShadow: "1px 1px 0px #2a0a0a",
              imageRendering: "pixelated",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            onMouseDown={(e) => {
              e.currentTarget.style.filter = "brightness(0.9)";
              e.currentTarget.style.borderColor = "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
              e.currentTarget.style.transform = "translate(1px, 1px)";
              e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.filter = "brightness(1.1)";
              e.currentTarget.style.borderColor = "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
            }}
          >
            CLOSE
          </button>
        </div>
      </div>

      <style>{`
        .settings-volume-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
        }

        .settings-volume-slider::-webkit-slider-runnable-track {
          height: 8px;
          background: #333;
          border: 1px solid #555;
          border-radius: 0;
        }

        .settings-volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 20px;
          background: #B0B0B0;
          border: 2px solid;
          border-color: #D0D0D0 #707070 #707070 #D0D0D0;
          border-radius: 0;
          margin-top: -7px;
          cursor: pointer;
          box-shadow: 1px 1px 0px #505050;
        }

        .settings-volume-slider::-webkit-slider-thumb:hover {
          background: #C8C8C8;
        }

        .settings-volume-slider::-webkit-slider-thumb:active {
          background: #909090;
          border-color: #707070 #D0D0D0 #D0D0D0 #707070;
          box-shadow: inset 1px 1px 0px #505050;
        }

        .settings-volume-slider::-moz-range-track {
          height: 8px;
          background: #333;
          border: 1px solid #555;
          border-radius: 0;
        }

        .settings-volume-slider::-moz-range-thumb {
          width: 16px;
          height: 20px;
          background: #B0B0B0;
          border: 2px solid;
          border-color: #D0D0D0 #707070 #707070 #D0D0D0;
          border-radius: 0;
          cursor: pointer;
          box-shadow: 1px 1px 0px #505050;
        }

        .settings-volume-slider::-moz-range-thumb:hover {
          background: #C8C8C8;
        }

        .settings-volume-slider::-moz-range-thumb:active {
          background: #909090;
          border-color: #707070 #D0D0D0 #D0D0D0 #707070;
          box-shadow: inset 1px 1px 0px #505050;
        }
      `}</style>
    </div>
  );
}
