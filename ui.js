import { escapeHtml, safeDivide } from "./utils.js";

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ---------- KPI DASHBOARD ---------- */
export function renderDashboard(kpis) {
  const grid = document.getElementById("kpiGrid");
  if (!grid) return;

  const data = [
    ["Labor Productivity", kpis.laborProductivity],
    ["Receiving Accuracy", kpis.receivingAccuracy],
    ["Pick Accuracy", kpis.pickAccuracy],
    ["On-Time Shipment", kpis.onTimeShipmentRate],
    ["Inventory Accuracy", kpis.inventoryAccuracy]
  ];

  grid.innerHTML = data.map(([label, value]) => `
    <div class="kpi-card">
      <div><strong>${label}</strong></div>
      <div>${Number(value || 0).toFixed(2)}</div>
    </div>
  `).join("");
}

/* ---------- TABLE ---------- */
export function renderRecordsTable(records) {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = records.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.employeeName)}</td>
      <td>${escapeHtml(r.department)}</td>
      <td>${Number(r.unitsProcessed || 0)}</td>
      <td>${Number(r.hoursWorked || 0)}</td>
      <td>${safeDivide(r.unitsProcessed, r.hoursWorked).toFixed(2)}</td>
    </tr>
  `).join("");
}
