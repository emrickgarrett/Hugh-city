"use client";

import { CharacterType, MoodletType } from "@/app/components/game/types";
import { playDoubleClickSound, playClickSound } from "@/app/utils/sounds";

export interface CitizenListItem {
  id: string;
  name: string;
  money: number;
  characterType: CharacterType;
  hasResidence: boolean;
  residenceBuildingName?: string;
  moodlet?: MoodletType;
  moodletReason?: string;
}

interface CitizenListWindowProps {
  isVisible: boolean;
  onClose: () => void;
  citizens: CitizenListItem[];
  onCitizenClick: (citizenId: string) => void;
}

// Format currency
function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  return `${sign}$${absValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Get sprite image path for citizen type
const getCitizenSpritePath = (characterType: CharacterType): string => {
  if (characterType === CharacterType.Banana) {
    return `/Characters/bananawalksouth.gif`;
  } else if (characterType === CharacterType.Apple) {
    return `/Characters/applewalksouth.gif`;
  }
  return `/Characters/bananawalksouth.gif`;
};

// Get moodlet emoji
const getMoodletEmoji = (moodlet?: MoodletType): string => {
  switch (moodlet) {
    case "happy":
      return "😊";
    case "sad":
      return "😢";
    case "hungry":
      return "🍔";
    case "angry":
      return "😠";
    case "depressed":
      return "😔";
    default:
      return "";
  }
};

// Get moodlet color
const getMoodletColor = (moodlet?: MoodletType): string => {
  switch (moodlet) {
    case "happy":
      return "#00ff00";
    case "sad":
      return "#808080";
    case "hungry":
      return "#ffa500";
    case "angry":
      return "#ff0000";
    case "depressed":
      return "#4b0082";
    default:
      return "#888";
  }
};

export default function CitizenListWindow({
  isVisible,
  onClose,
  citizens,
  onCitizenClick,
}: CitizenListWindowProps) {
  if (!isVisible) return null;

  const GRAY_COLORS = {
    bg: "#B0B0B0",
    bgActive: "#909090",
    borderLight: "#D0D0D0",
    borderDark: "#707070",
    shadow: "#505050",
  };

  const homelessCount = citizens.filter((c) => !c.hasResidence).length;
  const housedCount = citizens.filter((c) => c.hasResidence).length;

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
        style={{
          background: GRAY_COLORS.bg,
          border: "3px solid",
          borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
          boxShadow: `inset 2px 2px 0px ${GRAY_COLORS.shadow}, 4px 4px 0px rgba(0,0,0,0.3)`,
          padding: "20px",
          minWidth: 450,
          maxWidth: 600,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div
          style={{
            fontSize: 24,
            fontWeight: "bold",
            fontFamily: "var(--font-pixelify), monospace",
            marginBottom: 15,
            textAlign: "center",
            color: "#000",
            textShadow: "1px 1px 0 rgba(255,255,255,0.5)",
          }}
        >
          👥 CITIZENS
        </div>

        {/* Stats Bar */}
        <div
          style={{
            background: "#000",
            border: "2px solid",
            borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
            padding: "10px",
            marginBottom: 15,
            display: "flex",
            justifyContent: "space-around",
          }}
        >
          <div
            style={{
              color: "#00ff00",
              fontSize: 14,
              fontWeight: "bold",
              fontFamily: "var(--font-pixelify), monospace",
            }}
          >
            Total: {citizens.length}
          </div>
          <div
            style={{
              color: "#00aaff",
              fontSize: 14,
              fontWeight: "bold",
              fontFamily: "var(--font-pixelify), monospace",
            }}
          >
            🏠 Housed: {housedCount}
          </div>
          <div
            style={{
              color: "#ffaa00",
              fontSize: 14,
              fontWeight: "bold",
              fontFamily: "var(--font-pixelify), monospace",
            }}
          >
            🚶 Homeless: {homelessCount}
          </div>
        </div>

        {/* Citizen List */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 200,
            maxHeight: 400,
          }}
        >
          {citizens.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: "#666",
                fontFamily: "var(--font-pixelify), monospace",
                fontSize: 16,
              }}
            >
              No citizens yet!
              <br />
              <span style={{ fontSize: 12 }}>Spawn some citizens to see them here.</span>
            </div>
          ) : (
            citizens.map((citizen) => (
              <div
                key={citizen.id}
                onClick={() => {
                  onCitizenClick(citizen.id);
                  playClickSound();
                }}
                style={{
                  background: citizen.hasResidence ? "#3a5a3a" : "#5a4a3a",
                  border: "2px solid",
                  borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
                  padding: "10px 12px",
                  boxShadow: `inset 1px 1px 0px ${GRAY_COLORS.shadow}`,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  transition: "filter 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.15)")}
                onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
              >
                {/* Sprite */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    backgroundColor: "#222",
                    border: "1px solid #444",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={getCitizenSpritePath(citizen.characterType)}
                    alt=""
                    style={{
                      width: 24,
                      height: 24,
                      imageRendering: "pixelated",
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                    }}
                  >
                    {citizen.moodlet && (
                      <span
                        style={{
                          fontSize: 16,
                          flexShrink: 0,
                          title: citizen.moodletReason || citizen.moodlet,
                        }}
                      >
                        {getMoodletEmoji(citizen.moodlet)}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: "bold",
                        fontFamily: "var(--font-pixelify), monospace",
                        color: "#fff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {citizen.name}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-pixelify), monospace",
                      color: "#aaa",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {citizen.hasResidence
                      ? `🏠 ${citizen.residenceBuildingName || "Home"}`
                      : "🚶 Looking for home"}
                  </div>
                </div>

                {/* Money */}
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                    color: citizen.money > 0 ? "#4ade80" : "#ff6b6b",
                    flexShrink: 0,
                  }}
                >
                  {formatCurrency(citizen.money)}
                </div>

                {/* Arrow */}
                <div
                  style={{
                    fontSize: 16,
                    color: "#888",
                    flexShrink: 0,
                  }}
                >
                  ›
                </div>
              </div>
            ))
          )}
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
    </div>
  );
}
