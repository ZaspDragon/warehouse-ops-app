/* ============================================
   WarehouseOS — Firebase Put-Away + Order Picking
   ============================================ */

const STORAGE_KEYS = {
  tasks: "warehouse_tasks_v6",
  notes: "warehouse_notes_v6",
  inventory: "warehouse_inventory_v6",
  counts: "warehouse_counts_v6",
  trucks: "warehouse_trucks_v6",
  coaching: "warehouse_coaching_v6",
  quality: "warehouse_quality_v6",
  putawayLogs: "warehouse_putaway_logs_v6",
  pickLogs: "warehouse_pick_logs_v1"
};

const defaultTasks = [
  { id: "T-1042", task: "Putaway pallet — Valve Assembly", owner: "Kris", zone: "A-10-3", priority: "High", status: "Active", createdAt: new Date(Date.now() - 35 * 60000).toISOString() },
  { id: "T-1043", task: "Replenish primary pick location", owner: "Henry", zone: "K05-2", priority: "High", status: "Queued", createdAt: new Date(Date.now() - 15 * 60000).toISOString() },
  { id: "T-1044", task: "Cycle count — Aisle L variance", owner: "Dawitt", zone: "L4-2", priority: "Medium", status: "Active", createdAt: new Date(Date.now() - 8 * 60000).toISOString() }
];

const defaultInventory = [
  { item: "607529", desc: "Valve Assembly", onHand: 42, primary: 8, overstock: 34, bin: "A-10-3", status: "Healthy" },
  { item: "581220", desc: "PVC Fitting 3/4", onHand: 11, primary: 1, overstock: 10, bin: "B-04-1", status: "Low" },
  { item: "775981", desc: "Drain Kit Complete", onHand: 0, primary: 0, overstock: 0, bin: "C-12-2", status: "Out" },
  { item: "431006", desc: "Copper Elbow 1/2", onHand: 76, primary: 12, overstock: 64, bin: "F-02-1", status: "Healthy" }
];

const defaultLaborData = [
  { name: "Kris", role: "Lift Driver", department: "Putaway", productivity: 94, errors: 1, status: "On Floor" },
  { name: "Henry", role: "Lift Driver", department: "Replenishment", productivity: 88, errors: 2, status: "On Floor" },
  { name: "Dawitt", role: "Inventory", department: "Cycle Count", productivity: 91, errors: 0, status: "Counting" },
  { name: "Marcus", role: "Picker", department: "Outbound", productivity: 85, errors: 1, status: "On Floor" }
];

const defaultQualityData = [
  { id: "q-1", date: "2026-05-06", type: "Near Miss", area: "Receiving", severity: "Medium", owner: "Alicia", notes: "Forklift traffic too close to dock pedestrian walkway." }
];

const defaultTrucks = [
  { id: "trk-demo-1", truckNumber: "TRK-104", carrier: "FedEx Freight", dockDoor: "Door 4", containers: 3, osds: 1, startTime: new Date(Date.now() - 45 * 60000).toISOString(), endTime: null, status: "Active", totalElapsedSeconds: 0 }
];

let tasks = loadStorage(STORAGE_KEYS.tasks, defaultTasks);
let notes = loadStorage(STORAGE_KEYS.notes, ["Prioritize put-away before lunch.", "Check order picking shorts before shift end."]);
let inventory = loadStorage(STORAGE_KEYS.inventory, defaultInventory);
let counts = loadStorage(STORAGE_KEYS.counts, []);
let trucks = loadStorage(STORAGE_KEYS.trucks, defaultTrucks);
let coachingEntries = loadStorage(STORAGE_KEYS.coaching, []);
let qualityData = loadStorage(STORAGE_KEYS.quality, defaultQualityData);
let putawayLogs = loadStorage(STORAGE_KEYS.putawayLogs, []);
let pickLogs = loadStorage(STORAGE_KEYS.pickLogs, []);
let lastPutawayUploadCount = 0;

const laborData = defaultLaborData;

const views = {
  dashboard: document.getElementById("dashboardView"),
  operations: document.getElementById("operationsView"),
  inventory: document.getElementById("inventoryView"),
  receiving: document.getElementById("receivingView"),
  orderPicking: document.getElementById("orderPickingView"),
  labor: document.getElementById("laborView"),
  quality: document.getElementById("qualityView"),
  reports: document.getElementById("reportsView")
};

const viewTitles = {
  dashboard: ["Dashboard", "Shift overview — key metrics at a glance"],
  operations: ["Operations", "Create, manage, and advance work tasks"],
  inventory: ["Inventory", "Stock levels, cycle counts, and variance tracking"],
  receiving: ["Receiving & Dock", "Inbound trucks, dock timers, and put-away logs"],
  orderPicking: ["Order Picking", "Track picked item, quantity, picker, and source slot"],
  labor: ["Labor & Coaching", "Employee performance, coaching, and status tracking"],
  quality: ["Quality & Safety", "Track incidents, near misses, and corrective actions"],
  reports: ["Reports & Exports", "Generate and download shift reports"]
};

