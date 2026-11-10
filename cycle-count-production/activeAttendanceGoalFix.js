"use strict";

(() => {
  if (window.__activeAttendanceGoalFixInstalled) return;
  window.__activeAttendanceGoalFixInstalled = true;

  const SUPPORT = /^(batches?|variance reports?|already cycle counted numbers)$/i;

  function isAbsent(assignment) {
    return typeof window.isCycleCountAssignmentAbsent === "function"
      ? window.isCycleCountAssignmentAbsent(assignment)
      : false;
  }

  function employeeGoal(assignment) {
    const goal = Number(assignment?.dailyGoal);
    return Number.isFinite(goal) && goal > 0 ? goal : 200;
  }

  function applyActiveGoal() {
    if (!state?.workbook) return;

    const activeAssignments = getAssignments().filter((assignment) => {
      const name = String(assignment?.name || "").trim();
      return name && !SUPPORT.test(name) && !isAbsent(assignment);
    });

    const teamGoal = activeAssignments.reduce((sum, assignment) => sum + employeeGoal(assignment), 0);
    const officialTotal = typeof rrGetOfficialReportTotal === "function"
      ? Number(rrGetOfficialReportTotal()) || 0
      : Number(state.dailyOfficialReportTotal || 0);

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    const goalValue = kpis[2]?.querySelector("strong");
    const productionValue = kpis[3]?.querySelector("strong");

    if (goalValue) goalValue.textContent = String(teamGoal);
    if (productionValue) {
      productionValue.textContent = teamGoal > 0
        ? `${((officialTotal / teamGoal) * 100).toFixed(1)}%`
        : "0.0%";
    }

    state.activeDailyTeamGoal = teamGoal;
  }

  window.applyActiveAttendanceGoal = applyActiveGoal;

  const previousRenderResults = renderResults;
  renderResults = function renderResultsWithActiveAttendanceGoal() {
    previousRenderResults();
    window.setTimeout(applyActiveGoal, 0);
    window.setTimeout(applyActiveGoal, 250);
    window.setTimeout(applyActiveGoal, 750);
  };

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.("[data-attendance-id], #branchSelect")) {
      window.setTimeout(applyActiveGoal, 0);
    }
  });

  ["sourceFile", "alreadyCountedFile", "matchAlreadyCountedBtn"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => window.setTimeout(applyActiveGoal, 800));
    document.getElementById(id)?.addEventListener("click", () => window.setTimeout(applyActiveGoal, 800));
  });
})();