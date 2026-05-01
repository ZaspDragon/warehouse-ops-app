/* ============================================
   WarehouseOS — Application Logic
   ============================================ */

const STORAGE_KEYS = {
  tasks: "warehouse_tasks_v5",
  notes: "warehouse_notes_v5",
  inventory: "warehouse_inventory_v5",
  counts: "warehouse_counts_v5",
  trucks: "warehouse_trucks_v5",
  coaching: "warehouse_coaching_v5",
  quality: "warehouse_quality_v5",
  putawayLogs: "warehouse_putaway_logs_v2"
};

// ============ SEED DATA ============

const defaultTasks = [
  { id: "T-1042", task: "Putaway pallet — Valve Assembly", owner: "Kris", zone: "A-10-3", priority: "High", status: "Active", createdAt: new Date(Date.now() - 35 * 60000).toISOString() },
  { id: "T-1043", task: "Replenish primary pick location", owner: "Henry", zone: "K05-2", priority: "High", status: "Queued", createdAt: new Date(Date.now() - 15 * 60000).toISOString() },
  { id: "T-1044", task: "Cycle count — Aisle L variance", owner: "Dawitt", zone: "L4-2", priority: "Medium", status: "Active", createdAt: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: "T-1045", task: "Damage review — inbound case", owner: "Yussif", zone: "QC", priority: "Low", status: "Pending", createdAt: new Date(Date.now() - 52 * 60000).toISOString() },
  { id: "T-1046", task: "Consolidate overstock bins", owner: "Alicia", zone: "F-02", priority: "Medium", status: "Active", createdAt: new Date(Date.now() - 22 * 60000).toISOString() },
  { id: "T-1047", task: "Unload inbound truck TRK-108", owner: "Kris", zone: "Dock 6", priority: "High", status: "Active", createdAt: new Date(Date.now() - 5 * 60000).toISOString() },
  { id: "T-1048", task: "Forklift battery swap — Unit #3", owner: "Henry", zone: "Charging", priority: "Low", status: "Done", createdAt: new Date(Date.now() - 90 * 60000).toISOString() }
];

const defaultInventory = [
  { item: "607529", desc: "Valve Assembly", onHand: 42, primary: 8, overstock: 34, bin: "A-10-3", status: "Healthy" },
  { item: "581220", desc: "PVC Fitting 3/4\"", onHand: 11, primary: 1, overstock: 10, bin: "B-04-1", status: "Low" },
  { item: "775981", desc: "Drain Kit Complete", onHand: 0, primary: 0, overstock: 0, bin: "C-12-2", status: "Out" },
  { item: "431006", desc: "Copper Elbow 1/2\"", onHand: 76, primary: 12, overstock: 64, bin: "F-02-1", status: "Healthy" },
  { item: "892145", desc: "Water Heater Element", onHand: 3, primary: 3, overstock: 0, bin: "D-08-4", status: "Low" },
  { item: "334782", desc: "Supply Line SS 12\"", onHand: 156, primary: 24, overstock: 132, bin: "E-01-2", status: "Healthy" },
  { item: "110345", desc: "P-Trap Chrome 1.5\"", onHand: 28, primary: 6, overstock: 22, bin: "B-11-3", status: "Healthy" },
  { item: "667012", desc: "Toilet Flapper Universal", onHand: 0, primary: 0, overstock: 0, bin: "G-03-1", status: "Out" }
];

const defaultNotes = [
  "Primary replenishment is running behind in A and K aisles — prioritize before 2nd shift.",
  "Cycle count variance found on item 581220 — PVC Fitting count off by 4 units.",
  "Dock 4 hydraulic leveler needs maintenance request. Using Dock 6 as overflow."
];

const defaultLaborData = [
  { name: "Kris", role: "Lift Driver", department: "Putaway", productivity: 94, errors: 1, status: "On Floor" },
  { name: "Henry", role: "Lift Driver", department: "Replenishment", productivity: 88, errors: 2, status: "On Floor" },
  { name: "Dawitt", role: "Inventory", department: "Cycle Count", productivity: 91, errors: 0, status: "Counting" },
  { name: "Yussif", role: "Lift Driver", department: "Putaway", productivity: 72, errors: 3, status: "Downtime" },
  { name: "Alicia", role: "Supervisor", department: "Receiving", productivity: 97, errors: 0, status: "On Floor" },
  { name: "Marcus", role: "Picker", department: "Outbound", productivity: 85, errors: 1, status: "On Floor" },
  { name: "Tanya", role: "Packer", department: "Shipping", productivity: 92, errors: 0, status: "On Floor" },
  { name: "Jerome", role: "Lift Driver", department: "Putaway", productivity: 68, errors: 4, status: "Downtime" }
];

const defaultQualityData = [
  { date: "2026-04-30", type: "Near Miss", area: "Receiving", severity: "Medium", owner: "Alicia", notes: "Forklift traffic too close to dock pedestrian walkway." },
  { date: "2026-04-30", type: "Inventory Variance", area: "Aisle K", severity: "High", owner: "Henry", notes: "Mismatch between physical and system quantity — 12 units short on item 581220." },
  { date: "2026-04-29", type: "Damaged Product", area: "Aisle A", severity: "Low", owner: "Kris", notes: "Crushed corner on inbound case. Product still usable, logged for vendor claim." },
  { date: "2026-04-29", type: "Safety Violation", area: "Dock 4", severity: "High", owner: "Jerome", notes: "Operating forklift without seatbelt. Verbal coaching administered." },
  { date: "2026-04-28", type: "Near Miss", area: "Aisle F", severity: "Medium", owner: "Marcus", notes: "Pallet almost fell from top rack during retrieval. Racking inspection scheduled." }
];

const defaultTrucks = [
  { id: "trk-demo-1", truckNumber: "TRK-104", carrier: "FedEx Freight", dockDoor: "Door 4", containers: 3, osds: 1, startTime: new Date(Date.now() - 45 * 60000).toISOString(), endTime: null, status: "Active", totalElapsedSeconds: 0 },
  { id: "trk-demo-2", truckNumber: "TRK-105", carrier: "XPO Logistics", dockDoor: "Door 6", containers: 5, osds: 0, startTime: new Date(Date.now() - 120 * 60000).toISOString(), endTime: new Date(Date.now() - 30 * 60000).toISOString(), status: "Completed", totalElapsedSeconds: 5400 }
];