let firebaseReady = false;
let firebaseUser = null;

document.addEventListener("DOMContentLoaded", async () => {
  await initFirebase();
  setupNav();
  setupButtons();
  setupMobileMenu();
  setupKeyboard();
  renderAll();
  updateSidebarClock();
  await syncFromFirebase();

  setInterval(() => {
    renderReceivingTable();
    renderReceivingStats();
    renderDashboardStats();
    updateSidebarClock();
  }, 1000);
});

/* ============ FIREBASE ============ */

async function initFirebase() {
  const status = document.getElementById("firebaseStatus");

  if (!window.firebase || !window.db) {
    if (status) status.textContent = "Firebase: not loaded";
    return;
  }

  try {
    if (window.auth) {
      const userCredential = await window.auth.signInAnonymously();
      firebaseUser = userCredential.user;
    }

    firebaseReady = true;
    if (status) status.textContent = firebaseUser ? "Firebase: signed in" : "Firebase: connected";
  } catch (err) {
    console.error(err);
    firebaseReady = true;
    if (status) status.textContent = "Firebase: connected, auth blocked";
  }
}

async function syncFromFirebase() {
  await Promise.all([
    loadCollectionFromFirebase("putAwayLogs", (rows) => {
      putawayLogs = rows;
      saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
    }),
    loadCollectionFromFirebase("orderPickingLogs", (rows) => {
      pickLogs = rows;
      saveStorage(STORAGE_KEYS.pickLogs, pickLogs);
    })
  ]);

  renderAll();
}

async function loadCollectionFromFirebase(collectionName, setter) {
  if (!window.db) return;

  try {
    const snap = await window.db.collection(collectionName).orderBy("createdAt", "desc").limit(500).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setter(rows);
  } catch (err) {
    console.error(`Firebase read failed for ${collectionName}`, err);
    showToast(`Using local ${collectionName}; Firebase read blocked.`);
  }
}

async function saveDocToFirebase(collectionName, entry) {
  if (!window.db) return false;

  try {
    await window.db.collection(collectionName).doc(entry.id).set(entry);
    return true;
  } catch (err) {
    console.error(`Firebase save failed for ${collectionName}`, err);
    return false;
  }
}

async function deleteDocFromFirebase(collectionName, id) {
  if (!window.db) return false;

  try {
    await window.db.collection(collectionName).doc(id).delete();
    return true;
  } catch (err) {
    console.error(`Firebase delete failed for ${collectionName}`, err);
    return false;
  }
}

/* ============ STORAGE ============ */

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function id(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resetAllData() {
  if (!confirm("Reset all local demo data? Firebase data will stay unless deleted separately.")) return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  tasks = structuredClone(defaultTasks);
  notes = ["Prioritize put-away before lunch.", "Check order picking shorts before shift end."];
  inventory = structuredClone(defaultInventory);
  counts = [];
  trucks = structuredClone(defaultTrucks);
  coachingEntries = [];
  qualityData = structuredClone(defaultQualityData);
  putawayLogs = [];
  pickLogs = [];
  lastPutawayUploadCount = 0;
  renderAll();
  showToast("Local demo data restored.");
}

/* ============ SETUP ============ */

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.view;
      Object.values(views).forEach(v => v.classList.remove("active"));
      views[target]?.classList.add("active");
      const [title, subtitle] = viewTitles[target] || ["Dashboard", ""];
      document.getElementById("topbarTitle").textContent = title;
      document.getElementById("topbarSubtitle").textContent = subtitle;
      closeMobileMenu();
    });
  });
}

function setupMobileMenu() {
  document.getElementById("mobileMenuBtn")?.addEventListener("click", toggleMobileMenu);
  document.getElementById("mobileOverlay")?.addEventListener("click", closeMobileMenu);
}

function toggleMobileMenu() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("mobileOverlay").classList.toggle("show");
}

function closeMobileMenu() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("mobileOverlay").classList.remove("show");
}

function setupKeyboard() {
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });
}

