import Phaser from "phaser";
import {
  GridCell,
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
  GameTime,
  CharacterWithResidence,
  MoodletType,
  TaxiState,
  TAXIS_PER_CITIZEN,
  TAXI_FLEET_CHECK_INTERVAL,
} from "../types";
import { GRID_OFFSET_X, GRID_OFFSET_Y } from "./gameConfig";
import {
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  hasRoadSegment,
} from "../roadUtils";
import {
  BUILDINGS,
  getBuilding,
  getBuildingEconomics,
} from "@/app/data/buildings";
import { loadGifAsAnimation, playGifAnimation } from "./GifLoader";
import { directionVectors, oppositeDirection, allDirections } from "./utils/directions";
import {
  MIN_DAILY_BUDGET,
  MAX_DAILY_BUDGET,
  generateId,
  generateRandomName,
  getSnowTextureKey,
  DEPTH_Y_MULT,
  CAMERA_SPEED,
  ZOOM_LEVELS,
} from "./utils/constants";
import { PathfindingSystem } from "./systems/PathfindingSystem";
import { CarAISystem } from "./systems/CarAISystem";
import { CitizenAISystem, CitizenAIContext } from "./systems/CitizenAISystem";
import { PreviewSystem } from "./systems/PreviewSystem";
import { BuildingRenderSystem } from "./systems/BuildingRenderSystem";

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
  onTaxiFare?: (citizenId: string, fare: number) => void;
}

export class MainScene extends Phaser.Scene {
  // Subsystems
  readonly pathfinding = new PathfindingSystem();
  readonly carAI = new CarAISystem(this.pathfinding);
  readonly citizenAI = new CitizenAISystem(this.pathfinding);
  readonly previewSystem = new PreviewSystem();
  readonly buildingRenderer = new BuildingRenderSystem();

  // Depth scaling for stable painter's algorithm ordering
  private readonly DEPTH_Y_MULT = DEPTH_Y_MULT;

  // Sprite containers
  private tileSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  // Building sprites now managed by buildingRenderer system
  // Access via: this.buildingRenderer.buildingSprites / this.buildingRenderer.glowSprites
  private carSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private characterSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();

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
  getIsReady(): boolean { return this.isReady; }

  // GIF animations loaded flag
  private gifsLoaded: boolean = false;

  // Debug: show walkable paths
  private showPaths: boolean = false;
  private pathOverlaySprites: Phaser.GameObjects.Graphics | null = null;

  // Driving mode state
  private isPlayerDriving: boolean = false;
  private playerCar: Car | null = null;
  private pressedKeys: Set<string> = new Set();

  // Taxi fleet management
  private taxiFleetCheckCounter: number = 0;
  private taxiIndicators: Map<string, Phaser.GameObjects.Text> = new Map();

  // Keyboard controls
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private readonly CAMERA_SPEED = CAMERA_SPEED;

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

  // Current game time (synced from React)
  private currentGameTime: GameTime | null = null;

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
    this.pathfinding.setGrid(this.grid);
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

    // Manage taxi fleet size (skip when paused)
    if (this.gameSpeed !== GameSpeed.Paused) {
      this.taxiFleetCheckCounter++;
      if (this.taxiFleetCheckCounter >= TAXI_FLEET_CHECK_INTERVAL) {
        this.taxiFleetCheckCounter = 0;
        this.manageTaxiFleet();
      }
    }

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

  private getCitizenAIContext(): CitizenAIContext {
    return {
      grid: this.grid,
      gameSpeed: this.gameSpeed,
      currentGameTime: this.currentGameTime,
      buildingOccupancy: this.buildingOccupancy,
      onBuildingInteraction: this.events_.onBuildingInteraction,
      onCitizenSpend: this.events_.onCitizenSpend,
    };
  }

  private updateCharacters(): void {
    this.removeCitizensWhoLeft();
    const ctx = this.getCitizenAIContext();
    for (let i = 0; i < this.characters.length; i++) {
      this.characters[i] = this.citizenAI.updateSingleCharacter(this.characters[i], ctx);
    }
  }

  // Delegate walkability/direction methods to pathfinding system
  private isWalkable(x: number, y: number, allowGrass: boolean = false): boolean {
    return this.pathfinding.isWalkable(x, y, allowGrass);
  }

