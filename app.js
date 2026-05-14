const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  employees: [],
  putawayLogs: [],
  cycleSessions: [],
  pickingSessions: [],
  activityLogs: []
};

const COLLECTIONS = {
  employees: "employees",
  putaway: "putAwayLogs",
  cycle: "cycleCountSessions",
  picking: "orderPickingSessions",
  activity: "activityLogs"
};

document.addEventListener("DOMContentLoaded", () => {
  setTodayDefaults();
  buildAllTables();
  wireEvents();
  watchAuth();
});

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);

  ["putDate", "cycleDate", "pickDate"].forEach((id) => {
    if ($(id)) $(id).value = today;
  });
}

function wireEvents() {
  $("loginBtn")?.addEventListener("click", login);
  $("resetPasswordBtn")?.addEventListener("click", resetPassword);
  $("logoutBtn")?.addEventListener("click", () => auth.signOut());

  $("receivedTime")?.addEventListener("change", calculateDockToStock);
  $("stockedTime")?.addEventListener("change", calculateDockToStock);

  $("loadPickFileBtn")?.addEventListener("click", loadPickTicketFile);
  $("exportCurrentPickingBtn")?.addEventListener("click", exportCurrentPicking);

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("addEmployeeBtn")?.addEventListener("click", addEmployee);

  $("savePutawayBtn")?.addEventListener("click", savePutaway);
  $("clearPutawayBtn")?.addEventListener("click", () => clearRows("putawayBody"));

  $("saveCycleBtn")?.addEventListener("click", saveCycle);
  $("clearCycleBtn")?.addEventListener("click", () => clearRows("cycleBody"));

  $("savePickingBtn")?.addEventListener("click", savePicking);
  $("clearPickingBtn")?.addEventListener("click", () => clearRows("pickingBody"));

  $("refreshHistoryBtn")?.addEventListener("click", loadHistory);
  $("exportHistoryBtn")?.addEventListener("click", () => exportCsv("history"));

  document.querySelectorAll(".exportBtn").forEach((btn) => {
    btn.addEventListener("click", () => exportCsv(btn.dataset.export));
  });

  document.addEventListener("input", (e) => {
    if (e.target.closest("#putawayBody")) updatePutawayStats();
    if (e.target.closest("#cycleBody")) updateCycleStats();

    if (e.target.closest("#pickingBody")) {
      if (e.target.classList.contains("pick-picked") || e.target.classList.contains("pick-required")) {
        autoStatusForRow(e.target.closest("tr"));
      }

      updatePickingStats();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.closest("#pickingBody")) updatePickingStats();
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.remove("active");
  });

  const panel = $(`${tab}Tab`);
  if (panel) panel.classList.add("active");

  if (tab === "history") loadHistory();
}

function watchAuth() {
  auth.onAuthStateChanged(async (user) => {
    state.user = user;

    $("loginPanel")?.classList.toggle("hidden", !!user);
    $("appPanel")?.classList.toggle("hidden", !user);
    $("logoutBtn")?.classList.toggle("hidden", !user);

    if ($("userBadge")) {
      $("userBadge").textContent = user ? user.email : "Signed out";
    }

    if (user) await loadAllData();
  });
}

async function login() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value;

  if (!email || !password) return setLoginMessage("Enter email and password.");

  try {
    await auth.signInWithEmailAndPassword(email, password);
    setLoginMessage("");
  } catch (err) {
    setLoginMessage(err.message);
  }
}

async function resetPassword() {
  const email = $("emailInput")?.value.trim();

  if (!email) return setLoginMessage("Enter your email first.");

  try {
    await auth.sendPasswordResetEmail(email);
    setLoginMessage("Password reset email sent.");
  } catch (err) {
    setLoginMessage(err.message);
  }
}

function setLoginMessage(msg) {
  if ($("loginMessage")) $("loginMessage").textContent = msg;
}

function setUploadMessage(msg) {
  if ($("uploadMessage")) $("uploadMessage").textContent = msg;
}

