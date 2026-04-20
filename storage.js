// storage.js

const STORAGE_KEY = "warehouseKpiRecords_v1";
const TARGETS_KEY = "warehouseKpiTargets_v1";

export function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function loadTargets(defaults) {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(TARGETS_KEY))
    };
  } catch {
    return defaults;
  }
}

export function saveTargets(targets) {
  localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
}

export function clearAllRecords() {
  localStorage.removeItem(STORAGE_KEY);
}
