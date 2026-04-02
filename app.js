const STORAGE_KEYS = {
  tasks: "warehouse_tasks_v2",
  notes: "warehouse_notes_v2",
  inventory: "warehouse_inventory_v2",
  counts: "warehouse_counts_v2",
  trucks: "warehouse_trucks_v2",
  coaching: "warehouse_coaching_v2"
};

const defaultTasks = [
  { id: "T-1042", task: "Putaway pallet", owner: "Kris", zone: "A-10-3", priority: "High", status: "Active" },
  { id: "T-1043", task: "Replenish primary", owner: "Henry", zone: "K05-2", priority: "High", status: "Queued" },
  { id: "T-1044", task: "Cycle count", owner: "Dawitt", zone: "L4-2", priority: "Medium", status: "Active" },
  { id: "T-1045", task: "Damage review", owner: "Yussif", zone: "QC", priority: "Low", status: "Pending" }
];

const defaultInventory = [
  { item: "607529", desc: "Valve Assembly", onHand: 42, primary: 8, overstock: 34, bin: "A-10-3", status: "Healthy" },
  { item: "581220", desc: "PVC Fitting", onHand: 11, primary: 1, overstock: 10, bin: "B-04-1", status: "Low" },
  { item: "775981", desc: "Drain Kit", onHand: 0, primary: 0, overstock: 0, bin: "C-12-2", status: "Out" },
  { item: "431006", desc: "Copper Elbow", onHand: 76, primary: 12, overstock: 64, bin: "F-02-1", status: "Healthy" }
];

const defaultNotes = [
  "Primary replenishment is running behind in A and K aisles.",
  "Cycle count variance found on item 581220."
];

const laborData = [
  { name: "Kris", role: "Lift Driver", department: "Putaway", productivity: 94, errors: 1, status: "On Floor" },
  { name: "Henry", role: "Lift Driver", department: "Replenishment", productivity: 88, errors: 2, status: "On Floor" },
  { name: "Dawitt", role: "Inventory", department: "Cycle Count", productivity: 91, errors: 0, status: "Counting" },
  { name: "Yussif", role: "Lift Driver", department: "Putaway", productivity: 79, errors: 3, status: "Downtime" }
];

const qualityData = [
  { date: "2026-04-02", type: "Near Miss", area: "Receiving", severity: "Medium", owner: "Alicia" },
  { date: "2026-04-02", type: "Inventory Variance", area: "Aisle K", severity: "High", owner: "Henry" },
  { date: "2026-04-01", type: "Damaged Product", area: "Aisle A", severity: "Low", owner: "Kris" }
];

let tasks = loadStorage(STORAGE_KEYS.tasks, defaultTasks);
let notes = loadStorage(STORAGE_KEYS.notes, defaultNotes);
let inventory = loadStorage(STORAGE_KEYS.inventory, defaultInventory);
let counts = loadStorage(STORAGE_KEYS.counts, []);
let trucks = loadStorage(STORAGE_KEYS.trucks, []);
let coachingEntries = loadStorage(STORAGE_KEYS.coaching, []);

let inventoryFiltersOpen = false;
let inventoryFilterState = {
  status: "all",
  bin: ""
};

const views = {
  dashboard: document.getElementById("dashboardView"),
  operations: document.getElementById("operationsView"),
  inventory: document.getElementById("inventoryView"),
  receiving: document.getElementById("receivingView"),
  labor: document.getElementById("laborView"),
  quality: document.getElementById("qualityView"),
  reports: document.getElementById("reportsView")
};

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupButtons();
  renderAll();
  setInterval(() => {
    renderReceivingTable();
    renderReceivingStats();
  }, 1000);
});

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.view;
      Object.values(views).forEach(v => v.classList.remove("active"));
      views[target].classList.add("active");
    });
  });
}

function setupButtons() {
  document.getElementById("newActionBtn").addEventListener("click", openNewActionModal);
  document.getElementById("createTaskBtn").addEventListener("click", openCreateTaskModal);
  document.getElementById("filtersBtn").addEventListener("click", toggleInventoryFilters);
  document.getElementById("newCountBtn").addEventListener("click", openNewCountModal);
  document.getElementById("addTruckBtn").addEventListener("click", openAddTruckModal);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);

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

  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });

  document.getElementById("globalSearch").addEventListener("input", renderAll);
}

function renderAll() {
  renderTasks();
  renderNotes();
  renderInventory();
  renderReceivingTable();
  renderReceivingStats();
  renderLabor();
  renderQuality();
  renderCoaching();
  renderDashboardStats();
}

function renderDashboardStats() {
  document.getElementById("dashboardTruckCount").textContent = trucks.length;
  document.getElementById("dashboardCountCount").textContent = counts.length;
  document.getElementById("dashboardTaskCount").textContent = tasks.length;
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

  filtered.forEach(task => {
    const rowHtml = `
      <tr>
        <td>${task.id}</td>
        <td>${task.task}</td>
        <td>${task.owner}</td>
        <td>${task.zone}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
        <td>
          <div class="action-row">
            <button class="small-btn" onclick="toggleTaskStatus('${task.id}')">Advance</button>
            <button class="small-btn" onclick="deleteTask('${task.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;

    operationsBody.insertAdjacentHTML("beforeend", rowHtml);

    dashboardBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${task.id}</td>
        <td>${task.task}</td>
        <td>${task.owner}</td>
        <td>${task.zone}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
      </tr>
    `);
  });
}