async function loadAllData() {
  try {
    await Promise.all([
      loadCollection(COLLECTIONS.employees, "employees"),
      loadCollection(COLLECTIONS.putaway, "putawayLogs"),
      loadCollection(COLLECTIONS.cycle, "cycleSessions"),
      loadCollection(COLLECTIONS.picking, "pickingSessions"),
      loadCollection(COLLECTIONS.activity, "activityLogs")
    ]);

    renderEmployees();
    renderLogs();
    renderHistory();
    populateEmployeeDropdowns();
  } catch (err) {
    console.error("Load data failed:", err);
    toast("Load failed: " + err.message);
  }
}

async function loadCollection(collection, key) {
  const snap = await db
    .collection(collection)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  state[key] = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function loadHistory() {
  try {
    await loadCollection(COLLECTIONS.activity, "activityLogs");
    renderHistory();
    toast("History refreshed.");
  } catch (err) {
    console.error("History load failed:", err);
    toast("History failed: " + err.message);
  }
}

function calculateDockToStock() {
  const received = $("receivedTime")?.value;
  const stocked = $("stockedTime")?.value;

  if (!received || !stocked) {
    if ($("dockToStockMinutes")) $("dockToStockMinutes").value = "";
    if ($("dockToStockStat")) $("dockToStockStat").textContent = "0";
    return 0;
  }

  const start = new Date(received);
  const end = new Date(stocked);

  const minutes = Math.round((end - start) / 60000);
  const cleanMinutes = minutes >= 0 ? minutes : 0;

  if ($("dockToStockMinutes")) $("dockToStockMinutes").value = cleanMinutes;
  if ($("dockToStockStat")) $("dockToStockStat").textContent = cleanMinutes;

  return cleanMinutes;
}

function buildAllTables() {
  buildPutawayRows();
  buildCycleRows();
  buildPickingRows();
}

async function saveActivityLogs(type, sessionDoc, lines) {
  if (!lines.length) return;

  const batch = db.batch();

  lines.forEach((line) => {
    const ref = db.collection(COLLECTIONS.activity).doc();

    batch.set(ref, {
      type,
      employee: sessionDoc.worker || sessionDoc.counter || sessionDoc.picker || "",
      date: sessionDoc.date || "",
      item: line.item || "",
      description: line.description || "",
      qty: Number(line.qty || line.pickedQty || line.countedQty || 0),
      systemQty: Number(line.systemQty || 0),
      countedQty: Number(line.countedQty || 0),
      requiredQty: Number(line.requiredQty || 0),
      pickedQty: Number(line.pickedQty || 0),
      remainingQty: Number(line.remainingQty || 0),
      availableQty: Number(line.availableQty || 0),
      variance: Number(line.variance || 0),
      location: line.location || line.slot || line.fromSlot || "",
      uom: line.uom || "",
      documentNumber: sessionDoc.docNumber || sessionDoc.countId || sessionDoc.orderNumber || "",
      receivedTime: sessionDoc.receivedTime || "",
      stockedTime: sessionDoc.stockedTime || "",
      dockToStockMinutes: Number(sessionDoc.dockToStockMinutes || 0),
      status: line.status || "",
      reason: line.reason || "",
      notes: line.notes || "",
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    });
  });

  await batch.commit();
}

function buildPutawayRows() {
  const body = $("putawayBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${i}</td>
        <td><input class="item-input put-item" placeholder="Item #" /></td>
        <td><input class="qty-input put-qty" type="number" min="0" placeholder="Qty" /></td>
        <td><input class="loc-input put-location" placeholder="Location" /></td>
        <td><input class="desc-input put-notes" placeholder="Notes" /></td>
      </tr>
    `
    );
  }
}

function buildCycleRows() {
  const body = $("cycleBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
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
    `
    );
  }
}

