"use strict";

/*
 * Cycle Count Production
 *
 * Static GitHub Pages application.
 * Uses localStorage only.
 *
 * No Firebase or external database is required.
 */

const DAILY_GOAL = 200;

const STORAGE_KEYS = {
  branches: "cycleCountProduction.branches.v1",
  currentBranch: "cycleCountProduction.currentBranch.v1",
  selectedBranchLegacy: "cycleCountProduction.selectedBranch.v1",
  snapshots: "cycleCountProduction.snapshots.v3",
};

const DEFAULT_ASSIGNMENTS = [
  {
    id: createId("employee"),
    name: "Carico",
    startAisle: "A",
    endAisle: "B",
  },
  {
    id: createId("employee"),
    name: "Ernie",
    startAisle: "C",
    endAisle: "D",
  },
  {
    id: createId("employee"),
    name: "Cherish",
    startAisle: "E",
    endAisle: "F",
  },
  {
    id: createId("employee"),
    name: "Layne",
    startAisle: "G",
    endAisle: "H",
  },
  {
    id: createId("employee"),
    name: "Madison",
    startAisle: "I",
    endAisle: "J",
  },
  {
    id: createId("employee"),
    name: "Antoine",
    startAisle: "K",
    endAisle: "L",
  },
];

const state = {
  initialized: false,
  branches: [],
  selectedBranchId: null,

  workbook: null,
  rows: [],
  headerIndex: 0,
  aisleTotals: {},
  employeeTotals: {},
  uncreditedRows: [],
  uploadedFileName: "",
};

/*
 * Basic utilities
 */

function $(id) {
  return document.getElementById(id);
}

function createId(prefix = "id") {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9#%]+/g, " ")
    .trim();
}

function safelyOpenDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function safelyCloseDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

/*
 * Messages
 */

function showMessage(elementId, text, isError = false) {
  const element = $(elementId);

  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove("hidden", "error");

  if (isError) {
    element.classList.add("error");
  }

  window.setTimeout(() => {
    element.classList.add("hidden");
  }, 5000);
}

function showBranchMessage(text, isError = false) {
  showMessage("branchMessage", text, isError);
}

function showTeamMessage(text, isError = false) {
  showMessage("teamMessage", text, isError);
}

function showSaveMessage(text, isError = false) {
  showMessage("saveMessage", text, isError);
}

function showAppError(text) {
  const errorBox = $("appError");

  if (!errorBox) {
    return;
  }

  errorBox.textContent = text;
  errorBox.classList.remove("hidden");
}

