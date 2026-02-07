"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  TileType,
  ToolType,
  GridCell,
  Direction,
  VisualSettings,
  GRID_WIDTH,
  GRID_HEIGHT,
  GameEconomy,
  GameTime,
  GameSpeed,
  Bank,
  ActiveLoan,
  GameSaveData,
} from "./types";
import {
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  hasRoadSegment,
  getRoadConnections,
  getSegmentType,
  generateRoadPattern,
  getAffectedSegments,
  canPlaceRoadSegment,
} from "./roadUtils";
import { getBuilding, getBuildingFootprint } from "@/app/data/buildings";
import {
  isBuildingUnlocked,
  getNewlyUnlockedBuildings,
  getUnlockRequirement,
} from "@/app/data/buildingUnlocks";
import { computeDayNightVisuals, DayNightVisuals } from "./dayNightCycle";

// Auto-migration constants
const MIGRATION_BASE_RATE = 0.1; // ~1 tourist every 10 days with no housing
const MIGRATION_ATTRACTION_FACTOR = 0.15; // Per empty housing slot, extra daily probability
const MIGRATION_MAX_PER_DAY = 5; // Hard cap to prevent flooding
import dynamic from "next/dynamic";
import type { PhaserGameHandle } from "./phaser/PhaserGame";
import {
  playDestructionSound,
  playBuildSound,
  playBuildRoadSound,
  playOpenSound,
  playClickSound,
  playDoubleClickSound,
  playErrorSound,
  playZoomSound,
  playSpeedUpSound,
  playSpeedDownSound,
  playPauseSound,
  playUnpauseSound,
  playCashSound,
} from "@/app/utils/sounds";

// Dynamically import PhaserGame (no SSR - Phaser needs browser APIs)
const PhaserGame = dynamic(() => import("./phaser/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "white",
        fontSize: 18,
      }}
    >
      Loading game...
    </div>
  ),
});

import ToolWindow from "../ui/ToolWindow";
import MusicPlayer from "../ui/MusicPlayer";
import Modal from "../ui/Modal";
import MoneyDisplay from "../ui/MoneyDisplay";
import BankWindow from "../ui/BankWindow";
import TimeTracker from "../ui/TimeTracker";
import BuildingInfoWindow, { BuildingStats } from "../ui/BuildingInfoWindow";
import CitizenInfoWindow, { CitizenData } from "../ui/CitizenInfoWindow";
import CitizenListWindow, { CitizenListItem } from "../ui/CitizenListWindow";
import StatisticsWindow, {
  PopulationDataPoint,
  HappinessDataPoint,
  BuildingCategoryCount,
} from "../ui/StatisticsWindow";
import AchievementsWindow, { AchievementProgressData } from "../ui/AchievementsWindow";
import SettingsWindow from "../ui/SettingsWindow";
import AchievementToast from "../ui/AchievementToast";
import UnlockToast from "../ui/UnlockToast";
import { ACHIEVEMENTS, AchievementDefinition, ACHIEVEMENT_MAP } from "@/app/data/achievements";
import {
  unlockAchievement,
  loadProgress,
  saveProgress,
  AchievementProgress,
} from "@/app/utils/achievementStore";
import { getBuildingEconomics, ROAD_COSTS } from "@/app/data/buildings";

// Initialize empty grid
const createEmptyGrid = (): GridCell[][] => {
  return Array.from({ length: GRID_HEIGHT }, (_, y) =>
    Array.from({ length: GRID_WIDTH }, (_, x) => ({
      type: TileType.Grass,
      x,
      y,
      isOrigin: true,
    }))
  );
};

// Discrete zoom levels for button zoom presets
const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];