function buildPickingRows(rowCount = 25) {
  const body = $("pickingBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= rowCount; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${i}</td>
        <td><input class="item-input pick-item" placeholder="Item #" /></td>
        <td><input class="desc-input pick-desc" placeholder="Description" /></td>
        <td><input class="loc-input pick-slot" placeholder="From Slot" /></td>
        <td><input class="qty-input pick-required" type="number" min="0" placeholder="Required" /></td>
        <td><input class="qty-input pick-available" type="number" min="0" placeholder="Available" /></td>
        <td><input class="qty-input pick-picked" type="number" min="0" placeholder="Picked" /></td>
        <td class="pick-remaining">0</td>
        <td>
          <select class="pick-status">
            <option>Pending</option>
            <option>Partial</option>
            <option>Picked</option>
            <option>Overpicked</option>
            <option>Short</option>
            <option>Damaged</option>
            <option>Wrong Slot</option>
          </select>
        </td>
        <td><input class="uom-input pick-uom" placeholder="UM" /></td>
        <td><input class="desc-input pick-notes" placeholder="Notes" /></td>
      </tr>
    `
    );
  }
}

/* ---------------------------
   PICK TICKET UPLOAD FIX
---------------------------- */

async function loadPickTicketFile() {
  const fileInput = $("pickFileUpload");
  const file = fileInput?.files?.[0];

  if (!file) {
    setUploadMessage("Choose a pick ticket file first.");
    return toast("Choose a pick ticket file first.");
  }

  try {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel reader failed to load. Refresh the page and try again.");
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false
    });

    const orderNumber = extractOrderNumber(rows);
    if ($("pickOrder") && orderNumber) $("pickOrder").value = orderNumber;

    const parsedLines = parsePickTicketRows(rows, orderNumber);

    if (!parsedLines.length) {
      setUploadMessage("No picking lines found. Make sure the sheet has BIN LOC and ITEM # headers.");
      return toast("No picking lines found.");
    }

    fillPickingTableFromUpload(parsedLines);

    setUploadMessage(`Loaded ${parsedLines.length} picking lines from ${file.name}.`);
    toast(`Loaded ${parsedLines.length} picking lines.`);
  } catch (err) {
    console.error("Pick ticket upload failed:", err);
    setUploadMessage("Upload failed: " + err.message);
    toast("Upload failed: " + err.message);
  }
}

function parsePickTicketRows(rows, orderNumber = "") {
  const headerRowIndex = findPickTicketHeaderRow(rows);

  if (headerRowIndex === -1) {
    return [];
  }

  const headers = rows[headerRowIndex].map(cleanHeader);
  const col = buildColumnMap(headers);

  const parsedLines = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];

    const binLoc = getCell(row, col["BIN LOC"]);
    const item = getCell(row, col["ITEM #"]);
    const requiredQty = toNumber(getCell(row, col["ORDER QTY"]));
    const pickedQtyRaw = getCell(row, col["PICK QTY"]);
    const pickedQty = pickedQtyRaw === "" ? 0 : toNumber(pickedQtyRaw);
    const availableQty = toNumber(getCell(row, col["AVAIL"]));
    const description = getCell(row, col["DESCRIPTION"]);
    const uom = getCell(row, col["UM"]);

    const itemLooksValid =
      item &&
      !cleanHeader(item).includes("ITEM") &&
      /^[A-Z0-9-]+$/i.test(item);

    const binLooksValid =
      binLoc &&
      !cleanHeader(binLoc).includes("BIN") &&
      !cleanHeader(binLoc).includes("LOC");

    if (!itemLooksValid && !binLooksValid && !description) continue;
    if (!itemLooksValid) continue;

    parsedLines.push({
      orderNumber,
      item,
      description,
      fromSlot: binLoc,
      requiredQty,
      availableQty,
      pickedQty,
      remainingQty: requiredQty - pickedQty,
      status: getPickStatus(requiredQty, pickedQty),
      uom,
      notes: ""
    });
  }

  return parsedLines;
}

function findPickTicketHeaderRow(rows) {
  return rows.findIndex((row) => {
    const cleaned = row.map(cleanHeader);
    return cleaned.includes("BIN LOC") && cleaned.includes("ITEM #");
  });
}

function cleanHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function buildColumnMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    if (header) map[header] = index;
  });

  return map;
}

function getCell(row, index) {
  if (index === undefined || index === -1) return "";
  return String(row[index] ?? "").trim();
}

function extractOrderNumber(rows) {
  let orderNumber = "";

  rows.forEach((row) => {
    row.forEach((cell) => {
      const text = String(cell || "").trim();

      if (!text) return;

      const match = text.match(/\*?(S?XFR|XFR|SO|PO)\d+\*?/i);
      if (match) {
        orderNumber = match[0].replace(/\*/g, "").trim().toUpperCase();
      }
    });
  });

  return orderNumber;
}

function fillPickingTableFromUpload(lines) {
  const rowCount = Math.max(25, lines.length);
  buildPickingRows(rowCount);

  const tableRows = [...document.querySelectorAll("#pickingBody tr")];

  lines.forEach((line, index) => {
    const row = tableRows[index];
    if (!row) return;

    setRowValue(row, ".pick-item", line.item);
    setRowValue(row, ".pick-desc", line.description);
    setRowValue(row, ".pick-slot", line.fromSlot);
    setRowValue(row, ".pick-required", line.requiredQty);
    setRowValue(row, ".pick-available", line.availableQty);
    setRowValue(row, ".pick-picked", line.pickedQty);
    setRowValue(row, ".pick-uom", line.uom);
    setRowValue(row, ".pick-notes", line.notes);

    const statusSelect = row.querySelector(".pick-status");
    if (statusSelect) statusSelect.value = line.status;

    autoStatusForRow(row);
  });

  updatePickingStats();
}

function setRowValue(row, selector, value) {
  const el = row.querySelector(selector);
  if (el) el.value = value ?? "";
}

function getPickStatus(requiredQty, pickedQty) {
  const required = Number(requiredQty || 0);
  const picked = Number(pickedQty || 0);

  if (picked === 0) return "Pending";
  if (picked > required) return "Overpicked";
  if (picked === required) return "Picked";
  if (picked > 0 && picked < required) return "Partial";

  return "Pending";
}

function autoStatusForRow(row) {
  if (!row) return;

  const required = rowNumber(row, ".pick-required");
  const picked = rowNumber(row, ".pick-picked");

  const remainingCell = row.querySelector(".pick-remaining");
  if (remainingCell) remainingCell.textContent = required - picked;

  const statusSelect = row.querySelector(".pick-status");
  if (!statusSelect) return;

  const current = statusSelect.value;
  const manualException = ["Short", "Damaged", "Wrong Slot"].includes(current);

  if (!manualException) {
    statusSelect.value = getPickStatus(required, picked);
  }
}

/* ---------------------------
   GENERAL HELPERS / STATS
---------------------------- */

function toNumber(value) {
  const clean = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

function rowValue(row, selector) {
  const el = row.querySelector(selector);
  return el ? String(el.value || "").trim() : "";
}

function rowNumber(row, selector) {
  return Number(rowValue(row, selector) || 0);
}

function updatePutawayStats() {
  const rows = [...document.querySelectorAll("#putawayBody tr")];

  const used = rows.filter(
    (r) =>
      rowValue(r, ".put-item") ||
      rowValue(r, ".put-location") ||
      rowNumber(r, ".put-qty")
  ).length;

  const qty = rows.reduce((sum, r) => sum + rowNumber(r, ".put-qty"), 0);

  if ($("putUsed")) $("putUsed").textContent = used;
  if ($("putQty")) $("putQty").textContent = qty;
}

function updateCycleStats() {
  const rows = [...document.querySelectorAll("#cycleBody tr")];

  let used = 0;
  let done = 0;
  let varianceLines = 0;
  const totals = {};

  rows.forEach((row) => {
    const item = rowValue(row, ".cycle-item");
    const system = rowNumber(row, ".cycle-system");
    const counted = rowNumber(row, ".cycle-counted");
    const variance = counted - system;

    const varianceCell = row.querySelector(".cycle-variance");
    if (varianceCell) varianceCell.textContent = variance;

    if (item || system || counted) used++;
    if (row.querySelector(".cycle-done")?.checked) done++;
    if (variance !== 0 && (item || system || counted)) varianceLines++;

    if (item) {
      totals[item] ||= { system: 0, counted: 0 };
      totals[item].system += system;
      totals[item].counted += counted;
    }
  });

  if ($("cycleRows")) $("cycleRows").textContent = used;
  if ($("cycleDone")) $("cycleDone").textContent = done;
  if ($("cycleVariance")) $("cycleVariance").textContent = varianceLines;

  const body = $("cycleSummaryBody");
  if (!body) return;

  body.innerHTML = "";

  Object.entries(totals).forEach(([item, t]) => {
    const variance = t.counted - t.system;

    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.system}</td>
        <td>${t.counted}</td>
        <td>${variance}</td>
        <td>${variance === 0 ? '<span class="badge ok">Balanced</span>' : '<span class="badge bad">Variance</span>'}</td>
      </tr>
    `
    );
  });
}

