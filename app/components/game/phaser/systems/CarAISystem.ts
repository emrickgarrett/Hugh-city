import {
  Car,
  Direction,
  TileType,
  GRID_WIDTH,
  GRID_HEIGHT,
  CarType,
  CAR_SPEED,
  GameSpeed,
  CharacterWithResidence,
  TaxiState,
  TAXI_PICKUP_DISTANCE,
  TAXI_PICKUP_RADIUS,
  TAXI_DROPOFF_RADIUS,
  TAXI_FARE_BASE,
  TAXI_FARE_PER_TILE,
} from "../../types";
import { directionVectors, oppositeDirection, allDirections } from "../utils/directions";
import {
  getLaneDirection,
  isAtIntersection,
  isAtCorner,
  getCornerTurnDirection,
  canTurnAtTile,
  getUTurnDirection,
} from "../../roadUtils";
import { PathfindingSystem } from "./PathfindingSystem";
import { generateId } from "../utils/constants";

/**
 * CarAISystem handles all car movement logic, collision detection,
 * and player-driven car controls.
 */
export class CarAISystem {
  private pathfinding: PathfindingSystem;

  constructor(pathfinding: PathfindingSystem) {
    this.pathfinding = pathfinding;
  }

  // Consistent square collision half-size for all cars (in grid units)
  private static readonly CAR_COLLISION_HALF = 0.3;
  // How far ahead to check for blocking cars (in grid units)
  private static readonly FORWARD_CHECK_DIST = 1.0;
  // Soft collision push strength per frame (in grid units)
  private static readonly SOFT_PUSH_STRENGTH = 0.02;
  // Distance at which soft collision activates (center-to-center)
  private static readonly SOFT_COLLISION_RADIUS = 0.7;

  /**
   * Check if two cars' square hitboxes overlap.
   * Uses consistent AABB (axis-aligned bounding box) regardless of orientation.
   */
  private carsOverlap(ax: number, ay: number, bx: number, by: number): boolean {
    const h = CarAISystem.CAR_COLLISION_HALF;
    return Math.abs(ax - bx) < h * 2 && Math.abs(ay - by) < h * 2;
  }

  isDirectionClear(
    car: Car,
    dir: Direction,
    allCars: Car[],
    playerCar: Car | null,
    checkDist: number = CarAISystem.FORWARD_CHECK_DIST
  ): boolean {
    const vec = directionVectors[dir];
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    const carsToCheck = playerCar ? [...allCars, playerCar] : allCars;
    for (const other of carsToCheck) {
      if (other.id === car.id) continue;
      // Square hitbox check at the look-ahead point
      if (this.carsOverlap(aheadX, aheadY, other.x, other.y)) {
        return false;
      }
    }
    return true;
  }

  pickCarDirection(
    car: Car,
    tileX: number,
    tileY: number,
    currentDir: Direction,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    atDeadEnd: boolean = false
  ): Direction | null {
    const validDirs = this.pathfinding.getValidCarDirections(tileX, tileY);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const atIntersection = isAtIntersection(tileX, tileY, grid);
    const laneDir = getLaneDirection(tileX, tileY, grid);

    if (atDeadEnd || validDirs.length === 1) {
      const uTurnDir = getUTurnDirection(tileX, tileY, currentDir, grid);
      if (uTurnDir && validDirs.includes(uTurnDir)) {
        return uTurnDir;
      }
      return validDirs[0];
    }

    if (!atIntersection) {
      if (laneDir && validDirs.includes(laneDir)) {
        if (this.isDirectionClear(car, laneDir, allCars, playerCar)) {
          return laneDir;
        }
        return null;
      }

      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir, allCars, playerCar)
      ) {
        return currentDir;
      }

