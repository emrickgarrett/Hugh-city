"use client";

import { useState, useEffect, useRef, memo } from "react";
import { ACHIEVEMENTS, AchievementCategory, CATEGORY_LABELS } from "@/app/data/achievements";
import { loadAchievements, UnlockedAchievement } from "@/app/utils/achievementStore";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

export interface AchievementProgressData {
  housedCitizens: number;
  dailyRevenue: number;
  totalBuildingsPlaced: number;
  totalDemolitions: number;
  homelessLeft: number;
  carCount: number;
  midnightWitnessed: boolean;
  tracksPlayedCount: number;
}

interface AchievementsWindowProps {
  isVisible: boolean;
  onClose: () => void;
  progress: AchievementProgressData;
}

type FilterTab = "all" | AchievementCategory;

const GRAY_COLORS = {
  bg: "#B0B0B0",
  bgActive: "#909090",
  borderLight: "#D0D0D0",
  borderDark: "#707070",
  shadow: "#505050",
};

function getProgressForAchievement(id: string, progress: AchievementProgressData): number {
  switch (id) {
    case "welcome-home":        return progress.housedCitizens;
    case "small-town-vibes":    return progress.housedCitizens;
    case "growing-community":   return progress.housedCitizens;
    case "metropolis-rising":   return progress.housedCitizens;
    case "pocket-change":       return progress.dailyRevenue;
    case "business-boom":       return progress.dailyRevenue;
    case "economic-powerhouse": return progress.dailyRevenue;
    case "tycoon-status":       return progress.dailyRevenue;
    case "growing-pains":       return progress.homelessLeft > 0 ? 1 : 0;
    case "first-foundation":    return progress.totalBuildingsPlaced;
    case "urban-planner":       return progress.totalBuildingsPlaced;
    case "master-architect":    return progress.totalBuildingsPlaced;
    case "night-owl":           return progress.midnightWitnessed ? 1 : 0;
    case "rush-hour":           return progress.carCount;
    case "dj-booth":            return progress.tracksPlayedCount;
    case "demolition-derby":    return progress.totalDemolitions;
    default:                    return 0;
  }
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${month} ${day}, ${year} ${hours}:${minutes}`;
}

function AchievementsWindowInner({
  isVisible,
  onClose,
  progress,
}: AchievementsWindowProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [unlockedMap, setUnlockedMap] = useState<Record<string, UnlockedAchievement>>({});
  const windowRef = useRef<HTMLDivElement>(null);

  // Load unlocked achievements when window becomes visible
  useEffect(() => {
    if (isVisible) {
      setPosition({ x: 0, y: 0 });
      const data = loadAchievements();
      setUnlockedMap(data.unlockedAchievements);
    }
  }, [isVisible]);

  // Drag handling
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
    const handleMouseUp = () => setIsDragging(false);

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

  const filteredAchievements = activeTab === "all"
    ? ACHIEVEMENTS
    : ACHIEVEMENTS.filter((a) => a.category === activeTab);

  const totalUnlocked = Object.keys(unlockedMap).length;

  const tabs: Array<{ key: FilterTab; label: string; emoji: string }> = [
    { key: "all", label: "All", emoji: "\uD83C\uDFC6" },
    { key: "citizens", label: "Citizens", emoji: "\uD83D\uDC65" },
    { key: "revenue", label: "Revenue", emoji: "\uD83D\uDCB0" },
    { key: "buildings", label: "Buildings", emoji: "\uD83C\uDFE2" },
    { key: "events", label: "Events", emoji: "\u26A1" },
    { key: "misc", label: "Misc", emoji: "\u2B50" },
  ];

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
          minWidth: 440,
          maxWidth: 520,
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
            marginBottom: 4,
            textAlign: "center",
            color: "#000",
            textShadow: "1px 1px 0 rgba(255,255,255,0.5)",
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          {"\uD83C\uDFC6"} ACHIEVEMENTS
        </div>

        {/* Unlock counter */}
        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            fontFamily: "var(--font-pixelify), monospace",
            color: "#555",
            marginBottom: 12,
          }}
        >
          {totalUnlocked} / {ACHIEVEMENTS.length} Unlocked
        </div>

        {/* Tab Buttons */}
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                playClickSound();
              }}
              style={{
                background: activeTab === tab.key ? GRAY_COLORS.bgActive : GRAY_COLORS.bg,
                border: "2px solid",
                borderColor: activeTab === tab.key
                  ? `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`
                  : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
                padding: "4px 8px",
                cursor: "pointer",
                fontFamily: "var(--font-pixelify), monospace",
                fontSize: 11,
                fontWeight: "bold",
                color: "#000",
                boxShadow: activeTab === tab.key
                  ? `inset 1px 1px 0px ${GRAY_COLORS.shadow}`
                  : `1px 1px 0px ${GRAY_COLORS.shadow}`,
                transform: activeTab === tab.key ? "translate(1px, 1px)" : "none",
              }}
              onMouseEnter={(e) =>
                activeTab !== tab.key && (e.currentTarget.style.filter = "brightness(1.05)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            >
              {tab.emoji} {tab.label}
            </button>
          ))}
        </div>

        {/* Achievement Cards */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 300,
            maxHeight: "60vh",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {filteredAchievements.map((achievement) => {
            const unlocked = unlockedMap[achievement.id];
            const currentProgress = getProgressForAchievement(achievement.id, progress);
            const target = achievement.target;
            const progressPercent = target ? Math.min((currentProgress / target) * 100, 100) : 0;

            return (
              <div
                key={achievement.id}
                style={{
                  background: unlocked ? "#3a5a3a" : "#3a3a3a",
                  border: "2px solid",
                  borderColor: unlocked
                    ? "#5a8a5a #2a4a2a #2a4a2a #5a8a5a"
                    : "#555 #222 #222 #555",
                  padding: "10px 12px",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  position: "relative",
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    fontSize: 32,
                    lineHeight: 1,
                    flexShrink: 0,
                    width: 40,
                    textAlign: "center",
                    filter: unlocked ? "none" : "brightness(0.35) grayscale(1)",
                    position: "relative",
                  }}
                >
                  {achievement.icon}
                  {!unlocked && (
                    <div
                      style={{
                        position: "absolute",
                        top: -2,
                        right: -4,
                        fontSize: 14,
                        filter: "none",
                      }}
                    >
                      {"\uD83D\uDD12"}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Title */}
                  <div
                    style={{
                      color: unlocked ? "#fff" : "#888",
                      fontSize: 14,
                      fontWeight: "700",
                      fontFamily: "var(--font-pixelify), monospace",
                      textShadow: "1px 1px 0 rgba(0,0,0,0.8)",
                    }}
                  >
                    {achievement.title}
                  </div>

                  {/* Description */}
                  <div
                    style={{
                      color: unlocked ? "#aaa" : "#666",
                      fontSize: 11,
                      fontFamily: "var(--font-pixelify), monospace",
                      marginTop: 2,
                    }}
                  >
                    {achievement.description}
                  </div>

                  {/* Progress bar (locked with target) */}
                  {!unlocked && target && (
                    <div style={{ marginTop: 6 }}>
                      <div
                        style={{
                          background: "#222",
                          border: "1px solid #444",
                          height: 14,
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            background: progressPercent >= 100 ? "#4ade80" : "#2a7a2a",
                            height: "100%",
                            width: `${progressPercent}%`,
                            transition: "width 0.3s ease",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ccc",
                            fontSize: 9,
                            fontFamily: "var(--font-pixelify), monospace",
                            fontWeight: "700",
                            textShadow: "1px 1px 0 rgba(0,0,0,0.9)",
                          }}
                        >
                          {target >= 1000
                            ? `$${(currentProgress / 1000).toFixed(1)}k / $${(target / 1000).toFixed(0)}k`
                            : `${Math.min(currentProgress, target)} / ${target}`
                          }
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Unlock info */}
                  {unlocked && (
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          color: "#6a6",
                          fontSize: 10,
                          fontFamily: "var(--font-pixelify), monospace",
                        }}
                      >
                        {"\u2705"} {formatDate(unlocked.unlockedAt)}
                      </span>
                      <span
                        style={{
                          color: "#888",
                          fontSize: 10,
                          fontFamily: "var(--font-pixelify), monospace",
                        }}
                      >
                        City: {unlocked.saveName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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

function arePropsEqual(
  prevProps: AchievementsWindowProps,
  nextProps: AchievementsWindowProps
): boolean {
  if (prevProps.isVisible !== nextProps.isVisible) return false;
  if (!nextProps.isVisible) return true;
  // Re-render when progress changes
  const p = prevProps.progress;
  const n = nextProps.progress;
  if (p.housedCitizens !== n.housedCitizens) return false;
  if (p.dailyRevenue !== n.dailyRevenue) return false;
  if (p.totalBuildingsPlaced !== n.totalBuildingsPlaced) return false;
  if (p.totalDemolitions !== n.totalDemolitions) return false;
  if (p.homelessLeft !== n.homelessLeft) return false;
  if (p.carCount !== n.carCount) return false;
  if (p.midnightWitnessed !== n.midnightWitnessed) return false;
  if (p.tracksPlayedCount !== n.tracksPlayedCount) return false;
  return true;
}

const AchievementsWindow = memo(AchievementsWindowInner, arePropsEqual);
export default AchievementsWindow;
