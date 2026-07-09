(function () {
  const PROCESS_TYPES = ["putaway", "picking"];
  const filters = {
    putaway: { start: "", end: "", worker: "", item: "", putawayNumber: "", status: "" },
    picking: { start: "", end: "" }
  };

  document.addEventListener("DOMContentLoaded", () => {
    installFirestoreCompletedDatePatch();
    installSaveWrappers();
    installHistoryEvents();
    overrideHistoryFunctions();
    normalizeHistoryState();
    renderHistory();
  });

  function todayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeDate(value) {
    if (!value) return "";

    if (typeof value === "object" && typeof value.toDate === "function") {
      return value.toDate().toISOString().slice(0, 10);
    }

    if (typeof value === "object" && Number.isFinite(value.seconds)) {
      return new Date(value.seconds * 1000).toISOString().slice(0, 10);
    }

    const text = String(value).trim();
    if (!text) return "";

    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) return isoMatch[0];

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return "";
  }

  function getCompletedDate(record) {
    return (
      normalizeDate(record?.completedDate) ||
      normalizeDate(record?.date) ||
      normalizeDate(record?.timestamp) ||
      normalizeDate(record?.createdAt) ||
      normalizeDate(record?.savedAt) ||
      todayDate()
    );
  }

  function withCompletedDate(record) {
    return {
      ...(record || {}),
      completedDate: getCompletedDate(record || {})
    };
  }

  function sortByCompletedDateDesc(rows) {
    return [...(rows || [])].sort((a, b) => {
      const dateCompare = getCompletedDate(b).localeCompare(getCompletedDate(a));
      if (dateCompare !== 0) return dateCompare;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function normalizeHistoryState() {
    if (typeof state === "undefined") return;

    state.putawayLogs = sortByCompletedDateDesc((state.putawayLogs || []).map(withCompletedDate));
    state.cycleSessions = [];
    state.pickingSessions = sortByCompletedDateDesc((state.pickingSessions || []).map(withCompletedDate));

    if (state.isDemoMode && typeof persistDemoState === "function") {
      persistDemoState();
    }
  }

  function installFirestoreCompletedDatePatch() {
    if (!window.db || window.db.__historyCompletedDatePatched) return;

    const originalCollection = window.db.collection.bind(window.db);
    window.db.collection = function patchedCollection(name) {
      const collectionRef = originalCollection(name);

      if (!["putAwayLogs", "orderPickingSessions", "activityLogs"].includes(name)) {
        return collectionRef;
      }

      return new Proxy(collectionRef, {
        get(target, prop, receiver) {
          if (prop === "add") {
            return function patchedAdd(doc) {
              return target.add(addCompletedDateForCollection(name, doc));
            };
          }

          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };

    window.db.__historyCompletedDatePatched = true;
  }

  function addCompletedDateForCollection(collectionName, doc) {
    const completedDate =
      normalizeDate(doc?.completedDate) ||
      normalizeDate(doc?.date) ||
      selectedFormDateForCollection(collectionName) ||
      todayDate();

    return {
      ...(doc || {}),
      completedDate
    };
  }

  function selectedFormDateForCollection(collectionName) {
    if (collectionName === "putAwayLogs") return normalizeDate($("putDate")?.value);
    if (collectionName === "orderPickingSessions") return normalizeDate($("pickDate")?.value);
    return "";
  }

  function installSaveWrappers() {
    wrapSave("savePutawayBtn", "savePutaway");
    wrapSave("savePickingBtn", "savePicking");
  }

  function wrapSave(buttonId, functionName) {
    const button = $(buttonId);
    const originalSave = window[functionName];
    if (!button || typeof originalSave !== "function" || originalSave.__historyWrapped) return;

    button.removeEventListener("click", originalSave);

    const wrappedSave = async function () {
      await originalSave();
      normalizeHistoryState();
      renderHistory();
    };

    wrappedSave.__historyWrapped = true;
    window[functionName] = wrappedSave;
    button.addEventListener("click", wrappedSave);
  }

  function installHistoryEvents() {
    document.querySelectorAll(".history-tab").forEach((button) => {
      button.addEventListener("click", () => switchHistoryTab(button.dataset.historyTab));
    });

    document.querySelectorAll(".historyFilterBtn").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.historyType;
        filters[type] = {
          start: normalizeDate($(`${type}HistoryStart`)?.value),
          end: normalizeDate($(`${type}HistoryEnd`)?.value),
          worker: $(`${type}HistoryWorker`)?.value.trim().toLowerCase() || "",
          item: $(`${type}HistoryItem`)?.value.trim().toLowerCase() || "",
          putawayNumber: $(`${type}HistoryNumber`)?.value.trim().toLowerCase() || "",
          status: $(`${type}HistoryStatus`)?.value || ""
        };
        renderHistory();
      });
    });

    document.querySelectorAll(".historyClearBtn").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.historyType;
        filters[type] = { start: "", end: "", worker: "", item: "", putawayNumber: "", status: "" };
        if ($(`${type}HistoryStart`)) $(`${type}HistoryStart`).value = "";
        if ($(`${type}HistoryEnd`)) $(`${type}HistoryEnd`).value = "";
        if ($(`${type}HistoryWorker`)) $(`${type}HistoryWorker`).value = "";
        if ($(`${type}HistoryItem`)) $(`${type}HistoryItem`).value = "";
        if ($(`${type}HistoryNumber`)) $(`${type}HistoryNumber`).value = "";
        if ($(`${type}HistoryStatus`)) $(`${type}HistoryStatus`).value = "";
        renderHistory();
      });
    });

    document.querySelectorAll(".historyExportBtn").forEach((button) => {
      button.addEventListener("click", () => exportProcessHistory(button.dataset.historyType));
    });
  }

  function overrideHistoryFunctions() {
    const originalLoadCollection = window.loadCollection;
    const originalLoadHistory = window.loadHistory;

    window.loadHistory = async function upgradedLoadHistory() {
      if (typeof state === "undefined") return;

      if (state.isDemoMode) {
        normalizeHistoryState();
        renderLogs?.();
        renderHistory();
        toast?.("History refreshed.");
        return;
      }

      if (typeof originalLoadCollection !== "function") {
        renderHistory();
        return;
      }

      try {
        await Promise.all([
          originalLoadCollection(COLLECTIONS.putaway, "putawayLogs"),
          originalLoadCollection(COLLECTIONS.picking, "pickingSessions")
        ]);

        normalizeHistoryState();
        renderLogs?.();
        renderHistory();
        toast?.("History refreshed.");
      } catch (err) {
        console.error("History load failed:", err);
        normalizeHistoryState();
        renderHistory();
        toast?.("History failed: " + err.message);
      }
    };

    const refreshButton = $("refreshHistoryBtn");
    if (refreshButton && typeof window.loadHistory === "function") {
      if (typeof originalLoadHistory === "function") {
        refreshButton.removeEventListener("click", originalLoadHistory);
      }

      refreshButton.onclick = null;
      refreshButton.addEventListener("click", window.loadHistory);
    }

    window.renderHistory = renderHistory;
  }

  function switchHistoryTab(type) {
    document.querySelectorAll(".history-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.historyTab === type);
    });

    document.querySelectorAll(".history-panel").forEach((panel) => {
      panel.classList.remove("active");
    });

    $(`${type}HistoryPanel`)?.classList.add("active");
  }

  function filteredRecords(type) {
    const source = {
      putaway: state?.putawayLogs || [],
      picking: state?.pickingSessions || []
    }[type] || [];

    const filter = filters[type] || {};
    let min = normalizeDate(filter.start);
    let max = normalizeDate(filter.end);

    if (min && !max) max = min;
    if (!min && max) min = max;

    return sortByCompletedDateDesc(source.map(withCompletedDate)).filter((record) => {
      const completedDate = getCompletedDate(record);
      if (min && completedDate < min) return false;
      if (max && completedDate > max) return false;
      return true;
    });
  }

  function renderHistory() {
    if (typeof state === "undefined") return;
    renderPutawayHistory();
    renderPickingHistory();
  }

  function buildPutawayLineRows() {
    return sortByCompletedDateDesc(state?.putawayLogs || []).flatMap((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      const sessionDate = getCompletedDate(log);
      const putawayNumber = log.putawayNumber || log.sheetNumber || "";
      return lines.map((line) => ({
        completedDate: sessionDate,
        date: log.date || sessionDate,
        worker: log.worker || "",
        workerUid: log.workerUid || log.createdBy || "",
        workerEmail: log.workerEmail || log.createdByEmail || "",
        putawayNumber,
        sourceId: log.id || "",
        line: line.line || "",
        item: line.item || "",
        qty: Number(line.qty || 0),
        location: line.location || "",
        status: line.status || log.status || "",
        dockToStockMinutes: Number(log.dockToStockMinutes || 0),
        notes: line.notes || "",
        timestamp: line.timestamp || log.timestamp || log.createdAt || "",
        createdAt: log.createdAt || "",
        dedupeKey: line.dedupeKey || ""
      }));
    });
  }

  function filteredPutawayRows() {
    const filter = filters.putaway || {};
    let min = normalizeDate(filter.start);
    let max = normalizeDate(filter.end);

    if (min && !max) max = min;
    if (!min && max) min = max;

    return buildPutawayLineRows().filter((row) => {
      const completedDate = normalizeDate(row.completedDate);
      if (min && completedDate < min) return false;
      if (max && completedDate > max) return false;
      if (filter.worker && !String(row.worker || "").toLowerCase().includes(filter.worker)) return false;
      if (filter.item && !String(row.item || "").toLowerCase().includes(filter.item)) return false;
      if (filter.putawayNumber && !String(row.putawayNumber || "").toLowerCase().includes(filter.putawayNumber)) return false;
      if (filter.status && String(row.status || "") !== filter.status) return false;
      return true;
    });
  }

  function renderPutawayHistory() {
    const body = $("putawayHistoryBody");
    if (!body) return;

    const rows = filteredPutawayRows();
    body.innerHTML = "";

    if (!rows.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No Put Away Log records found for these filters.</td></tr>`);
      return;
    }

    rows.forEach((row) => {
      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td>${escapeHtml(row.completedDate)}</td>
          <td>${escapeHtml(row.worker)}</td>
          <td>${escapeHtml(row.putawayNumber)}</td>
          <td>${escapeHtml(row.item)}</td>
          <td>${escapeHtml(row.qty)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${Number(row.dockToStockMinutes || 0)}</td>
          <td>${escapeHtml(row.notes)}</td>
          <td>${historyActions("putaway", row.sourceId)}</td>
        </tr>
      `
      );
    });
  }

  function renderCycleHistory() {
    const body = $("cycleHistoryBody");
    if (!body) return;

    const records = filteredRecords("cycle");
    body.innerHTML = "";

    if (!records.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No Cycle Count records found for this date range.</td></tr>`);
      return;
    }

    records.forEach((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      const varianceLines = Number(log.varianceLines ?? lines.filter((line) => Number(line.variance || 0) !== 0).length);
      const totalVariance = sumBy(lines, "variance");
      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td>${escapeHtml(getCompletedDate(log))}</td>
          <td>${escapeHtml(log.counter || "")}</td>
          <td>${escapeHtml(log.countId || "")}</td>
          <td>${Number(log.lineCount || lines.length || 0)}</td>
          <td>${varianceLines}</td>
          <td>${totalVariance}</td>
          <td>${varianceLines ? '<span class="badge bad">Variance</span>' : '<span class="badge ok">Balanced</span>'}</td>
          <td>${escapeHtml(previewLines(lines, (line) => `${line.item || ""}: counted ${line.countedQty || 0}, variance ${line.variance || 0}`))}</td>
          <td>${historyActions("cycle", log.id)}</td>
        </tr>
      `
      );
    });
  }

  function renderPickingHistory() {
    const body = $("pickingHistoryBody");
    if (!body) return;

    const records = filteredRecords("picking");
    body.innerHTML = "";

    if (!records.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No Order Picking records found for this date range.</td></tr>`);
      return;
    }

    records.forEach((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      const issueLines = Number(log.issueLines ?? lines.filter(isIssueLine).length);
      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td>${escapeHtml(getCompletedDate(log))}</td>
          <td>${escapeHtml(log.picker || "")}</td>
          <td>${escapeHtml(log.orderNumber || "")}</td>
          <td>${Number(log.lineCount || lines.length || 0)}</td>
          <td>${Number(log.totalPicked || sumBy(lines, "pickedQty"))}</td>
          <td>${issueLines}</td>
          <td>${issueLines ? '<span class="badge warn">Issues</span>' : '<span class="badge ok">Complete</span>'}</td>
          <td>${escapeHtml(previewLines(lines, (line) => `${line.item || ""}: picked ${line.pickedQty || 0}, ${line.status || "Pending"}`))}</td>
          <td>${historyActions("picking", log.id)}</td>
        </tr>
      `
      );
    });
  }

  function exportProcessHistory(type) {
    const builders = {
      putaway: buildPutawayRows,
      picking: buildPickingRows
    };

    const rows = builders[type]?.() || [];
    if (!rows.length) return toast?.("No data to export.");

    downloadCsv(rows, `${type}-history-${todayDate()}.csv`);
  }

  function buildPutawayRows() {
    return filteredPutawayRows().map((row) => ({
      completedDate: row.completedDate,
      date: row.date,
      employee: row.worker,
      employeeUid: row.workerUid,
      employeeEmail: row.workerEmail,
      putawayNumber: row.putawayNumber,
      sourceId: row.sourceId,
      line: row.line,
      item: row.item,
      qty: row.qty,
      location: row.location,
      status: row.status,
      notes: row.notes,
      dockToStockMinutes: row.dockToStockMinutes,
      timestamp: row.timestamp,
      dedupeKey: row.dedupeKey
    }));
  }

  function buildCycleRows() {
    return filteredRecords("cycle").map((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      const varianceLines = Number(log.varianceLines ?? lines.filter((line) => Number(line.variance || 0) !== 0).length);
      return {
        completedDate: getCompletedDate(log),
        counter: log.counter || "",
        stockCountId: log.countId || "",
        linesCounted: Number(log.lineCount || lines.length || 0),
        varianceLines,
        totalVariance: sumBy(lines, "variance"),
        status: varianceLines ? "Variance" : "Balanced",
        details: previewLines(lines, (line) => `${line.item || ""}: counted ${line.countedQty || 0}, variance ${line.variance || 0}`)
      };
    });
  }

  function buildPickingRows() {
    return filteredRecords("picking").map((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      const issueLines = Number(log.issueLines ?? lines.filter(isIssueLine).length);
      return {
        completedDate: getCompletedDate(log),
        picker: log.picker || "",
        orderNumber: log.orderNumber || "",
        lines: Number(log.lineCount || lines.length || 0),
        totalPicked: Number(log.totalPicked || sumBy(lines, "pickedQty")),
        issueLines,
        status: issueLines ? "Issues" : "Complete",
        details: previewLines(lines, (line) => `${line.item || ""}: picked ${line.pickedQty || 0}, ${line.status || "Pending"}`)
      };
    });
  }

  function sumBy(rows, key) {
    return (rows || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
  }

  function isIssueLine(line) {
    return ["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(line?.status);
  }

  function previewLines(lines, formatter) {
    return (lines || [])
      .slice(0, 3)
      .map(formatter)
      .filter(Boolean)
      .join(" | ");
  }

  function historyActions(type, id) {
    if (!id) return "";
    const safeType = escapeHtml(type);
    const safeId = escapeHtml(id);
    const canManage = typeof window.canManageHistory === "function" && window.canManageHistory();
    return `
      <div class="row-actions">
        <button type="button" onclick="openHistoryRecord('${safeType}', '${safeId}', 'view')">View</button>
        ${canManage ? `<button type="button" onclick="openHistoryRecord('${safeType}', '${safeId}', 'edit')">Edit</button>` : ""}
        ${canManage ? `<button type="button" class="danger" onclick="deleteHistoryRecordByKey('${safeType}', '${safeId}')">Delete</button>` : ""}
      </div>
    `;
  }
})();