// Helper function to find closest zoom level index
const findClosestZoomIndex = (zoomValue: number): number => {
  let closestIndex = 0;
  let minDiff = Math.abs(zoomValue - ZOOM_LEVELS[0]);
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(zoomValue - ZOOM_LEVELS[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
};

interface GameBoardProps {
  cityName: string;
  initialSaveData?: GameSaveData;
  onReturnToMenu?: () => void;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  effectiveMusicVolume: number;
  onMasterVolumeChange: (v: number) => void;
  onSfxVolumeChange: (v: number) => void;
  onMusicVolumeChange: (v: number) => void;
}

export default function GameBoard({
  cityName,
  initialSaveData,
  onReturnToMenu,
  masterVolume,
  sfxVolume,
  musicVolume,
  effectiveMusicVolume,
  onMasterVolumeChange,
  onSfxVolumeChange,
  onMusicVolumeChange,
}: GameBoardProps) {
  // Grid state (only thing React manages now)
  const [grid, setGrid] = useState<GridCell[][]>(createEmptyGrid);

  // UI state
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.None);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [debugPaths, setDebugPaths] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isToolWindowVisible, setIsToolWindowVisible] = useState(false);
  const [buildingOrientation, setBuildingOrientation] = useState<Direction>(
    Direction.Down
  );
  const [isPlayerDriving, setIsPlayerDriving] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    null
  );
  const [modalState, setModalState] = useState<{
    isVisible: boolean;
    title: string;
    message: string;
    showCancel?: boolean;
    onConfirm?: (() => void) | null;
  }>({
    isVisible: false,
    title: "",
    message: "",
    showCancel: false,
    onConfirm: null,
  });
  const [visualSettings, setVisualSettings] = useState<VisualSettings>({
    blueness: 0,
    contrast: 1.0,
    saturation: 1.0,
    brightness: 1.0,
  });
  const [dayNightEnabled, setDayNightEnabled] = useState(true);

  // Mobile warning state
  const [isMobile, setIsMobile] = useState(false);
  const [mobileWarningDismissed, setMobileWarningDismissed] = useState(false);

  // Economy state
  const [economy, setEconomy] = useState<GameEconomy>({
    money: 10000, // Starting money
    activeLoans: [],
  });

  // Time state
  const [gameTime, setGameTime] = useState<GameTime>({
    year: 1995,
    month: 1,
    day: 1,
    hour: 6,
    minute: 0,
    dayProgress: 0,
  });

  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(GameSpeed.Normal);
  const [isBankWindowVisible, setIsBankWindowVisible] = useState(false);

  // Building stats tracking
  const [buildingStats, setBuildingStats] = useState<Map<string, BuildingStats>>(new Map());
  const [selectedBuildingStats, setSelectedBuildingStats] = useState<BuildingStats | null>(null);
  const [isBuildingInfoVisible, setIsBuildingInfoVisible] = useState(false);
  const [characterNames, setCharacterNames] = useState<Map<string, string>>(new Map()); // Track character names

  // Citizen info tracking
  const [selectedCitizenData, setSelectedCitizenData] = useState<CitizenData | null>(null);
  const [isCitizenInfoVisible, setIsCitizenInfoVisible] = useState(false);
  const [isCitizenListVisible, setIsCitizenListVisible] = useState(false);

  // Statistics tracking
  const [isStatisticsVisible, setIsStatisticsVisible] = useState(false);
  const [populationHistory, setPopulationHistory] = useState<PopulationDataPoint[]>([]);
  const [happinessHistory, setHappinessHistory] = useState<HappinessDataPoint[]>([]);
  const [currentPopulationStats, setCurrentPopulationStats] = useState({ total: 0, housed: 0, homeless: 0, tourists: 0 });
  const [currentHappinessStats, setCurrentHappinessStats] = useState({ happy: 0, sad: 0, hungry: 0, angry: 0, depressed: 0 });
  const [buildingCountsStats, setBuildingCountsStats] = useState<BuildingCategoryCount[]>([]);

  // Settings state
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);

  // Achievements state
  const [isAchievementsVisible, setIsAchievementsVisible] = useState(false);
  const [achievementToast, setAchievementToast] = useState<AchievementDefinition | null>(null);
  const cityNameRef = useRef(cityName);
  useEffect(() => { cityNameRef.current = cityName; }, [cityName]);

  // Building unlock progression state (per-save)
  const [unlockedBuildingIds, setUnlockedBuildingIds] = useState<Set<string>>(new Set());
  const unlockedBuildingIdsRef = useRef(unlockedBuildingIds);
  useEffect(() => { unlockedBuildingIdsRef.current = unlockedBuildingIds; }, [unlockedBuildingIds]);
  const [unlockToast, setUnlockToast] = useState<{ tierName: string; count: number } | null>(null);
  const unlockToastQueueRef = useRef<Array<{ tierName: string; count: number }>>([]);

  // Auto-save indicator
  const [showAutoSaveToast, setShowAutoSaveToast] = useState(false);
  const autoSaveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tourist leaving toast
  const [touristLeavingToast, setTouristLeavingToast] = useState<string | null>(null);
  const touristLeavingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Achievement progress tracking refs (cumulative, survive across renders)
  const totalBuildingsPlacedRef = useRef(0);
  const totalDemolitionsRef = useRef(0);
  const dailyRevenueRef = useRef(0);
  const tracksPlayedRef = useRef<Set<string>>(new Set());
  const homelessLeftRef = useRef(0);
  const midnightWitnessedRef = useRef(false);
  const prevAchievementDayRef = useRef(1);

  // Banks configuration
  const banks: Bank[] = [
    {
      id: "first-national",
      name: "First National Bank",
      loanAmount: 50000,
      interestRate: 0.05, // 5% per month
    },
    {
      id: "city-trust",
      name: "City Trust Bank",
      loanAmount: 100000,
      interestRate: 0.07, // 7% per month
    },
    {
      id: "metropolitan-bank",
      name: "Metropolitan Bank",
      loanAmount: 200000,
      interestRate: 0.1, // 10% per month
    },
  ];

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const isTouchDevice =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isTouchDevice || isSmallScreen);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Load persisted achievement progress on mount
  useEffect(() => {
    const progress = loadProgress();
    if (progress) {
      totalBuildingsPlacedRef.current = progress.totalBuildingsPlaced;
      totalDemolitionsRef.current = progress.totalDemolitions;
      homelessLeftRef.current = progress.homelessLeft;
      tracksPlayedRef.current = new Set(progress.tracksPlayed);
      midnightWitnessedRef.current = progress.midnightWitnessed;
    }
  }, []);

  // Load initial save data if provided (from main menu "Load Game")
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (!initialSaveData || initialLoadDoneRef.current) return;

    const tryLoad = () => {
      if (phaserGameRef.current?.isSceneReady()) {
        initialLoadDoneRef.current = true;
        // Restore grid
        setGrid(initialSaveData.grid);
        phaserGameRef.current.clearCharacters();
        phaserGameRef.current.clearCars();
        if (initialSaveData.zoom !== undefined) setZoom(initialSaveData.zoom);
        if (initialSaveData.visualSettings) setVisualSettings(initialSaveData.visualSettings);
        if (initialSaveData.dayNightEnabled !== undefined) setDayNightEnabled(initialSaveData.dayNightEnabled);
        if (initialSaveData.economy) setEconomy(initialSaveData.economy);
        if (initialSaveData.gameTime) setGameTime(initialSaveData.gameTime);
        if (initialSaveData.gameSpeed !== undefined) setGameSpeed(initialSaveData.gameSpeed);
        if (initialSaveData.unlockedBuildingIds) setUnlockedBuildingIds(new Set(initialSaveData.unlockedBuildingIds));
        setTimeout(() => {
          for (let i = 0; i < (initialSaveData.characterCount ?? 0); i++) {
            phaserGameRef.current?.spawnCharacter();
          }
          for (let i = 0; i < (initialSaveData.carCount ?? 0); i++) {
            phaserGameRef.current?.spawnCar();
          }
        }, 100);
      } else {
        // Phaser not ready yet, retry
        setTimeout(tryLoad, 200);
      }
    };
    tryLoad();
  }, [initialSaveData]);

  // Day/Night cycle visual computations
  const dayNightVisuals = useMemo<DayNightVisuals | null>(() => {
    if (!dayNightEnabled) return null;
    return computeDayNightVisuals(gameTime.hour, gameTime.minute);
  }, [dayNightEnabled, gameTime.hour, gameTime.minute]);

  // Effective visuals: day/night cycle overrides manual settings when enabled
  const effectiveVisuals = useMemo<VisualSettings>(() => {
    if (dayNightVisuals) {
      return {
        blueness: dayNightVisuals.blueness,
        contrast: dayNightVisuals.contrast,
        saturation: dayNightVisuals.saturation,
        brightness: dayNightVisuals.brightness,
      };
    }
    return visualSettings;
  }, [dayNightVisuals, visualSettings]);

  // Ref to Phaser game for spawning entities
  const phaserGameRef = useRef<PhaserGameHandle>(null);


  // Reset building orientation to south when switching buildings
  useEffect(() => {
    if (selectedBuildingId) {
      const building = getBuilding(selectedBuildingId);
      if (building?.supportsRotation) {
        setBuildingOrientation(Direction.Down);
      }
    }
  }, [selectedBuildingId]);

  // Consolidated keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input field
      const activeElement = document.activeElement;
      const isTyping =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement)?.isContentEditable);

      if (isTyping) return;

      const key = e.key;

      // Escape — close windows (priority order) or deselect tool
      if (key === "Escape") {
        e.preventDefault();
        if (isSettingsVisible) { setIsSettingsVisible(false); return; }
        if (isCitizenInfoVisible) { setIsCitizenInfoVisible(false); return; }
        if (isBuildingInfoVisible) { setIsBuildingInfoVisible(false); return; }
        if (isStatisticsVisible) { setIsStatisticsVisible(false); return; }
        if (isBankWindowVisible) { setIsBankWindowVisible(false); return; }
        if (isAchievementsVisible) { setIsAchievementsVisible(false); return; }
        if (isCitizenListVisible) { setIsCitizenListVisible(false); return; }
        if (isToolWindowVisible) { setIsToolWindowVisible(false); return; }
        if (selectedTool !== ToolType.None) { setSelectedTool(ToolType.None); return; }
        return;
      }

      // R — Rotate building
      if (key === "r" || key === "R") {
        if (selectedTool === ToolType.Building && selectedBuildingId) {
          const building = getBuilding(selectedBuildingId);
          if (building?.supportsRotation) {
            e.preventDefault();
            setBuildingOrientation((prev) => {
              switch (prev) {
                case Direction.Down: return Direction.Right;
                case Direction.Right: return Direction.Up;
                case Direction.Up: return Direction.Left;
                case Direction.Left: return Direction.Down;
                default: return Direction.Down;
              }
            });
          }
        }
        return;
      }

      // 1 — Toggle build tool window
      if (key === "1") {
        e.preventDefault();
        playClickSound();
        setIsToolWindowVisible((prev) => {
          if (!prev) return true;
          setSelectedTool(ToolType.None);
          return false;
        });
        return;
      }

      // 2 — Toggle eraser
      if (key === "2") {
        e.preventDefault();
        playClickSound();
        setSelectedTool((prev) =>
          prev === ToolType.Eraser ? ToolType.None : ToolType.Eraser
        );
        return;
      }

      // 3 — Toggle road tool
      if (key === "3") {
        e.preventDefault();
        playClickSound();
        setSelectedTool((prev) =>
          prev === ToolType.RoadNetwork ? ToolType.None : ToolType.RoadNetwork
        );
        return;
      }

      // Space or P — Toggle pause
      if (key === " " || key === "p" || key === "P") {
        e.preventDefault();
        setGameSpeed((prev) => {
          if (prev === GameSpeed.Paused) {
            playUnpauseSound();
            return GameSpeed.Normal;
          } else {
            playPauseSound();
            return GameSpeed.Paused;
          }
        });
        return;
      }

      // + or = — Speed up
      if (key === "+" || key === "=") {
        e.preventDefault();
        setGameSpeed((prev) => {
          if (prev === GameSpeed.Paused) { playUnpauseSound(); return GameSpeed.Normal; }
          if (prev === GameSpeed.Normal) { playSpeedUpSound(); return GameSpeed.Fast; }
          return prev;
        });
        return;
      }

      // - — Slow down
      if (key === "-") {
        e.preventDefault();
        setGameSpeed((prev) => {
          if (prev === GameSpeed.Fast) { playSpeedDownSound(); return GameSpeed.Normal; }
          if (prev === GameSpeed.Normal) { playPauseSound(); return GameSpeed.Paused; }
          return prev;
        });
        return;
      }
    };

    // Right-click — cancel/back (close topmost window or deselect tool)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (isSettingsVisible) { setIsSettingsVisible(false); return; }
      if (isCitizenInfoVisible) { setIsCitizenInfoVisible(false); return; }
      if (isBuildingInfoVisible) { setIsBuildingInfoVisible(false); return; }
      if (isStatisticsVisible) { setIsStatisticsVisible(false); return; }
      if (isBankWindowVisible) { setIsBankWindowVisible(false); return; }
      if (isAchievementsVisible) { setIsAchievementsVisible(false); return; }
      if (isCitizenListVisible) { setIsCitizenListVisible(false); return; }
      if (isToolWindowVisible) { setIsToolWindowVisible(false); return; }
      if (selectedTool !== ToolType.None) { setSelectedTool(ToolType.None); return; }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [selectedTool, selectedBuildingId, isToolWindowVisible, isCitizenInfoVisible, isBuildingInfoVisible, isStatisticsVisible, isBankWindowVisible, isAchievementsVisible, isCitizenListVisible, isSettingsVisible]);

  // Sync driving state with Phaser
  useEffect(() => {
    if (phaserGameRef.current) {
      phaserGameRef.current.setDrivingState(isPlayerDriving);
    }
  }, [isPlayerDriving]);

  // Process monthly loan payments, operating costs, and rent collection
  const processMonthlyPayments = useCallback(() => {
    if (!phaserGameRef.current) return;
    
    // Mark homeless citizens to start leaving at end of month
    const citizensLeaving = phaserGameRef.current.removeHomelessCitizens();
    if (citizensLeaving > 0) {
      // Track for achievements
      homelessLeftRef.current += citizensLeaving;
      setModalState({
        isVisible: true,
        title: "Citizens Leaving",
        message: `${citizensLeaving} homeless citizen${citizensLeaving > 1 ? 's' : ''} ${citizensLeaving > 1 ? 'are' : 'is'} leaving the city after being unable to find housing.`,
      });
    }

    // First, process citizen rent payments and evictions
    const citizens = phaserGameRef.current.getAllCitizens();
    let totalRentCollected = 0;
    const evictedCitizens: string[] = [];

    for (const citizen of citizens) {
      if (citizen.residenceX !== undefined && citizen.residenceY !== undefined) {
        const residenceBuildingId = phaserGameRef.current.getCitizenResidenceBuildingId(citizen.id);
        if (residenceBuildingId) {
          const building = getBuilding(residenceBuildingId);
          if (building) {
            const economics = getBuildingEconomics(building);
            const rentAmount = economics.rentPerResident || 0;

            // Try to collect rent from citizen
            const result = phaserGameRef.current.processRentPayment(citizen.id, rentAmount);
            if (result) {
              if (result.paid) {
                totalRentCollected += result.amount;
              } else {
                // Citizen can't pay - evict them
                evictedCitizens.push(citizen.id);
              }
            }
          }
        }
      }
    }

    // Evict citizens who couldn't pay
    for (const citizenId of evictedCitizens) {
      phaserGameRef.current.evictCitizen(citizenId);
    }

    // Reset rent status for next month
    phaserGameRef.current.resetRentStatus();

    // Show eviction notification if any
    if (evictedCitizens.length > 0) {
      setModalState({
        isVisible: true,
        title: "Eviction Notice",
        message: `${evictedCitizens.length} citizen(s) could not afford rent and have been evicted from their homes.`,
      });
    }

    // Now process city finances
    setEconomy((prev) => {
      const newEconomy = { ...prev, activeLoans: [...prev.activeLoans] };
      let totalCosts = 0;

      // Calculate operating costs for all buildings and roads
      const roadSegments = new Set<string>();
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const cell = grid[y][x];
          if (cell.type === TileType.Road || cell.type === TileType.Asphalt) {
            if (cell.originX !== undefined && cell.originY !== undefined) {
              roadSegments.add(`${cell.originX},${cell.originY}`);
            }
          } else if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
            const building = getBuilding(cell.buildingId);
            if (building) {
              const economics = getBuildingEconomics(building);
              totalCosts += economics.monthlyOperatingCost;
            }
          }
        }
      }

      // Add road operating costs
      totalCosts += roadSegments.size * ROAD_COSTS.monthlyOperatingCost;

      // Process loan payments
      for (let i = 0; i < newEconomy.activeLoans.length; i++) {
        const loan = newEconomy.activeLoans[i];
        const monthlyPayment = loan.remainingBalance * loan.interestRate;

        if (newEconomy.money >= monthlyPayment) {
          // Can pay
          newEconomy.money -= monthlyPayment;
          loan.remainingBalance -= monthlyPayment;
          loan.monthsInDefault = 0;
        } else {
          // Cannot pay - go into default
          newEconomy.money -= monthlyPayment; // Go negative
          loan.monthsInDefault += 1;

          // Check for game over (3 months in default)
          if (loan.monthsInDefault >= 3) {
            setModalState({
              isVisible: true,
              title: "Game Over",
              message: `You have been unable to pay your loan to ${banks.find((b) => b.id === loan.bankId)?.name} for 3 months. The bank has foreclosed on your city.`,
              onConfirm: () => {
                // Reset game
                setEconomy({ money: 10000, activeLoans: [] });
                setGameTime({ year: 1995, month: 1, day: 1, hour: 6, minute: 0, dayProgress: 0 });
                setGrid(createEmptyGrid());
                phaserGameRef.current?.clearCharacters();
                phaserGameRef.current?.clearCars();
              },
            });
          }
        }
      }

      // Deduct operating costs
      newEconomy.money -= totalCosts;

      // Add rent income (collected from citizens)
      newEconomy.money += totalRentCollected;

      return newEconomy;
    });
  }, [grid, banks]);

  // Track previous month and day to detect changes
  const prevMonthRef = useRef(gameTime.month);
  const prevDayRef = useRef(gameTime.day);
  
  // Process monthly payments when month changes
  useEffect(() => {
    if (gameTime.month !== prevMonthRef.current && gameTime.month > prevMonthRef.current) {
      processMonthlyPayments();
      
      // Reset monthly building stats
      setBuildingStats((prev) => {
        const newStats = new Map(prev);
        for (const [key, stats] of newStats) {
          newStats.set(key, {
            ...stats,
            monthlyRevenue: 0,
            interactionsThisMonth: 0,
          });
        }
        return newStats;
      });
    }
    prevMonthRef.current = gameTime.month;
  }, [gameTime.month, processMonthlyPayments]);

  // Sync game time to Phaser (runs frequently to keep Phaser in sync)
  useEffect(() => {
    if (phaserGameRef.current) {
      phaserGameRef.current.setGameTime(gameTime);
    }
  }, [gameTime.day, gameTime.month, gameTime.year]);

  // Sync day/night visual state to Phaser (sky color + glow intensity)
  useEffect(() => {
    if (phaserGameRef.current) {
      if (dayNightVisuals) {
        phaserGameRef.current.setDayNightState({
          skyColor: dayNightVisuals.skyColor,
          glowIntensity: dayNightVisuals.glowIntensity,
          phase: dayNightVisuals.phase,
        });
      } else {
        // Day/night disabled — reset to default sky and turn off glows
        phaserGameRef.current.setDayNightState({
          skyColor: "#3d5560",
          glowIntensity: 0,
          phase: "day",
        });
      }
    }
  }, [dayNightVisuals]);

  // Auto-save silently (no modal, no sound) — saved via ref to avoid stale closures
  const autoSaveRef = useRef<() => void>(() => {});
  autoSaveRef.current = () => {
    const characterCount = phaserGameRef.current?.getCharacterCount() ?? 0;
    const carCount = phaserGameRef.current?.getCarCount() ?? 0;
    const saveData: GameSaveData = {
      grid,
      characterCount,
      carCount,
      zoom,
      visualSettings,
      dayNightEnabled,
      timestamp: Date.now(),
      economy,
      gameTime,
      gameSpeed,
      cityName,
      unlockedBuildingIds: Array.from(unlockedBuildingIds),
    };
    try {
      localStorage.setItem(
        `hugh-city_save_${cityName}`,
        JSON.stringify(saveData)
      );
      console.log(`[Auto-Save] City "${cityName}" saved (Day ${gameTime.day}, Month ${gameTime.month})`);
      // Show auto-save toast
      if (autoSaveToastTimerRef.current) clearTimeout(autoSaveToastTimerRef.current);
      setShowAutoSaveToast(true);
      autoSaveToastTimerRef.current = setTimeout(() => setShowAutoSaveToast(false), 2500);
    } catch (error) {
      console.error("[Auto-Save] Failed:", error);
    }
  };

  // Reset citizen daily money and check tourist expiry when day changes
  useEffect(() => {
    if (gameTime.day !== prevDayRef.current) {
      // Auto-save at the end of every in-game week (day 7, 14, 21, 28)
      if (gameTime.day % 7 === 0) {
        autoSaveRef.current();
      }

      // Reset daily revenue tracker for achievements
      dailyRevenueRef.current = 0;

      if (phaserGameRef.current) {
        phaserGameRef.current.resetDailyMoney();

        // Check for expired tourists every day
        const { leaving, becameHomeless } = phaserGameRef.current.removeTourists();

        // Tourists leaving → subtle toast notification (not a modal)
        if (leaving > 0) {
          if (touristLeavingToastTimerRef.current) clearTimeout(touristLeavingToastTimerRef.current);
          setTouristLeavingToast(
            `${leaving} tourist${leaving > 1 ? 's' : ''} left the city`
          );
          touristLeavingToastTimerRef.current = setTimeout(() => setTouristLeavingToast(null), 3000);
        }

        // Tourists becoming homeless → modal (important event the user should know about)
        if (becameHomeless > 0) {
          setModalState({
            isVisible: true,
            title: "Tourists Staying",
            message: `${becameHomeless} tourist${becameHomeless > 1 ? 's have' : ' has'} decided to stay as homeless citizen${becameHomeless > 1 ? 's' : ''}.`,
          });
        }

        // Auto-migrate tourists based on available housing
        const availableSlots = phaserGameRef.current.getAvailableHousingSlots();
        const expectedMigrants = Math.min(
          MIGRATION_BASE_RATE + availableSlots * MIGRATION_ATTRACTION_FACTOR,
          MIGRATION_MAX_PER_DAY
        );
        const wholePart = Math.floor(expectedMigrants);
        const fractionalPart = expectedMigrants - wholePart;
        const migrants = wholePart + (Math.random() < fractionalPart ? 1 : 0);
        for (let i = 0; i < migrants; i++) {
          phaserGameRef.current.spawnCharacter();
        }
      }
    }
    prevDayRef.current = gameTime.day;
  }, [gameTime.day]);

  // Check for midnight (Night Owl achievement)
  useEffect(() => {
    if (dayNightEnabled && gameTime.hour === 0) {
      midnightWitnessedRef.current = true;
    }
  }, [dayNightEnabled, gameTime.hour]);

  // Time progression system
  useEffect(() => {
    if (gameSpeed === GameSpeed.Paused) return;

    // Each day is ~1 minute (60 seconds)
    // Normal speed: 1 day per 60 seconds
    // Fast speed (2x): 1 day per 30 seconds
    const dayDuration = gameSpeed === GameSpeed.Normal ? 60000 : 30000;
    const interval = 100; // Update every 100ms for smooth progression

    const timer = setInterval(() => {
      setGameTime((prev) => {
        const newTime = { ...prev };
        const progressIncrement = (interval / dayDuration) * gameSpeed;
        newTime.dayProgress += progressIncrement;

        // Update time as day progresses
        const totalMinutes = newTime.dayProgress * 1440; // 1440 minutes in a day
        newTime.hour = Math.floor(totalMinutes / 60) % 24;
        newTime.minute = Math.floor(totalMinutes % 60);

        // Advance day when progress reaches 1
        if (newTime.dayProgress >= 1) {
          newTime.dayProgress = 0;
          newTime.day += 1;
          newTime.hour = 0;
          newTime.minute = 0;

          // Check for month end
          const daysInMonth = new Date(newTime.year, newTime.month, 0).getDate();
          if (newTime.day > daysInMonth) {
            newTime.day = 1;
            newTime.month += 1;

            // Check for year end
            if (newTime.month > 12) {
              newTime.month = 1;
              newTime.year += 1;
            }
          }
        }

        return newTime;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [gameSpeed]);

  // Sync game speed with Phaser (affects citizen/car speeds)
  useEffect(() => {
    if (phaserGameRef.current) {
      phaserGameRef.current.setGameSpeed(gameSpeed);
    }
  }, [gameSpeed]);

  // Ref to track current game time for statistics (avoids re-creating interval)
  const gameTimeRef = useRef(gameTime);
  useEffect(() => {
    gameTimeRef.current = gameTime;
  }, [gameTime]);

  // Collect statistics periodically
  useEffect(() => {
    if (gameSpeed === GameSpeed.Paused) return;

    const collectStats = () => {
      if (!phaserGameRef.current) return;

      try {
        const characters = phaserGameRef.current.getAllCitizens() || [];
        const time = gameTimeRef.current;
        const timestamp = time.year * 525600 + time.month * 43800 + time.day * 1440 + time.hour * 60 + time.minute;

        // Population stats
        const housed = characters.filter((c) => c.residenceX !== undefined).length;
        const tourists = characters.filter((c) => c.isTourist && c.residenceX === undefined).length;
        const homeless = characters.filter((c) => c.residenceX === undefined && !c.isTourist).length;
        const populationPoint = {
          total: characters.length,
          housed,
          homeless,
          tourists,
        };

        setPopulationHistory((prev) => {
          const newPoint: PopulationDataPoint = {
            timestamp,
            ...populationPoint,
          };
          return [...prev, newPoint].slice(-200);
        });

        setCurrentPopulationStats(populationPoint);

        // Happiness stats
        const happinessCount = {
          happy: 0,
          sad: 0,
          hungry: 0,
          angry: 0,
          depressed: 0,
        };

        characters.forEach((c) => {
          const moodlet = c.moodlet || "sad";
          if (moodlet in happinessCount) {
            happinessCount[moodlet as keyof typeof happinessCount]++;
          }
        });

        setHappinessHistory((prev) => {
          const newPoint: HappinessDataPoint = {
            timestamp,
            ...happinessCount,
          };
          return [...prev, newPoint].slice(-200);
        });

        setCurrentHappinessStats(happinessCount);
      } catch (e) {
        console.warn("Stats collection error:", e);
      }
    };

    const statsInterval = setInterval(collectStats, 5000);
    return () => clearInterval(statsInterval);
  }, [gameSpeed]);

  // Update building counts when grid or buildingStats change
  useEffect(() => {
    const categoryMap = new Map<string, { count: number; totalRevenue: number }>();
    const categoryColors: Record<string, string> = {
      residential: "#4ade80",
      commercial: "#60a5fa",
      civic: "#f472b6",
      landmark: "#fbbf24",
      props: "#a78bfa",
      christmas: "#ef4444",
    };

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = grid[y][x];
        if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
          const building = getBuilding(cell.buildingId);
          if (building) {
            const existing = categoryMap.get(building.category) || { count: 0, totalRevenue: 0 };
            const buildingKey = `${x},${y}`;
            const stats = buildingStats.get(buildingKey);
            categoryMap.set(building.category, {
              count: existing.count + 1,
              totalRevenue: existing.totalRevenue + (stats?.totalRevenue || 0),
            });
          }
        }
      }
    }

    const counts = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      count: data.count,
      totalRevenue: data.totalRevenue,
      color: categoryColors[category] || "#888888",
    }));

    setBuildingCountsStats(counts);
  }, [grid, buildingStats]);

  // Loan handling functions
  const handleTakeLoan = useCallback(
    (bankId: string) => {
      const bank = banks.find((b) => b.id === bankId);
      if (!bank) return;

      // Check if already has loan from this bank
      if (economy.activeLoans.some((loan) => loan.bankId === bankId)) {
        setModalState({
          isVisible: true,
          title: "Cannot Take Loan",
          message: "You already have an active loan from this bank. Pay it off first!",
        });
        return;
      }

      setEconomy((prev) => {
        const newLoan: ActiveLoan = {
          bankId: bank.id,
          principal: bank.loanAmount,
          remainingBalance: bank.loanAmount,
          interestRate: bank.interestRate,
          monthsInDefault: 0,
        };

        return {
          money: prev.money + bank.loanAmount,
          activeLoans: [...prev.activeLoans, newLoan],
        };
      });
    },
    [economy.activeLoans, banks]
  );

  const handlePayLoan = useCallback(
    (bankId: string) => {
      const loan = economy.activeLoans.find((l) => l.bankId === bankId);
      if (!loan) return;

      if (economy.money < loan.remainingBalance) {
        playErrorSound();
        setModalState({
          isVisible: true,
          title: "Insufficient Funds",
          message: `You need ${loan.remainingBalance.toLocaleString()} to pay off this loan.`,
        });
        return;
      }

      setEconomy((prev) => ({
        money: prev.money - loan.remainingBalance,
        activeLoans: prev.activeLoans.filter((l) => l.bankId !== bankId),
      }));
    },
    [economy]
  );

  // Check if player can afford a building/road
  const canAffordBuilding = useCallback(
    (buildingId: string): boolean => {
      const building = getBuilding(buildingId);
      if (!building) return false;
      const economics = getBuildingEconomics(building);
      return economy.money >= economics.buildCost;
    },
    [economy.money]
  );

  const canAffordRoad = useCallback((): boolean => {
    return economy.money >= ROAD_COSTS.buildCost;
  }, [economy.money]);

  // Handle building interactions (income generation and move-ins)
  const handleBuildingInteraction = useCallback(
    (
      buildingId: string,
      buildingOriginX: number,
      buildingOriginY: number,
      interactionType: "income" | "move_in",
      characterId?: string
    ) => {
      const building = getBuilding(buildingId);
      if (!building) return;

      const economics = getBuildingEconomics(building);
      const buildingKey = `${buildingOriginX},${buildingOriginY}`;

      if (interactionType === "income" && economics.incomePerInteraction) {
        // Generate income from business interaction — only play sound when zoomed in close
        if (zoomRef.current >= 2) playCashSound();
        setEconomy((prev) => ({
          ...prev,
          money: prev.money + economics.incomePerInteraction!,
        }));

        // Track daily revenue for achievements
        dailyRevenueRef.current += economics.incomePerInteraction;

        // Immediately check revenue achievements when threshold is crossed
        const rev = dailyRevenueRef.current;
        const revenueAchievements = [
          { id: "pocket-change", threshold: 1000 },
          { id: "business-boom", threshold: 10000 },
          { id: "economic-powerhouse", threshold: 50000 },
          { id: "tycoon-status", threshold: 100000 },
        ];
        for (const ra of revenueAchievements) {
          if (rev >= ra.threshold) {
            const result = unlockAchievement(ra.id, cityNameRef.current);
            if (result) {
              const def = ACHIEVEMENT_MAP[ra.id];
              if (def) setAchievementToast(def);
            }
          }
        }

        // Update building stats
        setBuildingStats((prev) => {
          const newStats = new Map(prev);
          const existing = newStats.get(buildingKey) || {
            buildingId,
            originX: buildingOriginX,
            originY: buildingOriginY,
            residents: [],
            totalRevenue: 0,
            monthlyRevenue: 0,
            interactionsThisMonth: 0,
          };
          newStats.set(buildingKey, {
            ...existing,
            totalRevenue: existing.totalRevenue + economics.incomePerInteraction!,
            monthlyRevenue: existing.monthlyRevenue + economics.incomePerInteraction!,
            interactionsThisMonth: existing.interactionsThisMonth + 1,
          });
          return newStats;
        });
      }

      if (interactionType === "move_in" && characterId) {
        // Update building stats for move-in
        setBuildingStats((prev) => {
          const newStats = new Map(prev);
          const existing = newStats.get(buildingKey) || {
            buildingId,
            originX: buildingOriginX,
            originY: buildingOriginY,
            residents: [],
            totalRevenue: 0,
            monthlyRevenue: 0,
            interactionsThisMonth: 0,
          };
          // Add resident if not already there
          if (!existing.residents.includes(characterId)) {
            newStats.set(buildingKey, {
              ...existing,
              residents: [...existing.residents, characterId],
            });
          }
          return newStats;
        });
      }
    },
    []
  );

  // Handle building click (show building info)
  const handleBuildingClick = useCallback(
    (buildingId: string, originX: number, originY: number) => {
      const buildingKey = `${originX},${originY}`;
      
      // Get or create building stats
      const existingStats = buildingStats.get(buildingKey);
      const stats: BuildingStats = existingStats || {
        buildingId,
        originX,
        originY,
        residents: [],
        totalRevenue: 0,
        monthlyRevenue: 0,
        interactionsThisMonth: 0,
      };

      // Get residents from Phaser and fetch their names
      if (phaserGameRef.current) {
        const residentCount = phaserGameRef.current.getBuildingResidentCount(originX, originY);
        // If we have more residents in Phaser than in stats, sync them
        // (This is a fallback - normally stats should be updated via callbacks)
        if (residentCount > stats.residents.length) {
          // We don't have the character IDs here, but at least show the count is correct
          // The residents array will be populated through move_in callbacks
        }
        
        // Fetch names for all residents to ensure they're in the characterNames map
        stats.residents.forEach((residentId) => {
          const citizen = phaserGameRef.current?.getCitizenData(residentId);
          if (citizen && citizen.name) {
            setCharacterNames((prev) => {
              const newMap = new Map(prev);
              newMap.set(residentId, citizen.name!);
              return newMap;
            });
          }
        });
      }

      setSelectedBuildingStats(stats);
      setIsBuildingInfoVisible(true);
    },
    [buildingStats]
  );

  // Handle citizen click (show citizen info)
  const handleCitizenClick = useCallback(
    (citizenId: string) => {
      if (!phaserGameRef.current) return;

      const citizen = phaserGameRef.current.getCitizenData(citizenId);
      if (!citizen) return;

      // Get residence building ID
      const residenceBuildingId = phaserGameRef.current.getCitizenResidenceBuildingId(citizenId);

      // Calculate monthly rent if they have a residence
      let monthlyRent = 0;
      if (residenceBuildingId) {
        const building = getBuilding(residenceBuildingId);
        if (building) {
          const economics = getBuildingEconomics(building);
          monthlyRent = economics.rentPerResident || 0;
        }
      }

      // Get destination building name if heading somewhere
      let destinationBuildingName: string | undefined;
      if (citizen.currentDestination?.buildingId) {
        const destBuilding = getBuilding(citizen.currentDestination.buildingId);
        if (destBuilding) {
          destinationBuildingName = destBuilding.name;
        }
      }

      // Calculate tourist days remaining
      let touristDaysRemaining: number | undefined;
      if (citizen.isTourist && citizen.touristArrivalDay !== undefined) {
        const arrivalDay = citizen.touristArrivalDay;
        const arrivalMonth = citizen.touristArrivalMonth ?? gameTime.month;
        let daysSinceArrival: number;
        if (gameTime.month === arrivalMonth) {
          daysSinceArrival = gameTime.day - arrivalDay;
        } else {
          const daysInArrivalMonth = new Date(gameTime.year, arrivalMonth, 0).getDate();
          daysSinceArrival = (daysInArrivalMonth - arrivalDay) + gameTime.day;
        }
        touristDaysRemaining = Math.max(0, 7 - daysSinceArrival);
      }

      const citizenData: CitizenData = {
        id: citizen.id,
        name: citizen.name || `Citizen ${citizen.id.slice(0, 6)}`,
        money: citizen.money ?? 0,
        dailyBudget: citizen.dailyBudget ?? 100,
        characterType: citizen.characterType,
        residenceX: citizen.residenceX,
        residenceY: citizen.residenceY,
        residenceBuildingId,
        rentPaid: citizen.rentPaid ?? false,
        state: citizen.state,
        destinationBuildingName,
        moodlet: citizen.moodlet,
        moodletReason: citizen.moodletReason,
        ateToday: citizen.ateToday,
        entertainedToday: citizen.entertainedToday,
        isTourist: citizen.isTourist,
        touristDaysRemaining,
      };

      // Update character names map
      setCharacterNames((prev) => {
        const newMap = new Map(prev);
        newMap.set(citizen.id, citizenData.name);
        return newMap;
      });

      setSelectedCitizenData({ ...citizenData, monthlyRent } as CitizenData & { monthlyRent: number });
      setIsCitizenInfoVisible(true);
    },
    []
  );

  // Refresh citizen data while info window is open
  useEffect(() => {
    if (!isCitizenInfoVisible || !selectedCitizenData) return;

    const refreshInterval = setInterval(() => {
      if (!phaserGameRef.current) return;

      const citizen = phaserGameRef.current.getCitizenData(selectedCitizenData.id);
      if (!citizen) {
        // Citizen no longer exists, close the window
        setIsCitizenInfoVisible(false);
        setSelectedCitizenData(null);
        return;
      }

      // Get residence building ID
      const residenceBuildingId = phaserGameRef.current.getCitizenResidenceBuildingId(citizen.id);

      // Calculate monthly rent if they have a residence
      let monthlyRent = 0;
      if (residenceBuildingId) {
        const building = getBuilding(residenceBuildingId);
        if (building) {
          const economics = getBuildingEconomics(building);
          monthlyRent = economics.rentPerResident || 0;
        }
      }

      // Get destination building name if heading somewhere
      let destinationBuildingName: string | undefined;
      if (citizen.currentDestination?.buildingId) {
        const destBuilding = getBuilding(citizen.currentDestination.buildingId);
        if (destBuilding) {
          destinationBuildingName = destBuilding.name;
        }
      }

      // Calculate tourist days remaining
      let touristDaysRemaining: number | undefined;
      if (citizen.isTourist && citizen.touristArrivalDay !== undefined) {
        const arrivalDay = citizen.touristArrivalDay;
        const arrivalMonth = citizen.touristArrivalMonth ?? gameTime.month;
        let daysSinceArrival: number;
        if (gameTime.month === arrivalMonth) {
          daysSinceArrival = gameTime.day - arrivalDay;
        } else {
          const daysInArrivalMonth = new Date(gameTime.year, arrivalMonth, 0).getDate();
          daysSinceArrival = (daysInArrivalMonth - arrivalDay) + gameTime.day;
        }
        touristDaysRemaining = Math.max(0, 7 - daysSinceArrival);
      }

      const updatedData: CitizenData = {
        id: citizen.id,
        name: citizen.name || `Citizen ${citizen.id.slice(0, 6)}`,
        money: citizen.money ?? 0,
        dailyBudget: citizen.dailyBudget ?? 100,
        characterType: citizen.characterType,
        residenceX: citizen.residenceX,
        residenceY: citizen.residenceY,
        residenceBuildingId,
        rentPaid: citizen.rentPaid ?? false,
        state: citizen.state,
        destinationBuildingName,
        moodlet: citizen.moodlet,
        moodletReason: citizen.moodletReason,
        ateToday: citizen.ateToday,
        entertainedToday: citizen.entertainedToday,
        isTourist: citizen.isTourist,
        touristDaysRemaining,
      };

      setSelectedCitizenData({ ...updatedData, monthlyRent } as CitizenData & { monthlyRent: number });
    }, 500); // Refresh every 500ms

    return () => clearInterval(refreshInterval);
  }, [isCitizenInfoVisible, selectedCitizenData?.id]);

  // Handle citizen name change
  const handleCitizenNameChange = useCallback(
    (citizenId: string, newName: string) => {
      if (phaserGameRef.current) {
        phaserGameRef.current.updateCitizenName(citizenId, newName);
        
        // Update character names map
        setCharacterNames((prev) => {
          const newMap = new Map(prev);
          newMap.set(citizenId, newName);
          return newMap;
        });

        // Update selected citizen data if it's the same citizen
        setSelectedCitizenData((prev) => {
          if (prev && prev.id === citizenId) {
            return { ...prev, name: newName };
          }
          return prev;
        });
      }
    },
    []
  );

  // Handle citizen spending (sync money from Phaser to React)
  const handleCitizenSpend = useCallback(
    (citizenId: string, amount: number) => {
      // This is just for tracking - the actual money is managed in Phaser
      // We could track spending stats here if needed
    },
    []
  );

  // Get monthly rent for the selected citizen
  const getSelectedCitizenRent = useCallback((): number => {
    if (!selectedCitizenData || !selectedCitizenData.residenceBuildingId) return 0;
    const building = getBuilding(selectedCitizenData.residenceBuildingId);
    if (!building) return 0;
    const economics = getBuildingEconomics(building);
    return economics.rentPerResident || 0;
  }, [selectedCitizenData]);

  // Get list of all citizens for the citizen list window
  const getCitizenList = useCallback((): CitizenListItem[] => {
    if (!phaserGameRef.current) return [];
    
    const citizens = phaserGameRef.current.getAllCitizens();
    return citizens.map((citizen) => {
      const residenceBuildingId = citizen.residenceX !== undefined 
        ? phaserGameRef.current?.getCitizenResidenceBuildingId(citizen.id)
        : undefined;
      const residenceBuilding = residenceBuildingId ? getBuilding(residenceBuildingId) : null;
      
      return {
        id: citizen.id,
        name: citizen.name || `Citizen ${citizen.id.slice(0, 6)}`,
        money: citizen.money ?? 0,
        characterType: citizen.characterType,
        hasResidence: citizen.residenceX !== undefined,
        residenceBuildingName: residenceBuilding?.name,
        moodlet: citizen.moodlet,
        moodletReason: citizen.moodletReason,
        isTourist: citizen.isTourist,
      };
    });
  }, []);

  // Handle citizen click from list - open their info window
  const handleCitizenListClick = useCallback((citizenId: string) => {
    setIsCitizenListVisible(false);
    handleCitizenClick(citizenId);
  }, [handleCitizenClick]);

  // Memoized close handler for statistics window
  const handleStatisticsClose = useCallback(() => {
    setIsStatisticsVisible(false);
  }, []);

  // Music track play callback for achievements
  const handleTrackPlay = useCallback((genre: string, trackIndex: number) => {
    tracksPlayedRef.current.add(`${genre}_${trackIndex}`);
  }, []);

  // Achievement checking interval (every 2 seconds)
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (!phaserGameRef.current) return;

      // Gather current game state for achievement checks
      const citizens = phaserGameRef.current.getAllCitizens?.() ?? [];
      const housedCount = citizens.filter(
        (c: any) => c.residenceX !== undefined && !c.isTourist
      ).length;
      const carCount = phaserGameRef.current.getCarCount?.() ?? 0;

      // Total tracks across both genres: 3 chill + 7 jazz = 10
      const totalTracksCount = 10;
      const tracksPlayedCount = tracksPlayedRef.current.size;

      // Build progress data
      const progressData: AchievementProgressData = {
        housedCitizens: housedCount,
        dailyRevenue: dailyRevenueRef.current,
        totalBuildingsPlaced: totalBuildingsPlacedRef.current,
        totalDemolitions: totalDemolitionsRef.current,
        homelessLeft: homelessLeftRef.current,
        carCount,
        midnightWitnessed: midnightWitnessedRef.current,
        tracksPlayedCount,
      };

      // Check each achievement
      for (const achievement of ACHIEVEMENTS) {
        let shouldUnlock = false;

        switch (achievement.id) {
          case "welcome-home":
            shouldUnlock = housedCount >= 1;
            break;
          case "small-town-vibes":
            shouldUnlock = housedCount >= 10;
            break;
          case "growing-community":
            shouldUnlock = housedCount >= 50;
            break;
          case "metropolis-rising":
            shouldUnlock = housedCount >= 100;
            break;
          case "pocket-change":
            shouldUnlock = dailyRevenueRef.current >= 1000;
            break;
          case "business-boom":
            shouldUnlock = dailyRevenueRef.current >= 10000;
            break;
          case "economic-powerhouse":
            shouldUnlock = dailyRevenueRef.current >= 50000;
            break;
          case "tycoon-status":
            shouldUnlock = dailyRevenueRef.current >= 100000;
            break;
          case "growing-pains":
            shouldUnlock = homelessLeftRef.current > 0;
            break;
          case "first-foundation":
            shouldUnlock = totalBuildingsPlacedRef.current >= 10;
            break;
          case "urban-planner":
            shouldUnlock = totalBuildingsPlacedRef.current >= 25;
            break;
          case "master-architect":
            shouldUnlock = totalBuildingsPlacedRef.current >= 100;
            break;
          case "night-owl":
            shouldUnlock = midnightWitnessedRef.current;
            break;
          case "rush-hour":
            shouldUnlock = carCount >= 5;
            break;
          case "dj-booth":
            shouldUnlock = tracksPlayedCount >= totalTracksCount;
            break;
          case "demolition-derby":
            shouldUnlock = totalDemolitionsRef.current >= 50;
            break;
        }

        if (shouldUnlock) {
          const result = unlockAchievement(achievement.id, cityNameRef.current);
          if (result) {
            // Newly unlocked! Show toast
            setAchievementToast(achievement);
          }
        }
      }

      // Check for building unlocks
      const newlyUnlocked = getNewlyUnlockedBuildings(
        housedCount,
        dailyRevenueRef.current,
        unlockedBuildingIdsRef.current
      );

      if (newlyUnlocked.length > 0) {
        setUnlockedBuildingIds((prev) => {
          const next = new Set(prev);
          for (const id of newlyUnlocked) {
            next.add(id);
          }
          return next;
        });

        // Group newly unlocked buildings by tier for consolidated toasts
        const tierCounts = new Map<string, number>();
        for (const id of newlyUnlocked) {
          const req = getUnlockRequirement(id);
          if (req) {
            tierCounts.set(req.tierName, (tierCounts.get(req.tierName) ?? 0) + 1);
          }
        }

        for (const [tierName, count] of tierCounts) {
          unlockToastQueueRef.current.push({ tierName, count });
        }

        // Show first toast if none currently showing
        if (!unlockToast && unlockToastQueueRef.current.length > 0) {
          setUnlockToast(unlockToastQueueRef.current.shift()!);
        }
      }

      // Persist progress
      saveProgress({
        totalBuildingsPlaced: totalBuildingsPlacedRef.current,
        totalDemolitions: totalDemolitionsRef.current,
        homelessLeft: homelessLeftRef.current,
        tracksPlayed: Array.from(tracksPlayedRef.current),
        midnightWitnessed: midnightWitnessedRef.current,
      });
    }, 2000);

    return () => clearInterval(checkInterval);
  }, [cityName]);

  // Handle tile click (grid modifications)
  const handleTileClick = useCallback(
    (x: number, y: number) => {
      let demolitionRefund = 0;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));

        switch (selectedTool) {
          case ToolType.None: {
            break;
          }
          case ToolType.RoadNetwork: {
            // Check if can afford road
            if (!canAffordRoad()) {
              playErrorSound();
              setModalState({
                isVisible: true,
                title: "Insufficient Funds",
                message: `You need $${ROAD_COSTS.buildCost} to build a road segment.`,
              });
              break;
            }
            const segmentOrigin = getRoadSegmentOrigin(x, y);
            const placementCheck = canPlaceRoadSegment(
              newGrid,
              segmentOrigin.x,
              segmentOrigin.y
            );
            if (!placementCheck.valid) break;

            for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                const px = segmentOrigin.x + dx;
                const py = segmentOrigin.y + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                  newGrid[py][px].originX = segmentOrigin.x;
                  newGrid[py][px].originY = segmentOrigin.y;
                  newGrid[py][px].type = TileType.Road;
                }
              }
            }

            const affectedSegments = getAffectedSegments(
              segmentOrigin.x,
              segmentOrigin.y
            );

            for (const seg of affectedSegments) {
              if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

              const connections = getRoadConnections(newGrid, seg.x, seg.y);
              const segmentType = getSegmentType(connections);
              const pattern = generateRoadPattern(segmentType);

              for (const tile of pattern) {
                const px = seg.x + tile.dx;
                const py = seg.y + tile.dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  newGrid[py][px].type = tile.type;
                }
              }
            }
            // Deduct road cost
            setEconomy((prev) => ({
              ...prev,
              money: prev.money - ROAD_COSTS.buildCost,
            }));
            playBuildRoadSound();
            break;
          }
          case ToolType.Tile: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Tile;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow
              ) {
                newGrid[y][x].type = TileType.Tile;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Asphalt: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Asphalt;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow ||
                cell.type === TileType.Tile
              ) {
                newGrid[y][x].type = TileType.Asphalt;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Snow: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Snow;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Tile
              ) {
                newGrid[y][x].type = TileType.Snow;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Building: {
            if (!selectedBuildingId) break;

            const building = getBuilding(selectedBuildingId);
            if (!building) break;

            // Check if building is unlocked
            if (!isBuildingUnlocked(selectedBuildingId, currentPopulationStats.housed, dailyRevenueRef.current, unlockedBuildingIds)) {
              playErrorSound();
              const req = getUnlockRequirement(selectedBuildingId);
              setModalState({
                isVisible: true,
                title: "Building Locked",
                message: req
                  ? `Reach ${req.population} citizens or $${req.revenue.toLocaleString()}/day revenue to unlock ${building.name}.`
                  : "This building is locked.",
              });
              break;
            }

            // Check if can afford building
            if (!canAffordBuilding(selectedBuildingId)) {
              playErrorSound();
              const economics = getBuildingEconomics(building);
              setModalState({
                isVisible: true,
                title: "Insufficient Funds",
                message: `You need $${economics.buildCost.toLocaleString()} to build ${building.name}.`,
              });
              break;
            }

            // Get footprint based on current orientation
            const footprint = getBuildingFootprint(
              building,
              buildingOrientation
            );
            const bOriginX = x - footprint.width + 1;
            const bOriginY = y - footprint.height + 1;

            if (
              bOriginX < 0 ||
              bOriginY < 0 ||
              bOriginX + footprint.width > GRID_WIDTH ||
              bOriginY + footprint.height > GRID_HEIGHT
            ) {
              break;
            }

            const isDecoration =
              building.category === "props" || building.isDecoration;
            let buildingHasCollision = false;
            for (
              let dy = 0;
              dy < footprint.height && !buildingHasCollision;
              dy++
            ) {
              for (
                let dx = 0;
                dx < footprint.width && !buildingHasCollision;
                dx++
              ) {
                const px = bOriginX + dx;
                const py = bOriginY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  const cellType = newGrid[py][px].type;
                  if (isDecoration) {
                    // Decorations can be placed on grass, tile, or snow
                    if (
                      cellType !== TileType.Grass &&
                      cellType !== TileType.Tile &&
                      cellType !== TileType.Snow
                    ) {
                      buildingHasCollision = true;
                    }
                  } else {
                    if (cellType !== TileType.Grass) {
                      buildingHasCollision = true;
                    }
                  }
                }
              }
            }
            if (buildingHasCollision) break;

            for (let dy = 0; dy < footprint.height; dy++) {
              for (let dx = 0; dx < footprint.width; dx++) {
                const px = bOriginX + dx;
                const py = bOriginY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  const underlyingType = isDecoration
                    ? newGrid[py][px].type
                    : undefined;
                  newGrid[py][px].type = TileType.Building;
                  newGrid[py][px].buildingId = selectedBuildingId;
                  newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                  newGrid[py][px].originX = bOriginX;
                  newGrid[py][px].originY = bOriginY;
                  if (isDecoration) {
                    newGrid[py][px].underlyingTileType = underlyingType;
                  }
                  if (building.supportsRotation) {
                    newGrid[py][px].buildingOrientation = buildingOrientation;
                  }
                }
              }
            }
            // Deduct building cost
            const economics = getBuildingEconomics(building);
            setEconomy((prev) => ({
              ...prev,
              money: prev.money - economics.buildCost,
            }));
            playBuildSound();
            // Track building placement for achievements
            totalBuildingsPlacedRef.current += 1;
            // Trigger screen shake effect (like SimCity 4)
            if (phaserGameRef.current) {
              phaserGameRef.current.shakeScreen("y", 0.6, 150);
            }
            break;
          }
          case ToolType.Eraser: {
            const cell = newGrid[y][x];
            const originX = cell.originX;
            const originY = cell.originY;
            const cellType = cell.type;

            const shouldPlaySound = cellType !== TileType.Grass;

            if (originX !== undefined && originY !== undefined) {
              const isRoadSegment =
                hasRoadSegment(newGrid, originX, originY) &&
                (cellType === TileType.Road || cellType === TileType.Asphalt);

              if (isRoadSegment) {
                // Road demolition refund (30%)
                demolitionRefund += Math.floor(ROAD_COSTS.buildCost * 0.3);

                const neighbors = getAffectedSegments(originX, originY).filter(
                  (seg) => seg.x !== originX || seg.y !== originY
                );

                for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
                  for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                    const px = originX + dx;
                    const py = originY + dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      newGrid[py][px].type = TileType.Grass;
                      newGrid[py][px].isOrigin = true;
                      newGrid[py][px].originX = undefined;
                      newGrid[py][px].originY = undefined;
                    }
                  }
                }

                for (const seg of neighbors) {
                  if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

                  const connections = getRoadConnections(newGrid, seg.x, seg.y);
                  const segmentType = getSegmentType(connections);
                  const pattern = generateRoadPattern(segmentType);

                  for (const tile of pattern) {
                    const px = seg.x + tile.dx;
                    const py = seg.y + tile.dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      newGrid[py][px].type = tile.type;
                    }
                  }
                }

                if (shouldPlaySound) {
                  playDestructionSound();
                  // Horizontal shake on deletion
                  phaserGameRef.current?.shakeScreen("x", 0.6, 150);
                }
              } else {
                const cellBuildingId = cell.buildingId;
                let sizeW = 1;
                let sizeH = 1;

                if (cellType === TileType.Building && cellBuildingId) {
                  const building = getBuilding(cellBuildingId);
                  if (building) {
                    // Building demolition refund (30%)
                    const economics = getBuildingEconomics(building);
                    demolitionRefund += Math.floor(economics.buildCost * 0.3);
                    // Track demolition for achievements
                    totalDemolitionsRef.current += 1;
                    // Get footprint based on stored orientation
                    const footprint = getBuildingFootprint(
                      building,
                      cell.buildingOrientation
                    );
                    sizeW = footprint.width;
                    sizeH = footprint.height;
                  }
                }

                for (let dy = 0; dy < sizeH; dy++) {
                  for (let dx = 0; dx < sizeW; dx++) {
                    const px = originX + dx;
                    const py = originY + dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      newGrid[py][px].type = TileType.Grass;
                      newGrid[py][px].buildingId = undefined;
                      newGrid[py][px].isOrigin = true;
                      newGrid[py][px].originX = undefined;
                      newGrid[py][px].originY = undefined;
                    }
                  }
                }

                if (shouldPlaySound) {
                  playDestructionSound();
                  // Horizontal shake on deletion
                  phaserGameRef.current?.shakeScreen("x", 0.6, 150);
                }
              }
            } else if (cellType !== TileType.Grass) {
              newGrid[y][x].type = TileType.Grass;
              newGrid[y][x].isOrigin = true;
              playDestructionSound();
              // Horizontal shake on deletion
              phaserGameRef.current?.shakeScreen("x", 0.6, 150);
            }
            break;
          }
        }

        return newGrid;
      });

      // Apply demolition refund from eraser
      if (demolitionRefund > 0) {
        setEconomy((prev) => ({
          ...prev,
          money: prev.money + demolitionRefund,
        }));
      }
    },
    [selectedTool, selectedBuildingId, buildingOrientation, canAffordBuilding, canAffordRoad]
  );

  // Handle batch tile placement from drag operations (snow/tile tools)
  const handleTilesDrag = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      if (tiles.length === 0) return;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        let anyPlaced = false;

        for (const { x, y } of tiles) {
          if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

          const cell = newGrid[y][x];

          if (selectedTool === ToolType.Snow) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Snow;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Tile
            ) {
              newGrid[y][x].type = TileType.Snow;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          } else if (selectedTool === ToolType.Tile) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Tile;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Snow
            ) {
              newGrid[y][x].type = TileType.Tile;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          } else if (selectedTool === ToolType.Asphalt) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Asphalt;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Snow ||
              cell.type === TileType.Tile
            ) {
              newGrid[y][x].type = TileType.Asphalt;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          }
        }

        if (anyPlaced) {
          playBuildRoadSound();
        }

        return newGrid;
      });
    },
    [selectedTool]
  );

  // Handle batch road segment placement from drag operations
  const handleRoadDrag = useCallback(
    (segments: Array<{ x: number; y: number }>) => {
      if (segments.length === 0) return;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        let anyPlaced = false;

        // Place all road segments
        for (const { x: segmentX, y: segmentY } of segments) {
          const placementCheck = canPlaceRoadSegment(
            newGrid,
            segmentX,
            segmentY
          );
          if (!placementCheck.valid) continue;

          for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
            for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
              const px = segmentX + dx;
              const py = segmentY + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                newGrid[py][px].originX = segmentX;
                newGrid[py][px].originY = segmentY;
                newGrid[py][px].type = TileType.Road;
                anyPlaced = true;
              }
            }
          }
        }

        if (anyPlaced) {
          // Update all affected segments (including neighbors)
          const allAffectedSegments = new Set<string>();
          for (const { x: segmentX, y: segmentY } of segments) {
            const affectedSegments = getAffectedSegments(segmentX, segmentY);
            for (const seg of affectedSegments) {
              allAffectedSegments.add(`${seg.x},${seg.y}`);
            }
          }

          for (const segKey of allAffectedSegments) {
            const [segX, segY] = segKey.split(",").map(Number);
            if (!hasRoadSegment(newGrid, segX, segY)) continue;

            const connections = getRoadConnections(newGrid, segX, segY);
            const segmentType = getSegmentType(connections);
            const pattern = generateRoadPattern(segmentType);

            for (const tile of pattern) {
              const px = segX + tile.dx;
              const py = segY + tile.dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                newGrid[py][px].type = tile.type;
              }
            }
          }

          playBuildRoadSound();
        }

        return newGrid;
      });
    },
    []
  );

  // Perform the actual deletion of tiles
  const performDeletion = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      let totalRefund = 0;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        const deletedOrigins = new Set<string>();

        for (const { x, y } of tiles) {
          if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

          const cell = newGrid[y][x];
          if (cell.type === TileType.Grass) continue;

          const originX = cell.originX ?? x;
          const originY = cell.originY ?? y;
          const originKey = `${originX},${originY}`;

          if (deletedOrigins.has(originKey)) continue;
          deletedOrigins.add(originKey);

          const cellType = cell.type;

          // Calculate demolition refund (30% of build cost)
          if (cellType === TileType.Building && cell.buildingId) {
            const building = getBuilding(cell.buildingId);
            if (building) {
              const economics = getBuildingEconomics(building);
              totalRefund += Math.floor(economics.buildCost * 0.3);
            }
            // Track demolition for achievements
            totalDemolitionsRef.current += 1;
          } else if ((cellType === TileType.Road || cellType === TileType.Asphalt) && hasRoadSegment(prevGrid, originX, originY)) {
            totalRefund += Math.floor(ROAD_COSTS.buildCost * 0.3);
          }

          if (cellType === TileType.Road || cellType === TileType.Asphalt) {
            const isRoadSegment = hasRoadSegment(newGrid, originX, originY);

            if (isRoadSegment) {
              // Delete road segment
              const neighbors = getAffectedSegments(originX, originY).filter(
                (seg) => seg.x !== originX || seg.y !== originY
              );

              for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
                for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                  const px = originX + dx;
                  const py = originY + dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    newGrid[py][px].type = TileType.Grass;
                    newGrid[py][px].isOrigin = true;
                    newGrid[py][px].originX = undefined;
                    newGrid[py][px].originY = undefined;
                  }
                }
              }

              // Update neighboring road segments
              for (const seg of neighbors) {
                if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

                const connections = getRoadConnections(newGrid, seg.x, seg.y);
                const segmentType = getSegmentType(connections);
                const pattern = generateRoadPattern(segmentType);

                for (const tile of pattern) {
                  const px = seg.x + tile.dx;
                  const py = seg.y + tile.dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    newGrid[py][px].type = tile.type;
                  }
                }
              }
            } else {
              // Single tile
              newGrid[y][x].type = TileType.Grass;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = undefined;
              newGrid[y][x].originY = undefined;
            }
          } else if (cellType === TileType.Building && cell.buildingId) {
            // Delete building
            const building = getBuilding(cell.buildingId);
            let sizeW = 1;
            let sizeH = 1;

            if (building) {
              const footprint = getBuildingFootprint(
                building,
                cell.buildingOrientation
              );
              sizeW = footprint.width;
              sizeH = footprint.height;
            }

            for (let dy = 0; dy < sizeH; dy++) {
              for (let dx = 0; dx < sizeW; dx++) {
                const px = originX + dx;
                const py = originY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  newGrid[py][px].type = TileType.Grass;
                  newGrid[py][px].buildingId = undefined;
                  newGrid[py][px].isOrigin = true;
                  newGrid[py][px].originX = undefined;
                  newGrid[py][px].originY = undefined;
                }
              }
            }
          } else {
            // Snow, Tile, or other single tiles
            newGrid[y][x].type = TileType.Grass;
            newGrid[y][x].isOrigin = true;
            newGrid[y][x].originX = undefined;
            newGrid[y][x].originY = undefined;
          }
        }

        playDestructionSound();
        // Horizontal shake on deletion (eraser drag / bulk delete path)
        phaserGameRef.current?.shakeScreen("x", 0.6, 150);
        return newGrid;
      });

      // Apply demolition refund
      if (totalRefund > 0) {
        setEconomy((prev) => ({
          ...prev,
          money: prev.money + totalRefund,
        }));
      }
    },
    []
  );

  // Handle eraser drag with confirmation modal
  const handleEraserDrag = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      if (tiles.length === 0) return;

      // Count unique items that would be deleted
      const itemsToDelete = new Set<string>();
      const processedOrigins = new Set<string>();

      for (const { x, y } of tiles) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

        const cell = grid[y]?.[x];
        if (!cell || cell.type === TileType.Grass) continue;

        const originX = cell.originX ?? x;
        const originY = cell.originY ?? y;
        const originKey = `${originX},${originY}`;

        if (processedOrigins.has(originKey)) continue;
        processedOrigins.add(originKey);

        if (cell.type === TileType.Building && cell.buildingId) {
          const building = getBuilding(cell.buildingId);
          itemsToDelete.add(
            `building:${originKey}:${building?.name || "Building"}`
          );
        } else if (
          cell.type === TileType.Road ||
          cell.type === TileType.Asphalt
        ) {
          const isRoadSegment = hasRoadSegment(grid, originX, originY);
          if (isRoadSegment) {
            itemsToDelete.add(`road:${originKey}`);
          } else {
            itemsToDelete.add(`tile:${x},${y}`);
          }
        } else {
          itemsToDelete.add(`tile:${x},${y}`);
        }
      }

      if (itemsToDelete.size === 0) return;

      // Show confirmation modal for multiple items
      if (itemsToDelete.size > 1) {
        // Store tiles for deletion after confirmation
        const tilesToDelete = [...tiles];
        setModalState({
          isVisible: true,
          title: "Confirm Deletion",
          message: `Are you sure you want to delete ${itemsToDelete.size} items?`,
          showCancel: true,
          onConfirm: () => performDeletion(tilesToDelete),
        });
        return;
      }

      // Single item - delete immediately without confirmation
      performDeletion(tiles);
    },
    [grid, performDeletion]
  );

  // Spawn handlers (delegate to Phaser)
  const handleSpawnCar = useCallback(() => {
    if (phaserGameRef.current) {
      const success = phaserGameRef.current.spawnCar();
      if (!success) {
        setModalState({
          isVisible: true,
          title: "Cannot Spawn Car",
          message: "Please place some roads with asphalt first!",
        });
      }
    }
  }, []);

  // Save/Load functions
  const handleSaveGame = useCallback(() => {
    const characterCount = phaserGameRef.current?.getCharacterCount() ?? 0;
    const carCount = phaserGameRef.current?.getCarCount() ?? 0;

    const saveData: GameSaveData = {
      grid,
      characterCount,
      carCount,
      zoom,
      visualSettings,
      dayNightEnabled,
      timestamp: Date.now(),
      economy,
      gameTime,
      gameSpeed,
      cityName,
      unlockedBuildingIds: Array.from(unlockedBuildingIds),
    };

    try {
      localStorage.setItem(
        `hugh-city_save_${cityName}`,
        JSON.stringify(saveData)
      );
      setModalState({
        isVisible: true,
        title: "Game Saved",
        message: `City "${cityName}" saved!`,
      });
      playDoubleClickSound();
    } catch (error) {
      setModalState({
        isVisible: true,
        title: "Save Failed",
        message: "Failed to save game!",
      });
      console.error("Save error:", error);
    }
  }, [grid, zoom, visualSettings, dayNightEnabled, economy, gameTime, gameSpeed, cityName, unlockedBuildingIds]);

  const handleLoadGame = useCallback((saveData: GameSaveData) => {
    try {
      // Restore grid
      setGrid(saveData.grid);

      // Clear existing characters and cars
      phaserGameRef.current?.clearCharacters();
      phaserGameRef.current?.clearCars();

      // Restore UI state
      if (saveData.zoom !== undefined) {
        setZoom(saveData.zoom);
      }
      if (saveData.visualSettings) {
        setVisualSettings(saveData.visualSettings);
      }
      if (saveData.dayNightEnabled !== undefined) {
        setDayNightEnabled(saveData.dayNightEnabled);
      }
      if (saveData.economy) {
        setEconomy(saveData.economy);
      }
      if (saveData.gameTime) {
        setGameTime(saveData.gameTime);
      }
      if (saveData.gameSpeed !== undefined) {
        setGameSpeed(saveData.gameSpeed);
      }
      if (saveData.unlockedBuildingIds) {
        setUnlockedBuildingIds(new Set(saveData.unlockedBuildingIds));
      } else {
        setUnlockedBuildingIds(new Set());
      }

      // Wait for grid to update, then spawn characters and cars
      setTimeout(() => {
        for (let i = 0; i < (saveData.characterCount ?? 0); i++) {
          phaserGameRef.current?.spawnCharacter();
        }
        for (let i = 0; i < (saveData.carCount ?? 0); i++) {
          phaserGameRef.current?.spawnCar();
        }
      }, 100);

      setModalState({
        isVisible: true,
        title: "Game Loaded",
        message: "Game loaded successfully!",
      });
      playDoubleClickSound();
    } catch (error) {
      setModalState({
        isVisible: true,
        title: "Load Failed",
        message: "Failed to load game!",
      });
      console.error("Load error:", error);
    }
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    playZoomSound();
    setZoom((prev) => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        // If current zoom is smooth (from scroll wheel), snap to nearest preset and go up
        const closestIndex = findClosestZoomIndex(prev);
        // If we're below the closest level, snap to it; otherwise go one above
        const target = ZOOM_LEVELS[closestIndex] > prev ? closestIndex : closestIndex + 1;
        return ZOOM_LEVELS[Math.min(target, ZOOM_LEVELS.length - 1)];
      }
      return ZOOM_LEVELS[Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1)];
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    playZoomSound();
    setZoom((prev) => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        // If current zoom is smooth (from scroll wheel), snap to nearest preset and go down
        const closestIndex = findClosestZoomIndex(prev);
        // If we're above the closest level, snap to it; otherwise go one below
        const target = ZOOM_LEVELS[closestIndex] < prev ? closestIndex : closestIndex - 1;
        return ZOOM_LEVELS[Math.max(target, 0)];
      }
      return ZOOM_LEVELS[Math.max(currentIndex - 1, 0)];
    });
  }, []);

  // Zoom is now handled directly in Phaser for correct pointer coordinates
  // This callback just syncs React state when Phaser emits a zoom change
  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
        background: "#4a5d6a",
      }}
    >
      {/* Top Left - Save/Load and Zoom buttons */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 2, // Slight margin so border doesn't touch edge
          zIndex: 1000,
          display: "flex",
          gap: 0,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Menu button */}
        <button
          onClick={() => {
            playDoubleClickSound();
            setModalState({
              isVisible: true,
              title: "Return to Menu",
              message: "Return to main menu? Unsaved progress will be lost.",
              showCancel: true,
              onConfirm: () => onReturnToMenu?.(),
            });
          }}
          title="Main Menu"
          className="rct-blue-button-interactive"
          style={{
            background: "#B0B0B0",
            border: "2px solid",
            borderColor: "#D0D0D0 #707070 #707070 #D0D0D0",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTopWidth: 0,
            boxShadow: "1px 1px 0px #505050",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#707070 #D0D0D0 #D0D0D0 #707070";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #505050";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#D0D0D0 #707070 #707070 #D0D0D0";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #505050";
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
            <path d="M10 3H4C3.45 3 3 3.45 3 4V20C3 20.55 3.45 21 4 21H10" stroke="#444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 7L10 12L15 17" stroke="#444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 12H22" stroke="#444" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </button>
        {/* Settings button */}
        <button
          onClick={() => {
            setIsSettingsVisible((prev) => !prev);
            playClickSound();
          }}
          title="Settings"
          className="rct-blue-button-interactive"
          style={{
            background: "#B0B0B0",
            border: "2px solid",
            borderColor: "#D0D0D0 #707070 #707070 #D0D0D0",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTopWidth: 0,
            boxShadow: "1px 1px 0px #505050",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#707070 #D0D0D0 #D0D0D0 #707070";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #505050";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#D0D0D0 #707070 #707070 #D0D0D0";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #505050";
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {/* Save button */}
        <button
          onClick={() => {
            handleSaveGame();
            playDoubleClickSound();
          }}
          title="Save Game"
          className="rct-blue-button-interactive"
          style={{
            background: "#B0B0B0",
            border: "2px solid",
            borderColor: "#D0D0D0 #707070 #707070 #D0D0D0",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTopWidth: 0,
            boxShadow: "1px 1px 0px #505050",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#707070 #D0D0D0 #D0D0D0 #707070";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #505050";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#D0D0D0 #707070 #707070 #D0D0D0";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #505050";
          }}
        >
          <img
            src="/UI/save.png"
            alt="Save"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            handleZoomOut();
            playDoubleClickSound();
          }}
          title="Zoom Out"
          className="rct-blue-button-interactive"
          style={{
            background: "#6CA6E8",
            border: "2px solid",
            borderColor: "#A3CDF9 #366BA8 #366BA8 #A3CDF9", // Light, Dark, Dark, Light
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0, // No rounded corners
            borderTopWidth: 0, // Remove top border to attach to edge
            boxShadow: "1px 1px 0px #244B7A",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#366BA8 #A3CDF9 #A3CDF9 #366BA8"; // Inverted
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #244B7A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#A3CDF9 #366BA8 #366BA8 #A3CDF9"; // Reset
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #244B7A";
          }}
        >
          <img
            src="/UI/zoomout.png"
            alt="Zoom Out"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            handleZoomIn();
            playDoubleClickSound();
          }}
          title="Zoom In"
          className="rct-blue-button-interactive"
          style={{
            background: "#6CA6E8",
            border: "2px solid",
            borderColor: "#A3CDF9 #366BA8 #366BA8 #A3CDF9", // Light, Dark, Dark, Light
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0, // No rounded corners
            borderTopWidth: 0, // Remove top border
            boxShadow: "1px 1px 0px #244B7A",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#366BA8 #A3CDF9 #A3CDF9 #366BA8"; // Inverted
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #244B7A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#A3CDF9 #366BA8 #366BA8 #A3CDF9"; // Reset
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #244B7A";
          }}
        >
          <img
            src="/UI/zoomin.png"
            alt="Zoom In"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
      </div>

      {/* City name label */}
      <div
        style={{
          position: "absolute",
          top: 52,
          left: 6,
          color: "var(--rct-text-light)",
          fontSize: 18,
          fontFamily: "var(--font-jersey), monospace",
          textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        {cityName}
      </div>

      {/* Top Right - Unified toolbar: TimeTracker + Build + Eraser */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 2,
          zIndex: 1000,
          display: "flex",
          gap: 0,
          alignItems: "flex-start",
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <TimeTracker
          gameTime={gameTime}
          gameSpeed={gameSpeed}
          onSpeedChange={setGameSpeed}
          dayNightEnabled={dayNightEnabled}
          onDayNightToggle={setDayNightEnabled}
        />
        <button
          onClick={() => {
            const willOpen = !isToolWindowVisible;
            setIsToolWindowVisible(willOpen);
            // Close destroy mode when opening build menu
            if (willOpen && selectedTool === ToolType.Eraser) {
              setSelectedTool(ToolType.None);
            }
            // Exit build mode when closing build menu
            if (!willOpen && selectedTool === ToolType.Building) {
              setSelectedTool(ToolType.None);
              setSelectedBuildingId(null);
            }
            if (willOpen) {
              playOpenSound();
            } else {
              playDoubleClickSound();
            }
          }}
          className={`rct-maroon-button-interactive ${
            isToolWindowVisible ? "active" : ""
          }`}
          title="Build Menu"
          style={{
            background: isToolWindowVisible ? "#4a1a1a" : "#6b2a2a",
            border: "2px solid",
            borderColor: isToolWindowVisible
              ? "#4a1a1a #ab6a6a #ab6a6a #4a1a1a" // Inverted for active
              : "#ab6a6a #4a1a1a #4a1a1a #ab6a6a", // Normal
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTopWidth: 0,
            boxShadow: isToolWindowVisible
              ? "inset 1px 1px 0px #2a0a0a"
              : "1px 1px 0px #2a0a0a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            transform: isToolWindowVisible ? "translate(1px, 1px)" : "none",
          }}
          onMouseEnter={(e) =>
            !isToolWindowVisible &&
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) =>
            !isToolWindowVisible && (e.currentTarget.style.filter = "none")
          }
          onMouseDown={(e) => {
            if (isToolWindowVisible) return;
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
          }}
          onMouseUp={(e) => {
            if (isToolWindowVisible) return;
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
          }}
        >
          <img
            src="/UI/build.png"
            alt="Build"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            // Close build menu when activating destroy mode
            if (isToolWindowVisible) {
              setIsToolWindowVisible(false);
            }
            if (selectedTool === ToolType.Eraser) {
              setSelectedTool(ToolType.None);
            } else {
              setSelectedTool(ToolType.Eraser);
            }
            playDoubleClickSound();
          }}
          className={`rct-maroon-button-interactive ${
            selectedTool === ToolType.Eraser ? "active" : ""
          }`}
          title="Eraser (Esc to deselect)"
          style={{
            background:
              selectedTool === ToolType.Eraser ? "#4a1a1a" : "#6b2a2a",
            border: "2px solid",
            borderColor:
              selectedTool === ToolType.Eraser
                ? "#4a1a1a #ab6a6a #ab6a6a #4a1a1a"
                : "#ab6a6a #4a1a1a #4a1a1a #ab6a6a",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTopWidth: 0,
            boxShadow:
              selectedTool === ToolType.Eraser
                ? "inset 1px 1px 0px #2a0a0a"
                : "1px 1px 0px #2a0a0a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            transform:
              selectedTool === ToolType.Eraser ? "translate(1px, 1px)" : "none",
          }}
          onMouseEnter={(e) =>
            selectedTool !== ToolType.Eraser &&
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) =>
            selectedTool !== ToolType.Eraser &&
            (e.currentTarget.style.filter = "none")
          }
          onMouseDown={(e) => {
            if (selectedTool === ToolType.Eraser) return;
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
          }}
          onMouseUp={(e) => {
            if (selectedTool === ToolType.Eraser) return;
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
          }}
        >
          <img
            src="/UI/bulldozer.png"
            alt="Bulldozer"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
      </div>

      {/* Bottom right - Money display and Music player */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "flex-end",
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Citizens button */}
        <button
          onClick={() => {
            setIsCitizenListVisible(true);
            playDoubleClickSound();
          }}
          title="View Citizens"
          style={{
            background: "#5a5a5a",
            border: "2px solid",
            borderColor: "#7a7a7a #3a3a3a #3a3a3a #7a7a7a",
            borderTopWidth: 0,
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            boxShadow: "1px 1px 0px #2a2a2a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
            fontSize: 24,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor = "#3a3a3a #7a7a7a #7a7a7a #3a3a3a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a2a2a";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor = "#7a7a7a #3a3a3a #3a3a3a #7a7a7a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a2a2a";
          }}
        >
          👥
        </button>
        {/* Bank button */}
        <button
          onClick={() => {
            setIsBankWindowVisible(true);
            playDoubleClickSound();
          }}
          title="Bank Loans"
          style={{
            background: "#5a5a5a",
            border: "2px solid",
            borderColor: "#7a7a7a #3a3a3a #3a3a3a #7a7a7a",
            borderTopWidth: 0,
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            boxShadow: "1px 1px 0px #2a2a2a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
            fontSize: 24,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor = "#3a3a3a #7a7a7a #7a7a7a #3a3a3a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a2a2a";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor = "#7a7a7a #3a3a3a #3a3a3a #7a7a7a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a2a2a";
          }}
        >
          🏦
        </button>
        {/* Statistics button */}
        <button
          onClick={() => {
            setIsStatisticsVisible(true);
            playDoubleClickSound();
          }}
          title="Statistics"
          style={{
            background: "#5a5a5a",
            border: "2px solid",
            borderColor: "#7a7a7a #3a3a3a #3a3a3a #7a7a7a",
            borderTopWidth: 0,
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            boxShadow: "1px 1px 0px #2a2a2a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
            fontSize: 24,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor = "#3a3a3a #7a7a7a #7a7a7a #3a3a3a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a2a2a";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor = "#7a7a7a #3a3a3a #3a3a3a #7a7a7a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a2a2a";
          }}
        >
          📊
        </button>
        {/* Achievements button */}
        <button
          onClick={() => {
            setIsAchievementsVisible(true);
            playDoubleClickSound();
          }}
          title="Achievements"
          style={{
            background: "#5a5a5a",
            border: "2px solid",
            borderColor: "#7a7a7a #3a3a3a #3a3a3a #7a7a7a",
            borderTopWidth: 0,
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            boxShadow: "1px 1px 0px #2a2a2a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
            fontSize: 24,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor = "#3a3a3a #7a7a7a #7a7a7a #3a3a3a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a2a2a";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor = "#7a7a7a #3a3a3a #3a3a3a #7a7a7a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a2a2a";
          }}
        >
          🏆
        </button>
        <MoneyDisplay money={economy.money} />
        <MusicPlayer onTrackPlay={handleTrackPlay} musicVolume={effectiveMusicVolume} />
      </div>

      {/* Bank Window */}
      <BankWindow
        isVisible={isBankWindowVisible}
        onClose={() => setIsBankWindowVisible(false)}
        banks={banks}
        activeLoans={economy.activeLoans}
        currentMoney={economy.money}
        onTakeLoan={handleTakeLoan}
        onPayLoan={handlePayLoan}
      />

      {/* Building Info Window */}
      <BuildingInfoWindow
        isVisible={isBuildingInfoVisible}
        onClose={() => setIsBuildingInfoVisible(false)}
        buildingStats={selectedBuildingStats}
        characterNames={characterNames}
        onCitizenClick={handleCitizenClick}
      />

      {/* Citizen Info Window */}
      <CitizenInfoWindow
        isVisible={isCitizenInfoVisible}
        onClose={() => setIsCitizenInfoVisible(false)}
        citizen={selectedCitizenData}
        onNameChange={handleCitizenNameChange}
        monthlyRent={getSelectedCitizenRent()}
      />

      {/* Citizen List Window */}
      <CitizenListWindow
        isVisible={isCitizenListVisible}
        onClose={() => setIsCitizenListVisible(false)}
        citizens={getCitizenList()}
        onCitizenClick={handleCitizenListClick}
      />

      {/* Statistics Window - only render when visible to avoid re-render issues */}
      {isStatisticsVisible && (
        <StatisticsWindow
          isVisible={isStatisticsVisible}
          onClose={handleStatisticsClose}
          populationHistory={populationHistory}
          happinessHistory={happinessHistory}
          buildingCounts={buildingCountsStats}
          currentPopulation={currentPopulationStats}
          currentHappiness={currentHappinessStats}
        />
      )}

      {/* Settings Window */}
      <SettingsWindow
        isVisible={isSettingsVisible}
        onClose={() => setIsSettingsVisible(false)}
        masterVolume={masterVolume}
        sfxVolume={sfxVolume}
        musicVolume={musicVolume}
        onMasterVolumeChange={onMasterVolumeChange}
        onSfxVolumeChange={onSfxVolumeChange}
        onMusicVolumeChange={onMusicVolumeChange}
      />

      {/* Achievements Window */}
      {isAchievementsVisible && (
        <AchievementsWindow
          isVisible={isAchievementsVisible}
          onClose={() => setIsAchievementsVisible(false)}
          progress={{
            housedCitizens: currentPopulationStats.housed,
            dailyRevenue: dailyRevenueRef.current,
            totalBuildingsPlaced: totalBuildingsPlacedRef.current,
            totalDemolitions: totalDemolitionsRef.current,
            homelessLeft: homelessLeftRef.current,
            carCount: phaserGameRef.current?.getCarCount?.() ?? 0,
            midnightWitnessed: midnightWitnessedRef.current,
            tracksPlayedCount: tracksPlayedRef.current.size,
          }}
        />
      )}

      {/* Achievement Toast */}
      <AchievementToast
        achievement={achievementToast}
        onDismiss={() => setAchievementToast(null)}
      />

      {/* Building Unlock Toast */}
      <UnlockToast
        unlock={unlockToast}
        onDismiss={() => {
          setUnlockToast(null);
          // Show next queued toast
          if (unlockToastQueueRef.current.length > 0) {
            setTimeout(() => setUnlockToast(unlockToastQueueRef.current.shift()!), 300);
          }
        }}
      />

      {/* Auto-save toast */}
      {showAutoSaveToast && (
        <div
          style={{
            position: "fixed",
            bottom: 60,
            left: 12,
            zIndex: 1500,
            background: "rgba(0, 0, 0, 0.7)",
            color: "#aaa",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "var(--font-pixelify), monospace",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "fadeInOut 2.5s ease-in-out",
            pointerEvents: "none",
          }}
        >
          💾 Auto-saved
        </div>
      )}

      {touristLeavingToast && (
        <div
          style={{
            position: "fixed",
            bottom: 60,
            left: 12,
            zIndex: 1500,
            background: "rgba(0, 0, 0, 0.7)",
            color: "#aaa",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "var(--font-pixelify), monospace",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "fadeInOut 3s ease-in-out",
            pointerEvents: "none",
          }}
        >
          👋 {touristLeavingToast}
        </div>
      )}

      {/* Main game area */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Map container - Phaser canvas */}
        <div
          style={{
            position: "relative",
            overflow: "auto",
            maxWidth: "100%",
            maxHeight: "100%",
            borderRadius: 0,
            width: "100%",
            height: "100%",
            filter: `
              hue-rotate(${effectiveVisuals.blueness}deg)
              contrast(${effectiveVisuals.contrast})
              saturate(${effectiveVisuals.saturation})
              brightness(${effectiveVisuals.brightness})
            `,
          }}
        >
          <PhaserGame
            ref={phaserGameRef}
            grid={grid}
            selectedTool={selectedTool}
            selectedBuildingId={selectedBuildingId}
            buildingOrientation={buildingOrientation}
            zoom={zoom}
            onTileClick={handleTileClick}
            onTilesDrag={handleTilesDrag}
            onEraserDrag={handleEraserDrag}
            onRoadDrag={handleRoadDrag}
            onZoomChange={handleZoomChange}
            showPaths={debugPaths}
            showStats={showStats}
            onBuildingInteraction={handleBuildingInteraction}
            onBuildingClick={handleBuildingClick}
            onCitizenClick={handleCitizenClick}
            onCitizenSpend={handleCitizenSpend}
          />
        </div>

        {/* Floating tool window */}
        <ToolWindow
          selectedTool={selectedTool}
          selectedBuildingId={selectedBuildingId}
          onToolSelect={setSelectedTool}
          onBuildingSelect={(id) => {
            setSelectedBuildingId(id);
            setSelectedTool(ToolType.Building);
          }}
          onSpawnCar={handleSpawnCar}
          onRotate={() => {
            if (selectedTool === ToolType.Building && selectedBuildingId) {
              const building = getBuilding(selectedBuildingId);
              if (building?.supportsRotation) {
                setBuildingOrientation((prev) => {
                  switch (prev) {
                    case Direction.Down:
                      return Direction.Right;
                    case Direction.Right:
                      return Direction.Up;
                    case Direction.Up:
                      return Direction.Left;
                    case Direction.Left:
                      return Direction.Down;
                    default:
                      return Direction.Down;
                  }
                });
              }
            }
          }}
          isVisible={isToolWindowVisible}
          onClose={() => {
            setIsToolWindowVisible(false);
            // Turn off build mode when closing build menu
            if (selectedTool === ToolType.Building) {
              setSelectedTool(ToolType.None);
              setSelectedBuildingId(null);
            }
          }}
          unlockedBuildingIds={unlockedBuildingIds}
          housedPopulation={currentPopulationStats.housed}
          dailyRevenue={dailyRevenueRef.current}
        />

        {/* Modal */}
        <Modal
          isVisible={modalState.isVisible}
          title={modalState.title}
          message={modalState.message}
          showCancel={modalState.showCancel}
          onConfirm={modalState.onConfirm ?? undefined}
          onClose={() =>
            setModalState({ ...modalState, isVisible: false, onConfirm: null })
          }
        />

        {/* Mobile Warning Banner */}
        {isMobile && !mobileWarningDismissed && (
          <div
            style={{
              position: "absolute",
              bottom: 100,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 2000,
              background: "rgba(0, 0, 0, 0.95)",
              color: "#fff",
              padding: "10px 16px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 14,
              maxWidth: "90%",
              textAlign: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <span>
              📱 Best experienced on desktop — mobile may be a bit janky!
            </span>
            <button
              onClick={() => setMobileWarningDismissed(true)}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
