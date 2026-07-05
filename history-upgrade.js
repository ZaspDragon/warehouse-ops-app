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
      body.innerHTML = "";

      if (!logs.length) {
        body.insertAdjacentHTML("beforeend", `<tr><td colspan="6">No putaway records found for this account.</td></tr>`);
        return;
      }

      logs.forEach((log) => {
        const lines = Array.isArray(log.lines) ? log.lines : [];
        const encodedKey = log.key ? encodeURIComponent(log.key) : "";
        body.insertAdjacentHTML(
          "beforeend",
          `<tr>
            <td>${escapeHtml(log.workDate || log.date || "")}</td>
            <td>${escapeHtml(log.employeeName || log.worker || "")}</td>
            <td>${Number(log.totalLines || log.lineCount || lines.length || 0)}</td>
            <td>${Number(log.totalQty || sumBy(lines, "quantity") || sumBy(lines, "qty"))}</td>
            <td>${escapeHtml(previewLines(lines, (line) => `${line.itemNumber || line.item || ""} x${line.quantity || line.qty || 0} @ ${line.binLocation || line.location || ""}`))}</td>
            <td>
              ${encodedKey ? `
                <div class="row-actions">
                  <button type="button" onclick="openPutawayDailyRecord('${encodedKey}', 'view')">View</button>
                  <button type="button" onclick="openPutawayDailyRecord('${encodedKey}', 'edit')">Edit</button>
                  <button type="button" class="danger" onclick="openPutawayDailyRecord('${encodedKey}', 'delete')">Delete</button>
                </div>
              ` : ""}
            </td>
          </tr>`
        );
      });
    };
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