function setupButtons() {
  document.getElementById("newActionBtn")?.addEventListener("click", openNewActionModal);
  document.getElementById("createTaskBtn")?.addEventListener("click", openCreateTaskModal);
  document.getElementById("newCountBtn")?.addEventListener("click", openNewCountModal);
  document.getElementById("addTruckBtn")?.addEventListener("click", openAddTruckModal);
  document.getElementById("addIncidentBtn")?.addEventListener("click", openAddIncidentModal);
  document.getElementById("uploadPutawayBtn")?.addEventListener("click", openPutawayUploadModal);
  document.getElementById("manualPutawayBtn")?.addEventListener("click", openManualPutawayModal);
  document.getElementById("addPickBtn")?.addEventListener("click", openAddPickModal);
  document.getElementById("saveQuickPickBtn")?.addEventListener("click", saveQuickPick);
  document.getElementById("closeModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("resetDataBtn")?.addEventListener("click", resetAllData);

  document.getElementById("saveDashboardNoteBtn")?.addEventListener("click", () => {
    const input = document.getElementById("dashboardNoteInput");
    const value = input.value.trim();
    if (!value) return showToast("Enter a note first.");
    notes.unshift(value);
    saveStorage(STORAGE_KEYS.notes, notes);
    input.value = "";
    renderNotes();
    showToast("Note saved.");
  });

  document.getElementById("saveCoachingBtn")?.addEventListener("click", saveCoachingEntry);
  document.getElementById("globalSearch")?.addEventListener("input", renderAll);

  document.querySelectorAll(".export-csv-btn").forEach(btn => {
    btn.addEventListener("click", () => exportCSV(btn.dataset.export));
  });

  document.querySelectorAll(".generate-report-btn").forEach(btn => {
    btn.addEventListener("click", () => generateReport(btn.dataset.report));
  });

  document.getElementById("modalOverlay")?.addEventListener("click", e => {
    if (e.target.id === "modalOverlay") closeModal();
  });
}

/* ============ RENDER ============ */

function renderAll() {
  renderTasks();
  renderNotes();
  renderInventory();
  renderReceivingTable();
  renderReceivingStats();
  renderPutawayLogs();
  renderPicking();
  renderLabor();
  renderQuality();
  renderCoaching();
  renderDashboardStats();
}

function getSearchValue() {
  return document.getElementById("globalSearch")?.value.trim().toLowerCase() || "";
}

function renderDashboardStats() {
  document.getElementById("dashboardTaskCount").textContent = tasks.filter(t => t.status !== "Done").length;
  document.getElementById("activeTrucks").textContent = trucks.filter(t => t.status === "Active").length;
  document.getElementById("dashboardPutawayCount").textContent = putawayLogs.length;
  document.getElementById("dashboardPickCount").textContent = pickLogs.length;
}

function renderTasks() {
  const search = getSearchValue();
  const filtered = tasks.filter(t => `${t.id} ${t.task} ${t.owner} ${t.zone} ${t.priority} ${t.status}`.toLowerCase().includes(search));

  const operationsBody = document.getElementById("operationsTaskTable");
  const dashboardBody = document.getElementById("dashboardTaskTable");
  if (!operationsBody || !dashboardBody) return;

  operationsBody.innerHTML = "";
  dashboardBody.innerHTML = "";

  if (!filtered.length) {
    operationsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px;">No tasks found.</td></tr>`;
    dashboardBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No tasks found.</td></tr>`;
    return;
  }

  filtered.forEach(task => {
    operationsBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(task.id)}</strong></td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
        <td>${getTaskAge(task)}</td>
        <td><button class="small-btn" onclick="toggleTaskStatus('${task.id}')">Advance</button> <button class="small-btn" onclick="confirmDeleteTask('${task.id}')">Delete</button></td>
      </tr>
    `);

    dashboardBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(task.id)}</strong></td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
        <td><button class="small-btn" onclick="toggleTaskStatus('${task.id}')">Advance</button></td>
      </tr>
    `);
  });
}

function renderNotes() {
  const list = document.getElementById("dashboardNotesList");
  if (!list) return;
  list.innerHTML = notes.length ? "" : `<div class="note-box" style="color:#94a3b8;">No supervisor notes yet.</div>`;
  notes.forEach((note, index) => {
    list.insertAdjacentHTML("beforeend", `<div class="note-box">${escapeHtml(note)} <button class="small-btn" style="float:right;" onclick="deleteNote(${index})">×</button></div>`);
  });
}

function renderInventory() {
  const body = document.getElementById("inventoryTable");
  if (!body) return;
  const search = getSearchValue();
  const filtered = inventory.filter(i => `${i.item} ${i.desc} ${i.bin} ${i.status}`.toLowerCase().includes(search));

  body.innerHTML = "";
  filtered.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr><td><strong>${escapeHtml(item.item)}</strong></td><td>${escapeHtml(item.desc)}</td><td>${item.onHand}</td><td>${item.primary}</td><td>${item.overstock}</td><td>${escapeHtml(item.bin)}</td><td>${badge(item.status)}</td></tr>
    `);
  });

  if (!filtered.length) body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No inventory found.</td></tr>`;
  document.getElementById("inventoryTotalCount").textContent = filtered.length;
  document.getElementById("inventoryLowCount").textContent = filtered.filter(i => i.status === "Low" || i.status === "Out").length;
  document.getElementById("inventoryCountTotal").textContent = counts.length;
}

function renderReceivingTable() {
  const body = document.getElementById("receivingTable");
  if (!body) return;
  const search = getSearchValue();
  const filtered = trucks.filter(t => `${t.truckNumber} ${t.carrier} ${t.dockDoor} ${t.status}`.toLowerCase().includes(search));

  body.innerHTML = "";
  filtered.forEach(truck => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td><strong>${escapeHtml(truck.truckNumber)}</strong></td>
        <td>${escapeHtml(truck.carrier)}</td>
        <td>${escapeHtml(truck.dockDoor)}</td>
        <td>${truck.containers}</td>
        <td>${truck.osds}</td>
        <td>${formatDateTime(truck.startTime)}</td>
        <td style="font-variant-numeric:tabular-nums;font-weight:800;">${getTruckElapsedTime(truck)}</td>
        <td>${badge(truck.status)}</td>
        <td>
          ${truck.status === "Active" ? `<button class="small-btn" onclick="stopTruckTimer('${truck.id}')">Stop</button>` : `<button class="small-btn" onclick="restartTruckTimer('${truck.id}')">Restart</button>`}
          <button class="small-btn" onclick="confirmDeleteTruck('${truck.id}')">Delete</button>
        </td>
      </tr>
    `);
  });

  if (!filtered.length) body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px;">No trucks logged.</td></tr>`;
}