/*
 * localStorage helpers
 */

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error(`Unable to read localStorage key "${key}".`, error);
    showAppError(
      "Browser storage is unavailable. Changes may not be saved."
    );

    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Unable to save localStorage key "${key}".`, error);
    showAppError(
      "The browser could not save your changes. Check browser storage settings."
    );

    return false;
  }
}

function parseStoredJson(key, fallback) {
  const raw = readStorage(key);

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(
      `Stored information for "${key}" could not be parsed.`,
      error
    );

    /*
     * Important:
     * Do not overwrite or clear the broken value automatically.
     */
    showAppError(
      "Some saved browser data could not be loaded. The original saved data was not deleted."
    );

    return fallback;
  }
}

/*
 * Branch migration and normalization
 */

function normalizeAssignment(rawAssignment) {
  if (!rawAssignment || typeof rawAssignment !== "object") {
    return null;
  }

  const name = String(rawAssignment.name ?? "").trim();
  const startAisle = String(
    rawAssignment.startAisle ??
      rawAssignment.aisles?.[0] ??
      ""
  )
    .trim()
    .toUpperCase();

  const endAisle = String(
    rawAssignment.endAisle ??
      rawAssignment.aisles?.[
        Math.max((rawAssignment.aisles?.length ?? 1) - 1, 0)
      ] ??
      startAisle
  )
    .trim()
    .toUpperCase();

  if (!name || !startAisle || !endAisle) {
    return null;
  }

  return {
    id: String(rawAssignment.id || createId("employee")),
    name,
    startAisle,
    endAisle,
  };
}

function normalizeBranch(rawBranch) {
  if (!rawBranch || typeof rawBranch !== "object") {
    return null;
  }

  const oldEmployees = Array.isArray(rawBranch.employees)
    ? rawBranch.employees
    : [];

  const currentAssignments = Array.isArray(rawBranch.assignments)
    ? rawBranch.assignments
    : [];

  const sourceAssignments =
    currentAssignments.length > 0
      ? currentAssignments
      : oldEmployees;

  const assignments = sourceAssignments
    .map(normalizeAssignment)
    .filter(Boolean);

  return {
    id: String(rawBranch.id || createId("branch")),
    name: String(
      rawBranch.name ||
        rawBranch.branchName ||
        "Unnamed Branch"
    ).trim(),
    expectedInventoryFilename: String(
      rawBranch.expectedInventoryFilename ??
        rawBranch.expectedFilename ??
        ""
    ).trim(),
    assignments,
    dailyGoal: Number(rawBranch.dailyGoal) || DAILY_GOAL,
    createdAt:
      rawBranch.createdAt || new Date().toISOString(),
  };
}

function createDefaultBranch() {
  return {
    id: createId("branch"),
    name: "Main Branch",
    expectedInventoryFilename: "Inventory.xlsx",
    assignments: DEFAULT_ASSIGNMENTS.map((assignment) => ({
      ...assignment,
      id: createId("employee"),
    })),
    dailyGoal: DAILY_GOAL,
    createdAt: new Date().toISOString(),
  };
}

function loadBranches() {
  const stored = parseStoredJson(STORAGE_KEYS.branches, null);

  if (!Array.isArray(stored) || stored.length === 0) {
    return [createDefaultBranch()];
  }

  const normalizedBranches = stored
    .map(normalizeBranch)
    .filter(Boolean);

  if (normalizedBranches.length === 0) {
    return [createDefaultBranch()];
  }

  /*
   * Save the normalized structure after successful parsing.
   * This preserves old employees and expectedFilename data.
   */
  writeStorage(
    STORAGE_KEYS.branches,
    JSON.stringify(normalizedBranches)
  );

  return normalizedBranches;
}

function saveBranches() {
  return writeStorage(
    STORAGE_KEYS.branches,
    JSON.stringify(state.branches)
  );
}

function loadSelectedBranchId() {
  return (
    readStorage(STORAGE_KEYS.currentBranch) ||
    readStorage(STORAGE_KEYS.selectedBranchLegacy) ||
    null
  );
}

function saveSelectedBranchId() {
  if (!state.selectedBranchId) {
    return;
  }

  writeStorage(
    STORAGE_KEYS.currentBranch,
    state.selectedBranchId
  );

  /*
   * Keep legacy selection key synchronized.
   */
  writeStorage(
    STORAGE_KEYS.selectedBranchLegacy,
    state.selectedBranchId
  );
}

function getSelectedBranch() {
  return (
    state.branches.find(
      (branch) => branch.id === state.selectedBranchId
    ) || null
  );
}

function selectBranch(branchId) {
  const exists = state.branches.some(
    (branch) => branch.id === branchId
  );

  if (!exists) {
    return false;
  }

  state.selectedBranchId = branchId;
  saveSelectedBranchId();

  return true;
}

/*
 * Branch actions
 */

function addBranch(name, expectedFilename = "") {
  const normalizedName = String(name).trim();

  if (!normalizedName) {
    return {
      success: false,
      error: "Branch name cannot be empty.",
    };
  }

  const duplicate = state.branches.some(
    (branch) =>
      branch.name.toLowerCase() ===
      normalizedName.toLowerCase()
  );

  if (duplicate) {
    return {
      success: false,
      error: "A branch with this name already exists.",
    };
  }

  const newBranch = {
    id: createId("branch"),
    name: normalizedName,
    expectedInventoryFilename: String(
      expectedFilename
    ).trim(),
    assignments: [],
    dailyGoal: DAILY_GOAL,
    createdAt: new Date().toISOString(),
  };

  state.branches.push(newBranch);
  state.selectedBranchId = newBranch.id;

  saveBranches();
  saveSelectedBranchId();

  return {
    success: true,
    branch: newBranch,
  };
}

function updateBranch(
  branchId,
  name,
  expectedFilename = ""
) {
  const branch = state.branches.find(
    (item) => item.id === branchId
  );

  if (!branch) {
    return {
      success: false,
      error: "Branch could not be found.",
    };
  }

  const normalizedName = String(name).trim();

  if (!normalizedName) {
    return {
      success: false,
      error: "Branch name cannot be empty.",
    };
  }

  const duplicate = state.branches.some(
    (item) =>
      item.id !== branchId &&
      item.name.toLowerCase() ===
        normalizedName.toLowerCase()
  );

  if (duplicate) {
    return {
      success: false,
      error: "A branch with this name already exists.",
    };
  }

  branch.name = normalizedName;
  branch.expectedInventoryFilename = String(
    expectedFilename
  ).trim();

  saveBranches();

  return {
    success: true,
  };
}

function deleteSelectedBranch() {
  if (state.branches.length <= 1) {
    return {
      success: false,
      error: "You must keep at least one branch.",
    };
  }

  const branch = getSelectedBranch();

  if (!branch) {
    return {
      success: false,
      error: "No branch is currently selected.",
    };
  }

  state.branches = state.branches.filter(
    (item) => item.id !== branch.id
  );

  state.selectedBranchId = state.branches[0].id;

  saveBranches();
  saveSelectedBranchId();

  return {
    success: true,
  };
}

/*
 * Aisle and employee assignment utilities
 */

function expandAisleRange(startAisle, endAisle) {
  const start = String(startAisle)
    .trim()
    .toUpperCase();

  const end = String(endAisle)
    .trim()
    .toUpperCase();

  const aisles = [];

  if (
    !/^[A-Z]$/.test(start) ||
    !/^[A-Z]$/.test(end)
  ) {
    return aisles;
  }

  const startCode = start.charCodeAt(0);
  const endCode = end.charCodeAt(0);

  for (
    let code = startCode;
    code <= endCode;
    code += 1
  ) {
    aisles.push(String.fromCharCode(code));
  }

  return aisles;
}

function formatAisleRange(startAisle, endAisle) {
  return startAisle === endAisle
    ? startAisle
    : `${startAisle}–${endAisle}`;
}

function getAssignments() {
  return getSelectedBranch()?.assignments || [];
}

function getAssignedAisles() {
  const assigned = new Set();

  getAssignments().forEach((assignment) => {
    expandAisleRange(
      assignment.startAisle,
      assignment.endAisle
    ).forEach((aisle) => assigned.add(aisle));
  });

  return Array.from(assigned).sort();
}

function validateAssignment(
  name,
  startAisle,
  endAisle,
  excludedAssignmentId = null
) {
  const branch = getSelectedBranch();

  if (!branch) {
    return {
      valid: false,
      error: "No branch is currently selected.",
    };
  }

  const normalizedName = String(name).trim();
  const start = String(startAisle)
    .trim()
    .toUpperCase();

  const end = String(endAisle)
    .trim()
    .toUpperCase();

  if (!normalizedName) {
    return {
      valid: false,
      error: "Employee name is required.",
    };
  }

  if (!start || !end) {
    return {
      valid: false,
      error: "Starting and ending aisles are required.",
    };
  }

  if (
    !/^[A-Z]$/.test(start) ||
    !/^[A-Z]$/.test(end)
  ) {
    return {
      valid: false,
      error: "Aisles must be single letters from A through Z.",
    };
  }

  if (start > end) {
    return {
      valid: false,
      error:
        "Starting aisle cannot come after the ending aisle.",
    };
  }

  const duplicateName = branch.assignments.some(
    (assignment) =>
      assignment.id !== excludedAssignmentId &&
      assignment.name.toLowerCase() ===
        normalizedName.toLowerCase()
  );

  if (duplicateName) {
    return {
      valid: false,
      error: `${normalizedName} already exists in this branch.`,
    };
  }

  const proposedAisles = expandAisleRange(start, end);

  for (const assignment of branch.assignments) {
    if (assignment.id === excludedAssignmentId) {
      continue;
    }

    const existingAisles = expandAisleRange(
      assignment.startAisle,
      assignment.endAisle
    );

    const overlaps = proposedAisles.some((aisle) =>
      existingAisles.includes(aisle)
    );

    if (overlaps) {
      return {
        valid: false,
        error: `The aisle range overlaps with ${assignment.name}.`,
      };
    }
  }

  return {
    valid: true,
    name: normalizedName,
    startAisle: start,
    endAisle: end,
  };
}

function addAssignment(name, startAisle, endAisle) {
  const branch = getSelectedBranch();

  if (!branch) {
    return {
      success: false,
      error: "No branch is currently selected.",
    };
  }

  const validation = validateAssignment(
    name,
    startAisle,
    endAisle
  );

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  branch.assignments.push({
    id: createId("employee"),
    name: validation.name,
    startAisle: validation.startAisle,
    endAisle: validation.endAisle,
  });

  saveBranches();

  return {
    success: true,
  };
}

function updateAssignment(
  assignmentId,
  name,
  startAisle,
  endAisle
) {
  const branch = getSelectedBranch();

  if (!branch) {
    return {
      success: false,
      error: "No branch is currently selected.",
    };
  }

  const assignment = branch.assignments.find(
    (item) => item.id === assignmentId
  );

  if (!assignment) {
    return {
      success: false,
      error: "Employee could not be found.",
    };
  }

  const validation = validateAssignment(
    name,
    startAisle,
    endAisle,
    assignmentId
  );

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  assignment.name = validation.name;
  assignment.startAisle = validation.startAisle;
  assignment.endAisle = validation.endAisle;

  saveBranches();

  return {
    success: true,
  };
}

function deleteAssignment(assignmentId) {
  const branch = getSelectedBranch();

  if (!branch) {
    return {
      success: false,
      error: "No branch is currently selected.",
    };
  }

  const assignment = branch.assignments.find(
    (item) => item.id === assignmentId
  );

  if (!assignment) {
    return {
      success: false,
      error: "Employee could not be found.",
    };
  }

  const confirmed = window.confirm(
    `Remove ${assignment.name} from this branch?`
  );

  if (!confirmed) {
    return {
      success: false,
      cancelled: true,
    };
  }

  branch.assignments = branch.assignments.filter(
    (item) => item.id !== assignmentId
  );

  saveBranches();

  return {
    success: true,
  };
}

/*
 * UI rendering
 */

function renderBranchDropdown() {
  const select = $("branchSelect");

  if (!select) {
    return;
  }

  select.innerHTML = state.branches
    .map(
      (branch) => `
        <option
          value="${escapeHtml(branch.id)}"
          ${
            branch.id === state.selectedBranchId
              ? "selected"
              : ""
          }
        >
          ${escapeHtml(branch.name)}
        </option>
      `
    )
    .join("");
}

function renderAssignments() {
  const body = $("teamBody");
  const assignments = getAssignments();

  if (!body) {
    return;
  }

  if (assignments.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="empty-row">
          No team members. Add one to get started.
        </td>
      </tr>
    `;

    renderAssignmentGrid();
    return;
  }

  body.innerHTML = assignments
    .map(
      (assignment) => `
        <tr>
          <td>${escapeHtml(assignment.name)}</td>

          <td>
            ${escapeHtml(
              formatAisleRange(
                assignment.startAisle,
                assignment.endAisle
              )
            )}
          </td>

          <td>
            <button
              type="button"
              class="team-edit-btn secondary small"
              data-assignment-id="${escapeHtml(
                assignment.id
              )}"
            >
              Edit
            </button>
          </td>

          <td>
            <button
              type="button"
              class="team-delete-btn secondary small danger"
              data-assignment-id="${escapeHtml(
                assignment.id
              )}"
            >
              Delete
            </button>
          </td>
        </tr>
      `
    )
    .join("");

  renderAssignmentGrid();
}