function renderNotes() {
  const list = document.getElementById("dashboardNotesList");
  list.innerHTML = "";
  notes.forEach(note => {
    list.insertAdjacentHTML("beforeend", `<div class="note-box">${escapeHtml(note)}</div>`);
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

  filtered.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${item.item}</td>
        <td>${item.desc}</td>
        <td>${item.onHand}</td>
        <td>${item.primary}</td>
        <td>${item.overstock}</td>
        <td>${item.bin}</td>
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

  filtered.forEach(truck => {
    const timerText = getTruckElapsedTime(truck);
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${truck.truckNumber}</td>
        <td>${truck.carrier}</td>
        <td>${truck.dockDoor}</td>
        <td>${truck.containers}</td>
        <td>${truck.osds}</td>
        <td>${formatDateTime(truck.startTime)}</td>
        <td>${timerText}</td>
        <td>${badge(truck.status)}</td>
        <td>
          <div class="action-row">
            ${truck.status === "Active"
              ? `<button class="small-btn" onclick="stopTruckTimer('${truck.id}')">Stop Timer</button>`
              : `<button class="small-btn" onclick="restartTruckTimer('${truck.id}')">Restart</button>`
            }
            <button class="small-btn" onclick="editTruck('${truck.id}')">Edit</button>
            <button class="small-btn" onclick="deleteTruck('${truck.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `);
  });
}

function renderReceivingStats() {
  document.getElementById("receivingTruckTotal").textContent = trucks.length;

  const totalOsds = trucks.reduce((sum, t) => sum + Number(t.osds || 0), 0);
  document.getElementById("receivingOsdTotal").textContent = totalOsds;

  const totalContainers = trucks.reduce((sum, t) => sum + Number(t.containers || 0), 0);
  document.getElementById("receivingContainerTotal").textContent = totalContainers;

  const activeTimers = trucks.filter(t => t.status === "Active").length;
  document.getElementById("receivingActiveTimers").textContent = activeTimers;

  const completed = trucks.filter(t => t.totalElapsedSeconds && t.status !== "Active");
  const avg = completed.length
    ? Math.floor(completed.reduce((sum, t) => sum + t.totalElapsedSeconds, 0) / completed.length)
    : 0;

  document.getElementById("receivingAverageDockTime").textContent = secondsToClock(avg);
}

function renderLabor() {
  const body = document.getElementById("laborTable");
  const search = getSearchValue();
  body.innerHTML = "";

  laborData
    .filter(emp => `${emp.name} ${emp.role} ${emp.department} ${emp.status}`.toLowerCase().includes(search))
    .forEach(emp => {
      body.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${emp.name}</td>
          <td>${emp.role}</td>
          <td>${emp.department}</td>
          <td>${emp.productivity}%</td>
          <td>${emp.errors}</td>
          <td>${badge(emp.status)}</td>
        </tr>
      `);
    });
}

function renderQuality() {
  const body = document.getElementById("qualityTable");
  body.innerHTML = "";

  qualityData.forEach(item => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${item.date}</td>
        <td>${item.type}</td>
        <td>${item.area}</td>
        <td>${badge(item.severity)}</td>
        <td>${item.owner}</td>
      </tr>
    `);
  });
}

function renderCoaching() {
  const list = document.getElementById("coachingList");
  list.innerHTML = "";

  coachingEntries.forEach(entry => {
    list.insertAdjacentHTML("beforeend", `
      <div class="coach-box">
        <strong>${escapeHtml(entry.employee)}</strong> — ${escapeHtml(entry.topic)}
        <div style="margin-top:8px;">${escapeHtml(entry.notes)}</div>
        <div style="margin-top:8px; color:#5b7694; font-size:13px;">${formatDateTime(entry.createdAt)}</div>
      </div>
    `);
  });
}

function toggleInventoryFilters() {
  inventoryFiltersOpen = !inventoryFiltersOpen;
  document.getElementById("inventoryFiltersPanel").classList.toggle("hidden", !inventoryFiltersOpen);
}

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
          <option value="Medium">Medium</option>
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
      task: desc,
      owner,
      zone,
      priority,
      status: type === "issue" ? "Pending" : "Active"
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
          <option value="Medium">Medium</option>
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
    task: taskName,
    owner,
    zone,
    priority,
    status: "Active"
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
  showToast("Task status updated.");
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  showToast("Task deleted.");
}

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

  counts.unshift({
    item,
    bin,
    qty,
    desc,
    createdAt: new Date().toISOString()
  });

  const existing = inventory.find(i => i.item === item && i.bin === bin);

  if (existing) {
    existing.onHand = qty;
    existing.primary = Math.min(existing.primary, qty);
    existing.overstock = Math.max(qty - existing.primary, 0);
    existing.status = qty === 0 ? "Out" : qty <= 5 ? "Low" : "Healthy";
  } else {
    inventory.unshift({
      item,
      desc,
      onHand: qty,
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
        <input id="truckOsdInput" type="number" placeholder="1" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTruck()">Save Truck & Start Timer</button>
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
    id: cryptoRandomId(),
    truckNumber,
    carrier,
    dockDoor,
    containers,
    osds,
    startTime: new Date().toISOString(),
    endTime: null,
    status: "Active",
    totalElapsedSeconds: 0
  });

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  closeModal();
  showToast("Truck added and timer started.");
}

