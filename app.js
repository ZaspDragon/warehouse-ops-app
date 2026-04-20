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

/* ---------------- SAFE HELPERS ---------------- */

const $ = (id) => document.getElementById(id);
const exists = (id) => !!document.getElementById(id);

/* ---------------- STATE ---------------- */

let records = loadRecords() || [];
let targets = loadTargets() || DEFAULT_TARGETS;
let activeDepartment = "receiving";
let cachedKpis = null;

/* ---------------- DEPARTMENTS ---------------- */

const deptLabels = {
  inventory: "Inventory",
  receiving: "Receiving",
  putaway: "Putaway",
  picking: "Transfers (Picking)",
  shipping: "Shipping",
  operations: "Operations"
};

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

  navLinks.forEach(btn => {
    btn.addEventListener("click", () => {
      navLinks.forEach(b => b.classList.remove("active"));

      const views = document.querySelectorAll(".view");
      const dashboard = $("dashboard");

      views.forEach(v => v.classList.remove("active"));
      if (dashboard) dashboard.classList.remove("active");

      btn.classList.add("active");

      const viewId = btn.dataset.view;
      const view = $(viewId);

      if (viewId === "dashboard" && dashboard) {
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
  const entryForm = $("entryForm");
  const targetsForm = $("targetsForm");

  if (entryForm) {
    entryForm.addEventListener("submit", e => {
      e.preventDefault();
      saveEntry();
    });
  }

  if (targetsForm) {
    targetsForm.addEventListener("submit", e => {
      e.preventDefault();
      saveTargetsFromForm();
    });
  }
}

/* ---------------- BUTTONS ---------------- */

function bindButtons() {
  $("resetFormBtn")?.addEventListener("click", resetEntryForm);
  $("clearAllBtn")?.addEventListener("click", clearAllData);
  $("exportCsvBtn")?.addEventListener("click", exportCsv);
}

/* ---------------- SAVE ENTRY ---------------- */

function saveEntry() {
  const id = value("editingId");

  const entry = {
    id: id || makeId(),
    date: value("date"),
    employeeName: value("employeeName"),
    department: (value("department") || "").toLowerCase().trim(),

    sku: value("sku"),
    itemName: value("itemName"),
    location: value("location"),

    quantitySystem: numValue("quantitySystem"),
    quantityPhysical: numValue("quantityPhysical"),

    variance:
      numValue("quantityPhysical") - numValue("quantitySystem"),

    poNumber: value("poNumber"),
    quantityReceived: numValue("quantityReceived"),

    transferId: value("transferId"),
    quantityPicked: numValue("quantityPicked"),

    shipmentId: value("shipmentId"),
    quantityShipped: numValue("quantityShipped"),

    startTime: value("startTime"),
    endTime: value("endTime"),

    totalOutput: numValue("totalOutput"),

    status: value("status") || "Pending"
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

  showMessage("Saved");
}

/* ---------------- RESET FORM ---------------- */

function resetEntryForm() {
  $("entryForm")?.reset();
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

/* ---------------- CLEAR DATA ---------------- */

function clearAllData() {
  if (!confirm("Delete all records?")) return;

  records = [];
  saveRecords(records);

  populateFilterOptions(records);

  resetCache();
  renderAll(true);

  showMessage("All records cleared");
}

/* ---------------- RENDER CORE ---------------- */

function renderAll(force = false) {
  const deptRecords = getDeptRecords();

  if (!cachedKpis || force) {
    cachedKpis = calculateKpis(deptRecords || []);
  }

  const title = $("deptTitle");
  if (title) {
    title.textContent =
      deptLabels[activeDepartment] || activeDepartment;
  }

  if (typeof renderDashboard === "function") {
    renderDashboard(cachedKpis, targets, activeDepartment);
  }

  renderSummary(deptRecords);

  if (typeof renderRecordsTable === "function") {
    renderRecordsTable(records || []);
  }
}

/* ---------------- FILTER ---------------- */

function getDeptRecords() {
  return records.filter(r =>
    (r.department || "").toLowerCase().trim() === activeDepartment
  );
}

/* ---------------- SUMMARY ---------------- */

function renderSummary(deptRecords) {
  const el = $("dashboardSummary");
  if (!el) return;

  const total = deptRecords.length;

  const output = deptRecords.reduce(
    (sum, r) => sum + (Number(r.totalOutput || r.quantityPicked || 0)),
    0
  );

  let hours = 0;

  deptRecords.forEach(r => {
    const start = r.startTime ? new Date(r.startTime) : null;
    const end = r.endTime ? new Date(r.endTime) : null;

    if (start && end && !isNaN(start) && !isNaN(end)) {
      hours += (end - start) / 3600000;
    }
  });

  el.innerHTML = `
    <p><strong>Records:</strong> ${total}</p>
    <p><strong>Total Output:</strong> ${output}</p>
    <p><strong>Hours:</strong> ${hours.toFixed(2)}</p>
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
  const el = $("date");
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
document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelectorAll(".nav-link");

  function show(id) {
    document.querySelectorAll(".view, .dashboard-wrapper")
      .forEach(el => el.classList.remove("active"));

    const target = document.getElementById(id);
    if (target) target.classList.add("active");
  }

  navLinks.forEach(btn => {
    btn.addEventListener("click", () => {
      navLinks.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      show(btn.dataset.view);
    });
  });
});
