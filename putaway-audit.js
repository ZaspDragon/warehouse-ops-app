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
          '<label>Putaway Date to Audit<input id="putawayAuditDate" type="date" /></label>' +
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
    byId("startPutawayAuditBtn")?.addEventListener("click", startAudit);
    byId("printPutawayAuditBtn")?.addEventListener("click", printAuditSheet);
    byId("putawayAuditDate")?.addEventListener("change", applyAuditDateFilter);
    byId("savePutawayAuditProgressBtn")?.addEventListener("click", () => {
      captureActiveInputs();
      saveActive();
      renderActiveAudit();
      setMessage("Audit progress saved on this device.");
    });
    byId("completePutawayAuditBtn")?.addEventListener("click", completeAudit);
    byId("cancelPutawayAuditBtn")?.addEventListener("click", cancelAudit);
    byId("putawayAuditSearch")?.addEventListener("input", renderLocationHistory);

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

    if (byId("putawayAuditDate") && !byId("putawayAuditDate").value) {
      byId("putawayAuditDate").value = dateKey(new Date());
    }

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

  async function loadAuditData() {
    if (auditState.loading) return;
    auditState.loading = true;
    setMessage("Loading putaway history locations...");

    try {
      const [docs, results] = await Promise.all([fetchAllPutawayDocs(), fetchAuditResults()]);
      auditState.allDocs = docs;
      auditState.auditResults = results;
      applyAuditDateFilter({ silent: true });
      auditState.active = readActive();
      renderSummary();
      renderActiveAudit();
      renderLocationHistory();
      setMessage(
        auditState.locations.length
          ? "Loaded " + auditState.locations.length + " unique locations for " + (byId("putawayAuditDate")?.value || "all dates") + "."
          : "No saved putaway locations found for the selected date."
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

  function nextLocationsForAudit() {
    const latest = latestAuditByLocation();

    const neverAudited = auditState.locations
      .filter((row) => !latest.has(row.key))
      .sort(naturalLocationCompare);

    if (neverAudited.length) return neverAudited.slice(0, BATCH_SIZE);

    return auditState.locations
      .map((row) => ({
        ...row,
        lastAuditAt: latest.get(row.key)?.createdAt || latest.get(row.key)?.date || ""
      }))
      .sort((a, b) => String(a.lastAuditAt).localeCompare(String(b.lastAuditAt)) || naturalLocationCompare(a, b))
      .slice(0, BATCH_SIZE);
  }


  function applyAuditDateFilter(options = {}) {
    const selectedDate = byId("putawayAuditDate")?.value || "";
    auditState.locations = extractLocationRows(auditState.allDocs || [], selectedDate);
    renderSummary();
    renderLocationHistory();
    if (!options.silent) {
      setMessage(
        auditState.locations.length
          ? "Found " + auditState.locations.length + " unique putaway locations for " + selectedDate + "."
          : "No putaway locations were found for " + (selectedDate || "that date") + "."
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
        "<td><strong>" + safe(line.location) + "</strong></td>" +
        "<td>" + safe(line.latestItem || "") + "</td>" +
        "<td>" + safe(line.latestQty ?? "") + "</td>" +
        '<td class="write-box"></td>' +
        '<td class="check-box">□ Good&nbsp;&nbsp; □ Issue</td>' +
        '<td class="notes-box"></td>' +
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
      'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px} th,td{border:1px solid #000;padding:5px;vertical-align:middle} ' +
      'th{background:#eee;font-weight:700} tr{height:28px} ' +
      'th:nth-child(1),td:nth-child(1){width:4%} th:nth-child(2),td:nth-child(2){width:13%} ' +
      'th:nth-child(3),td:nth-child(3){width:13%} th:nth-child(4),td:nth-child(4){width:9%} ' +
      'th:nth-child(5),td:nth-child(5){width:10%} th:nth-child(6),td:nth-child(6){width:17%} ' +
      'th:nth-child(7),td:nth-child(7){width:34%} .write-box,.notes-box{height:24px} ' +
      '.footer{margin-top:9px;font-size:11px;display:flex;justify-content:space-between} ' +
      '@media print{button{display:none}}' +
      '</style></head><body>' +
      '<h1>Putaway Audit Sheet</h1>' +
      '<div class="meta"><strong>Putaway Date: ' + safe(active.sourceDate || "") + '</strong>' +
      '<span>Auditor: ' + safe(active.auditor || currentAuditor()) + '</span>' +
      '<span>Batch: ' + safe(active.id || "") + '</span></div>' +
      '<table><thead><tr><th>#</th><th>Location</th><th>Item #</th><th>Putaway Qty</th><th>Correct Qty</th><th>Result</th><th>Notes / What was wrong?</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="footer"><span>Completed by: ______________________________</span><span>Date checked: __________________</span></div>' +
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
      setMessage("Choose the putaway date you want to audit first.");
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
      setMessage("No locations are available to audit.");
      return;
    }

    auditState.active = {
      id: "PA-" + Date.now(),
      auditor,
      auditorUid: currentUid(),
      startedAt: new Date().toISOString(),
      sourceDate: selectedDate,
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
    setMessage("Started " + selected.length + "-location audit for putaways from " + selectedDate + ".");
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
      byId("putawayAuditDate").value = active.sourceDate;
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
      setMessage("Audit completed. The next batch will load the next 25 locations.");
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();