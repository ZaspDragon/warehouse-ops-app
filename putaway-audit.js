(function () {
  "use strict";

  const STORAGE_KEY = "warehouseOps_putawayAudit_active_v1";
  const DEMO_RESULTS_KEY = "warehouseOps_putawayAudit_demoResults_v1";
  const BATCH_SIZE = 25;
  const MAX_HISTORY_ROWS = 5000;

  const auditState = {
    allDocs: [],
    locations: [],
    auditResults: [],
    active: null,
    historySessionId: "",
    loading: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function safe(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value == null ? "" : String(value));
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function notify(message) {
    if (typeof toast === "function") toast(message);
    else console.log(message);
  }

  function isDemo() {
    try {
      return typeof state !== "undefined" && !!state.isDemoMode;
    } catch (err) {
      return false;
    }
  }

  function currentAuditor() {
    const field = byId("putawayAuditAuditor");
    if (field && field.value.trim()) return field.value.trim();
    try {
      if (typeof state !== "undefined") {
        return state.settings?.operatorName || state.user?.email || "";
      }
    } catch (err) {}
    return window.auth?.currentUser?.email || "";
  }

  function currentUid() {
    return window.auth?.currentUser?.uid || "";
  }

  function dateKey(value) {
    if (!value) return "";
    if (typeof value === "object" && typeof value.toDate === "function") value = value.toDate();
    if (typeof value === "object" && Number.isFinite(value.seconds)) value = new Date(value.seconds * 1000);
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function normalizeLocation(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function naturalLocationCompare(a, b) {
    return String(a.location || a).localeCompare(String(b.location || b), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function extractLocationRows(docs, selectedDate = "") {
    const map = new Map();

    docs.forEach((doc) => {
      const data = doc.data ? doc.data() : doc;
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const sessionDate = data.workDate || data.date || data.completedDate || dateKey(data.createdAt);
      if (selectedDate && String(sessionDate || "").slice(0, 10) !== selectedDate) return;
      const worker = data.employeeName || data.worker || data.counter || "";
      const submittedAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : String(data.createdAt || "");
      const putawayNumber = data.putawayNumber || data.sheetNumber || data.documentNumber || "";

      lines.forEach((line) => {
        const location = String(line.location || line.binLocation || line.slot || line.toSlot || "").trim();
        if (!location) return;

        const key = normalizeLocation(location);
        const existing = map.get(key);
        const candidate = {
          key,
          location,
          latestItem: line.item || line.itemNumber || line.sku || "",
          latestQty: line.qty ?? line.quantity ?? "",
          latestWorker: worker,
          latestDate: sessionDate || "",
          latestSubmittedAt: submittedAt || "",
          putawayNumber,
          timesSeen: (existing?.timesSeen || 0) + 1
        };

        if (!existing) {
          map.set(key, candidate);
          return;
        }

        const existingStamp = String(existing.latestSubmittedAt || existing.latestDate || "");
        const candidateStamp = String(candidate.latestSubmittedAt || candidate.latestDate || "");
        existing.timesSeen = candidate.timesSeen;
        if (candidateStamp >= existingStamp) {
          candidate.timesSeen = existing.timesSeen;
          map.set(key, candidate);
        }
      });
    });

    return [...map.values()].sort(naturalLocationCompare);
  }

  async function fetchAllPutawayDocs() {
    if (isDemo()) {
      try {
        return (state.putawayLogs || []).map((row) => ({ data: () => row }));
      } catch (err) {
        return [];
      }
    }

    if (!window.db) return [];

    const rows = [];
    let lastDoc = null;
    const pageSize = 500;

    while (rows.length < MAX_HISTORY_ROWS) {
      let query = db.collection("putAwayLogs").orderBy("createdAt", "desc").limit(pageSize);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snap = await query.get();
      if (snap.empty) break;
      rows.push(...snap.docs);
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < pageSize) break;
    }

    return rows;
  }

  async function fetchAuditResults() {
    if (isDemo()) {
      try {
        const parsed = JSON.parse(localStorage.getItem(DEMO_RESULTS_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }

    if (!window.db) return [];
    const snap = await db.collection("activityLogs").where("type", "==", "putawayAudit").limit(5000).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  function latestAuditByLocation() {
    const map = new Map();
    auditState.auditResults.forEach((row) => {
      const key = normalizeLocation(row.location);
      if (!key) return;
      const existing = map.get(key);
      const stamp = String(row.createdAt || row.date || "");
      const existingStamp = String(existing?.createdAt || existing?.date || "");
      if (!existing || stamp >= existingStamp) map.set(key, row);
    });
    return map;
  }

  function readActive() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && Array.isArray(parsed.lines) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function saveActive() {
    if (!auditState.active) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auditState.active));
  }

  function injectUi() {
    const tabs = document.querySelector("#appPanel .tabs");
    if (!tabs || byId("putawayAuditTab")) return;

    const button = document.createElement("button");
    button.className = "tab";
    button.type = "button";
    button.dataset.tab = "putawayAudit";
    button.id = "putawayAuditNavBtn";
    button.textContent = "Putaway Audit";
    const historyButton = tabs.querySelector('[data-tab="history"]');
    tabs.insertBefore(button, historyButton || null);

    const panel = document.createElement("section");
    panel.id = "putawayAuditTab";
    panel.className = "tab-panel";
    panel.innerHTML =
      '<div class="card">' +
        '<div class="section-heading"><div><h2>Putaway Audit</h2><p class="hint">Audit locations that have appeared in Put Away history. Each active audit loads 25 locations at a time.</p></div>' +
        '<button id="refreshPutawayAuditBtn" type="button">Refresh Locations</button></div>' +
        '<div class="grid">' +
          '<label>Auditor<input id="putawayAuditAuditor" list="workerOptions" placeholder="Auditor name" /></label>' +
          '<label>Putaway History Date<select id="putawayAuditDate"><option value="">Load history to choose a date</option></select></label>' +
          '<label>Aisle<select id="putawayAuditAisle"><option value="">All aisles</option></select></label>' +
          '<label>Find Location<input id="putawayAuditSearch" placeholder="A-01-1" /></label>' +
        '</div>' +
        '<div class="stats">' +
          '<div><strong id="putawayAuditLocationCount">0</strong><span>History Locations</span></div>' +
          '<div><strong id="putawayAuditCompletedCount">0</strong><span>Audited</span></div>' +
          '<div><strong id="putawayAuditRemainingCount">0</strong><span>Not Yet Audited</span></div>' +
          '<div><strong>25</strong><span>Per Audit</span></div>' +
        '</div>' +
        '<div class="actions">' +
          '<button id="startPutawayAuditBtn" class="primary" type="button">Start 25 Location Audit</button>' +
          '<button id="printPutawayAuditBtn" type="button">Print Audit Sheet</button>' +
          '<button id="savePutawayAuditProgressBtn" type="button">Save Progress</button>' +
          '<button id="completePutawayAuditBtn" type="button">Complete Audit</button>' +
          '<button id="cancelPutawayAuditBtn" class="danger" type="button">Cancel Batch</button>' +
        '</div>' +
        '<p id="putawayAuditMessage" class="message">No active audit.</p>' +
      '</div>' +
      '<div class="card" id="putawayAuditActiveCard">' +
        '<div class="section-heading"><div><h3>Active 25-Location Audit</h3><p class="hint" id="putawayAuditProgress">0 / 25 checked</p></div></div>' +
        '<div class="table-wrap"><table><thead><tr>' +
          '<th>#</th><th>Location</th><th>Last Item</th><th>Putaway Qty</th><th>Correct Qty</th><th>Last Putaway By</th><th>Last Putaway Date</th><th>Result</th><th>Notes</th>' +
        '</tr></thead><tbody id="putawayAuditActiveBody"></tbody></table></div>' +
        '<div class="actions putaway-audit-submit-row">' +
          '<button id="savePutawayAuditBottomBtn" type="button">Save All Lines</button>' +
          '<button id="submitPutawayAuditBtn" class="primary putaway-audit-submit-btn" type="button">Submit Audit</button>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="section-heading"><div><h3>All Putaway Audit History</h3><p class="hint">Every submitted putaway audit is saved here for later review.</p></div>' +
        '<div class="actions"><button id="clearPutawayAuditHistoryFiltersBtn" type="button">Clear Filters</button><button id="refreshPutawayAuditHistoryBtn" type="button">Refresh Audit History</button></div></div>' +
        '<div class="stats">' +
          '<div><strong id="putawayAuditHistoryCount">0</strong><span>Submitted Audits</span></div>' +
        '</div>' +
        '<div class="grid">' +
          '<label>Audit Date<input id="putawayAuditHistoryDate" type="date" /></label>' +
          '<label>Auditor<input id="putawayAuditHistoryAuditor" placeholder="Auditor name" /></label>' +
          '<label>Aisle<select id="putawayAuditHistoryAisle"><option value="">All aisles</option></select></label>' +
        '</div>' +
        '<div class="table-wrap"><table class="putaway-audit-history-table"><thead><tr>' +
          '<th>Completed</th><th>Putaway Date</th><th>Aisle</th><th>Auditor</th><th>Locations</th><th>Good</th><th>Issues</th><th>Action</th>' +
        '</tr></thead><tbody id="putawayAuditHistoryBody"></tbody></table></div>' +
        '<div id="putawayAuditHistoryDetail" class="putaway-audit-history-detail hidden"></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="section-heading"><div><h3>All Putaway History Locations</h3><p class="hint">One row per unique bin/location found in saved putaway history.</p></div></div>' +
        '<div class="table-wrap"><table><thead><tr>' +
          '<th>Location</th><th>Times Seen</th><th>Latest Item</th><th>Latest Worker</th><th>Latest Date</th><th>Last Audit</th><th>Audit Result</th>' +
        '</tr></thead><tbody id="putawayAuditLocationsBody"></tbody></table></div>' +
      '</div>';

    const settingsPanel = byId("settingsTab");
    const parent = settingsPanel?.parentNode || byId("appPanel");
    if (settingsPanel && parent) parent.insertBefore(panel, settingsPanel);
    else parent?.appendChild(panel);

    button.addEventListener("click", () => {
      if (typeof switchTab === "function") switchTab("putawayAudit");
      else {
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        panel.classList.add("active");
      }
      loadAuditData();
    });

    byId("refreshPutawayAuditBtn")?.addEventListener("click", loadAuditData);
    byId("refreshPutawayAuditHistoryBtn")?.addEventListener("click", loadAuditData);
    byId("clearPutawayAuditHistoryFiltersBtn")?.addEventListener("click", () => {
      if (byId("putawayAuditHistoryDate")) byId("putawayAuditHistoryDate").value = "";
      if (byId("putawayAuditHistoryAuditor")) byId("putawayAuditHistoryAuditor").value = "";
      if (byId("putawayAuditHistoryAisle")) byId("putawayAuditHistoryAisle").value = "";
      renderAuditHistory();
    });
    byId("startPutawayAuditBtn")?.addEventListener("click", startAudit);
    byId("printPutawayAuditBtn")?.addEventListener("click", printAuditSheet);
    byId("putawayAuditDate")?.addEventListener("change", () => {
      applyAuditDateFilter();
      populateAuditAisles();
    });
    byId("putawayAuditAisle")?.addEventListener("change", applyAuditAisleFilter);
    const saveAuditProgress = () => {
      captureActiveInputs();
      saveActive();
      renderActiveAudit();
      setMessage("All audit lines saved on this device.");
    };
    byId("savePutawayAuditProgressBtn")?.addEventListener("click", saveAuditProgress);
    byId("savePutawayAuditBottomBtn")?.addEventListener("click", saveAuditProgress);
    byId("completePutawayAuditBtn")?.addEventListener("click", completeAudit);
    byId("submitPutawayAuditBtn")?.addEventListener("click", completeAudit);
    byId("cancelPutawayAuditBtn")?.addEventListener("click", cancelAudit);
    byId("putawayAuditSearch")?.addEventListener("input", renderLocationHistory);
    byId("putawayAuditHistoryDate")?.addEventListener("change", renderAuditHistory);
    byId("putawayAuditHistoryAuditor")?.addEventListener("input", renderAuditHistory);
    byId("putawayAuditHistoryAisle")?.addEventListener("change", renderAuditHistory);
    byId("putawayAuditHistoryBody")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-audit-session]");
      if (btn) showAuditHistoryDetail(btn.dataset.auditSession);
    });

    byId("putawayAuditActiveBody")?.addEventListener("change", (event) => {
      if (event.target.matches(".putaway-audit-result")) {
        captureActiveInputs();
        saveActive();
        renderProgress();
      }
    });
    byId("putawayAuditActiveBody")?.addEventListener("input", (event) => {
      if (event.target.matches(".putaway-audit-note, .putaway-audit-correct-qty")) {
        captureActiveInputs();
        saveActive();
      }
    });

    try {
      byId("putawayAuditAuditor").value =
        state.settings?.operatorName || state.user?.email || window.auth?.currentUser?.email || "";
    } catch (err) {
      byId("putawayAuditAuditor").value = window.auth?.currentUser?.email || "";
    }

    auditState.active = readActive();
    renderActiveAudit();
  }

  function setMessage(message) {
    const el = byId("putawayAuditMessage");
    if (el) el.textContent = message;
  }


  function putawayHistoryDateSummary(docs) {
    const summary = new Map();

    (docs || []).forEach((doc) => {
      const data = doc.data ? doc.data() : doc;
      const sessionDate = String(
        data.workDate || data.date || data.completedDate || dateKey(data.createdAt) || ""
      ).slice(0, 10);
      if (!sessionDate) return;

      const lines = Array.isArray(data.lines) ? data.lines : [];
      const withLocations = lines.filter((line) =>
        String(line.location || line.binLocation || line.slot || line.toSlot || "").trim()
      );

      const current = summary.get(sessionDate) || {
        date: sessionDate,
        records: 0,
        lines: 0,
        locations: new Set()
      };

      current.records += 1;
      current.lines += withLocations.length;
      withLocations.forEach((line) => {
        current.locations.add(
          normalizeLocation(line.location || line.binLocation || line.slot || line.toSlot || "")
        );
      });
      summary.set(sessionDate, current);
    });

    return [...summary.values()]
      .map((row) => ({
        date: row.date,
        records: row.records,
        lines: row.lines,
        locations: row.locations.size
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function formatHistoryDateLabel(row) {
    const raw = row?.date || "";
    let label = raw;
    const parsed = new Date(raw + "T12:00:00");
    if (!Number.isNaN(parsed.getTime())) {
      label = parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    }
    return label + " — " + row.locations + " locations / " + row.lines + " putaway lines";
  }

  function populateAuditHistoryDates() {
    const select = byId("putawayAuditDate");
    if (!select) return;

    const dates = putawayHistoryDateSummary(auditState.allDocs || []);
    const activeDate = auditState.active?.sourceDate || "";
    const previous = select.value || activeDate;

    select.innerHTML = '<option value="">Choose a date from Putaway History</option>';

    dates.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.date;
      option.textContent = formatHistoryDateLabel(row);
      select.appendChild(option);
    });

    if (previous && dates.some((row) => row.date === previous)) {
      select.value = previous;
    } else if (dates.length) {
      select.value = dates[0].date;
    }

    select.disabled = !dates.length;
  }

  async function loadAuditData() {
    if (auditState.loading) return;
    auditState.loading = true;
    setMessage("Loading putaway history locations...");

    try {
      const [docs, results] = await Promise.all([fetchAllPutawayDocs(), fetchAuditResults()]);
      auditState.allDocs = docs;
      auditState.auditResults = results;
      auditState.active = readActive();
      populateAuditHistoryDates();
      applyAuditDateFilter({ silent: true });
      renderSummary();
      renderActiveAudit();
      renderLocationHistory();
      populateAuditHistoryAisles();
      renderAuditHistory();
      setMessage(
        auditState.locations.length
          ? "Loaded " + auditState.locations.length + " unique locations for " + (byId("putawayAuditDate")?.value || "all dates") + "."
          : "No saved putaway locations were found for the selected history date."
      );
    } catch (err) {
      console.error("Putaway audit load failed:", err);
      setMessage("Putaway audit failed to load: " + err.message);
    } finally {
      auditState.loading = false;
    }
  }

  function renderSummary() {
    const latest = latestAuditByLocation();
    const total = auditState.locations.length;
    const audited = auditState.locations.filter((row) => latest.has(row.key)).length;
    if (byId("putawayAuditLocationCount")) byId("putawayAuditLocationCount").textContent = total;
    if (byId("putawayAuditCompletedCount")) byId("putawayAuditCompletedCount").textContent = audited;
    if (byId("putawayAuditRemainingCount")) byId("putawayAuditRemainingCount").textContent = Math.max(0, total - audited);
  }

  function previousCalendarDateKey() {
    const today = dateKey(new Date());
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return dateKey(d);
  }

  function auditedLocationKeysForDate(targetDate) {
    const keys = new Set();
    (auditState.auditResults || []).forEach((row) => {
      const auditDate = String(row.date || dateKey(row.createdAt) || "").slice(0, 10);
      if (auditDate !== targetDate) return;
      const key = normalizeLocation(row.location);
      if (key) keys.add(key);
    });
    return keys;
  }

  function nextLocationsForAudit() {
    const latest = latestAuditByLocation();
    const today = dateKey(new Date());
    const yesterday = previousCalendarDateKey();
    const auditedToday = auditedLocationKeysForDate(today);
    const auditedYesterday = auditedLocationKeysForDate(yesterday);

    // Hard rule: never assign a location already audited today or yesterday.
    // If fewer than 25 eligible locations remain, return the smaller batch
    // rather than recycling a recently audited location.
    const eligible = auditState.locations.filter(
      (row) => !auditedToday.has(row.key) && !auditedYesterday.has(row.key)
    );

    const neverAudited = eligible
      .filter((row) => !latest.has(row.key))
      .sort(naturalLocationCompare);

    if (neverAudited.length) return neverAudited.slice(0, BATCH_SIZE);

    return eligible
      .map((row) => ({
        ...row,
        lastAuditAt: latest.get(row.key)?.createdAt || latest.get(row.key)?.date || ""
      }))
      .sort((a, b) => String(a.lastAuditAt).localeCompare(String(b.lastAuditAt)) || naturalLocationCompare(a, b))
      .slice(0, BATCH_SIZE);
  }



  function aisleFromLocation(location) {
    const text = normalizeLocation(location);
    if (!text) return "";
    const match = text.match(/^([A-Z]+)(?=-|\d|$)/);
    const aisle = match ? match[1] : text.split("-")[0];

    // Group all R-series aisles (R, RA, RB, RC, RD, etc.) into one audit filter.
    if (/^R[A-Z]*$/.test(aisle)) return "R";

    return aisle;
  }

  function populateAuditAisles() {
    const select = byId("putawayAuditAisle");
    if (!select) return;

    const previous = select.value || "";
    const aisles = [...new Set(
      (auditState.locations || [])
        .map((row) => aisleFromLocation(row.location))
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    select.innerHTML = '<option value="">All aisles</option>';
    aisles.forEach((aisle) => {
      const option = document.createElement("option");
      option.value = aisle;
      option.textContent = "Aisle " + aisle;
      select.appendChild(option);
    });

    if (previous && aisles.includes(previous)) select.value = previous;
  }

  function applyAuditAisleFilter(options = {}) {
    const selectedDate = byId("putawayAuditDate")?.value || "";
    const selectedAisle = byId("putawayAuditAisle")?.value || "";

    const dateRows = extractLocationRows(auditState.allDocs || [], selectedDate);
    auditState.locations = selectedAisle
      ? dateRows.filter((row) => aisleFromLocation(row.location) === selectedAisle)
      : dateRows;

    renderSummary();
    renderLocationHistory();

    if (!options.silent) {
      const aisleText = selectedAisle ? " in aisle " + selectedAisle : "";
      setMessage(
        auditState.locations.length
          ? "Found " + auditState.locations.length + " putaway locations" + aisleText + " for " + selectedDate + "."
          : "No putaway locations were found" + aisleText + " for " + (selectedDate || "that date") + "."
      );
    }
  }

  function applyAuditDateFilter(options = {}) {
    const selectedDate = byId("putawayAuditDate")?.value || "";
    auditState.locations = extractLocationRows(auditState.allDocs || [], selectedDate);
    populateAuditAisles();
    applyAuditAisleFilter({ silent: true });
    if (!options.silent) {
      const selectedAisle = byId("putawayAuditAisle")?.value || "";
      setMessage(
        auditState.locations.length
          ? "Found " + auditState.locations.length + " unique putaway locations" + (selectedAisle ? " in aisle " + selectedAisle : "") + " for " + selectedDate + "."
          : "No putaway locations were found in History" + (selectedAisle ? " for aisle " + selectedAisle : "") + " on " + (selectedDate || "that date") + "."
      );
    }
  }

  function printAuditSheet() {
    if (!auditState.active?.lines?.length) {
      setMessage("Start a 25-location audit before printing the audit sheet.");
      return;
    }

    captureActiveInputs();
    saveActive();

    const active = auditState.active;
    const rows = active.lines.map((line, index) =>
      "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + safe(active.sourceDate || line.latestDate || "") + "</td>" +
        "<td><strong>" + safe(line.latestItem || "") + "</strong></td>" +
        "<td><strong>" + safe(line.location) + "</strong></td>" +
        "<td>" + safe(line.latestQty ?? "") + "</td>" +
        '<td class="check-box">□</td>' +
      "</tr>"
    ).join("");

    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
      setMessage("The browser blocked the print window. Allow pop-ups for this site, then try again.");
      return;
    }

    printWindow.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Putaway Audit - ' + safe(active.sourceDate || "") + '</title>' +
      '<style>' +
      '@page{size:landscape;margin:.35in} body{font-family:Arial,sans-serif;color:#111;margin:0} ' +
      'h1{font-size:22px;margin:0 0 4px} .meta{display:flex;gap:28px;font-size:13px;margin:0 0 10px} ' +
      'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px} th,td{border:1px solid #000;padding:7px;vertical-align:middle} ' +
      'th{background:#eee;font-weight:700} tr{height:34px} ' +
      'th:nth-child(1),td:nth-child(1){width:5%} th:nth-child(2),td:nth-child(2){width:15%} ' +
      'th:nth-child(3),td:nth-child(3){width:22%} th:nth-child(4),td:nth-child(4){width:28%} ' +
      'th:nth-child(5),td:nth-child(5){width:15%} th:nth-child(6),td:nth-child(6){width:15%;text-align:center;font-size:22px} ' +
      '.footer{margin-top:9px;font-size:11px;display:flex;justify-content:space-between} ' +
      '@media print{button{display:none}}' +
      '</style></head><body>' +
      '<h1>Putaway Audit Sheet</h1>' +
      '<div class="meta"><strong>Putaway Date: ' + safe(active.sourceDate || "") + '</strong>' +
      '<span>Aisle: ' + safe(active.sourceAisle || "All") + '</span>' +
      '<span>Auditor: ' + safe(active.auditor || currentAuditor()) + '</span>' +
      '<span>Batch: ' + safe(active.id || "") + '</span></div>' +
      '<table><thead><tr><th>#</th><th>Date</th><th>Item Number</th><th>Location</th><th>Quantity</th><th>Check</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="footer"><span>Completed by: ______________________________</span><span>Audit Date: __________________</span></div>' +
      '<script>window.onload=function(){window.print();}<\/script>' +
      '</body></html>'
    );
    printWindow.document.close();
  }

  function startAudit() {
    if (auditState.active?.lines?.length) {
      setMessage("You already have an active putaway audit. Finish or cancel it before starting another.");
      return;
    }
    if (!auditState.locations.length) {
      setMessage("No putaway history locations are loaded yet.");
      return;
    }

    const selectedDate = byId("putawayAuditDate")?.value || "";
    if (!selectedDate) {
      setMessage("Choose a date from Putaway History first.");
      byId("putawayAuditDate")?.focus();
      return;
    }

    const auditor = currentAuditor();
    if (!auditor) {
      setMessage("Enter the auditor name before starting.");
      byId("putawayAuditAuditor")?.focus();
      return;
    }

    const selected = nextLocationsForAudit();
    if (!selected.length) {
      setMessage("No eligible locations are available. Locations audited today or yesterday are intentionally excluded.");
      return;
    }

    auditState.active = {
      id: "PA-" + Date.now(),
      auditor,
      auditorUid: currentUid(),
      startedAt: new Date().toISOString(),
      sourceDate: selectedDate,
      sourceAisle: byId("putawayAuditAisle")?.value || "",
      lines: selected.map((row, index) => ({
        line: index + 1,
        location: row.location,
        latestItem: row.latestItem,
        latestQty: row.latestQty,
        correctQty: "",
        latestWorker: row.latestWorker,
        latestDate: row.latestDate,
        putawayNumber: row.putawayNumber || "",
        result: "Pending",
        notes: ""
      }))
    };

    saveActive();
    renderActiveAudit();
    const aisleLabel = auditState.active.sourceAisle ? " in aisle " + auditState.active.sourceAisle : "";
    setMessage("Started " + selected.length + "-location audit" + aisleLabel + " for putaways from " + selectedDate + ".");
  }

  function resultOptions(selected) {
    const options = ["Pending", "Good", "Wrong Item", "Wrong Location", "Qty / Placement Issue", "Other"];
    return options.map((value) =>
      '<option value="' + safe(value) + '"' + (value === selected ? " selected" : "") + ">" + safe(value) + "</option>"
    ).join("");
  }

  function renderActiveAudit() {
    const body = byId("putawayAuditActiveBody");
    if (!body) return;
    body.innerHTML = "";

    const active = auditState.active;
    if (!active?.lines?.length) {
      body.innerHTML = '<tr><td colspan="9">No active audit. Choose a date, then click <strong>Start 25 Location Audit</strong>.</td></tr>';
      renderProgress();
      return;
    }

    active.lines.forEach((line, index) => {
      const tr = document.createElement("tr");
      tr.dataset.index = String(index);
      tr.innerHTML =
        "<td>" + (index + 1) + "</td>" +
        "<td><strong>" + safe(line.location) + "</strong></td>" +
        "<td>" + safe(line.latestItem || "") + "</td>" +
        "<td>" + safe(line.latestQty ?? "") + "</td>" +
        '<td><input class="putaway-audit-correct-qty" type="number" min="0" value="' + safe(line.correctQty ?? "") + '" placeholder="Qty" style="min-width:80px" /></td>' +
        "<td>" + safe(line.latestWorker || "") + "</td>" +
        "<td>" + safe(line.latestDate || "") + "</td>" +
        '<td><select class="putaway-audit-result">' + resultOptions(line.result || "Pending") + "</select></td>" +
        '<td><input class="putaway-audit-note" value="' + safe(line.notes || "") + '" placeholder="What did you find?" /></td>';
      body.appendChild(tr);
    });

    if (byId("putawayAuditAuditor") && !byId("putawayAuditAuditor").value.trim()) {
      byId("putawayAuditAuditor").value = active.auditor || "";
    }
    if (byId("putawayAuditDate") && active.sourceDate) {
      const optionExists = [...byId("putawayAuditDate").options].some((opt) => opt.value === active.sourceDate);
      if (optionExists) byId("putawayAuditDate").value = active.sourceDate;
    }
    if (byId("putawayAuditAisle") && active.sourceAisle) {
      const aisleExists = [...byId("putawayAuditAisle").options].some((opt) => opt.value === active.sourceAisle);
      if (aisleExists) byId("putawayAuditAisle").value = active.sourceAisle;
    }
    renderProgress();
  }

  function captureActiveInputs() {
    if (!auditState.active?.lines?.length) return;
    document.querySelectorAll("#putawayAuditActiveBody tr[data-index]").forEach((row) => {
      const index = Number(row.dataset.index);
      const line = auditState.active.lines[index];
      if (!line) return;
      line.result = row.querySelector(".putaway-audit-result")?.value || "Pending";
      line.correctQty = row.querySelector(".putaway-audit-correct-qty")?.value ?? "";
      line.notes = row.querySelector(".putaway-audit-note")?.value.trim() || "";
    });
  }

  function renderProgress() {
    const lines = auditState.active?.lines || [];
    const done = lines.filter((line) => line.result && line.result !== "Pending").length;
    const total = lines.length || BATCH_SIZE;
    if (byId("putawayAuditProgress")) byId("putawayAuditProgress").textContent = done + " / " + total + " checked";
  }

  async function completeAudit() {
    if (!auditState.active?.lines?.length) {
      setMessage("There is no active putaway audit to complete.");
      return;
    }

    captureActiveInputs();
    const pending = auditState.active.lines.filter((line) => !line.result || line.result === "Pending");
    if (pending.length) {
      setMessage("Finish all locations first. " + pending.length + " still show Pending.");
      return;
    }

    const completedAt = new Date().toISOString();
    const auditor = currentAuditor() || auditState.active.auditor;
    const sessionId = auditState.active.id;

    const rows = auditState.active.lines.map((line) => ({
      type: "putawayAudit",
      archiveType: "putawayAuditHistory",
      employee: auditor,
      auditorUid: currentUid() || auditState.active.auditorUid || "",
      date: dateKey(completedAt),
      item: line.latestItem || "",
      qty: Number(line.latestQty || 0),
      correctQty: line.correctQty === "" ? null : Number(line.correctQty),
      location: line.location,
      documentNumber: line.putawayNumber || "",
      status: line.result,
      auditResult: line.result,
      notes: line.notes || "",
      sourceWorker: line.latestWorker || "",
      sourceDate: auditState.active.sourceDate || line.latestDate || "",
      sourceAisle: auditState.active.sourceAisle || aisleFromLocation(line.location),
      auditSessionId: sessionId,
      createdAt: completedAt,
      createdBy: currentUid(),
      createdByEmail: window.auth?.currentUser?.email || ""
    }));

    try {
      if (isDemo()) {
        const existing = await fetchAuditResults();
        const merged = rows.concat(existing);
        localStorage.setItem(DEMO_RESULTS_KEY, JSON.stringify(merged));
      } else {
        const batch = db.batch();
        rows.forEach((row) => {
          const ref = db.collection("activityLogs").doc();
          batch.set(ref, row);
        });
        await batch.commit();
      }

      auditState.auditResults = rows.concat(auditState.auditResults);
      auditState.active = null;
      saveActive();
      renderSummary();
      renderActiveAudit();
      renderLocationHistory();
      populateAuditHistoryAisles();
      renderAuditHistory();
      setMessage("Audit submitted successfully. It is now saved in Audit History.");
      notify("Putaway audit completed.");
    } catch (err) {
      console.error("Putaway audit save failed:", err);
      setMessage("Could not complete audit: " + err.message);
    }
  }

  function cancelAudit() {
    if (!auditState.active?.lines?.length) {
      setMessage("There is no active batch to cancel.");
      return;
    }
    if (!window.confirm("Cancel this 25-location audit batch? Saved audit results are not affected.")) return;
    auditState.active = null;
    saveActive();
    renderActiveAudit();
    setMessage("Active audit batch canceled.");
  }

  function auditHistoryGroups() {
    const groups = new Map();
    (auditState.auditResults || []).forEach((row, index) => {
      const sessionId = row.auditSessionId || ("legacy-" + index + "-" + String(row.createdAt || row.date || ""));
      const aisle = row.sourceAisle || aisleFromLocation(row.location);
      const group = groups.get(sessionId) || {
        sessionId: sessionId,
        completedAt: row.createdAt || row.date || "",
        sourceDate: row.sourceDate || "",
        sourceAisle: aisle || "",
        auditor: row.employee || "",
        rows: []
      };
      group.rows.push(row);
      if (!group.sourceDate && row.sourceDate) group.sourceDate = row.sourceDate;
      if (!group.sourceAisle && aisle) group.sourceAisle = aisle;
      if (!group.auditor && row.employee) group.auditor = row.employee;
      groups.set(sessionId, group);
    });
    return [...groups.values()].sort((a,b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")));
  }

  function populateAuditHistoryAisles() {
    const select = byId("putawayAuditHistoryAisle");
    if (!select) return;
    const previous = select.value || "";
    const aisles = [...new Set(auditHistoryGroups().map((g) => g.sourceAisle).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }));
    select.innerHTML = '<option value="">All aisles</option>';
    aisles.forEach((aisle) => {
      const option = document.createElement("option");
      option.value = aisle;
      option.textContent = "Aisle " + aisle;
      select.appendChild(option);
    });
    if (previous && aisles.includes(previous)) select.value = previous;
  }

  function renderAuditHistory() {
    const body = byId("putawayAuditHistoryBody");
    if (!body) return;
    const dateFilter = byId("putawayAuditHistoryDate")?.value || "";
    const auditorFilter = String(byId("putawayAuditHistoryAuditor")?.value || "").trim().toLowerCase();
    const aisleFilter = byId("putawayAuditHistoryAisle")?.value || "";
    const allGroups = auditHistoryGroups();
    if (byId("putawayAuditHistoryCount")) byId("putawayAuditHistoryCount").textContent = allGroups.length;

    const groups = allGroups.filter((group) => {
      if (dateFilter && dateKey(group.completedAt) !== dateFilter) return false;
      if (auditorFilter && !String(group.auditor || "").toLowerCase().includes(auditorFilter)) return false;
      if (aisleFilter && group.sourceAisle !== aisleFilter) return false;
      return true;
    });
    body.innerHTML = "";
    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="8">No completed putaway audits match these filters.</td></tr>';
      return;
    }
    groups.forEach((group) => {
      const good = group.rows.filter((row) => String(row.auditResult || row.status || "").toLowerCase() === "good").length;
      const issues = group.rows.length - good;
      body.insertAdjacentHTML("beforeend",
        "<tr>" +
        "<td>" + safe(dateKey(group.completedAt)) + "</td>" +
        "<td>" + safe(group.sourceDate || "") + "</td>" +
        "<td>" + safe(group.sourceAisle ? "Aisle " + group.sourceAisle : "All") + "</td>" +
        "<td>" + safe(group.auditor || "") + "</td>" +
        "<td>" + safe(group.rows.length) + "</td>" +
        "<td>" + safe(good) + "</td>" +
        "<td>" + safe(issues) + "</td>" +
        '<td><button type="button" class="primary" data-audit-session="' + safe(group.sessionId) + '">View</button></td>' +
        "</tr>"
      );
    });
  }

  function showAuditHistoryDetail(sessionId) {
    const detail = byId("putawayAuditHistoryDetail");
    if (!detail) return;
    const group = auditHistoryGroups().find((g) => g.sessionId === sessionId);
    if (!group) return;
    const rows = [...group.rows].sort((a,b) => naturalLocationCompare({location:a.location},{location:b.location})).map((row,index) =>
      "<tr>" +
      "<td>" + (index + 1) + "</td>" +
      "<td><strong>" + safe(row.location || "") + "</strong></td>" +
      "<td>" + safe(row.qty ?? "") + "</td>" +
      "<td>" + safe(row.correctQty ?? "") + "</td>" +
      "<td>" + safe(row.auditResult || row.status || "") + "</td>" +
      "<td>" + safe(row.notes || "") + "</td>" +
      "</tr>"
    ).join("");
    detail.innerHTML =
      '<div class="section-heading"><div><h3>Audit Details</h3><p class="hint">' +
      safe(group.sourceDate || "") + " · " + safe(group.sourceAisle ? "Aisle " + group.sourceAisle : "All aisles") + " · " + safe(group.auditor || "") +
      '</p></div><button type="button" id="closePutawayAuditHistoryDetailBtn">Close</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Location</th><th>Putaway Qty</th><th>Correct Qty</th><th>Result</th><th>Notes</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    detail.classList.remove("hidden");
    byId("closePutawayAuditHistoryDetailBtn")?.addEventListener("click", () => { detail.classList.add("hidden"); detail.innerHTML = ""; });
  }

  function injectTabletAuditStyles() {
    if (byId("putawayAuditTabletStyles")) return;
    const style = document.createElement("style");
    style.id = "putawayAuditTabletStyles";
    style.textContent = [
      "#putawayAuditTab button,#putawayAuditTab input,#putawayAuditTab select{min-height:44px}",
      "#putawayAuditTab .putaway-audit-submit-row{margin-top:16px;justify-content:flex-end}",
      "#putawayAuditTab .putaway-audit-submit-btn{font-size:18px;padding:14px 28px;min-width:220px}",
      "#putawayAuditTab .putaway-audit-history-detail{margin-top:18px;padding-top:14px;border-top:2px solid rgba(128,128,128,.25)}",
      "@media(max-width:1024px){#putawayAuditTab .grid{grid-template-columns:repeat(2,minmax(0,1fr))}#putawayAuditTab .actions{gap:10px;flex-wrap:wrap}#putawayAuditTab .actions button{flex:1 1 180px;font-size:16px;padding:12px 14px}#putawayAuditActiveCard .table-wrap,#putawayAuditTab .putaway-audit-history-detail .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}#putawayAuditActiveCard table{min-width:1050px}#putawayAuditTab .putaway-audit-history-table{min-width:850px}#putawayAuditActiveBody td{padding:10px 8px}#putawayAuditActiveBody input,#putawayAuditActiveBody select{min-width:120px;font-size:16px}#putawayAuditActiveBody .putaway-audit-note{min-width:220px}}",
      "@media(max-width:700px){#putawayAuditTab .grid{grid-template-columns:1fr}} "
    ].join("");
    document.head.appendChild(style);
  }
  function renderLocationHistory() {
    const body = byId("putawayAuditLocationsBody");
    if (!body) return;

    const search = String(byId("putawayAuditSearch")?.value || "").trim().toLowerCase();
    const latest = latestAuditByLocation();
    const rows = auditState.locations.filter((row) => !search || row.location.toLowerCase().includes(search));

    body.innerHTML = "";
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7">No matching putaway history locations.</td></tr>';
      return;
    }

    rows.forEach((row) => {
      const audit = latest.get(row.key);
      body.insertAdjacentHTML(
        "beforeend",
        "<tr>" +
          "<td><strong>" + safe(row.location) + "</strong></td>" +
          "<td>" + safe(row.timesSeen) + "</td>" +
          "<td>" + safe(row.latestItem || "") + "</td>" +
          "<td>" + safe(row.latestWorker || "") + "</td>" +
          "<td>" + safe(row.latestDate || "") + "</td>" +
          "<td>" + safe(audit ? dateKey(audit.createdAt || audit.date) : "Never") + "</td>" +
          "<td>" + safe(audit?.auditResult || audit?.status || "") + "</td>" +
        "</tr>"
      );
    });
  }

  function init() {
    injectUi();
    injectTabletAuditStyles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();