function renderReceivingStats() {
  document.getElementById("receivingTruckTotal").textContent = trucks.length;
  document.getElementById("receivingOsdTotal").textContent = trucks.reduce((sum, t) => sum + Number(t.osds || 0), 0);
  document.getElementById("receivingContainerTotal").textContent = trucks.reduce((sum, t) => sum + Number(t.containers || 0), 0);
  document.getElementById("receivingActiveTimers").textContent = trucks.filter(t => t.status === "Active").length;

  const completed = trucks.filter(t => t.totalElapsedSeconds && t.status !== "Active");
  const avg = completed.length ? Math.floor(completed.reduce((sum, t) => sum + t.totalElapsedSeconds, 0) / completed.length) : 0;
  document.getElementById("receivingAverageDockTime").textContent = secondsToClock(avg);
}

function renderPutawayLogs() {
  const body = document.getElementById("putawayTable");
  if (!body) return;
  const search = getSearchValue();
  const filtered = putawayLogs.filter(e => `${e.date} ${e.item} ${e.qty} ${e.location} ${e.worker} ${e.docNumber} ${e.rawLine}`.toLowerCase().includes(search));

  body.innerHTML = "";
  filtered.forEach(entry => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${formatDateTime(entry.date || entry.createdAt)}</td>
        <td><strong>${escapeHtml(entry.item || "")}</strong></td>
        <td>${escapeHtml(entry.qty || "")}</td>
        <td>${escapeHtml(entry.location || "")}</td>
        <td>${escapeHtml(entry.worker || "")}</td>
        <td>${escapeHtml(entry.docNumber || "")}</td>
        <td>${escapeHtml(entry.rawLine || "")}</td>
        <td><button class="small-btn" onclick="confirmDeletePutawayLog('${entry.id}')">Delete</button></td>
      </tr>
    `);
  });

  if (!filtered.length) body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px;">No put-away logs yet.</td></tr>`;
  document.getElementById("putawayLogTotal").textContent = putawayLogs.length;
  document.getElementById("putawayLocationTotal").textContent = new Set(putawayLogs.map(x => x.location).filter(Boolean)).size;
  document.getElementById("putawayLastUploadCount").textContent = lastPutawayUploadCount;
}

function renderPicking() {
  const body = document.getElementById("pickingTable");
  if (!body) return;
  const search = getSearchValue();
  const filtered = pickLogs.filter(e => `${e.date} ${e.worker} ${e.orderNumber} ${e.item} ${e.qty} ${e.slot} ${e.status} ${e.notes}`.toLowerCase().includes(search));

  body.innerHTML = "";
  filtered.forEach(pick => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${formatDateTime(pick.date || pick.createdAt)}</td>
        <td>${escapeHtml(pick.worker || "")}</td>
        <td>${escapeHtml(pick.orderNumber || "")}</td>
        <td><strong>${escapeHtml(pick.item || "")}</strong></td>
        <td>${escapeHtml(pick.qty || "")}</td>
        <td>${escapeHtml(pick.slot || "")}</td>
        <td>${badge(pick.status || "Picked")}</td>
        <td>${escapeHtml(pick.notes || "")}</td>
        <td><button class="small-btn" onclick="confirmDeletePick('${pick.id}')">Delete</button></td>
      </tr>
    `);
  });

  if (!filtered.length) body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px;">No picking entries yet.</td></tr>`;
  document.getElementById("pickLineTotal").textContent = pickLogs.length;
  document.getElementById("pickQtyTotal").textContent = pickLogs.reduce((sum, p) => sum + Number(p.qty || 0), 0);
  document.getElementById("pickerTotal").textContent = new Set(pickLogs.map(p => p.worker).filter(Boolean)).size;
  document.getElementById("pickShortTotal").textContent = pickLogs.filter(p => ["Short", "Damaged", "Wrong Slot"].includes(p.status)).length;
}

function renderLabor() {
  const body = document.getElementById("laborTable");
  if (!body) return;
  body.innerHTML = "";
  laborData.forEach(emp => {
    body.insertAdjacentHTML("beforeend", `
      <tr><td><strong>${escapeHtml(emp.name)}</strong></td><td>${escapeHtml(emp.role)}</td><td>${escapeHtml(emp.department)}</td><td>${emp.productivity}%</td><td>${emp.errors}</td><td>${badge(emp.status)}</td></tr>
    `);
  });
}

function renderQuality() {
  const body = document.getElementById("qualityTable");
  if (!body) return;
  body.innerHTML = "";
  qualityData.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.area)}</td><td>${badge(item.severity)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.notes || "")}</td></tr>
    `);
  });
  document.getElementById("qualityTotalCount").textContent = qualityData.length;
  document.getElementById("qualityHighCount").textContent = qualityData.filter(i => i.severity === "High").length;
  document.getElementById("qualityTopArea").textContent = getTopIssueArea();
}

function renderCoaching() {
  const list = document.getElementById("coachingList");
  if (!list) return;
  list.innerHTML = coachingEntries.length ? "" : `<div class="coach-box" style="color:#94a3b8;">No coaching entries yet.</div>`;
  coachingEntries.forEach(entry => {
    list.insertAdjacentHTML("beforeend", `<div class="coach-box"><strong>${escapeHtml(entry.employee)}</strong> — ${escapeHtml(entry.topic)}<br>${escapeHtml(entry.notes)}<br><small>${formatDateTime(entry.createdAt)}</small></div>`);
  });
}

/* ============ CRUD TASKS / NOTES ============ */

function openNewActionModal() {
  openModal("New Action", `
    <div class="form-grid">
      <div><label>Owner</label><input id="newActionOwner" placeholder="Kris" /></div>
      <div><label>Zone / Area</label><input id="newActionZone" placeholder="A-10-3 or Receiving" /></div>
      <div><label>Priority</label><select id="newActionPriority"><option>High</option><option selected>Medium</option><option>Low</option></select></div>
      <div><label>Status</label><select id="newActionStatus"><option selected>Active</option><option>Queued</option><option>Pending</option></select></div>
      <div class="full-span"><label>Description</label><textarea id="newActionDescription" placeholder="What needs to happen?"></textarea></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveNewAction()">Save Action</button></div>
  `);
}

function saveNewAction() {
  const desc = document.getElementById("newActionDescription").value.trim();
  if (!desc) return showToast("Enter a description first.");
  tasks.unshift({
    id: `T-${Math.floor(1000 + Math.random() * 9000)}`,
    task: desc,
    owner: document.getElementById("newActionOwner").value.trim() || "Unassigned",
    zone: document.getElementById("newActionZone").value.trim() || "General",
    priority: document.getElementById("newActionPriority").value,
    status: document.getElementById("newActionStatus").value,
    createdAt: new Date().toISOString()
  });
  saveStorage(STORAGE_KEYS.tasks, tasks);
  closeModal();
  renderAll();
  showToast("Action saved.");
}

function openCreateTaskModal() { openNewActionModal(); }

function toggleTaskStatus(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const flow = ["Queued", "Active", "Pending", "Done"];
  const currentIndex = flow.indexOf(task.status);
  task.status = flow[(currentIndex + 1) % flow.length];
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderAll();
}

function confirmDeleteTask(id) {
  if (!confirm("Delete this task?")) return;
  tasks = tasks.filter(t => t.id !== id);
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderAll();
}

function deleteNote(index) {
  notes.splice(index, 1);
  saveStorage(STORAGE_KEYS.notes, notes);
  renderNotes();
}

/* ============ INVENTORY ============ */

function openNewCountModal() {
  openModal("New Inventory Count", `
    <div class="form-grid">
      <div><label>Item Number</label><input id="countItemInput" placeholder="607529" /></div>
      <div><label>Bin</label><input id="countBinInput" placeholder="A-10-3" /></div>
      <div><label>Counted Quantity</label><input id="countQtyInput" type="number" placeholder="12" /></div>
      <div><label>Description</label><input id="countDescInput" placeholder="Valve Assembly" /></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveCount()">Save Count</button></div>
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
    existing.status = qty === 0 ? "Out" : qty <= 5 ? "Low" : "Healthy";
  } else {
    inventory.unshift({ item, desc, onHand: qty, primary: Math.min(qty, 5), overstock: Math.max(qty - Math.min(qty, 5), 0), bin, status: qty === 0 ? "Out" : qty <= 5 ? "Low" : "Healthy" });
  }
  saveStorage(STORAGE_KEYS.counts, counts);
  saveStorage(STORAGE_KEYS.inventory, inventory);
  closeModal();
  renderAll();
}

