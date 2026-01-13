"use client";

import { useState, useRef, useEffect } from "react";
import { getBuilding } from "@/app/data/buildings";
import { CharacterType, MoodletType, Moodlet } from "@/app/components/game/types";

export interface CitizenData {
  id: string;
  name: string;
  money: number;
  dailyBudget: number;
  characterType: CharacterType;
  residenceX?: number;
  residenceY?: number;
  residenceBuildingId?: string;
  rentPaid: boolean;
  state?: "wandering" | "heading_to_building" | "at_building" | "heading_home" | "resting_at_home" | "leaving_city";
  destinationBuildingName?: string;
  moodlet?: MoodletType;
  moodletReason?: string;
  ateToday?: boolean;
  entertainedToday?: boolean;
}

interface CitizenInfoWindowProps {
  isVisible: boolean;
  onClose: () => void;
  citizen: CitizenData | null;
  onNameChange: (citizenId: string, newName: string) => void;
  monthlyRent: number; // Rent they need to pay
}

// Helper to format currency
const formatCurrency = (amount: number): string => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  return `${isNegative ? "-" : ""}$${absAmount.toLocaleString()}`;
};

// Get sprite image path for citizen type
const getCitizenSpritePath = (characterType: CharacterType): string => {
  // CharacterType enum values are "banana" or "apple"
  // Use the south-facing walk animation as the profile picture
  if (characterType === CharacterType.Banana) {
    return `/Characters/bananawalksouth.gif`;
  } else if (characterType === CharacterType.Apple) {
    return `/Characters/applewalksouth.gif`;
  }
  // Fallback
  return `/Characters/bananawalksouth.gif`;
};

// Get moodlet display info (RollerCoaster Tycoon style)
const getMoodletDisplay = (moodlet?: MoodletType, reason?: string): Moodlet | null => {
  if (!moodlet) return null;
  
  switch (moodlet) {
    case "happy":
      return {
        type: "happy",
        emoji: "😊",
        reason: reason || "I'm feeling great!",
        color: "#00ff00", // Bright green
      };
    case "sad":
      return {
        type: "sad",
        emoji: "😢",
        reason: reason || "I'm feeling down",
        color: "#808080", // Gray
      };
    case "hungry":
      return {
        type: "hungry",
        emoji: "🍔",
        reason: reason || "I need to eat!",
        color: "#ffa500", // Orange
      };
    case "angry":
      return {
        type: "angry",
        emoji: "😠",
        reason: reason || "I'm frustrated",
        color: "#ff0000", // Red
      };
    case "depressed":
      return {
        type: "depressed",
        emoji: "😔",
        reason: reason || "I'm feeling hopeless",
        color: "#4b0082", // Indigo
      };
    default:
      return null;
  }
};

// Get friendly description of citizen's current activity
const getActivityDescription = (
  state?: string,
  destinationBuildingName?: string,
  hasResidence?: boolean
): { emoji: string; text: string; color: string } => {
  switch (state) {
    case "resting_at_home":
      return {
        emoji: "😴",
        text: "Resting at home (out of money)",
        color: "#94a3b8",
      };
    case "leaving_city":
      return {
        emoji: "🚶",
        text: "Leaving the city...",
        color: "#ff6b6b",
      };
    case "heading_home":
      return {
        emoji: "🏠",
        text: "Heading home",
        color: "#60a5fa",
      };
    case "heading_to_building":
      if (destinationBuildingName) {
        return {
          emoji: "🚶",
          text: `Walking to ${destinationBuildingName}`,
          color: "#4ade80",
        };
      }
      return {
        emoji: "🚶",
        text: hasResidence ? "Looking for a place to visit" : "Looking for housing",
        color: "#fbbf24",
      };
    case "at_building":
      if (destinationBuildingName) {
        return {
          emoji: "🏪",
          text: `Visiting ${destinationBuildingName}`,
          color: "#60a5fa",
        };
      }
      return {
        emoji: "🏪",
        text: "At a building",
        color: "#60a5fa",
      };
    case "heading_home":
      return {
        emoji: "🏠",
        text: "Heading home",
        color: "#a78bfa",
      };
    case "wandering":
    default:
      return {
        emoji: "🔄",
        text: "Wandering around",
        color: "#9ca3af",
      };
  }
};

