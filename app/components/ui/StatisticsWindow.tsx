"use client";

import React, { useState, useRef, useEffect, memo, useCallback } from "react";
import { playDoubleClickSound, playClickSound } from "@/app/utils/sounds";

// Data types for statistics
export interface PopulationDataPoint {
  timestamp: number; // Game time as total minutes
  total: number;
  housed: number;
  homeless: number;
  tourists: number;
}

export interface HappinessDataPoint {
  timestamp: number;
  happy: number;
  sad: number;
  hungry: number;
  angry: number;
  depressed: number;
}

export interface BuildingCategoryCount {
  category: string;
  count: number;
  totalRevenue: number;
  color: string;
}

interface StatisticsWindowProps {
  isVisible: boolean;
  onClose: () => void;
  populationHistory: PopulationDataPoint[];
  happinessHistory: HappinessDataPoint[];
  buildingCounts: BuildingCategoryCount[];
  currentPopulation: {
    total: number;
    housed: number;
    homeless: number;
    tourists: number;
  };
  currentHappiness: {
    happy: number;
    sad: number;
    hungry: number;
    angry: number;
    depressed: number;
  };
  cityHappiness: number;
}

type TabType = "population" | "happiness" | "buildings";

// Simple bar chart component
function MiniBarChart({
  data,
  maxValue,
  color,
  height = 100,
}: {
  data: number[];
  maxValue: number;
  color: string;
  height?: number;
}) {
  const barWidth = Math.max(2, Math.floor(280 / Math.max(data.length, 1)));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        height,
        padding: "0 4px",
        background: "#1a1a2e",
        border: "2px solid #333",
      }}
    >
      {data.map((value, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: maxValue > 0 ? `${(value / maxValue) * 100}%` : 0,
            background: color,
            minHeight: value > 0 ? 2 : 0,
            transition: "height 0.2s",
          }}
        />
      ))}
    </div>
  );
}

