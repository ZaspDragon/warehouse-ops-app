"use strict";

(() => {
  if (window.__manualOwnershipBridgeLoaded) return;
  window.__manualOwnershipBridgeLoaded = true;

  const STORAGE_KEY = "cycleCountProduction.manualOwnershipBridge.v1";

  function reportKey() {
    const branch = String(getSelectedBranch()?.name || "branch").trim().toUpperCase();
    const date = typeof acGetReportCountDate === "function" ? acGetReportCountDate(state.workbook) : null;
    const dateKey = date instanceof Date && !Number.isNaN(date.getTime())
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : "undated";
    return `${branch}|${dateKey}`;
  }

  function rowKey(item, bin, batch) {
    return [item, bin, batch]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .join("|");
  }

  function readAll() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  window.getManualCycleCountOwner = function getManualCycleCountOwner(row) {
    const all = readAll();
    const employee = all[reportKey()]?.[rowKey(row?.item || row?.itemNumber, row?.bin, row?.batch)] || "";
    if (!employee) return "";
    const assignment = getAssignments().find((item) => item.name === employee);
    if (!assignment) return "";
    if (typeof window.isCycleCountAssignmentAbsent === "function" && window.isCycleCountAssignmentAbsent(assignment)) return "";
    return employee;
  };

  document.addEventListener("change", (event) => {
    const select = event.target?.closest?.("select[data-review-id]");
    if (!select) return;
    const tr = select.closest("tr");
    if (!tr) return;

    const cells = tr.querySelectorAll("td");
    const item = cells[0]?.textContent || "";
    const bin = cells[1]?.textContent || "";
    const batch = cells[2]?.textContent || "";
    const employee = select.value || "";

    const all = readAll();
    const key = reportKey();
    all[key] = all[key] || {};
    const keyForRow = rowKey(item, bin, batch);
    if (employee) all[key][keyForRow] = employee;
    else delete all[key][keyForRow];
    writeAll(all);

    select.dataset.saved = employee ? "true" : "false";
    if (employee) {
      const option = select.options[select.selectedIndex];
      if (option) option.textContent = `${employee} ✓`;
    }

    if (typeof window.recalculateCycleCountOwnership === "function") {
      window.setTimeout(window.recalculateCycleCountOwnership, 0);
      window.setTimeout(window.recalculateCycleCountOwnership, 200);
    }
    if (typeof window.runProductionAccuracyCheck === "function") {
      window.setTimeout(window.runProductionAccuracyCheck, 400);
    }
  }, true);
})();