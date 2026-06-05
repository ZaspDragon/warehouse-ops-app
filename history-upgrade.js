(function () {
  const PROCESS_TYPES = ["putaway", "cycle", "picking"];
  const filters = {
    putaway: { start: "", end: "" },
    cycle: { start: "", end: "" },
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
    state.cycleSessions = sortByCompletedDateDesc((state.cycleSessions || []).map(withCompletedDate));
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

      if (!["putAwayLogs", "cycleCountSessions", "orderPickingSessions", "activityLogs"].includes(name)) {
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
    if (collectionName === "cycleCountSessions") return normalizeDate($("cycleDate")?.value);
    if (collectionName === "orderPickingSessions") return normalizeDate($("pickDate")?.value);
    return "";
  }

  function installSaveWrappers() {
    wrapSave("savePutawayBtn", "savePutaway");
    wrapSave("saveCycleBtn", "saveCycle");
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
          end: normalizeDate($(`${type}HistoryEnd`)?.value)
        };
        renderHistory();
      });
    });

    document.querySelectorAll(".historyClearBtn").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.historyType;
        filters[type] = { start: "", end: "" };
        if ($(`${type}HistoryStart`)) $(`${type}HistoryStart`).value = "";
        if ($(`${type}HistoryEnd`)) $(`${type}HistoryEnd`).value = "";
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
          originalLoadCollection(COLLECTIONS.cycle, "cycleSessions"),
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
      cycle: state?.cycleSessions || [],
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
    renderCycleHistory();
    renderPickingHistory();
  }

  function renderPutawayHistory() {
    const body = $("putawayHistoryBody");
    if (!body) return;

    const records = filteredRecords("putaway");
    body.innerHTML = "";

    if (!records.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="7">No Put Away Log records found for this date range.</td></tr>`);
      return;
    }

    records.forEach((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td>${escapeHtml(getCompletedDate(log))}</td>
          <td>${escapeHtml(log.worker || "")}</td>
          <td>${Number(log.lineCount || lines.length || 0)}</td>
          <td>${Number(log.totalQty || sumBy(lines, "qty"))}</td>
          <td>${Number(log.dockToStockMinutes || 0)}</td>
          <td>${escapeHtml(previewLines(lines, (line) => `${line.item || ""} x${line.qty || 0} @ ${line.location || ""}`))}</td>
          <td>${historyActions("putaway", log.id)}</td>
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
      cycle: buildCycleRows,
      picking: buildPickingRows
    };

    const rows = builders[type]?.() || [];
    if (!rows.length) return toast?.("No data to export.");

    downloadCsv(rows, `${type}-history-${todayDate()}.csv`);
  }

  function buildPutawayRows() {
    return filteredRecords("putaway").map((log) => {
      const lines = Array.isArray(log.lines) ? log.lines : [];
      return {
        completedDate: getCompletedDate(log),
        worker: log.worker || "",
        lines: Number(log.lineCount || lines.length || 0),
        totalQty: Number(log.totalQty || sumBy(lines, "qty")),
        dockToStockMinutes: Number(log.dockToStockMinutes || 0),
        details: previewLines(lines, (line) => `${line.item || ""} x${line.qty || 0} @ ${line.location || ""}`)
      };
    });
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
    return `
      <div class="row-actions">
        <button type="button" onclick="openHistoryRecord('${safeType}', '${safeId}', 'view')">View</button>
        <button type="button" onclick="openHistoryRecord('${safeType}', '${safeId}', 'edit')">Edit</button>
        <button type="button" class="danger" onclick="deleteHistoryRecordByKey('${safeType}', '${safeId}')">Delete</button>
      </div>
    `;
  }
})();
