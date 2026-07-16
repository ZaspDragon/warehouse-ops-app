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
    installHistoryControls();
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
    return new Date().toISOString().slice(0, 10);
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
        submittedDate: submittedAt.slice(0, 10),
        submittedTime: base.submittedTime || timeOfDay()
      };
    }

    if (collectionName === "employees") {
      return {
        ...base,
        lastWorkDate: base.lastWorkDate || ""
      };
    }

    return base;
  }

  function installTenantWritePatch() {
    if (!window.db || window.db.__tenantIsolationPatched) return;

    const originalCollection = window.db.collection.bind(window.db);

    window.db.collection = function patchedCollection(collectionName) {
      const collectionRef = originalCollection(collectionName);

      if (!TENANT_COLLECTIONS.has(collectionName)) {
        return collectionRef;
      }

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

    try {
      addSnap(await base.where("ownerEmail", "==", email).limit(500).get());
    } catch (err) {
      console.warn(`Tenant ownerEmail query failed for ${collectionName}:`, err);
    }

    try {
      addSnap(await base.where("createdByEmail", "==", email).limit(500).get());
    } catch (err) {
      console.warn(`Tenant legacy createdByEmail query failed for ${collectionName}:`, err);
    }

    return [...rowsById.values()].sort((a, b) => String(b.createdAt || b.submittedAt || "").localeCompare(String(a.createdAt || a.submittedAt || ""))).slice(0, 200);
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

      const snap = await window.db.collection(collectionName).limit(200).get();
      if (app) {
        app[key] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }
    };

    window.loadAllData = async function tenantLoadAllData() {
      const app = appState();
      if (app?.isDemoMode) return;

      try {
        await Promise.all([
          window.loadCollection(COLLECTION_NAMES.employees, "employees"),
          window.loadCollection(COLLECTION_NAMES.putaway, "putawayLogs"),
          window.loadCollection(COLLECTION_NAMES.activity, "activityLogs")
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
        window.populateEmployeeDropdowns?.();
      } catch (err) {
        console.error("Tenant data load failed:", err);
        window.toast?.("Load failed: " + err.message);
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

      const app = appState();
      if (app?.putawayLogs?.length) {
        const latest = app.putawayLogs[0];
        latest.worker = worker;
        latest.submittedAt = latest.submittedAt || nowIso();
        latest.submittedDate = latest.submittedDate || latest.submittedAt.slice(0, 10);
        latest.submittedTime = latest.submittedTime || timeOfDay();
        latest.workDate = latest.workDate || latest.date || todayDate();
        Object.assign(latest, tenantFields());
      }

      window.renderLogs?.();
      window.renderHistory?.();
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
      const cyclePanel = document.getElementById("cycleHistoryPanel");
      const pickingPanel = document.getElementById("pickingHistoryPanel");
      cyclePanel?.remove();
      pickingPanel?.remove();
      document.querySelectorAll('.history-tab[data-history-tab="cycle"], .history-tab[data-history-tab="picking"]').forEach((el) => el.remove());

      const body = document.getElementById("putawayHistoryBody") || document.getElementById("historyBody");
      const app = appState();
      if (!body || !app) return;

      const logs = typeof window.buildPutawayDailyGroups === "function"
        ? window.buildPutawayDailyGroups(app.putawayLogs || [])
        : [...(app.putawayLogs || [])].sort((a, b) => String(b.submittedAt || b.createdAt || "").localeCompare(String(a.submittedAt || a.createdAt || "")));
      const rows = filteredPutawayRows(logs);
      body.innerHTML = "";

      if (!rows.length) {
        body.insertAdjacentHTML("beforeend", `<tr><td colspan="8">No putaway records found for these filters.</td></tr>`);
        return;
      }

      rows.forEach((row) => {
        body.insertAdjacentHTML(
          "beforeend",
          `<tr>
            <td>${escapeHtml(row.workDate || "")}</td>
            <td>${escapeHtml(row.employeeName || "")}</td>
            <td>${escapeHtml(row.putawayNumber || "")}</td>
            <td>${escapeHtml(row.itemNumber || "")}</td>
            <td>${Number(row.quantity || 0)}</td>
            <td>${escapeHtml(row.status || "")}</td>
            <td>${escapeHtml(row.notes || "")}</td>
            <td>
              ${row.encodedKey ? `
                <div class="row-actions">
                  <button type="button" onclick="openPutawayDailyRecord('${row.encodedKey}', 'view')">View</button>
                  <button type="button" onclick="openPutawayDailyRecord('${row.encodedKey}', 'edit')">Edit</button>
                  <button type="button" class="danger" onclick="openPutawayDailyRecord('${row.encodedKey}', 'delete')">Delete</button>
                </div>
              ` : ""}
            </td>
          </tr>`
        );
      });
    };
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
        workDate: line.workDate || group.workDate || group.date || "",
        employeeName: line.employeeName || group.employeeName || group.worker || "",
        putawayNumber: line.putawayNumber || line.sheetNumber || group.putawayNumber || group.sheetNumber || "",
        itemNumber: line.itemNumber || line.item || "",
        quantity: line.quantity ?? line.qty ?? 0,
        status: line.status || group.status || "",
        notes: line.notes || ""
      }));
    }).filter((row) => {
      const rowDate = row.workDate || "";
      if (filters.start && rowDate < filters.start) return false;
      if (filters.end && rowDate > filters.end) return false;
      if (filters.worker && !String(row.employeeName || "").toLowerCase().includes(filters.worker)) return false;
      if (filters.item && !String(row.itemNumber || "").toLowerCase().includes(filters.item)) return false;
      if (filters.putawayNumber && !String(row.putawayNumber || "").toLowerCase().includes(filters.putawayNumber)) return false;
      if (filters.status && row.status !== filters.status) return false;
      return true;
    });
  }

  function installHistoryControls() {
    document.querySelectorAll(".historyFilterBtn").forEach((button) => {
      button.addEventListener("click", () => window.renderHistory?.());
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
        const groups = typeof window.buildPutawayDailyGroups === "function"
          ? window.buildPutawayDailyGroups(app?.putawayLogs || [])
          : [];
        const rows = filteredPutawayRows(groups);
        if (!rows.length) return window.toast?.("No data to export.");
        downloadRows(rows, `putaway-history-${todayDate()}.csv`);
      });
    });
  }

  function downloadRows(rows, filename) {
    if (typeof window.downloadCsv === "function") {
      window.downloadCsv(rows, filename);
      return;
    }

    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const csv = [
      headers,
      ...rows.map((row) => headers.map((header) => row[header] ?? ""))
    ]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function formatSubmittedTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function sumBy(rows, key) {
    return (rows || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
  }

  function previewLines(lines, formatter) {
    return (lines || []).slice(0, 3).map(formatter).join("; ");
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