  private isSidewalk(x: number, y: number): boolean {
    return this.pathfinding.isSidewalk(x, y);
  }

  private getWalkCost(x: number, y: number): number {
    return this.pathfinding.getWalkCost(x, y);
  }

  private getValidDirections(tileX: number, tileY: number, preferSidewalks: boolean = true, allowGrass: boolean = false): Direction[] {
    return this.pathfinding.getValidDirections(tileX, tileY, preferSidewalks, allowGrass);
  }

  private pickNewDirection(tileX: number, tileY: number, currentDir: Direction): Direction | null {
    return this.pathfinding.pickNewDirection(tileX, tileY, currentDir);
  }

  // Delegate building/pathfinding methods to pathfinding system
  private findNearbyBuildings(charX: number, charY: number, maxDistance: number = 10) {
    return this.pathfinding.findNearbyBuildings(charX, charY, maxDistance);
  }

  private getBuildingAdjacentTiles(buildingOriginX: number, buildingOriginY: number, buildingId: string) {
    return this.pathfinding.getBuildingAdjacentTiles(buildingOriginX, buildingOriginY, buildingId);
  }

  private getBuildingAccessTile(buildingOriginX: number, buildingOriginY: number, buildingId: string, fromX?: number, fromY?: number) {
    return this.pathfinding.getBuildingAccessTile(buildingOriginX, buildingOriginY, buildingId, fromX, fromY);
  }

  private canReachTarget(startX: number, startY: number, targetX: number, targetY: number, maxSteps: number = 150): boolean {
    return this.pathfinding.canReachTarget(startX, startY, targetX, targetY, maxSteps);
  }

  private canReachAnyTarget(startX: number, startY: number, targets: Array<{ x: number; y: number }>, maxSteps: number = 150) {
    return this.pathfinding.canReachAnyTarget(startX, startY, targets, maxSteps);
  }

  private findPathToTarget(startX: number, startY: number, targetX: number, targetY: number, maxSteps: number = 200, allowGrass: boolean = false): Direction | null {
    return this.pathfinding.findPathToTarget(startX, startY, targetX, targetY, maxSteps, allowGrass);
  }

  private computeFullPath(startX: number, startY: number, targetX: number, targetY: number, maxSteps: number = 200, allowGrass: boolean = false): Direction[] | null {
    return this.pathfinding.computeFullPath(startX, startY, targetX, targetY, maxSteps, allowGrass);
  }

  private findPathBFS(startX: number, startY: number, targetX: number, targetY: number, maxSteps: number, sidewalksOnly: boolean): Direction | null {
    return this.pathfinding.findPathBFS(startX, startY, targetX, targetY, maxSteps, sidewalksOnly);
  }

  private findPathToAnyTarget(startX: number, startY: number, targets: Array<{ x: number; y: number }>, maxSteps: number = 150) {
    return this.pathfinding.findPathToAnyTarget(startX, startY, targets, maxSteps);
  }

  private moveTowardsTargetGreedy(charTileX: number, charTileY: number, targetX: number, targetY: number): Direction | null {
    return this.pathfinding.moveTowardsTargetGreedy(charTileX, charTileY, targetX, targetY);
  }

  private moveTowardsTarget(char: CharacterWithResidence, targetX: number, targetY: number, allowGrass: boolean = false): Direction | null {
    return this.pathfinding.moveTowardsTarget(char, targetX, targetY, allowGrass);
  }

  private moveTowardsTargetGreedyWithGrass(charTileX: number, charTileY: number, targetX: number, targetY: number): Direction | null {
    return this.pathfinding.moveTowardsTargetGreedyWithGrass(charTileX, charTileY, targetX, targetY);
  }

  // Debug pathfinding - delegates to pathfinding system
  private get debugPathfinding(): boolean { return this.pathfinding.debugPathfinding; }
  private get debugLogCounter(): number { return this.pathfinding.debugLogCounter; }

  private debugLog(charId: string, ...args: unknown[]): void {
    this.pathfinding.debugLog(charId, ...args);
  }

  // ============================================
  // CAR LOGIC (moved from React)
  // ============================================

