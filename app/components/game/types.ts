export enum TileType {
  Grass = "grass",
  Road = "road",
  Asphalt = "asphalt",
  Tile = "tile",
  Snow = "snow",
  Building = "building",
}

// Simplified tool types - Building is now generic, actual building selected separately
export enum ToolType {
  None = "none",
  RoadNetwork = "roadNetwork",
  Asphalt = "asphalt",
  Tile = "tile",
  Snow = "snow",
  Building = "building", // Generic - actual building ID stored separately
  Eraser = "eraser",
}

export interface GridCell {
  type: TileType;
  x: number;
  y: number;
  // For multi-tile objects, marks the origin (top-left in grid coords)
  isOrigin?: boolean;
  originX?: number;
  originY?: number;
  // For buildings, specify the ID (from building registry)
  buildingId?: string;
  // For rotatable buildings, specify the orientation (defaults to Down/South)
  buildingOrientation?: Direction;
  // For props, store the underlying tile type (so props don't render their own floor)
  underlyingTileType?: TileType;
}

export enum Direction {
  Up = "up",
  Down = "down",
  Left = "left",
  Right = "right",
}

export enum LightingType {
  Day = "day",
  Night = "night",
  Sunset = "sunset",
}

export interface VisualSettings {
  blueness: number; // -100 to 100 (hue shift toward blue)
  contrast: number; // 0.5 to 2.0
  saturation: number; // 0.5 to 2.0
  brightness: number; // 0.5 to 2.0
  dayNightEnabled?: boolean; // When true, day/night cycle controls filter values
}

export enum CharacterType {
  Banana = "banana",
  Apple = "apple",
}

export interface Character {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  characterType: CharacterType;
}

export enum CarType {
  Jeep = "jeep",
  Taxi = "taxi",
}

export interface Car {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  waiting: number;
  carType: CarType;
}

// Money and economy types
export interface Bank {
  id: string;
  name: string;
  loanAmount: number;
  interestRate: number; // Monthly interest rate as decimal (e.g., 0.05 = 5%)
}

export interface ActiveLoan {
  bankId: string;
  principal: number; // Original loan amount
  remainingBalance: number; // Current balance
  interestRate: number; // Monthly interest rate
  monthsInDefault: number; // Consecutive months unable to pay
}

export interface GameEconomy {
  money: number;
  activeLoans: ActiveLoan[];
}

// Time system types
export enum GameSpeed {
  Paused = 0,
  Normal = 1,
  Fast = 2,
}

export interface GameTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dayProgress: number; // 0-1, progress through current day
}

// Building economics
export interface BuildingEconomics {
  buildCost: number;
  monthlyOperatingCost: number;
  incomePerInteraction?: number; // For businesses/churches/offices
  rentPerResident?: number; // For residential buildings
  maxResidents?: number; // For residential buildings
}

// Moodlet types
export type MoodletType = "happy" | "sad" | "hungry" | "angry" | "depressed" | null;

export interface Moodlet {
  type: MoodletType;
  emoji: string;
  reason: string;
  color: string;
}

// Happiness weights for computing city-wide happiness score (0-100%)
export const MOOD_HAPPINESS_WEIGHTS: Record<string, number> = {
  happy: 1.0,
  sad: 0.4,
  hungry: 0.3,
  angry: 0.15,
  depressed: 0.0,
  null: 0.5, // New/neutral citizens
};

// Per-citizen speed multipliers based on moodlet
export const MOOD_SPEED_MULTIPLIERS: Record<string, number> = {
  happy: 1.15,
  angry: 1.05,
  null: 1.0,
  sad: 0.90,
  hungry: 0.85,
  depressed: 0.70,
};

