// utils.js

export function safeDivide(a, b) {
  a = Number(a || 0);
  b = Number(b || 0);
  return b > 0 ? a / b : 0;
}

export function pct(a, b) {
  a = Number(a || 0);
  b = Number(b || 0);
  return b > 0 ? (a / b) * 100 : 0;
}

export function avg(list) {
  return list.length
    ? list.reduce((sum, n) => sum + n, 0) / list.length
    : 0;
}

export function sum(records, field) {
  return records.reduce((t, r) => t + Number(r[field] || 0), 0);
}

export function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
