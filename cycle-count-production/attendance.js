"use strict";

/*
 * Daily attendance and production-goal extension.
 *
 * Attendance is stored separately from branch/team configuration so marking a
 * person absent never deletes their aisle assignment. The storage key includes
 * the local calendar date, which makes every new day start as Present.
 *
 * The "Already Cycle Counted Numbers" assignment is a reference bucket. Its
 * counts remain visible, but it is excluded from the 200-count production goal
 * and from the team production percentage calculation.
 */
(() => {
  const ATTENDANCE_KEY_PREFIX = "cycleCountProduction.attendance.v1";
  const VALID_STATUSES = new Set(["present", "absent"]);
  const NO_GOAL_ASSIGNMENT_NAMES = new Set(["already cycle counted numbers"]);

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizedAssignmentName(assignment) {
    return String(assignment?.name || "").trim().toLowerCase();
  }

  function isNoGoalAssignment(assignment) {
    return NO_GOAL_ASSIGNMENT_NAMES.has(normalizedAssignmentName(assignment));
  }

  function attendanceStorageKey() {
    const branch = getSelectedBranch();
    return `${ATTENDANCE_KEY_PREFIX}.${branch?.id || "no-branch"}.${localDateKey()}`;
  }

  function readAttendance() {
    try {
      const stored = JSON.parse(localStorage.getItem(attendanceStorageKey()) || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch (error) {
      console.error("Unable to read daily attendance.", error);
      return {};
    }
  }

  function writeAttendance(attendance) {
    try {
      localStorage.setItem(attendanceStorageKey(), JSON.stringify(attendance));
      return true;
    } catch (error) {
      console.error("Unable to save daily attendance.", error);
      showTeamMessage("Attendance could not be saved in this browser.", true);
      return false;
    }
  }

  function getAssignmentStatus(assignmentId) {
    const status = readAttendance()[assignmentId];
    return VALID_STATUSES.has(status) ? status : "present";
  }

  window.getCycleCountAssignmentStatus = getAssignmentStatus;
  window.isCycleCountAssignmentAbsent = function isCycleCountAssignmentAbsent(assignmentOrId) {
    const id = typeof assignmentOrId === "object" ? assignmentOrId?.id : assignmentOrId;
    return id ? getAssignmentStatus(id) === "absent" : false;
  };

  function setAssignmentStatus(assignmentId, status) {
    if (!VALID_STATUSES.has(status)) return;

    const attendance = readAttendance();
    attendance[assignmentId] = status;

    if (writeAttendance(attendance)) {
      const assignment = getAssignments().find((item) => item.id === assignmentId);
      showTeamMessage(`${assignment?.name || "Employee"} marked ${status}.`);
    }
  }

  function getDailyAttendanceSnapshot() {
    return Object.fromEntries(
      getAssignments().map((assignment) => [
        assignment.id,
        {
          name: assignment.name,
          status: getAssignmentStatus(assignment.id),
          countsTowardGoal: !isNoGoalAssignment(assignment),
        },
      ])
    );
  }

  function getPresentAssignments() {
    return getAssignments().filter(
      (assignment) => getAssignmentStatus(assignment.id) !== "absent"
    );
  }

  function getGoalEligibleAssignments() {
    return getPresentAssignments().filter(
      (assignment) => !isNoGoalAssignment(assignment)
    );
  }

  function injectAttendanceStyles() {
    if (document.getElementById("attendanceStyles")) return;

    const style = document.createElement("style");
    style.id = "attendanceStyles";
    style.textContent = `
      .attendance-select {
        min-width: 112px;
        padding: 0.5rem 0.65rem;
        border: 1px solid #cbd5e1;
        border-radius: 0.55rem;
        background: #fff;
        font: inherit;
        font-weight: 700;
      }
      .attendance-select[data-status="absent"] {
        border-color: #fca5a5;
        background: #fff1f2;
        color: #b91c1c;
      }
      .summary-card.is-absent,
      .summary-card.is-no-goal {
        border-style: dashed;
        opacity: 0.86;
      }
      .summary-card.is-absent .meter span,
      .summary-card.is-no-goal .meter span {
        width: 0 !important;
      }
      .absent-label,
      .no-goal-label {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.25rem 0.6rem;
        font-weight: 800;
      }
      .absent-label {
        background: #fff1f2;
        color: #b91c1c;
      }
      .no-goal-label {
        background: #eef2ff;
        color: #3730a3;
      }
      .attendance-summary {
        display: block;
        margin-top: 0.2rem;
        color: #64748b;
        font-size: 0.78rem;
      }
    `;
    document.head.appendChild(style);
  }

  const originalRenderAssignments = renderAssignments;
  renderAssignments = function renderAssignmentsWithAttendance() {
    originalRenderAssignments();

    const assignments = getAssignments();
    const rows = Array.from(document.querySelectorAll("#teamBody tr"));

    rows.forEach((row, index) => {
      const assignment = assignments[index];
      if (!assignment) return;

      const status = getAssignmentStatus(assignment.id);
      const cell = document.createElement("td");
      cell.innerHTML = `
        <select
          class="attendance-select"
          data-attendance-id="${escapeHtml(assignment.id)}"
          data-status="${status}"
          aria-label="Daily status for ${escapeHtml(assignment.name)}"
        >
          <option value="present" ${status === "present" ? "selected" : ""}>Present</option>
          <option value="absent" ${status === "absent" ? "selected" : ""}>Absent</option>
        </select>
      `;

      const editCell = row.children[2];
      row.insertBefore(cell, editCell || null);
    });
  };

  const originalUpdateUIFromSelectedBranch = updateUIFromSelectedBranch;
  updateUIFromSelectedBranch = function updateUIWithAttendance() {
    originalUpdateUIFromSelectedBranch();

    const goalUnit = $("dailyGoalUnit");
    if (goalUnit) {
      const presentCount = getPresentAssignments().length;
      const goalCount = getGoalEligibleAssignments().length;
      const totalCount = getAssignments().length;
      goalUnit.textContent = `counts = 100% (${goalCount} production goals • ${presentCount} present of ${totalCount})`;
    }
  };

  const originalRenderResults = renderResults;
  renderResults = function renderResultsWithAttendance() {
    originalRenderResults();
    if (!state.workbook) return;

    const assignments = getAssignments();
    const assignmentByName = new Map(
      assignments.map((assignment) => [assignment.name, assignment])
    );
    const goalAssignments = getGoalEligibleAssignments();
    const goalNames = new Set(goalAssignments.map((assignment) => assignment.name));
    const presentNames = new Set(
      getPresentAssignments().map((assignment) => assignment.name)
    );

    const teamGoal = DAILY_GOAL * goalAssignments.length;
    const productionCounts = goalAssignments.reduce(
      (total, assignment) =>
        total + Number(state.employeeTotals[assignment.name] || 0),
      0
    );
    const teamPercentage =
      teamGoal > 0 ? ((productionCounts / teamGoal) * 100).toFixed(1) : "0.0";

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    if (kpis[2]) {
      const value = kpis[2].querySelector("strong");
      if (value) value.textContent = String(teamGoal);
    }
    if (kpis[3]) {
      const value = kpis[3].querySelector("strong");
      if (value) value.textContent = `${teamPercentage}%`;
    }

    document.querySelectorAll("#productionCards .summary-card").forEach((card) => {
      const name = card.querySelector("strong")?.textContent?.trim();
      const assignment = assignmentByName.get(name);
      if (!name || !assignment) return;

      const percentRow = card.querySelector(".percent-row");

      if (!presentNames.has(name)) {
        card.classList.add("is-absent");
        if (percentRow) {
          percentRow.innerHTML = `
            <span class="absent-label">Absent</span>
            <small>Counts held for reassignment</small>
          `;
        }
        return;
      }

      if (!goalNames.has(name) && isNoGoalAssignment(assignment)) {
        card.classList.add("is-no-goal");
        if (percentRow) {
          percentRow.innerHTML = `
            <span class="no-goal-label">No production goal</span>
            <small>Reference counts only</small>
          `;
        }
      }
    });
  };

  const originalCreateCurrentRecord = createCurrentRecord;
  createCurrentRecord = function createCurrentRecordWithAttendance() {
    const record = originalCreateCurrentRecord();
    const attendance = getDailyAttendanceSnapshot();
    const absentNames = Object.values(attendance)
      .filter((entry) => entry.status === "absent")
      .map((entry) => entry.name);
    const noGoalNames = getAssignments()
      .filter(isNoGoalAssignment)
      .map((assignment) => assignment.name);
    const goalAssignments = getGoalEligibleAssignments();

    return {
      ...record,
      attendanceDate: localDateKey(),
      attendance,
      absentEmployees: absentNames,
      noGoalEmployees: noGoalNames,
      activeEmployeeCount: goalAssignments.length,
      dailyTeamGoal: DAILY_GOAL * goalAssignments.length,
    };
  };

  const originalRenderHistory = renderHistory;
  renderHistory = function renderHistoryWithAttendance() {
    originalRenderHistory();

    const history = loadHistory();
    const rows = Array.from(document.querySelectorAll("#historyBody tr"));

    rows.forEach((row, index) => {
      const record = history[index];
      const firstCell = row.children[0];
      if (!record || !firstCell) return;

      if (Array.isArray(record.absentEmployees) && record.absentEmployees.length > 0) {
        const note = document.createElement("small");
        note.className = "attendance-summary";
        note.textContent = `Absent: ${record.absentEmployees.join(", ")}`;
        firstCell.appendChild(note);
      }

      if (Array.isArray(record.noGoalEmployees) && record.noGoalEmployees.length > 0) {
        const note = document.createElement("small");
        note.className = "attendance-summary";
        note.textContent = `No goal: ${record.noGoalEmployees.join(", ")}`;
        firstCell.appendChild(note);
      }
    });
  };

  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-attendance-id]");
    if (!select) return;

    setAssignmentStatus(select.dataset.attendanceId, select.value);
    select.dataset.status = select.value;
    updateUIFromSelectedBranch();
    renderResults();
    if (typeof window.recalculateCycleCountOwnership === "function") {
      window.setTimeout(window.recalculateCycleCountOwnership, 0);
    }
  });

  injectAttendanceStyles();
})();