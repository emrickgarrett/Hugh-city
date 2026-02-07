# Project Guidelines for Claude

## Notifications

Play a system ping sound (`afplay /System/Library/Sounds/Ping.aiff`) when:
- Finishing a long-running task
- Needing user input or asking a question
- Encountering an error that blocks progress

## Tech Stack

- **Framework:** Next.js 16 with React 19, TypeScript 5, App Router
- **Game Engine:** Phaser 3.90 (loaded dynamically, no SSR)
- **Styling:** Tailwind CSS 4 + custom RCT1-themed CSS
- **GIF Support:** gifuct-js for character animations

## Commands

```bash
npm run dev     # Development server (localhost:3000)
npm run build   # Production build
npm run lint    # ESLint
```

## Project Structure

```
/app
  page.tsx             # Client component: menu/game state machine
  layout.tsx           # Root layout with fonts
  globals.css          # Tailwind CSS 4 + RCT1-themed custom styles
  /components
    /game
      /phaser            # Phaser game engine code
        MainScene.ts       # Core game logic, rendering, entities
        PhaserGame.tsx     # React wrapper with imperative handle
        GifLoader.ts       # Character GIF animation loading (gifuct-js)
        gameConfig.ts      # Phaser game configuration
        /systems           # Modular game subsystems
          BuildingRenderSystem.ts  # Building sprite rendering & depth sorting
          CarAISystem.ts           # Vehicle AI and road pathfinding
          CitizenAISystem.ts       # Citizen behavior, needs, movement
          PathfindingSystem.ts     # A* pathfinding implementation
          PreviewSystem.ts         # Building placement preview
        /utils
          constants.ts     # Tile sizes (44x22), depth multipliers
          directions.ts    # Direction enum helpers
      GameBoard.tsx      # Main React component, grid state, economy, time
      types.ts           # Enums, interfaces: TileType, ToolType, Direction, GameSaveData, GameTime, GameEconomy
      roadUtils.ts       # Road connection logic
      dayNightCycle.ts   # Day/night visual computations
    /ui                  # React UI components
      MainMenu.tsx         # Title screen: New Game, Load Game, Achievements, Credits
      ToolWindow.tsx       # Building/tool selection toolbar
      LoadWindow.tsx       # Save file browser with load/delete
      Modal.tsx            # Base confirmation/info modal
      PromptModal.tsx      # Text input modal
      MusicPlayer.tsx      # In-game music player (ambient/chill/jazz)
      MoneyDisplay.tsx     # Currency display widget
      BankWindow.tsx       # Bank loans and budget management
      TimeTracker.tsx      # Game time and speed controls
      StatisticsWindow.tsx # Population, happiness, building stats
      BuildingInfoWindow.tsx  # Building details and residents
      CitizenInfoWindow.tsx   # Individual citizen details
      CitizenListWindow.tsx   # Citizen list view
      AchievementsWindow.tsx  # Achievement browser with progress bars
      AchievementToast.tsx    # Achievement unlock notification
  /data
    buildings.ts       # Building registry (single source of truth)
    achievements.ts    # 16 achievement definitions across 5 categories
  /utils
    sounds.ts          # Audio effects (build, destroy, click, etc.)
    achievementStore.ts # Achievement progress persistence (localStorage)
/public
  /Building            # Building sprites by category (residential, commercial, civic, landmark, christmas)
  /Props               # Decorative objects (trees, benches, etc.)
  /Tiles               # Ground tiles (grass, road, asphalt, snow)
  /Characters          # Walking GIF animations (4 directions)
  /cars                # Vehicle sprites (4 directions)
  /UI                  # Toolbar icons (build, bulldozer, save, zoom, music controls)
  /audio/music         # Music tracks (ambient, chill, jazz)
```

## Architecture

**App Flow:**
- `page.tsx` manages `"menu" | "game"` state machine
- MainMenu handles New Game (city naming), Load Game, Achievements, Credits
- GameBoard receives `cityName`, optional `initialSaveData`, and `onReturnToMenu` callback

**React-Phaser Communication:**
- React manages: grid state (48x48), UI, tool selection, economy, game time
- Phaser manages: rendering, characters, cars, animations, pathfinding
- React → Phaser: via ref methods (`spawnCharacter()`, `shakeScreen()`, `isSceneReady()`)
- Phaser → React: via callbacks (`onTileClick`, `onTilesDrag`, `onBuildingInteraction`)

