const STORAGE_KEY = "warehouseKpiRecords_v1";
const TARGETS_KEY = "warehouseKpiTargets_v1";

const DEFAULT_TARGETS = {
  laborProductivity: 25,
  receivingAccuracy: 99,
  putawayAccuracy: 99,
  pickAccuracy: 99.8,
  onTimeShipmentRate: 98,
  damageFreeRate: 99,
  dockToStock: 240,
  putawayCycleTime: 60,
  travelTimePercent: 35,
  equipmentDowntime: 30
};

let records = loadRecords();
let targets = loadTargets();
let messageTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindGlobalButtons();
  bindEntryForm();
  bindTargetsForm();
  bindFilters();
  initTargetsForm();
  populateFilterOptions();
  renderAll();
  setTodayDefault();
});

function bindNavigation() {
  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll(".view");
  const menuToggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("sidebar");

  navLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      navLinks.forEach((b) => b.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));

      btn.classList.add("active");
      const targetView = document.getElementById(btn.dataset.view);
      if (targetView) targetView.classList.add("active");

      if (window.innerWidth <= 820) {
        sidebar.classList.remove("open");
      }
    });
  });

  menuToggle?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });
}

function bindGlobalButtons() {
  document.getElementById("loadDemoBtn")?.addEventListener("click", loadDemoData);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);
  document.getElementById("clearAllBtn")?.addEventListener("click", clearAllData);
  document.getElementById("resetFormBtn")?.addEventListener("click", resetEntryForm);
  document.getElementById("resetFiltersBtn")?.addEventListener("click", resetFilters);
  document.getElementById("resetTargetsBtn")?.addEventListener("click", resetTargets);
}

function bindEntryForm() {
  const form = document.getElementById("entryForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveEntry();
  });
}

function bindTargetsForm() {
  const form = document.getElementById("targetsForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveTargetsFromForm();
  });
}

function bindFilters() {
  [
    "filterStartDate",
    "filterEndDate",
    "filterDepartment",
    "filterEmployee"
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderAll);
    document.getElementById(id)?.addEventListener("change", renderAll);
  });
}