function updatePickingStats() {
  const rows = [...document.querySelectorAll("#pickingBody tr")];

  let used = 0;
  let qty = 0;
  let issues = 0;
  const totals = {};

  rows.forEach((row) => {
    const item = rowValue(row, ".pick-item");
    const required = rowNumber(row, ".pick-required");
    const picked = rowNumber(row, ".pick-picked");
    const status = rowValue(row, ".pick-status");
    const remaining = required - picked;

    const remainingCell = row.querySelector(".pick-remaining");
    if (remainingCell) remainingCell.textContent = remaining;

    if (item || required || picked || rowValue(row, ".pick-slot")) used++;
    qty += picked;

    if (["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(status)) issues++;

    if (item) {
      totals[item] ||= { required: 0, picked: 0 };
      totals[item].required += required;
      totals[item].picked += picked;
    }
  });

  if ($("pickRows")) $("pickRows").textContent = used;
  if ($("pickQty")) $("pickQty").textContent = qty;
  if ($("pickIssues")) $("pickIssues").textContent = issues;

  const body = $("pickSummaryBody");
  if (!body) return;

  body.innerHTML = "";

  Object.entries(totals).forEach(([item, t]) => {
    const remaining = t.required - t.picked;

    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.required}</td>
        <td>${t.picked}</td>
        <td>${remaining}</td>
        <td>${remaining <= 0 ? '<span class="badge ok">Complete</span>' : '<span class="badge warn">Needs More</span>'}</td>
      </tr>
    `
    );
  });
}

/* ---------------------------
   EMPLOYEES
---------------------------- */

async function addEmployee() {
  const name = $("employeeName")?.value.trim();
  const role = $("employeeRole")?.value;

  if (!name) return toast("Enter employee name.");

  try {
    const entry = {
      name,
      role,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.employees).add(entry);

    state.employees.unshift({ id: ref.id, ...entry });

    if ($("employeeName")) $("employeeName").value = "";

    renderEmployees();
    populateEmployeeDropdowns();

    toast("Employee added.");
  } catch (err) {
    console.error("Add employee failed:", err);
    toast("Add failed: " + err.message);
  }
}

async function toggleEmployee(id, active) {
  try {
    await db.collection(COLLECTIONS.employees).doc(id).update({ active });

    const emp = state.employees.find((e) => e.id === id);
    if (emp) emp.active = active;

    renderEmployees();
    populateEmployeeDropdowns();

    toast(active ? "Employee activated." : "Employee deactivated.");
  } catch (err) {
    console.error("Toggle employee failed:", err);
    toast("Update failed: " + err.message);
  }
}

window.toggleEmployee = toggleEmployee;

function renderEmployees() {
  const body = $("employeeBody");
  if (!body) return;

  body.innerHTML = "";

  state.employees.forEach((emp) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(emp.name)}</td>
        <td>${escapeHtml(emp.role)}</td>
        <td>${emp.active ? '<span class="badge ok">Active</span>' : '<span class="badge bad">Inactive</span>'}</td>
        <td>
          <button onclick="toggleEmployee('${emp.id}', ${!emp.active})">
            ${emp.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `
    );
  });
}

