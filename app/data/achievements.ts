export type AchievementCategory = "citizens" | "revenue" | "buildings" | "events" | "misc";

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  icon: string; // Emoji
  category: AchievementCategory;
  target?: number; // Numeric target for progress bar (optional for event-based)
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // Citizen milestones (housed only)
  { id: "welcome-home",        title: "Welcome Home",         description: "Get your first housed citizen",                     icon: "\uD83C\uDFE0", category: "citizens",  target: 1 },
  { id: "small-town-vibes",    title: "Small Town Vibes",     description: "Have 10 housed citizens",                           icon: "\uD83C\uDFD8\uFE0F", category: "citizens",  target: 10 },
  { id: "growing-community",   title: "Growing Community",    description: "Have 50 housed citizens",                           icon: "\uD83C\uDFD9\uFE0F", category: "citizens",  target: 50 },
  { id: "metropolis-rising",   title: "Metropolis Rising",    description: "Have 100 housed citizens",                          icon: "\uD83C\uDF06", category: "citizens",  target: 100 },

  // Revenue milestones (daily)
  { id: "pocket-change",       title: "Pocket Change",        description: "Make $1,000 revenue in one day",                    icon: "\uD83D\uDCB5", category: "revenue",   target: 1000 },
  { id: "business-boom",       title: "Business Boom",        description: "Make $10,000 revenue in one day",                   icon: "\uD83D\uDCB0", category: "revenue",   target: 10000 },
  { id: "economic-powerhouse", title: "Economic Powerhouse",  description: "Make $50,000 revenue in one day",                   icon: "\uD83C\uDFE6", category: "revenue",   target: 50000 },
  { id: "tycoon-status",       title: "Tycoon Status",        description: "Make $100,000 revenue in one day",                  icon: "\uD83D\uDC8E", category: "revenue",   target: 100000 },

  // Events
  { id: "growing-pains",       title: "Growing Pains",        description: "Have a homeless citizen leave your city",            icon: "\uD83D\uDE22", category: "events" },

  // Building milestones (total placed)
  { id: "first-foundation",    title: "First Foundation",     description: "Build 10 buildings",                                icon: "\uD83E\uDDF1", category: "buildings", target: 10 },
  { id: "urban-planner",       title: "Urban Planner",        description: "Build 25 buildings",                                icon: "\uD83D\uDCD0", category: "buildings", target: 25 },
  { id: "master-architect",    title: "Master Architect",     description: "Build 100 buildings",                               icon: "\uD83C\uDFD7\uFE0F", category: "buildings", target: 100 },

  // Misc / custom
  { id: "night-owl",           title: "Night Owl",            description: "Witness midnight with the day/night cycle enabled",  icon: "\uD83E\uDD89", category: "misc" },
  { id: "rush-hour",           title: "Rush Hour",            description: "Have 5 or more cars driving at once",               icon: "\uD83D\uDE97", category: "misc",      target: 5 },
  { id: "dj-booth",            title: "DJ Booth",             description: "Play all tracks in both music genres",              icon: "\uD83C\uDFB5", category: "misc" },
  { id: "demolition-derby",    title: "Demolition Derby",     description: "Demolish 50 buildings total",                       icon: "\uD83D\uDCA5", category: "misc",      target: 50 },
];

export const ACHIEVEMENT_MAP: Record<string, AchievementDefinition> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  citizens: "Citizens",
  revenue: "Revenue",
  buildings: "Buildings",
  events: "Events",
  misc: "Misc",
};