function setTodayDefault() {
  const dateInput = document.getElementById("date");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

function showMessage(text, type = "success") {
  const bar = document.getElementById("messageBar");
  if (!bar) return;

  bar.textContent = text;
  bar.classList.remove("hidden");
  bar.style.background = type === "error" ? "#ffe7e7" : "#dff4ea";
  bar.style.color = type === "error" ? "#8a1f1f" : "#145a32";
  bar.style.borderColor = type === "error" ? "#f0baba" : "#bfe7cf";

  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    bar.classList.add("hidden");
  }, 2800);
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function loadTargets() {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    return raw ? { ...DEFAULT_TARGETS, ...JSON.parse(raw) } : { ...DEFAULT_TARGETS };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

function saveTargets() {
  localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
}

function initTargetsForm() {
  setValue("targetLaborProductivity", targets.laborProductivity);
  setValue("targetReceivingAccuracy", targets.receivingAccuracy);
  setValue("targetPutawayAccuracy", targets.putawayAccuracy);
  setValue("targetPickAccuracy", targets.pickAccuracy);
  setValue("targetOnTimeShipmentRate", targets.onTimeShipmentRate);
  setValue("targetDamageFreeRate", targets.damageFreeRate);
  setValue("targetDockToStock", targets.dockToStock);
  setValue("targetPutawayCycleTime", targets.putawayCycleTime);
  setValue("targetTravelTimePercent", targets.travelTimePercent);
  setValue("targetEquipmentDowntime", targets.equipmentDowntime);
}

function saveTargetsFromForm() {
  targets = {
    laborProductivity: numValue("targetLaborProductivity"),
    receivingAccuracy: numValue("targetReceivingAccuracy"),
    putawayAccuracy: numValue("targetPutawayAccuracy"),
    pickAccuracy: numValue("targetPickAccuracy"),
    onTimeShipmentRate: numValue("targetOnTimeShipmentRate"),
    damageFreeRate: numValue("targetDamageFreeRate"),
    dockToStock: numValue("targetDockToStock"),
    putawayCycleTime: numValue("targetPutawayCycleTime"),
    travelTimePercent: numValue("targetTravelTimePercent"),
    equipmentDowntime: numValue("targetEquipmentDowntime")
  };

  saveTargets();
  renderDashboard();
  showMessage("Targets saved.");
}

function resetTargets() {
  if (!confirm("Reset KPI targets to defaults?")) return;
  targets = { ...DEFAULT_TARGETS };
  saveTargets();
  initTargetsForm();
  renderDashboard();
  showMessage("Targets reset.");
}

function saveEntry() {
  const editingId = document.getElementById("editingId").value.trim();
  const existing = records.find((r) => r.id === editingId);

  const entry = {
    id: editingId || makeId(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    date: value("date"),
    employeeName: value("employeeName").trim(),
    department: value("department"),

    hoursWorked: numValue("hoursWorked"),
    unitsProcessed: numValue("unitsProcessed"),
    errors: numValue("errors"),

    dockToStock: numValue("dockToStock"),
    totalReceipts: numValue("totalReceipts"),
    correctReceipts: numValue("correctReceipts"),

    totalPutaways: numValue("totalPutaways"),
    correctPutaways: numValue("correctPutaways"),
    putawayTime: numValue("putawayTime"),

    inventoryCount: numValue("inventoryCount"),
    inventorySystemCount: numValue("inventorySystemCount"),
    shrinkageQty: numValue("shrinkageQty"),
    storageUsed: numValue("storageUsed"),
    storageCapacity: numValue("storageCapacity"),

    totalPicks: numValue("totalPicks"),
    correctPicks: numValue("correctPicks"),
    pickLines: numValue("pickLines"),
    travelTimePercent: numValue("travelTimePercent"),
    pickToShipTime: numValue("pickToShipTime"),
    costPerPick: numValue("costPerPick"),

    shipments: numValue("shipments"),
    onTimeShipments: numValue("onTimeShipments"),
    damageFreeShipments: numValue("damageFreeShipments"),
    shippingCost: numValue("shippingCost"),
    meanTimeToShip: numValue("meanTimeToShip"),

    equipmentDowntime: numValue("equipmentDowntime"),
    incidentCount: numValue("incidentCount"),

    notes: value("notes").trim()
  };

  if (!entry.date || !entry.employeeName || !entry.department) {
    showMessage("Date, employee name, and department are required.", "error");
    return;
  }

  if (editingId) {
    records = records.map((r) => (r.id === editingId ? entry : r));
    showMessage("Entry updated.");
  } else {
    records.unshift(entry);
    showMessage("Entry saved.");
  }

  saveRecords();
  populateFilterOptions();
  renderAll();
  resetEntryForm();
}

function resetEntryForm() {
  const form = document.getElementById("entryForm");
  form?.reset();
  setValue("editingId", "");
  document.getElementById("saveEntryBtn").textContent = "Save Entry";
  setTodayDefault();
}

function editRecord(id) {
  const record = records.find((r) => r.id === id);
  if (!record) return;

  setValue("editingId", record.id);
  setValue("date", record.date);
  setValue("employeeName", record.employeeName);
  setValue("department", record.department);

  setValue("hoursWorked", record.hoursWorked);
  setValue("unitsProcessed", record.unitsProcessed);
  setValue("errors", record.errors);

  setValue("dockToStock", record.dockToStock);
  setValue("totalReceipts", record.totalReceipts);
  setValue("correctReceipts", record.correctReceipts);

  setValue("totalPutaways", record.totalPutaways);
  setValue("correctPutaways", record.correctPutaways);
  setValue("putawayTime", record.putawayTime);

  setValue("inventoryCount", record.inventoryCount);
  setValue("inventorySystemCount", record.inventorySystemCount);
  setValue("shrinkageQty", record.shrinkageQty);
  setValue("storageUsed", record.storageUsed);
  setValue("storageCapacity", record.storageCapacity);

  setValue("totalPicks", record.totalPicks);
  setValue("correctPicks", record.correctPicks);
  setValue("pickLines", record.pickLines);
  setValue("travelTimePercent", record.travelTimePercent);
  setValue("pickToShipTime", record.pickToShipTime);
  setValue("costPerPick", record.costPerPick);

  setValue("shipments", record.shipments);
  setValue("onTimeShipments", record.onTimeShipments);
  setValue("damageFreeShipments", record.damageFreeShipments);
  setValue("shippingCost", record.shippingCost);
  setValue("meanTimeToShip", record.meanTimeToShip);

  setValue("equipmentDowntime", record.equipmentDowntime);
  setValue("incidentCount", record.incidentCount);
  setValue("notes", record.notes);

  document.getElementById("saveEntryBtn").textContent = "Update Entry";

  activateView("entryView");
  showMessage("Record loaded for editing.");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteRecord(id) {
  if (!confirm("Delete this record?")) return;
  records = records.filter((r) => r.id !== id);
  saveRecords();
  populateFilterOptions();
  renderAll();
  showMessage("Record deleted.");
}

function clearAllData() {
  if (!confirm("This will delete all saved records. Continue?")) return;
  records = [];
  saveRecords();
  populateFilterOptions();
  renderAll();
  showMessage("All data cleared.");
}

function loadDemoData() {
  if (!confirm("Replace current records with demo data?")) return;

  const demo = [
    makeDemo("2026-04-14", "Brandon", "Receiving", {
      hoursWorked: 8,
      unitsProcessed: 610,
      errors: 3,
      dockToStock: 165,
      totalReceipts: 140,
      correctReceipts: 138,
      totalPutaways: 0,
      correctPutaways: 0,
      shipments: 0,
      onTimeShipments: 0,
      equipmentDowntime: 15
    }),
    makeDemo("2026-04-14", "Henry", "Putaway", {
      hoursWorked: 8,
      unitsProcessed: 520,
      errors: 2,
      totalPutaways: 120,
      correctPutaways: 118,
      putawayTime: 42,
      equipmentDowntime: 10
    }),
    makeDemo("2026-04-15", "Kristopher", "Picking", {
      hoursWorked: 8,
      unitsProcessed: 750,
      errors: 4,
      totalPicks: 330,
      correctPicks: 327,
      pickLines: 210,
      travelTimePercent: 31,
      pickToShipTime: 54
    }),
    makeDemo("2026-04-15", "Dawitt", "Shipping", {
      hoursWorked: 8,
      unitsProcessed: 680,
      errors: 1,
      shipments: 115,
      onTimeShipments: 112,
      damageFreeShipments: 114,
      shippingCost: 460,
      meanTimeToShip: 78
    }),
    makeDemo("2026-04-16", "Yussif", "Inventory", {
      hoursWorked: 8,
      unitsProcessed: 290,
      errors: 1,
      inventoryCount: 1490,
      inventorySystemCount: 1500,
      shrinkageQty: 10,
      storageUsed: 870,
      storageCapacity: 1000
    }),
    makeDemo("2026-04-16", "Brandon", "Operations", {
      hoursWorked: 8,
      unitsProcessed: 420,
      errors: 0,
      equipmentDowntime: 22,
      incidentCount: 0
    })
  ];

  records = demo;
  saveRecords();
  populateFilterOptions();
  renderAll();
  showMessage("Demo data loaded.");
}

function makeDemo(date, employeeName, department, overrides = {}) {
  return {
    id: makeId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    date,
    employeeName,
    department,
    hoursWorked: 0,
    unitsProcessed: 0,
    errors: 0,
    dockToStock: 0,
    totalReceipts: 0,
    correctReceipts: 0,
    totalPutaways: 0,
    correctPutaways: 0,
    putawayTime: 0,
    inventoryCount: 0,
    inventorySystemCount: 0,
    shrinkageQty: 0,
    storageUsed: 0,
    storageCapacity: 0,
    totalPicks: 0,
    correctPicks: 0,
    pickLines: 0,
    travelTimePercent: 0,
    pickToShipTime: 0,
    costPerPick: 0,
    shipments: 0,
    onTimeShipments: 0,
    damageFreeShipments: 0,
    shippingCost: 0,
    meanTimeToShip: 0,
    equipmentDowntime: 0,
    incidentCount: 0,
    notes: "",
    ...overrides
  };
}

function exportCsv() {
  if (!records.length) {
    showMessage("No records to export.", "error");
    return;
  }

  const headers = [
    "id", "createdAt", "updatedAt", "date", "employeeName", "department",
    "hoursWorked", "unitsProcessed", "errors",
    "dockToStock", "totalReceipts", "correctReceipts",
    "totalPutaways", "correctPutaways", "putawayTime",
    "inventoryCount", "inventorySystemCount", "shrinkageQty",
    "storageUsed", "storageCapacity",
    "totalPicks", "correctPicks", "pickLines", "travelTimePercent",
    "pickToShipTime", "costPerPick",
    "shipments", "onTimeShipments", "damageFreeShipments",
    "shippingCost", "meanTimeToShip",
    "equipmentDowntime", "incidentCount", "notes"
  ];

  const rows = records.map((r) =>
    headers.map((key) => csvEscape(r[key]))
  );

  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "warehouse-kpi-records.csv";
  a.click();

  URL.revokeObjectURL(url);
  showMessage("CSV exported.");
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function populateFilterOptions() {
  const departmentSelect = document.getElementById("filterDepartment");
  const employeeSelect = document.getElementById("filterEmployee");

  const currentDepartment = departmentSelect?.value || "";
  const currentEmployee = employeeSelect?.value || "";

  const departments = [...new Set(records.map((r) => r.department).filter(Boolean))].sort();
  const employees = [...new Set(records.map((r) => r.employeeName).filter(Boolean))].sort();

  if (departmentSelect) {
    departmentSelect.innerHTML = `<option value="">All Departments</option>` +
      departments.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    departmentSelect.value = currentDepartment;
  }

  if (employeeSelect) {
    employeeSelect.innerHTML = `<option value="">All Employees</option>` +
      employees.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");
    employeeSelect.value = currentEmployee;
  }
}

function getFilteredRecords() {
  const start = value("filterStartDate");
  const end = value("filterEndDate");
  const department = value("filterDepartment");
  const employee = value("filterEmployee");

  return records.filter((r) => {
    const passStart = !start || r.date >= start;
    const passEnd = !end || r.date <= end;
    const passDepartment = !department || r.department === department;
    const passEmployee = !employee || r.employeeName === employee;
    return passStart && passEnd && passDepartment && passEmployee;
  });
}

function resetFilters() {
  setValue("filterStartDate", "");
  setValue("filterEndDate", "");
  setValue("filterDepartment", "");
  setValue("filterEmployee", "");
  renderAll();
}

function renderAll() {
  renderDashboard();
  renderRecordsTable();
}

function renderDashboard() {
  const filtered = getFilteredRecords();
  const kpis = calculateKpis(filtered);

  setText("laborProductivityValue", kpis.laborProductivity.toFixed(2));
  setText("receivingAccuracyValue", `${kpis.receivingAccuracy.toFixed(1)}%`);
  setText("putawayAccuracyValue", `${kpis.putawayAccuracy.toFixed(1)}%`);
  setText("pickAccuracyValue", `${kpis.pickAccuracy.toFixed(1)}%`);
  setText("onTimeShipmentRateValue", `${kpis.onTimeShipmentRate.toFixed(1)}%`);
  setText("avgDockToStockValue", `${kpis.avgDockToStock.toFixed(1)} min`);
  setText("inventoryAccuracyValue", `${kpis.inventoryAccuracy.toFixed(1)}%`);
  setText("spaceUtilizationValue", `${kpis.spaceUtilization.toFixed(1)}%`);
  setText("damageFreeRateValue", `${kpis.damageFreeRate.toFixed(1)}%`);
  setText("avgMeanTimeToShipValue", `${kpis.avgMeanTimeToShip.toFixed(1)} min`);
  setText("equipmentDowntimeValue", `${kpis.equipmentDowntime.toFixed(0)} min`);
  setText("incidentCountValue", `${kpis.totalIncidents}`);

  applyCardStatus("cardLaborProductivity", kpis.laborProductivity, targets.laborProductivity, true);
  applyCardStatus("cardReceivingAccuracy", kpis.receivingAccuracy, targets.receivingAccuracy, true);
  applyCardStatus("cardPutawayAccuracy", kpis.putawayAccuracy, targets.putawayAccuracy, true);
  applyCardStatus("cardPickAccuracy", kpis.pickAccuracy, targets.pickAccuracy, true);
  applyCardStatus("cardOnTimeShipmentRate", kpis.onTimeShipmentRate, targets.onTimeShipmentRate, true);
  applyCardStatus("cardDamageFreeRate", kpis.damageFreeRate, targets.damageFreeRate, true);

  applyCardStatus("cardAvgDockToStock", kpis.avgDockToStock, targets.dockToStock, false);
  applyCardStatus("cardEquipmentDowntime", kpis.equipmentDowntime, targets.equipmentDowntime, false);

  renderDepartmentSummary(filtered);
  renderEmployeeLeaderboard(filtered);
  renderDailyTrend(filtered);
}

function applyCardStatus(cardId, value, target, higherIsBetter = true) {
  const card = document.getElementById(cardId);
  if (!card) return;

  card.classList.remove("status-green", "status-yellow", "status-red");

  let status = "status-yellow";

  if (higherIsBetter) {
    if (value >= target) {
      status = "status-green";
    } else if (value >= target * 0.95) {
      status = "status-yellow";
    } else {
      status = "status-red";
    }
  } else {
    if (value <= target) {
      status = "status-green";
    } else if (value <= target * 1.1) {
      status = "status-yellow";
    } else {
      status = "status-red";
    }
  }

  card.classList.add(status);
}

function renderDepartmentSummary(filtered) {
  const tbody = document.querySelector("#departmentSummaryTable tbody");
  if (!tbody) return;

  const map = new Map();

  filtered.forEach((r) => {
    if (!map.has(r.department)) {
      map.set(r.department, {
        department: r.department,
        entries: 0,
        units: 0,
        hours: 0,
        errors: 0
      });
    }

    const row = map.get(r.department);
    row.entries += 1;
    row.units += Number(r.unitsProcessed || 0);
    row.hours += Number(r.hoursWorked || 0);
    row.errors += Number(r.errors || 0);
  });

  const rows = [...map.values()].sort((a, b) => a.department.localeCompare(b.department));

  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.department)}</td>
        <td>${row.entries}</td>
        <td>${row.units}</td>
        <td>${row.hours.toFixed(2)}</td>
        <td>${safeDivide(row.units, row.hours).toFixed(2)}</td>
        <td>${row.errors}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No records found.</td></tr>`;
}

function renderEmployeeLeaderboard(filtered) {
  const tbody = document.querySelector("#employeeLeaderboardTable tbody");
  if (!tbody) return;

  const map = new Map();

  filtered.forEach((r) => {
    if (!map.has(r.employeeName)) {
      map.set(r.employeeName, {
        employeeName: r.employeeName,
        entries: 0,
        units: 0,
        hours: 0,
        errors: 0
      });
    }

    const row = map.get(r.employeeName);
    row.entries += 1;
    row.units += Number(r.unitsProcessed || 0);
    row.hours += Number(r.hoursWorked || 0);
    row.errors += Number(r.errors || 0);
  });

  const rows = [...map.values()]
    .sort((a, b) => safeDivide(b.units, b.hours) - safeDivide(a.units, a.hours));

  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.employeeName)}</td>
        <td>${row.entries}</td>
        <td>${row.units}</td>
        <td>${row.hours.toFixed(2)}</td>
        <td>${safeDivide(row.units, row.hours).toFixed(2)}</td>
        <td>${row.errors}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No records found.</td></tr>`;
}

function renderDailyTrend(filtered) {
  const tbody = document.querySelector("#dailyTrendTable tbody");
  if (!tbody) return;

  const map = new Map();

  filtered.forEach((r) => {
    if (!map.has(r.date)) {
      map.set(r.date, {
        date: r.date,
        entries: 0,
        units: 0,
        hours: 0,
        errors: 0
      });
    }

    const row = map.get(r.date);
    row.entries += 1;
    row.units += Number(r.unitsProcessed || 0);
    row.hours += Number(r.hoursWorked || 0);
    row.errors += Number(r.errors || 0);
  });

  const rows = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));

  tbody.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${row.entries}</td>
        <td>${row.units}</td>
        <td>${row.hours.toFixed(2)}</td>
        <td>${safeDivide(row.units, row.hours).toFixed(2)}</td>
        <td>${row.errors}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No records found.</td></tr>`;
}

function renderRecordsTable() {
  const tbody = document.querySelector("#recordsTable tbody");
  if (!tbody) return;

  const rows = [...records].sort((a, b) => {
    if (a.date === b.date) return b.updatedAt.localeCompare(a.updatedAt);
    return b.date.localeCompare(a.date);
  });

  tbody.innerHTML = rows.length
    ? rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.employeeName)}</td>
        <td>${escapeHtml(r.department)}</td>
        <td>${Number(r.unitsProcessed || 0)}</td>
        <td>${Number(r.hoursWorked || 0).toFixed(2)}</td>
        <td>${safeDivide(Number(r.unitsProcessed || 0), Number(r.hoursWorked || 0)).toFixed(2)}</td>
        <td>${Number(r.errors || 0)}</td>
        <td>${Number(r.shipments || 0)}</td>
        <td>
          <div class="row-actions">
            <button class="inline-btn edit" data-edit="${r.id}">Edit</button>
            <button class="inline-btn delete" data-delete="${r.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="9">No records saved yet.</td></tr>`;

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editRecord(btn.dataset.edit));
  });

  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteRecord(btn.dataset.delete));
  });
}

