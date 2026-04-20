// ui.js
import { escapeHtml, safeDivide } from "./utils.js";

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function renderDashboard(kpis) {
  setText("laborProductivityValue", kpis.laborProductivity.toFixed(2));
  setText("receivingAccuracyValue", kpis.receivingAccuracy.toFixed(1) + "%");
  setText("pickAccuracyValue", kpis.pickAccuracy.toFixed(1) + "%");
  setText("onTimeShipmentRateValue", kpis.onTimeShipmentRate.toFixed(1) + "%");
}

export function renderRecordsTable(records) {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = records.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.employeeName)}</td>
      <td>${escapeHtml(r.department)}</td>
      <td>${r.unitsProcessed}</td>
      <td>${r.hoursWorked}</td>
      <td>${safeDivide(r.unitsProcessed, r.hoursWorked).toFixed(2)}</td>
    </tr>
  `).join("");
}