**Isometric System:**
- Tile size: 44x22 pixels
- Roads snap to 4x4 grid segments
- Depth sorting: `depth = (x + y) * DEPTH_Y_MULT`

**Save System:**
- Saves to localStorage as `hugh-city_save_${cityName}`
- Auto-saves every in-game week (days 7, 14, 21, 28)
- Manual save via toolbar button
- `GameSaveData` interface in `types.ts` (shared by GameBoard, LoadWindow, MainMenu)

**Achievements System:**
- 16 achievements across 5 categories (citizens, revenue, buildings, events, misc)
- Definitions in `achievements.ts`, persistence in `achievementStore.ts`
- Tracked via refs in GameBoard, checked every 2 seconds + immediate checks for revenue
- Toast notifications on unlock via `AchievementToast`

**Economy System:**
- Building income/rent, operating costs, citizen spending
- Bank loans with interest
- Monthly payment processing
- Daily revenue tracking

**Day/Night Cycle:**
- Visual computations in `dayNightCycle.ts`
- Phaser applies sky color, glow intensity per time of day
- Toggleable via settings

## Key Files to Modify

| Task | File |
|------|------|
| Add new buildings | `app/data/buildings.ts` |
| Game logic/rendering | `app/components/game/phaser/MainScene.ts` |
| UI/grid state/economy | `app/components/game/GameBoard.tsx` |
| Types/enums/interfaces | `app/components/game/types.ts` |
| Road behavior | `app/components/game/roadUtils.ts` |
| Citizen AI/behavior | `app/components/game/phaser/systems/CitizenAISystem.ts` |
| Car AI/driving | `app/components/game/phaser/systems/CarAISystem.ts` |
| Building rendering | `app/components/game/phaser/systems/BuildingRenderSystem.ts` |
| Pathfinding | `app/components/game/phaser/systems/PathfindingSystem.ts` |
| Day/night visuals | `app/components/game/dayNightCycle.ts` |
| Main menu | `app/components/ui/MainMenu.tsx` |
| Achievements | `app/data/achievements.ts` + `app/utils/achievementStore.ts` |
| Sound effects | `app/utils/sounds.ts` |

## Adding Buildings

Buildings are defined in `app/data/buildings.ts`. Structure:

```typescript
"building-id": {
  id: "building-id",
  name: "Display Name",
  category: "residential" | "commercial" | "civic" | "landmark" | "props" | "christmas",
  footprint: { south: [width, height], east: [width, height], ... },
  sprites: {
    south: "/Building/category/WxHname_south.png",
    east: "/Building/category/WxHname_east.png",
    // ... other orientations
  },
  icon: "/Building/category/WxHname_south.png",
  canRotate: true | false
}
```

**Sprite naming convention:** `{width}x{height}{name}_{direction}.png`

## Phaser Resources

When troubleshooting Phaser issues, check these resources first:

- **Official Examples:** https://phaser.io/examples/v3.85.0 (searchable, covers most use cases)
- **API Docs:** https://newdocs.phaser.io/docs/3.90.0
- **Community Forum:** https://phaser.discourse.group

Common solutions exist for: camera zoom/pan, input handling, tilemaps, physics, animations.

## Code Conventions

- Components: PascalCase
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Building IDs: kebab-case
- Enums: PascalCase values

## Grid Cell Structure

```typescript
{
  type: TileType,
  x, y: number,
  isOrigin?: boolean,        // Top-left of multi-cell building
  originX?, originY?: number,
  buildingId?: string,
  buildingOrientation?: Direction,
  underlyingTileType?: TileType  // For props preserving ground
}
```

## Save/Load

Saves to localStorage under key `hugh-city_save_${cityName}` as JSON (`GameSaveData` in types.ts):
- Grid state, character count, car count, zoom level
- Visual settings, day/night enabled
- Economy state, game time, game speed
- City name, timestamp

Auto-saves silently every in-game week (days 7, 14, 21, 28). Manual save available via toolbar.

## Achievements

Defined in `app/data/achievements.ts`. 16 achievements across 5 categories:
- **Citizens:** Welcome Home, Small Town Vibes, Growing Community, Metropolis Rising
- **Revenue:** Pocket Change, Business Boom, Economic Powerhouse, Tycoon Status
- **Buildings:** First Foundation, Urban Planner, Master Architect
- **Events:** Growing Pains, Night Owl
- **Misc:** Rush Hour, DJ Booth, Demolition Derby

Progress persisted via `achievementStore.ts` (localStorage key: `hugh-city_achievements`).
