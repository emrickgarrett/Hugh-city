// Daily budget range for citizens
export const MIN_DAILY_BUDGET = 120;
export const MAX_DAILY_BUDGET = 220;

// Generate unique ID
export const generateId = () => Math.random().toString(36).substring(2, 9);

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

export const generateRandomName = (): string => {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${firstName} ${lastName}`;
};

// Deterministic snow variant based on grid position
export function getSnowTextureKey(x: number, y: number): string {
  // Simple hash to pick variant 1-3 based on position
  const variant = ((x * 7 + y * 13) % 3) + 1;
  return `snow_${variant}`;
}

// Depth layer system constants
export const DEPTH_Y_MULT = 10000;
export const CAMERA_SPEED = 8;

// Zoom levels matching React state
export const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];
export const ZOOM_ANCHOR_TIMEOUT = 150; // ms to keep anchor locked

// Building interaction distance
export const MAX_INTERACTION_DISTANCE = 3;
