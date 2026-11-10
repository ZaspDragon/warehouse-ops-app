"use strict";

/*
 * Already Cycle Counted import add-on.
 * Combines an Item Number + Initials workbook with the uploaded
 * Cycle Count Detail workbook and credits one count per unique item/bin.
 */

const ALREADY_COUNTED_STORAGE_KEY =
  "cycleCountProduction.alreadyCountedSettings.v1";

const alreadyCountedState = {
  workbook: null,
  fileName: "",
  rows: [],
  matchedRows: [],
  unmatchedRows: [],
  totalsByInitials: {},
  totalsByEmployee: {},
  duplicateCount: 0,
  selectedInitials: "all",
  applied: false,
};

const DEFAULT_INITIALS_BY_NAME = {
  carico: "ch",
  ernie: "eh",
  cherish: "cc",
  layne: "lm",
  madison: "mj",
  antoine: "ah",
  greg: "gr",
  denise: "dw",
};

function acNormalizeItem(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.0$/, "")
    .replace(/\s+/g, "");
}

function acNormalizeInitials(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function acNormalizeBin(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function acGetInitials(assignment) {
  const stored = acNormalizeInitials(assignment?.initials);
  if (stored) return stored;
  return DEFAULT_INITIALS_BY_NAME[
    String(assignment?.name ?? "").trim().toLowerCase()
  ] || "";
}

function acReadSettings() {
  try {
    return JSON.parse(localStorage.getItem(ALREADY_COUNTED_STORAGE_KEY) || "{}") || {};
  } catch (error) {
    console.warn("Could not read already-counted settings.", error);
    return {};
  }
}

function acSaveSettings() {
  const settings = acReadSettings();
  settings.sharePointUrl = $("alreadyCountedSharePointUrl")?.value?.trim() || "";
  settings.initialsByBranch = settings.initialsByBranch || {};
  settings.initialsByBranch[state.selectedBranchId] = Object.fromEntries(
    getAssignments().map((assignment) => [assignment.id, acGetInitials(assignment)])
  );
  localStorage.setItem(ALREADY_COUNTED_STORAGE_KEY, JSON.stringify(settings));
}

function acRestoreSettings() {
  const settings = acReadSettings();
  const input = $("alreadyCountedSharePointUrl");
  if (input && settings.sharePointUrl) input.value = settings.sharePointUrl;

  const savedMap = settings.initialsByBranch?.[state.selectedBranchId] || {};
  let changed = false;
  getAssignments().forEach((assignment) => {
    const saved = acNormalizeInitials(savedMap[assignment.id]);
    if (saved && assignment.initials !== saved) {
      assignment.initials = saved;
      changed = true;
    }
  });
  if (changed) saveBranches();
}

function acBuildDetailItemMap(workbook) {
  const itemBins = new Map();

  workbook.SheetNames.forEach((sheetName) => {
    const matrix = workbookMatrix(workbook, sheetName);
    let currentItem = "";
    let binColumn = -1;

    matrix.forEach((row) => {
      const first = acNormalizeItem(row[0]);
      const firstHeader = normalizeText(row[0]);

      if (/^\d{4,}$/.test(first) && firstHeader !== "total") {
        currentItem = first;
      }

      const detectedBinColumn = row.findIndex((cell) => {
        const text = normalizeText(cell);
        return text === "bin #" || text === "bin" || text.includes("bin #");
      });

      if (detectedBinColumn >= 0) {
        binColumn = detectedBinColumn;
        return;
      }

      if (!currentItem || binColumn < 0) return;

      const bin = acNormalizeBin(row[binColumn]);
      const looksLikeBin =
        bin &&
        !["BIN", "BIN#", "BATCH", "RANK"].includes(bin) &&
        /[A-Z]/.test(bin) &&
        /\d|CAGE/.test(bin);

      if (!looksLikeBin) return;

      if (!itemBins.has(currentItem)) itemBins.set(currentItem, new Set());
      itemBins.get(currentItem).add(bin);
    });
  });

  return itemBins;
}

function acFindAlreadyCountedRows(workbook) {
  const parsed = [];

  workbook.SheetNames.forEach((sheetName) => {
    const matrix = workbookMatrix(workbook, sheetName);
    const headerIndex = findHeaderRow(matrix, ["item number", "initials"], 50);
    const headers = matrix[headerIndex] || [];
    const itemColumn = detectColumn(headers, ["item number", "item num", "item"]);
    const initialsColumn = detectColumn(headers, ["initials", "initial"]);

    if (itemColumn < 0 || initialsColumn < 0) return;

    matrix.slice(headerIndex + 1).forEach((row, offset) => {
      const itemNumber = acNormalizeItem(row[itemColumn]);
      const initials = acNormalizeInitials(row[initialsColumn]);
      if (!itemNumber || !initials) return;
      parsed.push({
        itemNumber,
        initials,
        sheetName,
        rowNumber: headerIndex + offset + 2,
      });
    });
  });

  return parsed;
}

function acMatchFiles() {
  if (!alreadyCountedState.workbook || !state.workbook) {
    acSetStatus("Upload both workbooks to calculate location credit.", true);
    return;
  }

  const detailMap = acBuildDetailItemMap(state.workbook);
  const alreadyRows = acFindAlreadyCountedRows(alreadyCountedState.workbook);
  const seenItemInitials = new Set();
  const matchedRows = [];
  const unmatchedRows = [];
  let duplicates = 0;

  alreadyRows.forEach((row) => {
    const dedupeKey = `${row.itemNumber}|${row.initials}`;
    if (seenItemInitials.has(dedupeKey)) {
      duplicates += 1;
      return;
    }
    seenItemInitials.add(dedupeKey);

    const bins = detailMap.get(row.itemNumber);
    if (!bins || bins.size === 0) {
      unmatchedRows.push({ ...row, reason: "No locations found in Cycle Count Detail" });
      return;
    }

    matchedRows.push({
      ...row,
      bins: [...bins].sort(),
      locationCount: bins.size,
    });
  });

  alreadyCountedState.rows = alreadyRows;
  alreadyCountedState.matchedRows = matchedRows;
  alreadyCountedState.unmatchedRows = unmatchedRows;
  alreadyCountedState.duplicateCount = duplicates;
  alreadyCountedState.totalsByInitials = matchedRows.reduce((totals, row) => {
    totals[row.initials] = (totals[row.initials] || 0) + row.locationCount;
    return totals;
  }, {});
  alreadyCountedState.applied = true;

  acPopulateInitialsFilter();
  acApplyCreditsToProduction();
  acRenderPreview();
  acSetStatus(
    `${matchedRows.length} items matched • ${matchedRows.reduce((sum, row) => sum + row.locationCount, 0)} unique locations credited`,
    false
  );
}

function acApplyCreditsToProduction() {
  const selected = alreadyCountedState.selectedInitials;
  const totalsByEmployee = {};
  const assignments = getAssignments();

  assignments.forEach((assignment) => {
    const initials = acGetInitials(assignment);
    const allowed = selected === "all" || initials === selected;
    const extra = allowed ? Number(alreadyCountedState.totalsByInitials[initials] || 0) : 0;
    totalsByEmployee[assignment.name] = extra;
  });

  alreadyCountedState.totalsByEmployee = totalsByEmployee;

  assignments.forEach((assignment) => {
    const base = Number(state.employeeTotals[assignment.name] || 0);
    const previousExtra = Number(assignment.__alreadyCountedApplied || 0);
    const nextExtra = Number(totalsByEmployee[assignment.name] || 0);
    state.employeeTotals[assignment.name] = Math.max(0, base - previousExtra) + nextExtra;
    assignment.__alreadyCountedApplied = nextExtra;
  });

  if (state.workbook) renderResults();
}

function acPopulateInitialsFilter() {
  const select = $("alreadyCountedInitialsFilter");
  if (!select) return;
  const initials = Object.keys(alreadyCountedState.totalsByInitials).sort();
  select.innerHTML = '<option value="all">All initials</option>' +
    initials.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value.toUpperCase())}</option>`).join("");
  select.value = initials.includes(alreadyCountedState.selectedInitials)
    ? alreadyCountedState.selectedInitials
    : "all";
  alreadyCountedState.selectedInitials = select.value;
}

function acRenderInitialsAssignments() {
  const container = $("initialsAssignmentGrid");
  if (!container) return;

  container.innerHTML = getAssignments().map((assignment) => `
    <label class="initials-map-row">
      <span>${escapeHtml(assignment.name)}</span>
      <input
        type="text"
        maxlength="8"
        value="${escapeHtml(acGetInitials(assignment))}"
        data-assignment-id="${escapeHtml(assignment.id)}"
        aria-label="Initials for ${escapeHtml(assignment.name)}"
      />
    </label>
  `).join("") || "<p>Add team members first.</p>";
}

function acRenderPreview() {
  const preview = $("alreadyCountedPreview");
  if (!preview) return;

  const filter = alreadyCountedState.selectedInitials;
  const rows = alreadyCountedState.matchedRows.filter(
    (row) => filter === "all" || row.initials === filter
  );

  const totals = rows.reduce((sum, row) => sum + row.locationCount, 0);
  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="already-counted-kpis">
      <div><span>Matched items</span><strong>${rows.length}</strong></div>
      <div><span>Unique locations</span><strong>${totals}</strong></div>
      <div><span>Unmatched items</span><strong>${alreadyCountedState.unmatchedRows.length}</strong></div>
      <div><span>Duplicates removed</span><strong>${alreadyCountedState.duplicateCount}</strong></div>
    </div>
    <div class="table-wrap already-counted-table-wrap">
      <table class="history-table">
        <thead><tr><th>Initials</th><th>Item</th><th>Locations</th><th>Bins</th></tr></thead>
        <tbody>
          ${rows.slice(0, 500).map((row) => `
            <tr>
              <td>${escapeHtml(row.initials.toUpperCase())}</td>
              <td>${escapeHtml(row.itemNumber)}</td>
              <td>${row.locationCount}</td>
              <td>${escapeHtml(row.bins.join(", "))}</td>
            </tr>
          `).join("") || '<tr><td colspan="4" class="empty-row">No matching items for this filter.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function acSetStatus(text, isError = false) {
  const status = $("alreadyCountedStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("success", !isError);
  status.classList.toggle("error", isError);
}

function acInstallTeamInitialsHook() {
  const modalForm = $("teamMemberForm");
  const endAisleLabel = $("endAisleInput")?.closest("label");
  if (!modalForm || !endAisleLabel || $("employeeInitialsInput")) return;

  const label = document.createElement("label");
  label.innerHTML = '<span>Employee Initials</span><input id="employeeInitialsInput" type="text" maxlength="8" autocomplete="off" placeholder="Example: CC" />';
  endAisleLabel.insertAdjacentElement("afterend", label);

  const originalOpen = openTeamMemberForm;
  openTeamMemberForm = function patchedOpenTeamMemberForm(assignment = null) {
    originalOpen(assignment);
    const input = $("employeeInitialsInput");
    if (input) input.value = assignment ? acGetInitials(assignment) : "";
  };

  modalForm.addEventListener("submit", () => {
    window.setTimeout(() => {
      const name = $("employeeNameInput")?.value?.trim().toLowerCase();
      const initials = acNormalizeInitials($("employeeInitialsInput")?.value);
      const assignment = getAssignments().find(
        (item) => item.name.trim().toLowerCase() === name
      );
      if (assignment && initials) {
        assignment.initials = initials;
        saveBranches();
        acSaveSettings();
        acRenderInitialsAssignments();
      }
    }, 0);
  });
}

function acInstallCalculationHook() {
  const originalCalculateProduction = calculateProduction;
  calculateProduction = function patchedCalculateProduction() {
    getAssignments().forEach((assignment) => {
      assignment.__alreadyCountedApplied = 0;
    });
    originalCalculateProduction();
    if (alreadyCountedState.applied) acApplyCreditsToProduction();
  };
}

function acBindEvents() {
  $("alreadyCountedFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      alreadyCountedState.workbook = await readWorkbook(file);
      alreadyCountedState.fileName = file.name;
      acSetStatus(`${file.name} loaded. Matching against Cycle Count Detail…`, false);
      acMatchFiles();
    } catch (error) {
      console.error("Could not read Already Cycle Counted workbook.", error);
      acSetStatus("Could not read the Already Cycle Counted workbook.", true);
    }
  });

  $("matchAlreadyCountedBtn")?.addEventListener("click", acMatchFiles);

  $("alreadyCountedInitialsFilter")?.addEventListener("change", (event) => {
    alreadyCountedState.selectedInitials = event.target.value;
    acApplyCreditsToProduction();
    acRenderPreview();
  });

  $("saveSharePointLinkBtn")?.addEventListener("click", () => {
    acSaveSettings();
    acSetStatus("SharePoint link saved on this device.", false);
  });

  $("openSharePointLinkBtn")?.addEventListener("click", () => {
    const url = $("alreadyCountedSharePointUrl")?.value?.trim();
    if (!url || !/^https:\/\//i.test(url)) {
      acSetStatus("Enter a valid SharePoint link first.", true);
      return;
    }
    acSaveSettings();
    window.open(url, "_blank", "noopener,noreferrer");
  });

  $("initialsAssignmentGrid")?.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-assignment-id]");
    if (!input) return;
    const assignment = getAssignments().find((item) => item.id === input.dataset.assignmentId);
    if (!assignment) return;
    assignment.initials = acNormalizeInitials(input.value);
    input.value = assignment.initials;
    saveBranches();
    acSaveSettings();
    if (alreadyCountedState.applied) acApplyCreditsToProduction();
  });

  $("branchSelect")?.addEventListener("change", () => {
    window.setTimeout(() => {
      acRestoreSettings();
      acRenderInitialsAssignments();
    }, 0);
  });
}

function initializeAlreadyCountedImport() {
  acRestoreSettings();
  acInstallTeamInitialsHook();
  acInstallCalculationHook();
  acBindEvents();
  acRenderInitialsAssignments();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAlreadyCountedImport);
} else {
  initializeAlreadyCountedImport();
}