export default function CitizenInfoWindow({
  isVisible,
  onClose,
  citizen,
  onNameChange,
  monthlyRent,
}: CitizenInfoWindowProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
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

  if (!isVisible || !citizen) return null;

  const residenceBuilding = citizen.residenceBuildingId 
    ? getBuilding(citizen.residenceBuildingId) 
    : null;

  const canAffordRent = citizen.money >= monthlyRent;

  const handleStartEdit = () => {
    setEditedName(citizen.name);
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    if (editedName.trim()) {
      onNameChange(citizen.id, editedName.trim());
    }
    setIsEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop propagation to prevent Phaser from capturing the key
    e.stopPropagation();
    
    if (e.key === "Enter") {
      handleSaveName();
    } else if (e.key === "Escape") {
      setIsEditingName(false);
    }
  };

  return (
    <div
      ref={windowRef}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        minWidth: 320,
        maxWidth: 400,
        backgroundColor: "#c0c0c0",
        border: "2px solid",
        borderColor: "#ffffff #808080 #808080 #ffffff",
        boxShadow: "4px 4px 0 rgba(0,0,0,0.5)",
        fontFamily: '"MS Sans Serif", "Segoe UI", Tahoma, sans-serif',
        fontSize: 12,
      }}
    >
      {/* Title Bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 4px",
          background: "linear-gradient(90deg, #000080, #1084d0)",
          color: "white",
          fontWeight: "bold",
          fontSize: 12,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          👤 Citizen Profile
        </span>
        <button
          onClick={onClose}
          style={{
            width: 16,
            height: 14,
            backgroundColor: "#c0c0c0",
            border: "1px solid",
            borderColor: "#ffffff #808080 #808080 #ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: "bold",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: 12 }}>
        {/* Citizen Header with Sprite */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            padding: 8,
            backgroundColor: "#ffffff",
            border: "1px solid #808080",
          }}
        >
          {/* Sprite Preview */}
          <div
            style={{
              width: 64,
              height: 64,
              backgroundColor: "#e0e0e0",
              border: "1px solid #808080",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <img
              src={getCitizenSpritePath(citizen.characterType)}
              alt="Citizen"
              style={{
                width: 48,
                height: 48,
                imageRendering: "pixelated",
                objectFit: "contain",
              }}
              onError={(e) => {
                // Fallback if image fails to load - show emoji instead
                const target = e.target as HTMLImageElement;
                target.style.display = "none";
                target.parentElement!.innerHTML = "👤";
              }}
            />
          </div>

          {/* Name Section */}
          <div style={{ flex: 1 }}>
            {isEditingName ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={(e) => e.stopPropagation()}
                  onKeyPress={(e) => e.stopPropagation()}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "2px 4px",
                    border: "1px solid #808080",
                    fontFamily: "inherit",
                    fontSize: 14,
                  }}
                  maxLength={20}
                />
                <button
                  onClick={handleSaveName}
                  style={{
                    padding: "2px 8px",
                    backgroundColor: "#c0c0c0",
                    border: "1px solid",
                    borderColor: "#ffffff #808080 #808080 #ffffff",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  ✓
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: "bold", fontSize: 14 }}>
                  {citizen.name}
                </span>
                <button
                  onClick={handleStartEdit}
                  style={{
                    padding: "1px 6px",
                    backgroundColor: "#c0c0c0",
                    border: "1px solid",
                    borderColor: "#ffffff #808080 #808080 #ffffff",
                    cursor: "pointer",
                    fontSize: 10,
                  }}
                  title="Edit name"
                >
                  ✏️
                </button>
              </div>
            )}
            <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>
              ID: {citizen.id.slice(0, 8)}
            </div>
          </div>
        </div>

        {/* Finances */}
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            backgroundColor: "#ffffff",
            border: "1px solid #808080",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              marginBottom: 8,
              borderBottom: "1px solid #ccc",
              paddingBottom: 4,
            }}
          >
            💰 Finances
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              marginBottom: 4,
            }}
          >
            <span>Current Money:</span>
            <span
              style={{
                color: citizen.money > 0 ? "#008000" : "#cc0000",
                fontWeight: "bold",
              }}
            >
              {formatCurrency(citizen.money)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              marginBottom: 4,
            }}
          >
            <span>Daily Budget:</span>
            <span style={{ fontWeight: "bold" }}>
              {formatCurrency(citizen.dailyBudget)}/day
            </span>
          </div>
          {citizen.residenceX !== undefined && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid #ccc",
                }}
              >
                <span>Monthly Rent:</span>
                <span style={{ color: "#cc0000", fontWeight: "bold" }}>
                  {formatCurrency(monthlyRent)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                <span>Rent Status:</span>
                <span
                  style={{
                    color: citizen.rentPaid ? "#008000" : canAffordRent ? "#cc8800" : "#cc0000",
                    fontWeight: "bold",
                  }}
                >
                  {citizen.rentPaid ? "✓ Paid" : canAffordRent ? "⏳ Due" : "⚠️ Can't Afford!"}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Current Activity */}
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            backgroundColor: "#ffffff",
            border: "1px solid #808080",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              marginBottom: 8,
              borderBottom: "1px solid #ccc",
              paddingBottom: 4,
            }}
          >
            📍 Current Activity
          </div>
          {(() => {
            const activity = getActivityDescription(
              citizen.state,
              citizen.destinationBuildingName,
              citizen.residenceX !== undefined
            );
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span style={{ fontSize: 18 }}>{activity.emoji}</span>
                <span style={{ color: activity.color, fontWeight: "bold" }}>
                  {activity.text}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Moodlet Display (RollerCoaster Tycoon Style) */}
        {(() => {
          const moodletDisplay = getMoodletDisplay(citizen.moodlet, citizen.moodletReason);
          if (!moodletDisplay) return null;
          
          return (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                backgroundColor: "#f0f0f0",
                border: "2px solid",
                borderColor: moodletDisplay.color,
                borderRadius: 4,
                boxShadow: `0 0 8px ${moodletDisplay.color}40`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>
                  {moodletDisplay.emoji}
                </span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: "bold",
                      color: moodletDisplay.color,
                      textShadow: "1px 1px 2px rgba(0,0,0,0.3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {moodletDisplay.type}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#333",
                      marginTop: 2,
                      fontStyle: "italic",
                    }}
                  >
                    {moodletDisplay.reason}
                  </div>
                </div>
              </div>
              
              {/* Needs status */}
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid #ccc",
                  fontSize: 10,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{citizen.ateToday ? "✅" : "❌"}</span>
                  <span style={{ color: citizen.ateToday ? "#008000" : "#cc0000" }}>
                    {citizen.ateToday ? "Fed" : "Hungry"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{citizen.entertainedToday ? "✅" : "❌"}</span>
                  <span style={{ color: citizen.entertainedToday ? "#008000" : "#cc0000" }}>
                    {citizen.entertainedToday ? "Entertained" : "Bored"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{citizen.residenceX !== undefined ? "✅" : "❌"}</span>
                  <span style={{ color: citizen.residenceX !== undefined ? "#008000" : "#cc0000" }}>
                    {citizen.residenceX !== undefined ? "Housed" : "Homeless"}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Residence */}
        <div
          style={{
            padding: 8,
            backgroundColor: "#ffffff",
            border: "1px solid #808080",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              marginBottom: 8,
              borderBottom: "1px solid #ccc",
              paddingBottom: 4,
            }}
          >
            🏠 Residence
          </div>
          {citizen.residenceX !== undefined && citizen.residenceY !== undefined ? (
            <>
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                <strong>Building:</strong> {residenceBuilding?.name || "Unknown"}
              </div>
              <div style={{ fontSize: 11, color: "#666" }}>
                Location: ({citizen.residenceX}, {citizen.residenceY})
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>
              🚶 Homeless - Looking for housing
            </div>
          )}
        </div>
      </div>

      {/* Close Button */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #808080",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: "4px 24px",
            backgroundColor: "#c0c0c0",
            border: "2px solid",
            borderColor: "#ffffff #808080 #808080 #ffffff",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