// Extended Character with residence and destination
export interface CharacterWithResidence extends Character {
  residenceX?: number; // Grid X of residence origin
  residenceY?: number; // Grid Y of residence origin
  currentDestination?: { x: number; y: number; buildingId?: string; buildingOriginX?: number; buildingOriginY?: number }; // Where they're heading
  interactionCooldown?: number; // Time until they can interact with a building again
  state?: "wandering" | "heading_to_building" | "at_building" | "heading_home" | "resting_at_home" | "leaving_city";
  stuckCounter?: number; // Counter to detect if stuck in place
  lastPosition?: { x: number; y: number }; // Last tile position to detect if stuck
  name?: string; // Citizen's name (editable by player)
  money?: number; // Current money the citizen has
  dailyBudget?: number; // How much money they get each day
  rentPaid?: boolean; // Whether they've paid rent this month
  lastFailedBuildingKey?: string; // Building key that was recently full (to avoid re-selecting)
  brokeUntilNextDay?: boolean; // True if citizen has run out of money and is waiting for next day
  // Needs tracking
  lastFoodTime?: number; // In-game hour when they last ate (0-23)
  ateToday?: boolean; // Whether they've eaten today
  entertainedToday?: boolean; // Whether they've visited entertainment today
  // Moodlet tracking
  moodlet?: MoodletType; // Current moodlet
  moodletReason?: string; // Reason for current moodlet
  previousMoodlet?: MoodletType; // Previous moodlet (for particle effects)
  // Tourist/grace period tracking
  isTourist?: boolean; // New citizens are tourists until they find housing or grace period expires
  touristArrivalDay?: number; // Day of month when they arrived (for 7-day grace period)
  touristArrivalMonth?: number; // Month when they arrived
  // Homeless/depression tracking
  willLeaveAtMonthEnd?: boolean; // Will leave city at end of month if still homeless
  homelessSince?: number; // Month when they became homeless (for tracking)
  // Pathfinding cache - stores the full path to destination
  cachedPath?: Direction[]; // Sequence of directions to follow
  pathIndex?: number; // Current index in the cached path
  lastPathTile?: { x: number; y: number }; // Tile where path was last calculated
}

export const GRID_WIDTH = 48;
export const GRID_HEIGHT = 48;

export const CAR_SPEED = 0.05;

// Isometric tile dimensions (44x22 isometric diamond)
export const TILE_WIDTH = 44;
export const TILE_HEIGHT = 22;

// Tile sizes for different types (in grid cells) - this is the FOOTPRINT
export const TILE_SIZES: Record<TileType, { w: number; h: number }> = {
  [TileType.Grass]: { w: 1, h: 1 },
  [TileType.Road]: { w: 1, h: 1 },
  [TileType.Asphalt]: { w: 1, h: 1 },
  [TileType.Tile]: { w: 1, h: 1 },
  [TileType.Snow]: { w: 1, h: 1 },
  [TileType.Building]: { w: 4, h: 4 }, // Default, actual size from building registry
};

// Character movement constants
export const CHARACTER_PIXELS_PER_FRAME_X = 13 / 58;
export const CHARACTER_PIXELS_PER_FRAME_Y = 5 / 58;
export const CHARACTER_SPEED = 0.015;

// Convert grid coordinates to isometric screen coordinates
export function gridToIso(
  gridX: number,
  gridY: number
): { x: number; y: number } {
  return {
    x: (gridX - gridY) * (TILE_WIDTH / 2),
    y: (gridX + gridY) * (TILE_HEIGHT / 2),
  };
}

// Convert isometric screen coordinates back to grid coordinates
export function isoToGrid(
  isoX: number,
  isoY: number
): { x: number; y: number } {
  return {
    x: (isoX / (TILE_WIDTH / 2) + isoY / (TILE_HEIGHT / 2)) / 2,
    y: (isoY / (TILE_HEIGHT / 2) - isoX / (TILE_WIDTH / 2)) / 2,
  };
}

// Save/Load data structure
export interface GameSaveData {
  grid: GridCell[][];
  characterCount: number;
  carCount: number;
  zoom?: number;
  visualSettings?: VisualSettings;
  dayNightEnabled?: boolean;
  timestamp: number;
  economy?: GameEconomy;
  gameTime?: GameTime;
  gameSpeed?: GameSpeed;
  cityName?: string; // Optional for backward compat with old saves
  unlockedBuildingIds?: string[]; // Per-save building progression unlocks
}
