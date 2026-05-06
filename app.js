const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  employees: [],
  putawayLogs: [],
  cycleSessions: [],
  pickingSessions: []
};

const COLLECTIONS = {
  employees: "employees",
  putaway: "putAwayLogs",
  cycle: "cycleCountSessions",
  picking: "orderPickingSessions"
};

document.addEventListener("DOMContentLoaded", () => {
  setTodayDefaults();
  buildAllTables();
  wireEvents();
  watchAuth();
});

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  ["putDate", "cycleDate", "pickDate"].forEach(id => {
    if ($(id)) $(id).value = today;
  });
}

function wireEvents() {
  $("loginBtn").addEventListener("click", login);
  $("resetPasswordBtn").addEventListener("click", resetPassword);
  $("logoutBtn").addEventListener("click", () => auth.signOut());

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("addEmployeeBtn").addEventListener("click", addEmployee);
  $("savePutawayBtn").addEventListener("click", savePutaway);
  $("clearPutawayBtn").addEventListener("click", () => clearRows("putawayBody"));
  $("saveCycleBtn").addEventListener("click", saveCycle);
  $("clearCycleBtn").addEventListener("click", () => clearRows("cycleBody"));
  $("savePickingBtn").addEventListener("click", savePicking);
  $("clearPickingBtn").addEventListener("click", () => clearRows("pickingBody"));

  document.querySelectorAll(".exportBtn").forEach(btn => {
    btn.addEventListener("click", () => exportCsv(btn.dataset.export));
  });

  document.addEventListener("input", (e) => {
    if (e.target.closest("#putawayBody")) updatePutawayStats();
    if (e.target.closest("#cycleBody")) updateCycleStats();
    if (e.target.closest("#pickingBody")) updatePickingStats();
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  $(`${tab}Tab`).classList.add("active");
}

function watchAuth() {
  auth.onAuthStateChanged(async user => {
    state.user = user;
    $("loginPanel").classList.toggle("hidden", !!user);
    $("appPanel").classList.toggle("hidden", !user);
    $("logoutBtn").classList.toggle("hidden", !user);
    $("userBadge").textContent = user ? user.email : "Signed out";

    if (user) await loadAllData();
  });
}

async function login() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  if (!email || !password) return setLoginMessage("Enter email and password.");
  try {
    await auth.signInWithEmailAndPassword(email, password);
    setLoginMessage("");
  } catch (err) {
    setLoginMessage(err.message);
  }
}

async function resetPassword() {
  const email = $("emailInput").value.trim();
  if (!email) return setLoginMessage("Enter your email first.");
  try {
    await auth.sendPasswordResetEmail(email);
    setLoginMessage("Password reset email sent.");
  } catch (err) {
    setLoginMessage(err.message);
  }
}

function setLoginMessage(msg) {
  $("loginMessage").textContent = msg;
}

async function loadAllData() {
  await Promise.all([
    loadCollection(COLLECTIONS.employees, "employees"),
    loadCollection(COLLECTIONS.putaway, "putawayLogs"),
    loadCollection(COLLECTIONS.cycle, "cycleSessions"),
    loadCollection(COLLECTIONS.picking, "pickingSessions")
  ]);
  renderEmployees();
  renderLogs();
  populateEmployeeDropdowns();
}

async function loadCollection(collection, key) {
  const snap = await db.collection(collection).orderBy("createdAt", "desc").limit(200).get();
  state[key] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function buildAllTables() {
  buildPutawayRows();
  buildCycleRows();
  buildPickingRows();
}

function buildPutawayRows() {
  const body = $("putawayBody");
  body.innerHTML = "";
  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i}</td>
        <td><input class="item-input put-item" placeholder="Item #" /></td>
        <td><input class="qty-input put-qty" type="number" min="0" placeholder="Qty" /></td>
        <td><input class="loc-input put-location" placeholder="Location" /></td>
        <td><input class="desc-input put-notes" placeholder="Notes" /></td>
      </tr>
    `);
  }
}

function buildCycleRows() {
  const body = $("cycleBody");
  body.innerHTML = "";
  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i}</td>
        <td><input class="item-input cycle-item" placeholder="Item #" /></td>
        <td><input class="desc-input cycle-desc" placeholder="Description" /></td>
        <td><input class="loc-input cycle-location" placeholder="Location" /></td>
        <td><input class="qty-input cycle-system" type="number" min="0" placeholder="System" /></td>
        <td><input class="qty-input cycle-counted" type="number" min="0" placeholder="Counted" /></td>
        <td class="cycle-variance">0</td>
        <td>
          <select class="cycle-reason">
            <option>Count Verified</option>
            <option>Misplaced Inventory</option>
            <option>Short Pick</option>
            <option>Over Pick</option>
            <option>Receiving Error</option>
            <option>Putaway Error</option>
            <option>Transfer Error</option>
            <option>Damage</option>
            <option>Recount Required</option>
          </select>
        </td>
        <td><input class="cycle-done" type="checkbox" /></td>
      </tr>
    `);
  }
}

