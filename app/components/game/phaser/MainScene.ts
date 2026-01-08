import Phaser from "phaser";
import {
  GridCell,
  Character,
  Car,
  TileType,
  Direction,
  CharacterType,
  CarType,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  ToolType,
  CHARACTER_SPEED,
  CAR_SPEED,
  GameSpeed,
  CharacterWithResidence,
} from "../types";
import { GRID_OFFSET_X, GRID_OFFSET_Y } from "./gameConfig";
import {
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  hasRoadSegment,
  getRoadConnections,
  getSegmentType,
  generateRoadPattern,
  canPlaceRoadSegment,
  getLaneDirection,
  isAtIntersection,
  canTurnAtTile,
  getUTurnDirection,
} from "../roadUtils";
import {
  BUILDINGS,
  getBuilding,
  getBuildingFootprint,
  getBuildingEconomics,
  BuildingDefinition,
} from "@/app/data/buildings";
import { loadGifAsAnimation, playGifAnimation } from "./GifLoader";

// Event types for React communication
export interface SceneEvents {
  onTileClick: (x: number, y: number) => void;
  onTileHover: (x: number | null, y: number | null) => void;
  onTilesDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onEraserDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onRoadDrag?: (segments: Array<{ x: number; y: number }>) => void;
  onBuildingInteraction?: (buildingId: string, buildingOriginX: number, buildingOriginY: number, interactionType: "income" | "move_in", characterId?: string) => void;
  onBuildingClick?: (buildingId: string, originX: number, originY: number) => void;
  onCitizenClick?: (citizenId: string) => void;
  onCitizenSpend?: (citizenId: string, amount: number) => void;
}

// Random name generator
const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery",
  "Parker", "Skyler", "Jamie", "Drew", "Sam", "Charlie", "Frankie", "Jesse",
  "Pat", "Robin", "Terry", "Chris", "Kim", "Lee", "Dana", "Kelly",
  "Bob", "Alice", "Dave", "Emma", "Frank", "Grace", "Henry", "Iris",
  "Jack", "Kate", "Leo", "Maya", "Nick", "Olive", "Pete", "Rose"
];

const LAST_NAMES = [
  "Smith", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
  "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Garcia", "Lee",
  "Walker", "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green",
  "Baker", "Hill", "Nelson", "Carter", "Mitchell", "Roberts", "Turner", "Phillips"
];

