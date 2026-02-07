"use client";

import { useState, useRef, useCallback, useEffect, MouseEvent } from "react";
import { ToolType } from "../game/types";
import {
  CATEGORY_NAMES,
  BuildingCategory,
  getBuildingsByCategory,
  getCategories,
  getBuilding,
  BuildingDefinition,
  getBuildingEconomics,
} from "@/app/data/buildings";
import { playDoubleClickSound, playClickSound, playErrorSound } from "@/app/utils/sounds";
import { isBuildingUnlocked, getUnlockRequirement } from "@/app/data/buildingUnlocks";

// Format currency
function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  return `${sign}$${absValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Get building description based on category and type
function getBuildingDescription(building: BuildingDefinition): string {
  // Check for specific building descriptions first
  const specificDescriptions: Record<string, string> = {
    // Residential
    "80s-apartment": "Affordable apartment complex. Houses multiple families and generates rent.",
    "row-houses": "Connected townhouses perfect for growing families.",
    "medium-apartments": "Mid-size apartment building with good rental income potential.",
    "large-apartments-20s": "Historic apartment complex with high capacity.",
    "large-apartments-60s": "Modern high-rise apartments with many units.",
    "the-dakota": "Luxury apartment building. Premium rent income.",
    "yellow-apartments": "Bright and cheerful apartment building.",
    "english-townhouse": "Classic British-style townhouse.",
    brownstone: "Elegant brownstone building with multiple units.",
    "leafy-apartments": "Apartment building surrounded by greenery.",
    "gothic-apartments": "Ornate gothic-style apartment complex.",
    "modern-terra-condos": "Modern condominium complex with terraces.",
    
    // Commercial
    checkers: "Fast-food restaurant serving burgers and fries to hungry citizens.",
    popeyes: "Fried chicken restaurant chain. Popular with locals.",
    dunkin: "Coffee and donut shop. Busy during morning rush.",
    bookstore: "Shop where citizens buy books and reading materials.",
    "martini-bar": "Upscale nightlife establishment serving cocktails.",
    "magicpath-office": "Tech company office building. Generates income from workers.",
    "promptlayer-office": "Small tech startup office.",
    "general-intelligence-office": "Corporate office building for tech workers.",
    "ease-health": "Healthcare technology company headquarters.",
    "palo-alto-office-center": "Large office complex for multiple businesses.",
    "palo-alto-wide-office": "Sprawling office building complex.",
    
    // Civic
    "private-school": "Educational institution that charges tuition from students.",
    
    // Landmarks
    church: "Place of worship that generates income from visitors and donations.",
    "schwab-mansion": "Historic mansion. Tourist attraction that generates income.",
    "carnegie-mansion": "Famous historic mansion. High visitor income.",
    "mushroom-kingdom-castle": "Whimsical castle landmark. Popular tourist destination.",
    "internet-archive": "Digital library and archive. Generates income from visitors.",
    "hp-house": "Historic landmark house. Tourist attraction.",
    
    // Christmas
    "christmas-town-hall": "Festive town hall decorated for the holidays.",
    "christmas-bakery": "Holiday bakery serving seasonal treats.",
    "christmas-gift-shop": "Shop selling holiday gifts and decorations.",
    "christmas-cocoa-shop": "Cozy shop serving hot cocoa.",
    "christmas-cafe": "Small holiday-themed cafe.",
    "santas-workshop": "Santa's workshop. Magical holiday attraction.",
    "ice-skating-rink": "Outdoor ice skating rink for winter fun.",
    "christmas-toy-store": "Toy store specializing in holiday gifts.",
  };

  if (specificDescriptions[building.id]) {
    return specificDescriptions[building.id];
  }

  // Generic descriptions by category
  switch (building.category) {
    case "residential":
      return "Housing for citizens. Generates rent income from residents who live here.";
    case "commercial":
      return "A business that generates income from customer visits and transactions.";
    case "civic":
      return "A public service building that charges fees for services provided.";
    case "landmark":
      return "A notable building that attracts visitors and generates tourism income.";
    case "props":
      return "Decorative element. No economic function, but adds character to your city.";
    case "christmas":
      return "Seasonal decoration or building. May generate income if it's a functional business.";
    default:
      return "A building in your city.";
  }
}

interface ToolWindowProps {
  selectedTool: ToolType;
  selectedBuildingId: string | null;
  onToolSelect: (tool: ToolType) => void;
  onBuildingSelect: (buildingId: string) => void;
  onRotate?: () => void;
  isVisible: boolean;
  onClose: () => void;
  unlockedBuildingIds?: Set<string>;
  housedPopulation?: number;
  dailyRevenue?: number;
}

// Get the preview sprite for a building (prefer south, fall back to first available)
function getBuildingPreviewSprite(building: BuildingDefinition): string {
  return building.sprites.south || Object.values(building.sprites)[0] || "";
}

// Calculate zoom level based on building footprint size
// Smaller buildings need more zoom, larger buildings need less
function getBuildingPreviewZoom(building: BuildingDefinition): number {
  const footprintSize = Math.max(
    building.footprint.width,
    building.footprint.height
  );
  // Scale: 1x1 = 950%, 2x2 = 500%, 3x3 = 380%, 4x4 = 280%, 6x6 = 200%, 8x8 = 150%
  if (footprintSize === 1) return 950;
  if (footprintSize === 2) return 500;
  const zoom = Math.max(150, 450 - footprintSize * 40);
  return zoom;
}

// Tab icons for each category
const CATEGORY_ICONS: Record<BuildingCategory, string> = {
  residential: "🏠",
  commercial: "🏪",
  props: "🌳",
  christmas: "🎄",
  civic: "🏛️",
  landmark: "🏰",
};

export default function ToolWindow({
  selectedTool,
  selectedBuildingId,
  onToolSelect,
  onBuildingSelect,
  onRotate,
  isVisible,
  onClose,
  unlockedBuildingIds,
  housedPopulation,
  dailyRevenue,
}: ToolWindowProps) {
  // Calculate initial position (lazy to avoid SSR issues)
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") {
      return { x: 10, y: 50 };
    }
    const isMobile = window.innerWidth < 768 || "ontouchstart" in window;
    if (isMobile) {
      const menuWidth = Math.min(520, window.innerWidth - 20);
      return {
        x: Math.max(10, (window.innerWidth - menuWidth) / 2),
        y: 60,
      };
    } else {
      return {
        x: Math.max(10, window.innerWidth - 530),
        y: 50,
      };
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"tools" | BuildingCategory>(
    "tools"
  );
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null); // Building ID
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1000,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });
  const dragOffset = useRef({ x: 0, y: 0 });

  // Track window resize for responsive sizing
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    // Set initial size
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!isVisible) return null;

  // Get buildings grouped by category
  const categories = getCategories();

  // Get current tab title
  const getTabTitle = () => {
    if (activeTab === "tools") return "Tools";
    return CATEGORY_NAMES[activeTab];
  };

  // Calculate responsive width: use 520px or screen width/height (whichever is smaller)
  const baseWidth = 520;
  const responsiveWidth = Math.min(
    baseWidth,
    windowSize.width - 20,
    windowSize.height
  );

  return (
    <div
      className="rct-frame"
      style={{
        position: "absolute",
        left: Math.min(position.x, windowSize.width - responsiveWidth - 10),
        top: position.y,
        width: responsiveWidth,
        maxHeight: Math.min(600, windowSize.height - 100), // Increased from 400 to 600
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        userSelect: "none",
        overflow: "hidden",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div className="rct-titlebar" onMouseDown={handleMouseDown}>
        <span>{getTabTitle()}</span>
        <button
          className="rct-close"
          onClick={() => {
            onClose();
            playDoubleClickSound();
          }}
        >
          ×
        </button>
      </div>

      {/* Category Tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "4px 4px 0 4px",
          background: "var(--rct-frame-mid)",
          borderBottom: "2px solid var(--rct-frame-dark)",
        }}
      >
        {/* Tools tab */}
        <button
          onClick={() => {
            if (activeTab !== "tools") {
              setActiveTab("tools");
              playDoubleClickSound();
            }
          }}
          className={`rct-button ${activeTab === "tools" ? "active" : ""}`}
          style={{
            padding: "4px 8px",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Tools"
        >
          🔧
        </button>

        {/* Category tabs */}
        {categories.map((category) => {
          const buildings = getBuildingsByCategory(category);
          if (buildings.length === 0) return null;

          // Use first building's sprite as tab icon
          const firstBuilding = buildings[0];
          const previewSprite = getBuildingPreviewSprite(firstBuilding);
          const previewZoom = getBuildingPreviewZoom(firstBuilding);

          return (
            <button
              key={category}
              onClick={() => {
                if (activeTab !== category) {
                  setActiveTab(category);
                  playDoubleClickSound();
                }
              }}
              className={`rct-button ${activeTab === category ? "active" : ""}`}
              style={{
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 36,
                minHeight: 32,
              }}
              title={CATEGORY_NAMES[category]}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  overflow: "hidden",
                  position: "relative",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                }}
              >
                {/* Render at half size then scale up 2x for chunky pixel effect */}
                <img
                  src={previewSprite}
                  alt={CATEGORY_NAMES[category]}
                  style={{
                    width: `${previewZoom / 2}%`,
                    height: `${previewZoom / 2}%`,
                    objectFit: "cover",
                    objectPosition: "center bottom",
                    imageRendering: "pixelated",
                    transform: "scale(2)",
                    transformOrigin: "center bottom",
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Content panel */}
      <div
        className="rct-panel"
        style={{
          padding: 8,
          flex: "0 1 auto", // Don't grow, allow shrinking, auto basis
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
        }}
      >
        {/* Tools Tab Content */}
        {activeTab === "tools" && (
          <div>
            {/* Roads/Tiles Section */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 6,
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => {
                  onToolSelect(ToolType.RoadNetwork);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.RoadNetwork ? "active" : ""
                }`}
                title="Road"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1asphalt.png"
                  alt="Road"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Road</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Asphalt);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Asphalt ? "active" : ""
                }`}
                title="Asphalt"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1asphalt_tile.png"
                  alt="Asphalt"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Asphalt</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Tile);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Tile ? "active" : ""
                }`}
                title="Tile"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1square_tile.png"
                  alt="Tile"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Tile</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Snow);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Snow ? "active" : ""
                }`}
                title="Snow"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1snow_tile_1.png"
                  alt="Snow"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Snow</span>
              </button>
            </div>

            {/* Divider */}
            <div
              style={{
                height: 2,
                background: "var(--rct-panel-dark)",
                margin: "8px 0",
              }}
            />

          </div>
        )}

        {/* Building Category Content */}
        {activeTab !== "tools" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
              width: "100%",
            }}
          >
            {getBuildingsByCategory(activeTab).map((building) => {
              const previewSprite = getBuildingPreviewSprite(building);
              const previewZoom = getBuildingPreviewZoom(building);
              const isSelected =
                selectedTool === ToolType.Building &&
                selectedBuildingId === building.id;

              const isLocked = !isBuildingUnlocked(
                building.id,
                housedPopulation ?? 0,
                dailyRevenue ?? 0,
                unlockedBuildingIds ?? new Set()
              );

              return (
                <button
                  key={building.id}
                  onClick={() => {
                    if (isLocked) {
                      playErrorSound();
                      setHoveredBuilding(building.id);
                      return;
                    }
                    onToolSelect(ToolType.Building);
                    onBuildingSelect(building.id);
                    playClickSound();
                  }}
                  onMouseEnter={() => setHoveredBuilding(building.id)}
                  onMouseLeave={() => setHoveredBuilding(null)}
                  className={`rct-button ${isSelected && !isLocked ? "active" : ""}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 4,
                    minHeight: 60,
                    overflow: "hidden",
                    position: "relative",
                    cursor: isLocked ? "not-allowed" : "pointer",
                    background: isSelected && !isLocked
                      ? "var(--rct-button-active)"
                      : undefined,
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 50,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      overflow: "hidden",
                      position: "relative",
                      opacity: isLocked ? 0.35 : 1,
                      filter: isLocked ? "grayscale(80%)" : "none",
                    }}
                  >
                    {/* Render at half size then scale up 2x for chunky pixel effect */}
                    <img
                      src={previewSprite}
                      alt={building.name}
                      style={{
                        width: `${previewZoom / 2}%`,
                        height: `${previewZoom / 2}%`,
                        objectFit: "cover",
                        objectPosition: "center bottom",
                        imageRendering: "pixelated",
                        transform: "scale(2)",
                        transformOrigin: "center bottom",
                      }}
                    />
                  </div>
                  {isLocked && (
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 4,
                        fontSize: 11,
                        textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                        lineHeight: 1,
                      }}
                    >
                      🔒
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer - shows selected/hovered building info */}
      {activeTab !== "tools" && (() => {
        const buildingId = hoveredBuilding || 
          (selectedBuildingId && selectedTool === ToolType.Building ? selectedBuildingId : null);

        const building = buildingId ? getBuilding(buildingId) : null;
        const economics = building ? getBuildingEconomics(building) : null;

        return (
          <div
            style={{
              padding: "8px 10px",
              background: "var(--rct-panel-mid)",
              borderTop: "2px solid var(--rct-panel-dark)",
              color: "var(--rct-text-light)",
              textShadow: "1px 1px 0 var(--rct-text-shadow)",
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: "0 0 auto", // Don't grow or shrink, use content size
              overflowY: "auto",
              maxHeight: 350, // Max height with scroll if needed
            }}
          >
            {building ? (
              <>
                {/* Building name and rotate hint */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 16,
                  }}
                >
                  <span>{building.name}</span>
                  {selectedTool === ToolType.Building && selectedBuildingId === building.id && (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ opacity: 0.7, fontSize: 14 }}>
                        press &quot;R&quot; to rotate
                      </span>
                      <button
                        className="rct-button"
                        onClick={() => {
                          onRotate?.();
                          playClickSound();
                        }}
                        style={{
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="Rotate building"
                      >
                        <img
                          src="/UI/r20x20rotate.png"
                          alt="Rotate"
                          style={{
                            width: 32,
                            height: 32,
                            imageRendering: "pixelated",
                          }}
                        />
                      </button>
                    </span>
                  )}
                </div>

                {/* Unlock requirements for locked buildings */}
                {(() => {
                  const req = getUnlockRequirement(building.id);
                  const locked = req && !isBuildingUnlocked(
                    building.id,
                    housedPopulation ?? 0,
                    dailyRevenue ?? 0,
                    unlockedBuildingIds ?? new Set()
                  );
                  if (!locked || !req) return null;
                  return (
                    <div
                      style={{
                        padding: "6px 8px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,100,100,0.3)",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#ff8888", fontWeight: "bold", marginBottom: 4 }}>
                        🔒 Locked — {req.tierName}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.9 }}>
                        Unlock by reaching:
                      </div>
                      <div style={{ fontSize: 12, marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <span style={{ color: "#88ccff" }}>
                          {housedPopulation ?? 0}/{req.population} citizens
                        </span>
                        <span style={{ opacity: 0.6 }}>or</span>
                        <span style={{ color: "#88ff88" }}>
                          ${(dailyRevenue ?? 0).toLocaleString()}/${req.revenue.toLocaleString()} daily revenue
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Description */}
                <div style={{ opacity: 0.9, fontSize: 13, lineHeight: 1.4 }}>
                  {getBuildingDescription(building)}
                </div>

                {/* Economics info */}
                {economics && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 6,
                      marginTop: 4,
                      paddingTop: 6,
                      borderTop: "1px solid var(--rct-panel-dark)",
                    }}
                  >
                    <div>
                      <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                        Build Cost:
                      </div>
                      <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffaa00" }}>
                        {formatCurrency(economics.buildCost)}
                      </div>
                    </div>
                    <div>
                      <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                        Monthly Upkeep:
                      </div>
                      <div style={{ fontSize: 13, fontWeight: "bold", color: "#ff6666" }}>
                        {formatCurrency(economics.monthlyOperatingCost)}
                      </div>
                    </div>
                    {/* For residential buildings, always show rent and max residents */}
                    {building.category === "residential" && (
                      <>
                        {economics.rentPerResident ? (
                          <div>
                            <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                              Rent per Resident:
                            </div>
                            <div style={{ fontSize: 13, fontWeight: "bold", color: "#66ff66" }}>
                              {formatCurrency(economics.rentPerResident)}
                            </div>
                          </div>
                        ) : (
                          <div /> // Empty cell for spacing
                        )}
                        {economics.maxResidents ? (
                          <div>
                            <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                              Max Residents:
                            </div>
                            <div style={{ fontSize: 13, fontWeight: "bold" }}>
                              {economics.maxResidents} citizen{economics.maxResidents !== 1 ? "s" : ""}
                            </div>
                          </div>
                        ) : (
                          <div /> // Empty cell for spacing
                        )}
                      </>
                    )}
                    {/* For non-residential buildings, show income per visit if available */}
                    {building.category !== "residential" && economics.incomePerInteraction && (
                      <div>
                        <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                          Income per Visit:
                        </div>
                        <div style={{ fontSize: 13, fontWeight: "bold", color: "#66ff66" }}>
                          {formatCurrency(economics.incomePerInteraction)}
                        </div>
                      </div>
                    )}
                    {/* Show rent for non-residential if it exists (shouldn't normally, but just in case) */}
                    {building.category !== "residential" && economics.rentPerResident && (
                      <div>
                        <div style={{ opacity: 0.8, fontSize: 11, marginBottom: 2 }}>
                          Rent per Resident:
                        </div>
                        <div style={{ fontSize: 13, fontWeight: "bold", color: "#66ff66" }}>
                          {formatCurrency(economics.rentPerResident)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                Hover over a building to see details
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
