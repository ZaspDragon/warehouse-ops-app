import {
  loadRecords,
  saveRecords,
  loadTargets,
  saveTargets,
  DEFAULT_TARGETS
} from "./storage.js";

import { calculateKpis } from "./kpi.js";

import {
  setValue,
  setText,
  value,
  numValue,
  showMessage,
  populateFilterOptions,
  renderDashboard,
  renderRecordsTable
} from "./ui.js";

import { makeId } from "./utils.js";

/* ---------------- STATE ---------------- */

let records = loadRecords() || [];
let targets = loadTargets() || DEFAULT_TARGETS;
let activeDepartment = "receiving";

const deptLabels = {
  receiving: "Receiving",
  putaway: "Putaway",
  picking: "Picking",
  shipping: "Shipping",
  inventory: "Inventory",
  operations: "Operations"
};

const deptOrder = [
  "receiving",
  "putaway",
  "picking",
  "shipping",
  "inventory",
  "operations"
];

let cachedKpis = null;

/* ---------------- INIT ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindDepartmentTabs();
  bindForms();
  bindButtons();
  initTargetsForm();
  populateFilterOptions(records);
  setTodayDefault();
  renderAll(true);
});

/* ---------------- NAVIGATION ---------------- */

function bindNavigation() {
  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll(".view");
  const dashboard = document.getElementById("dashboard");

  navLinks.forEach(btn => {
    btn.addEventListener("click", () => {
      navLinks.forEach(b => b.classList.remove("active"));
      views.forEach(v => v.classList.remove("active"));
      dashboard.classList.remove("active");

      btn.classList.add("active");

      const viewId = btn.dataset.view;
      const view = document.getElementById(viewId);

      if (viewId === "dashboard") {
        dashboard.classList.add("active");
      } else if (view) {
        view.classList.add("active");
      }
    });
  });
}

/* ---------------- DEPARTMENTS ---------------- */

function bindDepartmentTabs() {
  const deptButtons = document.querySelectorAll(".dept-link");

  deptButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      deptButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      activeDepartment = btn.dataset.dept;

      renderAll(true);
    });
  });
}

/* ---------------- FORMS ---------------- */

function bindForms() {
  document.getElementById("entryForm")?.addEventListener("submit", e => {
    e.preventDefault();
    saveEntry();
  });

  document.getElementById("targetsForm")?.addEventListener("submit", e => {
    e.preventDefault();
    saveTargetsFromForm();
  });
}

/* ---------------- BUTTONS ---------------- */

function bindButtons() {
  document.getElementById("resetFormBtn")?.addEventListener("click", resetEntryForm);
  document.getElementById("clearAllBtn")?.addEventListener("click", clearAllData);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);
}

/* ---------------- SAVE ENTRY ---------------- */

function saveEntry() {
  const id = value("editingId");

  const entry = {
    id: id || makeId(),
    date: value("date"),
    employeeName: value("employeeName"),
    department: (value("department") || "").toLowerCase().trim(),
    hoursWorked: numValue("hoursWorked"),
    unitsProcessed: numValue("unitsProcessed"),
    errors: numValue("errors"),
    shipments: numValue("shipments"),
    onTimeShipments: numValue("onTimeShipments"),
    equipmentDowntime: numValue("equipmentDowntime")
  };

  if (!entry.date || !entry.employeeName || !entry.department) {
    showMessage("Missing required fields", "error");
    return;
  }

  if (id) {
    records = records.map(r => (r.id === id ? entry : r));
  } else {
    records.unshift(entry);
  }

  saveRecords(records);
  populateFilterOptions(records);

  resetCache();
  renderAll(true);
  resetEntryForm();

  showMessage("Saved");
}

/* ---------------- RESET ---------------- */

function resetEntryForm() {
  document.getElementById("entryForm")?.reset();
  setValue("editingId", "");
  setTodayDefault();
}

/* ---------------- TARGETS ---------------- */

function initTargetsForm() {
  Object.entries(targets).forEach(([key, val]) => {
    setValue(`target${capitalize(key)}`, val);
  });
}

function saveTargetsFromForm() {
  Object.keys(DEFAULT_TARGETS).forEach(key => {
    targets[key] = numValue(`target${capitalize(key)}`);
  });

  saveTargets(targets);

  resetCache();
  renderAll(true);

  showMessage("Targets saved");
}

/* ---------------- CLEAR ---------------- */

function clearAllData() {
  if (!confirm("Delete all records?")) return;

  records = [];
  saveRecords(records);

  populateFilterOptions(records);

  resetCache();
  renderAll(true);

  showMessage("All records cleared");
}

/* ---------------- RENDER ---------------- */

function renderAll(force = false) {
  const deptRecords = getDepartmentRecords();

  if (!cachedKpis || force) {
    cachedKpis = calculateKpis(deptRecords || []);
  }

  setText("deptTitle", deptLabels[activeDepartment] || activeDepartment);

  safeRenderDashboard(cachedKpis, targets, activeDepartment);
  renderDepartmentSummary(deptRecords);
  safeRenderTable(records);
}

/* ---------------- SAFE HELPERS ---------------- */

function safeRenderDashboard(kpis, targets, dept) {
  if (typeof renderDashboard === "function") {
    renderDashboard(kpis, targets, dept);
  }
}

function safeRenderTable(data) {
  if (typeof renderRecordsTable === "function") {
    renderRecordsTable(data || []);
  }
}

/* ---------------- FILTERING ---------------- */

function getDepartmentRecords() {
  return records.filter(r =>
    (r.department || "").toLowerCase().trim() === activeDepartment
  );
}

/* ---------------- SUMMARY ---------------- */

function renderDepartmentSummary(deptRecords) {
  const total = deptRecords.length;

  const hours = deptRecords.reduce((sum, r) => sum + (Number(r.hoursWorked) || 0), 0);
  const units = deptRecords.reduce((sum, r) => sum + (Number(r.unitsProcessed) || 0), 0);
  const errors = deptRecords.reduce((sum, r) => sum + (Number(r.errors) || 0), 0);

  const el = document.getElementById("dashboardSummary");
  if (!el) return;

  el.innerHTML = `
    <p><strong>Records:</strong> ${total}</p>
    <p><strong>Hours:</strong> ${hours}</p>
    <p><strong>Units:</strong> ${units}</p>
    <p><strong>Errors:</strong> ${errors}</p>
  `;
}

/* ---------------- EXPORT ---------------- */

function exportCsv() {
  if (!records.length) return showMessage("No data", "error");

  const keys = Object.keys(records[0]);

  const rows = records.map(r =>
    keys.map(k => `"${String(r[k] ?? "").replaceAll('"', '""')}"`).join(",")
  );

  const csv = [keys.join(","), ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "warehouse-data.csv";
  a.click();

  URL.revokeObjectURL(url);
}

/* ---------------- UTIL ---------------- */

function setTodayDefault() {
  const el = document.getElementById("date");
  if (el && !el.value) {
    el.value = new Date().toISOString().slice(0, 10);
  }
}

function resetCache() {
  cachedKpis = null;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