function stopTruckTimer(id) {
  const truck = trucks.find(t => t.id === id);
  if (!truck || truck.status !== "Active") return;

  const now = new Date();
  const elapsed = Math.floor((now - new Date(truck.startTime)) / 1000);
  truck.endTime = now.toISOString();
  truck.totalElapsedSeconds = elapsed;
  truck.status = "Completed";

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
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
  showToast("Truck timer restarted.");
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

function deleteTruck(id) {
  trucks = trucks.filter(t => t.id !== id);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast("Truck deleted.");
}

function getTruckElapsedTime(truck) {
  if (truck.status === "Active") {
    const elapsed = Math.floor((new Date() - new Date(truck.startTime)) / 1000);
    return secondsToClock(elapsed);
  }
  return secondsToClock(truck.totalElapsedSeconds || 0);
}

function saveCoachingEntry() {
  const employee = document.getElementById("coachEmployee").value.trim();
  const topic = document.getElementById("coachTopic").value.trim();
  const notesText = document.getElementById("coachNotes").value.trim();

  if (!employee || !topic || !notesText) return showToast("Fill in all coaching fields.");

  coachingEntries.unshift({
    employee,
    topic,
    notes: notesText,
    createdAt: new Date().toISOString()
  });

  saveStorage(STORAGE_KEYS.coaching, coachingEntries);

  document.getElementById("coachEmployee").value = "";
  document.getElementById("coachTopic").value = "";
  document.getElementById("coachNotes").value = "";

  renderCoaching();
  showToast("Coaching entry saved.");
}

function generateReport(type) {
  let content = "";

  if (type === "supervisor") {
    content += "DAILY SUPERVISOR REPORT\n\n";
    content += "TASKS:\n";
    tasks.forEach(t => {
      content += `${t.id} | ${t.task} | ${t.owner} | ${t.zone} | ${t.priority} | ${t.status}\n`;
    });
    content += "\nNOTES:\n";
    notes.forEach(n => {
      content += `- ${n}\n`;
    });
    content += "\nRECEIVING SUMMARY:\n";
    content += `Trucks: ${trucks.length}\n`;
    content += `OSDs: ${trucks.reduce((s, t) => s + Number(t.osds || 0), 0)}\n`;
    content += `Containers: ${trucks.reduce((s, t) => s + Number(t.containers || 0), 0)}\n`;
  }

  if (type === "receiving") {
    content += "RECEIVING REPORT\n\n";
    trucks.forEach(t => {
      content += `Truck ${t.truckNumber} | Carrier: ${t.carrier} | Door: ${t.dockDoor} | Containers: ${t.containers} | OSDs: ${t.osds} | Status: ${t.status} | Dock Time: ${getTruckElapsedTime(t)}\n`;
    });
  }

  if (type === "inventory") {
    content += "INVENTORY REPORT\n\n";
    getFilteredInventory().forEach(i => {
      content += `${i.item} | ${i.desc} | On Hand: ${i.onHand} | Primary: ${i.primary} | Overstock: ${i.overstock} | Bin: ${i.bin} | ${i.status}\n`;
    });
    content += "\nCOUNT HISTORY:\n";
    counts.forEach(c => {
      content += `${c.item} | ${c.desc} | Qty: ${c.qty} | Bin: ${c.bin} | ${formatDateTime(c.createdAt)}\n`;
    });
  }

  downloadTextFile(`${type}-report.txt`, content);
  showToast("Report downloaded.");
}

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
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function badge(value) {
  const v = String(value).toLowerCase();

  let cls = "gray";
  if (["active", "healthy", "on floor", "done", "completed"].includes(v)) cls = "green";
  if (["queued", "medium", "counting"].includes(v)) cls = "blue";
  if (["pending", "low", "lowpriority"].includes(v)) cls = "yellow";
  if (["high", "out", "downtime"].includes(v)) cls = "red";

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
  const d = new Date(iso);
  return d.toLocaleString();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain" });
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

window.saveNewAction = saveNewAction;
window.saveTask = saveTask;
window.toggleTaskStatus = toggleTaskStatus;
window.deleteTask = deleteTask;
window.saveCount = saveCount;
window.saveTruck = saveTruck;
window.stopTruckTimer = stopTruckTimer;
window.restartTruckTimer = restartTruckTimer;
window.editTruck = editTruck;
window.saveTruckEdit = saveTruckEdit;
window.deleteTruck = deleteTruck;