const defaultCoaching = [
  { employee: "Jerome", topic: "Safety — Seatbelt compliance", notes: "Discussed importance of wearing seatbelt at all times when operating lift. Jerome acknowledged and committed to compliance. Follow-up in 1 week.", createdAt: new Date(Date.now() - 60 * 60000).toISOString() },
  { employee: "Yussif", topic: "Productivity — Below goal", notes: "Reviewed putaway rate. Identified issue with scanner connectivity causing delays. IT ticket submitted. Will re-evaluate next shift.", createdAt: new Date(Date.now() - 180 * 60000).toISOString() }
];

// ============ STATE ============

let tasks = loadStorage(STORAGE_KEYS.tasks, defaultTasks);
let notes = loadStorage(STORAGE_KEYS.notes, defaultNotes);
let inventory = loadStorage(STORAGE_KEYS.inventory, defaultInventory);
let counts = loadStorage(STORAGE_KEYS.counts, []);
let trucks = loadStorage(STORAGE_KEYS.trucks, defaultTrucks);
let coachingEntries = loadStorage(STORAGE_KEYS.coaching, defaultCoaching);
let qualityData = loadStorage(STORAGE_KEYS.quality, defaultQualityData);
let putawayLogs = loadStorage(STORAGE_KEYS.putawayLogs, []);
let lastPutawayUploadCount = 0;

const laborData = defaultLaborData;

let inventoryFiltersOpen = false;
let inventoryFilterState = { status: "all", bin: "" };

const views = {
  dashboard: document.getElementById("dashboardView"),
  operations: document.getElementById("operationsView"),
  inventory: document.getElementById("inventoryView"),
  receiving: document.getElementById("receivingView"),
  labor: document.getElementById("laborView"),
  quality: document.getElementById("qualityView"),
  reports: document.getElementById("reportsView")
};

const viewTitles = {
  dashboard: ["Dashboard", "Shift overview — key metrics at a glance"],
  operations: ["Operations", "Create, manage, and advance work tasks"],
  inventory: ["Inventory", "Stock levels, cycle counts, and variance tracking"],
  receiving: ["Receiving & Dock", "Inbound trucks, dock timers, and put-away logs"],
  labor: ["Labor & Productivity", "Employee performance, coaching, and status tracking"],
  quality: ["Quality & Safety", "Track incidents, near misses, and corrective actions"],
  reports: ["Reports & Exports", "Generate and download shift reports"]
};

// ============ INIT ============

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupButtons();
  setupMobileMenu();
  setupKeyboard();
  renderAll();
  updateSidebarClock();

  setInterval(() => {
    renderReceivingTable();
    renderReceivingStats();
    renderTasks();
    renderDashboardStats();
    updateSidebarClock();
  }, 1000);
});

// ============ STORAGE ============

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function resetAllData() {
  if (!confirm("Reset all data to demo defaults? This cannot be undone.")) return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  tasks = structuredClone(defaultTasks);
  notes = structuredClone(defaultNotes);
  inventory = structuredClone(defaultInventory);
  counts = [];
  trucks = structuredClone(defaultTrucks);
  coachingEntries = structuredClone(defaultCoaching);
  qualityData = structuredClone(defaultQualityData);
  putawayLogs = [];
  lastPutawayUploadCount = 0;
  renderAll();
  showToast("Demo data restored.");
}

// ============ NAVIGATION ============

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.view;
      Object.values(views).forEach(v => v.classList.remove("active"));
      views[target].classList.add("active");

      const [title, subtitle] = viewTitles[target] || ["Dashboard", ""];
      document.getElementById("topbarTitle").textContent = title;
      document.getElementById("topbarSubtitle").textContent = subtitle;

      closeMobileMenu();
    });
  });
}

// ============ MOBILE MENU ============

function setupMobileMenu() {
  const btn = document.getElementById("mobileMenuBtn");
  const overlay = document.getElementById("mobileOverlay");

  if (btn) btn.addEventListener("click", toggleMobileMenu);
  if (overlay) overlay.addEventListener("click", closeMobileMenu);
}

function toggleMobileMenu() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar.classList.contains("open")) {
    closeMobileMenu();
  } else {
    sidebar.classList.add("open");
    document.getElementById("mobileOverlay").classList.add("show");
    document.getElementById("mobileMenuBtn").textContent = "×";
  }
}

function closeMobileMenu() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("mobileOverlay").classList.remove("show");
  document.getElementById("mobileMenuBtn").textContent = "☰";
}

// ============ KEYBOARD ============

function setupKeyboard() {
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });
}

// ============ CLOCK ============

