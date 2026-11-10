"use strict";

/* Permanent daily reconciliation: named employees + variance reports + batches = uploaded report total. */
(() => {
  const SUPPORT_NAMES = new Set(["batches", "batch", "variance reports", "variance report"]);
  const REFERENCE_NAME = "already cycle counted numbers";
  const DEFAULT_GOAL = 200;

  const norm = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const isSupport = (value) => SUPPORT_NAMES.has(norm(typeof value === "string" ? value : value?.name));
  const isReference = (value) => norm(typeof value === "string" ? value : value?.name) === REFERENCE_NAME;
  const isGoal = (assignment) => Boolean(assignment && !isSupport(assignment) && !isReference(assignment));
  const goalFor = (assignment) => {
    if (!isGoal(assignment)) return 0;
    const value = Number(assignment?.dailyGoal);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_GOAL;
  };
  const isAbsent = (assignment) => {
    const attendance = typeof getAttendanceForAssignment === "function" ? getAttendanceForAssignment(assignment) : null;
    return attendance?.status === "absent";
  };
  const numberValue = (value) => {
    const n = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

  function officialReportTotal() {
    if (!state.workbook) return 0;
    let total = 0;
    state.workbook.SheetNames.forEach((sheetName) => {
      workbookMatrix(state.workbook, sheetName).forEach((row) => {
        const labels = row.map((cell) => normalizeText(cell));
        if (!labels.some((label) => label === "total")) return;
        row.forEach((cell) => {
          const value = numberValue(cell);
          if (value > total && value <= 100000) total = value;
        });
      });
    });
    return Math.round(total);
  }

  function varianceTotal() {
    return typeof pcVarianceTotal === "function" ? Number(pcVarianceTotal()) || 0 : 0;
  }

  function namedTotal() {
    return getAssignments().reduce((sum, assignment) => {
      if (!isGoal(assignment)) return sum;
      return sum + (Number(state.employeeTotals?.[assignment.name]) || 0);
    }, 0);
  }

  function batchTotal() {
    const official = officialReportTotal();
    if (official > 0) return Math.max(0, official - namedTotal() - varianceTotal());
    return typeof pcExplicitBatchTotal === "function" ? Number(pcExplicitBatchTotal()) || 0 : 0;
  }

  function ensureCard(selector, label, total) {
    const cards = $("productionCards");
    if (!cards) return null;
    let card = cards.querySelector(selector);
    if (!card && total > 0) {
      card = document.createElement("article");
      card.className = "summary-card";
      if (label === "Batches") card.dataset.unassignedBatchesCard = "true";
      if (label === "Variance Reports") card.dataset.varianceReportsCard = "true";
      card.innerHTML = `<div class="summary-card-top"><div><strong>${label}</strong><span>Support counts included in overall completion</span></div><b>${total}</b></div><div class="percent-row"><span>Support total</span><small>No individual goal</small></div>`;
      cards.appendChild(card);
    }
    if (card) {
      card.querySelector(".summary-card-top b").textContent = String(total);
      card.querySelector(".summary-card-top span").textContent = "Support counts included in overall completion";
      card.querySelector(".meter")?.remove();
      let row = card.querySelector(".percent-row");
      if (!row) {
        row = document.createElement("div");
        row.className = "percent-row";
        card.appendChild(row);
      }
      row.innerHTML = `<span>Support total</span><small>${total} added to overall completion • no individual goal</small>`;
    }
    return card;
  }

  function applyReconciliation() {
    if (!state.workbook) return;
    if (typeof acRenderUnassignedProductionCard === "function") acRenderUnassignedProductionCard();

    const official = officialReportTotal();
    const named = namedTotal();
    const variance = varianceTotal();
    const batches = batchTotal();
    const completed = official > 0 ? official : named + variance + batches;
    const requiredGoal = getAssignments().reduce((sum, assignment) => {
      return isGoal(assignment) && !isAbsent(assignment) ? sum + goalFor(assignment) : sum;
    }, 0);
    const percent = requiredGoal > 0 ? ((completed / requiredGoal) * 100).toFixed(1) : "0.0";

    ensureCard("[data-unassigned-batches-card]", "Batches", batches);
    ensureCard("[data-variance-reports-card]", "Variance Reports", variance);

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    if (kpis[0]) kpis[0].querySelector("strong").textContent = String(completed);
    if (kpis[2]) kpis[2].querySelector("strong").textContent = String(requiredGoal);
    if (kpis[3]) kpis[3].querySelector("strong").textContent = `${percent}%`;

    const summary = $("recordSummary");
    if (summary) summary.textContent = `${completed} total production • ${variance} Variance Reports • ${batches} Batches`;

    state.officialReportTotal = official;
    state.reconciledBatchesTotal = batches;
    state.reconciledCompletedTotal = completed;
  }

  if (typeof rrGetOfficialReportTotal !== "undefined") rrGetOfficialReportTotal = officialReportTotal;
  if (typeof rrGetBatchesTotal !== "undefined") rrGetBatchesTotal = batchTotal;
  if (typeof acGetUnassignedBatchTotal !== "undefined") acGetUnassignedBatchTotal = batchTotal;
  if (typeof pcBatchesTotal !== "undefined") pcBatchesTotal = batchTotal;

  const priorRender = renderResults;
  renderResults = function renderResultsWithDailyReconciliation() {
    priorRender();
    applyReconciliation();
  };

  const priorCreate = createCurrentRecord;
  createCurrentRecord = function createReconciledRecord() {
    const record = priorCreate();
    return {
      ...record,
      officialReportTotal: officialReportTotal(),
      batchesTotal: batchTotal(),
      varianceReportsTotal: varianceTotal(),
      reconciledCompletedTotal: officialReportTotal() || namedTotal() + varianceTotal() + batchTotal(),
    };
  };

  window.setTimeout(applyReconciliation, 0);
})();