function calculateKpis(recordsList) {
  const totalUnits = sum(recordsList, "unitsProcessed");
  const totalHours = sum(recordsList, "hoursWorked");

  const totalReceipts = sum(recordsList, "totalReceipts");
  const correctReceipts = sum(recordsList, "correctReceipts");

  const totalPutaways = sum(recordsList, "totalPutaways");
  const correctPutaways = sum(recordsList, "correctPutaways");

  const totalPicks = sum(recordsList, "totalPicks");
  const correctPicks = sum(recordsList, "correctPicks");

  const shipments = sum(recordsList, "shipments");
  const onTimeShipments = sum(recordsList, "onTimeShipments");
  const damageFreeShipments = sum(recordsList, "damageFreeShipments");

  const dockTimes = recordsList.map(r => Number(r.dockToStock || 0)).filter(n => n > 0);
  const putawayTimes = recordsList.map(r => Number(r.putawayTime || 0)).filter(n => n > 0);
  const travelTimes = recordsList.map(r => Number(r.travelTimePercent || 0)).filter(n => n > 0);
  const meanShipTimes = recordsList.map(r => Number(r.meanTimeToShip || 0)).filter(n => n > 0);

  const inventoryCount = sum(recordsList, "inventoryCount");
  const inventorySystemCount = sum(recordsList, "inventorySystemCount");
  const shrinkageQty = sum(recordsList, "shrinkageQty");
  const storageUsed = sum(recordsList, "storageUsed");
  const storageCapacity = sum(recordsList, "storageCapacity");

  return {
    laborProductivity: safeDivide(totalUnits, totalHours),
    receivingAccuracy: pct(correctReceipts, totalReceipts),
    putawayAccuracy: pct(correctPutaways, totalPutaways),
    pickAccuracy: pct(correctPicks, totalPicks),
    onTimeShipmentRate: pct(onTimeShipments, shipments),
    damageFreeRate: pct(damageFreeShipments, shipments),

    avgDockToStock: avg(dockTimes),
    avgPutawayCycleTime: avg(putawayTimes),
    avgTravelTimePercent: avg(travelTimes),
    avgMeanTimeToShip: avg(meanShipTimes),

    inventoryAccuracy: inventorySystemCount > 0
      ? 100 - (Math.abs(inventorySystemCount - inventoryCount) / inventorySystemCount) * 100
      : 0,

    spaceUtilization: pct(storageUsed, storageCapacity),
    inventoryShrinkage: shrinkageQty,
    equipmentDowntime: sum(recordsList, "equipmentDowntime"),
    totalIncidents: sum(recordsList, "incidentCount"),

    totalUnits,
    totalHours,
    totalReceipts,
    totalPutaways,
    totalPicks,
    shipments
  };
}

function safeDivide(a, b) {
  a = Number(a || 0);
  b = Number(b || 0);
  return b > 0 ? a / b : 0;
}

function pct(a, b) {
  a = Number(a || 0);
  b = Number(b || 0);
  return b > 0 ? (a / b) * 100 : 0;
}

function avg(list) {
  return list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : 0;
}

function sum(recordsList, field) {
  return recordsList.reduce((total, r) => total + Number(r[field] || 0), 0);
}

function value(id) {
  return document.getElementById(id)?.value ?? "";
}

function numValue(id) {
  const raw = value(id);
  return raw === "" ? 0 : Number(raw);
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function activateView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));

  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");

  const nav = document.querySelector(`.nav-link[data-view="${viewId}"]`);
  if (nav) nav.classList.add("active");
}

function makeId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
