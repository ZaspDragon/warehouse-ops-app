(function () {
  const RETIRED_TABS = ["cycle", "cycleProduction", "picking"];
  const RETIRED_COLLECTIONS = new Set(["cycleCountSessions", "orderPickingSessions"]);
  const TENANT_COLLECTIONS = new Set(["employees", "putAwayLogs", "activityLogs"]);
  const COLLECTION_NAMES = {
    employees: "employees",
    putaway: "putAwayLogs",
    activity: "activityLogs"
  };

  document.addEventListener("DOMContentLoaded", () => {
    installTenantWritePatch();
    installTenantLoadPatch();
    installPutawaySubmitGuard();
    removeRetiredWorkflows();
    patchHistoryToPutawayOnly();
    patchItemHistory();
    installHistoryControls();
    installDailyEmployeeLookupControls();
    installItemHistoryControls();
    renderTenantBadge();
  });

  function appState() {
    return typeof state !== "undefined" ? state : window.state;
  }

  function currentEmail() {
    return String(appState()?.user?.email || window.auth?.currentUser?.email || "").trim().toLowerCase();
  }

  function currentTenantKey() {
    const email = currentEmail();
    if (!email) return "signed-out";
    return email.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown_user";
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayDate() {
    return localDateKey(new Date());
  }

  function localDateKey(value = new Date()) {
    if (!value) return "";
    if (typeof value === "object" && typeof value.toDate === "function") return localDateKey(value.toDate());
    if (typeof value === "object" && Number.isFinite(value.seconds)) return localDateKey(new Date(value.seconds * 1000));
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return "";
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    const text = String(value).trim();
    if (!text) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : localDateKey(parsed);
  }

  function timeOfDay() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function tenantFields(extra = {}) {
    const email = currentEmail();
    return {
      ownerEmail: email,
      tenantKey: currentTenantKey(),
      branchId: currentTenantKey(),
      companyId: "warehouse-ops",
      ...extra
    };
  }

  function addTenantFields(collectionName, doc) {
    const base = { ...(doc || {}), ...tenantFields() };
    if (collectionName === "putAwayLogs") {
      const submittedAt = base.submittedAt || nowIso();
      return {
        ...base,
        worker: String(base.worker || "").trim(),
        putawayNumber: String(base.putawayNumber || base.sheetNumber || "").trim(),
        sheetNumber: String(base.sheetNumber || base.putawayNumber || "").trim(),
        status: base.status || "Completed",
        workDate: base.workDate || base.date || todayDate(),
        submittedAt,
        submittedDate: localDateKey(submittedAt),
        submittedTime: base.submittedTime || timeOfDay()
      };
    }
    if (collectionName === "employees") {
      return { ...base, lastWorkDate: base.lastWorkDate || "" };
    }
    return base;
  }

  function installTenantWritePatch() {
    if (!window.db || window.db.__tenantIsolationPatched) return;
    const originalCollection = window.db.collection.bind(window.db);
    window.db.collection = function patchedCollection(collectionName) {
      const collectionRef = originalCollection(collectionName);
      if (!TENANT_COLLECTIONS.has(collectionName)) return collectionRef;
      return new Proxy(collectionRef, {
        get(target, prop, receiver) {
          if (prop === "add") {
            return function patchedAdd(doc) {
              return target.add(addTenantFields(collectionName, doc));
            };
          }
          if (prop === "doc") {
            return function patchedDoc(id) {
              const docRef = id ? target.doc(id) : target.doc();
              return new Proxy(docRef, {
                get(docTarget, docProp, docReceiver) {
                  if (docProp === "set") {
                    return function patchedSet(doc, options) {
                      return docTarget.set(addTenantFields(collectionName, doc), options);
                    };
                  }
                  const value = Reflect.get(docTarget, docProp, docReceiver);
                  return typeof value === "function" ? value.bind(docTarget) : value;
                }
              });
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };
    window.db.__tenantIsolationPatched = true;
  }

  async function queryTenantRows(collectionName) {
    const email = currentEmail();
    if (!email) return [];
    const rowsById = new Map();
    const addSnap = (snap) => {
      snap.docs.forEach((doc) => rowsById.set(doc.id, { id: doc.id, ...doc.data() }));
    };
    const base = window.db.collection(collectionName);

    async function readOwnerPages(field) {
      // Reading more than the first 1,000 is necessary for historical daily lookups.
      // Paged reads are read-only and keep the original Firestore documents intact.
      const pageSize = collectionName === "putAwayLogs" ? 500 : 1000;
      const maxPages = collectionName === "putAwayLogs" ? 20 : 1;
      let query = base.where(field, "==", email).limit(pageSize);
      for (let page = 0; page < maxPages; page++) {
        const snapshot = await query.get();
        addSnap(snapshot);
        if (snapshot.docs.length < pageSize) return;
        if (page === maxPages - 1) {
          console.warn(`History read capped at ${pageSize * maxPages} documents for ${field}; older records may not be loaded.`);
          return;
        }
        query = base.where(field, "==", email).limit(pageSize).startAfter(snapshot.docs[snapshot.docs.length - 1]);
      }
    }

    for (const field of ["ownerEmail", "createdByEmail"]) {
      try {
        await readOwnerPages(field);
      } catch (err) {
        console.warn(`Tenant ${field} query failed for ${collectionName}:`, err);
      }
    }

    return [...rowsById.values()].sort((a, b) =>
      String(b.createdAt || b.submittedAt || b.workDate || b.date || "")
        .localeCompare(String(a.createdAt || a.submittedAt || a.workDate || a.date || ""))
    );
  }

  async function loadHistoryCollections() {
    await Promise.all([
      window.loadCollection(COLLECTION_NAMES.putaway, "putawayLogs"),
      window.loadCollection(COLLECTION_NAMES.activity, "activityLogs")
    ]);
  }

  function installTenantLoadPatch() {
    if (window.__tenantLoadPatched) return;

    window.loadCollection = async function tenantLoadCollection(collectionName, key) {
      const app = appState();
      if (RETIRED_COLLECTIONS.has(collectionName) || ["cycleSessions", "pickingSessions"].includes(key)) {
        if (app) app[key] = [];
        return;
      }
      if (TENANT_COLLECTIONS.has(collectionName)) {
        if (app) app[key] = await queryTenantRows(collectionName);
        return;
      }
      const snap = await window.db.collection(collectionName).limit(500).get();
      if (app) app[key] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    };

    window.loadAllData = async function tenantLoadAllData() {
      const app = appState();
      if (app?.isDemoMode) return;
      try {
        await Promise.all([
          window.loadCollection(COLLECTION_NAMES.employees, "employees"),
          loadHistoryCollections()
        ]);
        if (app) {
          app.cycleSessions = [];
          app.pickingSessions = [];
          app.cycleProduction = [];
          app.cycleTimers = [];
        }
        window.renderEmployees?.();
        window.renderLogs?.();
        window.renderHistory?.();
        window.renderItemHistory?.();
        window.renderLeaderboard?.();
        window.populateEmployeeDropdowns?.();
      } catch (err) {
        console.error("Tenant data load failed:", err);
        window.toast?.("Load failed: " + err.message);
      }
    };

    window.loadHistory = async function tenantLoadHistory() {
      const app = appState();
      if (app?.isDemoMode) {
        window.renderHistory?.();
        window.renderItemHistory?.();
        return;
      }
      try {
        await loadHistoryCollections();
        window.renderLogs?.();
        window.renderHistory?.();
        window.renderItemHistory?.();
        window.renderLeaderboard?.();
      } catch (err) {
        console.error("History load failed:", err);
        window.toast?.("History failed: " + err.message);
      }
    };

    window.__tenantLoadPatched = true;
  }

  function installPutawaySubmitGuard() {
    const button = document.getElementById("savePutawayBtn");
    const originalSave = window.savePutaway;
    if (!button || typeof originalSave !== "function" || originalSave.__tenantWrapped) return;
    button.removeEventListener("click", originalSave);
    const wrappedSave = async function tenantPutawaySave() {
      const worker = String(document.getElementById("putWorker")?.value || "").trim();
      if (!worker) {
        window.toast?.("Enter the worker name before submitting putaway.");
        document.getElementById("putWorker")?.focus();
        return;
      }
      await originalSave();
    };
    wrappedSave.__tenantWrapped = true;
    window.savePutaway = wrappedSave;
    button.addEventListener("click", wrappedSave);
  }

  function removeRetiredWorkflows() {
    RETIRED_TABS.forEach((tab) => {
      document.querySelector(`.tab[data-tab="${tab}"]`)?.remove();
      document.getElementById(`${tab}Tab`)?.remove();
    });
    document.querySelectorAll('[data-export="cycle"], [data-export="picking"], .productionExportBtn').forEach((el) => el.remove());
    const app = appState();
    if (app) {
      app.cycleSessions = [];
      app.pickingSessions = [];
      app.cycleProduction = [];
      app.cycleTimers = [];
    }
    const subtitle = document.querySelector(".topbar p");
    if (subtitle) subtitle.textContent = "Put Away · Employees · History";
  }

  function patchHistoryToPutawayOnly() {
    window.renderHistory = function putawayOnlyHistory() {
      document.getElementById("cycleHistoryPanel")?.remove();
      document.getElementById("pickingHistoryPanel")?.remove();
      document.querySelectorAll('.history-tab[data-history-tab="cycle"], .history-tab[data-history-tab="picking"]').forEach((el) => el.remove());
      const body = document.getElementById("putawayHistoryBody") || document.getElementById("historyBody");
      const app = appState();
      if (!body || !app) return;
      const logs = typeof window.buildPutawayDailyGroups === "function"
        ? window.buildPutawayDailyGroups(app.putawayLogs || [])
        : [...(app.putawayLogs || [])].sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || "")));
      const rows = filteredPutawayRows(logs);
      refreshDailyEmployeeOptions(logs);
      renderDailyEmployeeLookup(logs);
      body.innerHTML = "";
      if (!rows.length) {
        body.insertAdjacentHTML("beforeend", `<tr><td colspan="8">No putaway records match these filters.</td></tr>`);
        return;
      }
      rows.forEach((row) => {
        body.insertAdjacentHTML("beforeend", `<tr>
          <td>${escapeHtml(row.workDate || "")}</td>
          <td>${escapeHtml(row.employeeName || "")}</td>
          <td>${escapeHtml(row.putawayNumber || "")}</td>
          <td>${escapeHtml(row.itemNumber || "")}</td>
          <td>${Number(row.quantity || 0)}</td>
          <td>${escapeHtml(row.status || "")}</td>
          <td>${escapeHtml(row.notes || "")}</td>
          <td>${row.encodedKey ? `<div class="row-actions">
            <button type="button" onclick="openPutawayDailyRecord('${row.encodedKey}', 'view')">View</button>
            <button type="button" onclick="openPutawayDailyRecord('${row.encodedKey}', 'edit')">Edit</button>
            <button type="button" class="danger" onclick="openPutawayDailyRecord('${row.encodedKey}', 'delete')">Delete</button>
          </div>` : ""}</td>
        </tr>`);
      });
    };
  }

  // Daily production is built from saved putaway history, not the Employees roster.
  // Historical dates and item quantities are read only; this feature never writes records.
  function dailyEmployeeRows(groups = []) {
    const term = String(document.getElementById("dailyPutawayEmployee")?.value || "").trim().toLocaleLowerCase();
    if (!term) return [];
    const byDay = new Map();
    groups.forEach(group => {
      (group.lines || []).forEach(line => {
        if (line.active === false) return;
        const employee = String(line.employeeName || line.worker || group.employeeName || group.worker || "").trim();
        if (!employee.toLocaleLowerCase().includes(term)) return;
        const date = localDateKey(line.workDate || line.submittedDate || line.submittedAt || group.workDate || group.date || group.createdAt);
        if (!date) return;
        const key = date + "|" + employee.toLocaleLowerCase();
        const entry = byDay.get(key) || { date, employee, lines: 0, quantity: 0, items: new Map() };
        const item = String(line.itemNumber || line.item || "").trim() || "Unknown";
        const qty = Number(line.quantity ?? line.qty ?? 0);
        const safeQty = Number.isFinite(qty) ? qty : 0;
        entry.lines++;
        entry.quantity += safeQty;
        entry.items.set(item, (entry.items.get(item) || 0) + safeQty);
        byDay.set(key, entry);
      });
    });
    return [...byDay.values()].sort((a,b) => b.date.localeCompare(a.date) || a.employee.localeCompare(b.employee));
  }
  function refreshDailyEmployeeOptions(groups = []) {
    const options = document.getElementById("dailyPutawayEmployeeOptions");
    if (!options) return;
    const names = new Set();
    groups.forEach(group => (group.lines || []).forEach(line => {
      if (line.active === false) return;
      const name = String(line.employeeName || line.worker || group.employeeName || group.worker || "").trim();
      if (name) names.add(name);
    }));
    options.innerHTML = [...names].sort((a,b) => a.localeCompare(b))
      .map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
  }
  function renderDailyEmployeeLookup(groups = []) {
    const body = document.getElementById("dailyPutawayBody");
    const summary = document.getElementById("dailyPutawaySummary");
    if (!body || !summary) return;
    const term = String(document.getElementById("dailyPutawayEmployee")?.value || "").trim();
    if (!term) {
      summary.textContent = "Enter an employee name to see their putaways by date.";
      body.innerHTML = '<tr><td colspan="5">Search for an employee.</td></tr>';
      return;
    }
    const results = dailyEmployeeRows(groups);
    const lines = results.reduce((sum,row) => sum + row.lines,0);
    const qty = results.reduce((sum,row) => sum + row.quantity,0);
    summary.textContent = results.length
      ? `${results.length} employee/date group(s) · ${lines} putaway line(s) · ${qty.toLocaleString()} total units`
      : "No saved putaways found for that employee in the currently loaded history.";
    body.innerHTML = results.length
      ? results.map(row => `<tr>
          <td data-label="Date">${escapeHtml(row.date)}</td>
          <td data-label="Employee">${escapeHtml(row.employee)}</td>
          <td data-label="Putaway Lines">${row.lines}</td>
          <td data-label="Total Qty">${row.quantity.toLocaleString()}</td>
          <td data-label="Item Numbers">${escapeHtml([...row.items.entries()].map(([item, qty]) => item + " (" + qty + ")").join(", "))}</td>
        </tr>`).join("")
      : '<tr><td colspan="5">No matching saved putaways.</td></tr>';
  }
  function currentPutawayGroups() {
    const app = appState();
    return typeof window.buildPutawayDailyGroups === "function"
      ? window.buildPutawayDailyGroups(app?.putawayLogs || [])
      : [];
  }
  function installDailyEmployeeLookupControls() {
    const input = document.getElementById("dailyPutawayEmployee");
    const search = document.getElementById("dailyPutawaySearchBtn");
    const exportButton = document.getElementById("dailyPutawayExportBtn");
    if (!input || !search || !exportButton) return;
    search.addEventListener("click", async () => {
      search.disabled = true;
      try {
        await window.loadHistory?.();
        renderDailyEmployeeLookup(currentPutawayGroups());
      } finally {
        search.disabled = false;
      }
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); search.click(); }
    });
    exportButton.addEventListener("click", () => {
      const results = dailyEmployeeRows(currentPutawayGroups());
      if (!results.length) return window.toast?.("No employee daily records to export.");
      downloadRows(results.map(row => ({
        date: row.date, employee: row.employee, putawayLines: row.lines,
        totalQuantity: row.quantity,
        items: [...row.items.entries()].map(([item,qty]) => item + " (" + qty + ")").join("; ")
      })), "employee-putaways-by-day-" + todayDate() + ".csv");
    });
  }

  function itemHistoryRows() {
    const app = appState();
    const activityRows = (app?.activityLogs || []).map((log) => ({
      date: localDateKey(log.date || log.workDate || log.submittedDate || log.createdAt),
      process: processLabel(log.type || log.process),
      worker: log.employee || log.employeeName || log.worker || "",
      item: log.item || log.itemNumber || "",
      description: log.description || "",
      qty: log.qty ?? log.quantity ?? "",
      location: log.location || log.binLocation || "",
      status: log.status || log.reason || "",
      notes: log.notes || "",
      createdAt: log.createdAt || log.submittedAt || ""
    }));
    const putawayRows = [];
    (app?.putawayLogs || []).forEach((session) => {
      (session.lines || []).forEach((line) => {
        putawayRows.push({
          date: localDateKey(line.workDate || line.submittedDate || session.workDate || session.date || session.submittedDate || line.submittedAt || session.createdAt),
          process: "Put Away",
          worker: line.employeeName || session.employeeName || session.worker || "",
          item: line.item || line.itemNumber || "",
          description: line.description || "",
          qty: line.qty ?? line.quantity ?? "",
          location: line.location || line.binLocation || "",
          status: line.status || session.status || "",
          notes: line.notes || "",
          createdAt: line.submittedAt || session.submittedAt || session.createdAt || ""
        });
      });
    });
    const seen = new Set();
    return [...activityRows, ...putawayRows].filter((row) => {
      const key = [row.date, row.process, row.worker, row.item, row.qty, row.location, row.createdAt].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  }

  function renderItemHistoryPutawaySummary(rows, filters) {
    const count = document.getElementById("itemHistoryPutawayCount");
    const qtyBox = document.getElementById("itemHistoryPutawayQty");
    const daysBox = document.getElementById("itemHistoryPutawayDays");
    const scope = document.getElementById("itemHistorySummaryScope");
    const daily = document.getElementById("itemHistoryPutawayDaily");
    if (!count || !qtyBox || !daysBox || !scope || !daily) return;

    // Use the exact deduplicated, filtered rows rendered in Item History.
    // Count each Put Away item row as one line, not one unit, and never write history.
    const putaways = (rows || []).filter(row =>
      normalizeProcessValue(row.process) === "putaway");
    const byDay = new Map();
    let totalQty = 0;
    putaways.forEach(row => {
      const date = localDateKey(row.date || row.createdAt) || "Date unavailable";
      const quantity = Number(row.qty);
      const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
      totalQty += safeQuantity;
      const previous = byDay.get(date) || {lines:0,quantity:0};
      previous.lines++;
      previous.quantity += safeQuantity;
      byDay.set(date,previous);
    });
    const days = [...byDay.entries()].sort(([a],[b]) => b.localeCompare(a));
    count.textContent = putaways.length.toLocaleString();
    qtyBox.textContent = totalQty.toLocaleString();
    daysBox.textContent = days.filter(([date]) => date !== "Date unavailable").length.toLocaleString();
    const workerLabel = document.getElementById("itemHistoryWorker")?.value.trim() || "All workers";
    const start = filters.start || "Earliest";
    const end = filters.end || "Latest";
    scope.textContent = `${workerLabel} · ${start === end ? start : start + " through " + end}` +
      (filters.item ? " · Item filter applied" : "") +
      ". Counts reflect the filtered Item History table.";
    daily.textContent = days.length
      ? "By day: " + days.map(([date,values]) =>
        date + " — " + values.lines + " line(s), " + values.quantity.toLocaleString() + " units").join(" | ")
      : "No Put Away rows match these filters.";
  }

  function patchItemHistory() {
    window.renderItemHistory = function safeRenderItemHistory() {
      const body = document.getElementById("itemHistoryBody");
      const app = appState();
      if (!body || !app) return;
      const item = String(document.getElementById("itemHistorySearch")?.value || "").trim().toLowerCase();
      const worker = String(document.getElementById("itemHistoryWorker")?.value || "").trim().toLowerCase();
      const process = String(document.getElementById("itemHistoryProcess")?.value || "");
      const start = document.getElementById("itemHistoryStart")?.value || "";
      const end = document.getElementById("itemHistoryEnd")?.value || "";
      app.itemHistoryRows = itemHistoryRows().filter((row) => {
        const date = localDateKey(row.date || row.createdAt);
        if (item && !String(row.item || "").toLowerCase().includes(item)) return false;
        if (worker && !String(row.worker || "").toLowerCase().includes(worker)) return false;
        if (process && normalizeProcessValue(row.process) !== normalizeProcessValue(process)) return false;
        if (start && (!date || date < start)) return false;
        if (end && (!date || date > end)) return false;
        return true;
      });
      renderItemHistoryPutawaySummary(app.itemHistoryRows, {worker, start, end, item});
      body.innerHTML = "";
      if (!app.itemHistoryRows.length) {
        body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No item activity found.</td></tr>`);
        return;
      }
      app.itemHistoryRows.forEach((row) => {
        body.insertAdjacentHTML("beforeend", `<tr>
          <td>${escapeHtml(localDateKey(row.date || row.createdAt))}</td>
          <td>${escapeHtml(row.process || "")}</td>
          <td>${escapeHtml(row.worker || "")}</td>
          <td>${escapeHtml(row.item || "")}</td>
          <td>${escapeHtml(row.description || "")}</td>
          <td>${escapeHtml(row.qty ?? "")}</td>
          <td>${escapeHtml(row.location || "")}</td>
          <td>${escapeHtml(row.status || "")}</td>
          <td>${escapeHtml(row.notes || "")}</td>
        </tr>`);
      });
    };
  }

  function processLabel(type) {
    const normalized = normalizeProcessValue(type);
    if (normalized === "putaway") return "Put Away";
    if (normalized === "cyclecount" || normalized === "cycle") return "Cycle Count";
    if (normalized === "orderpicking" || normalized === "picking") return "Order Picking";
    if (normalized === "receiving") return "Receiving";
    return type || "";
  }

  function normalizeProcessValue(value) {
    return String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
  }

  function readHistoryFilters() {
    return {
      start: document.getElementById("putawayHistoryStart")?.value || "",
      end: document.getElementById("putawayHistoryEnd")?.value || "",
      worker: String(document.getElementById("putawayHistoryWorker")?.value || "").trim().toLowerCase(),
      item: String(document.getElementById("putawayHistoryItem")?.value || "").trim().toLowerCase(),
      putawayNumber: String(document.getElementById("putawayHistoryNumber")?.value || "").trim().toLowerCase(),
      status: document.getElementById("putawayHistoryStatus")?.value || ""
    };
  }

  function filteredPutawayRows(groups = []) {
    const filters = readHistoryFilters();
    return groups.flatMap((group) => {
      const encodedKey = group.key ? encodeURIComponent(group.key) : "";
      return (group.lines || []).map((line) => ({
        encodedKey,
        workDate: localDateKey(line.workDate || line.submittedDate || group.workDate || group.date || group.completedDate || line.submittedAt || group.createdAt),
        employeeName: line.employeeName || group.employeeName || group.worker || "",
        putawayNumber: line.putawayNumber || line.sheetNumber || group.putawayNumber || group.sheetNumber || "",
        itemNumber: line.itemNumber || line.item || "",
        quantity: line.quantity ?? line.qty ?? 0,
        status: line.status || group.status || "",
        notes: line.notes || ""
      }));
    }).filter((row) => {
      const rowDate = localDateKey(row.workDate);
      if (filters.start && (!rowDate || rowDate < filters.start)) return false;
      if (filters.end && (!rowDate || rowDate > filters.end)) return false;
      if (filters.worker && !String(row.employeeName || "").toLowerCase().includes(filters.worker)) return false;
      if (filters.item && !String(row.itemNumber || "").toLowerCase().includes(filters.item)) return false;
      if (filters.putawayNumber && !String(row.putawayNumber || "").toLowerCase().includes(filters.putawayNumber)) return false;
      if (filters.status && row.status !== filters.status) return false;
      return true;
    });
  }

  function installHistoryControls() {
    document.querySelectorAll(".historyFilterBtn").forEach((button) => {
      button.addEventListener("click", async () => {
        await window.loadHistory?.();
        window.renderHistory?.();
      });
    });
    document.querySelectorAll(".historyClearBtn").forEach((button) => {
      button.addEventListener("click", () => {
        ["Start", "End", "Worker", "Item", "Number", "Status"].forEach((suffix) => {
          const input = document.getElementById(`putawayHistory${suffix}`);
          if (input) input.value = "";
        });
        window.renderHistory?.();
      });
    });
    document.querySelectorAll(".historyExportBtn").forEach((button) => {
      button.addEventListener("click", () => {
        const app = appState();
        const groups = typeof window.buildPutawayDailyGroups === "function" ? window.buildPutawayDailyGroups(app?.putawayLogs || []) : [];
        const rows = filteredPutawayRows(groups);
        if (!rows.length) return window.toast?.("No data to export.");
        downloadRows(rows.map(({ encodedKey, ...row }) => row), `putaway-history-${todayDate()}.csv`);
      });
    });
  }

  function installItemHistoryControls() {
    const searchButton = document.getElementById("searchItemHistoryBtn");
    if (!searchButton) return;
    if (typeof window.renderItemHistory === "function") {
      searchButton.removeEventListener("click", window.renderItemHistory);
    }
    searchButton.addEventListener("click", async () => {
      searchButton.disabled = true;
      try {
        if (!appState()?.isDemoMode) await loadHistoryCollections();
        window.renderItemHistory?.();
      } catch (err) {
        console.error("Item history search failed:", err);
        window.toast?.("Item history search failed: " + err.message);
      } finally {
        searchButton.disabled = false;
      }
    });
    ["itemHistorySearch", "itemHistoryWorker", "itemHistoryStart", "itemHistoryEnd"].forEach((id) => {
      document.getElementById(id)?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") searchButton.click();
      });
    });
  }

  function downloadRows(rows, filename) {
    if (typeof window.downloadCsv === "function") {
      window.downloadCsv(rows, filename);
      return;
    }
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const csv = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[char]));
  }

  function renderTenantBadge() {
    const badge = document.getElementById("userBadge");
    if (!badge || !currentEmail()) return;
    badge.textContent = `${currentEmail()} · ${currentTenantKey()}`;
  }
})();