/* ============ TRUCKS ============ */

function openAddTruckModal() {
  openModal("Add Truck", `
    <div class="form-grid">
      <div><label>Truck #</label><input id="truckNumberInput" placeholder="TRK-108" /></div>
      <div><label>Carrier</label><input id="carrierInput" placeholder="XPO / FedEx / Transfer" /></div>
      <div><label>Dock Door</label><input id="dockDoorInput" placeholder="Door 4" /></div>
      <div><label>Containers</label><input id="containersInput" type="number" value="1" /></div>
      <div><label>OS&Ds</label><input id="osdsInput" type="number" value="0" /></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveTruck()">Start Truck Timer</button></div>
  `);
}

function saveTruck() {
  const truckNumber = document.getElementById("truckNumberInput").value.trim();
  if (!truckNumber) return showToast("Truck # is required.");
  trucks.unshift({
    id: id("trk"),
    truckNumber,
    carrier: document.getElementById("carrierInput").value.trim() || "Unknown",
    dockDoor: document.getElementById("dockDoorInput").value.trim() || "Unassigned",
    containers: Number(document.getElementById("containersInput").value || 0),
    osds: Number(document.getElementById("osdsInput").value || 0),
    startTime: new Date().toISOString(),
    endTime: null,
    status: "Active",
    totalElapsedSeconds: 0
  });
  saveStorage(STORAGE_KEYS.trucks, trucks);
  closeModal();
  renderAll();
}