function populateEmployeeDropdowns() {
  const employees = state.employees.filter((e) => e.active);

  ["putWorker", "cycleWorker", "pickWorker"].forEach((id) => {
    const select = $(id);
    if (!select) return;

    const current = select.value;

    select.innerHTML = '<option value="">Select worker</option>';

    employees.forEach((emp) => {
      select.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</option>`
      );
    });

    select.value = current;
  });
}

/* ---------------------------
   SAVE / COLLECT
---------------------------- */

function collectPutawayLines() {
  return [...document.querySelectorAll("#putawayBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".put-item"),
      qty: rowNumber(row, ".put-qty"),
      location: rowValue(row, ".put-location"),
      notes: rowValue(row, ".put-notes")
    }))
    .filter((x) => x.item || x.qty || x.location || x.notes);
}

async function savePutaway() {
  const lines = collectPutawayLines();

  if (!lines.length) return toast("Enter at least one put away line.");

  try {
    const dockToStockMinutes = calculateDockToStock();

    const doc = {
      worker: $("putWorker")?.value || "",
      date: $("putDate")?.value || "",
      docNumber: $("putDoc")?.value.trim() || "",
      receivedTime: $("receivedTime")?.value || "",
      stockedTime: $("stockedTime")?.value || "",
      dockToStockMinutes,
      lines,
      lineCount: lines.length,
      totalQty: lines.reduce((s, x) => s + Number(x.qty || 0), 0),
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.putaway).add(doc);
    await saveActivityLogs("putaway", doc, lines);

    state.putawayLogs.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    clearRows("putawayBody");

    toast("Put away log saved.");
  } catch (err) {
    console.error("Put away save failed:", err);
    toast("Save failed: " + err.message);
  }
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
      done: row.querySelector(".cycle-done")?.checked || false
    }))
    .filter((x) => x.item || x.location || x.systemQty || x.countedQty);
}

async function saveCycle() {
  updateCycleStats();

  const lines = collectCycleLines();

  if (!lines.length) return toast("Enter at least one cycle count line.");

  try {
    const doc = {
      counter: $("cycleWorker")?.value || "",
      date: $("cycleDate")?.value || "",
      countId: $("cycleId")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      varianceLines: lines.filter((x) => x.variance !== 0).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.cycle).add(doc);
    await saveActivityLogs("cycleCount", doc, lines);

    state.cycleSessions.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    clearRows("cycleBody");

    toast("Cycle count saved.");
  } catch (err) {
    console.error("Cycle count save failed:", err);
    toast("Save failed: " + err.message);
  }
}

function collectPickingLines() {
  updatePickingStats();

  return [...document.querySelectorAll("#pickingBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".pick-item"),
      description: rowValue(row, ".pick-desc"),
      slot: rowValue(row, ".pick-slot"),
      fromSlot: rowValue(row, ".pick-slot"),
      requiredQty: rowNumber(row, ".pick-required"),
      availableQty: rowNumber(row, ".pick-available"),
      pickedQty: rowNumber(row, ".pick-picked"),
      remainingQty: rowNumber(row, ".pick-required") - rowNumber(row, ".pick-picked"),
      status: rowValue(row, ".pick-status"),
      uom: rowValue(row, ".pick-uom"),
      notes: rowValue(row, ".pick-notes")
    }))
    .filter((x) => x.item || x.slot || x.requiredQty || x.pickedQty || x.description);
}

async function savePicking() {
  updatePickingStats();

  const lines = collectPickingLines();

  if (!lines.length) return toast("Enter at least one picking line.");

  try {
    const doc = {
      picker: $("pickWorker")?.value || "",
      date: $("pickDate")?.value || "",
      orderNumber: $("pickOrder")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      totalPicked: lines.reduce((s, x) => s + Number(x.pickedQty || 0), 0),
      issueLines: lines.filter((x) =>
        ["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(x.status)
      ).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.picking).add(doc);
    await saveActivityLogs("orderPicking", doc, lines);

    state.pickingSessions.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    clearRows("pickingBody");

    toast("Picking session saved.");
  } catch (err) {
    console.error("Picking save failed:", err);
    toast("Save failed: " + err.message);
  }
}

/* ---------------------------
   RENDER LOGS
---------------------------- */

function renderLogs() {
  renderPutawayLogs();
  renderCycleLogs();
  renderPickingLogs();
}

function renderPutawayLogs() {
  const body = $("putawayLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.putawayLogs.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.worker || "")}</td>
        <td>${escapeHtml(log.docNumber || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalQty || 0}</td>
        <td>${log.dockToStockMinutes || 0} min</td>
        <td>${escapeHtml(
          (log.lines || [])
            .slice(0, 3)
            .map((x) => `${x.item} x${x.qty} @ ${x.location}`)
            .join(" | ")
        )}</td>
      </tr>
    `
    );
  });
}

function renderCycleLogs() {
  const body = $("cycleLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.cycleSessions.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.counter || "")}</td>
        <td>${escapeHtml(log.countId || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.varianceLines || 0}</td>
      </tr>
    `
    );
  });
}

function renderPickingLogs() {
  const body = $("pickingLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.pickingSessions.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.picker || "")}</td>
        <td>${escapeHtml(log.orderNumber || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalPicked || 0}</td>
        <td>${log.issueLines || 0}</td>
      </tr>
    `
    );
  });
}