function updateSidebarClock() {
  const el = document.getElementById("sidebarClock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ============ BUTTONS ============

function setupButtons() {
  document.getElementById("newActionBtn").addEventListener("click", openNewActionModal);
  document.getElementById("createTaskBtn").addEventListener("click", openCreateTaskModal);
  document.getElementById("filtersBtn").addEventListener("click", toggleInventoryFilters);
  document.getElementById("newCountBtn").addEventListener("click", openNewCountModal);
  document.getElementById("addTruckBtn").addEventListener("click", openAddTruckModal);
  document.getElementById("addIncidentBtn").addEventListener("click", openAddIncidentModal);
  document.getElementById("uploadPutawayBtn").addEventListener("click", openPutawayUploadModal);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);
  document.getElementById("resetDataBtn").addEventListener("click", resetAllData);

  document.getElementById("saveDashboardNoteBtn").addEventListener("click", () => {
    const input = document.getElementById("dashboardNoteInput");
    const value = input.value.trim();
    if (!value) return showToast("Enter a note first.");
    notes.unshift(value);
    saveStorage(STORAGE_KEYS.notes, notes);
    input.value = "";
    renderNotes();
    showToast("Note saved.");
  });

  document.getElementById("dashboardNoteInput").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("saveDashboardNoteBtn").click();
  });

  document.getElementById("applyInventoryFiltersBtn").addEventListener("click", () => {
    inventoryFilterState.status = document.getElementById("statusFilter").value;
    inventoryFilterState.bin = document.getElementById("binFilter").value.trim();
    renderInventory();
    showToast("Filters applied.");
  });

  document.getElementById("clearInventoryFiltersBtn").addEventListener("click", () => {
    inventoryFilterState = { status: "all", bin: "" };
    document.getElementById("statusFilter").value = "all";
    document.getElementById("binFilter").value = "";
    renderInventory();
    showToast("Filters cleared.");
  });

  document.getElementById("saveCoachingBtn").addEventListener("click", saveCoachingEntry);

  document.querySelectorAll(".generate-report-btn").forEach(btn => {
    btn.addEventListener("click", () => generateReport(btn.dataset.report));
  });

  document.querySelectorAll(".export-csv-btn").forEach(btn => {
    btn.addEventListener("click", () => exportCSV(btn.dataset.export));
  });

  document.getElementById("modalOverlay").addEventListener("click", e => {
    if (e.target.id === "modalOverlay") closeModal();
  });

  document.getElementById("globalSearch").addEventListener("input", renderAll);
}

// ============ RENDER ============

function renderAll() {
  renderTasks();
  renderNotes();
  renderInventory();
  renderReceivingTable();
  renderReceivingStats();
  renderPutawayLogs();
  renderLabor();
  renderQuality();
  renderCoaching();
  renderDashboardStats();
}

function renderDashboardStats() {
  document.getElementById("dashboardTruckCount").textContent = trucks.length;
  document.getElementById("dashboardCountCount").textContent = counts.length;
  document.getElementById("dashboardTaskCount").textContent = tasks.filter(t => t.status !== "Done").length;
  document.getElementById("tasksBehind").textContent = tasks.filter(t =>
    t.status !== "Done" && (t.status === "Queued" || t.status === "Pending" || isTaskAtRisk(t))
  ).length;
  document.getElementById("lowInventory").textContent = inventory.filter(i =>
    i.status === "Low" || i.status === "Out"
  ).length;
  document.getElementById("activeTrucks").textContent = trucks.filter(t => t.status === "Active").length;
  document.getElementById("laborIssues").textContent = laborData.filter(l => l.productivity < 75).length;
}

function getSearchValue() {
  return document.getElementById("globalSearch").value.trim().toLowerCase();
}

function renderTasks() {
  const search = getSearchValue();
  const filtered = tasks.filter(t =>
    `${t.id} ${t.task} ${t.owner} ${t.zone} ${t.priority} ${t.status}`.toLowerCase().includes(search)
  );

  const operationsBody = document.getElementById("operationsTaskTable");
  const dashboardBody = document.getElementById("dashboardTaskTable");

  operationsBody.innerHTML = "";
  dashboardBody.innerHTML = "";

  if (!filtered.length) {
    operationsBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px;">No tasks found.</td></tr>';
    dashboardBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">No tasks found.</td></tr>';
    return;
  }

  filtered.forEach(task => {
    const ageText = getTaskAge(task);
    const risk = isTaskAtRisk(task) ? '<span class="badge red">At Risk</span>' : '<span class="badge green">OK</span>';

    operationsBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${task.id}</strong></td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
        <td>${ageText}</td>
        <td>${risk}</td>
        <td>
          <div class="action-row">
            <button class="small-btn" onclick="toggleTaskStatus('${task.id}')">Advance</button>
            <button class="small-btn" onclick="confirmDeleteTask('${task.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `);

    dashboardBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${task.id}</strong></td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
      </tr>
    `);
  });
}

function renderNotes() {
  const list = document.getElementById("dashboardNotesList");
  list.innerHTML = "";
  if (!notes.length) {
    list.innerHTML = '<div class="note-box" style="color:#94a3b8;">No supervisor notes yet. Add one above.</div>';
    return;
  }
  notes.forEach((note, i) => {
    list.insertAdjacentHTML("beforeend", `
      <div class="note-box">
        ${escapeHtml(note)}
        <button class="small-btn" style="float:right;margin-top:-4px;font-size:0.75rem;" onclick="deleteNote(${i})">×</button>
      </div>
    `);
  });
}

function getFilteredInventory() {
  const search = getSearchValue();
  return inventory.filter(item => {
    const matchesSearch = `${item.item} ${item.desc} ${item.bin} ${item.status}`.toLowerCase().includes(search);
    const matchesStatus = inventoryFilterState.status === "all" || item.status === inventoryFilterState.status;
    const matchesBin = !inventoryFilterState.bin || item.bin.toLowerCase().includes(inventoryFilterState.bin.toLowerCase());
    return matchesSearch && matchesStatus && matchesBin;
  });
}

function renderInventory() {
  const body = document.getElementById("inventoryTable");
  body.innerHTML = "";
  const filtered = getFilteredInventory();

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No inventory items match your filters.</td></tr>';
  }

  filtered.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(item.item)}</strong></td>
        <td>${escapeHtml(item.desc)}</td>
        <td>${item.onHand}</td>
        <td>${item.primary}</td>
        <td>${item.overstock}</td>
        <td>${escapeHtml(item.bin)}</td>
        <td>${badge(item.status)}</td>
      </tr>
    `);
  });

  document.getElementById("inventoryTotalCount").textContent = filtered.length;
  document.getElementById("inventoryLowCount").textContent = filtered.filter(i => i.status === "Low" || i.status === "Out").length;
}