function stopTruckTimer(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck) return;
  truck.endTime = new Date().toISOString();
  truck.status = "Completed";
  truck.totalElapsedSeconds = Math.floor((new Date(truck.endTime) - new Date(truck.startTime)) / 1000);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderAll();
}

function restartTruckTimer(truckId) {
  const truck = trucks.find(t => t.id === truckId);
  if (!truck) return;
  truck.startTime = new Date().toISOString();
  truck.endTime = null;
  truck.status = "Active";
  truck.totalElapsedSeconds = 0;
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderAll();
}

function confirmDeleteTruck(truckId) {
  if (!confirm("Delete this truck?")) return;
  trucks = trucks.filter(t => t.id !== truckId);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderAll();
}

/* ============ PUT-AWAY LOGS ============ */

function openManualPutawayModal() {
  openModal("Manual Put-Away Entry", `
    <div class="form-grid">
      <div><label>Worker</label><input id="putWorkerInput" placeholder="Lift driver" /></div>
      <div><label>PO / SPO / XFR</label><input id="putDocInput" placeholder="SPO0219241" /></div>
      <div><label>Item #</label><input id="putItemInput" placeholder="607529" /></div>
      <div><label>Qty</label><input id="putQtyInput" type="number" placeholder="24" /></div>
      <div><label>Location / Slot</label><input id="putLocationInput" placeholder="B-20-2" /></div>
      <div><label>Source</label><select id="putSourceInput"><option>Manual</option><option>OCR</option><option>Transfer</option></select></div>
      <div class="full-span"><label>Raw Line / Notes</label><input id="putRawInput" placeholder="Optional notes or pasted line" /></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveManualPutaway()">Save Put-Away Entry</button></div>
  `);
}

async function saveManualPutaway() {
  const entry = {
    id: id("put"),
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    worker: document.getElementById("putWorkerInput").value.trim(),
    docNumber: document.getElementById("putDocInput").value.trim(),
    item: document.getElementById("putItemInput").value.trim(),
    qty: document.getElementById("putQtyInput").value.trim(),
    location: document.getElementById("putLocationInput").value.trim(),
    source: document.getElementById("putSourceInput").value,
    rawLine: document.getElementById("putRawInput").value.trim()
  };

  if (!entry.item || !entry.location) return showToast("Item # and location are required.");
  putawayLogs.unshift(entry);
  saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
  await saveDocToFirebase("putAwayLogs", entry);
  closeModal();
  renderAll();
  showToast("Put-away entry saved.");
}

function openPutawayUploadModal() {
  openModal("Upload Put-Away Image / OCR", `
    <p style="color:#64748b;margin-top:0;">Upload an image, then review OCR text before saving. You can also paste lines directly.</p>
    <input id="putawayImageInput" type="file" accept="image/*" />
    <div class="btn-row mt-16">
      <button class="secondary-btn" onclick="runPutawayOCR()">Run OCR</button>
      <button class="primary-btn" onclick="savePutawayFromPreview()">Save Parsed Lines</button>
    </div>
    <label style="margin-top:16px;">OCR Preview / Paste Lines</label>
    <textarea id="putawayOcrPreview" placeholder="Example lines:
607529 24 B-20-2
581220 Qty 12 Loc K-04-1"></textarea>
  `);
}

async function runPutawayOCR() {
  const input = document.getElementById("putawayImageInput");
  const file = input?.files?.[0];
  if (!file) return showToast("Choose an image first.");
  const preview = document.getElementById("putawayOcrPreview");
  preview.value = "Reading image...";
  try {
    const result = await Tesseract.recognize(file, "eng");
    preview.value = result.data.text || "";
    showToast("OCR complete.");
  } catch (err) {
    console.error(err);
    preview.value = "";
    showToast("OCR failed. Paste the text manually.");
  }
}