function renderHistory() {
  const body = $("historyBody");
  if (!body) return;

  body.innerHTML = "";

  if (!state.activityLogs.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No activity history found yet.</td></tr>`);
    return;
  }

  state.activityLogs.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.type || "")}</td>
        <td>${escapeHtml(log.employee || "")}</td>
        <td>${escapeHtml(log.item || "")}</td>
        <td>${escapeHtml(log.qty ?? "")}</td>
        <td>${escapeHtml(log.location || "")}</td>
        <td>${escapeHtml(log.documentNumber || "")}</td>
        <td>${log.dockToStockMinutes || 0} min</td>
        <td>${escapeHtml(log.status || log.reason || "")}</td>
      </tr>
    `
    );
  });
}

/* ---------------------------
   CLEAR / EXPORT
---------------------------- */

function clearRows(bodyId) {
  if (bodyId === "putawayBody") {
    buildPutawayRows();

    if ($("receivedTime")) $("receivedTime").value = "";
    if ($("stockedTime")) $("stockedTime").value = "";
    if ($("dockToStockMinutes")) $("dockToStockMinutes").value = "";
    if ($("dockToStockStat")) $("dockToStockStat").textContent = "0";
  }

  if (bodyId === "cycleBody") buildCycleRows();

  if (bodyId === "pickingBody") {
    buildPickingRows();

    if ($("pickFileUpload")) $("pickFileUpload").value = "";
    setUploadMessage("");
  }

  updatePutawayStats();
  updateCycleStats();
  updatePickingStats();
}