function renderReceivingTable() {
  const body = document.getElementById("receivingTable");
  const search = getSearchValue();
  body.innerHTML = "";

  const filtered = trucks.filter(truck =>
    `${truck.truckNumber} ${truck.carrier} ${truck.dockDoor} ${truck.status}`.toLowerCase().includes(search)
  );

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:24px;">No trucks logged. Click + Add Truck to start.</td></tr>';
    return;
  }

  filtered.forEach(truck => {
    const timerText = getTruckElapsedTime(truck);
    const delay = isTruckDelayed(truck)
      ? '<span class="badge red">Delayed</span>'
      : '<span class="badge green">On Time</span>';

    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(truck.truckNumber)}</strong></td>
        <td>${escapeHtml(truck.carrier)}</td>
        <td>${escapeHtml(truck.dockDoor)}</td>
        <td>${truck.containers}</td>
        <td>${truck.osds}</td>
        <td>${formatDateTime(truck.startTime)}</td>
        <td style="font-variant-numeric:tabular-nums;font-weight:700;">${timerText}</td>
        <td>${badge(truck.status)}</td>
        <td>${delay}</td>
        <td>
          <div class="action-row">
            ${truck.status === "Active"
              ? `<button class="small-btn" onclick="stopTruckTimer('${truck.id}')">Stop</button>`
              : `<button class="small-btn" onclick="restartTruckTimer('${truck.id}')">Restart</button>`
            }
            <button class="small-btn" onclick="editTruck('${truck.id}')">Edit</button>
            <button class="small-btn" onclick="confirmDeleteTruck('${truck.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `);
  });
}

function renderReceivingStats() {
  document.getElementById("receivingTruckTotal").textContent = trucks.length;
  document.getElementById("receivingOsdTotal").textContent = trucks.reduce((sum, t) => sum + Number(t.osds || 0), 0);
  document.getElementById("receivingContainerTotal").textContent = trucks.reduce((sum, t) => sum + Number(t.containers || 0), 0);
  document.getElementById("receivingActiveTimers").textContent = trucks.filter(t => t.status === "Active").length;

  const completed = trucks.filter(t => t.totalElapsedSeconds && t.status !== "Active");
  const avg = completed.length
    ? Math.floor(completed.reduce((sum, t) => sum + t.totalElapsedSeconds, 0) / completed.length)
    : 0;
  document.getElementById("receivingAverageDockTime").textContent = secondsToClock(avg);
}

function renderPutawayLogs() {
  const body = document.getElementById("putawayTable");
  if (!body) return;

  const search = getSearchValue();
  body.innerHTML = "";

  const filtered = putawayLogs.filter(entry =>
    `${entry.date} ${entry.logNumber} ${entry.location} ${entry.rawLine}`.toLowerCase().includes(search)
  );

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px;">No put-away logs. Upload a label image to start.</td></tr>';
  }

  filtered.forEach(entry => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${formatDateTime(entry.date)}</td>
        <td><strong>${escapeHtml(entry.logNumber)}</strong></td>
        <td>${escapeHtml(entry.location)}</td>
        <td>${escapeHtml(entry.rawLine)}</td>
        <td>
          <button class="small-btn" onclick="confirmDeletePutawayLog('${entry.id}')">Delete</button>
        </td>
      </tr>
    `);
  });

  document.getElementById("putawayLogTotal").textContent = putawayLogs.length;
  document.getElementById("putawayLocationTotal").textContent = new Set(putawayLogs.map(x => x.location)).size;
  document.getElementById("putawayLastUploadCount").textContent = lastPutawayUploadCount;
}

function renderLabor() {
  const body = document.getElementById("laborTable");
  const search = getSearchValue();
  body.innerHTML = "";

  const filtered = laborData.filter(emp =>
    `${emp.name} ${emp.role} ${emp.department} ${emp.status}`.toLowerCase().includes(search)
  );

  filtered.forEach(emp => {
    const goalClass = getLaborStatusClass(emp.productivity);
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(emp.name)}</strong></td>
        <td>${escapeHtml(emp.role)}</td>
        <td>${escapeHtml(emp.department)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;min-width:60px;">
              <div style="height:100%;width:${Math.min(emp.productivity, 100)}%;background:${emp.productivity >= 90 ? 'var(--green)' : emp.productivity >= 75 ? 'var(--yellow)' : 'var(--red)'};border-radius:3px;transition:width 0.3s;"></div>
            </div>
            <span style="font-weight:700;font-size:0.88rem;">${emp.productivity}%</span>
          </div>
        </td>
        <td><span class="badge ${goalClass}">${getLaborGoalLabel(emp.productivity)}</span></td>
        <td>${emp.errors}</td>
        <td>${badge(emp.status)}</td>
      </tr>
    `);
  });
}