      return null;
    }

    const turnableChoices = validDirs.filter((d) => {
      if (d === opposite) return false;
      // Only consider directions where next tile is drivable
      const dVec = directionVectors[d];
      if (!this.pathfinding.isDrivable(tileX + dVec.dx, tileY + dVec.dy)) return false;
      return canTurnAtTile(tileX, tileY, currentDir, d);
    });

    if (
      validDirs.includes(currentDir) &&
      !turnableChoices.includes(currentDir)
    ) {
      // Only allow going straight if next tile is actually drivable
      const straightVec = directionVectors[currentDir];
      if (this.pathfinding.isDrivable(tileX + straightVec.dx, tileY + straightVec.dy)) {
        turnableChoices.push(currentDir);
      }
    }

    if (turnableChoices.length === 0) {
      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir, allCars, playerCar)
      ) {
        return currentDir;
      }
      return null;
    }

    const clearChoices = turnableChoices.filter((d) =>
      this.isDirectionClear(car, d, allCars, playerCar)
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

  isCarBlocking(
    car: Car,
    allCars: Car[],
    playerCar: Car | null
  ): boolean {
    const vec = directionVectors[car.direction];
    const checkDist = CarAISystem.FORWARD_CHECK_DIST;
    // Check at a point ahead of the car in its travel direction
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    const carsToCheck = playerCar ? [...allCars, playerCar] : allCars;
    for (const other of carsToCheck) {
      if (other.id === car.id) continue;

      // Use square hitbox check at the forward look-ahead point
      if (this.carsOverlap(aheadX, aheadY, other.x, other.y)) {
        // Only block if the other car is actually ahead of us (not beside/behind)
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const dotProduct = dx * vec.dx + dy * vec.dy;
        if (dotProduct > 0) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Apply soft collision: gently push overlapping cars apart perpendicular to their travel direction.
   * This prevents taxis from fully overlapping while avoiding hard blocks that cause gridlock.
   * Returns adjusted x,y position.
   */
  applySoftCollision(
    car: Car,
    allCars: Car[],
    playerCar: Car | null
  ): { x: number; y: number } {
    let pushX = 0;
    let pushY = 0;
    const softRadius = CarAISystem.SOFT_COLLISION_RADIUS;
    const pushStrength = CarAISystem.SOFT_PUSH_STRENGTH;

    const carsToCheck = playerCar ? [...allCars, playerCar] : allCars;
    for (const other of carsToCheck) {
      if (other.id === car.id) continue;

      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < softRadius && dist > 0.01) {
        // Push away from the other car, scaled by how close they are
        const overlap = (softRadius - dist) / softRadius; // 0 to 1
        const pushForce = pushStrength * overlap;
        pushX -= (dx / dist) * pushForce;
        pushY -= (dy / dist) * pushForce;
      }
    }

    if (pushX === 0 && pushY === 0) {
      return { x: car.x, y: car.y };
    }

    // Apply push but don't push off drivable tiles
    const newX = car.x + pushX;
    const newY = car.y + pushY;
    const newTileX = Math.floor(newX);
    const newTileY = Math.floor(newY);

    if (this.pathfinding.isDrivable(newTileX, newTileY)) {
      return { x: newX, y: newY };
    }
    return { x: car.x, y: car.y };
  }

  // Callback for taxi fare events (set by MainScene)
  onTaxiFare?: (citizenId: string, fare: number) => void;

  updateSingleCar(
    car: Car,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    gameSpeed: GameSpeed,
    characters?: CharacterWithResidence[]
  ): Car {
    // Dispatch taxis to taxi-specific logic
    if (car.carType === CarType.Taxi && car.taxiState !== undefined && characters) {
      return this.updateTaxiCar(car, allCars, playerCar, grid, gameSpeed, characters);
    }

    const { x, y, direction, speed, waiting } = car;
    const effectiveSpeed = speed * (gameSpeed === GameSpeed.Paused ? 0 : gameSpeed);
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    if (!this.pathfinding.isDrivable(tileX, tileY)) {
      // Find a proper lane tile (one with at least 2 drivable neighbors)
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (grid[gy][gx].type === TileType.Asphalt && this.pathfinding.getValidCarDirections(gx, gy).length >= 2) {
            asphaltTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (asphaltTiles.length > 0) {
        const newTile =
          asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
        const laneDir = getLaneDirection(newTile.x, newTile.y, grid);
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

    // Check if we're at a corner FIRST — corners need special handling
    // that must take priority over the generic blocking logic
    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = effectiveSpeed * 2;
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    if (nearCenter && isAtCorner(tileX, tileY, grid)) {
      const cornerDir = getCornerTurnDirection(tileX, tileY, direction, grid);
      if (cornerDir) {
        // Must turn at this corner — check if the turn is clear
        if (this.isDirectionClear(car, cornerDir, allCars, playerCar)) {
          // Turn and continue
          const moveVec2 = directionVectors[cornerDir];
          let nx = tileX + 0.5 + moveVec2.dx * effectiveSpeed;
          let ny = tileY + 0.5 + moveVec2.dy * effectiveSpeed;
          const ps = Math.max(0.001, effectiveSpeed);
          nx = Math.round(nx / ps) * ps;
          ny = Math.round(ny / ps) * ps;
          const movedCar = { ...car, x: nx, y: ny, direction: cornerDir, waiting: 0 };
          const softPos = this.applySoftCollision(movedCar, allCars, playerCar);
          return { ...movedCar, x: softPos.x, y: softPos.y };
        } else {
          // Turn is blocked — hold at tile center with soft push
          const movedCar = { ...car, x: tileX + 0.5, y: tileY + 0.5, waiting: 0 };
          const softPos = this.applySoftCollision(movedCar, allCars, playerCar);
          return { ...movedCar, x: softPos.x, y: softPos.y };
        }
      }
      // cornerDir is null — current direction is fine, fall through to normal movement
    }

    const blocked = this.isCarBlocking(car, allCars, playerCar);
    const MAX_WAIT_FRAMES = 60;

    if (blocked) {
      const newWaiting = waiting + 1;

      if (newWaiting > MAX_WAIT_FRAMES) {
        if (isAtIntersection(tileX, tileY, grid)) {
          const altDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            allCars,
            playerCar,
            grid,
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

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      const atIntersection = isAtIntersection(tileX, tileY, grid);
      const laneDir = getLaneDirection(tileX, tileY, grid);
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;
      const nextDrivable = this.pathfinding.isDrivable(nextTileX, nextTileY);

      // Note: corners are already handled above, before blocking logic
      if (atIntersection) {
        // At a 3+ way intersection — randomly consider turning
        const mustTurn = !nextDrivable;
        const validDirs = this.pathfinding.getValidCarDirections(tileX, tileY);
        if (mustTurn || (validDirs.length >= 3 && Math.random() < 0.25)) {
          const newDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            allCars,
            playerCar,
            grid,
            mustTurn
          );
          if (newDir) {
            newDirection = newDir;
            nextX = tileX + 0.5;
            nextY = tileY + 0.5;
          }
        }
      } else if (!nextDrivable) {
        // Hit edge of road at a non-intersection tile — dead-end/U-turn
        const newDir = this.pickCarDirection(
          car,
          tileX,
          tileY,
          direction,
          allCars,
          playerCar,
          grid,
          true
        );
        if (newDir) {
          newDirection = newDir;
        }
        nextX = tileX + 0.5;
        nextY = tileY + 0.5;
      } else if (laneDir && laneDir !== direction) {
        if (this.pathfinding.getValidCarDirections(tileX, tileY).includes(laneDir)) {
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

    if (!this.pathfinding.isDrivable(finalTileX, finalTileY)) {
      return {
        ...car,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
        waiting: 0,
      };
    }

    // Apply soft collision to prevent overlapping
    const movedCar = { ...car, x: nextX, y: nextY, direction: newDirection, waiting: 0 };
    const softPos = this.applySoftCollision(movedCar, allCars, playerCar);
    return { ...movedCar, x: softPos.x, y: softPos.y };
  }

  // ============================================
  // PLAYER CAR LOGIC
  // ============================================

  updatePlayerCar(
    playerCar: Car,
    pressedKeys: Set<string>,
    cars: Car[],
    characters: CharacterWithResidence[],
    grid: import("../../types").GridCell[][]
  ): Car {
    let newDirection = playerCar.direction;
    let nextX = playerCar.x;
    let nextY = playerCar.y;

    let desiredDir: Direction | null = null;

    if (pressedKeys.has("arrowup") || pressedKeys.has("w")) {
      desiredDir = Direction.Up;
    } else if (pressedKeys.has("arrowdown") || pressedKeys.has("s")) {
      desiredDir = Direction.Down;
    } else if (pressedKeys.has("arrowleft") || pressedKeys.has("a")) {
      desiredDir = Direction.Left;
    } else if (pressedKeys.has("arrowright") || pressedKeys.has("d")) {
      desiredDir = Direction.Right;
    }

    if (desiredDir) {
      newDirection = desiredDir;
      const vec = directionVectors[newDirection];
      const moveX = nextX + vec.dx * playerCar.speed;
      const moveY = nextY + vec.dy * playerCar.speed;

      if (!this.checkPlayerCarCollision(moveX, moveY, cars, characters, grid)) {
        nextX = moveX;
        nextY = moveY;
      }
    }

    const pixelatedStep = Math.max(0.001, playerCar.speed);
    nextX = Math.round(nextX / pixelatedStep) * pixelatedStep;
    nextY = Math.round(nextY / pixelatedStep) * pixelatedStep;

    return { ...playerCar, x: nextX, y: nextY, direction: newDirection };
  }

  checkPlayerCarCollision(
    x: number,
    y: number,
    cars: Car[],
    characters: CharacterWithResidence[],
    grid: import("../../types").GridCell[][]
  ): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);

    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) {
      return true;
    }

    const cell = grid[gy][gx];

    if (cell.type === TileType.Building) {
      return true;
    }

    for (const car of cars) {
      if (car.id === "player-car") continue;
      const carTileX = Math.floor(car.x);
      const carTileY = Math.floor(car.y);
      if (carTileX === gx && carTileY === gy) {
        return true;
      }
    }

    for (const char of characters) {
      const charTileX = Math.floor(char.x);
      const charTileY = Math.floor(char.y);
      if (charTileX === gx && charTileY === gy) {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // SPAWNING
  // ============================================

  spawnCar(
    grid: import("../../types").GridCell[][]
  ): Car | null {
    const asphaltTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (grid[y][x].type === TileType.Asphalt) {
          asphaltTiles.push({ x, y });
        }
      }
    }

    if (asphaltTiles.length === 0) return null;

    const asphaltTile =
      asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
    const validDirs = allDirections.filter((dir) => {
      const vec = directionVectors[dir];
      const nx = asphaltTile.x + vec.dx;
      const ny = asphaltTile.y + vec.dy;
      if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT)
        return false;
      return grid[ny][nx].type === TileType.Asphalt;
    });

    const laneDir = getLaneDirection(asphaltTile.x, asphaltTile.y, grid);
    let direction: Direction;

    if (laneDir && validDirs.includes(laneDir)) {
      direction = laneDir;
    } else if (validDirs.length > 0) {
      direction = validDirs[Math.floor(Math.random() * validDirs.length)];
    } else {
      direction =
        allDirections[Math.floor(Math.random() * allDirections.length)];
    }

    return {
      id: generateId(),
      x: asphaltTile.x + 0.5,
      y: asphaltTile.y + 0.5,
      direction,
      speed: CAR_SPEED + (Math.random() - 0.5) * 0.005,
      waiting: 0,
      carType: CarType.Jeep,
    };
  }

  // ============================================
  // TAXI AI STATE MACHINE
  // ============================================

  /**
   * Find an eligible citizen for taxi pickup.
   * Returns the nearest citizen who:
   * - Is heading_to_building or heading_home
   * - Has a destination >TAXI_PICKUP_DISTANCE tiles away
   * - Can afford the base fare
   * - Is not already claimed by another taxi
   */
  private findEligiblePassenger(
    taxi: Car,
    characters: CharacterWithResidence[],
    allCars: Car[]
  ): CharacterWithResidence | null {
    // Build set of citizen IDs already claimed by other taxis
    const claimedIds = new Set<string>();
    for (const car of allCars) {
      if (car.id === taxi.id) continue;
      if (car.carType === CarType.Taxi) {
        if (car.passengerId) claimedIds.add(car.passengerId);
        if (car.pickupTarget?.citizenId) claimedIds.add(car.pickupTarget.citizenId);
      }
    }

    let bestCandidate: CharacterWithResidence | null = null;
    let bestTaxiDist = Infinity;

    for (const char of characters) {
      if (claimedIds.has(char.id)) continue;
      if (char.state !== "heading_to_building" && char.state !== "heading_home") continue;
      if (!char.currentDestination) continue;
      if ((char.money ?? 0) < TAXI_FARE_BASE) continue;

      const charTileX = Math.floor(char.x);
      const charTileY = Math.floor(char.y);
      const destDist = Math.abs(charTileX - char.currentDestination.x) +
                       Math.abs(charTileY - char.currentDestination.y);
      if (destDist < TAXI_PICKUP_DISTANCE) continue;

      const taxiTileX = Math.floor(taxi.x);
      const taxiTileY = Math.floor(taxi.y);
      const taxiDist = Math.abs(taxiTileX - charTileX) + Math.abs(taxiTileY - charTileY);
      if (taxiDist < bestTaxiDist) {
        bestTaxiDist = taxiDist;
        bestCandidate = char;
      }
    }

    return bestCandidate;
  }

  /**
   * Get the current direction a taxi should be moving based on its cached path.
   *
   * How path indexing works:
   * - cachedCarPath[i] = the direction to move from tile i to tile i+1
   * - carPathIndex = which step we're currently on
   * - lastCarPathTile = the tile we were on when we last set/advanced the index
   *
   * When the car enters a NEW tile (different from lastCarPathTile), we advance
   * the path index because we've completed the previous step.
   *
   * Returns the direction to move, or null if path is done/invalid.
   * Also returns an updated car with the new path index.
   */
  private getPathDirection(car: Car): { direction: Direction; updatedCar: Car } | null {
    if (!car.cachedCarPath || car.carPathIndex === undefined) return null;

    const tileX = Math.floor(car.x);
    const tileY = Math.floor(car.y);
    let pathIdx = car.carPathIndex;

    // If we've moved to a new tile since last check, advance the path index
    if (car.lastCarPathTile) {
      if (car.lastCarPathTile.x !== tileX || car.lastCarPathTile.y !== tileY) {
        pathIdx++;
      }
    }

    // Path exhausted
    if (pathIdx >= car.cachedCarPath.length) {
      return null;
    }

    const dir = car.cachedCarPath[pathIdx];

    return {
      direction: dir,
      updatedCar: { ...car, carPathIndex: pathIdx, lastCarPathTile: { x: tileX, y: tileY } },
    };
  }

  /**
   * Core taxi update — implements the taxi state machine per frame.
   */
  private updateTaxiCar(
    car: Car,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    gameSpeed: GameSpeed,
    characters: CharacterWithResidence[]
  ): Car {
    const tileX = Math.floor(car.x);
    const tileY = Math.floor(car.y);
    const effectiveSpeed = car.speed * (gameSpeed === GameSpeed.Paused ? 0 : gameSpeed);

    switch (car.taxiState) {
      // ---- CRUISING: Drive around, look for passengers ----
      case TaxiState.Cruising: {
        // Drive using the normal car AI (random turns at intersections)
        const carForMovement = { ...car, waiting: 0 };
        const cruisingCar = this.updateSingleCarMovement(carForMovement, allCars, playerCar, grid, gameSpeed);

        const cruisingTileX = Math.floor(cruisingCar.x);
        const cruisingTileY = Math.floor(cruisingCar.y);

        // Scan counter: use `waiting` field to count frames between passenger scans
        const scanCounter = (car.waiting || 0) + 1;

        if (scanCounter >= 60) {
          // Every 60 frames, look for an eligible passenger
          const passenger = this.findEligiblePassenger(cruisingCar, characters, allCars);
          if (passenger) {
            const charTileX = Math.floor(passenger.x);
            const charTileY = Math.floor(passenger.y);
            const pickupTile = this.pathfinding.findNearestDrivableTile(charTileX, charTileY);
            if (pickupTile) {
              const path = this.pathfinding.computeCarPath(cruisingTileX, cruisingTileY, pickupTile.x, pickupTile.y, 500);
              if (path && path.length > 0) {
                return {
                  ...cruisingCar,
                  taxiState: TaxiState.PickingUp,
                  pickupTarget: { x: pickupTile.x, y: pickupTile.y, citizenId: passenger.id },
                  cachedCarPath: path,
                  carPathIndex: 0,
                  lastCarPathTile: { x: cruisingTileX, y: cruisingTileY },
                  waiting: 0,
                };
              }
            }
          }
          // Reset scan counter
          return { ...cruisingCar, waiting: 0 };
        }

        return { ...cruisingCar, waiting: scanCounter };
      }

      // ---- PICKING UP: Drive toward the citizen ----
      case TaxiState.PickingUp: {
        if (!car.pickupTarget) {
          return this.taxiToCruising(car);
        }

        // Check if citizen is still eligible (every time we've moved 10+ tiles on path)
        const pathIdx = car.carPathIndex || 0;
        if (pathIdx > 0 && pathIdx % 10 === 0) {
          const citizen = characters.find(c => c.id === car.pickupTarget!.citizenId);
          if (!citizen ||
              (citizen.state !== "heading_to_building" && citizen.state !== "heading_home") ||
              !citizen.currentDestination) {
            return this.taxiToCruising(car);
          }
        }

        // Check proximity to citizen for pickup
        const citizen = characters.find(c => c.id === car.pickupTarget!.citizenId);
        if (citizen) {
          const charTileX = Math.floor(citizen.x);
          const charTileY = Math.floor(citizen.y);
          const dist = Math.abs(tileX - charTileX) + Math.abs(tileY - charTileY);

          if (dist <= TAXI_PICKUP_RADIUS) {
            // Pick up the citizen!
            const dest = citizen.currentDestination!;
            const dropoffTile = this.pathfinding.findNearestDrivableTile(dest.x, dest.y);
            if (dropoffTile) {
              const dropoffPath = this.pathfinding.computeCarPath(tileX, tileY, dropoffTile.x, dropoffTile.y, 500);
              if (dropoffPath && dropoffPath.length > 0) {
                citizen.preTaxiState = citizen.state as "heading_to_building" | "heading_home";
                citizen.preTaxiDestination = { ...citizen.currentDestination! };
                citizen.state = "in_taxi";
                citizen.taxiId = car.id;

                return {
                  ...car,
                  taxiState: TaxiState.Transporting,
                  passengerId: citizen.id,
                  dropoffTarget: { x: dropoffTile.x, y: dropoffTile.y },
                  cachedCarPath: dropoffPath,
                  carPathIndex: 0,
                  lastCarPathTile: { x: tileX, y: tileY },
                  pickupTarget: undefined,
                  waiting: 0,
                };
              }
            }
            return this.taxiToCruising(car);
          }
        }

        // Follow path to pickup location
        return this.moveTaxiAlongPath(car, allCars, playerCar, grid, gameSpeed, 0);
      }

      // ---- TRANSPORTING: Carry citizen to destination ----
      case TaxiState.Transporting: {
        if (!car.passengerId || !car.dropoffTarget) {
          // Invalid state, reset
          return { ...car, taxiState: TaxiState.Cruising, passengerId: undefined, dropoffTarget: undefined, cachedCarPath: undefined, carPathIndex: undefined, lastCarPathTile: undefined, waiting: 0 };
        }

        // Check if near dropoff
        const dropDist = Math.abs(tileX - car.dropoffTarget.x) + Math.abs(tileY - car.dropoffTarget.y);
        if (dropDist <= TAXI_DROPOFF_RADIUS) {
          // Drop off the citizen
          return { ...car, taxiState: TaxiState.DroppingOff };
        }

        // Follow path to dropoff
        return this.moveTaxiAlongPath(car, allCars, playerCar, grid, gameSpeed, 0);
      }

      // ---- DROPPING OFF: Place citizen on sidewalk ----
      case TaxiState.DroppingOff: {
        const passenger = characters.find(c => c.id === car.passengerId);
        if (passenger) {
          // Find nearest sidewalk for the citizen
          const sidewalk = this.pathfinding.findNearestSidewalkTile(tileX, tileY);
          if (sidewalk) {
            passenger.x = sidewalk.x + 0.5;
            passenger.y = sidewalk.y + 0.5;
          } else {
            // Fallback: place on current tile
            passenger.x = car.x;
            passenger.y = car.y;
          }

          // Restore citizen state
          passenger.state = passenger.preTaxiState || "wandering";
          passenger.currentDestination = passenger.preTaxiDestination;
          passenger.preTaxiState = undefined;
          passenger.preTaxiDestination = undefined;
          passenger.taxiId = undefined;
          // Clear cached path so citizen recomputes from new position
          passenger.cachedPath = undefined;
          passenger.pathIndex = undefined;
          passenger.lastPathTile = undefined;

          // Calculate and deduct fare
          const startX = car.pickupTarget?.x ?? tileX;
          const startY = car.pickupTarget?.y ?? tileY;
          const tripDistance = Math.abs(tileX - startX) + Math.abs(tileY - startY);
          const fare = TAXI_FARE_BASE + tripDistance * TAXI_FARE_PER_TILE;
          passenger.money = Math.max(0, (passenger.money ?? 0) - fare);

          // Emit fare event
          if (this.onTaxiFare) {
            this.onTaxiFare(passenger.id, fare);
          }
        }

        // Reset taxi to cruising
        return {
          ...car,
          taxiState: TaxiState.Cruising,
          passengerId: undefined,
          pickupTarget: undefined,
          dropoffTarget: undefined,
          cachedCarPath: undefined,
          carPathIndex: undefined,
          lastCarPathTile: undefined,
          waiting: 0,
        };
      }

      default: {
        const defaultCar = { ...car, waiting: 0 };
        return this.updateSingleCarMovement(defaultCar, allCars, playerCar, grid, gameSpeed);
      }
    }
  }

  /**
   * Move a taxi along its A* path. Completely self-contained movement:
   *
   * 1. Get current direction from path (or recompute if needed)
   * 2. Check for car ahead — if blocked, wait (with recompute timeout)
   * 3. Move forward by effectiveSpeed
   * 4. When crossing into a new tile, the path index auto-advances via getPathDirection
   *
   * No corner logic. No intersection logic. No lane correction.
   * The A* path already accounts for all of that.
   */
  private moveTaxiAlongPath(
    car: Car,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    gameSpeed: GameSpeed,
    _waitingCounter: number
  ): Car {
    const effectiveSpeed = car.speed * (gameSpeed === GameSpeed.Paused ? 0 : gameSpeed);
    if (effectiveSpeed <= 0) return car;

    const tileX = Math.floor(car.x);
    const tileY = Math.floor(car.y);

    const target = car.taxiState === TaxiState.PickingUp ? car.pickupTarget : car.dropoffTarget;
    if (!target) {
      return this.taxiToCruising(car);
    }

    // Step 1: Determine direction to travel
    let moveDir = car.direction;
    let workingCar = car;

    // Try to get direction from cached path
    const pathResult = this.getPathDirection(car);
    if (pathResult) {
      moveDir = pathResult.direction;
      workingCar = pathResult.updatedCar;
    } else {
      // Path exhausted or missing — recompute
      const newPath = this.pathfinding.computeCarPath(tileX, tileY, target.x, target.y, 500);
      if (newPath && newPath.length > 0) {
        moveDir = newPath[0];
        workingCar = {
          ...car,
          cachedCarPath: newPath,
          carPathIndex: 0,
          lastCarPathTile: { x: tileX, y: tileY },
        };
      } else {
        // No path exists at all
        if (car.taxiState === TaxiState.Transporting) {
          // Never abandon passenger — just sit and retry next frame
          return { ...car, waiting: (car.waiting || 0) + 1 };
        }
        return this.taxiToCruising(car);
      }
    }

    // Step 2: Check if blocked by another car ahead
    if (!this.isDirectionClear(workingCar, moveDir, allCars, playerCar)) {
      const waitCount = (workingCar.waiting || 0) + 1;

      // After 45 frames blocked, recompute path (might find alternate route)
      if (waitCount > 45) {
        const newPath = this.pathfinding.computeCarPath(tileX, tileY, target.x, target.y, 500);
        if (newPath && newPath.length > 0) {
          return {
            ...workingCar,
            cachedCarPath: newPath,
            carPathIndex: 0,
            lastCarPathTile: { x: tileX, y: tileY },
            direction: newPath[0],
            waiting: 0,
          };
        }
        // Still no path — for Transporting, just reset wait. For PickingUp, abandon.
        if (car.taxiState === TaxiState.Transporting) {
          return { ...workingCar, direction: moveDir, waiting: 0 };
        }
        return this.taxiToCruising(car);
      }

      // Wait in place, face the intended direction
      const softPos = this.applySoftCollision({ ...workingCar, direction: moveDir }, allCars, playerCar);
      return { ...workingCar, x: softPos.x, y: softPos.y, direction: moveDir, waiting: waitCount };
    }

    // Step 3: Move forward
    const moveVec = directionVectors[moveDir];
    let nextX = car.x + moveVec.dx * effectiveSpeed;
    let nextY = car.y + moveVec.dy * effectiveSpeed;

    // Snap to avoid floating point drift
    const ps = Math.max(0.001, effectiveSpeed);
    nextX = Math.round(nextX / ps) * ps;
    nextY = Math.round(nextY / ps) * ps;

    // Safety: don't drive off asphalt
    const nextTileX = Math.floor(nextX);
    const nextTileY = Math.floor(nextY);
    if (!this.pathfinding.isDrivable(nextTileX, nextTileY)) {
      // Went off-road — snap to current tile center and recompute path
      const newPath = this.pathfinding.computeCarPath(tileX, tileY, target.x, target.y, 500);
      if (newPath && newPath.length > 0) {
        return {
          ...workingCar,
          x: tileX + 0.5,
          y: tileY + 0.5,
          cachedCarPath: newPath,
          carPathIndex: 0,
          lastCarPathTile: { x: tileX, y: tileY },
          direction: newPath[0],
          waiting: 0,
        };
      }
      return { ...workingCar, x: tileX + 0.5, y: tileY + 0.5, direction: moveDir, waiting: 0 };
    }

    // Apply soft collision push
    const movedCar = { ...workingCar, x: nextX, y: nextY, direction: moveDir, waiting: 0 };
    const softPos = this.applySoftCollision(movedCar, allCars, playerCar);
    return { ...movedCar, x: softPos.x, y: softPos.y };
  }

  /** Helper: reset taxi to cruising state */
  private taxiToCruising(car: Car): Car {
    return {
      ...car,
      taxiState: TaxiState.Cruising,
      pickupTarget: undefined,
      dropoffTarget: undefined,
      passengerId: undefined,
      cachedCarPath: undefined,
      carPathIndex: undefined,
      lastCarPathTile: undefined,
      waiting: 0,
    };
  }

  /**
   * Run the existing random driving logic (for cruising taxis and regular cars).
   * This is a refactored extraction of the core movement from updateSingleCar.
   */
  private updateSingleCarMovement(
    car: Car,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    gameSpeed: GameSpeed
  ): Car {
    // Temporarily clear taxi state fields so updateSingleCar doesn't dispatch back here
    const tempCar = { ...car, taxiState: undefined as TaxiState | undefined };
    const result = this.updateSingleCar(tempCar, allCars, playerCar, grid, gameSpeed);
    // Restore taxi state
    return { ...result, taxiState: car.taxiState };
  }
}