const generateRandomName = (): string => {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${firstName} ${lastName}`;
};

// Daily budget range for citizens
const MIN_DAILY_BUDGET = 50;
const MAX_DAILY_BUDGET = 150;

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Direction vectors for movement
const directionVectors: Record<Direction, { dx: number; dy: number }> = {
  [Direction.Up]: { dx: 0, dy: -1 },
  [Direction.Down]: { dx: 0, dy: 1 },
  [Direction.Left]: { dx: -1, dy: 0 },
  [Direction.Right]: { dx: 1, dy: 0 },
};

// Opposite directions
const oppositeDirection: Record<Direction, Direction> = {
  [Direction.Up]: Direction.Down,
  [Direction.Down]: Direction.Up,
  [Direction.Left]: Direction.Right,
  [Direction.Right]: Direction.Left,
};

// All directions as array
const allDirections = [
  Direction.Up,
  Direction.Down,
  Direction.Left,
  Direction.Right,
];

// Deterministic snow variant based on grid position
function getSnowTextureKey(x: number, y: number): string {
  // Simple hash to pick variant 1-3 based on position
  const variant = ((x * 7 + y * 13) % 3) + 1;
  return `snow_${variant}`;
}

export class MainScene extends Phaser.Scene {
  // Depth scaling for stable painter's algorithm ordering
  private readonly DEPTH_Y_MULT = 10000;

  // Sprite containers
  private tileSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private buildingSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private glowSprites: Map<string, Phaser.GameObjects.GameObject> = new Map();
  private carSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private characterSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private previewSprites: Phaser.GameObjects.Image[] = [];
  private lotPreviewSprites: Phaser.GameObjects.Image[] = [];

  // Game state (owned by Phaser, not React)
  private grid: GridCell[][] = [];
  private characters: CharacterWithResidence[] = [];
  private cars: Car[] = [];
  
  // Building occupancy tracking: building origin -> array of citizen IDs
  private buildingOccupancy: Map<string, string[]> = new Map();

  // Tool state (synced from React)
  private selectedTool: ToolType = ToolType.RoadNetwork;
  private selectedBuildingId: string | null = null;
  private buildingOrientation: Direction = Direction.Down;
  private hoverTile: { x: number; y: number } | null = null;

  // Event callbacks
  private events_: SceneEvents = {
    onTileClick: () => {},
    onTileHover: () => {},
    onBuildingInteraction: () => {},
  };

  // Zoom level
  private zoomLevel: number = 1;
  // Flag to skip React's setZoom after internal wheel zoom
  private zoomHandledInternally: boolean = false;

  // Scene ready flag
  private isReady: boolean = false;

  // GIF animations loaded flag
  private gifsLoaded: boolean = false;

  // Debug: show walkable paths
  private showPaths: boolean = false;
  private pathOverlaySprites: Phaser.GameObjects.Graphics | null = null;

  // Driving mode state
  private isPlayerDriving: boolean = false;
  private playerCar: Car | null = null;
  private pressedKeys: Set<string> = new Set();

  // Keyboard controls
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private readonly CAMERA_SPEED = 8;

  // Dirty flags for efficient updates
  private gridDirty: boolean = false;
  private gridDirtyTiles: Set<string> = new Set();

  // Stats display
  private statsText: Phaser.GameObjects.Text | null = null;
  private showStats: boolean = true;

  // Drag state for painting tiles (snow/tile tools)
  private isDragging: boolean = false;
  private dragTiles: Set<string> = new Set();
  private dragStartTile: { x: number; y: number } | null = null;
  private dragDirection: "horizontal" | "vertical" | null = null;

  // Camera panning state (for click/touch drag panning)
  private isPanning: boolean = false;
  private panStartX: number = 0;
  private panStartY: number = 0;
  private cameraStartX: number = 0;
  private cameraStartY: number = 0;

  // Screen shake state (for building placement impact)
  // IMPORTANT: keep "base" camera scroll separate from transient shake offset.
  // Otherwise panning / keyboard input can accidentally bake the shake into the base scroll.
  private baseScrollX: number = 0;
  private baseScrollY: number = 0;
  private wasDriving: boolean = false;

  private shakeAxis: "x" | "y" = "y";
  private shakeOffset: number = 0;
  private shakeDuration: number = 0;
  private shakeIntensity: number = 0;
  private shakeElapsed: number = 0;
  // Number of oscillations during the shake (must be an integer so it ends at exactly 0)
  private shakeCycles: number = 3;

  // Game speed multiplier
  private gameSpeed: GameSpeed = GameSpeed.Normal;

  constructor() {
    super({ key: "MainScene" });
  }

  preload(): void {
    // Load tile textures
    this.load.image("grass", "/Tiles/1x1grass.png");
    this.load.image("road", "/Tiles/1x1square_tile.png");
    this.load.image("asphalt", "/Tiles/1x1asphalt_tile.png");
    this.load.image("snow_1", "/Tiles/1x1snow_tile_1.png");
    this.load.image("snow_2", "/Tiles/1x1snow_tile_2.png");
    this.load.image("snow_3", "/Tiles/1x1snow_tile_3.png");

    // Load building textures dynamically from registry
    for (const building of Object.values(BUILDINGS)) {
      for (const [dir, path] of Object.entries(building.sprites)) {
        const key = `${building.id}_${dir}`;
        this.load.image(key, path);
      }
    }

    // Load car textures
    const carTypes = ["jeep", "taxi"];
    const directions = ["n", "s", "e", "w"];
    for (const car of carTypes) {
      for (const dir of directions) {
        this.load.image(`${car}_${dir}`, `/cars/${car}${dir}.png`);
      }
    }
  }

  create(): void {
    // Set up keyboard controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };

      // Set up driving controls
      this.input.keyboard.on("keydown", (event: KeyboardEvent) => {
        if (this.isPlayerDriving) {
          const key = event.key.toLowerCase();
          if (
            [
              "arrowup",
              "arrowdown",
              "arrowleft",
              "arrowright",
              "w",
              "a",
              "s",
              "d",
            ].includes(key)
          ) {
            this.pressedKeys.add(key);
          }
        }
      });

      this.input.keyboard.on("keyup", (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        this.pressedKeys.delete(key);
      });
    }

    // Initialize empty grid
    this.initializeGrid();

    // Mark scene as ready
    this.isReady = true;

    // Enable input
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointerup", this.handlePointerUp, this);

    // Mouse wheel zoom - handled directly in Phaser for correct coordinates
    // Based on: https://phaser.io/examples/v3.85.0/tilemap/view/mouse-wheel-zoom
    this.input.on("wheel", this.handleWheel, this);

    // Initial render
    this.renderGrid();

    // Load character GIF animations asynchronously
    this.loadCharacterAnimations();

    // Create stats display (fixed to camera, top-right corner)
    this.statsText = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#00ff00",
      backgroundColor: "rgba(0,0,0,0.7)",
      padding: { x: 8, y: 6 },
    });
    this.statsText.setScrollFactor(0); // Fixed to camera
    this.statsText.setDepth(2_000_000); // Always on top
    this.statsText.setOrigin(1, 0); // Anchor to top-right
    // Position will be updated in updateStatsDisplay based on camera size
  }

  private initializeGrid(): void {
    this.grid = Array.from({ length: GRID_HEIGHT }, (_, y) =>
      Array.from({ length: GRID_WIDTH }, (_, x) => ({
        type: TileType.Grass,
        x,
        y,
        isOrigin: true,
      }))
    );
  }

  private async loadCharacterAnimations(): Promise<void> {
    const charTypes = ["banana", "apple"];
    const charDirs = ["north", "south", "east", "west"];

    const loadPromises: Promise<void>[] = [];

    for (const char of charTypes) {
      for (const dir of charDirs) {
        const key = `${char}_${dir}`;
        const url = `/Characters/${char}walk${dir}.gif`;
        loadPromises.push(loadGifAsAnimation(this, key, url));
      }
    }

    try {
      await Promise.all(loadPromises);
      this.gifsLoaded = true;
      console.log("Character GIF animations loaded successfully");

      // Re-render characters to apply animations
      if (this.characters.length > 0) {
        this.renderCharacters();
      }
    } catch (error) {
      console.error("Failed to load character animations:", error);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.isReady) return;

    // Update game entities
    this.updateCharacters();
    this.updateCars();
    this.updatePlayerCar();

    // Handle camera movement (when not driving)
    this.updateCamera(delta);

    // Render updated entities
    this.renderCars();
    this.renderCharacters();

    // Handle dirty grid updates
    if (this.gridDirty) {
      this.applyGridUpdates();
      this.gridDirty = false;
    }

    // Update stats display
    this.updateStatsDisplay();
  }

  private updateStatsDisplay(): void {
    if (!this.statsText || !this.showStats) {
      if (this.statsText) this.statsText.setVisible(false);
      return;
    }

    this.statsText.setVisible(true);

    // Position in top-right, accounting for zoom
    const camera = this.cameras.main;
    this.statsText.setPosition(camera.width - 10, 60);

    const fps = Math.round(this.game.loop.actualFps);
    const charCount = this.characters.length;
    const carCount = this.cars.length + (this.playerCar ? 1 : 0);

    // Color FPS based on performance
    let fpsColor = "#00ff00"; // Green = good
    if (fps < 50) fpsColor = "#ffff00"; // Yellow = warning
    if (fps < 30) fpsColor = "#ff0000"; // Red = bad

    this.statsText.setText(
      [
        `FPS: ${fps}`,
        `Characters: ${charCount}`,
        `Cars: ${carCount}`,
        `Phaser-managed ✓`,
      ].join("\n")
    );
    this.statsText.setColor(fpsColor);
  }

  private updateCamera(delta: number): void {
    if (!this.cursors) return;

    const camera = this.cameras.main;

    // Update screen shake (pure offset; MUST end at exactly 0)
    if (this.shakeElapsed < this.shakeDuration) {
      this.shakeElapsed += delta;
      const t = Math.min(this.shakeElapsed / this.shakeDuration, 1); // 0 -> 1
      // Snappy + SC4-ish: slightly stronger first hit, then damps faster.
      // (1 - t)^2 is fast ease-out; the extra *(1 + boost*(1 - t)) biases early frames a bit higher.
      const baseEnvelope = (1 - t) * (1 - t);
      const boost = 0.1; // "slightly more" on the first hit
      const envelope = baseEnvelope * (1 + boost * (1 - t));
      // Oscillate and guarantee we end at exactly 0 at t=1 (sin(2πn)=0)
      // Start with a small "down" impact (positive scrollY), then a smaller up rebound.
      // Phase ease: advance faster early so the first downward hit is snappier
      const phaseT = Math.sqrt(t);
      const wave =
        Math.sin(phaseT * this.shakeCycles * Math.PI * 2) *
        this.shakeIntensity *
        envelope;
      this.shakeOffset = wave < 0 ? wave * 0.45 : wave;
    } else {
      this.shakeOffset = 0;
    }

    // If in driving mode, follow the player car (sets base scroll absolutely every frame)
    if (this.isPlayerDriving && this.playerCar) {
      this.wasDriving = true;
      const screenPos = this.gridToScreen(this.playerCar.x, this.playerCar.y);
      const groundY = screenPos.y + TILE_HEIGHT / 2;
      const viewportWidth = camera.width / camera.zoom;
      const viewportHeight = camera.height / camera.zoom;
      this.baseScrollX = screenPos.x - viewportWidth / 2;
      this.baseScrollY = groundY - viewportHeight / 2;
      camera.setScroll(
        Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
        Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
      );
      return;
    }

    // Transition: if we just stopped driving, freeze current camera position as the new base.
    if (this.wasDriving) {
      this.wasDriving = false;
      this.baseScrollX = camera.scrollX;
      this.baseScrollY = camera.scrollY - this.shakeOffset;
    }

    // Manual camera movement when not driving
    // Don't move camera if user is typing in an input field
    const activeElement = document.activeElement;
    const isTyping =
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        (activeElement as HTMLElement)?.isContentEditable);

    if (!isTyping) {
      const speed = this.CAMERA_SPEED / camera.zoom;
      if (this.cursors.left.isDown || this.wasd?.A.isDown) {
        this.baseScrollX -= speed;
      }
      if (this.cursors.right.isDown || this.wasd?.D.isDown) {
        this.baseScrollX += speed;
      }
      if (this.cursors.up.isDown || this.wasd?.W.isDown) {
        this.baseScrollY -= speed;
      }
      if (this.cursors.down.isDown || this.wasd?.S.isDown) {
        this.baseScrollY += speed;
      }
    }

    camera.setScroll(
      Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
      Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
    );
  }

  // Trigger screen shake effect (like SimCity 4 building placement)
  shakeScreen(
    axis: "x" | "y" = "y",
    intensity: number = 2,
    duration: number = 150
  ): void {
    this.shakeAxis = axis;
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeElapsed = 0;
  }

  // ============================================
  // CHARACTER LOGIC (moved from React)
  // ============================================

  private updateCharacters(): void {
    for (let i = 0; i < this.characters.length; i++) {
      this.characters[i] = this.updateSingleCharacter(this.characters[i]);
    }
  }

  private isWalkable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    const tileType = this.grid[gy][gx].type;
    // Citizens can walk on sidewalks (Road/Tile) and also on roads (Asphalt) to cross
    return tileType === TileType.Road || tileType === TileType.Tile || tileType === TileType.Asphalt;
  }

  // Check if a tile is a preferred walking surface (sidewalk, not street)
  private isSidewalk(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    const tileType = this.grid[gy][gx].type;
    // Sidewalks are Road (which has sidewalk edges) and Tile
    return tileType === TileType.Road || tileType === TileType.Tile;
  }

  // Get the walking cost for a tile (lower = preferred)
  private getWalkCost(x: number, y: number): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return Infinity;
    const tileType = this.grid[gy][gx].type;
    
    // Sidewalks (Road edges, Tile) are preferred - cost 1
    if (tileType === TileType.Road || tileType === TileType.Tile) return 1;
    // Asphalt (street) is walkable but costly - cost 5 (cross only when needed)
    if (tileType === TileType.Asphalt) return 5;
    // Everything else is not walkable
    return Infinity;
  }

  private getValidDirections(tileX: number, tileY: number, preferSidewalks: boolean = true): Direction[] {
    const sidewalkDirs: Direction[] = [];
    const asphaltDirs: Direction[] = [];
    
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = tileX + vec.dx;
      const nextY = tileY + vec.dy;
      
      if (this.isSidewalk(nextX, nextY)) {
        sidewalkDirs.push(dir);
      } else if (this.isWalkable(nextX, nextY)) {
        asphaltDirs.push(dir);
      }
    }
    
    // Return sidewalks first if preferred, then asphalt as fallback
    if (preferSidewalks) {
      return [...sidewalkDirs, ...asphaltDirs];
    }
    return [...sidewalkDirs, ...asphaltDirs];
  }

  private pickNewDirection(
    tileX: number,
    tileY: number,
    currentDir: Direction
  ): Direction | null {
    // Get valid directions (sidewalks first)
    const validDirs = this.getValidDirections(tileX, tileY, true);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const preferredDirs = validDirs.filter((d) => d !== opposite);

    // Separate sidewalk and asphalt options
    const sidewalkChoices = preferredDirs.filter(d => {
      const vec = directionVectors[d];
      return this.isSidewalk(tileX + vec.dx, tileY + vec.dy);
    });

    // 60% chance to continue straight if possible AND it's a sidewalk
    const currentIsSidewalk = this.isSidewalk(tileX + directionVectors[currentDir].dx, tileY + directionVectors[currentDir].dy);
    if (preferredDirs.includes(currentDir) && currentIsSidewalk && Math.random() < 0.6) {
      return currentDir;
    }

    // Prefer sidewalk choices (90% of time), only use asphalt if no sidewalks or 10% chance
    if (sidewalkChoices.length > 0 && Math.random() < 0.9) {
      return sidewalkChoices[Math.floor(Math.random() * sidewalkChoices.length)];
    }

    const choices = preferredDirs.length > 0 ? preferredDirs : validDirs;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  // Find nearby buildings that citizens can interact with
  private findNearbyBuildings(
    charX: number,
    charY: number,
    maxDistance: number = 10
  ): Array<{ buildingId: string; originX: number; originY: number; distance: number }> {
    const buildings: Array<{ buildingId: string; originX: number; originY: number; distance: number }> = [];
    const charTileX = Math.floor(charX);
    const charTileY = Math.floor(charY);

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y][x];
        if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
          const distance = Math.abs(x - charTileX) + Math.abs(y - charTileY);
          if (distance <= maxDistance && distance > 0) {
            buildings.push({
              buildingId: cell.buildingId,
              originX: x,
              originY: y,
              distance,
            });
          }
        }
      }
    }

    return buildings.sort((a, b) => a.distance - b.distance);
  }

  // Get all walkable tiles adjacent to a building (within 1 tile of building perimeter)
  // Returns SIDEWALK tiles first, then asphalt tiles (so citizens can reach them more easily)
  private getBuildingAdjacentTiles(
    buildingOriginX: number,
    buildingOriginY: number,
    buildingId: string
  ): Array<{ x: number; y: number }> {
    const building = getBuilding(buildingId);
    if (!building) return [];

    const footprint = getBuildingFootprint(building);
    const sidewalkTiles: Array<{ x: number; y: number }> = [];
    const asphaltTiles: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();

    // Check all tiles within 1 tile of the building perimeter
    for (let dy = -1; dy <= footprint.height; dy++) {
      for (let dx = -1; dx <= footprint.width; dx++) {
        const checkX = buildingOriginX + dx;
        const checkY = buildingOriginY + dy;
        const key = `${checkX},${checkY}`;

        // Skip if already seen
        if (seen.has(key)) continue;
        seen.add(key);

        // Skip tiles inside the building footprint
        if (dx >= 0 && dx < footprint.width && dy >= 0 && dy < footprint.height) continue;

        // Check if walkable
        if (
          checkX >= 0 &&
          checkX < GRID_WIDTH &&
          checkY >= 0 &&
          checkY < GRID_HEIGHT
        ) {
          if (this.isSidewalk(checkX, checkY)) {
            sidewalkTiles.push({ x: checkX, y: checkY });
          } else if (this.isWalkable(checkX, checkY)) {
            asphaltTiles.push({ x: checkX, y: checkY });
          }
        }
      }
    }

    // Return sidewalk tiles first, then asphalt as fallback
    return [...sidewalkTiles, ...asphaltTiles];
  }

  // Get a walkable tile adjacent to a building that the citizen can reach
  // Finds the closest reachable tile from citizen's current position
  private getBuildingAccessTile(
    buildingOriginX: number,
    buildingOriginY: number,
    buildingId: string,
    fromX?: number,
    fromY?: number
  ): { x: number; y: number } | null {
    const adjacentTiles = this.getBuildingAdjacentTiles(buildingOriginX, buildingOriginY, buildingId);
    if (adjacentTiles.length === 0) return null;

    // If no starting position provided, just return the first adjacent tile
    if (fromX === undefined || fromY === undefined) {
      return adjacentTiles[0];
    }

    // Sort by distance from citizen and prefer sidewalks over asphalt
    adjacentTiles.sort((a, b) => {
      const distA = Math.abs(a.x - fromX) + Math.abs(a.y - fromY);
      const distB = Math.abs(b.x - fromX) + Math.abs(b.y - fromY);
      const costA = this.isSidewalk(a.x, a.y) ? 0 : 1;
      const costB = this.isSidewalk(b.x, b.y) ? 0 : 1;
      // Prefer sidewalks, then by distance
      if (costA !== costB) return costA - costB;
      return distA - distB;
    });

    // Return first reachable tile (checking reachability is done by caller if needed)
    return adjacentTiles[0];
  }

  // Check if a path exists to target (without returning the path)
  private canReachTarget(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number = 150
  ): boolean {
    if (startX === targetX && startY === targetY) return true;

    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY)) continue;

        visited.add(key);

        if (nextX === targetX && nextY === targetY) {
          return true;
        }

        queue.push({ x: nextX, y: nextY });
      }
    }

    return false;
  }

  // Check if we can reach ANY of the given target tiles
  private canReachAnyTarget(
    startX: number,
    startY: number,
    targets: Array<{ x: number; y: number }>,
    maxSteps: number = 150
  ): { x: number; y: number } | null {
    if (targets.length === 0) {
      console.log(`[canReachAnyTarget] No targets provided`);
      return null;
    }

    const targetSet = new Set(targets.map(t => `${t.x},${t.y}`));
    
    // Check if already at a target
    if (targetSet.has(`${startX},${startY}`)) {
      return { x: startX, y: startY };
    }

    // Check if start position is walkable
    if (!this.isWalkable(startX, startY)) {
      console.log(`[canReachAnyTarget] Start (${startX},${startY}) is NOT walkable!`);
      return null;
    }

    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY)) continue;

        visited.add(key);

        if (targetSet.has(key)) {
          console.log(`[canReachAnyTarget] Found path from (${startX},${startY}) to (${nextX},${nextY}) in ${iterations} iterations`);
          return { x: nextX, y: nextY };
        }

        queue.push({ x: nextX, y: nextY });
      }
    }

    console.log(`[canReachAnyTarget] No path from (${startX},${startY}) to any of ${targets.length} targets after ${iterations} iterations`);
    return null;
  }

  // Weighted pathfinding - prefers sidewalks but allows asphalt crossing
  // Uses A*-like approach with costs: sidewalk=1, asphalt=5
  private findPathToTarget(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number = 200
  ): Direction | null {
    if (startX === targetX && startY === targetY) return null;

    // Use weighted pathfinding that prefers sidewalks but allows asphalt
    return this.findPathWeighted(startX, startY, targetX, targetY, maxSteps);
  }

  // Weighted pathfinding: sidewalks cost 1, asphalt costs 5 (prefers sidewalks but allows crossing)
  private findPathWeighted(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number
  ): Direction | null {
    // Priority queue: [priority, x, y, firstDir, cost]
    const queue: Array<[number, number, number, Direction | null, number]> = [];
    const visited = new Set<string>();
    const firstDirMap = new Map<string, Direction>(); // Track first direction to reach each tile
    
    // Heuristic: Manhattan distance
    const heuristic = (x: number, y: number) => Math.abs(x - targetX) + Math.abs(y - targetY);
    
    // Start position
    const startKey = `${startX},${startY}`;
    visited.add(startKey);
    queue.push([heuristic(startX, startY), startX, startY, null, 0]);
    
    while (queue.length > 0 && visited.size < maxSteps) {
      // Sort by priority (simple priority queue)
      queue.sort((a, b) => a[0] - b[0]);
      const [priority, currentX, currentY, currentFirstDir, currentCost] = queue.shift()!;
      const currentKey = `${currentX},${currentY}`;
      
      // Check if we reached the target
      if (currentX === targetX && currentY === targetY) {
        // Return the first direction we took to get here
        return currentFirstDir || this.moveTowardsTargetGreedy(startX, startY, targetX, targetY);
      }
      
      // Explore neighbors
      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = currentX + vec.dx;
        const nextY = currentY + vec.dy;
        const nextKey = `${nextX},${nextY}`;
        
        if (visited.has(nextKey)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY)) continue;
        
        // Calculate cost: sidewalks = 1, asphalt = 5
        const isSidewalk = this.isSidewalk(nextX, nextY);
        const stepCost = isSidewalk ? 1 : 5;
        const newCost = currentCost + stepCost;
        const newPriority = newCost + heuristic(nextX, nextY);
        
        // Determine first direction: if we're at start, this is the first dir; otherwise use stored first dir
        const firstDirection = currentX === startX && currentY === startY ? dir : (currentFirstDir || dir);
        
        visited.add(nextKey);
        firstDirMap.set(nextKey, firstDirection);
        queue.push([newPriority, nextX, nextY, firstDirection, newCost]);
      }
    }
    
    // No path found - fall back to greedy
    return this.moveTowardsTargetGreedy(startX, startY, targetX, targetY);
  }

  // Simple BFS pathfinding
  private findPathBFS(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number,
    sidewalksOnly: boolean
  ): Direction | null {
    if (this.debugPathfinding && this.debugLogCounter % 60 === 0) {
      // Debug: show adjacent tile walkability from start
      const adjInfo = allDirections.map(d => {
        const v = directionVectors[d];
        const nx = startX + v.dx;
        const ny = startY + v.dy;
        const canWalk = sidewalksOnly ? this.isSidewalk(nx, ny) : this.isWalkable(nx, ny);
        return `${d}(${nx},${ny})=${canWalk}`;
      }).join(', ');
      console.log(`[BFS] From (${startX},${startY}) to (${targetX},${targetY}), sidewalksOnly: ${sidewalksOnly}. Adjacent: ${adjInfo}`);
    }
    
    const queue: Array<{ x: number; y: number; firstDir: Direction }> = [];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    // Add initial neighbors
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = startX + vec.dx;
      const nextY = startY + vec.dy;

      if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
      
      const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
      if (!canWalk) continue;

      const key = `${nextX},${nextY}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (nextX === targetX && nextY === targetY) {
        return dir;
      }

      queue.push({ x: nextX, y: nextY, firstDir: dir });
    }

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        
        const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
        if (!canWalk) continue;

        visited.add(key);

        if (nextX === targetX && nextY === targetY) {
          return current.firstDir;
        }

        queue.push({ x: nextX, y: nextY, firstDir: current.firstDir });
      }
    }

    return null;
  }

  // Find path to any of the target tiles (for building access) - uses simple BFS
  private findPathToAnyTarget(
    startX: number,
    startY: number,
    targets: Array<{ x: number; y: number }>,
    maxSteps: number = 150
  ): { direction: Direction; target: { x: number; y: number } } | null {
    if (targets.length === 0) return null;

    const targetSet = new Set(targets.map(t => `${t.x},${t.y}`));
    
    // Check if already at a target
    if (targetSet.has(`${startX},${startY}`)) {
      return null; // Already there
    }

    // First try sidewalks only
    const sidewalkResult = this.findPathToAnyTargetBFS(startX, startY, targetSet, maxSteps, true);
    if (sidewalkResult) return sidewalkResult;

    // Then allow asphalt
    return this.findPathToAnyTargetBFS(startX, startY, targetSet, maxSteps, false);
  }

  private findPathToAnyTargetBFS(
    startX: number,
    startY: number,
    targetSet: Set<string>,
    maxSteps: number,
    sidewalksOnly: boolean
  ): { direction: Direction; target: { x: number; y: number } } | null {
    const queue: Array<{ x: number; y: number; firstDir: Direction }> = [];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    // Add initial neighbors
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = startX + vec.dx;
      const nextY = startY + vec.dy;
      const key = `${nextX},${nextY}`;

      if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
      
      const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
      if (!canWalk) continue;

      if (visited.has(key)) continue;
      visited.add(key);

      if (targetSet.has(key)) {
        return { direction: dir, target: { x: nextX, y: nextY } };
      }

      queue.push({ x: nextX, y: nextY, firstDir: dir });
    }

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        
        const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
        if (!canWalk) continue;

        visited.add(key);

        if (targetSet.has(key)) {
          return { direction: current.firstDir, target: { x: nextX, y: nextY } };
        }

        queue.push({ x: nextX, y: nextY, firstDir: current.firstDir });
      }
    }

    return null;
  }

  // Greedy fallback when pathfinding fails - prefers sidewalks
  private moveTowardsTargetGreedy(
    charTileX: number,
    charTileY: number,
    targetX: number,
    targetY: number
  ): Direction | null {
    const dx = targetX - charTileX;
    const dy = targetY - charTileY;

    // If already at target, return null (no movement needed)
    if (dx === 0 && dy === 0) return null;

    // Get valid directions, already sorted with sidewalks first
    const validDirs = this.getValidDirections(charTileX, charTileY, true);
    if (validDirs.length === 0) return null;

    // Try primary direction (toward target on the longer axis)
    let primaryDir: Direction | null = null;
    let secondaryDir: Direction | null = null;

    if (Math.abs(dx) >= Math.abs(dy)) {
      primaryDir = dx > 0 ? Direction.Right : Direction.Left;
      secondaryDir = dy > 0 ? Direction.Down : dy < 0 ? Direction.Up : null;
    } else {
      primaryDir = dy > 0 ? Direction.Down : Direction.Up;
      secondaryDir = dx > 0 ? Direction.Right : dx < 0 ? Direction.Left : null;
    }

    // Check if primary/secondary directions are sidewalks (prefer sidewalks)
    const primaryIsSidewalk = primaryDir && this.isSidewalk(charTileX + directionVectors[primaryDir].dx, charTileY + directionVectors[primaryDir].dy);
    const secondaryIsSidewalk = secondaryDir && this.isSidewalk(charTileX + directionVectors[secondaryDir].dx, charTileY + directionVectors[secondaryDir].dy);

    // Try primary direction first (if it's a sidewalk or only option)
    if (primaryDir && validDirs.includes(primaryDir)) {
      if (primaryIsSidewalk) {
        return primaryDir;
      }
      // If primary is asphalt, check if secondary is a sidewalk and roughly same direction
      if (secondaryDir && secondaryIsSidewalk && validDirs.includes(secondaryDir)) {
        return secondaryDir;
      }
      // Fall back to primary even if asphalt
      return primaryDir;
    }

    // Try secondary direction
    if (secondaryDir && validDirs.includes(secondaryDir)) {
      return secondaryDir;
    }

    // Try directions that get us closer, preferring sidewalks
    const currentDistance = Math.abs(dx) + Math.abs(dy);

    // First pass: only consider sidewalk directions that get closer
    for (const dir of validDirs) {
      const vec = directionVectors[dir];
      const nextX = charTileX + vec.dx;
      const nextY = charTileY + vec.dy;

      if (!this.isSidewalk(nextX, nextY)) continue;

      const newDistance = Math.abs(targetX - nextX) + Math.abs(targetY - nextY);
      if (newDistance < currentDistance) {
        return dir;
      }
    }
    
    // Second pass: consider asphalt directions that get closer (cross road if needed)
    for (const dir of validDirs) {
      const vec = directionVectors[dir];
      const nextX = charTileX + vec.dx;
      const nextY = charTileY + vec.dy;

      const newDistance = Math.abs(targetX - nextX) + Math.abs(targetY - nextY);
      if (newDistance < currentDistance) {
        return dir;
      }
    }

    // No direction gets closer - pick first valid (sidewalks are already first in validDirs)
    if (validDirs.length > 0) {
      return validDirs[0];
    }

    return null;
  }

  // Simple pathfinding: move towards target using BFS (returns just the direction)
  private moveTowardsTarget(
    char: CharacterWithResidence,
    targetX: number,
    targetY: number
  ): Direction | null {
    const charTileX = Math.floor(char.x);
    const charTileY = Math.floor(char.y);

    // Use BFS pathfinding to find first step toward target
    return this.findPathToTarget(charTileX, charTileY, targetX, targetY);
  }

  // Check if character is at a building and can interact
  // Returns the updated character with new residence/cooldown if interaction occurred
  private checkBuildingInteraction(char: CharacterWithResidence): CharacterWithResidence {
    const charTileX = Math.floor(char.x);
    const charTileY = Math.floor(char.y);

    // Check interaction cooldown first - if on cooldown, skip all checks
    if (char.interactionCooldown && char.interactionCooldown > 0) {
      return char;
    }

    // Check for nearby buildings within a larger radius (Manhattan distance <= 3)
    // This allows interaction from across the street
    const MAX_INTERACTION_DISTANCE = 3;
    
    // Track which buildings we've already checked (by origin key) to avoid duplicates
    const checkedBuildings = new Set<string>();
    
    for (let dy = -MAX_INTERACTION_DISTANCE; dy <= MAX_INTERACTION_DISTANCE; dy++) {
      for (let dx = -MAX_INTERACTION_DISTANCE; dx <= MAX_INTERACTION_DISTANCE; dx++) {
        // Only consider tiles within Manhattan distance
        if (Math.abs(dx) + Math.abs(dy) > MAX_INTERACTION_DISTANCE) continue;

        const checkX = charTileX + dx;
        const checkY = charTileY + dy;

        if (
          checkX < 0 ||
          checkX >= GRID_WIDTH ||
          checkY < 0 ||
          checkY >= GRID_HEIGHT
        ) {
          continue;
        }

        const cell = this.grid[checkY][checkX];
        if (cell.type !== TileType.Building) continue;
        
        // Get building ID and origin - try cell first, then origin cell
        let buildingId = cell.buildingId;
        let originX = cell.originX;
        let originY = cell.originY;
        
        // If this cell doesn't have buildingId but has origin coordinates, get from origin
        if (!buildingId && originX !== undefined && originY !== undefined) {
          const originCell = this.grid[originY]?.[originX];
          if (originCell) {
            buildingId = originCell.buildingId;
          }
        }
        
        // Also try to get buildingId from the origin if we have one
        if (!buildingId && originX !== undefined && originY !== undefined) {
          const originCell = this.grid[originY]?.[originX];
          buildingId = originCell?.buildingId;
        }
        
        if (!buildingId) continue;
        
        // Use origin coordinates, falling back to check coordinates
        if (originX === undefined) originX = checkX;
        if (originY === undefined) originY = checkY;
        
        const buildingKey = `${originX},${originY}`;
        
        // Skip if we've already checked this building
        if (checkedBuildings.has(buildingKey)) continue;
        checkedBuildings.add(buildingKey);
        
        const building = getBuilding(buildingId);
        if (!building) continue;

        const economics = getBuildingEconomics(building);

        // Check if citizen is arriving at their home (heading_home state)
        if (
          building.category === "residential" &&
          char.state === "heading_home" &&
          char.residenceX === originX &&
          char.residenceY === originY
        ) {
          // Arrived home! If broke, rest until next day
          if (char.brokeUntilNextDay) {
            return {
              ...char,
              state: "resting_at_home",
              currentDestination: undefined,
              interactionCooldown: 0,
            };
          } else {
            // Just visiting home, go back to wandering
            return {
              ...char,
              state: "wandering",
              currentDestination: undefined,
              interactionCooldown: 1000,
            };
          }
        }

        // Residential building: try to move in if no residence
        if (
          building.category === "residential" &&
          char.residenceX === undefined &&
          economics.maxResidents
        ) {
          const currentResidents = this.buildingOccupancy.get(buildingKey) || [];
          if (currentResidents.length < economics.maxResidents) {
            // Move in!
            currentResidents.push(char.id);
            this.buildingOccupancy.set(buildingKey, currentResidents);
            this.events_.onBuildingInteraction?.(
              buildingId,
              originX,
              originY,
              "move_in",
              char.id
            );
            return {
              ...char,
              residenceX: originX,
              residenceY: originY,
              interactionCooldown: 3000, // 3 second cooldown after moving in
              state: "wandering", // Reset state after moving in
              currentDestination: undefined,
              lastFailedBuildingKey: undefined, // Clear failed building tracker
            };
          } else {
            // Building is full! Clear destination and set cooldown so they try somewhere else
            // Only if this was their target building
            if (char.currentDestination?.buildingOriginX === originX &&
                char.currentDestination?.buildingOriginY === originY) {
              return {
                ...char,
                interactionCooldown: 3000, // Wait before trying another building
                state: "wandering",
                currentDestination: undefined,
                lastFailedBuildingKey: buildingKey, // Remember this building was full
              };
            }
          }
        }

        // Business/Civic/Landmark: generate income
        if (economics.incomePerInteraction && building.category !== "residential") {
          // Check if citizen can afford to visit this business
          const cost = economics.incomePerInteraction;
          const citizenMoney = char.money ?? 0;
          
          if (citizenMoney >= cost) {
            // Deduct money from citizen and notify React
            this.events_.onCitizenSpend?.(char.id, cost);
            this.events_.onBuildingInteraction?.(
              buildingId,
              originX,
              originY,
              "income",
              char.id
            );
            // Set cooldown to prevent spam (5 seconds at normal speed = 5000ms)
            return {
              ...char,
              money: citizenMoney - cost,
              interactionCooldown: 5000,
            };
          }
          // Can't afford - mark as broke and clear destination so they go home or wander
          return {
            ...char,
            interactionCooldown: 3000,
            brokeUntilNextDay: true,
            state: "wandering",
            currentDestination: undefined,
          };
        }
      }
    }

    return char;
  }

  // Debug flag - set to true to enable console logging
  private debugPathfinding = false; // Disabled - set to true for debugging
  private debugLogCounter = 0;

  private debugLog(charId: string, ...args: unknown[]): void {
    if (!this.debugPathfinding) return;
    // Only log every 60 frames to avoid spam
    if (this.debugLogCounter % 60 === 0) {
      console.log(`[Citizen ${charId.slice(0, 4)}]`, ...args);
    }
  }

  private updateSingleCharacter(char: CharacterWithResidence): CharacterWithResidence {
    this.debugLogCounter++;

    // Citizens resting at home don't move - they're waiting for the next day
    if (char.state === "resting_at_home") {
      return char; // No updates needed, they're "inside" their home
    }

    const { x, y, direction, speed } = char;
    // Apply game speed multiplier
    const effectiveSpeed = speed * (this.gameSpeed === GameSpeed.Paused ? 0 : this.gameSpeed);
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    // Update interaction cooldown
    let newInteractionCooldown = char.interactionCooldown;
    if (newInteractionCooldown !== undefined && newInteractionCooldown > 0) {
      newInteractionCooldown = Math.max(0, newInteractionCooldown - (16 * this.gameSpeed)); // ~60fps, adjust by game speed
    }

    // Check for building interactions (updates char if interaction occurred)
    let updatedChar: CharacterWithResidence = {
      ...char,
      interactionCooldown: newInteractionCooldown,
    };
    updatedChar = this.checkBuildingInteraction(updatedChar);

    // Use updated char from interaction check
    char = updatedChar;
    newInteractionCooldown = char.interactionCooldown;

    // Track current position for stuck detection (declare early for use in early returns)
    const currentPos = { x: tileX, y: tileY };

    // Determine citizen state and destination
    let state = char.state || "wandering";
    let currentDestination = char.currentDestination;

    // Check if destination building still exists (might have been deleted)
    if (currentDestination && currentDestination.buildingOriginX !== undefined && currentDestination.buildingOriginY !== undefined) {
      const destCell = this.grid[currentDestination.buildingOriginY]?.[currentDestination.buildingOriginX];
      if (!destCell || destCell.type !== TileType.Building || !destCell.buildingId) {
        // Building was deleted! Clear destination and go back to wandering
        currentDestination = undefined;
        state = "wandering";
      }
    }
    
    // Also check if the destination tile itself is still walkable
    if (currentDestination && !this.isWalkable(currentDestination.x, currentDestination.y)) {
      // Destination tile is no longer walkable (building expanded over it, etc.)
      currentDestination = undefined;
      state = "wandering";
    }

    // If citizen has no residence and is wandering, look for a home they can AFFORD
    if (state === "wandering" && !char.residenceX) {
      const citizenMoney = char.money ?? 0;
      const nearbyBuildings = this.findNearbyBuildings(x, y, 15);
      
      // Only consider residential buildings the citizen can afford
      let residentialBuildings = nearbyBuildings.filter((b) => {
        const building = getBuilding(b.buildingId);
        if (!building || building.category !== "residential") return false;
        
        // Check if citizen can afford the rent
        const economics = getBuildingEconomics(building);
        const rent = economics.rentPerResident ?? 0;
        return citizenMoney >= rent;
      });

      // Shuffle the list so we don't always try the same building first
      residentialBuildings = [...residentialBuildings].sort(() => Math.random() - 0.5);

      if (residentialBuildings.length > 0 && Math.random() < 0.02) {
        // 2% chance per frame to look for a home
        // Try each residential building until we find one we can reach via SIDEWALKS
        for (const target of residentialBuildings) {
          const buildingKey = `${target.originX},${target.originY}`;

          // Skip buildings that were recently full
          if (char.lastFailedBuildingKey === buildingKey) {
            continue;
          }

          const adjacentTiles = this.getBuildingAdjacentTiles(
            target.originX,
            target.originY,
            target.buildingId
          );
          
          // Only consider buildings that have sidewalk-accessible tiles
          const sidewalkTiles = adjacentTiles.filter(t => this.isSidewalk(t.x, t.y));
          if (sidewalkTiles.length === 0) {
            // No sidewalk access to this building, skip it
            continue;
          }
          
          // Try to reach a sidewalk tile first
          const reachable = this.canReachAnyTarget(tileX, tileY, sidewalkTiles);
          if (reachable) {
            state = "heading_to_building";
            currentDestination = {
              x: reachable.x,
              y: reachable.y,
              buildingId: target.buildingId,
              buildingOriginX: target.originX,
              buildingOriginY: target.originY,
            };
            break;
          }
        }
      }
    }

    // If citizen is broke, either go home to rest or just wander
    const citizenMoney = char.money ?? 0;
    const isBroke = char.brokeUntilNextDay || citizenMoney <= 0;
    
    if (isBroke && state === "wandering" && !currentDestination) {
      // If they have a home, go rest there
      if (char.residenceX !== undefined && char.residenceY !== undefined) {
        // Find a path to home
        const homeKey = `${char.residenceX},${char.residenceY}`;
        const homeCell = this.grid[char.residenceY]?.[char.residenceX];
        if (homeCell?.buildingId) {
          const adjacentTiles = this.getBuildingAdjacentTiles(
            char.residenceX,
            char.residenceY,
            homeCell.buildingId
          );
          const reachable = this.canReachAnyTarget(tileX, tileY, adjacentTiles);
          if (reachable && Math.random() < 0.05) { // 5% chance per frame to head home
            state = "heading_home";
            currentDestination = {
              x: reachable.x,
              y: reachable.y,
              buildingId: homeCell.buildingId,
              buildingOriginX: char.residenceX,
              buildingOriginY: char.residenceY,
            };
          }
        }
      }
      // If no home or can't reach it, just wander (don't try to visit businesses)
    }
    // If citizen has money and is wandering, occasionally visit a business they can AFFORD
    else if (state === "wandering" && !currentDestination && !isBroke && Math.random() < 0.01) {
      // 1% chance per frame to visit a business
      const nearbyBuildings = this.findNearbyBuildings(x, y, 12);
      const businessBuildings = nearbyBuildings.filter((b) => {
        const building = getBuilding(b.buildingId);
        if (!building) return false;
        const economics = getBuildingEconomics(building);
        // Only consider businesses they can afford
        const cost = economics.incomePerInteraction ?? 0;
        return (
          (building.category === "commercial" ||
            building.category === "civic" ||
            building.category === "landmark") &&
          economics.incomePerInteraction !== undefined &&
          citizenMoney >= cost
        );
      });

      if (businessBuildings.length > 0) {
        // Shuffle and try each business until we find one we can reach via SIDEWALKS
        const shuffled = [...businessBuildings].sort(() => Math.random() - 0.5);
        for (const target of shuffled) {
          const adjacentTiles = this.getBuildingAdjacentTiles(
            target.originX,
            target.originY,
            target.buildingId
          );
          
          // Only consider buildings that have sidewalk-accessible tiles
          const sidewalkTiles = adjacentTiles.filter(t => this.isSidewalk(t.x, t.y));
          if (sidewalkTiles.length === 0) {
            // No sidewalk access to this building, skip it
            continue;
          }
          
          // Try to reach a sidewalk tile first
          const reachable = this.canReachAnyTarget(tileX, tileY, sidewalkTiles);
          if (reachable) {
            state = "heading_to_building";
            currentDestination = {
              x: reachable.x,
              y: reachable.y,
              buildingId: target.buildingId,
              buildingOriginX: target.originX,
              buildingOriginY: target.originY,
            };
            break;
          }
        }
      }
    }

    // If heading to a building, check if we've arrived (close enough to interact)
    if (state === "heading_to_building" && currentDestination) {
      const buildingOriginX = currentDestination.buildingOriginX;
      const buildingOriginY = currentDestination.buildingOriginY;

      // Check if we're within interaction distance of the building (same as checkBuildingInteraction)
      const INTERACTION_DISTANCE = 3;
      let canInteractWithBuilding = false;
      
      if (buildingOriginX !== undefined && buildingOriginY !== undefined) {
        // Get the building footprint to check all building tiles
        const building = currentDestination.buildingId ? getBuilding(currentDestination.buildingId) : null;
        if (building) {
          const footprint = getBuildingFootprint(building);
          // Check if we're within interaction distance of ANY part of the building
          for (let dy = 0; dy < footprint.height && !canInteractWithBuilding; dy++) {
            for (let dx = 0; dx < footprint.width && !canInteractWithBuilding; dx++) {
              const buildingTileX = buildingOriginX + dx;
              const buildingTileY = buildingOriginY + dy;
              const distToTile = Math.abs(tileX - buildingTileX) + Math.abs(tileY - buildingTileY);
              if (distToTile <= INTERACTION_DISTANCE) {
                canInteractWithBuilding = true;
              }
            }
          }
        } else {
          // Fallback: just check distance to origin
          const buildingDistance = Math.abs(tileX - buildingOriginX) + Math.abs(tileY - buildingOriginY);
          canInteractWithBuilding = buildingDistance <= INTERACTION_DISTANCE;
        }
      }

      // If we're close enough to interact, we've "arrived"
      if (canInteractWithBuilding) {
        state = "at_building";
        newInteractionCooldown = 500 + Math.random() * 1000; // Short cooldown before interaction triggers
        currentDestination = undefined; // Clear destination - we're here!
      }
    }

    // If at building, check if we should leave
    if (state === "at_building") {
      // Check if we're actually adjacent to a building (can interact)
      let canInteract = false;
      const directions = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
      ];
      for (const dir of directions) {
        const checkX = tileX + dir.dx;
        const checkY = tileY + dir.dy;
        if (
          checkX >= 0 &&
          checkX < GRID_WIDTH &&
          checkY >= 0 &&
          checkY < GRID_HEIGHT
        ) {
          const cell = this.grid[checkY][checkX];
          if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
            canInteract = true;
            break;
          }
        }
      }

      // If we can't interact and have a destination, try to get closer
      if (!canInteract && currentDestination) {
        // Try to pathfind to the destination again
        state = "heading_to_building";
      } else if (!newInteractionCooldown || newInteractionCooldown === 0) {
        // We've finished interacting, decide what to do next
        if (char.residenceX !== undefined && char.residenceY !== undefined) {
          // Find the building ID at residence location
          const residenceCell = this.grid[char.residenceY]?.[char.residenceX];
          if (residenceCell && residenceCell.buildingId) {
            const adjacentTiles = this.getBuildingAdjacentTiles(
              char.residenceX,
              char.residenceY,
              residenceCell.buildingId
            );
            const reachable = this.canReachAnyTarget(tileX, tileY, adjacentTiles);
            if (reachable) {
              state = "heading_home";
              currentDestination = {
                x: reachable.x,
                y: reachable.y,
              };
            } else {
              state = "wandering";
              currentDestination = undefined;
            }
          } else {
            state = "wandering";
            currentDestination = undefined;
          }
        } else {
          state = "wandering";
          currentDestination = undefined;
        }
      }
    }

    // If heading home, check if we've arrived
    if (state === "heading_home" && currentDestination && char.residenceX) {
      const distance =
        Math.abs(tileX - currentDestination.x) + Math.abs(tileY - currentDestination.y);
      if (distance <= 1) {
        state = "wandering";
        currentDestination = undefined;
      }
    }

    // Check if current tile is still walkable
    if (!this.isWalkable(tileX, tileY)) {
      const walkableTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          const tileType = this.grid[gy][gx].type;
          if (
            tileType === TileType.Road ||
            tileType === TileType.Tile ||
            tileType === TileType.Asphalt
          ) {
            walkableTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (walkableTiles.length > 0) {
        const newTile =
          walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
        return {
          ...char,
          x: newTile.x + 0.5,
          y: newTile.y + 0.5,
          direction:
            allDirections[Math.floor(Math.random() * allDirections.length)],
          state: "wandering",
          currentDestination: undefined,
          interactionCooldown: newInteractionCooldown,
          stuckCounter: 0,
          lastPosition: { x: newTile.x, y: newTile.y },
        };
      }
      return {
        ...char,
        interactionCooldown: newInteractionCooldown,
        stuckCounter: 0,
        lastPosition: currentPos,
      };
    }

    const inTileX = x - tileX;
    const inTileY = y - tileY;
    // Use a fixed threshold for nearCenter check (not dependent on speed)
    const threshold = 0.15; // Within 15% of center
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    // Detect if stuck (same tile for too long) OR oscillating between tiles
    let stuckCounter = char.stuckCounter || 0;
    let oscillationCounter = (char as any).oscillationCounter || 0;
    const lastPos = char.lastPosition;
    const secondLastPos = (char as any).secondLastPosition;

    // Check for oscillation: moving between same two tiles repeatedly
    if (lastPos && secondLastPos) {
      const isOscillating = 
        (lastPos.x === secondLastPos.x && lastPos.y === secondLastPos.y) ||
        (tileX === secondLastPos.x && tileY === secondLastPos.y && lastPos.x === tileX && lastPos.y === tileY);
      
      if (isOscillating) {
        oscillationCounter += 1;
        // If oscillating for 2+ seconds (120 frames), give up
        if (oscillationCounter > 120) {
          console.log(`[Citizen ${char.id.slice(0,4)}] Oscillating between tiles, giving up on destination`);
          state = "wandering";
          currentDestination = undefined;
          stuckCounter = 0;
          oscillationCounter = 0;
        }
      } else {
        oscillationCounter = 0;
      }
    }

    // Only count as stuck if on the same tile
    if (lastPos && lastPos.x === tileX && lastPos.y === tileY) {
      stuckCounter += 1;

      // Only log when REALLY stuck (3+ seconds), not just normal tile traversal
      if (stuckCounter === 180) {
        console.log(`[Citizen ${char.id.slice(0,4)}] Stuck for 3s at (${tileX}, ${tileY}), state: ${state}, dest: ${currentDestination ? `(${currentDestination.x},${currentDestination.y})` : 'none'}`);
      }

      // Only after being stuck for a VERY long time (5+ seconds), give up on destination
      if (stuckCounter > 300) {
        console.log(`[Citizen ${char.id.slice(0,4)}] Giving up on destination after 5s stuck`);
        state = "wandering";
        currentDestination = undefined;
        stuckCounter = 0;
        oscillationCounter = 0;
      }
    } else {
      // Moved to a new tile, reset counter
      stuckCounter = 0;
    }

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    // If we have a destination, try to pathfind towards it
    if (currentDestination && (state === "heading_to_building" || state === "heading_home")) {
      this.debugLog(char.id, `Has destination: (${currentDestination.x}, ${currentDestination.y}), state: ${state}, nearCenter: ${nearCenter}, pos: (${tileX}, ${tileY})`);
      
      // Check if current direction would lead into a wall
      const currentDirVec = directionVectors[direction];
      const aheadTileX = tileX + currentDirVec.dx;
      const aheadTileY = tileY + currentDirVec.dy;
      const isCurrentDirBlocked = !this.isWalkable(aheadTileX, aheadTileY);
      
      // Only do FULL pathfinding when near center of tile
      // If just blocked (not near center), pick a locally valid direction without full recalc
      if (nearCenter) {
        // Full pathfinding at tile centers
        const targetDir = this.moveTowardsTarget(char, currentDestination.x, currentDestination.y);
        this.debugLog(char.id, `Pathfinding returned: ${targetDir}`);
        
        if (targetDir) {
          // Check if the direction is actually walkable
          const targetVec = directionVectors[targetDir];
          const nextTileX = tileX + targetVec.dx;
          const nextTileY = tileY + targetVec.dy;
          const isNextWalkable = this.isWalkable(nextTileX, nextTileY);
          this.debugLog(char.id, `Target dir ${targetDir} -> (${nextTileX}, ${nextTileY}), walkable: ${isNextWalkable}`);
          
          if (isNextWalkable) {
            newDirection = targetDir;
          } else {
            // Direction not walkable, try greedy fallback
            const greedyDir = this.moveTowardsTargetGreedy(tileX, tileY, currentDestination.x, currentDestination.y);
            if (greedyDir && this.isWalkable(tileX + directionVectors[greedyDir].dx, tileY + directionVectors[greedyDir].dy)) {
              newDirection = greedyDir;
            } else {
              // Can't move toward target, pick any valid direction to keep moving
              const validDirs = this.getValidDirections(tileX, tileY);
              if (validDirs.length > 0) {
                newDirection = validDirs[0];
              }
            }
          }
        } else {
          // Pathfinding returned null - try greedy or pick any valid direction
          const greedyDir = this.moveTowardsTargetGreedy(tileX, tileY, currentDestination.x, currentDestination.y);
          if (greedyDir && this.isWalkable(tileX + directionVectors[greedyDir].dx, tileY + directionVectors[greedyDir].dy)) {
            newDirection = greedyDir;
          } else {
            const validDirs = this.getValidDirections(tileX, tileY);
            if (validDirs.length > 0) {
              newDirection = validDirs[0];
            }
          }
        }
      } else if (isCurrentDirBlocked) {
        // Not near center but direction is blocked - just pick a valid direction
        // WITHOUT full pathfinding (to avoid oscillation)
        // Use greedy to try to get closer to target
        const greedyDir = this.moveTowardsTargetGreedy(tileX, tileY, currentDestination.x, currentDestination.y);
        if (greedyDir && this.isWalkable(tileX + directionVectors[greedyDir].dx, tileY + directionVectors[greedyDir].dy)) {
          newDirection = greedyDir;
        } else {
          // Greedy doesn't work, pick any valid direction except the opposite of current
          // (to maintain momentum and avoid going back immediately)
          const validDirs = this.getValidDirections(tileX, tileY);
          const opposite = oppositeDirection[direction];
          const preferredDirs = validDirs.filter(d => d !== opposite);
          if (preferredDirs.length > 0) {
            newDirection = preferredDirs[0];
          } else if (validDirs.length > 0) {
            newDirection = validDirs[0];
          }
        }
      }
      // If not blocked and not near center, keep moving in current direction
    } else if (nearCenter) {
      // Normal wandering behavior - only change direction at tile centers
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.isWalkable(nextTileX, nextTileY)) {
        const newDir = this.pickNewDirection(tileX, tileY, direction);
        if (newDir) {
          newDirection = newDir;
          // DON'T snap to center - just change direction
        }
        // If no valid direction, keep current direction (will be blocked at end)
      } else {
        const validDirs = this.getValidDirections(tileX, tileY);
        if (validDirs.length > 2 && Math.random() < 0.1) {
          const newDir = this.pickNewDirection(tileX, tileY, direction);
          if (newDir) {
            newDirection = newDir;
            // DON'T snap to center - just change direction
          }
        }
      }
    }

    // Emergency check: if we have no valid directions, we're trapped
    const validDirs = this.getValidDirections(tileX, tileY);
    if (validDirs.length === 0) {
      // Find any walkable tile and teleport there
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (this.isWalkable(gx, gy)) {
            return {
              ...char,
              x: gx + 0.5,
              y: gy + 0.5,
              direction: allDirections[Math.floor(Math.random() * allDirections.length)],
              state: "wandering",
              currentDestination: undefined,
              interactionCooldown: newInteractionCooldown,
              stuckCounter: 0,
              lastPosition: { x: gx, y: gy },
            };
          }
        }
      }
    }

    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * effectiveSpeed;
    nextY += moveVec.dy * effectiveSpeed;

    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);

    if (!this.isWalkable(finalTileX, finalTileY)) {
      if (this.debugLogCounter % 60 === 0) {
        console.log(`[Citizen ${char.id.slice(0,4)}] BLOCKED - final tile (${finalTileX},${finalTileY}) not walkable, staying at (${tileX},${tileY})`);
      }
      return {
        ...char,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
        state,
        currentDestination,
        interactionCooldown: newInteractionCooldown,
        stuckCounter,
        lastPosition: { x: tileX, y: tileY },
      };
    }

    // Reset stuck counter if we actually moved to a different tile
    const finalStuckCounter = (finalTileX !== tileX || finalTileY !== tileY) ? 0 : stuckCounter;

    // Only log movement when debug is enabled
    if (this.debugPathfinding && this.debugLogCounter % 60 === 0 && currentDestination) {
      console.log(`[Citizen ${char.id.slice(0,4)}] Moving: (${tileX},${tileY})->(${finalTileX},${finalTileY}), dir: ${newDirection}, dest: (${currentDestination.x},${currentDestination.y})`);
    }

    // Clear lastFailedBuildingKey after some time (when cooldown expires and they've moved)
    const clearFailedBuilding = !char.lastFailedBuildingKey || 
      (newInteractionCooldown === 0 && finalStuckCounter === 0);
    
    return {
      ...char,
      x: nextX,
      y: nextY,
      direction: newDirection,
      state,
      currentDestination,
      interactionCooldown: newInteractionCooldown,
      stuckCounter: finalStuckCounter,
      lastPosition: { x: finalTileX, y: finalTileY },
      lastFailedBuildingKey: clearFailedBuilding ? undefined : char.lastFailedBuildingKey,
      // Track oscillation for stuck detection
      oscillationCounter: oscillationCounter,
      secondLastPosition: lastPos ? { x: lastPos.x, y: lastPos.y } : undefined,
    } as CharacterWithResidence & { oscillationCounter?: number; secondLastPosition?: { x: number; y: number } };
  }

  // ============================================
  // CAR LOGIC (moved from React)
  // ============================================

  private updateCars(): void {
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i] = this.updateSingleCar(this.cars[i]);
    }
  }

  private isDrivable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    return this.grid[gy][gx].type === TileType.Asphalt;
  }

  private getValidCarDirections(tileX: number, tileY: number): Direction[] {
    const valid: Direction[] = [];
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      if (this.isDrivable(tileX + vec.dx, tileY + vec.dy)) {
        valid.push(dir);
      }
    }
    return valid;
  }

  private isDirectionClear(
    car: Car,
    dir: Direction,
    checkDist: number = 1.2
  ): boolean {
    const vec = directionVectors[dir];
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    for (const other of allCars) {
      if (other.id === car.id) continue;
      const dist = Math.sqrt(
        Math.pow(other.x - aheadX, 2) + Math.pow(other.y - aheadY, 2)
      );
      if (dist < 0.7) return false;
    }
    return true;
  }

  private pickCarDirection(
    car: Car,
    tileX: number,
    tileY: number,
    currentDir: Direction,
    atDeadEnd: boolean = false
  ): Direction | null {
    const validDirs = this.getValidCarDirections(tileX, tileY);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const atIntersection = isAtIntersection(tileX, tileY, this.grid);
    const laneDir = getLaneDirection(tileX, tileY, this.grid);

    if (atDeadEnd || validDirs.length === 1) {
      const uTurnDir = getUTurnDirection(tileX, tileY, currentDir, this.grid);
      if (uTurnDir && validDirs.includes(uTurnDir)) {
        return uTurnDir;
      }
      return validDirs[0];
    }

    if (!atIntersection) {
      if (laneDir && validDirs.includes(laneDir)) {
        if (this.isDirectionClear(car, laneDir)) {
          return laneDir;
        }
        return null;
      }

      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir)
      ) {
        return currentDir;
      }

      return null;
    }

    const turnableChoices = validDirs.filter((d) => {
      if (d === opposite) return false;
      return canTurnAtTile(tileX, tileY, currentDir, d);
    });

    if (
      validDirs.includes(currentDir) &&
      !turnableChoices.includes(currentDir)
    ) {
      turnableChoices.push(currentDir);
    }

    if (turnableChoices.length === 0) {
      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir)
      ) {
        return currentDir;
      }
      return null;
    }

    const clearChoices = turnableChoices.filter((d) =>
      this.isDirectionClear(car, d)
    );

    if (clearChoices.length === 0) {
      return null;
    }

    if (clearChoices.includes(currentDir) && Math.random() < 0.75) {
      return currentDir;
    }

    const turnsOnly = clearChoices.filter((d) => d !== currentDir);
    if (turnsOnly.length > 0) {
      return turnsOnly[Math.floor(Math.random() * turnsOnly.length)];
    }

    return clearChoices[0];
  }

  private isCarBlocking(car: Car): boolean {
    const vec = directionVectors[car.direction];
    const MIN_CAR_SPACING = 1.8; // Increased to prevent visual overlap

    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    for (const other of allCars) {
      if (other.id === car.id) continue;

      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > MIN_CAR_SPACING * 1.5) continue;

      const dotProduct = dx * vec.dx + dy * vec.dy;

      if (dotProduct > 0 && dist < MIN_CAR_SPACING) {
        const crossProduct = Math.abs(dx * vec.dy - dy * vec.dx);
        if (crossProduct < 0.6) {
          return true;
        }
      }
    }
    return false;
  }

  private updateSingleCar(car: Car): Car {
    const { x, y, direction, speed, waiting } = car;
    // Apply game speed multiplier
    const effectiveSpeed = speed * (this.gameSpeed === GameSpeed.Paused ? 0 : this.gameSpeed);
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    if (!this.isDrivable(tileX, tileY)) {
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (this.grid[gy][gx].type === TileType.Asphalt) {
            asphaltTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (asphaltTiles.length > 0) {
        const newTile =
          asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
        const laneDir = getLaneDirection(newTile.x, newTile.y, this.grid);
        return {
          ...car,
          x: newTile.x + 0.5,
          y: newTile.y + 0.5,
          direction: laneDir || Direction.Right,
          waiting: 0,
        };
      }
      return car;
    }

    const blocked = this.isCarBlocking(car);
    const MAX_WAIT_FRAMES = 60;

    if (blocked) {
      const newWaiting = waiting + 1;

      if (newWaiting > MAX_WAIT_FRAMES) {
        if (isAtIntersection(tileX, tileY, this.grid)) {
          const altDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            true
          );
          if (altDir && altDir !== direction) {
            return {
              ...car,
              x: tileX + 0.5,
              y: tileY + 0.5,
              direction: altDir,
              waiting: 0,
            };
          }
        }
        return { ...car, waiting: 0 };
      }

      return { ...car, waiting: newWaiting };
    }

    if (waiting > 0) {
      return { ...car, waiting: 0 };
    }

    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = effectiveSpeed * 2;
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      const atIntersection = isAtIntersection(tileX, tileY, this.grid);
      const laneDir = getLaneDirection(tileX, tileY, this.grid);
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.isDrivable(nextTileX, nextTileY)) {
        const newDir = this.pickCarDirection(
          car,
          tileX,
          tileY,
          direction,
          true
        );
        if (newDir) {
          newDirection = newDir;
        }
        nextX = tileX + 0.5;
        nextY = tileY + 0.5;
      } else if (atIntersection) {
        const validDirs = this.getValidCarDirections(tileX, tileY);
        if (validDirs.length >= 3 && Math.random() < 0.25) {
          const newDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            false
          );
          if (newDir) {
            newDirection = newDir;
            nextX = tileX + 0.5;
            nextY = tileY + 0.5;
          }
        }
      } else if (laneDir && laneDir !== direction) {
        if (this.getValidCarDirections(tileX, tileY).includes(laneDir)) {
          newDirection = laneDir;
          nextX = tileX + 0.5;
          nextY = tileY + 0.5;
        }
      }
    }

    const moveVec = directionVectors[newDirection];
    const pixelatedStep = Math.max(0.001, effectiveSpeed);
    nextX += moveVec.dx * effectiveSpeed;
    nextY += moveVec.dy * effectiveSpeed;

    nextX = Math.round(nextX / pixelatedStep) * pixelatedStep;
    nextY = Math.round(nextY / pixelatedStep) * pixelatedStep;

    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);

    if (!this.isDrivable(finalTileX, finalTileY)) {
      return {
        ...car,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
        waiting: 0,
      };
    }

    return { ...car, x: nextX, y: nextY, direction: newDirection, waiting: 0 };
  }

  // ============================================
  // PLAYER CAR LOGIC
  // ============================================

  private updatePlayerCar(): void {
    if (!this.isPlayerDriving || !this.playerCar) return;

    const car = this.playerCar;
    let newDirection = car.direction;
    let nextX = car.x;
    let nextY = car.y;

    let desiredDir: Direction | null = null;

    if (this.pressedKeys.has("arrowup") || this.pressedKeys.has("w")) {
      desiredDir = Direction.Up;
    } else if (this.pressedKeys.has("arrowdown") || this.pressedKeys.has("s")) {
      desiredDir = Direction.Down;
    } else if (this.pressedKeys.has("arrowleft") || this.pressedKeys.has("a")) {
      desiredDir = Direction.Left;
    } else if (
      this.pressedKeys.has("arrowright") ||
      this.pressedKeys.has("d")
    ) {
      desiredDir = Direction.Right;
    }

    if (desiredDir) {
      newDirection = desiredDir;
      const vec = directionVectors[newDirection];
      const moveX = nextX + vec.dx * car.speed;
      const moveY = nextY + vec.dy * car.speed;

      if (!this.checkPlayerCarCollision(moveX, moveY)) {
        nextX = moveX;
        nextY = moveY;
      }
    }

    const pixelatedStep = Math.max(0.001, car.speed);
    nextX = Math.round(nextX / pixelatedStep) * pixelatedStep;
    nextY = Math.round(nextY / pixelatedStep) * pixelatedStep;

    this.playerCar = { ...car, x: nextX, y: nextY, direction: newDirection };
  }

  private checkPlayerCarCollision(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);

    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) {
      return true;
    }

    const cell = this.grid[gy][gx];

    if (cell.type === TileType.Building) {
      return true;
    }

    for (const car of this.cars) {
      if (car.id === "player-car") continue;
      const carTileX = Math.floor(car.x);
      const carTileY = Math.floor(car.y);
      if (carTileX === gx && carTileY === gy) {
        return true;
      }
    }

    for (const char of this.characters) {
      const charTileX = Math.floor(char.x);
      const charTileY = Math.floor(char.y);
      if (charTileX === gx && charTileY === gy) {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // PUBLIC METHODS (called from React)
  // ============================================

  // Convert grid coordinates to isometric screen position
  gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: GRID_OFFSET_X + (gridX - gridY) * (TILE_WIDTH / 2),
      y: GRID_OFFSET_Y + (gridX + gridY) * (TILE_HEIGHT / 2),
    };
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    const relX = screenX - GRID_OFFSET_X;
    const relY = screenY - GRID_OFFSET_Y;

    return {
      x: (relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2,
      y: (relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2,
    };
  }

  private depthFromSortPoint(
    sortX: number,
    sortY: number,
    layerOffset: number = 0
  ): number {
    return sortY * this.DEPTH_Y_MULT + sortX + layerOffset;
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    // Handle camera panning
    if (this.isPanning && pointer.leftButtonDown()) {
      const camera = this.cameras.main;
      const dx = (this.panStartX - pointer.x) / camera.zoom;
      const dy = (this.panStartY - pointer.y) / camera.zoom;
      // Update BASE scroll (never include transient shake in the base)
      this.baseScrollX = this.cameraStartX + dx;
      this.baseScrollY = this.cameraStartY + dy;
      camera.setScroll(
        Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
        Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
      );
      return;
    }

    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const gridPos = this.screenToGrid(worldPoint.x, worldPoint.y);
    const tileX = Math.floor(gridPos.x);
    const tileY = Math.floor(gridPos.y);

    if (tileX >= 0 && tileX < GRID_WIDTH && tileY >= 0 && tileY < GRID_HEIGHT) {
      if (
        !this.hoverTile ||
        this.hoverTile.x !== tileX ||
        this.hoverTile.y !== tileY
      ) {
        this.hoverTile = { x: tileX, y: tileY };
        this.events_.onTileHover(tileX, tileY);

        // If dragging with snow/tile/asphalt/eraser tool, add tile to drag set
        if (
          this.isDragging &&
          (this.selectedTool === ToolType.Snow ||
            this.selectedTool === ToolType.Tile ||
            this.selectedTool === ToolType.Asphalt ||
            this.selectedTool === ToolType.Eraser)
        ) {
          this.dragTiles.add(`${tileX},${tileY}`);
        }

        // If dragging with road tool, add road segments in straight line
        if (
          this.isDragging &&
          this.selectedTool === ToolType.RoadNetwork &&
          this.dragStartTile
        ) {
          // Determine direction on first movement
          if (this.dragDirection === null) {
            const dx = Math.abs(tileX - this.dragStartTile.x);
            const dy = Math.abs(tileY - this.dragStartTile.y);
            if (dx > dy) {
              this.dragDirection = "horizontal";
            } else if (dy > dx) {
              this.dragDirection = "vertical";
            } else {
              // Equal movement - wait for more movement, keep initial segment
              return;
            }
          }

          // Clear and rebuild drag tiles for roads
          this.dragTiles.clear();

          // Constrain to the determined direction
          if (this.dragDirection === "horizontal") {
            // Only add segments along horizontal line
            const startX = Math.min(this.dragStartTile.x, tileX);
            const endX = Math.max(this.dragStartTile.x, tileX);
            const startSegment = getRoadSegmentOrigin(
              startX,
              this.dragStartTile.y
            );
            const endSegment = getRoadSegmentOrigin(endX, this.dragStartTile.y);

            const startSegX = Math.min(startSegment.x, endSegment.x);
            const endSegX = Math.max(startSegment.x, endSegment.x);

            for (
              let segX = startSegX;
              segX <= endSegX;
              segX += ROAD_SEGMENT_SIZE
            ) {
              this.dragTiles.add(`${segX},${startSegment.y}`);
            }
          } else if (this.dragDirection === "vertical") {
            // Only add segments along vertical line
            const startY = Math.min(this.dragStartTile.y, tileY);
            const endY = Math.max(this.dragStartTile.y, tileY);
            const startSegment = getRoadSegmentOrigin(
              this.dragStartTile.x,
              startY
            );
            const endSegment = getRoadSegmentOrigin(this.dragStartTile.x, endY);

            const startSegY = Math.min(startSegment.y, endSegment.y);
            const endSegY = Math.max(startSegment.y, endSegment.y);

            for (
              let segY = startSegY;
              segY <= endSegY;
              segY += ROAD_SEGMENT_SIZE
            ) {
              this.dragTiles.add(`${startSegment.x},${segY}`);
            }
          }

          // Update preview after updating drag tiles
          this.updatePreview();
        }

        this.updatePreview();
      }
    } else {
      if (this.hoverTile) {
        this.hoverTile = null;
        this.events_.onTileHover(null, null);
        this.clearPreview();
      }
    }
  }

  handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    if (pointer.leftButtonDown()) {
      // Check if clicking on a citizen when no tool is selected - show citizen info
      if (this.selectedTool === ToolType.None) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const gridPos = this.screenToGrid(worldPoint.x, worldPoint.y);
        
        // Check if any citizen is close to the click position
        for (const char of this.characters) {
          const charScreenPos = this.gridToScreen(char.x, char.y);
          const clickScreenPos = worldPoint;
          const distance = Math.sqrt(
            Math.pow(charScreenPos.x - clickScreenPos.x, 2) +
            Math.pow(charScreenPos.y - clickScreenPos.y, 2)
          );
          // Click within ~30 pixels of character
          if (distance < 30) {
            if (this.events_.onCitizenClick) {
              this.events_.onCitizenClick(char.id);
              return; // Don't start panning
            }
          }
        }
      }

      // Check if clicking on a building when no tool is selected - show building info
      if (this.selectedTool === ToolType.None && this.hoverTile) {
        const cell = this.grid[this.hoverTile.y]?.[this.hoverTile.x];
        if (cell && cell.type === TileType.Building) {
          // Get building origin
          const originX = cell.originX !== undefined ? cell.originX : this.hoverTile.x;
          const originY = cell.originY !== undefined ? cell.originY : this.hoverTile.y;
          const originCell = this.grid[originY]?.[originX];
          const buildingId = originCell?.buildingId || cell.buildingId;
          
          if (buildingId && this.events_.onBuildingClick) {
            this.events_.onBuildingClick(buildingId, originX, originY);
            return; // Don't start panning
          }
        }
      }

      // Check if we should start panning (no tool selected OR clicking empty space with no active tool)
      const shouldPan =
        this.selectedTool === ToolType.None ||
        (this.selectedTool === ToolType.Building && !this.hoverTile);

      if (shouldPan) {
        // Start camera panning
        this.isPanning = true;
        this.panStartX = pointer.x;
        this.panStartY = pointer.y;
        // Capture BASE scroll (never include transient shake in the base)
        this.cameraStartX = this.baseScrollX;
        this.cameraStartY = this.baseScrollY;
        return;
      }

      if (this.hoverTile) {
        // Start drag for snow/tile/asphalt/eraser/road tools
        if (
          this.selectedTool === ToolType.Snow ||
          this.selectedTool === ToolType.Tile ||
          this.selectedTool === ToolType.Asphalt ||
          this.selectedTool === ToolType.Eraser ||
          this.selectedTool === ToolType.RoadNetwork
        ) {
          this.isDragging = true;
          this.dragTiles.clear();
          this.dragStartTile = { x: this.hoverTile.x, y: this.hoverTile.y };
          this.dragDirection = null;

          if (this.selectedTool === ToolType.RoadNetwork) {
            // For roads, add the initial segment origin
            const segmentOrigin = getRoadSegmentOrigin(
              this.hoverTile.x,
              this.hoverTile.y
            );
            this.dragTiles.add(`${segmentOrigin.x},${segmentOrigin.y}`);
          } else {
            // For other tools, add the tile directly
            this.dragTiles.add(`${this.hoverTile.x},${this.hoverTile.y}`);
          }
          this.updatePreview();
        } else {
          // Regular single click for other tools
          this.events_.onTileClick(this.hoverTile.x, this.hoverTile.y);
        }
      }
    }
  }

  handlePointerUp(_pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    // End camera panning
    if (this.isPanning) {
      this.isPanning = false;
    }

    if (this.isDragging) {
      const tiles = Array.from(this.dragTiles).map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      });

      if (tiles.length > 0) {
        if (
          this.selectedTool === ToolType.Eraser &&
          this.events_.onEraserDrag
        ) {
          // Eraser uses confirmation dialog
          this.events_.onEraserDrag(tiles);
        } else if (
          this.selectedTool === ToolType.RoadNetwork &&
          this.events_.onRoadDrag
        ) {
          // Road drag - segments are already in dragTiles
          this.events_.onRoadDrag(tiles);
        } else if (this.events_.onTilesDrag) {
          // Snow/Tile place immediately
          this.events_.onTilesDrag(tiles);
        }
      }

      this.isDragging = false;
      this.dragTiles.clear();
      this.dragStartTile = null;
      this.dragDirection = null;
      this.updatePreview();
    }
  }

  // Zoom levels matching React state
  private static readonly ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];
  private wheelAccumulator = 0;
  private lastWheelDirection = 0;
  // Anchor point for consistent zoom-at-cursor during rapid scrolling
  private zoomAnchorWorld: { x: number; y: number } | null = null;
  private zoomAnchorScreen: { x: number; y: number } | null = null;
  private lastZoomTime = 0;
  private static readonly ZOOM_ANCHOR_TIMEOUT = 150; // ms to keep anchor locked

  // Handle mouse wheel zoom - anchor-based to prevent drift
  // Official Phaser approach: https://phaser.io/examples/v3.85.0/tilemap/view/mouse-wheel-zoom
  handleWheel(
    pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number
  ): void {
    if (!this.isReady) return;

    const camera = this.cameras.main;
    const WHEEL_THRESHOLD = 100;

    // Accumulate wheel delta for discrete zoom levels
    const direction = deltaY > 0 ? 1 : -1;
    if (this.lastWheelDirection !== 0 && this.lastWheelDirection !== direction) {
      this.wheelAccumulator = 0;
    }
    this.lastWheelDirection = direction;
    this.wheelAccumulator += Math.abs(deltaY);

    if (this.wheelAccumulator < WHEEL_THRESHOLD) return;
    this.wheelAccumulator = 0;

    // Find current zoom index and calculate new zoom
    const currentZoom = camera.zoom;
    let currentIndex = MainScene.ZOOM_LEVELS.indexOf(currentZoom);
    if (currentIndex === -1) {
      currentIndex = MainScene.ZOOM_LEVELS.reduce((closest, z, i) =>
        Math.abs(z - currentZoom) < Math.abs(MainScene.ZOOM_LEVELS[closest] - currentZoom) ? i : closest, 0);
    }

    const newIndex = direction > 0
      ? Math.max(0, currentIndex - 1)
      : Math.min(MainScene.ZOOM_LEVELS.length - 1, currentIndex + 1);

    const newZoom = MainScene.ZOOM_LEVELS[newIndex];
    if (newZoom === currentZoom) return;

    // === OFFICIAL PHASER APPROACH ===
    // Step 1: Get world point under cursor BEFORE zoom
    const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);

    // Step 2: Apply new zoom
    camera.zoom = newZoom;

    // Step 3: Update camera matrix so getWorldPoint returns zoom-adjusted coords
    camera.preRender();

    // Step 4: Get world point at same screen position AFTER zoom
    const newWorldPoint = camera.getWorldPoint(pointer.x, pointer.y);

    // Step 5: Scroll camera to keep pointer under same world point
    camera.scrollX -= newWorldPoint.x - worldPoint.x;
    camera.scrollY -= newWorldPoint.y - worldPoint.y;

    // Update our state to match
    this.baseScrollX = camera.scrollX;
    this.baseScrollY = camera.scrollY;
    this.zoomLevel = newZoom;
    this.zoomHandledInternally = true;

    this.events.emit('zoomChanged', newZoom);
  }

  setEventCallbacks(events: SceneEvents): void {
    this.events_ = events;
  }

  // Receive grid updates from React (differential update)
  updateGrid(newGrid: GridCell[][]): void {
    // Find changed tiles and mark for update
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const oldCell = this.grid[y]?.[x];
        const newCell = newGrid[y]?.[x];

        if (!oldCell || !newCell) continue;

        // Check if tile changed
        if (
          oldCell.type !== newCell.type ||
          oldCell.buildingId !== newCell.buildingId ||
          oldCell.isOrigin !== newCell.isOrigin ||
          oldCell.buildingOrientation !== newCell.buildingOrientation ||
          oldCell.underlyingTileType !== newCell.underlyingTileType
        ) {
          this.gridDirtyTiles.add(`${x},${y}`);
        }
      }
    }

    // Update grid reference
    this.grid = newGrid;

    if (this.gridDirtyTiles.size > 0) {
      this.gridDirty = true;
    }

    // Refresh preview
    if (this.isReady) {
      this.updatePreview();
      if (this.showPaths) {
        this.renderPathOverlay();
      }
    }
  }

  private applyGridUpdates(): void {
    // Process dirty tiles
    const buildingsToRender = new Set<string>();
    const buildingsToRemove = new Set<string>();

    for (const key of this.gridDirtyTiles) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      const cell = this.grid[y]?.[x];
      if (!cell) continue;

      // Update tile sprite
      this.updateTileSprite(x, y, cell);

      // Track building changes
      if (cell.type === TileType.Building && cell.isOrigin && cell.buildingId) {
        buildingsToRender.add(`${x},${y}`);
      }

      // Check if an old building was here
      const oldBuildingKey = `building_${x},${y}`;
      if (
        this.buildingSprites.has(oldBuildingKey) &&
        (cell.type !== TileType.Building || !cell.isOrigin)
      ) {
        buildingsToRemove.add(oldBuildingKey);
        // Clean up building occupancy when building is removed
        const buildingKey = `${x},${y}`;
        const residents = this.buildingOccupancy.get(buildingKey);
        if (residents) {
          // Remove residence from all citizens who lived here
          for (const residentId of residents) {
            const citizen = this.characters.find((c) => c.id === residentId);
            if (citizen && citizen.residenceX === x && citizen.residenceY === y) {
              citizen.residenceX = undefined;
              citizen.residenceY = undefined;
              citizen.state = "wandering";
              citizen.currentDestination = undefined;
            }
          }
          this.buildingOccupancy.delete(buildingKey);
        }
      }
    }

    // Remove old buildings and their glows (including slices)
    for (const key of buildingsToRemove) {
      this.removeBuildingSprites(key);
    }

    // Render new/changed buildings
    for (const key of buildingsToRender) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      const cell = this.grid[y]?.[x];
      if (cell?.buildingId) {
        // Remove old sprite and glow if exists (including slices)
        const buildingKey = `building_${x},${y}`;
        this.removeBuildingSprites(buildingKey);
        this.renderBuilding(x, y, cell.buildingId, cell.buildingOrientation);
      }
    }

    this.gridDirtyTiles.clear();
  }

  private updateTileSprite(x: number, y: number, cell: GridCell): void {
    const key = `${x},${y}`;
    const screenPos = this.gridToScreen(x, y);

    // Determine texture
    let textureKey = "grass";

    if (cell.type === TileType.Road) {
      textureKey = "road";
    } else if (cell.type === TileType.Asphalt) {
      textureKey = "asphalt";
    } else if (cell.type === TileType.Tile) {
      textureKey = "road";
    } else if (cell.type === TileType.Snow) {
      textureKey = getSnowTextureKey(x, y);
    } else if (cell.type === TileType.Building) {
      if (cell.buildingId) {
        const building = getBuilding(cell.buildingId);
        const preservesTile =
          building && (building.category === "props" || building.isDecoration);
        if (preservesTile && cell.underlyingTileType) {
          if (
            cell.underlyingTileType === TileType.Tile ||
            cell.underlyingTileType === TileType.Road
          ) {
            textureKey = "road";
          } else if (cell.underlyingTileType === TileType.Asphalt) {
            textureKey = "asphalt";
          } else if (cell.underlyingTileType === TileType.Snow) {
            textureKey = getSnowTextureKey(x, y);
          } else {
            textureKey = "grass";
          }
        } else if (preservesTile) {
          // No underlying tile stored, default to grass for decorations
          textureKey = "grass";
        } else {
          textureKey = "road";
        }
      } else {
        textureKey = "road";
      }
    }

    // Update or create sprite
    let tileSprite = this.tileSprites.get(key);
    // Snow tiles are 88x44 (2x size), others are 44x22 - calculate scale accordingly
    const scale = textureKey.startsWith("snow_") ? 0.5 * 1.02 : 1.02;

    if (tileSprite) {
      tileSprite.setTexture(textureKey);
      tileSprite.setScale(scale);
    } else {
      tileSprite = this.add.image(screenPos.x, screenPos.y, textureKey);
      tileSprite.setOrigin(0.5, 0);
      tileSprite.setScale(scale);
      tileSprite.setDepth(this.depthFromSortPoint(screenPos.x, screenPos.y, 0));
      this.tileSprites.set(key, tileSprite);
    }
  }

  // Spawn a character
  spawnCharacter(): boolean {
    const roadTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tileType = this.grid[y][x].type;
        if (tileType === TileType.Road || tileType === TileType.Tile) {
          roadTiles.push({ x, y });
        }
      }
    }

    if (roadTiles.length === 0) return false;

    const roadTile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
    const characterTypes = [CharacterType.Banana, CharacterType.Apple];
    const randomCharacterType =
      characterTypes[Math.floor(Math.random() * characterTypes.length)];

    // Generate random daily budget
    const dailyBudget = MIN_DAILY_BUDGET + Math.floor(Math.random() * (MAX_DAILY_BUDGET - MIN_DAILY_BUDGET));

    const newCharacter: CharacterWithResidence = {
      id: generateId(),
      x: roadTile.x + 0.5,
      y: roadTile.y + 0.5,
      direction:
        allDirections[Math.floor(Math.random() * allDirections.length)],
      speed: CHARACTER_SPEED,
      characterType: randomCharacterType,
      state: "wandering",
      stuckCounter: 0,
      lastPosition: { x: roadTile.x, y: roadTile.y },
      name: generateRandomName(),
      money: dailyBudget, // Start with their daily budget
      dailyBudget,
      rentPaid: false,
    };

    this.characters.push(newCharacter);
    return true;
  }

  // Spawn a car
  spawnCar(): boolean {
    const asphaltTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (this.grid[y][x].type === TileType.Asphalt) {
          asphaltTiles.push({ x, y });
        }
      }
    }

    if (asphaltTiles.length === 0) return false;

    const asphaltTile =
      asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
    const validDirs = allDirections.filter((dir) => {
      const vec = directionVectors[dir];
      const nx = asphaltTile.x + vec.dx;
      const ny = asphaltTile.y + vec.dy;
      if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT)
        return false;
      return this.grid[ny][nx].type === TileType.Asphalt;
    });

    const laneDir = getLaneDirection(asphaltTile.x, asphaltTile.y, this.grid);
    let direction: Direction;

    if (laneDir && validDirs.includes(laneDir)) {
      direction = laneDir;
    } else if (validDirs.length > 0) {
      direction = validDirs[Math.floor(Math.random() * validDirs.length)];
    } else {
      direction =
        allDirections[Math.floor(Math.random() * allDirections.length)];
    }

    const carType = Math.random() < 0.5 ? CarType.Taxi : CarType.Jeep;

    const newCar: Car = {
      id: generateId(),
      x: asphaltTile.x + 0.5,
      y: asphaltTile.y + 0.5,
      direction,
      speed: CAR_SPEED + (Math.random() - 0.5) * 0.005,
      waiting: 0,
      carType,
    };

    this.cars.push(newCar);
    return true;
  }

  // Enable/disable driving mode
  setDrivingState(isDriving: boolean): void {
    this.isPlayerDriving = isDriving;
    this.pressedKeys.clear();

    if (isDriving && !this.playerCar) {
      // Spawn player car
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          if (this.grid[y][x].type === TileType.Asphalt) {
            asphaltTiles.push({ x, y });
          }
        }
      }

      if (asphaltTiles.length > 0) {
        const asphaltTile =
          asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
        this.playerCar = {
          id: "player-car",
          x: asphaltTile.x + 0.5,
          y: asphaltTile.y + 0.5,
          direction: Direction.Right,
          speed: CAR_SPEED * 1.5,
          waiting: 0,
          carType: CarType.Jeep,
        };
      }
    } else if (!isDriving) {
      this.playerCar = null;
    }
  }

  getPlayerCar(): Car | null {
    return this.playerCar;
  }

  isPlayerDrivingMode(): boolean {
    return this.isPlayerDriving;
  }

  getCharacterCount(): number {
    return this.characters.length;
  }

  getCarCount(): number {
    return this.cars.length;
  }

  clearCharacters(): void {
    // Clear building occupancy when clearing all characters
    this.buildingOccupancy.clear();
    this.characters = [];
    this.characterSprites.forEach((sprite) => sprite.destroy());
    this.characterSprites.clear();
  }

  clearCars(): void {
    this.cars = [];
    this.carSprites.forEach((sprite) => sprite.destroy());
    this.carSprites.clear();
    // Also clear player car if exists
    if (this.playerCar) {
      this.playerCar = null;
      this.isPlayerDriving = false;
    }
  }

  // Get citizen data by ID
  getCitizenData(citizenId: string): CharacterWithResidence | null {
    return this.characters.find((c) => c.id === citizenId) || null;
  }

  // Get all citizens data
  getAllCitizens(): CharacterWithResidence[] {
    return [...this.characters];
  }

  // Update citizen name
  updateCitizenName(citizenId: string, newName: string): void {
    const citizen = this.characters.find((c) => c.id === citizenId);
    if (citizen) {
      citizen.name = newName;
    }
  }

  // Update citizen money
  updateCitizenMoney(citizenId: string, amount: number): void {
    const citizen = this.characters.find((c) => c.id === citizenId);
    if (citizen) {
      citizen.money = amount;
    }
  }

  // Reset daily money for all citizens and wake up those resting at home
  resetDailyMoney(): void {
    for (const citizen of this.characters) {
      citizen.money = citizen.dailyBudget ?? MIN_DAILY_BUDGET;
      citizen.brokeUntilNextDay = false;
      
      // Wake up citizens who were resting at home
      if (citizen.state === "resting_at_home") {
        citizen.state = "wandering";
        // Position them at their home entrance
        if (citizen.residenceX !== undefined && citizen.residenceY !== undefined) {
          // Find a walkable tile near their home
          const adjacentTiles = this.getBuildingAdjacentTiles(
            citizen.residenceX,
            citizen.residenceY,
            this.grid[citizen.residenceY]?.[citizen.residenceX]?.buildingId || ""
          );
          if (adjacentTiles.length > 0) {
            const spawnTile = adjacentTiles[Math.floor(Math.random() * adjacentTiles.length)];
            citizen.x = spawnTile.x + 0.5;
            citizen.y = spawnTile.y + 0.5;
          }
        }
      }
    }
  }

  // Reset rent paid status for all citizens (called at start of month)
  resetRentStatus(): void {
    for (const citizen of this.characters) {
      citizen.rentPaid = false;
    }
  }

  // Process rent payment for a citizen
  // Returns: { paid: boolean, amount: number } or null if citizen not found
  processRentPayment(citizenId: string, rentAmount: number): { paid: boolean; amount: number } | null {
    const citizen = this.characters.find((c) => c.id === citizenId);
    if (!citizen) return null;

    const currentMoney = citizen.money ?? 0;
    if (currentMoney >= rentAmount) {
      citizen.money = currentMoney - rentAmount;
      citizen.rentPaid = true;
      return { paid: true, amount: rentAmount };
    }
    return { paid: false, amount: 0 };
  }

  // Evict a citizen from their residence
  evictCitizen(citizenId: string): boolean {
    const citizen = this.characters.find((c) => c.id === citizenId);
    if (!citizen || citizen.residenceX === undefined) return false;

    const buildingKey = `${citizen.residenceX},${citizen.residenceY}`;
    const residents = this.buildingOccupancy.get(buildingKey);
    if (residents) {
      const index = residents.indexOf(citizenId);
      if (index !== -1) {
        residents.splice(index, 1);
        this.buildingOccupancy.set(buildingKey, residents);
      }
    }

    citizen.residenceX = undefined;
    citizen.residenceY = undefined;
    citizen.rentPaid = false;
    citizen.state = "wandering";
    citizen.currentDestination = undefined;

    return true;
  }

  // Get residence building ID for a citizen
  getCitizenResidenceBuildingId(citizenId: string): string | undefined {
    const citizen = this.characters.find((c) => c.id === citizenId);
    if (!citizen || citizen.residenceX === undefined || citizen.residenceY === undefined) {
      return undefined;
    }
    const cell = this.grid[citizen.residenceY]?.[citizen.residenceX];
    return cell?.buildingId;
  }

  setSelectedTool(tool: ToolType): void {
    this.selectedTool = tool;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setSelectedBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setBuildingOrientation(orientation: Direction): void {
    this.buildingOrientation = orientation;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setZoom(zoom: number): void {
    // Skip if zoom was just handled by internal wheel handler
    if (this.zoomHandledInternally) {
      this.zoomHandledInternally = false;
      return;
    }

    if (this.isReady) {
      const camera = this.cameras.main;

      // Store the current center point (midPoint gives center of what camera sees)
      const centerX = camera.midPoint.x;
      const centerY = camera.midPoint.y;

      // Apply new zoom
      camera.setZoom(zoom);

      // Re-center on the same point, then round for pixel-perfect rendering
      camera.centerOn(centerX, centerY);
      camera.scrollX = Math.round(camera.scrollX);
      camera.scrollY = Math.round(camera.scrollY);

      // Update baseScroll so update() loop doesn't reset it
      this.baseScrollX = camera.scrollX;
      this.baseScrollY = camera.scrollY;
    }
    this.zoomLevel = zoom;
  }

  // Zoom towards a specific screen point (legacy method, now using handleWheel)
  zoomAtPoint(zoom: number, screenX: number, screenY: number): void {
    if (!this.isReady) {
      this.zoomLevel = zoom;
      return;
    }

    const camera = this.cameras.main;

    // Get world position under cursor before zoom
    const worldPoint = camera.getWorldPoint(screenX, screenY);

    // Apply new zoom
    camera.setZoom(zoom);

    // Update camera matrix
    camera.preRender();

    // Get new world position and adjust scroll
    const newWorldPoint = camera.getWorldPoint(screenX, screenY);
    camera.scrollX = Math.round(camera.scrollX - (newWorldPoint.x - worldPoint.x));
    camera.scrollY = Math.round(camera.scrollY - (newWorldPoint.y - worldPoint.y));

    // Update baseScroll so update() loop doesn't reset it
    this.baseScrollX = camera.scrollX;
    this.baseScrollY = camera.scrollY;

    this.zoomLevel = zoom;
  }

  setShowPaths(show: boolean): void {
    this.showPaths = show;
    if (this.isReady) {
      this.renderPathOverlay();
    }
  }

  setShowStats(show: boolean): void {
    this.showStats = show;
  }

  setGameSpeed(speed: GameSpeed): void {
    this.gameSpeed = speed;
  }

  getBuildingResidentCount(originX: number, originY: number): number {
    const buildingKey = `${originX},${originY}`;
    const residents = this.buildingOccupancy.get(buildingKey);
    return residents ? residents.length : 0;
  }

  // ============================================
  // RENDERING
  // ============================================

  private renderPathOverlay(): void {
    if (this.pathOverlaySprites) {
      this.pathOverlaySprites.destroy();
      this.pathOverlaySprites = null;
    }

    if (!this.showPaths) return;

    const graphics = this.add.graphics();
    graphics.setDepth(900_000);

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        const tileType = cell.type;
        let color: number | null = null;
        const alpha = 0.5;

        if (tileType === TileType.Road) {
          color = 0x4488ff;
        } else if (tileType === TileType.Tile) {
          color = 0x44dddd;
        } else if (tileType === TileType.Asphalt) {
          color = 0xffcc00;
        }

        if (color !== null) {
          const screenPos = this.gridToScreen(x, y);

          graphics.fillStyle(color, alpha);
          graphics.beginPath();
          graphics.moveTo(screenPos.x, screenPos.y);
          graphics.lineTo(
            screenPos.x + TILE_WIDTH / 2,
            screenPos.y + TILE_HEIGHT / 2
          );
          graphics.lineTo(screenPos.x, screenPos.y + TILE_HEIGHT);
          graphics.lineTo(
            screenPos.x - TILE_WIDTH / 2,
            screenPos.y + TILE_HEIGHT / 2
          );
          graphics.closePath();
          graphics.fillPath();
        }
      }
    }

    this.pathOverlaySprites = graphics;
  }

  private renderGrid(): void {
    // Initial full render
    this.tileSprites.forEach((sprite) => sprite.destroy());
    this.tileSprites.clear();
    this.buildingSprites.forEach((sprite) => sprite.destroy());
    this.buildingSprites.clear();
    this.glowSprites.forEach((sprite) => sprite.destroy());
    this.glowSprites.clear();

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        const screenPos = this.gridToScreen(x, y);
        const key = `${x},${y}`;

        let textureKey = "grass";

        if (cell.type === TileType.Road) {
          textureKey = "road";
        } else if (cell.type === TileType.Asphalt) {
          textureKey = "asphalt";
        } else if (cell.type === TileType.Tile) {
          textureKey = "road";
        } else if (cell.type === TileType.Snow) {
          textureKey = getSnowTextureKey(x, y);
        } else if (cell.type === TileType.Building) {
          if (cell.buildingId) {
            const building = getBuilding(cell.buildingId);
            const preservesTile =
              building &&
              (building.category === "props" || building.isDecoration);
            if (preservesTile && cell.underlyingTileType) {
              if (cell.underlyingTileType === TileType.Tile) {
                textureKey = "road";
              } else if (cell.underlyingTileType === TileType.Road) {
                textureKey = "road";
              } else if (cell.underlyingTileType === TileType.Asphalt) {
                textureKey = "asphalt";
              } else if (cell.underlyingTileType === TileType.Snow) {
                textureKey = getSnowTextureKey(x, y);
              } else {
                textureKey = "grass";
              }
            } else if (preservesTile) {
              textureKey = "grass";
            } else {
              textureKey = "road";
            }
          } else {
            textureKey = "road";
          }
        }

        const tileSprite = this.add.image(screenPos.x, screenPos.y, textureKey);
        tileSprite.setOrigin(0.5, 0);
        // Snow tiles are 88x44 (2x size), others are 44x22
        tileSprite.setScale(textureKey.startsWith("snow_") ? 0.5 * 1.02 : 1.02);
        tileSprite.setDepth(
          this.depthFromSortPoint(screenPos.x, screenPos.y, 0)
        );
        this.tileSprites.set(key, tileSprite);

        if (
          cell.type === TileType.Building &&
          cell.isOrigin &&
          cell.buildingId
        ) {
          this.renderBuilding(x, y, cell.buildingId, cell.buildingOrientation);
        }
      }
    }
  }

  // Remove a building and all its vertical slices (see renderBuilding for slice docs)
  // Buildings are stored as: "building_X,Y" (main) + "building_X,Y_s1", "_s2", etc. (slices)
  private removeBuildingSprites(buildingKey: string): void {
    // Remove main sprite
    const sprite = this.buildingSprites.get(buildingKey);
    if (sprite) {
      sprite.destroy();
      this.buildingSprites.delete(buildingKey);
    }

    // Remove all slices (up to 20 should be more than enough)
    for (let i = 1; i < 20; i++) {
      const sliceKey = `${buildingKey}_s${i}`;
      const sliceSprite = this.buildingSprites.get(sliceKey);
      if (sliceSprite) {
        sliceSprite.destroy();
        this.buildingSprites.delete(sliceKey);
      } else {
        break; // No more slices
      }
    }

    // Remove glow if exists
    const glow = this.glowSprites.get(buildingKey);
    if (glow) {
      glow.destroy();
      this.glowSprites.delete(buildingKey);
    }
  }

  private renderBuilding(
    originX: number,
    originY: number,
    buildingId: string,
    orientation?: Direction
  ): void {
    const building = getBuilding(buildingId);
    if (!building) {
      console.warn(`Building not found in registry: ${buildingId}`);
      return;
    }

    const key = `building_${originX},${originY}`;
    const textureKey = this.getBuildingTextureKey(building, orientation);

    if (!this.textures.exists(textureKey)) {
      console.warn(`Texture not found: ${textureKey}`);
      return;
    }

    // Get footprint based on orientation (for positioning)
    const footprint = getBuildingFootprint(building, orientation);
    // Get render size for slicing (use renderSize if available, else footprint)
    const renderSize = building.renderSize || footprint;
    const frontX = originX + footprint.width - 1;
    const frontY = originY + footprint.height - 1;
    const screenPos = this.gridToScreen(frontX, frontY);
    const bottomY = screenPos.y + TILE_HEIGHT;

    // Calculate tint for props (needed for each slice)
    let tint: number | null = null;
    if (buildingId === "flower-bush") {
      tint = 0xbbddbb;
    }

    // ========================================================================
    // DEPTH LAYER SYSTEM - Layer offsets for correct render ordering
    // ========================================================================
    //
    // Depth formula: sortY * 10000 + sortX + layerOffset
    //
    // Layer offsets control render order for items at the same grid position:
    //   0.00 - Ground tiles (grass, road, asphalt)
    //   0.04 - Lamp glow effects (behind lamps)
    //   0.05 - Buildings (regular structures)
    //   0.06 - Extended decorations (trees with foliage beyond footprint)
    //   0.10 - Cars
    //   0.20 - Characters
    //
    // FUTURE: When adding fences, traffic lights, etc., use this render order:
    //   1. Back-left fence   (layer ~0.03, before building)
    //   2. Back-right fence  (layer ~0.03, before building)
    //   3. Building          (layer 0.05)
    //   4. Props/trees       (layer 0.06)
    //   5. Front-left fence  (layer ~0.07, after building/props)
    //   6. Front-right fence (layer ~0.07, after building/props)
    //
    // FENCES: Determine which edge of the tile the fence is on (N, S, E, W)
    //   - Back edges (N, W in isometric) render BEFORE the building
    //   - Front edges (S, E in isometric) render AFTER the building
    //   - Use the tile's grid position for depth, with appropriate layer offset
    //
    // TRAFFIC LIGHTS: These are tricky because they overhang the road!
    //   - The pole sits on one tile (e.g., corner of intersection)
    //   - The overhang/light extends over an adjacent road tile
    //   - Cars need to pass UNDER the overhang, not behind it
    //
    //   Solution: Slice the traffic light into TWO parts with different depths:
    //   1. POLE portion: Use the pole's actual tile position for depth
    //      - Renders normally based on where it's planted
    //   2. OVERHANG portion: Use the ROAD tile's position for depth anchor
    //      - This makes cars on that road tile render BEHIND the overhang
    //      - The overhang slice depth = road tile's depth + small offset (~0.09)
    //      - Cars have layer 0.10, so they appear UNDER the light
    //
    //   Example: Traffic light at (5,5) with overhang over road at (6,5)
    //   - Pole slice: depth based on grid (5,5)
    //   - Overhang slice: depth based on grid (6,5) + 0.09 layer offset
    //   - Car on (6,5): depth based on grid (6,5) + 0.10 layer offset
    //   - Result: pole -> overhang -> car (overhang appears above car!)
    //
    // ========================================================================

    // Check if this is a decoration with visual extending beyond footprint (like trees)
    // For these, we use uniform depth for all slices to prevent clipping by adjacent buildings
    const isExtendedDecoration =
      building.isDecoration &&
      building.renderSize &&
      (building.renderSize.width > footprint.width ||
        building.renderSize.height > footprint.height);

    // Pre-calculate depth for extended decorations (trees with foliage beyond footprint)
    // Use footprint position + 1/4 the render extension as a balanced middle ground:
    // - Not too far back (would get clipped by nearby buildings)
    // - Not too far forward (would render over buildings in front)
    const extendX = (renderSize.width - footprint.width) / 4;
    const extendY = (renderSize.height - footprint.height) / 4;
    const balancedFrontX = frontX + extendX;
    const balancedFrontY = frontY + extendY;
    const balancedGridSum = balancedFrontX + balancedFrontY;
    const balancedScreenY = GRID_OFFSET_Y + (balancedGridSum * TILE_HEIGHT) / 2;
    const decorationDepth = this.depthFromSortPoint(
      screenPos.x,
      balancedScreenY + TILE_HEIGHT / 2,
      0.06
    );

    // ========================================================================
    // VERTICAL SLICE RENDERING FOR CORRECT ISOMETRIC DEPTH SORTING
    // ========================================================================
    //
    // Problem: In isometric view, a single building sprite can't have one depth
    // value because characters/props walking through the building's footprint
    // need to appear IN FRONT of some parts and BEHIND others.
    //
    // Solution: Slice the building sprite into vertical strips. Each strip
    // corresponds to one "diagonal" of tiles and gets its own depth value.
    //
    // Building sprites are 512x512 with the front corner at (256, 512).
    // Tiles are 44px wide in screen space, so each diagonal is 22px offset.
    //
    // For a 4x4 building (width=4, height=4), we create 8 slices:
    //   - 4 LEFT slices (for width): tiles going WEST from front corner
    //   - 4 RIGHT slices (for height): tiles going NORTH from front corner
    //
    //   Sprite layout (512px wide):
    //   ┌────────────────────────────────────────────────────────────────┐
    //   │                        BUILDING                                │
    //   │                                                                │
    //   │  ←── LEFT slices ──→│←── RIGHT slices ──→                     │
    //   │  (width tiles)      │ (height tiles)                          │
    //   │                     │                                          │
    //   │  srcX: 168 190 212 234 256 278 300 322                        │
    //   │        ↓   ↓   ↓   ↓   ↓   ↓   ↓   ↓                          │
    //   │        [4] [3] [2] [1] [1] [2] [3] [4]  ← depth offset        │
    //   │                     ↑                                          │
    //   │               FRONT CORNER (256)                               │
    //   └────────────────────────────────────────────────────────────────┘
    //
    // Depth: Each slice's depth = what it would be if a 1x1 tile existed there.
    // This allows characters to correctly interleave with building parts.
    // ========================================================================

    const SLICE_WIDTH = 22; // Half tile width - isometric diagonal offset
    const SPRITE_CENTER = 256; // Front corner X in sprite space
    const SPRITE_HEIGHT = 512;

    let sliceIndex = 0;

    // LEFT slices: cover tiles going WEST from front corner (decreasing grid X)
    // i=0 is closest to center (frontmost depth), i=width-1 is furthest left (backmost)
    // Use renderSize for slicing (visual size), not footprint (collision size)
    for (let i = 0; i < renderSize.width; i++) {
      const srcX = SPRITE_CENTER - (i + 1) * SLICE_WIDTH;

      const slice = this.add.image(screenPos.x, bottomY, textureKey);
      slice.setOrigin(0.5, 1);
      slice.setCrop(srcX, 0, SLICE_WIDTH, SPRITE_HEIGHT);

      if (tint !== null) {
        slice.setTint(tint);
      }

      // Depth: For extended decorations (like trees), use uniform footprint-based depth
      // to prevent clipping. For regular buildings, calculate per-slice depth.
      if (isExtendedDecoration) {
        slice.setDepth(decorationDepth);
      } else {
        // This slice represents tile column (frontX - i)
        // Frontmost tile in this column is at (frontX - i, frontY)
        // gridSum = (frontX - i) + frontY
        const sliceGridSum = frontX - i + frontY;
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * TILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + TILE_HEIGHT / 2,
            0.05
          )
        );
      }

      if (sliceIndex === 0) {
        this.buildingSprites.set(key, slice);
      } else {
        this.buildingSprites.set(`${key}_s${sliceIndex}`, slice);
      }
      sliceIndex++;
    }

    // RIGHT slices: cover tiles going NORTH from front corner (decreasing grid Y)
    // i=0 is at center (frontmost depth), i=height-1 is furthest right (backmost)
    // Use renderSize for slicing (visual size), not footprint (collision size)
    for (let i = 0; i < renderSize.height; i++) {
      const srcX = SPRITE_CENTER + i * SLICE_WIDTH;

      const slice = this.add.image(screenPos.x, bottomY, textureKey);
      slice.setOrigin(0.5, 1);
      slice.setCrop(srcX, 0, SLICE_WIDTH, SPRITE_HEIGHT);

      if (tint !== null) {
        slice.setTint(tint);
      }

      // Depth: For extended decorations (like trees), use uniform footprint-based depth
      // to prevent clipping. For regular buildings, calculate per-slice depth.
      if (isExtendedDecoration) {
        slice.setDepth(decorationDepth);
      } else {
        // This slice represents tile row (frontY - i)
        // Frontmost tile in this row is at (frontX, frontY - i)
        // gridSum = frontX + (frontY - i)
        const sliceGridSum = frontX + frontY - i;
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * TILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + TILE_HEIGHT / 2,
            0.05
          )
        );
      }

      this.buildingSprites.set(`${key}_s${sliceIndex}`, slice);
      sliceIndex++;
    }

    // Add glow effect for christmas lamps
    if (buildingId === "christmas-lamp") {
      this.addLampGlow(key, screenPos.x, screenPos.y);
    }
  }

  private addLampGlow(key: string, x: number, tileY: number): void {
    // Position glow at lampshade height (offset up from tile)
    const lampshadeOffsetY = -45; // Pixels above the tile base
    const glowY = tileY + TILE_HEIGHT / 2 + lampshadeOffsetY;

    // Create pixelated glow texture if it doesn't exist
    if (!this.textures.exists("lamp_glow")) {
      this.createPixelatedGlowTexture();
    }

    // Create glow sprite using the pixelated texture
    const glow = this.add.image(x, glowY, "lamp_glow");
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(this.depthFromSortPoint(x, tileY + TILE_HEIGHT / 2, 0.04)); // Just behind lamp

    // Add subtle pulsing animation
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.7, to: 1.0 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.glowSprites.set(key, glow);
  }

  private createPixelatedGlowTexture(): void {
    const size = 96; // Larger texture size
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Create pixelated rings with subtle fading opacity (from center out)
    const rings = [
      { radius: 6, alpha: 0.15 },
      { radius: 12, alpha: 0.12 },
      { radius: 20, alpha: 0.08 },
      { radius: 30, alpha: 0.05 },
      { radius: 40, alpha: 0.03 },
      { radius: 48, alpha: 0.015 },
    ];

    const centerX = size / 2;
    const centerY = size / 2;
    const glowColor = 0xffcc66; // Warm yellow-orange

    // Draw rings from outside in so inner ones overlap
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      graphics.fillStyle(glowColor, ring.alpha);

      // Draw pixelated diamond/square shape for isometric style
      const r = ring.radius;
      graphics.beginPath();
      graphics.moveTo(centerX, centerY - r); // Top
      graphics.lineTo(centerX + r, centerY); // Right
      graphics.lineTo(centerX, centerY + r); // Bottom
      graphics.lineTo(centerX - r, centerY); // Left
      graphics.closePath();
      graphics.fillPath();
    }

    // Generate texture from graphics
    graphics.generateTexture("lamp_glow", size, size);
    graphics.destroy();
  }

  private getBuildingTextureKey(
    building: BuildingDefinition,
    orientation?: Direction
  ): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Down]: "south",
      [Direction.Up]: "north",
      [Direction.Left]: "west",
      [Direction.Right]: "east",
    };

    const dir = orientation ? dirMap[orientation] : "south";

    if (building.sprites[dir as keyof typeof building.sprites]) {
      return `${building.id}_${dir}`;
    }

    if (building.sprites.south) {
      return `${building.id}_south`;
    }

    const firstDir = Object.keys(building.sprites)[0];
    return `${building.id}_${firstDir}`;
  }

  private renderCars(): void {
    // Get all cars to render (AI + player)
    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    const currentCarIds = new Set(allCars.map((c) => c.id));

    // Remove sprites for cars that no longer exist
    this.carSprites.forEach((sprite, id) => {
      if (!currentCarIds.has(id)) {
        sprite.destroy();
        this.carSprites.delete(id);
      }
    });

    // Update or create car sprites
    for (const car of allCars) {
      const screenPos = this.gridToScreen(car.x, car.y);
      const groundY = screenPos.y + TILE_HEIGHT / 2;
      const textureKey = this.getCarTextureKey(car.carType, car.direction);

      let sprite = this.carSprites.get(car.id);
      if (!sprite) {
        sprite = this.add.sprite(screenPos.x, groundY, textureKey);
        sprite.setOrigin(0.5, 1);
        this.carSprites.set(car.id, sprite);
      } else {
        sprite.setPosition(screenPos.x, groundY);
        sprite.setTexture(textureKey);
      }
      sprite.setDepth(this.depthFromSortPoint(screenPos.x, groundY, 0.1));
    }
  }

  private getCarTextureKey(carType: CarType, direction: Direction): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Up]: "n",
      [Direction.Down]: "s",
      [Direction.Left]: "w",
      [Direction.Right]: "e",
    };
    return `${carType}_${dirMap[direction]}`;
  }

  private renderCharacters(): void {
    const currentCharIds = new Set(this.characters.map((c) => c.id));
    this.characterSprites.forEach((sprite, id) => {
      if (!currentCharIds.has(id)) {
        sprite.destroy();
        this.characterSprites.delete(id);
      }
    });

    for (const char of this.characters) {
      const screenPos = this.gridToScreen(char.x, char.y);
      const centerY = screenPos.y + TILE_HEIGHT / 2;
      const textureKey = this.getCharacterTextureKey(
        char.characterType,
        char.direction
      );

      let sprite = this.characterSprites.get(char.id);
      if (!sprite) {
        if (this.gifsLoaded && this.textures.exists(textureKey)) {
          sprite = this.add.sprite(screenPos.x, centerY, textureKey, 0);
        } else {
          sprite = this.add.sprite(screenPos.x, centerY, "__DEFAULT");
          sprite.setVisible(false);
        }
        sprite.setOrigin(0.5, 1);
        this.characterSprites.set(char.id, sprite);
      } else {
        sprite.setPosition(screenPos.x, centerY);
      }

      // Hide citizens who are resting at home
      if (char.state === "resting_at_home") {
        sprite.setVisible(false);
        continue;
      }

      if (this.gifsLoaded && this.textures.exists(textureKey)) {
        sprite.setVisible(true);
        playGifAnimation(sprite, textureKey);
      }

      sprite.setDepth(this.depthFromSortPoint(screenPos.x, centerY, 0.2));
    }
  }

  private getCharacterTextureKey(
    charType: CharacterType,
    direction: Direction
  ): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Up]: "north",
      [Direction.Down]: "south",
      [Direction.Left]: "west",
      [Direction.Right]: "east",
    };
    return `${charType}_${dirMap[direction]}`;
  }

  private clearPreview(): void {
    this.previewSprites.forEach((s) => s.destroy());
    this.previewSprites = [];
    this.lotPreviewSprites.forEach((s) => s.destroy());
    this.lotPreviewSprites = [];
  }

  private updatePreview(): void {
    this.clearPreview();

    if (!this.hoverTile) return;
    if (this.selectedTool === ToolType.None) return;

    const { x, y } = this.hoverTile;

    if (this.selectedTool === ToolType.RoadNetwork) {
      // Get segments to preview - either drag set or just hover segment
      const segmentsToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        // When dragging, show preview for all segments in drag set
        this.dragTiles.forEach((key) => {
          const [segX, segY] = key.split(",").map(Number);
          segmentsToPreview.push({ x: segX, y: segY });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        // Single hover - show preview for hovered segment
        const segmentOrigin = getRoadSegmentOrigin(x, y);
        segmentsToPreview.push({ x: segmentOrigin.x, y: segmentOrigin.y });
      }

      for (const seg of segmentsToPreview) {
        const segmentOrigin = { x: seg.x, y: seg.y };
        const placementCheck = canPlaceRoadSegment(
          this.grid,
          segmentOrigin.x,
          segmentOrigin.y
        );
        const segmentHasCollision = !placementCheck.valid;

        const tempGrid: GridCell[][] = this.grid.map((row) =>
          row.map((cell) => ({ ...cell }))
        );

        for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
            const px = segmentOrigin.x + dx;
            const py = segmentOrigin.y + dy;
            if (px < GRID_WIDTH && py < GRID_HEIGHT) {
              tempGrid[py][px].isOrigin = dx === 0 && dy === 0;
              tempGrid[py][px].originX = segmentOrigin.x;
              tempGrid[py][px].originY = segmentOrigin.y;
              tempGrid[py][px].type = TileType.Road;
            }
          }
        }

        const connections = getRoadConnections(
          tempGrid,
          segmentOrigin.x,
          segmentOrigin.y
        );
        const segmentType = getSegmentType(connections);
        const pattern = generateRoadPattern(segmentType);

        for (const tile of pattern) {
          const px = segmentOrigin.x + tile.dx;
          const py = segmentOrigin.y + tile.dy;
          if (px < GRID_WIDTH && py < GRID_HEIGHT) {
            const screenPos = this.gridToScreen(px, py);
            const textureKey =
              tile.type === TileType.Asphalt ? "asphalt" : "road";
            const preview = this.add.image(
              screenPos.x,
              screenPos.y,
              textureKey
            );
            preview.setOrigin(0.5, 0);
            preview.setAlpha(segmentHasCollision ? 0.3 : 0.7);
            if (segmentHasCollision) preview.setTint(0xff0000);
            preview.setDepth(
              this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(preview);
          }
        }
      }
    } else if (this.selectedTool === ToolType.Tile) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing tile on grass, snow, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Snow
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(screenPos.x, screenPos.y, "road");
          preview.setOrigin(0.5, 0);
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (this.selectedTool === ToolType.Asphalt) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing asphalt on grass, snow, tile, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Snow &&
              cell.type !== TileType.Tile
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(screenPos.x, screenPos.y, "asphalt");
          preview.setOrigin(0.5, 0);
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (this.selectedTool === ToolType.Snow) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing snow on grass, tile, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Tile
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(
            screenPos.x,
            screenPos.y,
            getSnowTextureKey(tx, ty)
          );
          preview.setOrigin(0.5, 0);
          preview.setScale(0.5); // Snow tiles are 88x44, need to halve
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (
      this.selectedTool === ToolType.Building &&
      this.selectedBuildingId
    ) {
      const building = getBuilding(this.selectedBuildingId);
      if (!building) return;

      // Get footprint based on current orientation
      const footprint = getBuildingFootprint(
        building,
        this.buildingOrientation
      );
      const originX = x - footprint.width + 1;
      const originY = y - footprint.height + 1;

      const isDecoration =
        building.category === "props" || building.isDecoration;
      let footprintCollision = false;
      for (let dy = 0; dy < footprint.height; dy++) {
        for (let dx = 0; dx < footprint.width; dx++) {
          const tileX = originX + dx;
          const tileY = originY + dy;
          if (
            tileX < 0 ||
            tileY < 0 ||
            tileX >= GRID_WIDTH ||
            tileY >= GRID_HEIGHT
          ) {
            footprintCollision = true;
          } else {
            const cell = this.grid[tileY]?.[tileX];
            if (cell) {
              const cellType = cell.type;
              if (isDecoration) {
                // Props/decorations collide with any building (including other props)
                if (cellType === TileType.Building) {
                  footprintCollision = true;
                } else if (
                  cellType !== TileType.Grass &&
                  cellType !== TileType.Tile &&
                  cellType !== TileType.Snow
                ) {
                  footprintCollision = true;
                }
              } else {
                if (cellType !== TileType.Grass) {
                  footprintCollision = true;
                }
              }
            }
          }
        }
      }

      // Only show lot tiles for non-decorative buildings (decorations preserve underlying tile)
      if (!isDecoration) {
        for (let dy = 0; dy < footprint.height; dy++) {
          for (let dx = 0; dx < footprint.width; dx++) {
            const tileX = originX + dx;
            const tileY = originY + dy;
            if (
              tileX >= 0 &&
              tileY >= 0 &&
              tileX < GRID_WIDTH &&
              tileY < GRID_HEIGHT
            ) {
              const screenPos = this.gridToScreen(tileX, tileY);
              const lotTile = this.add.image(screenPos.x, screenPos.y, "road");
              lotTile.setOrigin(0.5, 0);
              lotTile.setAlpha(footprintCollision ? 0.3 : 0.5);
              if (footprintCollision) lotTile.setTint(0xff0000);
              lotTile.setDepth(
                this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
              );
              this.previewSprites.push(lotTile);
            }
          }
        }
      }

      // Always show building preview, but tint red if collision
      const textureKey = this.getBuildingTextureKey(
        building,
        this.buildingOrientation
      );
      if (this.textures.exists(textureKey)) {
        const frontX = originX + footprint.width - 1;
        const frontY = originY + footprint.height - 1;
        const screenPos = this.gridToScreen(frontX, frontY);
        const bottomY = screenPos.y + TILE_HEIGHT;
        const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

        const buildingPreview = this.add.image(
          screenPos.x,
          bottomY,
          textureKey
        );
        buildingPreview.setOrigin(0.5, 1);
        buildingPreview.setAlpha(0.7);

        // Apply red tint if collision, otherwise apply prop tints
        if (footprintCollision) {
          buildingPreview.setTint(0xff0000); // Red tint for invalid placement
        } else if (this.selectedBuildingId === "flower-bush") {
          buildingPreview.setTint(0xbbddbb);
        }

        buildingPreview.setDepth(
          this.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
        );
        this.previewSprites.push(buildingPreview);
      }
    } else if (this.selectedTool === ToolType.Eraser) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else {
        tilesToPreview.push({ x, y });
      }

      // Track which tiles we've already shown preview for (to avoid duplicates)
      const previewedTiles = new Set<string>();

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx < 0 || tx >= GRID_WIDTH || ty < 0 || ty >= GRID_HEIGHT) continue;

        const cell = this.grid[ty]?.[tx];

        if (!cell || cell.type === TileType.Grass) {
          // Show faded red grass for empty tiles
          if (!previewedTiles.has(`${tx},${ty}`)) {
            previewedTiles.add(`${tx},${ty}`);
            const screenPos = this.gridToScreen(tx, ty);
            const preview = this.add.image(screenPos.x, screenPos.y, "grass");
            preview.setOrigin(0.5, 0);
            preview.setAlpha(0.3);
            preview.setTint(0xff0000);
            preview.setDepth(
              this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(preview);
          }
        } else {
          // For non-grass tiles, show the whole object (building/road segment)
          const originX = cell.originX ?? tx;
          const originY = cell.originY ?? ty;
          const cellType = cell.type;

          // Check if this is a road segment
          const isRoadSegment =
            originX % ROAD_SEGMENT_SIZE === 0 &&
            originY % ROAD_SEGMENT_SIZE === 0 &&
            (cellType === TileType.Road || cellType === TileType.Asphalt);

          if (isRoadSegment) {
            // Show entire road segment
            for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                const px = originX + dx;
                const py = originY + dy;
                if (
                  px < GRID_WIDTH &&
                  py < GRID_HEIGHT &&
                  !previewedTiles.has(`${px},${py}`)
                ) {
                  previewedTiles.add(`${px},${py}`);
                  const tileCell = this.grid[py]?.[px];
                  if (tileCell && tileCell.type !== TileType.Grass) {
                    const screenPos = this.gridToScreen(px, py);
                    const textureKey =
                      tileCell.type === TileType.Asphalt ? "asphalt" : "road";
                    const preview = this.add.image(
                      screenPos.x,
                      screenPos.y,
                      textureKey
                    );
                    preview.setOrigin(0.5, 0);
                    preview.setAlpha(0.7);
                    preview.setTint(0xff0000);
                    preview.setDepth(
                      this.depthFromSortPoint(
                        screenPos.x,
                        screenPos.y,
                        1_000_000
                      )
                    );
                    this.previewSprites.push(preview);
                  }
                }
              }
            }
          } else if (cellType === TileType.Building && cell.buildingId) {
            // Show entire building footprint
            const building = getBuilding(cell.buildingId);
            if (!building) continue;

            const footprint = getBuildingFootprint(
              building,
              cell.buildingOrientation
            );
            const buildingKey = `building_${originX},${originY}`;

            if (!previewedTiles.has(buildingKey)) {
              previewedTiles.add(buildingKey);

              for (let dy = 0; dy < footprint.height; dy++) {
                for (let dx = 0; dx < footprint.width; dx++) {
                  const px = originX + dx;
                  const py = originY + dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    previewedTiles.add(`${px},${py}`);
                    const screenPos = this.gridToScreen(px, py);
                    const preview = this.add.image(
                      screenPos.x,
                      screenPos.y,
                      "road"
                    );
                    preview.setOrigin(0.5, 0);
                    preview.setAlpha(0.7);
                    preview.setTint(0xff0000);
                    preview.setDepth(
                      this.depthFromSortPoint(
                        screenPos.x,
                        screenPos.y,
                        1_000_000
                      )
                    );
                    this.previewSprites.push(preview);
                  }
                }
              }

              // Show building sprite in red
              const textureKey = this.getBuildingTextureKey(
                building,
                cell.buildingOrientation
              );
              if (this.textures.exists(textureKey)) {
                const frontX = originX + footprint.width - 1;
                const frontY = originY + footprint.height - 1;
                const screenPos = this.gridToScreen(frontX, frontY);
                const bottomY = screenPos.y + TILE_HEIGHT;
                const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

                const buildingPreview = this.add.image(
                  screenPos.x,
                  bottomY,
                  textureKey
                );
                buildingPreview.setOrigin(0.5, 1);
                buildingPreview.setAlpha(0.7);
                buildingPreview.setTint(0xff0000);
                buildingPreview.setDepth(
                  this.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
                );
                this.previewSprites.push(buildingPreview);
              }
            }
          } else {
            // Show single tile (snow, tile, etc.)
            if (!previewedTiles.has(`${tx},${ty}`)) {
              previewedTiles.add(`${tx},${ty}`);
              const screenPos = this.gridToScreen(tx, ty);
              let textureKey = "grass";
              if (cellType === TileType.Asphalt) textureKey = "asphalt";
              else if (cellType === TileType.Road || cellType === TileType.Tile)
                textureKey = "road";
              else if (cellType === TileType.Snow)
                textureKey = getSnowTextureKey(tx, ty);
              const preview = this.add.image(
                screenPos.x,
                screenPos.y,
                textureKey
              );
              preview.setOrigin(0.5, 0);
              // Snow tiles are 88x44, need to halve
              if (textureKey.startsWith("snow_")) preview.setScale(0.5);
              preview.setAlpha(0.7);
              preview.setTint(0xff0000);
              preview.setDepth(
                this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
              );
              this.previewSprites.push(preview);
            }
          }
        }
      }
    }
  }
}