function renderQuality() {
  const body = document.getElementById("qualityTable");
  const search = getSearchValue();
  body.innerHTML = "";

  const filtered = qualityData.filter(item =>
    `${item.date} ${item.type} ${item.area} ${item.severity} ${item.owner} ${item.notes}`.toLowerCase().includes(search)
  );

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:24px;">No incidents recorded.</td></tr>';
  }

  filtered.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.area)}</td>
        <td>${badge(item.severity)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td style="max-width:300px;">${escapeHtml(item.notes || "")}</td>
      </tr>
    `);
  });

  document.getElementById("qualityTotalCount").textContent = qualityData.length;
  document.getElementById("qualityHighCount").textContent = qualityData.filter(i => i.severity === "High").length;
  document.getElementById("qualityTopArea").textContent = getTopIssueArea();
}

function renderCoaching() {
  const list = document.getElementById("coachingList");
  list.innerHTML = "";

  if (!coachingEntries.length) {
    list.innerHTML = '<div class="coach-box" style="color:#94a3b8;">No coaching entries. Use the form above to log coaching conversations.</div>';
    return;
  }

  coachingEntries.forEach(entry => {
    list.insertAdjacentHTML("beforeend", `
      <div class="coach-box">
        <strong>${escapeHtml(entry.employee)}</strong> — ${escapeHtml(entry.topic)}
        <div class="coach-text">${escapeHtml(entry.notes)}</div>
        <div class="coach-date">${formatDateTime(entry.createdAt)}</div>
      </div>
    `);
  });
}

function toggleInventoryFilters() {
  inventoryFiltersOpen = !inventoryFiltersOpen;
  document.getElementById("inventoryFiltersPanel").classList.toggle("hidden", !inventoryFiltersOpen);
}

// ============ CRUD — TASKS ============

function openNewActionModal() {
  openModal("New Action", `
    <div class="form-grid">
      <div>
        <label>Action Type</label>
        <select id="newActionType">
          <option value="task">Task</option>
          <option value="note">Supervisor Note</option>
          <option value="issue">Issue</option>
        </select>
      </div>
      <div>
        <label>Owner</label>
        <input id="newActionOwner" type="text" placeholder="Kris" />
      </div>
      <div class="full-span">
        <label>Description</label>
        <textarea id="newActionDescription" placeholder="What needs to happen?"></textarea>
      </div>
      <div>
        <label>Zone / Area</label>
        <input id="newActionZone" type="text" placeholder="A-10-3 or Receiving" />
      </div>
      <div>
        <label>Priority</label>
        <select id="newActionPriority">
          <option value="High">High</option>
          <option value="Medium" selected>Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveNewAction()">Save Action</button>
    </div>
  `);
}

function saveNewAction() {
  const type = document.getElementById("newActionType").value;
  const owner = document.getElementById("newActionOwner").value.trim() || "Unassigned";
  const desc = document.getElementById("newActionDescription").value.trim();
  const zone = document.getElementById("newActionZone").value.trim() || "General";
  const priority = document.getElementById("newActionPriority").value;

  if (!desc) return showToast("Enter a description first.");

  if (type === "task" || type === "issue") {
    tasks.unshift({
      id: `T-${Math.floor(1000 + Math.random() * 9000)}`,
      task: desc, owner, zone, priority,
      status: type === "issue" ? "Pending" : "Active",
      createdAt: new Date().toISOString()
    });
    saveStorage(STORAGE_KEYS.tasks, tasks);
    renderTasks();
    renderDashboardStats();
  } else {
    notes.unshift(`${owner}: ${desc}`);
    saveStorage(STORAGE_KEYS.notes, notes);
    renderNotes();
  }

  closeModal();
  showToast("Action saved.");
}

function openCreateTaskModal() {
  openModal("Create Task", `
    <div class="form-grid">
      <div>
        <label>Task</label>
        <input id="taskNameInput" type="text" placeholder="Replenish primary" />
      </div>
      <div>
        <label>Owner</label>
        <input id="taskOwnerInput" type="text" placeholder="Henry" />
      </div>
      <div>
        <label>Zone</label>
        <input id="taskZoneInput" type="text" placeholder="K05-2" />
      </div>
      <div>
        <label>Priority</label>
        <select id="taskPriorityInput">
          <option value="High">High</option>
          <option value="Medium" selected>Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTask()">Save Task</button>
    </div>
  `);
}

function saveTask() {
  const taskName = document.getElementById("taskNameInput").value.trim();
  const owner = document.getElementById("taskOwnerInput").value.trim() || "Unassigned";
  const zone = document.getElementById("taskZoneInput").value.trim() || "General";
  const priority = document.getElementById("taskPriorityInput").value;

  if (!taskName) return showToast("Task name is required.");

  tasks.unshift({
    id: `T-${Math.floor(1000 + Math.random() * 9000)}`,
    task: taskName, owner, zone, priority,
    status: "Active",
    createdAt: new Date().toISOString()
  });

  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  closeModal();
  showToast("Task created.");
}

function toggleTaskStatus(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const flow = ["Queued", "Active", "Pending", "Done"];
  const currentIndex = flow.indexOf(task.status);
  task.status = flow[(currentIndex + 1) % flow.length];
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  showToast(`Task ${task.id} → ${task.status}`);
}

function confirmDeleteTask(id) {
  if (!confirm("Delete this task?")) return;
  tasks = tasks.filter(t => t.id !== id);
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  showToast("Task deleted.");
}

function deleteNote(index) {
  notes.splice(index, 1);
  saveStorage(STORAGE_KEYS.notes, notes);
  renderNotes();
  showToast("Note deleted.");
}

// ============ CRUD — INVENTORY ============

function openNewCountModal() {
  openModal("New Inventory Count", `
    <div class="form-grid">
      <div>
        <label>Item Number</label>
        <input id="countItemInput" type="text" placeholder="607529" />
      </div>
      <div>
        <label>Bin</label>
        <input id="countBinInput" type="text" placeholder="A-10-3" />
      </div>
      <div>
        <label>Counted Quantity</label>
        <input id="countQtyInput" type="number" placeholder="12" />
      </div>
      <div>
        <label>Description</label>
        <input id="countDescInput" type="text" placeholder="Valve Assembly" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveCount()">Save Count</button>
    </div>
  `);
}

function saveCount() {
  const item = document.getElementById("countItemInput").value.trim();
  const bin = document.getElementById("countBinInput").value.trim();
  const qty = Number(document.getElementById("countQtyInput").value);
  const desc = document.getElementById("countDescInput").value.trim() || "Manual Count";

  if (!item || !bin || Number.isNaN(qty)) return showToast("Fill in item, bin, and quantity.");

  counts.unshift({ item, bin, qty, desc, createdAt: new Date().toISOString() });

  const existing = inventory.find(i => i.item === item && i.bin === bin);
  if (existing) {
    existing.onHand = qty;
    existing.primary = Math.min(existing.primary, qty);
    existing.overstock = Math.max(qty - existing.primary, 0);
    existing.status = qty === 0 ? "Out" : qty <= 5 ? "Low" : "Healthy";
  } else {
    inventory.unshift({
      item, desc, onHand: qty,
      primary: Math.min(qty, 5),
      overstock: Math.max(qty - Math.min(qty, 5), 0),
      bin,
      status: qty === 0 ? "Out" : qty <= 5 ? "Low" : "Healthy"
    });
  }

  saveStorage(STORAGE_KEYS.counts, counts);
  saveStorage(STORAGE_KEYS.inventory, inventory);
  renderInventory();
  renderDashboardStats();
  closeModal();
  showToast("Count saved.");
}

// ============ CRUD — TRUCKS ============

function openAddTruckModal() {
  openModal("Add Receiving Truck", `
    <div class="form-grid">
      <div>
        <label>Truck Number</label>
        <input id="truckNumberInput" type="text" placeholder="TRK-104" />
      </div>
      <div>
        <label>Carrier</label>
        <input id="truckCarrierInput" type="text" placeholder="FedEx Freight" />
      </div>
      <div>
        <label>Dock Door</label>
        <input id="truckDockInput" type="text" placeholder="Door 4" />
      </div>
      <div>
        <label>Containers</label>
        <input id="truckContainersInput" type="number" placeholder="2" />
      </div>
      <div>
        <label>OSDs</label>
        <input id="truckOsdInput" type="number" placeholder="0" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTruck()">Save Truck &amp; Start Timer</button>
    </div>
  `);
}

function saveTruck() {
  const truckNumber = document.getElementById("truckNumberInput").value.trim();
  const carrier = document.getElementById("truckCarrierInput").value.trim() || "Unknown Carrier";
  const dockDoor = document.getElementById("truckDockInput").value.trim() || "Unassigned";
  const containers = Number(document.getElementById("truckContainersInput").value || 0);
  const osds = Number(document.getElementById("truckOsdInput").value || 0);

  if (!truckNumber) return showToast("Truck number is required.");

  trucks.unshift({
    id: cryptoRandomId(), truckNumber, carrier, dockDoor, containers, osds,
    startTime: new Date().toISOString(),
    endTime: null, status: "Active", totalElapsedSeconds: 0
  });

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  closeModal();
  showToast("Truck added — timer started.");
}

function stopTruckTimer(id) {
  const truck = trucks.find(t => t.id === id);
  if (!truck || truck.status !== "Active") return;
  truck.endTime = new Date().toISOString();
  truck.totalElapsedSeconds = Math.floor((new Date() - new Date(truck.startTime)) / 1000);
  truck.status = "Completed";
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast("Truck timer stopped.");
}

function restartTruckTimer(id) {
  const truck = trucks.find(t => t.id === id);
  if (!truck) return;
  truck.startTime = new Date().toISOString();
  truck.endTime = null;
  truck.totalElapsedSeconds = 0;
  truck.status = "Active";
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast("Timer restarted.");
}

function editTruck(id) {
  const truck = trucks.find(t => t.id === id);
  if (!truck) return;

  openModal("Edit Truck", `
    <div class="form-grid">
      <div>
        <label>Truck Number</label>
        <input id="editTruckNumberInput" type="text" value="${escapeAttribute(truck.truckNumber)}" />
      </div>
      <div>
        <label>Carrier</label>
        <input id="editTruckCarrierInput" type="text" value="${escapeAttribute(truck.carrier)}" />
      </div>
      <div>
        <label>Dock Door</label>
        <input id="editTruckDockInput" type="text" value="${escapeAttribute(truck.dockDoor)}" />
      </div>
      <div>
        <label>Containers</label>
        <input id="editTruckContainersInput" type="number" value="${truck.containers}" />
      </div>
      <div>
        <label>OSDs</label>
        <input id="editTruckOsdInput" type="number" value="${truck.osds}" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTruckEdit('${truck.id}')">Save Changes</button>
    </div>
  `);
}

function saveTruckEdit(id) {
  const truck = trucks.find(t => t.id === id);
  if (!truck) return;
  truck.truckNumber = document.getElementById("editTruckNumberInput").value.trim();
  truck.carrier = document.getElementById("editTruckCarrierInput").value.trim();
  truck.dockDoor = document.getElementById("editTruckDockInput").value.trim();
  truck.containers = Number(document.getElementById("editTruckContainersInput").value || 0);
  truck.osds = Number(document.getElementById("editTruckOsdInput").value || 0);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  closeModal();
  showToast("Truck updated.");
}

function confirmDeleteTruck(id) {
  if (!confirm("Delete this truck record?")) return;
  trucks = trucks.filter(t => t.id !== id);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast("Truck deleted.");
}

// ============ CRUD — PUT-AWAY OCR ============

function openPutawayUploadModal() {
  openModal("Upload Put-Away Log Image", `
    <p style="color:#64748b;margin:0 0 16px;">Upload a photo of a put-away label or log sheet. The OCR engine will extract text, then you can save parsed entries.</p>
    <div class="form-grid">
      <div class="full-span">
        <label>Select image</label>
        <input id="putawayImageInput" type="file" accept="image/*" />
      </div>
      <div class="full-span">
        <label>OCR Preview</label>
        <textarea id="putawayOcrPreview" placeholder="OCR text will appear here after reading the image…"></textarea>
      </div>
    </div>
    <div class="mt-16 action-row">
      <button class="primary-btn" onclick="processPutawayImage()">📷 Read Image</button>
      <button class="secondary-btn" onclick="savePutawayFromPreview()">💾 Save Entries</button>
    </div>
  `);
}

async function processPutawayImage() {
  const fileInput = document.getElementById("putawayImageInput");
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return showToast("Choose an image first.");
  if (typeof Tesseract === "undefined") return showToast("OCR library is loading — try again in a moment.");

  showToast("Reading image with OCR…");
  try {
    const result = await Tesseract.recognize(fileInput.files[0], "eng");
    document.getElementById("putawayOcrPreview").value = result.data.text || "";
    showToast("Image read. Review text and save entries.");
  } catch (err) {
    console.error(err);
    showToast("Could not read image. Try a clearer photo.");
  }
}

function savePutawayFromPreview() {
  const text = document.getElementById("putawayOcrPreview").value.trim();
  if (!text) return showToast("No text to parse.");

  const parsed = parsePutawayLogText(text);
  if (!parsed.length) return showToast("No put-away entries found in text.");

  const now = new Date().toISOString();
  parsed.forEach(entry => {
    putawayLogs.unshift({ id: cryptoRandomId(), date: now, logNumber: entry.logNumber, location: entry.location, rawLine: entry.rawLine });
  });

  lastPutawayUploadCount = parsed.length;
  saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
  renderPutawayLogs();
  closeModal();
  showToast(`Saved ${parsed.length} put-away entries.`);
}

function parsePutawayLogText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const locationMatch = line.match(/\b[A-Z]{1,2}-?\d{1,2}-\d\b|\b[A-Z]\d{1,2}-\d\b|\b[A-Z]{1,2}\d{1,2}-\d\b/i);
    const logMatch = line.match(/\b\d{5,8}\b/);
    if (locationMatch && logMatch) {
      results.push({ logNumber: logMatch[0], location: locationMatch[0].toUpperCase(), rawLine: line });
    }
  }
  const seen = new Set();
  return results.filter(e => {
    const key = `${e.logNumber}|${e.location}|${e.rawLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function confirmDeletePutawayLog(id) {
  if (!confirm("Delete this put-away entry?")) return;
  putawayLogs = putawayLogs.filter(e => e.id !== id);
  saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
  renderPutawayLogs();
  showToast("Entry deleted.");
}

// ============ CRUD — QUALITY ============

function openAddIncidentModal() {
  const today = new Date().toISOString().split("T")[0];
  openModal("Add Quality / Safety Incident", `
    <div class="form-grid">
      <div>
        <label>Date</label>
        <input id="incidentDateInput" type="date" value="${today}" />
      </div>
      <div>
        <label>Type</label>
        <select id="incidentTypeInput">
          <option value="Near Miss">Near Miss</option>
          <option value="Damaged Product">Damaged Product</option>
          <option value="Inventory Variance">Inventory Variance</option>
          <option value="Safety Violation">Safety Violation</option>
          <option value="Equipment Damage">Equipment Damage</option>
          <option value="OSD Issue">OSD Issue</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div>
        <label>Area</label>
        <input id="incidentAreaInput" type="text" placeholder="Receiving, Aisle K, Dock 4…" />
      </div>
      <div>
        <label>Severity</label>
        <select id="incidentSeverityInput">
          <option value="Low">Low</option>
          <option value="Medium" selected>Medium</option>
          <option value="High">High</option>
        </select>
      </div>
      <div>
        <label>Owner</label>
        <input id="incidentOwnerInput" type="text" placeholder="Henry" />
      </div>
      <div class="full-span">
        <label>Notes</label>
        <textarea id="incidentNotesInput" placeholder="What happened and what action was taken?"></textarea>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveIncident()">Save Incident</button>
    </div>
  `);
}

function saveIncident() {
  const date = document.getElementById("incidentDateInput").value;
  const type = document.getElementById("incidentTypeInput").value;
  const area = document.getElementById("incidentAreaInput").value.trim();
  const severity = document.getElementById("incidentSeverityInput").value;
  const owner = document.getElementById("incidentOwnerInput").value.trim();
  const notesText = document.getElementById("incidentNotesInput").value.trim();

  if (!date || !area || !owner) return showToast("Fill in date, area, and owner.");

  qualityData.unshift({ date, type, area, severity, owner, notes: notesText });
  saveStorage(STORAGE_KEYS.quality, qualityData);
  renderQuality();
  closeModal();
  showToast("Incident recorded.");
}

// ============ CRUD — COACHING ============

function saveCoachingEntry() {
  const employee = document.getElementById("coachEmployee").value.trim();
  const topic = document.getElementById("coachTopic").value.trim();
  const notesText = document.getElementById("coachNotes").value.trim();

  if (!employee || !topic || !notesText) return showToast("Fill in all coaching fields.");

  coachingEntries.unshift({ employee, topic, notes: notesText, createdAt: new Date().toISOString() });
  saveStorage(STORAGE_KEYS.coaching, coachingEntries);

  document.getElementById("coachEmployee").value = "";
  document.getElementById("coachTopic").value = "";
  document.getElementById("coachNotes").value = "";

  renderCoaching();
  showToast("Coaching entry saved.");
}

// ============ CSV EXPORT ============

function exportCSV(type) {
  let rows = [];
  let filename = "";

  if (type === "dashboardTasks" || type === "operations") {
    rows = tasks.map(t => ({
      ID: t.id, Task: t.task, Owner: t.owner, Zone: t.zone,
      Priority: t.priority, Status: t.status, Age: getTaskAge(t),
      Risk: isTaskAtRisk(t) ? "At Risk" : "OK"
    }));
    filename = "tasks-export.csv";
  } else if (type === "inventory") {
    rows = getFilteredInventory().map(i => ({
      Item: i.item, Description: i.desc, "On Hand": i.onHand,
      Primary: i.primary, Overstock: i.overstock, Bin: i.bin, Status: i.status
    }));
    filename = "inventory-export.csv";
  } else if (type === "receiving") {
    rows = trucks.map(t => ({
      "Truck #": t.truckNumber, Carrier: t.carrier, "Dock Door": t.dockDoor,
      Containers: t.containers, "OSDs": t.osds,
      "Start Time": t.startTime, "Elapsed": getTruckElapsedTime(t),
      Status: t.status
    }));
    filename = "receiving-export.csv";
  } else if (type === "labor") {
    rows = laborData.map(l => ({
      Name: l.name, Role: l.role, Department: l.department,
      "Productivity %": l.productivity, Goal: getLaborGoalLabel(l.productivity),
      Errors: l.errors, Status: l.status
    }));
    filename = "labor-export.csv";
  } else if (type === "quality") {
    rows = qualityData.map(q => ({
      Date: q.date, Type: q.type, Area: q.area,
      Severity: q.severity, Owner: q.owner, Notes: q.notes
    }));
    filename = "quality-export.csv";
  }

  if (!rows.length) return showToast("No data to export.");

  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(","),
    ...rows.map(row => keys.map(k => JSON.stringify(String(row[k] ?? ""))).join(","))
  ].join("\n");

  downloadFile(filename, csv, "text/csv");
  showToast(`Exported ${rows.length} rows.`);
}

// ============ REPORTS ============

function generateReport(type) {
  const now = new Date();
  const header = `${"=".repeat(60)}\n`;
  let content = "";

  if (type === "supervisor") {
    content += header;
    content += "DAILY SUPERVISOR REPORT\n";
    content += `Generated: ${now.toLocaleString()}\n`;
    content += `Shift: ${document.getElementById("shiftSelect").value}\n`;
    content += header + "\n";

    content += "KEY METRICS\n";
    content += `  Open Tasks:     ${tasks.filter(t => t.status !== "Done").length}\n`;
    content += `  Tasks Behind:   ${tasks.filter(t => t.status !== "Done" && (t.status === "Queued" || t.status === "Pending" || isTaskAtRisk(t))).length}\n`;
    content += `  Trucks:         ${trucks.length}\n`;
    content += `  Low Inventory:  ${inventory.filter(i => i.status === "Low" || i.status === "Out").length}\n`;
    content += `  Incidents:      ${qualityData.length}\n`;
    content += `  Put-Away Logs:  ${putawayLogs.length}\n\n`;

    content += "TASKS\n" + "-".repeat(40) + "\n";
    tasks.forEach(t => { content += `  ${t.id} | ${t.task} | ${t.owner} | ${t.zone} | ${t.priority} | ${t.status}\n`; });

    content += "\nSUPERVISOR NOTES\n" + "-".repeat(40) + "\n";
    notes.forEach(n => { content += `  • ${n}\n`; });

    content += "\nCOACHING LOG\n" + "-".repeat(40) + "\n";
    coachingEntries.forEach(c => { content += `  ${c.employee} | ${c.topic} | ${c.notes}\n`; });

    content += "\nINCIDENTS\n" + "-".repeat(40) + "\n";
    qualityData.forEach(q => { content += `  ${q.date} | ${q.type} | ${q.area} | ${q.severity} | ${q.owner} | ${q.notes}\n`; });
  }

  if (type === "receiving") {
    content += header;
    content += "RECEIVING REPORT\n";
    content += `Generated: ${now.toLocaleString()}\n`;
    content += header + "\n";

    content += "TRUCK LOG\n" + "-".repeat(40) + "\n";
    trucks.forEach(t => {
      content += `  ${t.truckNumber} | ${t.carrier} | ${t.dockDoor} | Containers: ${t.containers} | OSDs: ${t.osds} | ${t.status} | Dock Time: ${getTruckElapsedTime(t)}\n`;
    });

    content += "\nPUT-AWAY LOGS\n" + "-".repeat(40) + "\n";
    putawayLogs.forEach(p => {
      content += `  ${formatDateTime(p.date)} | ${p.logNumber} | ${p.location} | ${p.rawLine}\n`;
    });
  }

  if (type === "inventory") {
    content += header;
    content += "INVENTORY REPORT\n";
    content += `Generated: ${now.toLocaleString()}\n`;
    content += header + "\n";

    content += "STOCK LEVELS\n" + "-".repeat(40) + "\n";
    getFilteredInventory().forEach(i => {
      content += `  ${i.item} | ${i.desc} | On Hand: ${i.onHand} | Primary: ${i.primary} | Overstock: ${i.overstock} | Bin: ${i.bin} | ${i.status}\n`;
    });

    content += "\nCOUNT HISTORY\n" + "-".repeat(40) + "\n";
    counts.forEach(c => {
      content += `  ${c.item} | ${c.desc} | Qty: ${c.qty} | Bin: ${c.bin} | ${formatDateTime(c.createdAt)}\n`;
    });
  }

  downloadFile(`${type}-report-${now.toISOString().slice(0, 10)}.txt`, content, "text/plain");
  showToast("Report downloaded.");
}

// ============ MODAL / TOAST ============

function openModal(title, html) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.add("show");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2400);
}