function buildPickingRows() {
  const body = $("pickingBody");
  body.innerHTML = "";
  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i}</td>
        <td><input class="item-input pick-item" placeholder="Item #" /></td>
        <td><input class="desc-input pick-desc" placeholder="Description" /></td>
        <td><input class="loc-input pick-slot" placeholder="Slot" /></td>
        <td><input class="qty-input pick-required" type="number" min="0" placeholder="Required" /></td>
        <td><input class="qty-input pick-picked" type="number" min="0" placeholder="Picked" /></td>
        <td class="pick-remaining">0</td>
        <td>
          <select class="pick-status">
            <option>Picked</option>
            <option>Partial</option>
            <option>Short</option>
            <option>Damaged</option>
            <option>Wrong Slot</option>
          </select>
        </td>
        <td><input class="desc-input pick-notes" placeholder="Notes" /></td>
      </tr>
    `);
  }
}

function rowValue(row, selector) {
  const el = row.querySelector(selector);
  return el ? el.value.trim() : "";
}

function rowNumber(row, selector) {
  return Number(rowValue(row, selector) || 0);
}

function updatePutawayStats() {
  const rows = [...document.querySelectorAll("#putawayBody tr")];
  const used = rows.filter(r => rowValue(r, ".put-item") || rowValue(r, ".put-location") || rowNumber(r, ".put-qty")).length;
  const qty = rows.reduce((sum, r) => sum + rowNumber(r, ".put-qty"), 0);
  $("putUsed").textContent = used;
  $("putQty").textContent = qty;
}

function updateCycleStats() {
  const rows = [...document.querySelectorAll("#cycleBody tr")];
  let used = 0, done = 0, varianceLines = 0;
  const totals = {};

  rows.forEach(row => {
    const item = rowValue(row, ".cycle-item");
    const system = rowNumber(row, ".cycle-system");
    const counted = rowNumber(row, ".cycle-counted");
    const variance = counted - system;
    row.querySelector(".cycle-variance").textContent = variance;

    if (item || system || counted) used++;
    if (row.querySelector(".cycle-done").checked) done++;
    if (variance !== 0 && (item || system || counted)) varianceLines++;

    if (item) {
      totals[item] ||= { system: 0, counted: 0 };
      totals[item].system += system;
      totals[item].counted += counted;
    }
  });

  $("cycleRows").textContent = used;
  $("cycleDone").textContent = done;
  $("cycleVariance").textContent = varianceLines;

  const body = $("cycleSummaryBody");
  body.innerHTML = "";
  Object.entries(totals).forEach(([item, t]) => {
    const variance = t.counted - t.system;
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.system}</td>
        <td>${t.counted}</td>
        <td>${variance}</td>
        <td>${variance === 0 ? '<span class="badge ok">Balanced</span>' : '<span class="badge bad">Variance</span>'}</td>
      </tr>
    `);
  });
}

