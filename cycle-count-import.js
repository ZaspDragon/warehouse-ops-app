(function () {
  const IMPORT_COLLECTION = "cycleCountImports";
  const AUDIT_COLLECTION = "auditLogs";
  const COUNTER_ROLES = ["counter", "worker", "admin", "lead", "platformOwner"];
  const APPROVER_ROLES = ["admin", "lead", "platformOwner"];

  const importState = {
    rows: [],
    header: {},
    summary: {},
    warnings: [],
    errors: [],
    rawText: "",
    profile: null,
    role: "",
    approvedSessionId: ""
  };

  document.addEventListener("DOMContentLoaded", () => {
    installCycleImportUi();
    wireCycleImportAuth();
  });

  function installCycleImportUi() {
    const cycleCard = document.querySelector("#cycleTab > .card:first-child");
    if (!cycleCard || $("cycleImportText")) return;

    cycleCard.insertAdjacentHTML(
      "afterbegin",
      `
      <div class="cycle-import-card upload-card">
        <h3>Paste Cycle Count Text</h3>
        <textarea id="cycleImportText" class="cycle-import-textarea" placeholder="Paste Cycle Count Report Here"></textarea>
        <div class="actions">
          <button id="parseCycleImportBtn" class="primary">Parse Count Sheet</button>
          <button id="saveCycleImportDraftBtn" class="cycle-import-review-only hidden">Save Draft Count</button>
          <button id="approveCycleImportBtn" class="cycle-import-review-only hidden">Approve Import</button>
        </div>
        <p id="cycleImportMessage" class="message"></p>
      </div>

      <div id="cycleImportReview" class="cycle-import-review hidden">
        <div class="cycle-import-summary">
          <h3>Import Review</h3>
          <div id="cycleImportHeader" class="cycle-import-header"></div>
          <div id="cycleImportStats" class="stats cycle-import-stats"></div>
        </div>

        <div id="cycleImportIssues" class="cycle-import-issues"></div>

        <div class="table-wrap small cycle-import-table-wrap">
          <table class="cycle-import-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Number</th>
                <th>Bin</th>
                <th>Description</th>
                <th>UOM</th>
                <th>On Hand Qty</th>
                <th>Counted Qty</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Confidence</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="cycleImportRows"></tbody>
          </table>
        </div>
      </div>

      <div class="cycle-import-card upload-card">
        <h3>Cycle Count Import Search & Metrics</h3>
        <div class="grid cycle-import-search">
          <label>User ID
            <input id="cycleImportSearchUser" placeholder="User ID" />
          </label>
          <label>Counter Name
            <input id="cycleImportSearchCounter" placeholder="Counter" />
          </label>
          <label>Stock Count ID
            <input id="cycleImportSearchCountId" placeholder="COUNT-001" />
          </label>
          <label>Bin
            <input id="cycleImportSearchBin" placeholder="Bin" />
          </label>
          <label>Item Number
            <input id="cycleImportSearchItem" placeholder="Item #" />
          </label>
          <label>Start Date
            <input id="cycleImportSearchStart" type="date" />
          </label>
          <label>End Date
            <input id="cycleImportSearchEnd" type="date" />
          </label>
        </div>
        <div class="actions">
          <button id="cycleImportSearchBtn" class="primary">Search Imports</button>
          <button id="cycleImportClearSearchBtn">Clear Search</button>
        </div>
        <div id="cycleImportMetrics" class="stats cycle-import-metrics"></div>
        <div class="table-wrap small">
          <table class="cycle-import-search-table">
            <thead>
              <tr>
                <th>Stock Count ID</th>
                <th>User ID</th>
                <th>Counter</th>
                <th>Date</th>
                <th>Items</th>
                <th>Variance Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="cycleImportSearchBody"></tbody>
          </table>
        </div>
      </div>
    `
    );

    $("parseCycleImportBtn")?.addEventListener("click", parseCycleImportFromTextarea);
    $("saveCycleImportDraftBtn")?.addEventListener("click", () => saveCycleImport("Draft"));
    $("approveCycleImportBtn")?.addEventListener("click", approveCycleImport);
    $("cycleImportSearchBtn")?.addEventListener("click", renderImportSearch);
    $("cycleImportClearSearchBtn")?.addEventListener("click", clearImportSearch);
  }

  function wireCycleImportAuth() {
    if (!window.auth || !window.db) return;

    auth.onAuthStateChanged(async (user) => {
      if (state?.isDemoMode) {
        importState.profile = {
          role: new URLSearchParams(window.location.search).get("role") || "lead",
          name: "Demo User",
          uid: "demo-user"
        };
        importState.role = importState.profile.role;
        applyCycleImportPermissions();
        renderImportSearch();
        return;
      }

      if (!user) {
        importState.profile = null;
        importState.role = "";
        applyCycleImportPermissions();
        return;
      }

      try {
        const snap = await db.collection("users").doc(user.uid).get();
        importState.profile = snap.exists ? { uid: user.uid, email: user.email, ...snap.data() } : { uid: user.uid, email: user.email };
        importState.role = String(importState.profile.role || "");
      } catch (err) {
        console.warn("Cycle import profile load failed:", err);
        importState.profile = { uid: user.uid, email: user.email };
        importState.role = "";
      }

      applyCycleImportPermissions();
      renderImportSearch();
    });
  }

  function applyCycleImportPermissions() {
    const canImport = state?.isDemoMode || COUNTER_ROLES.includes(importState.role);
    const canApprove = state?.isDemoMode || APPROVER_ROLES.includes(importState.role);

    ["cycleImportText", "parseCycleImportBtn", "saveCycleImportDraftBtn"].forEach((id) => {
      if ($(id)) $(id).disabled = !canImport;
    });

    if ($("approveCycleImportBtn")) $("approveCycleImportBtn").disabled = !canApprove;
  }

  function parseCycleImportFromTextarea() {
    const rawText = $("cycleImportText")?.value || "";
    if (!rawText.trim()) {
      setImportMessage("Paste cycle count text first.");
      return;
    }

    const result = parseCycleCountText(rawText);
    importState.rawText = rawText;
    importState.header = result.header;
    importState.rows = result.rows;
    validateImportRows();
    renderImportReview();
    setImportMessage(`Parsed ${importState.rows.length} rows. Review before import.`);
  }

  function parseCycleCountText(rawText) {
    const normalizedText = rawText.replace(/\r/g, "\n").replace(/\t/g, " ");
    const lines = normalizedText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const header = extractHeader(lines, normalizedText);
    const rows = extractItemRows(lines, header.binLocation).map((row, index) => normalizeParsedRow(row, index));

    return { header, rows };
  }

  function extractHeader(lines, rawText) {
    return {
      stockCountId: findHeaderValue(rawText, ["Stock Count ID", "Count ID", "Stock Count", "Count #"]),
      userId: findHeaderValue(rawText, ["User ID", "User", "Operator ID"]),
      countedBy: findHeaderValue(rawText, ["Counted By", "Counter", "CountedBy"]),
      countStartDate: normalizeDate(findHeaderValue(rawText, ["Count Start Date", "Start Date", "Count Date", "Date"])),
      countStartTime: normalizeTime(findHeaderValue(rawText, ["Count Start Time", "Start Time", "Time"])),
      siteId: findHeaderValue(rawText, ["Site ID", "Site", "Warehouse"]),
      binLocation: findHeaderValue(rawText, ["Bin Location", "Bin", "Location"]),
      sourceLineCount: lines.length
    };
  }

  function findHeaderValue(rawText, labels) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`${escaped}\\s*[:#-]?\\s*([^\\n|]+)`, "i");
      const match = rawText.match(regex);
      if (match?.[1]) return cleanupHeaderValue(match[1]);
    }

    return "";
  }

  function cleanupHeaderValue(value) {
    return String(value || "")
      .replace(/\s{2,}.*/, "")
      .replace(/\b(Item|Description|UOM|On Hand|Counted)\b.*$/i, "")
      .trim();
  }

  function extractItemRows(lines, defaultBin) {
    const rows = [];

    lines.forEach((line) => {
      if (isHeaderLikeLine(line)) return;

      const pipeParts = line.split("|").map((part) => part.trim()).filter(Boolean);
      if (pipeParts.length >= 4) {
        const row = parseDelimitedItemRow(pipeParts, defaultBin);
        if (row) rows.push(row);
        return;
      }

      const row = parseSpacedItemRow(line, defaultBin);
      if (row) rows.push(row);
    });

    return rows;
  }

  function isHeaderLikeLine(line) {
    return /stock count|count start|counted by|user id|site id|item\s*#|item number|description\s+uom|on hand/i.test(line);
  }

  function parseDelimitedItemRow(parts, defaultBin) {
    const numericIndexes = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => isNumericLike(part))
      .map(({ index }) => index);

    if (numericIndexes.length < 1) return null;

    const countedIndex = numericIndexes[numericIndexes.length - 1];
    const onHandIndex = numericIndexes.length > 1 ? numericIndexes[numericIndexes.length - 2] : -1;
    const itemIndex = parts.findIndex((part) => looksLikeItemNumber(part));
    if (itemIndex === -1) return null;

    const maybeBin = parts.find((part, index) => index !== itemIndex && looksLikeBin(part)) || defaultBin || "";
    const uom = parts.find((part) => /^[A-Z]{1,4}$/i.test(part) && !looksLikeItemNumber(part)) || "";

    return {
      itemNumber: parts[itemIndex],
      bin: maybeBin,
      description: parts
        .filter((_, index) => ![itemIndex, countedIndex, onHandIndex].includes(index))
        .filter((part) => part !== maybeBin && part !== uom)
        .join(" "),
      uom,
      systemQty: onHandIndex >= 0 ? toNumber(parts[onHandIndex]) : "",
      countedQty: toNumber(parts[countedIndex])
    };
  }

  function parseSpacedItemRow(line, defaultBin) {
    const itemMatch = line.match(/\b[A-Z0-9][A-Z0-9._-]{2,}\b/i);
    if (!itemMatch) return null;

    const numbers = [...line.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)];
    if (!numbers.length) return null;

    const countedMatch = numbers[numbers.length - 1];
    const onHandMatch = numbers.length > 1 ? numbers[numbers.length - 2] : null;
    const itemNumber = itemMatch[0];
    const uomMatch = line.match(/\b(EA|CS|BX|PK|PC|PR|FT|IN|LB|KG|GAL|QT|SET)\b/i);
    const binMatch = line.match(/\b[A-Z]\d{1,3}[-/][A-Z0-9-]{1,8}\b/i) || line.match(/\b[A-Z]{1,4}-\d{1,4}\b/i);

    let description = line
      .replace(itemNumber, "")
      .replace(countedMatch[0], "")
      .replace(onHandMatch?.[0] || "", "")
      .replace(uomMatch?.[0] || "", "")
      .replace(binMatch?.[0] || "", "")
      .trim();

    description = description.replace(/\s{2,}/g, " ");

    return {
      itemNumber,
      bin: binMatch?.[0] || defaultBin || "",
      description,
      uom: uomMatch?.[0] || "",
      systemQty: onHandMatch ? toNumber(onHandMatch[0]) : "",
      countedQty: toNumber(countedMatch[0])
    };
  }

  function normalizeParsedRow(row, index) {
    const systemQty = row.systemQty === "" ? "" : Number(row.systemQty || 0);
    const countedQty = row.countedQty === "" ? "" : Number(row.countedQty || 0);
    const variance = countedQty === "" || systemQty === "" ? "" : countedQty - systemQty;
    const confidence = calculateConfidence(row);

    return {
      id: createImportRowId(index),
      itemNumber: String(row.itemNumber || "").trim(),
      bin: String(row.bin || importState.header?.binLocation || "").trim(),
      description: String(row.description || "").trim(),
      uom: String(row.uom || "").trim(),
      systemQty,
      countedQty,
      variance,
      status: "Pending Review",
      confidence,
      errors: [],
      warnings: []
    };
  }

  function createImportRowId(index) {
    return `import-row-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function calculateConfidence(row) {
    let score = 100;
    if (!row.itemNumber) score -= 45;
    if (row.countedQty === "") score -= 35;
    if (!row.description) score -= 10;
    if (!row.uom) score -= 5;
    if (!row.bin) score -= 5;
    return Math.max(0, score);
  }

  function validateImportRows() {
    const itemCounts = {};
    const binItemCounts = {};
    const errors = [];
    const warnings = [];

    importState.rows.forEach((row) => {
      row.errors = [];
      row.warnings = [];
      row.variance = row.countedQty === "" || row.systemQty === "" ? "" : Number(row.countedQty || 0) - Number(row.systemQty || 0);
      row.confidence = calculateConfidence(row);

      const itemKey = row.itemNumber.toUpperCase();
      const binItemKey = `${String(row.bin || "").toUpperCase()}|${itemKey}`;

      if (!row.itemNumber) row.errors.push("Missing item number");
      if (row.countedQty === "" || row.countedQty === null || Number.isNaN(Number(row.countedQty))) row.errors.push("Missing counted quantity");

      if (itemKey) itemCounts[itemKey] = (itemCounts[itemKey] || 0) + 1;
      if (row.bin && itemKey) binItemCounts[binItemKey] = (binItemCounts[binItemKey] || 0) + 1;
    });

    importState.rows.forEach((row) => {
      const itemKey = row.itemNumber.toUpperCase();
      const binItemKey = `${String(row.bin || "").toUpperCase()}|${itemKey}`;

      if (itemKey && itemCounts[itemKey] > 1) row.warnings.push("Duplicate item number");
      if (row.bin && itemKey && binItemCounts[binItemKey] > 1) row.warnings.push("Duplicate bin/item");
      if (row.confidence < 70) row.warnings.push("Questionable parse confidence");

      errors.push(...row.errors.map((message) => `Row ${row.line || ""}: ${message}`));
      warnings.push(...row.warnings.map((message) => `${row.itemNumber || "Unknown item"}: ${message}`));
    });

    importState.errors = [...new Set(errors)];
    importState.warnings = [...new Set(warnings)];
    importState.summary = buildImportSummary();
  }

  function buildImportSummary() {
    const totalRows = importState.rows.length;
    const completeRows = importState.rows.filter((row) => !row.errors.length).length;
    const varianceRows = importState.rows.filter((row) => Number(row.variance || 0) !== 0).length;
    const totalVariance = importState.rows.reduce((sum, row) => sum + Number(row.variance || 0), 0);

    return {
      totalRows,
      completeRows,
      varianceRows,
      totalVariance,
      warningCount: importState.warnings.length,
      errorCount: importState.errors.length
    };
  }

  function renderImportReview() {
    $("cycleImportReview")?.classList.remove("hidden");
    document.querySelectorAll(".cycle-import-review-only").forEach((el) => el.classList.remove("hidden"));
    renderImportHeader();
    renderImportStats();
    renderImportIssues();
    renderImportRows();
    applyCycleImportPermissions();
  }

  function renderImportHeader() {
    const body = $("cycleImportHeader");
    if (!body) return;

    const header = importState.header || {};
    body.innerHTML = [
      ["Stock Count ID", header.stockCountId],
      ["User ID", header.userId],
      ["Counted By", header.countedBy],
      ["Count Start Date", header.countStartDate],
      ["Count Start Time", header.countStartTime],
      ["Site ID", header.siteId],
      ["Bin Location", header.binLocation]
    ]
      .map(([label, value]) => `<label>${label}<input data-header-field="${toCamel(label)}" value="${escapeHtml(value || "")}" /></label>`)
      .join("");

    body.querySelectorAll("[data-header-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const field = input.dataset.headerField;
        const oldValue = importState.header[field] || "";
        importState.header[field] = input.value.trim();
        queueEditAudit("header", field, oldValue, importState.header[field]);
      });
    });
  }

  function toCamel(label) {
    const map = {
      "Stock Count ID": "stockCountId",
      "User ID": "userId",
      "Counted By": "countedBy",
      "Count Start Date": "countStartDate",
      "Count Start Time": "countStartTime",
      "Site ID": "siteId",
      "Bin Location": "binLocation"
    };
    return map[label] || label;
  }

  function renderImportStats() {
    const body = $("cycleImportStats");
    if (!body) return;

    const summary = importState.summary || {};
    body.innerHTML = `
      <div><strong>${summary.totalRows || 0}</strong><span>Rows Parsed</span></div>
      <div><strong>${summary.varianceRows || 0}</strong><span>Variance Lines</span></div>
      <div><strong>${summary.errorCount || 0}</strong><span>Errors</span></div>
    `;
  }

  function renderImportIssues() {
    const body = $("cycleImportIssues");
    if (!body) return;

    const errors = importState.errors || [];
    const warnings = importState.warnings || [];

    body.innerHTML = `
      ${errors.length ? `<div class="cycle-import-error"><strong>Errors</strong><ul>${errors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      ${warnings.length ? `<div class="cycle-import-warning"><strong>Warnings</strong><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
    `;
  }

  function renderImportRows() {
    const body = $("cycleImportRows");
    if (!body) return;

    body.innerHTML = "";
    importState.rows.forEach((row, index) => {
      const classes = [
        row.errors.length ? "has-import-error" : "",
        row.warnings.length ? "has-import-warning" : ""
      ].filter(Boolean).join(" ");

      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr class="${classes}" data-row-id="${escapeHtml(row.id)}">
          <td>${index + 1}</td>
          <td><input data-field="itemNumber" value="${escapeHtml(row.itemNumber)}" /></td>
          <td><input data-field="bin" value="${escapeHtml(row.bin)}" /></td>
          <td><input data-field="description" value="${escapeHtml(row.description)}" /></td>
          <td><input data-field="uom" value="${escapeHtml(row.uom)}" /></td>
          <td><input data-field="systemQty" type="number" value="${escapeHtml(row.systemQty)}" /></td>
          <td><input data-field="countedQty" type="number" value="${escapeHtml(row.countedQty)}" /></td>
          <td>${escapeHtml(row.variance)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td><span class="confidence ${row.confidence < 70 ? "bad" : row.confidence < 90 ? "warn" : "ok"}">${row.confidence}%</span></td>
          <td><button class="cycleImportDeleteRowBtn" data-row-id="${escapeHtml(row.id)}">Delete</button></td>
        </tr>
      `
      );
    });

    body.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("change", handleImportRowEdit);
    });

    body.querySelectorAll(".cycleImportDeleteRowBtn").forEach((button) => {
      button.addEventListener("click", () => deleteImportRow(button.dataset.rowId));
    });
  }

  function handleImportRowEdit(event) {
    const input = event.target;
    const row = importState.rows.find((entry) => entry.id === input.closest("tr")?.dataset.rowId);
    if (!row) return;

    const field = input.dataset.field;
    const oldValue = row[field];
    row[field] = ["systemQty", "countedQty"].includes(field) && input.value !== "" ? Number(input.value) : input.value;
    queueEditAudit("row", field, oldValue, row[field], row.itemNumber);
    validateImportRows();
    renderImportReview();
  }

  function deleteImportRow(rowId) {
    const row = importState.rows.find((entry) => entry.id === rowId);
    importState.rows = importState.rows.filter((entry) => entry.id !== rowId);
    queueEditAudit("row", "delete", row?.itemNumber || "", "");
    validateImportRows();
    renderImportReview();
  }

  function queueEditAudit(scope, field, oldValue, newValue, itemNumber = "") {
    importState.editAudit ||= [];
    importState.editAudit.push({
      scope,
      field,
      itemNumber,
      oldValue: oldValue ?? "",
      newValue: newValue ?? "",
      editedAt: new Date().toISOString(),
      editedBy: state?.user?.uid || "demo-user",
      editedByEmail: state?.user?.email || "demo@warehouse-ops-app.local"
    });
  }

  async function saveCycleImport(status = "Draft") {
    validateImportRows();

    if (!importState.rows.length) {
      setImportMessage("Parse rows before saving a draft.");
      return;
    }

    const payload = buildImportPayload(status);

    try {
      if (!state?.isDemoMode) {
        const ref = await db.collection(IMPORT_COLLECTION).add(payload);
        await writeImportAudit("cycleCountImportDraftSaved", ref.id, payload);
      }

      setImportMessage(status === "Draft" ? "Draft count saved." : "Import saved.");
      renderImportSearch();
    } catch (err) {
      console.error("Cycle import draft save failed:", err);
      setImportMessage("Save failed: " + err.message);
    }
  }

  async function approveCycleImport() {
    validateImportRows();

    if (importState.errors.length) {
      setImportMessage("Fix import errors before approval.");
      return;
    }

    const payload = buildImportPayload("Approved");
    payload.approvalUser = state?.user?.email || importState.profile?.name || "Demo User";
    payload.approvalTimestamp = new Date().toISOString();

    try {
      if (!state?.isDemoMode) {
        const ref = await db.collection(IMPORT_COLLECTION).add(payload);
        await writeImportAudit("cycleCountImportApproved", ref.id, payload);
      }

      loadApprovedImportIntoManualRows(payload);
      setImportMessage("Import approved and loaded into Cycle Count.");
      renderImportSearch();
    } catch (err) {
      console.error("Cycle import approval failed:", err);
      setImportMessage("Approval failed: " + err.message);
    }
  }

  function buildImportPayload(status) {
    return {
      stockCountId: importState.header.stockCountId || "",
      userId: importState.header.userId || "",
      countedBy: importState.header.countedBy || "",
      countDate: importState.header.countStartDate || "",
      countTime: importState.header.countStartTime || "",
      siteId: importState.header.siteId || "",
      binLocation: importState.header.binLocation || "",
      rows: importState.rows.map(({ id, errors, warnings, ...row }) => row),
      summary: importState.summary,
      errors: importState.errors,
      warnings: importState.warnings,
      originalUserId: importState.header.userId || "",
      uploadedBy: state?.user?.email || importState.profile?.name || "Demo User",
      uploadedByUid: state?.user?.uid || "demo-user",
      uploadTimestamp: new Date().toISOString(),
      status,
      editAudit: importState.editAudit || [],
      rawText: importState.rawText,
      createdAt: new Date().toISOString(),
      createdBy: state?.user?.uid || "demo-user",
      createdByEmail: state?.user?.email || "demo@warehouse-ops-app.local"
    };
  }

  function loadApprovedImportIntoManualRows(payload) {
    if ($("cycleId")) $("cycleId").value = payload.stockCountId || "";
    if ($("cycleDate")) $("cycleDate").value = payload.countDate || $("cycleDate").value;

    buildCycleRows?.(Math.max(25, payload.rows.length));
    const rows = [...document.querySelectorAll("#cycleBody tr")];

    payload.rows.forEach((line, index) => {
      const row = rows[index];
      if (!row) return;

      setImportRowValue(row, ".cycle-item", line.itemNumber);
      setImportRowValue(row, ".cycle-desc", line.description);
      setImportRowValue(row, ".cycle-location", line.bin || payload.binLocation);
      setImportRowValue(row, ".cycle-system", line.systemQty);
      setImportRowValue(row, ".cycle-counted", line.countedQty);
      setImportRowValue(row, ".cycle-reason", line.status || "Pending Review");
      row.querySelector(".cycle-done")?.click();
    });

    updateCycleStats?.();
  }

  function setImportRowValue(row, selector, value) {
    const el = row.querySelector(selector);
    if (!el) return;
    el.value = value ?? "";
  }

  async function writeImportAudit(eventType, documentId, payload) {
    if (state?.isDemoMode || !window.db) return;

    try {
      await db.collection(AUDIT_COLLECTION).add({
        eventType,
        collection: IMPORT_COLLECTION,
        documentId,
        stockCountId: payload.stockCountId || "",
        originalUserId: payload.originalUserId || "",
        uploadedBy: payload.uploadedBy || "",
        uploadTimestamp: payload.uploadTimestamp || "",
        approvalUser: payload.approvalUser || "",
        approvalTimestamp: payload.approvalTimestamp || "",
        editAudit: payload.editAudit || [],
        createdAt: new Date().toISOString(),
        createdBy: state?.user?.uid || "",
        createdByEmail: state?.user?.email || ""
      });
    } catch (err) {
      console.warn("Cycle import audit write failed:", err);
    }
  }

  async function renderImportSearch() {
    const body = $("cycleImportSearchBody");
    if (!body) return;

    const imports = await loadImportSearchRows();
    const filtered = filterImportSearchRows(imports);
    body.innerHTML = "";

    if (!filtered.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="7">No imported cycle counts found.</td></tr>`);
    } else {
      filtered.forEach((entry) => {
        const varianceRate = entry.summary?.totalRows ? Math.round((Number(entry.summary.varianceRows || 0) / Number(entry.summary.totalRows || 1)) * 100) : 0;
        body.insertAdjacentHTML(
          "beforeend",
          `
          <tr>
            <td>${escapeHtml(entry.stockCountId || "")}</td>
            <td>${escapeHtml(entry.userId || "")}</td>
            <td>${escapeHtml(entry.countedBy || "")}</td>
            <td>${escapeHtml(entry.countDate || "")}</td>
            <td>${Number(entry.summary?.totalRows || entry.rows?.length || 0)}</td>
            <td>${varianceRate}%</td>
            <td>${escapeHtml(entry.status || "")}</td>
          </tr>
        `
        );
      });
    }

    renderImportMetrics(filtered);
  }

  async function loadImportSearchRows() {
    if (state?.isDemoMode || !window.db) {
      return [];
    }

    try {
      const snap = await db.collection(IMPORT_COLLECTION).orderBy("uploadTimestamp", "desc").limit(100).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn("Import search load failed:", err);
      return [];
    }
  }

  function filterImportSearchRows(rows) {
    const filters = {
      user: $("cycleImportSearchUser")?.value.trim().toLowerCase() || "",
      counter: $("cycleImportSearchCounter")?.value.trim().toLowerCase() || "",
      countId: $("cycleImportSearchCountId")?.value.trim().toLowerCase() || "",
      bin: $("cycleImportSearchBin")?.value.trim().toLowerCase() || "",
      item: $("cycleImportSearchItem")?.value.trim().toLowerCase() || "",
      start: $("cycleImportSearchStart")?.value || "",
      end: $("cycleImportSearchEnd")?.value || ""
    };

    return rows.filter((entry) => {
      if (filters.user && !String(entry.userId || "").toLowerCase().includes(filters.user)) return false;
      if (filters.counter && !String(entry.countedBy || "").toLowerCase().includes(filters.counter)) return false;
      if (filters.countId && !String(entry.stockCountId || "").toLowerCase().includes(filters.countId)) return false;
      if (filters.bin && !String(entry.binLocation || "").toLowerCase().includes(filters.bin) && !(entry.rows || []).some((row) => String(row.bin || "").toLowerCase().includes(filters.bin))) return false;
      if (filters.item && !(entry.rows || []).some((row) => String(row.itemNumber || "").toLowerCase().includes(filters.item))) return false;
      if (filters.start && String(entry.countDate || "") < filters.start) return false;
      if (filters.end && String(entry.countDate || "") > filters.end) return false;
      return true;
    });
  }

  function renderImportMetrics(rows) {
    const body = $("cycleImportMetrics");
    if (!body) return;

    const byUser = {};
    rows.forEach((entry) => {
      const user = entry.countedBy || entry.userId || "Unknown";
      byUser[user] ||= { countSessions: 0, items: 0, varianceRows: 0, totalRows: 0, totalVariance: 0 };
      byUser[user].countSessions += 1;
      byUser[user].items += Number(entry.summary?.totalRows || entry.rows?.length || 0);
      byUser[user].varianceRows += Number(entry.summary?.varianceRows || 0);
      byUser[user].totalRows += Number(entry.summary?.totalRows || entry.rows?.length || 0);
      byUser[user].totalVariance += Number(entry.summary?.totalVariance || 0);
    });

    const users = Object.keys(byUser).length;
    const totalImports = rows.length;
    const totalItems = rows.reduce((sum, entry) => sum + Number(entry.summary?.totalRows || entry.rows?.length || 0), 0);
    const totalVariance = rows.reduce((sum, entry) => sum + Math.abs(Number(entry.summary?.totalVariance || 0)), 0);

    body.innerHTML = `
      <div><strong>${totalImports}</strong><span>Counts Imported Per Day</span></div>
      <div><strong>${totalItems}</strong><span>Total Items Counted By User</span></div>
      <div><strong>${users ? Math.round(totalVariance / users) : 0}</strong><span>Average Variance By User</span></div>
    `;
  }

  function clearImportSearch() {
    [
      "cycleImportSearchUser",
      "cycleImportSearchCounter",
      "cycleImportSearchCountId",
      "cycleImportSearchBin",
      "cycleImportSearchItem",
      "cycleImportSearchStart",
      "cycleImportSearchEnd"
    ].forEach((id) => {
      if ($(id)) $(id).value = "";
    });

    renderImportSearch();
  }

  function setImportMessage(message) {
    if ($("cycleImportMessage")) $("cycleImportMessage").textContent = message;
  }

  function looksLikeItemNumber(value) {
    return /^[A-Z0-9][A-Z0-9._-]{2,}$/i.test(String(value || ""));
  }

  function looksLikeBin(value) {
    return /^[A-Z]\d{1,3}[-/][A-Z0-9-]{1,8}$/i.test(String(value || "")) || /^[A-Z]{1,4}-\d{1,4}$/i.test(String(value || ""));
  }

  function isNumericLike(value) {
    return /^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(String(value || "").trim());
  }

  function toNumber(value) {
    const clean = String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
    if (!clean) return "";
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : "";
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();
    if (!text) return "";

    const iso = text.match(/\d{4}-\d{2}-\d{2}/);
    if (iso) return iso[0];

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
  }

  function normalizeTime(value) {
    const text = String(value || "").trim();
    if (!text) return "";

    const match = text.match(/\b(\d{1,2}):(\d{2})(?:\s*([AP]M))?\b/i);
    return match ? match[0].toUpperCase() : text;
  }
})();