async function savePutawayFromPreview() {
  const text = document.getElementById("putawayOcrPreview").value.trim();
  if (!text) return showToast("No text to parse.");
  const parsed = parsePutawayLogText(text);
  if (!parsed.length) return showToast("No put-away entries found.");

  const entries = parsed.map(row => ({
    id: id("put"),
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    worker: "",
    docNumber: row.docNumber || "",
    item: row.item || "",
    qty: row.qty || "",
    location: row.location || "",
    source: "OCR",
    rawLine: row.rawLine || ""
  }));

  for (const entry of entries) {
    putawayLogs.unshift(entry);
    await saveDocToFirebase("putAwayLogs", entry);
  }

  lastPutawayUploadCount = entries.length;
  saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
  closeModal();
  renderAll();
  showToast(`Saved ${entries.length} put-away entries.`);
}

function parsePutawayLogText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];

  lines.forEach(line => {
    const itemMatch = line.match(/\b\d{5,8}\b/);
    const qtyMatch = line.match(/\b(?:qty|quantity)?\s*[:#-]?\s*(\d{1,5})\b/i);
    const locMatch = line.match(/\b[A-Z]{1,2}-?\d{1,3}-\d{1,3}(?:-\d{1,3})?\b/i);
    const docMatch = line.match(/\b(?:SPO|PO|XFR|SXFR)\d+\b/i);

    const item = itemMatch ? itemMatch[0] : "";
    const location = locMatch ? locMatch[0].toUpperCase() : "";
    let qty = "";

    if (qtyMatch && qtyMatch[1] !== item) qty = qtyMatch[1];

    if (item || location) out.push({ item, qty, location, docNumber: docMatch ? docMatch[0].toUpperCase() : "", rawLine: line });
  });

  return out;
}

async function confirmDeletePutawayLog(entryId) {
  if (!confirm("Delete this put-away entry?")) return;
  putawayLogs = putawayLogs.filter(e => e.id !== entryId);
  saveStorage(STORAGE_KEYS.putawayLogs, putawayLogs);
  await deleteDocFromFirebase("putAwayLogs", entryId);
  renderAll();
}

/* ============ ORDER PICKING ============ */

async function saveQuickPick() {
  const entry = {
    id: id("pick"),
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    worker: document.getElementById("pickWorkerInput").value.trim(),
    orderNumber: document.getElementById("pickOrderInput").value.trim(),
    item: document.getElementById("pickItemInput").value.trim(),
    qty: document.getElementById("pickQtyInput").value.trim(),
    slot: document.getElementById("pickSlotInput").value.trim(),
    status: document.getElementById("pickStatusInput").value,
    notes: document.getElementById("pickNotesInput").value.trim()
  };

  if (!entry.worker || !entry.item || !entry.qty || !entry.slot) {
    return showToast("Picker, item, qty, and slot are required.");
  }

  pickLogs.unshift(entry);
  saveStorage(STORAGE_KEYS.pickLogs, pickLogs);
  await saveDocToFirebase("orderPickingLogs", entry);

  document.getElementById("pickItemInput").value = "";
  document.getElementById("pickQtyInput").value = "";
  document.getElementById("pickSlotInput").value = "";
  document.getElementById("pickNotesInput").value = "";

  renderAll();
  showToast("Pick line saved.");
}

function openAddPickModal() {
  openModal("Add Pick Line", `
    <div class="form-grid">
      <div><label>Picker</label><input id="modalPickWorker" placeholder="Picker name" /></div>
      <div><label>Order / Transfer #</label><input id="modalPickOrder" placeholder="XFR / SO / Order #" /></div>
      <div><label>Item #</label><input id="modalPickItem" placeholder="Item #" /></div>
      <div><label>Qty Picked</label><input id="modalPickQty" type="number" min="0" /></div>
      <div><label>From Slot / Bin</label><input id="modalPickSlot" placeholder="B-20-2" /></div>
      <div><label>Status</label><select id="modalPickStatus"><option>Picked</option><option>Short</option><option>Damaged</option><option>Wrong Slot</option></select></div>
      <div class="full-span"><label>Notes</label><input id="modalPickNotes" placeholder="Optional notes" /></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveModalPick()">Save Pick Line</button></div>
  `);
}

async function saveModalPick() {
  const entry = {
    id: id("pick"),
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    worker: document.getElementById("modalPickWorker").value.trim(),
    orderNumber: document.getElementById("modalPickOrder").value.trim(),
    item: document.getElementById("modalPickItem").value.trim(),
    qty: document.getElementById("modalPickQty").value.trim(),
    slot: document.getElementById("modalPickSlot").value.trim(),
    status: document.getElementById("modalPickStatus").value,
    notes: document.getElementById("modalPickNotes").value.trim()
  };

  if (!entry.worker || !entry.item || !entry.qty || !entry.slot) return showToast("Picker, item, qty, and slot are required.");

  pickLogs.unshift(entry);
  saveStorage(STORAGE_KEYS.pickLogs, pickLogs);
  await saveDocToFirebase("orderPickingLogs", entry);
  closeModal();
  renderAll();
  showToast("Pick line saved.");
}

async function confirmDeletePick(entryId) {
  if (!confirm("Delete this pick line?")) return;
  pickLogs = pickLogs.filter(e => e.id !== entryId);
  saveStorage(STORAGE_KEYS.pickLogs, pickLogs);
  await deleteDocFromFirebase("orderPickingLogs", entryId);
  renderAll();
}

/* ============ QUALITY / LABOR ============ */

function saveCoachingEntry() {
  const employee = document.getElementById("coachEmployee").value.trim();
  const topic = document.getElementById("coachTopic").value.trim();
  const notesText = document.getElementById("coachNotes").value.trim();
  if (!employee || !topic || !notesText) return showToast("Fill out employee, topic, and notes.");
  coachingEntries.unshift({ employee, topic, notes: notesText, createdAt: new Date().toISOString() });
  saveStorage(STORAGE_KEYS.coaching, coachingEntries);
  document.getElementById("coachEmployee").value = "";
  document.getElementById("coachTopic").value = "";
  document.getElementById("coachNotes").value = "";
  renderCoaching();
}

function openAddIncidentModal() {
  openModal("Add Quality / Safety Incident", `
    <div class="form-grid">
      <div><label>Type</label><input id="incidentTypeInput" placeholder="Near Miss / Damage / Safety" /></div>
      <div><label>Area</label><input id="incidentAreaInput" placeholder="Receiving / Aisle K" /></div>
      <div><label>Severity</label><select id="incidentSeverityInput"><option>Low</option><option selected>Medium</option><option>High</option></select></div>
      <div><label>Owner</label><input id="incidentOwnerInput" placeholder="Owner" /></div>
      <div class="full-span"><label>Notes</label><textarea id="incidentNotesInput"></textarea></div>
    </div>
    <div class="mt-16"><button class="primary-btn full" onclick="saveIncident()">Save Incident</button></div>
  `);
}

function saveIncident() {
  qualityData.unshift({
    id: id("q"),
    date: new Date().toISOString().slice(0, 10),
    type: document.getElementById("incidentTypeInput").value.trim() || "Incident",
    area: document.getElementById("incidentAreaInput").value.trim() || "General",
    severity: document.getElementById("incidentSeverityInput").value,
    owner: document.getElementById("incidentOwnerInput").value.trim() || "Unassigned",
    notes: document.getElementById("incidentNotesInput").value.trim()
  });
  saveStorage(STORAGE_KEYS.quality, qualityData);
  closeModal();
  renderAll();
}

/* ============ REPORTS / EXPORTS ============ */

function exportCSV(type) {
  let rows = [];
  let filename = `${type}-${new Date().toISOString().slice(0,10)}.csv`;

  if (type === "tasks") rows = tasks;
  if (type === "inventory") rows = inventory;
  if (type === "receiving") rows = trucks;
  if (type === "picks") rows = pickLogs;
  if (type === "quality") rows = qualityData;
  if (type === "labor") rows = laborData;

  if (!rows.length) return showToast("No data to export.");

  downloadCSV(rows, filename);
}

function generateReport(type) {
  let text = `WarehouseOS ${type.toUpperCase()} Report\nGenerated: ${new Date().toLocaleString()}\n\n`;

  text += `Open Tasks: ${tasks.filter(t => t.status !== "Done").length}\n`;
  text += `Trucks: ${trucks.length}\n`;
  text += `Put-Away Logs: ${putawayLogs.length}\n`;
  text += `Pick Lines: ${pickLogs.length}\n`;
  text += `Quality Incidents: ${qualityData.length}\n\n`;

  if (type === "picking") {
    text += "Picking Lines:\n";
    pickLogs.forEach(p => text += `${p.date} | ${p.worker} | ${p.orderNumber} | ${p.item} | Qty ${p.qty} | ${p.slot} | ${p.status}\n`);
  }

  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${type}-report-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCSV(rows, filename) {
  const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const csv = [headers, ...rows.map(row => headers.map(h => row[h] ?? ""))]
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============ UTILITIES ============ */

function openModal(title, html) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
  document.getElementById("modalBody").innerHTML = "";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return alert(message);
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2800);
}

function updateSidebarClock() {
  const el = document.getElementById("sidebarClock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badge(value) {
  const v = String(value || "").toLowerCase();
  let cls = "gray";
  if (["active", "high", "picked", "healthy", "on floor", "completed", "done"].includes(v)) cls = "green";
  if (["medium", "queued", "pending"].includes(v)) cls = "yellow";
  if (["low", "out", "short", "damaged", "wrong slot", "high"].includes(v)) cls = "red";
  if (["normal"].includes(v)) cls = "blue";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function formatDateTime(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function secondsToClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

function getTruckElapsedTime(truck) {
  if (truck.status === "Active" && truck.startTime) {
    return secondsToClock(Math.floor((Date.now() - new Date(truck.startTime).getTime()) / 1000));
  }
  return secondsToClock(Number(truck.totalElapsedSeconds || 0));
}

function getTaskAge(task) {
  const mins = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getTopIssueArea() {
  if (!qualityData.length) return "None";
  const counts = {};
  qualityData.forEach(i => counts[i.area] = (counts[i.area] || 0) + 1);
  return Object.entries(counts).sort((a,b) => b[1] - a[1])[0][0];
}
