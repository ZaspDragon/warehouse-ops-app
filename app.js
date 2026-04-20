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
  activateView,
  populateFilterOptions,
  renderDashboard,
  renderRecordsTable
} from "./ui.js";

import { makeId } from "./utils.js";

// ================= STATE =================
let records = loadRecords();
let targets = loadTargets();

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindForms();
  bindButtons();
  initTargetsForm();
  populateFilterOptions(records);
  renderAll();
  setTodayDefault();
});

// ================= NAV =================
function bindNavigation() {
  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll(".view");

  navLinks.forEach(btn => {
    btn.addEventListener("click", () => {
      navLinks.forEach(b => b.classList.remove("active"));
      views.forEach(v => v.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(btn.dataset.view)?.classList.add("active");
    });
  });
}

// ================= FORMS =================
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

// ================= BUTTONS =================
function bindButtons() {
  document.getElementById("resetFormBtn")?.addEventListener("click", resetEntryForm);
  document.getElementById("clearAllBtn")?.addEventListener("click", clearAllData);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);
}

// ================= ENTRY =================
function saveEntry() {
  const id = value("editingId");

  const entry = {
    id: id || makeId(),
    date: value("date"),
    employeeName: value("employeeName"),
    department: value("department"),

    hoursWorked: numValue("hoursWorked"),
    unitsProcessed: numValue("unitsProcessed"),
    errors: numValue("errors"),

    shipments: numValue("shipments"),
    onTimeShipments: numValue("onTimeShipments"),

    equipmentDowntime: numValue("equipmentDowntime")
  };

  if (!entry.date || !entry.employeeName) {
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
  renderAll();
  resetEntryForm();
  showMessage("Saved");
}

function resetEntryForm() {
  document.getElementById("entryForm")?.reset();
  setValue("editingId", "");
}

// ================= TARGETS =================
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
  renderAll();
  showMessage("Targets saved");
}

// ================= DATA =================
function clearAllData() {
  if (!confirm("Delete all records?")) return;

  records = [];
  saveRecords(records);
  renderAll();
}

// ================= RENDER =================
function renderAll() {
  const kpis = calculateKpis(records);

  renderDashboard(kpis, targets);
  renderRecordsTable(records);
}

// ================= EXPORT =================
function exportCsv() {
  if (!records.length) return showMessage("No data", "error");

  const keys = Object.keys(records[0]);

  const rows = records.map(r =>
    keys.map(k => `"${r[k] ?? ""}"`).join(",")
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

// ================= HELPERS =================
function setTodayDefault() {
  const el = document.getElementById("date");
  if (el && !el.value) {
    el.value = new Date().toISOString().slice(0, 10);
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