// Stacked area-like chart for happiness
function HappinessChart({
  history,
  height = 120,
}: {
  history: HappinessDataPoint[];
  height?: number;
}) {
  if (history.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a2e",
          border: "2px solid #333",
          color: "#666",
          fontFamily: "var(--font-pixelify), monospace",
          fontSize: 12,
        }}
      >
        No data yet
      </div>
    );
  }

  const moodColors = {
    happy: "#00ff00",
    sad: "#808080",
    hungry: "#ffa500",
    angry: "#ff0000",
    depressed: "#4b0082",
  };

  const barWidth = Math.max(4, Math.floor(280 / Math.max(history.length, 1)));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        height,
        padding: "0 4px",
        background: "#1a1a2e",
        border: "2px solid #333",
      }}
    >
      {history.map((point, i) => {
        const total = point.happy + point.sad + point.hungry + point.angry + point.depressed;
        if (total === 0) return <div key={i} style={{ width: barWidth }} />;

        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: "100%",
              display: "flex",
              flexDirection: "column-reverse",
            }}
          >
            {(["happy", "sad", "hungry", "angry", "depressed"] as const).map((mood) => (
              <div
                key={mood}
                style={{
                  width: "100%",
                  height: `${(point[mood] / total) * 100}%`,
                  background: moodColors[mood],
                  minHeight: point[mood] > 0 ? 1 : 0,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Stacked area-like chart for housing status (housed / tourists / homeless)
function HousingChart({
  history,
  height = 120,
}: {
  history: PopulationDataPoint[];
  height?: number;
}) {
  if (history.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a2e",
          border: "2px solid #333",
          color: "#666",
          fontFamily: "var(--font-pixelify), monospace",
          fontSize: 12,
        }}
      >
        No data yet
      </div>
    );
  }

  const statusColors = {
    housed: "#00aaff",
    tourists: "#ff69b4",
    homeless: "#ffaa00",
  };

  const barWidth = Math.max(4, Math.floor(280 / Math.max(history.length, 1)));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        height,
        padding: "0 4px",
        background: "#1a1a2e",
        border: "2px solid #333",
      }}
    >
      {history.map((point, i) => {
        const total = point.housed + point.tourists + point.homeless;
        if (total === 0) return <div key={i} style={{ width: barWidth }} />;

        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: "100%",
              display: "flex",
              flexDirection: "column-reverse",
            }}
          >
            {(["housed", "tourists", "homeless"] as const).map((status) => (
              <div
                key={status}
                style={{
                  width: "100%",
                  height: `${(point[status] / total) * 100}%`,
                  background: statusColors[status],
                  minHeight: point[status] > 0 ? 1 : 0,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function StatisticsWindowInner({
  isVisible,
  onClose,
  populationHistory,
  happinessHistory,
  buildingCounts,
  currentPopulation,
  currentHappiness,
  cityHappiness,
}: StatisticsWindowProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<TabType>("population");
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

  const GRAY_COLORS = {
    bg: "#B0B0B0",
    bgActive: "#909090",
    borderLight: "#D0D0D0",
    borderDark: "#707070",
    shadow: "#505050",
  };

  // Get last N data points for charts
  const recentPopulation = populationHistory.slice(-50);
  const recentHappiness = happinessHistory.slice(-50);
  const maxPopulation = Math.max(...recentPopulation.map((p) => p.total), 10);

  // Tab button component
  const TabButton = ({ tab, label, emoji }: { tab: TabType; label: string; emoji: string }) => (
    <button
      onClick={() => {
        setActiveTab(tab);
        playClickSound();
      }}
      style={{
        flex: 1,
        padding: "8px 12px",
        background: activeTab === tab ? "#4a6a4a" : "#3a3a3a",
        border: "2px solid",
        borderColor:
          activeTab === tab
            ? `#6a8a6a #2a4a2a #2a4a2a #6a8a6a`
            : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
        cursor: "pointer",
        fontFamily: "var(--font-pixelify), monospace",
        fontSize: 12,
        fontWeight: "bold",
        color: activeTab === tab ? "#fff" : "#aaa",
        transition: "filter 0.1s",
      }}
      onMouseEnter={(e) => {
        if (activeTab !== tab) e.currentTarget.style.filter = "brightness(1.1)";
      }}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
    >
      {emoji} {label}
    </button>
  );

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case "population":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Current Stats */}
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "12px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 8,
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#00ff00",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  {currentPopulation.total}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  TOTAL
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#00aaff",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  {currentPopulation.housed}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  HOUSED
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#ff69b4",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  {currentPopulation.tourists}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  TOURISTS
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#ffaa00",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  {currentPopulation.homeless}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  HOMELESS
                </div>
              </div>
            </div>

            {/* Population Chart */}
            <div>
              <div
                style={{
                  color: "#000",
                  fontSize: 12,
                  fontFamily: "var(--font-pixelify), monospace",
                  marginBottom: 4,
                }}
              >
                Population Over Time
              </div>
              {recentPopulation.length > 0 ? (
                <MiniBarChart
                  data={recentPopulation.map((p) => p.total)}
                  maxValue={maxPopulation}
                  color="#00ff00"
                />
              ) : (
                <div
                  style={{
                    height: 100,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#1a1a2e",
                    border: "2px solid #333",
                    color: "#666",
                    fontFamily: "var(--font-pixelify), monospace",
                    fontSize: 12,
                  }}
                >
                  No data yet - check back later!
                </div>
              )}
            </div>

            {/* Housing Status Stacked Chart */}
            <div>
              <div
                style={{
                  color: "#000",
                  fontSize: 12,
                  fontFamily: "var(--font-pixelify), monospace",
                  marginBottom: 4,
                }}
              >
                Housing Status
              </div>
              <HousingChart history={recentPopulation} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                {[
                  { label: "Housed", color: "#00aaff" },
                  { label: "Tourists", color: "#ff69b4" },
                  { label: "Homeless", color: "#ffaa00" },
                ].map(({ label, color }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 10, height: 10, background: color }} />
                    <span style={{ fontSize: 10, color: "#000", fontFamily: "var(--font-pixelify), monospace" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "happiness":
        const totalCitizens =
          currentHappiness.happy +
          currentHappiness.sad +
          currentHappiness.hungry +
          currentHappiness.angry +
          currentHappiness.depressed;

        const revenueMultiplier = (0.5 + (cityHappiness / 100) * 1.0).toFixed(2);
        const migrationMultiplier = (0.25 + (cityHappiness / 100) * 1.5).toFixed(2);
        const happinessColor = cityHappiness >= 60 ? "#00ff00" : cityHappiness >= 30 ? "#ffa500" : "#ff4444";

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* City Happiness Score */}
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "12px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  color: "#888",
                  fontSize: 10,
                  fontFamily: "var(--font-pixelify), monospace",
                  marginBottom: 4,
                }}
              >
                CITY HAPPINESS
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: "bold",
                  fontFamily: "var(--font-pixelify), monospace",
                  color: happinessColor,
                  lineHeight: 1,
                }}
              >
                {cityHappiness}%
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 16,
                  marginTop: 8,
                  fontSize: 10,
                  fontFamily: "var(--font-pixelify), monospace",
                  color: "#888",
                }}
              >
                <span>Revenue: <span style={{ color: Number(revenueMultiplier) >= 1 ? "#4ade80" : "#ff6b6b" }}>{revenueMultiplier}x</span></span>
                <span>Migration: <span style={{ color: Number(migrationMultiplier) >= 1 ? "#4ade80" : "#ff6b6b" }}>{migrationMultiplier}x</span></span>
              </div>
            </div>

            {/* Current Mood Distribution */}
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "12px",
              }}
            >
              <div
                style={{
                  color: "#888",
                  fontSize: 10,
                  fontFamily: "var(--font-pixelify), monospace",
                  marginBottom: 8,
                  textAlign: "center",
                }}
              >
                CURRENT MOOD DISTRIBUTION
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { mood: "happy", emoji: "😊", color: "#00ff00", count: currentHappiness.happy },
                  { mood: "sad", emoji: "😢", color: "#808080", count: currentHappiness.sad },
                  { mood: "hungry", emoji: "🍔", color: "#ffa500", count: currentHappiness.hungry },
                  { mood: "angry", emoji: "😠", color: "#ff0000", count: currentHappiness.angry },
                  { mood: "depressed", emoji: "😔", color: "#4b0082", count: currentHappiness.depressed },
                ].map(({ mood, emoji, color, count }) => (
                  <div key={mood} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 24, textAlign: "center" }}>{emoji}</span>
                    <div
                      style={{
                        flex: 1,
                        height: 16,
                        background: "#222",
                        border: "1px solid #444",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: totalCitizens > 0 ? `${(count / totalCitizens) * 100}%` : "0%",
                          background: color,
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color,
                        fontSize: 12,
                        fontFamily: "var(--font-pixelify), monospace",
                        fontWeight: "bold",
                        width: 30,
                        textAlign: "right",
                      }}
                    >
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Happiness Over Time */}
            <div>
              <div
                style={{
                  color: "#000",
                  fontSize: 12,
                  fontFamily: "var(--font-pixelify), monospace",
                  marginBottom: 4,
                }}
              >
                Mood Trends Over Time
              </div>
              <HappinessChart history={recentHappiness} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                {[
                  { emoji: "😊", color: "#00ff00" },
                  { emoji: "😢", color: "#808080" },
                  { emoji: "🍔", color: "#ffa500" },
                  { emoji: "😠", color: "#ff0000" },
                  { emoji: "😔", color: "#4b0082" },
                ].map(({ emoji, color }) => (
                  <div key={emoji} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 10, height: 10, background: color }} />
                    <span style={{ fontSize: 12 }}>{emoji}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case "buildings":
        const totalBuildings = buildingCounts.reduce((sum, b) => sum + b.count, 0);
        const totalRevenue = buildingCounts.reduce((sum, b) => sum + b.totalRevenue, 0);

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Summary Stats */}
            <div
              style={{
                background: "#000",
                border: "2px solid",
                borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
                padding: "12px",
                display: "flex",
                justifyContent: "space-around",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#00ff00",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  {totalBuildings}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  TOTAL BUILDINGS
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#4ade80",
                    fontSize: 24,
                    fontWeight: "bold",
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  ${totalRevenue.toLocaleString()}
                </div>
                <div
                  style={{
                    color: "#888",
                    fontSize: 10,
                    fontFamily: "var(--font-pixelify), monospace",
                  }}
                >
                  TOTAL REVENUE
                </div>
              </div>
            </div>

            {/* Building Categories */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 250,
                overflowY: "auto",
              }}
            >
              {buildingCounts.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 20,
                    color: "#666",
                    fontFamily: "var(--font-pixelify), monospace",
                    fontSize: 12,
                  }}
                >
                  No buildings placed yet!
                </div>
              ) : (
                buildingCounts.map((category) => (
                  <div
                    key={category.category}
                    style={{
                      background: "#3a3a3a",
                      border: "2px solid",
                      borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    {/* Category color indicator */}
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        background: category.color,
                        border: "1px solid #000",
                        flexShrink: 0,
                      }}
                    />

                    {/* Category name */}
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: "bold",
                          fontFamily: "var(--font-pixelify), monospace",
                          color: "#fff",
                          textTransform: "capitalize",
                        }}
                      >
                        {category.category}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-pixelify), monospace",
                          color: "#aaa",
                        }}
                      >
                        Revenue: ${category.totalRevenue.toLocaleString()}
                      </div>
                    </div>

                    {/* Count */}
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        fontFamily: "var(--font-pixelify), monospace",
                        color: category.color,
                      }}
                    >
                      {category.count}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
    }
  };

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
          minWidth: 400,
          maxWidth: 500,
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
          📊 STATISTICS
        </div>

        {/* Tab Buttons */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 15,
          }}
        >
          <TabButton tab="population" label="Population" emoji="👥" />
          <TabButton tab="happiness" label="Happiness" emoji="😊" />
          <TabButton tab="buildings" label="Buildings" emoji="🏢" />
        </div>

        {/* Tab Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 300,
          }}
        >
          {renderTabContent()}
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

// Custom comparison - only re-render when data actually changes
function arePropsEqual(
  prevProps: StatisticsWindowProps,
  nextProps: StatisticsWindowProps
): boolean {
  // Always re-render if visibility changes
  if (prevProps.isVisible !== nextProps.isVisible) return false;

  // If not visible, don't care about other props
  if (!nextProps.isVisible) return true;

  // Check if arrays have different lengths (quick check)
  if (prevProps.populationHistory.length !== nextProps.populationHistory.length) return false;
  if (prevProps.happinessHistory.length !== nextProps.happinessHistory.length) return false;
  if (prevProps.buildingCounts.length !== nextProps.buildingCounts.length) return false;

  // Check current stats
  if (prevProps.currentPopulation.total !== nextProps.currentPopulation.total) return false;
  if (prevProps.currentPopulation.housed !== nextProps.currentPopulation.housed) return false;
  if (prevProps.currentPopulation.homeless !== nextProps.currentPopulation.homeless) return false;
  if (prevProps.currentPopulation.tourists !== nextProps.currentPopulation.tourists) return false;

  if (prevProps.currentHappiness.happy !== nextProps.currentHappiness.happy) return false;
  if (prevProps.currentHappiness.sad !== nextProps.currentHappiness.sad) return false;
  if (prevProps.currentHappiness.hungry !== nextProps.currentHappiness.hungry) return false;
  if (prevProps.currentHappiness.angry !== nextProps.currentHappiness.angry) return false;
  if (prevProps.currentHappiness.depressed !== nextProps.currentHappiness.depressed) return false;

  if (prevProps.cityHappiness !== nextProps.cityHappiness) return false;

  return true;
}

// Memoize to prevent re-renders from parent state changes (like gameTime updates)
const StatisticsWindow = memo(StatisticsWindowInner, arePropsEqual);
export default StatisticsWindow;