function renderAssignmentGrid() {
  const grid = $("assignmentGrid");
  const assignments = getAssignments();

  if (!grid) {
    return;
  }

  if (assignments.length === 0) {
    grid.innerHTML = `
      <div class="empty-assignments">
        No team members assigned.
      </div>
    `;

    return;
  }

  grid.innerHTML = assignments
    .map(
      (assignment) => `
        <div>
          <strong>${escapeHtml(assignment.name)}</strong>

          <span>
            ${escapeHtml(
              formatAisleRange(
                assignment.startAisle,
                assignment.endAisle
              )
            )}
          </span>
        </div>
      `
    )
    .join("");
}

function updateUIFromSelectedBranch() {
  const branch = getSelectedBranch();

  if (!branch) {
    showAppError(
      "No valid branch could be loaded."
    );

    return;
  }

  renderBranchDropdown();
  renderAssignments();

  const goalDisplay = $("dailyGoalDisplay");
  const goalUnit = $("dailyGoalUnit");
  const expectedFilename = $("expectedFilename");

  if (goalDisplay) {
    goalDisplay.textContent = String(
      branch.dailyGoal || DAILY_GOAL
    );
  }

  if (goalUnit) {
    goalUnit.textContent =
      `counts = 100% (${branch.assignments.length} employees)`;
  }

  if (expectedFilename) {
    if (branch.expectedInventoryFilename) {
      expectedFilename.innerHTML = `
        <strong>Expected file:</strong>
        ${escapeHtml(
          branch.expectedInventoryFilename
        )}
        <br>
        <span>
          The app uses the Batch column and credits batches such as A-09-12.
        </span>
      `;
    } else {
      expectedFilename.textContent =
        "The app uses the Batch column and credits batches such as A-09-12.";
    }
  }
}

