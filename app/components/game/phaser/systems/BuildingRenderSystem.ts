import Phaser from "phaser";
import {
  Direction,
  TILE_HEIGHT,
} from "../../types";
import {
  getBuilding,
  getBuildingFootprint,
  BuildingDefinition,
} from "@/app/data/buildings";
import { GRID_OFFSET_Y } from "../gameConfig";

/**
 * Interface for the minimal scene access needed by BuildingRenderSystem.
 * Allows the system to create/manage sprites without direct MainScene coupling.
 */
export interface BuildingRenderSceneAccess {
  add: Phaser.GameObjects.GameObjectFactory;
  make: Phaser.GameObjects.GameObjectCreator;
  textures: Phaser.Textures.TextureManager;
  tweens: Phaser.Tweens.TweenManager;
  gridToScreen(gridX: number, gridY: number): { x: number; y: number };
  depthFromSortPoint(screenX: number, screenY: number, offset: number): number;
}

/**
 * BuildingRenderSystem handles all building sprite rendering, including:
 * - Vertical slice rendering for correct isometric depth sorting
 * - Lamp glow effects for christmas lamps
 * - Building texture key resolution
 * - Building sprite lifecycle (create/remove)
 */
export class BuildingRenderSystem {
  // Sprite containers (owned by this system, referenced from MainScene)
  readonly buildingSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  readonly glowSprites: Map<string, Phaser.GameObjects.GameObject> = new Map();
  // Track tweens so we can update their alpha range when glow intensity changes
  private glowTweens: Map<string, Phaser.Tweens.Tween> = new Map();

  // Day/night glow intensity (0 = off during day, 1 = full at night)
  private glowIntensity: number = 1.0;

  /**
   * Update all glow sprite intensities based on day/night cycle.
   * intensity: 0 = invisible (day), 1 = full brightness (night)
   */
  setGlowIntensity(intensity: number): void {
    this.glowIntensity = intensity;

    this.glowSprites.forEach((glow, key) => {
      if (glow instanceof Phaser.GameObjects.Image) {
        if (intensity <= 0.01) {
          glow.setVisible(false);
        } else {
          glow.setVisible(true);
          // Update the pulsing tween's alpha range based on intensity
          const tween = this.glowTweens.get(key);
          if (tween) {
            // Scale the pulse range: full night = 0.7-1.0, half = 0.35-0.5
            tween.updateTo("alpha", intensity, true);
          } else {
            // No tween, just set alpha directly
            glow.setAlpha(intensity);
          }
        }
      }
    });
  }

  /**
   * Get the texture key for a building based on its definition and orientation.
   */
  getBuildingTextureKey(
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

  /**
   * Remove a building and all its vertical slices.
   * Buildings are stored as: "building_X,Y" (main) + "building_X,Y_s1", "_s2", etc. (slices)
   */
  removeBuildingSprites(buildingKey: string): void {
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

    // Remove glow and its tween if exists
    const glow = this.glowSprites.get(buildingKey);
    if (glow) {
      glow.destroy();
      this.glowSprites.delete(buildingKey);
    }
    const tween = this.glowTweens.get(buildingKey);
    if (tween) {
      tween.destroy();
      this.glowTweens.delete(buildingKey);
    }
  }

  /**
   * Clear all building and glow sprites (used during full grid re-render).
   */
  clearAll(): void {
    this.buildingSprites.forEach((sprite) => sprite.destroy());
    this.buildingSprites.clear();
    this.glowSprites.forEach((sprite) => sprite.destroy());
    this.glowSprites.clear();
    this.glowTweens.forEach((tween) => tween.destroy());
    this.glowTweens.clear();
  }

  /**
   * Render a building at the given grid origin with vertical slice rendering
   * for correct isometric depth sorting.
   *
   * Buildings are sliced into vertical strips where each strip corresponds
   * to one "diagonal" of tiles and gets its own depth value. This allows
   * characters/props to correctly interleave with building parts.
   */
  renderBuilding(
    scene: BuildingRenderSceneAccess,
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

    if (!scene.textures.exists(textureKey)) {
      console.warn(`Texture not found: ${textureKey}`);
      return;
    }

    // Get footprint based on orientation (for positioning)
    const footprint = getBuildingFootprint(building, orientation);
    // Get render size for slicing (use renderSize if available, else footprint)
    const renderSize = building.renderSize || footprint;
    const frontX = originX + footprint.width - 1;
    const frontY = originY + footprint.height - 1;
    const screenPos = scene.gridToScreen(frontX, frontY);
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
    const decorationDepth = scene.depthFromSortPoint(
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

      const slice = scene.add.image(screenPos.x, bottomY, textureKey);
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
          scene.depthFromSortPoint(
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

      const slice = scene.add.image(screenPos.x, bottomY, textureKey);
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
          scene.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + TILE_HEIGHT / 2,
            0.05
          )
        );
      }

      this.buildingSprites.set(`${key}_s${sliceIndex}`, slice);
      sliceIndex++;
    }

    // Add glow effect for christmas lamps and buildings with night lights
    if (buildingId === "christmas-lamp" || building.hasNightLight) {
      // Use a larger glow for bigger buildings
      const glowScale = Math.max(footprint.width, footprint.height) >= 4 ? 2.0 : 1.0;
      const glowOffsetY = buildingId === "christmas-lamp" ? -45 : -30 * glowScale;
      this.addBuildingGlow(scene, key, screenPos.x, screenPos.y, glowOffsetY, glowScale);
    }
  }

  /**
   * Add a warm glow effect to a building (lamps, commercial, landmarks, etc.)
   */
  private addBuildingGlow(
    scene: BuildingRenderSceneAccess,
    key: string,
    x: number,
    tileY: number,
    offsetY: number,
    scale: number
  ): void {
    const glowY = tileY + TILE_HEIGHT / 2 + offsetY;

    // Create pixelated glow texture if it doesn't exist
    if (!scene.textures.exists("lamp_glow")) {
      this.createPixelatedGlowTexture(scene);
    }

    // Create glow sprite using the pixelated texture
    const glow = scene.add.image(x, glowY, "lamp_glow");
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setScale(scale);
    glow.setDepth(scene.depthFromSortPoint(x, tileY + TILE_HEIGHT / 2, 0.04));

    // Apply current glow intensity (may be 0 during daytime)
    const intensity = this.glowIntensity;
    if (intensity <= 0.01) {
      glow.setVisible(false);
    }

    // Add subtle pulsing animation — alpha scales with day/night intensity
    const tween = scene.tweens.add({
      targets: glow,
      alpha: { from: 0.7 * intensity, to: 1.0 * intensity },
      duration: 2000 + Math.random() * 500, // Slight variation so glows aren't synchronized
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.glowSprites.set(key, glow);
    this.glowTweens.set(key, tween);
  }

  /**
   * Create a pixelated diamond-shaped glow texture for isometric lamp effects.
   */
  private createPixelatedGlowTexture(scene: BuildingRenderSceneAccess): void {
    const size = 96; // Larger texture size
    const graphics = scene.make.graphics({ x: 0, y: 0 });

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
}