function exportCurrentPicking() {
  const rows = collectPickingLines();

  if (!rows.length) return toast("No current picking rows to export.");

  const orderNumber = $("pickOrder")?.value.trim() || "pick-ticket";

  const exportRows = rows.map((line) => ({
    transferNumber: orderNumber,
    item: line.item,
    description: line.description,
    fromSlot: line.fromSlot,
    requiredQty: line.requiredQty,
    availableQty: line.availableQty,
    pickedQty: line.pickedQty,
    remainingQty: line.remainingQty,
    uom: line.uom,
    status: line.status,
    notes: line.notes,
    timestamp: new Date().toISOString()
  }));

  downloadCsv(exportRows, `${orderNumber || "picking"}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportCsv(type) {
  let rows = [];

  if (type === "putaway") rows = flattenSessions(state.putawayLogs, "putaway");
  if (type === "cycle") rows = flattenSessions(state.cycleSessions, "cycle");
  if (type === "picking") rows = flattenSessions(state.pickingSessions, "picking");
  if (type === "history") rows = state.activityLogs;

  if (!rows.length) return toast("No data to export.");

  downloadCsv(rows, `${type}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function flattenSessions(sessions, type) {
  const out = [];

  sessions.forEach((session) => {
    (session.lines || []).forEach((line) => {
      out.push({
        type,
        sessionDate: session.date,
        worker: session.worker || session.counter || session.picker,
        doc: session.docNumber || session.countId || session.orderNumber,
        dockToStockMinutes: session.dockToStockMinutes || "",
        receivedTime: session.receivedTime || "",
        stockedTime: session.stockedTime || "",
        ...line
      });
    });
  });

  return out;
}

function downloadCsv(rows, filename) {
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  const csv = [
    headers,
    ...rows.map((r) => headers.map((h) => r[h] ?? ""))
  ]
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
    )
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

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, 2500);
}