/*
 * Modal forms
 */

function openBranchForm(mode) {
  const modal = $("branchModal");
  const form = $("branchForm");
  const title = $("branchModalTitle");
  const nameInput = $("branchNameInput");
  const filenameInput = $("expectedFilenameInput");

  if (
    !modal ||
    !form ||
    !title ||
    !nameInput ||
    !filenameInput
  ) {
    return;
  }

  form.reset();
  form.dataset.mode = mode;
  form.dataset.branchId = "";

  if (mode === "edit") {
    const branch = getSelectedBranch();

    if (!branch) {
      showBranchMessage(
        "No branch is selected.",
        true
      );

      return;
    }

    title.textContent = "Edit Branch";
    nameInput.value = branch.name;
    filenameInput.value =
      branch.expectedInventoryFilename || "";

    form.dataset.branchId = branch.id;
  } else {
    title.textContent = "Add Branch";
  }

  safelyOpenDialog(modal);

  window.setTimeout(() => {
    nameInput.focus();
  }, 50);
}

function openTeamMemberForm(assignment = null) {
  const modal = $("teamMemberModal");
  const form = $("teamMemberForm");
  const title = $("teamMemberModalTitle");
  const nameInput = $("employeeNameInput");
  const startInput = $("startAisleInput");
  const endInput = $("endAisleInput");

  if (
    !modal ||
    !form ||
    !title ||
    !nameInput ||
    !startInput ||
    !endInput
  ) {
    return;
  }

  form.reset();
  form.dataset.assignmentId = "";

  if (assignment) {
    title.textContent = "Edit Team Member";
    form.dataset.mode = "edit";
    form.dataset.assignmentId = assignment.id;

    nameInput.value = assignment.name;
    startInput.value = assignment.startAisle;
    endInput.value = assignment.endAisle;
  } else {
    title.textContent = "Add Team Member";
    form.dataset.mode = "add";
  }

  safelyOpenDialog(modal);

  window.setTimeout(() => {
    nameInput.focus();
  }, 50);
}

/*
 * Production state
 */

function clearProductionState() {
  state.workbook = null;
  state.rows = [];
  state.headerIndex = 0;
  state.aisleTotals = {};
  state.employeeTotals = {};
  state.uncreditedRows = [];
  state.uploadedFileName = "";

  const fileInput = $("sourceFile");
  const results = $("resultsSection");
  const controls = $("sourceControls");
  const status = $("sourceStatus");

  if (fileInput) {
    fileInput.value = "";
  }

  if (results) {
    results.classList.add("hidden");
  }

  if (controls) {
    controls.classList.add("hidden");
  }

  if (status) {
    status.textContent = "Waiting for file";
    status.classList.remove("success");
  }
}

