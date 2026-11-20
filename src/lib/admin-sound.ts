/**
 * Sound alert for new payment requests in the admin panel (browser only).
 * Uses the Web Audio API (no audio file to load). Browsers only allow sound
 * after a user interaction, so the context is unlocked on the first click/key
 * press; until then `isBlocked()` is true and the panel asks the admin to click.
 * Settings (on/off, volume) are kept per browser in localStorage.
 */

export type SoundSettings = { enabled: boolean; volume: number };

const SETTINGS_KEY = "igw_admin_sound";
const LAST_SEEN_KEY = "igw_admin_last_request_notification";

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundSettings> | null;
    const volume = Number(raw?.volume);
    return { enabled: raw?.enabled !== false, volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7 };
  } catch {
    return { enabled: true, volume: 0.7 };
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this page only */
  }
}

/** Highest "new payment request" notification id this browser has already announced. */
export function loadLastSeen(): number | null {
  try {
    const value = window.localStorage.getItem(LAST_SEEN_KEY);
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

export function saveLastSeen(id: number): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, String(id));
  } catch {
    /* ignore */
  }
}

/** Try to start audio (must run inside a user gesture to succeed). */
export async function unlockAudio(): Promise<boolean> {
  const ctx = getContext();
  if (!ctx) return false;
  try {
    if (ctx.state !== "running") await ctx.resume();
  } catch {
    /* still blocked */
  }
  return ctx.state === "running";
}

export function isBlocked(): boolean {
  const ctx = getContext();
  return !ctx || ctx.state !== "running";
}

/** Two-tone chime. Returns false if the browser blocked audio. */
export function playChime(volume: number): boolean {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running" || volume <= 0) return false;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * volume), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  [880, 1318.5].forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, now + i * 0.18);
    osc.connect(gain);
    osc.start(now + i * 0.18);
    osc.stop(now + 0.9);
  });
  return true;
}