function updatePickingStats() {
  const rows = [...document.querySelectorAll("#pickingBody tr")];
  let used = 0, qty = 0, issues = 0;
  const totals = {};

  rows.forEach(row => {
    const item = rowValue(row, ".pick-item");
    const required = rowNumber(row, ".pick-required");
    const picked = rowNumber(row, ".pick-picked");
    const status = rowValue(row, ".pick-status");
    const remaining = required - picked;
    row.querySelector(".pick-remaining").textContent = remaining;

    if (item || required || picked || rowValue(row, ".pick-slot")) used++;
    qty += picked;
    if (["Short", "Damaged", "Wrong Slot", "Partial"].includes(status)) issues++;

    if (item) {
      totals[item] ||= { required: 0, picked: 0 };
      totals[item].required += required;
      totals[item].picked += picked;
    }
  });

  $("pickRows").textContent = used;
  $("pickQty").textContent = qty;
  $("pickIssues").textContent = issues;

  const body = $("pickSummaryBody");
  body.innerHTML = "";
  Object.entries(totals).forEach(([item, t]) => {
    const remaining = t.required - t.picked;
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.required}</td>
        <td>${t.picked}</td>
        <td>${remaining}</td>
        <td>${remaining <= 0 ? '<span class="badge ok">Complete</span>' : '<span class="badge warn">Needs More</span>'}</td>
      </tr>
    `);
  });
}

async function addEmployee() {
  const name = $("employeeName").value.trim();
  const role = $("employeeRole").value;
  if (!name) return toast("Enter employee name.");

  const entry = {
    name,
    role,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: state.user?.uid || ""
  };

  const ref = await db.collection(COLLECTIONS.employees).add(entry);
  state.employees.unshift({ id: ref.id, ...entry });
  $("employeeName").value = "";
  renderEmployees();
  populateEmployeeDropdowns();
  toast("Employee added.");
}

async function toggleEmployee(id, active) {
  await db.collection(COLLECTIONS.employees).doc(id).update({ active });
  const emp = state.employees.find(e => e.id === id);
  if (emp) emp.active = active;
  renderEmployees();
  populateEmployeeDropdowns();
}

function renderEmployees() {
  const body = $("employeeBody");
  body.innerHTML = "";
  state.employees.forEach(emp => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(emp.name)}</td>
        <td>${escapeHtml(emp.role)}</td>
        <td>${emp.active ? '<span class="badge ok">Active</span>' : '<span class="badge bad">Inactive</span>'}</td>
        <td><button onclick="toggleEmployee('${emp.id}', ${!emp.active})">${emp.active ? "Deactivate" : "Activate"}</button></td>
      </tr>
    `);
  });
}

function populateEmployeeDropdowns() {
  const employees = state.employees.filter(e => e.active);
  ["putWorker", "cycleWorker", "pickWorker"].forEach(id => {
    const select = $(id);
    const current = select.value;
    select.innerHTML = '<option value="">Select worker</option>';
    employees.forEach(emp => select.insertAdjacentHTML("beforeend", `<option>${escapeHtml(emp.name)}</option>`));
    select.value = current;
  });
}

function collectPutawayLines() {
  return [...document.querySelectorAll("#putawayBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".put-item"),
      qty: rowNumber(row, ".put-qty"),
      location: rowValue(row, ".put-location"),
      notes: rowValue(row, ".put-notes")
    }))
    .filter(x => x.item || x.qty || x.location || x.notes);
}

async function savePutaway() {
  const lines = collectPutawayLines();
  if (!lines.length) return toast("Enter at least one put away line.");

  const doc = {
    worker: $("putWorker").value,
    date: $("putDate").value,
    docNumber: $("putDoc").value.trim(),
    lines,
    lineCount: lines.length,
    totalQty: lines.reduce((s, x) => s + Number(x.qty || 0), 0),
    createdAt: new Date().toISOString(),
    createdBy: state.user?.uid || ""
  };

  const ref = await db.collection(COLLECTIONS.putaway).add(doc);
  state.putawayLogs.unshift({ id: ref.id, ...doc });
  renderLogs();
  clearRows("putawayBody");
  toast("Put away log saved.");
}

function collectCycleLines() {
  return [...document.querySelectorAll("#cycleBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".cycle-item"),
      description: rowValue(row, ".cycle-desc"),
      location: rowValue(row, ".cycle-location"),
      systemQty: rowNumber(row, ".cycle-system"),
      countedQty: rowNumber(row, ".cycle-counted"),
      variance: rowNumber(row, ".cycle-counted") - rowNumber(row, ".cycle-system"),
      reason: rowValue(row, ".cycle-reason"),
      done: row.querySelector(".cycle-done").checked
    }))
    .filter(x => x.item || x.location || x.systemQty || x.countedQty);
}

