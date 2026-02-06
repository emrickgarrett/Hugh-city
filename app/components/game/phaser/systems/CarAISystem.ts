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
} from "../../types";
import { directionVectors, oppositeDirection, allDirections } from "../utils/directions";
import {
  getLaneDirection,
  isAtIntersection,
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

  isDirectionClear(
    car: Car,
    dir: Direction,
    allCars: Car[],
    playerCar: Car | null,
    checkDist: number = 1.2
  ): boolean {
    const vec = directionVectors[dir];
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    const carsToCheck = playerCar ? [...allCars, playerCar] : allCars;
    for (const other of carsToCheck) {
      if (other.id === car.id) continue;
      const dist = Math.sqrt(
        Math.pow(other.x - aheadX, 2) + Math.pow(other.y - aheadY, 2)
      );
      if (dist < 0.7) return false;
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
    const MIN_CAR_SPACING = 1.8;

    const carsToCheck = playerCar ? [...allCars, playerCar] : allCars;
    for (const other of carsToCheck) {
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

  updateSingleCar(
    car: Car,
    allCars: Car[],
    playerCar: Car | null,
    grid: import("../../types").GridCell[][],
    gameSpeed: GameSpeed
  ): Car {
    const { x, y, direction, speed, waiting } = car;
    const effectiveSpeed = speed * (gameSpeed === GameSpeed.Paused ? 0 : gameSpeed);
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    if (!this.pathfinding.isDrivable(tileX, tileY)) {
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (grid[gy][gx].type === TileType.Asphalt) {
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
      const atIntersection = isAtIntersection(tileX, tileY, grid);
      const laneDir = getLaneDirection(tileX, tileY, grid);
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.pathfinding.isDrivable(nextTileX, nextTileY)) {
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
      } else if (atIntersection) {
        const validDirs = this.pathfinding.getValidCarDirections(tileX, tileY);
        if (validDirs.length >= 3 && Math.random() < 0.25) {
          const newDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            allCars,
            playerCar,
            grid,
            false
          );
          if (newDir) {
            newDirection = newDir;
            nextX = tileX + 0.5;
            nextY = tileY + 0.5;
          }
        }
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

    return { ...car, x: nextX, y: nextY, direction: newDirection, waiting: 0 };
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

    const carType = Math.random() < 0.5 ? CarType.Taxi : CarType.Jeep;

    return {
      id: generateId(),
      x: asphaltTile.x + 0.5,
      y: asphaltTile.y + 0.5,
      direction,
      speed: CAR_SPEED + (Math.random() - 0.5) * 0.005,
      waiting: 0,
      carType,
    };
  }
}
