"use strict";

/* Per-employee production goals. Loaded last so it can extend existing behavior. */
(() => {
  const DEFAULT_GOAL = 200;
  const REFERENCE_NAME = "already cycle counted numbers";

  function normalizedName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isReference(assignment) {
    return normalizedName(assignment?.name) === REFERENCE_NAME;
  }

  function isAbsent(assignment) {
    return typeof window.isCycleCountAssignmentAbsent === "function"
      ? window.isCycleCountAssignmentAbsent(assignment)
      : false;
  }

  function normalizeGoal(value, fallback = DEFAULT_GOAL) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1 || number > 10000) return fallback;
    return Math.round(number);
  }

  function assignmentGoal(assignment) {
    return isReference(assignment) ? 0 : normalizeGoal(assignment?.dailyGoal, DEFAULT_GOAL);
  }

  const originalNormalizeAssignment = normalizeAssignment;
  normalizeAssignment = function normalizeAssignmentWithGoal(rawAssignment) {
    const assignment = originalNormalizeAssignment(rawAssignment);
    if (!assignment) return null;
    assignment.dailyGoal = isReference(assignment)
      ? 0
      : normalizeGoal(rawAssignment?.dailyGoal, DEFAULT_GOAL);
    return assignment;
  };

  function selectedGoal() {
    return normalizeGoal($("employeeGoalInput")?.value, DEFAULT_GOAL);
  }

  const originalAddAssignment = addAssignment;
  addAssignment = function addAssignmentWithGoal(name, startAisle, endAisle) {
    const result = originalAddAssignment(name, startAisle, endAisle);
    if (result.success) {
      const assignment = getAssignments().find(
        (item) => normalizedName(item.name) === normalizedName(name)
      );
      if (assignment) {
        assignment.dailyGoal = isReference(assignment) ? 0 : selectedGoal();
        saveBranches();
      }
    }
    return result;
  };

  const originalUpdateAssignment = updateAssignment;
  updateAssignment = function updateAssignmentWithGoal(assignmentId, name, startAisle, endAisle) {
    const result = originalUpdateAssignment(assignmentId, name, startAisle, endAisle);
    if (result.success) {
      const assignment = getAssignments().find((item) => item.id === assignmentId);
      if (assignment) {
        assignment.dailyGoal = isReference(assignment) ? 0 : selectedGoal();
        saveBranches();
      }
    }
    return result;
  };

  const originalOpenTeamMemberForm = openTeamMemberForm;
  openTeamMemberForm = function openTeamMemberFormWithGoal(assignment = null) {
    originalOpenTeamMemberForm(assignment);
    window.setTimeout(() => {
      const goalInput = $("employeeGoalInput");
      const reference = isReference(assignment || { name: $("employeeNameInput")?.value });
      if (!goalInput) return;
      goalInput.value = String(reference ? 0 : assignmentGoal(assignment || {}));
      goalInput.disabled = reference;
      goalInput.required = !reference;
    }, 0);
  };

  document.addEventListener("input", (event) => {
    if (event.target?.id !== "employeeNameInput") return;
    const goalInput = $("employeeGoalInput");
    if (!goalInput) return;
    const reference = normalizedName(event.target.value) === REFERENCE_NAME;
    goalInput.disabled = reference;
    goalInput.required = !reference;
    if (reference) goalInput.value = "0";
    else if (Number(goalInput.value) < 1) goalInput.value = String(DEFAULT_GOAL);
  });

  const originalRenderAssignments = renderAssignments;
  renderAssignments = function renderAssignmentsWithGoals() {
    originalRenderAssignments();
    const assignments = getAssignments();
    const rows = Array.from(document.querySelectorAll("#teamBody tr"));
    rows.forEach((row, index) => {
      const assignment = assignments[index];
      if (!assignment || !row.children[1]) return;
      const note = document.createElement("small");
      note.style.display = "block";
      note.style.color = "#64748b";
      note.textContent = isReference(assignment)
        ? "Reference only — no goal"
        : `Goal: ${assignmentGoal(assignment)}`;
      row.children[1].appendChild(note);
    });
  };

  const originalRenderResults = renderResults;
  renderResults = function renderResultsWithIndividualGoals() {
    originalRenderResults();
    if (!state.workbook) return;

    const assignments = getAssignments();
    const assignmentByName = new Map(assignments.map((item) => [item.name, item]));
    const cards = Array.from(document.querySelectorAll("#productionCards .summary-card"));
    let teamGoal = 0;
    let teamCounts = 0;

    cards.forEach((card) => {
      const name = card.querySelector("strong")?.textContent?.trim();
      const assignment = assignmentByName.get(name);
      if (!assignment || isReference(assignment) || isAbsent(assignment)) return;

      const goal = assignmentGoal(assignment);
      const total = Number(state.employeeTotals[assignment.name] || 0);
      const percentage = goal > 0 ? (total / goal) * 100 : 0;
      teamGoal += goal;
      teamCounts += total;

      const meter = card.querySelector(".meter span");
      if (meter) meter.style.width = `${Math.min(percentage, 100)}%`;

      const percentRow = card.querySelector(".percent-row");
      if (percentRow) {
        const difference = total - goal;
        percentRow.innerHTML = `
          <span>${percentage.toFixed(1)}%</span>
          <small>${difference >= 0 ? "+" : ""}${difference} vs goal ${goal}</small>
        `;
      }
    });

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    if (kpis[2]?.querySelector("strong")) kpis[2].querySelector("strong").textContent = String(teamGoal);
    if (kpis[3]?.querySelector("strong")) {
      const percent = teamGoal > 0 ? ((teamCounts / teamGoal) * 100).toFixed(1) : "0.0";
      kpis[3].querySelector("strong").textContent = `${percent}%`;
    }
  };

  const originalCreateCurrentRecord = createCurrentRecord;
  createCurrentRecord = function createCurrentRecordWithGoals() {
    const record = originalCreateCurrentRecord();
    const goals = Object.fromEntries(
      getAssignments().map((assignment) => [assignment.name, assignmentGoal(assignment)])
    );
    const activeGoal = getAssignments().reduce((sum, assignment) => {
      if (isReference(assignment) || isAbsent(assignment)) return sum;
      return sum + assignmentGoal(assignment);
    }, 0);
    return { ...record, employeeGoals: goals, dailyTeamGoal: activeGoal };
  };
})();