// ============ HELPERS ============

function getTaskAge(task) {
  if (!task.createdAt) return "-";
  const mins = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
}

function isTaskAtRisk(task) {
  if (!task.createdAt || task.status === "Done") return false;
  return (Date.now() - new Date(task.createdAt)) / 60000 > 30;
}

function isTruckDelayed(truck) {
  if (truck.status !== "Active") return false;
  return (Date.now() - new Date(truck.startTime)) / 60000 > 60;
}

function getTruckElapsedTime(truck) {
  if (truck.status === "Active") {
    return secondsToClock(Math.floor((new Date() - new Date(truck.startTime)) / 1000));
  }
  return secondsToClock(truck.totalElapsedSeconds || 0);
}

function getLaborStatusClass(productivity) {
  if (productivity >= 90) return "green";
  if (productivity >= 75) return "yellow";
  return "red";
}

function getLaborGoalLabel(productivity) {
  if (productivity >= 90) return "Above Goal";
  if (productivity >= 75) return "Near Goal";
  return "Below Goal";
}

function getTopIssueArea() {
  if (!qualityData.length) return "None";
  const counter = {};
  qualityData.forEach(i => { counter[i.area] = (counter[i.area] || 0) + 1; });
  return Object.entries(counter).sort((a, b) => b[1] - a[1])[0]?.[0] || "None";
}

