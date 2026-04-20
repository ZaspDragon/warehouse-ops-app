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

let cachedKpis = null;

/* ---------------- DEPARTMENT MAP ---------------- */

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

/* ---------------- ENTRY SAVE (ENHANCED DATA MODEL) ---------------- */

function saveEntry() {
  const id = value("editingId");

  const entry = {
    id: id || makeId(),

    /* CORE FIELDS (ALL DEPARTMENTS) */
    date: value("date"),
    employeeName: value("employeeName"),
    department: (value("department") || "").toLowerCase().trim(),

    /* ---------------- INVENTORY ---------------- */
    sku: value("sku"),
    itemName: value("itemName"),
    location: value("location"),
    quantitySystem: numValue("quantitySystem"),
    quantityPhysical: numValue("quantityPhysical"),
    variance: numValue("quantityPhysical") - numValue("quantitySystem"),

    /* ---------------- RECEIVING ---------------- */
    poNumber: value("poNumber"),
    quantityExpected: numValue("quantityExpected"),
    quantityReceived: numValue("quantityReceived"),
    dockDoor: value("dockDoor"),
    arrivalTime: value("arrivalTime"),
    putawayStartTime: value("putawayStartTime"),
    putawayEndTime: value("putawayEndTime"),

    /* ---------------- TRANSFERS (PICKING) ---------------- */
    transferId: value("transferId"),
    orderId: value("orderId"),
    quantityRequested: numValue("quantityRequested"),
    quantityPicked: numValue("quantityPicked"),
    pickStartTime: value("pickStartTime"),
    pickEndTime: value("pickEndTime"),
    zone: value("zone"),

    /* ---------------- SHIPPING ---------------- */
    shipmentId: value("shipmentId"),
    carrier: value("carrier"),
    quantityShipped: numValue("quantityShipped"),
    shipTime: value("shipTime"),
    deliveryDueDate: value("deliveryDueDate"),
    deliveryActualDate: value("deliveryActualDate"),
    errorType: value("errorType"),

    /* ---------------- OPERATIONS ---------------- */
    startTime: value("startTime"),
    endTime: value("endTime"),
    totalOutput: numValue("totalOutput"),
    breakTimeMinutes: numValue("breakTimeMinutes"),
    equipmentDowntime: numValue("equipmentDowntime"),

    /* ---------------- STATUS ---------------- */
    status: value("status") || "Pending"
  };

  /* VALIDATION */
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

  showMessage("Entry saved");
}

/* ---------------- KPI FILTER ---------------- */

function renderAll(force = false) {
  const deptRecords = records.filter(
    r => (r.department || "").toLowerCase().trim() === activeDepartment
  );

  if (!cachedKpis || force) {
    cachedKpis = calculateKpis(deptRecords || []);
  }

  setText("deptTitle", deptLabels[activeDepartment] || activeDepartment);

  renderDashboardSafe(cachedKpis, targets, activeDepartment);
  renderDepartmentSummary(deptRecords);
  renderRecordsTableSafe(records);
}

/* ---------------- SAFE RENDERERS ---------------- */

function renderDashboardSafe(kpis, targets, dept) {
  if (typeof renderDashboard === "function") {
    renderDashboard(kpis, targets, dept);
  }
}

function renderRecordsTableSafe(data) {
  if (typeof renderRecordsTable === "function") {
    renderRecordsTable(data || []);
  }
}

/* ---------------- SUMMARY ---------------- */

function renderDepartmentSummary(deptRecords) {
  const total = deptRecords.length;

  const output = deptRecords.reduce((sum, r) =>
    sum + (Number(r.totalOutput || r.unitsProcessed) || 0), 0);

  const hours = deptRecords.reduce((sum, r) => {
    const start = new Date(r.startTime || r.pickStartTime || r.arrivalTime);
    const end = new Date(r.endTime || r.pickEndTime || r.putawayEndTime);
    if (!start || !end) return sum;
    return sum + ((end - start) / 3600000 || 0);
  }, 0);

  const el = document.getElementById("dashboardSummary");
  if (!el) return;

  el.innerHTML = `
    <p><strong>Records:</strong> ${total}</p>
    <p><strong>Total Output:</strong> ${output}</p>
    <p><strong>Hours Worked:</strong> ${hours.toFixed(2)}</p>
  `;
}

/* ---------------- CACHE ---------------- */

function resetCache() {
  cachedKpis = null;
}

/* ---------------- UTIL ---------------- */

function setTodayDefault() {
  const el = document.getElementById("date");
  if (el && !el.value) {
    el.value = new Date().toISOString().slice(0, 10);
  }
}
