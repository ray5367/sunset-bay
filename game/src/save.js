// save.js — localStorage persistence for campaign progress and settings.
// Saves are plain JSON; a corrupt or foreign save is ignored, never fatal.

const SAVE_KEY = 'sunset-bay-save-v1';
const SETTINGS_KEY = 'sunset-bay-settings-v1';

export const DEFAULT_SETTINGS = {
  sound: true,
  music: true,
  volume: 0.8,
  screenShake: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode): settings simply do not persist.
  }
}

export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.game !== 'sunset-bay' || typeof parsed.cash !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ game: 'sunset-bay', ...data }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