/*
 * Excel file handling
 */

function readWorkbook(file) {
  return file.arrayBuffer().then((buffer) =>
    XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellStyles: true,
    })
  );
}

function workbookMatrix(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(
    workbook.Sheets[sheetName],
    {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    }
  );
}

function setSelectOptions(
  select,
  options,
  selectedValue = ""
) {
  if (!select) {
    return;
  }

  select.innerHTML = "";

  options.forEach(({ value, label }) => {
    const option = document.createElement("option");

    option.value = String(value);
    option.textContent = String(label);
    option.selected =
      String(value) === String(selectedValue);

    select.appendChild(option);
  });
}

function findHeaderRow(
  matrix,
  keywords,
  maximumRows = 25
) {
  let bestIndex = 0;
  let bestScore = -1;

  matrix
    .slice(0, maximumRows)
    .forEach((row, index) => {
      const cells = row.map(normalizeText);

      const score = keywords.reduce(
        (total, keyword) =>
          total +
          (cells.some((cell) =>
            cell.includes(keyword)
          )
            ? 1
            : 0),
        0
      );

      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });

  return bestIndex;
}

function detectColumn(headers, possibleNames) {
  const normalizedHeaders =
    headers.map(normalizeText);

  const exactIndex =
    normalizedHeaders.findIndex((header) =>
      possibleNames.includes(header)
    );

  if (exactIndex >= 0) {
    return exactIndex;
  }

  return normalizedHeaders.findIndex((header) =>
    possibleNames.some((name) =>
      header.includes(name)
    )
  );
}

function parseCreatedBatch(value) {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();

  /*
   * Accept:
   * A-09-12
   * AA-09-12, although the first letter is used
   */
  const match = text.match(/^([A-Z])(?:[A-Z])?-\d{2}-\d{2}$/);

  return match ? match[1] : null;
}

function loadSelectedSheet() {
  if (!state.workbook) {
    return;
  }

  const sheetSelect = $("sourceSheet");
  const batchSelect = $("batchColumn");

  if (!sheetSelect || !batchSelect) {
    return;
  }

  const matrix = workbookMatrix(
    state.workbook,
    sheetSelect.value
  );

  const headerIndex = findHeaderRow(
    matrix,
    ["batch", "bin", "count date"]
  );

  const headers = matrix[headerIndex] || [];

  const options = headers.map(
    (header, index) => ({
      value: index,
      label:
        `${XLSX.utils.encode_col(index)} — ` +
        `${header || "(blank header)"}`,
    })
  );

  let detectedColumn = detectColumn(headers, [
    "batch",
  ]);

  if (detectedColumn < 0) {
    detectedColumn = detectColumn(headers, [
      "bin #",
      "bin",
    ]);
  }

  if (detectedColumn < 0) {
    detectedColumn = 0;
  }

  setSelectOptions(
    batchSelect,
    options,
    detectedColumn
  );

  state.headerIndex = headerIndex;
  state.rows = matrix.slice(headerIndex + 1);

  calculateProduction();
}

function calculateProduction() {
  const batchSelect = $("batchColumn");
  const assignments = getAssignments();
  const assignedAisles = getAssignedAisles();

  state.aisleTotals = Object.fromEntries(
    assignedAisles.map((aisle) => [aisle, 0])
  );

  state.employeeTotals = Object.fromEntries(
    assignments.map((assignment) => [
      assignment.name,
      0,
    ])
  );

  state.uncreditedRows = [];

  if (
    state.rows.length > 0 &&
    batchSelect &&
    batchSelect.value !== ""
  ) {
    const columnIndex = Number(
      batchSelect.value
    );

    state.rows.forEach((row, offset) => {
      const batch = String(
        row[columnIndex] ?? ""
      ).trim();

      if (!batch) {
        return;
      }

      const aisle = parseCreatedBatch(batch);

      if (
        aisle &&
        assignedAisles.includes(aisle)
      ) {
        state.aisleTotals[aisle] += 1;
        return;
      }

      state.uncreditedRows.push({
        row: state.headerIndex + offset + 2,
        batch,
        reason: aisle
          ? `Aisle ${aisle} is not assigned to an employee`
          : "Invalid batch format. Expected A-00-00.",
      });
    });
  }

  assignments.forEach((assignment) => {
    const aisles = expandAisleRange(
      assignment.startAisle,
      assignment.endAisle
    );

    state.employeeTotals[assignment.name] =
      aisles.reduce(
        (total, aisle) =>
          total +
          (state.aisleTotals[aisle] || 0),
        0
      );
  });

  renderResults();
}