  private updateCars(): void {
    // Clean up phasing pairs where cars have separated
    this.carAI.cleanupPhasingPairs(this.cars, this.playerCar);

    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i] = this.carAI.updateSingleCar(
        this.cars[i], this.cars, this.playerCar, this.grid, this.gameSpeed, this.characters
      );
    }
    // Sync taxi passenger positions
    this.syncTaxiPassengers();
  }

  private syncTaxiPassengers(): void {
    for (const car of this.cars) {
      if (car.carType === CarType.Taxi && car.taxiState === TaxiState.Transporting && car.passengerId) {
        const passenger = this.characters.find(c => c.id === car.passengerId);
        if (passenger) {
          passenger.x = car.x;
          passenger.y = car.y;
          passenger.direction = car.direction;
        }
      }
    }
  }

  private manageTaxiFleet(): void {
    // TODO: Re-enable Jeeps once they have a gameplay purpose (e.g., player-spawned cars, delivery trucks)
    // For now, auto-despawn any Jeeps to reduce road congestion — only taxis should be on the road
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.carType === CarType.Jeep) {
        const sprite = this.carSprites.get(car.id);
        if (sprite) {
          sprite.destroy();
          this.carSprites.delete(car.id);
        }
        this.cars.splice(i, 1);
      }
    }

    const citizenCount = this.characters.length;
    const desiredTaxiCount = Math.floor(citizenCount / TAXIS_PER_CITIZEN);

    const currentTaxis = this.cars.filter(c => c.carType === CarType.Taxi);
    const currentTaxiCount = currentTaxis.length;

    if (currentTaxiCount < desiredTaxiCount) {
      // Spawn more taxis
      const toSpawn = desiredTaxiCount - currentTaxiCount;
      for (let i = 0; i < toSpawn; i++) {
        this.spawnTaxi();
      }
    } else if (currentTaxiCount > desiredTaxiCount) {
      // Remove excess taxis (only cruising ones, never ones with passengers)
      const toRemove = currentTaxiCount - desiredTaxiCount;
      let removed = 0;
      for (let i = this.cars.length - 1; i >= 0 && removed < toRemove; i--) {
        const car = this.cars[i];
        if (car.carType === CarType.Taxi && car.taxiState === TaxiState.Cruising) {
          const sprite = this.carSprites.get(car.id);
          if (sprite) {
            sprite.destroy();
            this.carSprites.delete(car.id);
          }
          // Clean up indicator
          const indicator = this.taxiIndicators.get(car.id);
          if (indicator) {
            indicator.destroy();
            this.taxiIndicators.delete(car.id);
          }
          this.cars.splice(i, 1);
          removed++;
        }
      }
    }
  }

  private spawnTaxi(): boolean {
    const newCar = this.carAI.spawnCar(this.grid);
    if (!newCar) return false;
    newCar.carType = CarType.Taxi;
    newCar.taxiState = TaxiState.Cruising;
    this.cars.push(newCar);
    return true;
  }

  private isDrivable(x: number, y: number): boolean {
    return this.pathfinding.isDrivable(x, y);
  }

  private getValidCarDirections(tileX: number, tileY: number): Direction[] {
    return this.pathfinding.getValidCarDirections(tileX, tileY);
  }

  private updatePlayerCar(): void {
    if (!this.isPlayerDriving || !this.playerCar) return;
    this.playerCar = this.carAI.updatePlayerCar(
      this.playerCar, this.pressedKeys, this.cars, this.characters, this.grid
    );
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

  depthFromSortPoint(
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

  // Smooth scroll wheel zoom constants
  private static readonly MIN_ZOOM = ZOOM_LEVELS[0]; // 0.25
  private static readonly MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]; // 4
  private static readonly ZOOM_SENSITIVITY = 0.001; // Multiplier for smooth zoom per wheel delta pixel

  // Handle mouse wheel zoom - smooth continuous zoom with anchor-based positioning
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
    const currentZoom = camera.zoom;

    // Smooth zoom: multiply current zoom by a factor based on scroll delta
    // deltaY > 0 = scroll down = zoom out, deltaY < 0 = scroll up = zoom in
    const zoomFactor = 1 - deltaY * MainScene.ZOOM_SENSITIVITY;
    let newZoom = currentZoom * zoomFactor;

    // Clamp to min/max zoom range
    newZoom = Math.max(MainScene.MIN_ZOOM, Math.min(MainScene.MAX_ZOOM, newZoom));

    // Skip if zoom didn't change meaningfully
    if (Math.abs(newZoom - currentZoom) < 0.001) return;

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
    // Wire taxi fare callback from CarAISystem to React
    this.carAI.onTaxiFare = (citizenId: string, fare: number) => {
      this.events_.onTaxiFare?.(citizenId, fare);
    };
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

    // Update grid reference (both MainScene and pathfinding system)
    this.grid = newGrid;
    this.pathfinding.setGrid(newGrid);

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
        this.buildingRenderer.buildingSprites.has(oldBuildingKey) &&
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
      this.buildingRenderer.removeBuildingSprites(key);
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
        this.buildingRenderer.removeBuildingSprites(buildingKey);
        this.buildingRenderer.renderBuilding(this, x, y, cell.buildingId, cell.buildingOrientation);
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
      // Initialize needs tracking
      lastFoodTime: 12, // Start having eaten at noon
      ateToday: true,
      entertainedToday: false,
      moodlet: null,
      moodletReason: "",
      previousMoodlet: null,
      // New citizens arrive as tourists with a 7-day grace period
      isTourist: true,
      touristArrivalDay: this.currentGameTime?.day ?? 1,
      touristArrivalMonth: this.currentGameTime?.month ?? 1,
      willLeaveAtMonthEnd: false,
      homelessSince: undefined,
    };

    this.characters.push(newCharacter);
    return true;
  }

  // Spawn a car
  spawnCar(): boolean {
    const newCar = this.carAI.spawnCar(this.grid);
    if (!newCar) return false;
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
    // Only count non-taxi cars for save/load — taxis are auto-managed by fleet system
    return this.cars.filter(c => c.carType !== CarType.Taxi).length;
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
    this.taxiIndicators.forEach((indicator) => indicator.destroy());
    this.taxiIndicators.clear();
    // Also clear player car if exists
    if (this.playerCar) {
      this.playerCar = null;
      this.isPlayerDriving = false;
    }
  }

  /**
   * Eject all taxi passengers before saving, so save data is clean.
   * Citizens are placed on nearest sidewalk and restored to their pre-taxi state.
   */
  prepareForSave(): void {
    for (const car of this.cars) {
      if (car.carType === CarType.Taxi && car.passengerId) {
        const passenger = this.characters.find(c => c.id === car.passengerId);
        if (passenger && passenger.state === "in_taxi") {
          // Restore citizen state
          passenger.state = passenger.preTaxiState || "wandering";
          passenger.currentDestination = passenger.preTaxiDestination;
          passenger.preTaxiState = undefined;
          passenger.preTaxiDestination = undefined;
          passenger.taxiId = undefined;
          passenger.cachedPath = undefined;
          passenger.pathIndex = undefined;
          passenger.lastPathTile = undefined;
          // Place on nearest sidewalk
          const sidewalk = this.pathfinding.findNearestSidewalkTile(
            Math.floor(car.x), Math.floor(car.y)
          );
          if (sidewalk) {
            passenger.x = sidewalk.x + 0.5;
            passenger.y = sidewalk.y + 0.5;
          }
        }
        // Reset taxi state
        car.passengerId = undefined;
        car.taxiState = TaxiState.Cruising;
        car.pickupTarget = undefined;
        car.dropoffTarget = undefined;
        car.cachedCarPath = undefined;
        car.carPathIndex = undefined;
        car.lastCarPathTile = undefined;
      }
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
      
      // Reset daily flags (ateToday, entertainedToday) — frame counters continue tracking
      citizen.ateToday = false;
      citizen.entertainedToday = false;
      (citizen as any).framesSinceLastFood = (citizen as any).framesSinceLastFood || 0; // Keep tracking
      (citizen as any).framesSinceLastEntertainment = (citizen as any).framesSinceLastEntertainment || 0; // Keep tracking

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
  
  // Mark homeless citizens to start leaving at end of month
  // Returns number of citizens marked to leave
  removeHomelessCitizens(): number {
    let count = 0;
    
    for (const citizen of this.characters) {
      if (citizen.willLeaveAtMonthEnd && !citizen.residenceX && citizen.state !== "leaving_city") {
        // Find the closest map edge
        const edgeTarget = this.findClosestMapEdge(citizen.x, citizen.y);
        if (edgeTarget) {
          citizen.state = "leaving_city";
          citizen.currentDestination = {
            x: edgeTarget.x,
            y: edgeTarget.y,
          };
          count++;
        }
      }
    }
    
    return count;
  }

  // Remove tourists whose 7-day grace period has expired without finding housing
  // Some tourists (25% chance) stay as homeless citizens instead of leaving
  removeTourists(): { leaving: number; becameHomeless: number } {
    if (!this.currentGameTime) return { leaving: 0, becameHomeless: 0 };

    let leaving = 0;
    let becameHomeless = 0;
    const currentDay = this.currentGameTime.day;
    const currentMonth = this.currentGameTime.month;
    const STAY_CHANCE = 0.25;

    for (const citizen of this.characters) {
      if (!citizen.isTourist || citizen.residenceX !== undefined || citizen.state === "leaving_city") continue;

      // Calculate days since arrival
      const arrivalDay = citizen.touristArrivalDay ?? 1;
      const arrivalMonth = citizen.touristArrivalMonth ?? currentMonth;
      let daysSinceArrival: number;

      if (currentMonth === arrivalMonth) {
        daysSinceArrival = currentDay - arrivalDay;
      } else {
        // Crossed month boundary - calculate days from arrival to end of that month + days in current month
        const daysInArrivalMonth = new Date(this.currentGameTime.year, arrivalMonth, 0).getDate();
        daysSinceArrival = (daysInArrivalMonth - arrivalDay) + currentDay;
      }

      if (daysSinceArrival >= 7) {
        // Grace period expired - no longer a tourist
        citizen.isTourist = false;

        if (Math.random() < STAY_CHANCE) {
          // Tourist decides to stay as a homeless citizen
          citizen.willLeaveAtMonthEnd = true;
          citizen.homelessSince = currentMonth;
          becameHomeless++;
        } else {
          // Tourist leaves the city
          citizen.willLeaveAtMonthEnd = true;
          const edgeTarget = this.findClosestMapEdge(citizen.x, citizen.y);
          if (edgeTarget) {
            citizen.state = "leaving_city";
            citizen.currentDestination = {
              x: edgeTarget.x,
              y: edgeTarget.y,
            };
            leaving++;
          }
        }
      }
    }

    return { leaving, becameHomeless };
  }

  private findClosestMapEdge(charX: number, charY: number): { x: number; y: number } | null {
    return this.pathfinding.findClosestMapEdge(charX, charY);
  }

  private checkCitizenReachedEdge(char: CharacterWithResidence): boolean {
    return this.pathfinding.checkCitizenReachedEdge(char);
  }
  
  // Remove citizens who have left the map
  private removeCitizensWhoLeft(): number {
    const citizensToRemove: string[] = [];
    
    for (const citizen of this.characters) {
      if (citizen.state === "leaving_city" && this.checkCitizenReachedEdge(citizen)) {
        citizensToRemove.push(citizen.id);
      }
    }
    
    // Remove citizens who reached the edge
    for (const id of citizensToRemove) {
      const index = this.characters.findIndex((c) => c.id === id);
      if (index !== -1) {
        // Remove sprite
        const sprite = this.characterSprites.get(id);
        if (sprite) {
          sprite.destroy();
          this.characterSprites.delete(id);
        }
        
        // Remove character
        this.characters.splice(index, 1);
      }
    }
    
    return citizensToRemove.length;
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

  setGameTime(time: GameTime): void {
    this.currentGameTime = time;
  }

  setDayNightState(state: { skyColor: string; glowIntensity: number; phase: string }): void {
    // Update Phaser background color (sky)
    if (this.isReady) {
      const hexNum = parseInt(state.skyColor.replace("#", ""), 16);
      this.cameras.main.setBackgroundColor(hexNum);
    }

    // Update glow intensity on all building glow sprites
    this.buildingRenderer.setGlowIntensity(state.glowIntensity);
  }

  getBuildingResidentCount(originX: number, originY: number): number {
    const buildingKey = `${originX},${originY}`;
    const residents = this.buildingOccupancy.get(buildingKey);
    return residents ? residents.length : 0;
  }

  getAvailableHousingSlots(): number {
    let totalCapacity = 0;
    let totalOccupied = 0;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y][x];
        if (cell.type === TileType.Building && cell.isOrigin && cell.buildingId) {
          const building = getBuilding(cell.buildingId);
          if (building && building.category === "residential") {
            const economics = getBuildingEconomics(building);
            if (economics.maxResidents) {
              totalCapacity += economics.maxResidents;
              const buildingKey = `${x},${y}`;
              const residents = this.buildingOccupancy.get(buildingKey);
              totalOccupied += residents ? residents.length : 0;
            }
          }
        }
      }
    }

    return Math.max(0, totalCapacity - totalOccupied);
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
    this.buildingRenderer.clearAll();

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
          this.buildingRenderer.renderBuilding(this, x, y, cell.buildingId, cell.buildingOrientation);
        }
      }
    }
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

    // Remove indicators for cars that no longer exist
    this.taxiIndicators.forEach((indicator, id) => {
      if (!currentCarIds.has(id)) {
        indicator.destroy();
        this.taxiIndicators.delete(id);
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

      // Taxi passenger indicator
      if (car.carType === CarType.Taxi && car.passengerId) {
        let indicator = this.taxiIndicators.get(car.id);
        if (!indicator) {
          indicator = this.add.text(screenPos.x, groundY - 28, "\u{1F695}", { fontSize: "12px" });
          indicator.setOrigin(0.5, 1);
          this.taxiIndicators.set(car.id, indicator);
        }
        indicator.setPosition(screenPos.x, groundY - 28);
        indicator.setDepth(this.depthFromSortPoint(screenPos.x, groundY, 0.1) + 1);
        indicator.setVisible(true);
      } else {
        const indicator = this.taxiIndicators.get(car.id);
        if (indicator) {
          indicator.setVisible(false);
        }
      }
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

  // Trigger particle effects when moodlet changes
  private triggerMoodletParticles(charId: string, moodlet: MoodletType, x: number, y: number): void {
    if (!moodlet) return; // No moodlet, no particles
    
    // Create simple particle effects based on moodlet type
    const colors: Record<NonNullable<MoodletType>, number> = {
      happy: 0x00ff00, // Green
      sad: 0x808080, // Gray
      hungry: 0xffa500, // Orange
      angry: 0xff0000, // Red
      depressed: 0x4b0082, // Indigo
    };
    
    const emojis: Record<NonNullable<MoodletType>, string> = {
      happy: "😊",
      sad: "😢",
      hungry: "🍔",
      angry: "😠",
      depressed: "😔",
    };
    
    const color = colors[moodlet] || 0xffffff;
    const emoji = emojis[moodlet] || "";
    
    // Create a simple particle burst using Phaser's built-in particles
    // For simplicity, we'll create a temporary sprite that fades out
    if (emoji) {
      // Use a text sprite for emoji particles (simpler than full particle system)
      const particle = this.add.text(x, y - 30, emoji, {
        fontSize: "24px",
        color: `#${color.toString(16).padStart(6, '0')}`,
      });
      particle.setDepth(9999); // Above everything
      particle.setOrigin(0.5, 0.5);
      
      // Animate the particle
      this.tweens.add({
        targets: particle,
        y: y - 60,
        alpha: 0,
        duration: 1000,
        ease: "Power2",
        onComplete: () => {
          particle.destroy();
        },
      });
    }
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
      
      // Check if moodlet changed and trigger particles
      if (char.moodlet && char.previousMoodlet !== char.moodlet && char.previousMoodlet !== undefined) {
        this.triggerMoodletParticles(char.id, char.moodlet, screenPos.x, centerY);
      }
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

      // Hide citizens who are resting at home or riding in a taxi
      if (char.state === "resting_at_home" || char.state === "in_taxi") {
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
    this.previewSystem.clear();
  }

  private updatePreview(): void {
    this.previewSystem.update({
      grid: this.grid,
      hoverTile: this.hoverTile,
      selectedTool: this.selectedTool,
      selectedBuildingId: this.selectedBuildingId,
      buildingOrientation: this.buildingOrientation,
      isDragging: this.isDragging,
      dragTiles: this.dragTiles,
      add: this.add,
      textures: this.textures,
      gridToScreen: this.gridToScreen.bind(this),
      depthFromSortPoint: this.depthFromSortPoint.bind(this),
      getBuildingTextureKey: this.buildingRenderer.getBuildingTextureKey.bind(this.buildingRenderer),
    });
  }
}
