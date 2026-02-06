/**
 * Day/Night Cycle Visual Calculator
 *
 * Pure utility — maps the current game hour to visual parameters.
 * Uses keyframe interpolation with smoothstep easing for smooth transitions.
 */

export interface DayNightVisuals {
  // CSS filter values (applied to the Phaser wrapper div)
  blueness: number; // hue-rotate degrees
  contrast: number;
  saturation: number;
  brightness: number;

  // Phaser background sky color (hex string like "#3d5560")
  skyColor: string;

  // Lamp glow intensity multiplier (0 = off during day, 1 = full at night)
  glowIntensity: number;

  // Current lighting phase name
  phase: "night" | "dawn" | "day" | "sunset" | "dusk";
}

// Keyframe definition
interface Keyframe {
  h: number; // hour (fractional, e.g. 18.5 = 6:30 PM)
  blue: number;
  con: number;
  sat: number;
  bri: number;
  sky: string;
  glow: number;
}

// Visual keyframes at specific times of day
const KEYFRAMES: Keyframe[] = [
  // Deep night (midnight - 4am): dark blue, dim
  { h: 0, blue: 25, con: 0.85, sat: 0.6, bri: 0.45, sky: "#0a1628", glow: 1.0 },
  // Pre-dawn (4-5am): slightly lighter
  { h: 4, blue: 20, con: 0.85, sat: 0.65, bri: 0.5, sky: "#121f35", glow: 0.9 },
  // Dawn start (5am): warm hints on horizon
  { h: 5, blue: 5, con: 0.9, sat: 0.8, bri: 0.6, sky: "#2d3a52", glow: 0.7 },
  // Sunrise (6am): orange-pink warmth
  { h: 6, blue: -15, con: 0.95, sat: 1.05, bri: 0.75, sky: "#5a4a60", glow: 0.3 },
  // Early morning (7am): transitioning to normal
  { h: 7, blue: -5, con: 1.0, sat: 1.0, bri: 0.9, sky: "#4d6070", glow: 0.0 },
  // Full day (9am - 3pm): normal, bright
  { h: 9, blue: 0, con: 1.0, sat: 1.0, bri: 1.0, sky: "#3d5560", glow: 0.0 },
  { h: 15, blue: 0, con: 1.0, sat: 1.0, bri: 1.0, sky: "#3d5560", glow: 0.0 },
  // Late afternoon (4pm): slightly warm
  { h: 16, blue: -3, con: 1.0, sat: 1.02, bri: 0.98, sky: "#3d5560", glow: 0.0 },
  // Sunset (5-6pm): warm orange
  { h: 17, blue: -20, con: 1.05, sat: 1.1, bri: 0.85, sky: "#6b4a45", glow: 0.2 },
  // Dusk (6:30pm): transitioning to cool
  { h: 18.5, blue: -5, con: 0.95, sat: 0.9, bri: 0.7, sky: "#3a3555", glow: 0.5 },
  // Evening (7pm): blue tone settling in
  { h: 19, blue: 15, con: 0.9, sat: 0.75, bri: 0.55, sky: "#1e2540", glow: 0.8 },
  // Night (8pm+): deep blue
  { h: 20, blue: 25, con: 0.85, sat: 0.6, bri: 0.45, sky: "#0a1628", glow: 1.0 },
  // Wrap sentinel (midnight again)
  { h: 24, blue: 25, con: 0.85, sat: 0.6, bri: 0.45, sky: "#0a1628", glow: 1.0 },
];

/** Linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smoothstep for less jarring transitions */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpolate between two hex color strings */
function lerpColor(hexA: string, hexB: string, t: number): string {
  const parseHex = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Determine the lighting phase name from the hour */
function getPhase(t: number): DayNightVisuals["phase"] {
  if (t >= 5 && t < 7) return "dawn";
  if (t >= 7 && t < 17) return "day";
  if (t >= 17 && t < 18.5) return "sunset";
  if (t >= 18.5 && t < 20) return "dusk";
  return "night";
}

/**
 * Compute day/night visual parameters from the current game hour and minute.
 * Returns smoothly interpolated values between keyframes.
 */
export function computeDayNightVisuals(
  hour: number,
  minute: number
): DayNightVisuals {
  const t = hour + minute / 60; // Fractional hour, e.g. 6.5 = 6:30 AM

  // Find the two keyframes we're between
  let k0 = KEYFRAMES[0];
  let k1 = KEYFRAMES[1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (t >= KEYFRAMES[i].h && t < KEYFRAMES[i + 1].h) {
      k0 = KEYFRAMES[i];
      k1 = KEYFRAMES[i + 1];
      break;
    }
  }

  // Compute smooth interpolation factor (0-1)
  const raw = k1.h === k0.h ? 0 : (t - k0.h) / (k1.h - k0.h);
  const f = smoothstep(Math.max(0, Math.min(1, raw)));

  return {
    blueness: lerp(k0.blue, k1.blue, f),
    contrast: lerp(k0.con, k1.con, f),
    saturation: lerp(k0.sat, k1.sat, f),
    brightness: lerp(k0.bri, k1.bri, f),
    skyColor: lerpColor(k0.sky, k1.sky, f),
    glowIntensity: lerp(k0.glow, k1.glow, f),
    phase: getPhase(t),
  };
}
