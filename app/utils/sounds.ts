// UI Sound utilities

// Global SFX volume multiplier (0–1), set by settings menu
let _sfxVolume = 1.0;
export function setSfxVolume(v: number) { _sfxVolume = Math.max(0, Math.min(1, v)); }
export function getSfxVolume(): number { return _sfxVolume; }

// Create and cache audio elements for better performance
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudio(path: string): HTMLAudioElement {
  if (!audioCache[path]) {
    audioCache[path] = new Audio(path);
  }
  return audioCache[path];
}

// Play a sound effect with optional volume
function playSound(path: string, volume: number = 0.5) {
  // Clone the audio to allow overlapping plays
  const audio = getAudio(path).cloneNode() as HTMLAudioElement;
  audio.volume = volume * _sfxVolume;
  audio.play().catch(() => {
    // Ignore autoplay errors
  });
}

// Lazy-init shared AudioContext for synthesized sounds
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext();
    }
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === "suspended") {
      _audioCtx.resume();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

// UI Sounds (file-based)
export const playOpenSound = () => playSound("/audio/open.mp3", 0.5);
export const playDoubleClickSound = () => playSound("/audio/double_click.mp3", 0.5);
export const playClickSound = () => playSound("/audio/click.mp3", 0.25);

// Game sounds (file-based)
export const playDestructionSound = () => playSound("/audio/destruction.mp3", 0.25);
export const playBuildSound = () => playSound("/audio/build.mp3", 0.25);
export const playBuildRoadSound = () => playSound("/audio/buildroad.mp3", 0.25);

// ── Synthesized sounds (Web Audio API) ──────────────────────────────

// Error / denial buzz — short low-frequency buzz for "can't do that"
export function playErrorSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.linearRampToValueAtTime(100, t + 0.15);
  gain.gain.setValueAtTime(0.12 * _sfxVolume, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

// Zoom tick — subtle high-pitched tick for zoom button clicks
export function playZoomSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.linearRampToValueAtTime(800, t + 0.06);
  gain.gain.setValueAtTime(0.08 * _sfxVolume, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.08);
}

// Speed change — ascending or descending tone for game speed changes
export function playSpeedUpSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.linearRampToValueAtTime(800, t + 0.1);
  gain.gain.setValueAtTime(0.1 * _sfxVolume, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

export function playSpeedDownSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.linearRampToValueAtTime(400, t + 0.1);
  gain.gain.setValueAtTime(0.1 * _sfxVolume, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

export function playPauseSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Two quick descending tones
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const offset = i * 0.07;
    osc.frequency.setValueAtTime(600 - i * 200, t + offset);
    gain.gain.setValueAtTime(0.08 * _sfxVolume, t + offset);
    gain.gain.linearRampToValueAtTime(0, t + offset + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.06);
  }
}

export function playUnpauseSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Two quick ascending tones
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const offset = i * 0.07;
    osc.frequency.setValueAtTime(400 + i * 200, t + offset);
    gain.gain.setValueAtTime(0.08 * _sfxVolume, t + offset);
    gain.gain.linearRampToValueAtTime(0, t + offset + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.06);
  }
}

// Cash register — soft gentle coin chime for money events
export function playCashSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Soft low chime
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(800, t);
  gain1.gain.setValueAtTime(0.015 * _sfxVolume, t);
  gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc1.connect(gain1).connect(ctx.destination);
  osc1.start(t);
  osc1.stop(t + 0.12);

  // Gentle higher note slightly delayed
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1200, t + 0.05);
  gain2.gain.setValueAtTime(0.01 * _sfxVolume, t + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start(t + 0.05);
  osc2.stop(t + 0.15);
}

// Achievement fanfare — triumphant ascending chord
export function playAchievementSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const offset = i * 0.1;
    osc.frequency.setValueAtTime(freq, t + offset);
    gain.gain.setValueAtTime(0.1 * _sfxVolume, t + offset);
    gain.gain.setValueAtTime(0.1 * _sfxVolume, t + offset + 0.15);
    gain.gain.linearRampToValueAtTime(0, t + offset + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.4);
  });
}