function renderResults() {
  if (!state.workbook) {
    return;
  }

  const assignments = getAssignments();

  const credited = Object.values(
    state.aisleTotals
  ).reduce(
    (total, count) => total + Number(count),
    0
  );

  const uncredited =
    state.uncreditedRows.length;

  const teamGoal =
    DAILY_GOAL * assignments.length;

  const results = $("resultsSection");
  const summary = $("recordSummary");
  const kpis = $("kpiStrip");
  const cards = $("productionCards");
  const details = $("reviewDetails");
  const reviewCount = $("reviewCount");
  const reviewList = $("reviewList");

  results?.classList.remove("hidden");

  if (summary) {
    summary.textContent =
      `${credited} credited • ${uncredited} uncredited`;
  }

  if (kpis) {
    const teamPercentage =
      teamGoal > 0
        ? ((credited / teamGoal) * 100).toFixed(1)
        : "0.0";

    kpis.innerHTML = `
      <div class="kpi">
        <span>Credited Created Counts</span>
        <strong>${credited}</strong>
      </div>

      <div class="kpi">
        <span>Uncredited Rows</span>
        <strong>${uncredited}</strong>
      </div>

      <div class="kpi">
        <span>Daily Team Goal</span>
        <strong>${teamGoal}</strong>
      </div>

      <div class="kpi">
        <span>Team Production</span>
        <strong>${teamPercentage}%</strong>
      </div>
    `;
  }

  if (cards) {
    if (assignments.length === 0) {
      cards.innerHTML = `
        <div class="empty-assignments">
          Add team members before calculating production.
        </div>
      `;
    } else {
      cards.innerHTML = assignments
        .map((assignment) => {
          const total =
            state.employeeTotals[
              assignment.name
            ] || 0;

          const percentage =
            (total / DAILY_GOAL) * 100;

          const aisles = expandAisleRange(
            assignment.startAisle,
            assignment.endAisle
          );

          const breakdown = aisles
            .map(
              (aisle) =>
                `${aisle}: ${
                  state.aisleTotals[aisle] || 0
                }`
            )
            .join(" • ");

          return `
            <article class="summary-card">
              <div class="summary-card-top">
                <div>
                  <strong>
                    ${escapeHtml(assignment.name)}
                  </strong>

                  <span>
                    ${escapeHtml(breakdown)}
                  </span>
                </div>

                <b>${total}</b>
              </div>

              <div class="meter">
                <span
                  style="width:${Math.min(
                    percentage,
                    100
                  )}%"
                ></span>
              </div>

              <div class="percent-row">
                <span>
                  ${percentage.toFixed(1)}%
                </span>

                <small>
                  ${
                    total - DAILY_GOAL >= 0
                      ? "+"
                      : ""
                  }${total - DAILY_GOAL} vs goal
                </small>
              </div>
            </article>
          `;
        })
        .join("");
    }
  }

  if (
    details &&
    reviewCount &&
    reviewList
  ) {
    if (uncredited > 0) {
      details.classList.remove("hidden");
      reviewCount.textContent =
        String(uncredited);

      reviewList.innerHTML =
        state.uncreditedRows
          .slice(0, 300)
          .map(
            (item) => `
              <div>
                <span>Row ${item.row}</span>
                <strong>${escapeHtml(
                  item.batch
                )}</strong>
                <small>${escapeHtml(
                  item.reason
                )}</small>
              </div>
            `
          )
          .join("");
    } else {
      details.classList.add("hidden");
      reviewList.innerHTML = "";
    }
  }
}

/*
 * Snapshot history
 */

function loadHistory() {
  const history = parseStoredJson(
    STORAGE_KEYS.snapshots,
    []
  );

  return Array.isArray(history)
    ? history
    : [];
}

function saveHistory(history) {
  return writeStorage(
    STORAGE_KEYS.snapshots,
    JSON.stringify(history)
  );
}

function createCurrentRecord() {
  const branch = getSelectedBranch();

  return {
    id: createId("snapshot"),
    savedAt: new Date().toISOString(),
    branchId: branch?.id || null,
    branchName: branch?.name || "",
    aisleTotals: {
      ...state.aisleTotals,
    },
    employeeTotals: {
      ...state.employeeTotals,
    },
    uncreditedCount:
      state.uncreditedRows.length,
    uploadedFileName:
      state.uploadedFileName,
  };
}

function saveSnapshot() {
  if (!state.workbook) {
    showSaveMessage(
      "Upload and process an Excel file first.",
      true
    );

    return;
  }

  const history = loadHistory();
  const record = createCurrentRecord();

  history.unshift(record);

  saveHistory(history.slice(0, 100));
  renderHistory();

  showSaveMessage(
    `Results saved at ${new Date(
      record.savedAt
    ).toLocaleString()}.`
  );
}

function deleteSnapshot(snapshotId) {
  const confirmed = window.confirm(
    "Delete this saved result?"
  );

  if (!confirmed) {
    return;
  }

  const updatedHistory = loadHistory().filter(
    (record) => record.id !== snapshotId
  );

  saveHistory(updatedHistory);
  renderHistory();
}