function badge(value) {
  const v = String(value).toLowerCase();
  let cls = "gray";
  if (["active", "healthy", "on floor", "done", "completed", "on time", "above goal", "ok"].includes(v)) cls = "green";
  if (["queued", "medium", "counting"].includes(v)) cls = "blue";
  if (["pending", "low", "near goal"].includes(v)) cls = "yellow";
  if (["high", "out", "downtime", "below goal", "delayed", "at risk"].includes(v)) cls = "red";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function secondsToClock(seconds) {
  const hrs = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${hrs}:${mins}:${secs}`;
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cryptoRandomId() {
  return "id-" + Math.random().toString(36).slice(2, 11);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeAttribute(value) { return escapeHtml(value); }

// ============ GLOBAL EXPORTS ============

window.saveNewAction = saveNewAction;
window.saveTask = saveTask;
window.toggleTaskStatus = toggleTaskStatus;
window.confirmDeleteTask = confirmDeleteTask;
window.deleteNote = deleteNote;
window.saveCount = saveCount;
window.saveTruck = saveTruck;
window.stopTruckTimer = stopTruckTimer;
window.restartTruckTimer = restartTruckTimer;
window.editTruck = editTruck;
window.saveTruckEdit = saveTruckEdit;
window.confirmDeleteTruck = confirmDeleteTruck;
window.saveIncident = saveIncident;
window.processPutawayImage = processPutawayImage;
window.savePutawayFromPreview = savePutawayFromPreview;
window.confirmDeletePutawayLog = confirmDeletePutawayLog;
