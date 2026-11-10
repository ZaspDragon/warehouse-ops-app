"use strict";

/*
 * Production-total presentation and employee matching for Already Cycle Counted.
 * The initials filter changes only the preview. All matched credits, including
 * initials that are not assigned to an employee, remain in the team total.
 */

function acEmployeeForInitials(initials) {
  const normalized = acNormalizeInitials(initials);
  return getAssignments().find(
    (assignment) => acGetInitials(assignment) === normalized
  ) || null;
}

function acGetUnassignedInitialsTotals() {
  return Object.entries(alreadyCountedState.totalsByInitials)
    .filter(([initials]) => !acEmployeeForInitials(initials))
    .map(([initials, total]) => ({
      initials,
      total: Number(total) || 0,
    }));
}

function acGetUnassignedBatchTotal() {
  return acGetUnassignedInitialsTotals().reduce(
    (sum, entry) => sum + entry.total,
    0
  );
}

function acRenderUnassignedProductionCard() {
  const cards = $("productionCards");
  if (!cards) return;

  cards.querySelector("[data-unassigned-batches-card]")?.remove();

  const unassignedRows = acGetUnassignedInitialsTotals();
  const unassignedTotal = acGetUnassignedBatchTotal();
  if (unassignedTotal <= 0) return;

  const initialsBreakdown = unassignedRows
    .map((entry) => `${entry.initials.toUpperCase()}: ${entry.total}`)
    .join(" • ");

  const card = document.createElement("article");
  card.className = "summary-card";
  card.dataset.unassignedBatchesCard = "true";
  card.innerHTML = `
    <div class="summary-card-top">
      <div>
        <strong>Unassigned Batches</strong>
        <span>${escapeHtml(initialsBreakdown)}</span>
      </div>
      <b>${unassignedTotal}</b>
    </div>
    <div class="percent-row">
      <span>Included in team production</span>
      <small>Assign initials later</small>
    </div>
  `;
  cards.appendChild(card);

  const summary = $("recordSummary");
  if (summary) {
    const assignedTotal = Object.values(state.employeeTotals).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );
    summary.textContent = `${assignedTotal + unassignedTotal} total production • ${unassignedTotal} unassigned`;
  }
}

acApplyCreditsToProduction = function applyAllAlreadyCountedCredits() {
  const totalsByEmployee = {};
  const assignments = getAssignments();

  assignments.forEach((assignment) => {
    const initials = acGetInitials(assignment);
    totalsByEmployee[assignment.name] = Number(
      alreadyCountedState.totalsByInitials[initials] || 0
    );
  });

  alreadyCountedState.totalsByEmployee = totalsByEmployee;

  assignments.forEach((assignment) => {
    const current = Number(state.employeeTotals[assignment.name] || 0);
    const previousExtra = Number(assignment.__alreadyCountedApplied || 0);
    const nextExtra = Number(totalsByEmployee[assignment.name] || 0);

    state.employeeTotals[assignment.name] =
      Math.max(0, current - previousExtra) + nextExtra;
    assignment.__alreadyCountedApplied = nextExtra;
  });

  if (state.workbook) {
    renderResults();
    acRenderUnassignedProductionCard();
  }
};

acRenderPreview = function renderAlreadyCountedWithEmployeeTotals() {
  const preview = $("alreadyCountedPreview");
  if (!preview) return;

  const filter = alreadyCountedState.selectedInitials;
  const rows = alreadyCountedState.matchedRows.filter(
    (row) => filter === "all" || row.initials === filter
  );
  const filteredLocations = rows.reduce(
    (sum, row) => sum + row.locationCount,
    0
  );

  const employeeRows = getAssignments().map((assignment) => {
    const initials = acGetInitials(assignment);
    const alreadyCounted = Number(
      alreadyCountedState.totalsByInitials[initials] || 0
    );
    const productionTotal = Number(
      state.employeeTotals[assignment.name] || 0
    );
    const regularProduction = Math.max(
      0,
      productionTotal - alreadyCounted
    );

    return {
      name: assignment.name,
      initials,
      regularProduction,
      alreadyCounted,
      productionTotal,
    };
  });

  const unassignedInitials = acGetUnassignedInitialsTotals();
  const unassignedTotal = acGetUnassignedBatchTotal();

  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="already-counted-kpis">
      <div><span>Matched items</span><strong>${rows.length}</strong></div>
      <div><span>Unique locations</span><strong>${filteredLocations}</strong></div>
      <div><span>Unmatched items</span><strong>${alreadyCountedState.unmatchedRows.length}</strong></div>
      <div><span>Unassigned batches</span><strong>${unassignedTotal}</strong></div>
    </div>

    <div class="table-wrap already-counted-table-wrap">
      <table class="history-table">
        <thead>
          <tr><th>Employee</th><th>Initials</th><th>Item</th><th>Locations</th><th>Bins</th></tr>
        </thead>
        <tbody>
          ${rows.slice(0, 500).map((row) => {
            const employee = acEmployeeForInitials(row.initials);
            return `
              <tr>
                <td>${escapeHtml(employee?.name || "Unassigned Batches")}</td>
                <td>${escapeHtml(row.initials.toUpperCase())}</td>
                <td>${escapeHtml(row.itemNumber)}</td>
                <td>${row.locationCount}</td>
                <td>${escapeHtml(row.bins.join(", "))}</td>
              </tr>
            `;
          }).join("") || '<tr><td colspan="5" class="empty-row">No matching items for this filter.</td></tr>'}
        </tbody>
      </table>
    </div>

    <section class="already-counted-production-summary">
      <div class="section-heading">
        <div>
          <h3>Already Counted Added to Production</h3>
          <small>Assigned initials go to the employee. Unassigned initials remain in the team total as Unassigned Batches.</small>
        </div>
      </div>
      <div class="table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Initials</th>
              <th>Regular Production</th>
              <th>Already Counted Added</th>
              <th>Production Total</th>
            </tr>
          </thead>
          <tbody>
            ${employeeRows.map((employee) => `
              <tr>
                <td><strong>${escapeHtml(employee.name)}</strong></td>
                <td>${escapeHtml(employee.initials.toUpperCase() || "—")}</td>
                <td>${employee.regularProduction}</td>
                <td><strong>+${employee.alreadyCounted}</strong></td>
                <td><strong>${employee.productionTotal}</strong></td>
              </tr>
            `).join("")}
            ${unassignedTotal > 0 ? `
              <tr>
                <td><strong>Unassigned Batches</strong></td>
                <td>${escapeHtml(unassignedInitials.map((entry) => entry.initials.toUpperCase()).join(", "))}</td>
                <td>0</td>
                <td><strong>+${unassignedTotal}</strong></td>
                <td><strong>${unassignedTotal}</strong></td>
              </tr>
            ` : ""}
          </tbody>
        </table>
      </div>
      ${unassignedInitials.length ? `
        <div class="message">
          Unassigned batches are included in team production: ${unassignedInitials
            .map((entry) => `${escapeHtml(entry.initials.toUpperCase())} (${entry.total})`)
            .join(", ")}. Add those initials to an employee later to move the credit to that person without changing the team total.
        </div>
      ` : ""}
    </section>
  `;

  acRenderUnassignedProductionCard();
};