async function saveCycle() {
  updateCycleStats();
  const lines = collectCycleLines();
  if (!lines.length) return toast("Enter at least one cycle count line.");

  const doc = {
    counter: $("cycleWorker").value,
    date: $("cycleDate").value,
    countId: $("cycleId").value.trim(),
    lines,
    lineCount: lines.length,
    varianceLines: lines.filter(x => x.variance !== 0).length,
    createdAt: new Date().toISOString(),
    createdBy: state.user?.uid || ""
  };

  const ref = await db.collection(COLLECTIONS.cycle).add(doc);
  state.cycleSessions.unshift({ id: ref.id, ...doc });
  renderLogs();
  clearRows("cycleBody");
  toast("Cycle count saved.");
}

function collectPickingLines() {
  return [...document.querySelectorAll("#pickingBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".pick-item"),
      description: rowValue(row, ".pick-desc"),
      slot: rowValue(row, ".pick-slot"),
      requiredQty: rowNumber(row, ".pick-required"),
      pickedQty: rowNumber(row, ".pick-picked"),
      remainingQty: rowNumber(row, ".pick-required") - rowNumber(row, ".pick-picked"),
      status: rowValue(row, ".pick-status"),
      notes: rowValue(row, ".pick-notes")
    }))
    .filter(x => x.item || x.slot || x.requiredQty || x.pickedQty);
}

async function savePicking() {
  updatePickingStats();
  const lines = collectPickingLines();
  if (!lines.length) return toast("Enter at least one picking line.");

  const doc = {
    picker: $("pickWorker").value,
    date: $("pickDate").value,
    orderNumber: $("pickOrder").value.trim(),
    lines,
    lineCount: lines.length,
    totalPicked: lines.reduce((s, x) => s + Number(x.pickedQty || 0), 0),
    issueLines: lines.filter(x => ["Short", "Damaged", "Wrong Slot", "Partial"].includes(x.status)).length,
    createdAt: new Date().toISOString(),
    createdBy: state.user?.uid || ""
  };

  const ref = await db.collection(COLLECTIONS.picking).add(doc);
  state.pickingSessions.unshift({ id: ref.id, ...doc });
  renderLogs();
  clearRows("pickingBody");
  toast("Picking session saved.");
}

function renderLogs() {
  renderPutawayLogs();
  renderCycleLogs();
  renderPickingLogs();
}

function renderPutawayLogs() {
  const body = $("putawayLogBody");
  body.innerHTML = "";
  state.putawayLogs.forEach(log => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.worker || "")}</td>
        <td>${escapeHtml(log.docNumber || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalQty || 0}</td>
        <td>${escapeHtml((log.lines || []).slice(0, 3).map(x => `${x.item} x${x.qty} @ ${x.location}`).join(" | "))}</td>
      </tr>
    `);
  });
}

function renderCycleLogs() {
  const body = $("cycleLogBody");
  body.innerHTML = "";
  state.cycleSessions.forEach(log => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.counter || "")}</td>
        <td>${escapeHtml(log.countId || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.varianceLines || 0}</td>
      </tr>
    `);
  });
}

function renderPickingLogs() {
  const body = $("pickingLogBody");
  body.innerHTML = "";
  state.pickingSessions.forEach(log => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.picker || "")}</td>
        <td>${escapeHtml(log.orderNumber || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalPicked || 0}</td>
        <td>${log.issueLines || 0}</td>
      </tr>
    `);
  });
}

function clearRows(bodyId) {
  if (bodyId === "putawayBody") buildPutawayRows();
  if (bodyId === "cycleBody") buildCycleRows();
  if (bodyId === "pickingBody") buildPickingRows();
  updatePutawayStats();
  updateCycleStats();
  updatePickingStats();
}

function exportCsv(type) {
  let rows = [];
  if (type === "putaway") rows = flattenSessions(state.putawayLogs, "putaway");
  if (type === "cycle") rows = flattenSessions(state.cycleSessions, "cycle");
  if (type === "picking") rows = flattenSessions(state.pickingSessions, "picking");
  if (!rows.length) return toast("No data to export.");
  downloadCsv(rows, `${type}-${new Date().toISOString().slice(0,10)}.csv`);
}

function flattenSessions(sessions, type) {
  const out = [];
  sessions.forEach(session => {
    (session.lines || []).forEach(line => {
      out.push({ type, sessionDate: session.date, worker: session.worker || session.counter || session.picker, doc: session.docNumber || session.countId || session.orderNumber, ...line });
    });
  });
  return out;
}

function downloadCsv(rows, filename) {
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const csv = [headers, ...rows.map(r => headers.map(h => r[h] ?? ""))]
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}