function renderHistory() {
  const body = $("historyBody");

  if (!body) {
    return;
  }

  const history = loadHistory();

  if (history.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="4" class="empty-row">
          No saved results yet.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = history
    .map((record) => {
      const total = Object.values(
        record.employeeTotals || {}
      ).reduce(
        (sum, count) =>
          sum + Number(count || 0),
        0
      );

      return `
        <tr>
          <td>
            ${escapeHtml(
              new Date(
                record.savedAt
              ).toLocaleString()
            )}

            ${
              record.branchName
                ? `<small> (${escapeHtml(
                    record.branchName
                  )})</small>`
                : ""
            }
          </td>

          <td>${total}</td>

          <td>
            ${Number(
              record.uncreditedCount || 0
            )}
          </td>

          <td>
            <button
              type="button"
              class="secondary small danger"
              data-delete-snapshot-id="${escapeHtml(
                record.id
              )}"
            >
              Delete
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

/*
 * Excel export
 */

function downloadSummary() {
  if (!state.workbook) {
    showSaveMessage(
      "Upload and process an Excel file first.",
      true
    );

    return;
  }

  if (
    typeof XLSX === "undefined"
  ) {
    showSaveMessage(
      "The Excel library did not load.",
      true
    );

    return;
  }

  const assignments = getAssignments();
  const assignedAisles =
    getAssignedAisles();

  if (assignments.length === 0) {
    showSaveMessage(
      "Add team members before downloading a summary.",
      true
    );

    return;
  }

  const employeeRows =
    assignments.map((assignment) => {
      const total =
        state.employeeTotals[
          assignment.name
        ] || 0;

      const aisles = expandAisleRange(
        assignment.startAisle,
        assignment.endAisle
      );

      return {
        Employee: assignment.name,
        "Assigned Aisles":
          formatAisleRange(
            assignment.startAisle,
            assignment.endAisle
          ),
        "Aisle Breakdown": aisles
          .map(
            (aisle) =>
              `${aisle}: ${
                state.aisleTotals[aisle] || 0
              }`
          )
          .join(" | "),
        "Cycle Counts": total,
        "Production %":
          total / DAILY_GOAL,
        "Daily Goal": DAILY_GOAL,
      };
    });

  const aisleRows =
    assignedAisles.map((aisle) => ({
      Aisle: aisle,
      "Cycle Counts":
        state.aisleTotals[aisle] || 0,
    }));

  const workbook =
    XLSX.utils.book_new();

  const employeeSheet =
    XLSX.utils.json_to_sheet(
      employeeRows
    );

  employeeRows.forEach(
    (_row, index) => {
      const cell =
        employeeSheet[`E${index + 2}`];

      if (cell) {
        cell.z = "0.0%";
      }
    }
  );

  employeeSheet["!cols"] = [
    { wch: 20 },
    { wch: 18 },
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
  ];

  XLSX.utils.book_append_sheet(
    workbook,
    employeeSheet,
    "Employee Production"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      aisleRows
    ),
    "Aisle Totals"
  );

  if (
    state.uncreditedRows.length > 0
  ) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        state.uncreditedRows
      ),
      "Uncredited Rows"
    );
  }

  const branch = getSelectedBranch();

  const safeBranchName = String(
    branch?.name || "Branch"
  ).replace(/[^a-z0-9]+/gi, "_");

  const timestamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .slice(0, 16);

  XLSX.writeFile(
    workbook,
    `Cycle_Count_${safeBranchName}_${timestamp}.xlsx`
  );
}

/*
 * Event handling
 */

function setupEventListeners() {
  $("branchSelect")?.addEventListener(
    "change",
    (event) => {
      selectBranch(event.target.value);
      clearProductionState();
      updateUIFromSelectedBranch();
    }
  );

  $("addBranchBtn")?.addEventListener(
    "click",
    () => {
      openBranchForm("add");
    }
  );

  $("renameBranchBtn")?.addEventListener(
    "click",
    () => {
      openBranchForm("edit");
    }
  );

  $("deleteBranchBtn")?.addEventListener(
    "click",
    () => {
      const branch = getSelectedBranch();

      if (!branch) {
        showBranchMessage(
          "No branch is selected.",
          true
        );

        return;
      }

      const confirmed = window.confirm(
        `Delete branch "${branch.name}"?\n\nSaved snapshots will not be deleted.`
      );

      if (!confirmed) {
        return;
      }

      const result =
        deleteSelectedBranch();

      if (!result.success) {
        showBranchMessage(
          result.error,
          true
        );

        return;
      }

      clearProductionState();
      updateUIFromSelectedBranch();

      showBranchMessage(
        "Branch deleted successfully."
      );
    }
  );

  $("branchForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const form = event.currentTarget;

      const name =
        $("branchNameInput")?.value || "";

      const expectedFilename =
        $("expectedFilenameInput")?.value ||
        "";

      let result;

      if (
        form.dataset.mode === "edit"
      ) {
        result = updateBranch(
          form.dataset.branchId,
          name,
          expectedFilename
        );
      } else {
        result = addBranch(
          name,
          expectedFilename
        );
      }

      if (!result.success) {
        showBranchMessage(
          result.error,
          true
        );

        return;
      }

      safelyCloseDialog(
        $("branchModal")
      );

      clearProductionState();
      updateUIFromSelectedBranch();

      showBranchMessage(
        form.dataset.mode === "edit"
          ? "Branch updated successfully."
          : "Branch added successfully."
      );
    }
  );

  $("branchCancel")?.addEventListener(
    "click",
    () => {
      safelyCloseDialog(
        $("branchModal")
      );
    }
  );

  $("addTeamMemberBtn")?.addEventListener(
    "click",
    () => {
      openTeamMemberForm();
    }
  );

  $("teamBody")?.addEventListener(
    "click",
    (event) => {
      const editButton =
        event.target.closest(
          ".team-edit-btn"
        );

      if (editButton) {
        const assignment =
          getAssignments().find(
            (item) =>
              item.id ===
              editButton.dataset.assignmentId
          );

        if (assignment) {
          openTeamMemberForm(
            assignment
          );
        }

        return;
      }

      const deleteButton =
        event.target.closest(
          ".team-delete-btn"
        );

      if (deleteButton) {
        const result =
          deleteAssignment(
            deleteButton.dataset
              .assignmentId
          );

        if (
          !result.success &&
          !result.cancelled
        ) {
          showTeamMessage(
            result.error,
            true
          );

          return;
        }

        if (result.success) {
          clearProductionState();
          updateUIFromSelectedBranch();

          showTeamMessage(
            "Team member removed."
          );
        }
      }
    }
  );

  $("teamMemberForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const form = event.currentTarget;

      const name =
        $("employeeNameInput")?.value ||
        "";

      const startAisle =
        $("startAisleInput")?.value ||
        "";

      const endAisle =
        $("endAisleInput")?.value ||
        "";

      let result;

      if (
        form.dataset.mode === "edit"
      ) {
        result = updateAssignment(
          form.dataset.assignmentId,
          name,
          startAisle,
          endAisle
        );
      } else {
        result = addAssignment(
          name,
          startAisle,
          endAisle
        );
      }

      if (!result.success) {
        showTeamMessage(
          result.error,
          true
        );

        return;
      }

      safelyCloseDialog(
        $("teamMemberModal")
      );

      clearProductionState();
      updateUIFromSelectedBranch();

      showTeamMessage(
        form.dataset.mode === "edit"
          ? "Team member updated."
          : "Team member added."
      );
    }
  );

  $("teamMemberCancel")?.addEventListener(
    "click",
    () => {
      safelyCloseDialog(
        $("teamMemberModal")
      );
    }
  );

  $("sourceFile")?.addEventListener(
    "change",
    async (event) => {
      const file =
        event.target.files?.[0];

      if (!file) {
        return;
      }

      try {
        if (
          typeof XLSX === "undefined"
        ) {
          throw new Error(
            "SheetJS did not load."
          );
        }

        state.workbook =
          await readWorkbook(file);

        state.uploadedFileName =
          file.name;

        const sheetSelect =
          $("sourceSheet");

        setSelectOptions(
          sheetSelect,
          state.workbook.SheetNames.map(
            (sheetName) => ({
              value: sheetName,
              label: sheetName,
            })
          )
        );

        loadSelectedSheet();

        $("sourceControls")?.classList.remove(
          "hidden"
        );

        const status =
          $("sourceStatus");

        if (status) {
          status.textContent =
            `${file.name} loaded`;
          status.classList.add(
            "success"
          );
        }
      } catch (error) {
        console.error(
          "Unable to read Excel file.",
          error
        );

        const status =
          $("sourceStatus");

        if (status) {
          status.textContent =
            "Could not read the selected file.";
          status.classList.remove(
            "success"
          );
        }
      }
    }
  );

  $("sourceSheet")?.addEventListener(
    "change",
    loadSelectedSheet
  );

  $("batchColumn")?.addEventListener(
    "change",
    calculateProduction
  );

  $("saveSnapshotBtn")?.addEventListener(
    "click",
    saveSnapshot
  );

  $("downloadSummaryBtn")?.addEventListener(
    "click",
    downloadSummary
  );

  $("historyBody")?.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-delete-snapshot-id]"
        );

      if (!button) {
        return;
      }

      deleteSnapshot(
        button.dataset
          .deleteSnapshotId
      );
    }
  );
}

/*
 * Startup and error handling
 */

function initializeApp() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  try {
    state.branches = loadBranches();

    const storedBranchId =
      loadSelectedBranchId();

    const storedBranchExists =
      state.branches.some(
        (branch) =>
          branch.id === storedBranchId
      );

    state.selectedBranchId =
      storedBranchExists
        ? storedBranchId
        : state.branches[0]?.id || null;

    saveSelectedBranchId();

    renderHistory();
    updateUIFromSelectedBranch();
    setupEventListeners();
  } catch (error) {
    console.error(
      "Application initialization failed.",
      error
    );

    showAppError(
      "The page could not finish loading. Open the browser console for details."
    );
  }
}

window.addEventListener(
  "error",
  (event) => {
    console.error(
      "Unexpected application error:",
      event.error || event.message
    );

    showAppError(
      "An unexpected page error occurred. Refresh the page after checking the browser console."
    );
  }
);

window.addEventListener(
  "unhandledrejection",
  (event) => {
    console.error(
      "Unhandled promise rejection:",
      event.reason
    );

    showAppError(
      "A page operation failed unexpectedly. Check the browser console for details."
    );
  }
);

if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp,
    { once: true }
  );
} else {
  initializeApp();
}
