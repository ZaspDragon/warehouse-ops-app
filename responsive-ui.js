(function () {
  document.write('<script src="responsive-ui-core.js?v=20260726-navigation"><\/script>');

  // 2026-09-11 hotfixes are intentionally kept in this late-loaded file so
  // they can be tested on a branch without touching the live app.js workflow.
  // This fixes editable putaway timestamps and strict leaderboard date filtering.

  function editablePutawayDate(line) {
    return normalizeLeaderboardDate(line?.workDate) ||
      normalizeLeaderboardDate(line?.submittedDate) ||
      normalizeLeaderboardDate(line?.submittedAt) ||
      todayValue();
  }

  function editablePutawayTime(line) {
    const submittedAt = parseDateValue(line?.submittedAt);
    if (submittedAt && !Number.isNaN(submittedAt.getTime())) {
      return `${pad(submittedAt.getHours())}:${pad(submittedAt.getMinutes())}:${pad(submittedAt.getSeconds())}`;
    }

    const raw = String(line?.submittedTime || "").trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return "00:00:00";

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    const meridiem = String(match[4] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  }

  function localTimestampIso(dateText, timeText) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return "";
    const normalizedTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(String(timeText || ""))
      ? String(timeText).padEnd(8, ":00")
      : "00:00:00";
    const date = new Date(`${dateText}T${normalizedTime}`);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  window.buildPutawayDailyGroups = function buildPutawayDailyGroupsFixed(records = state.putawayLogs) {
    const groupMap = new Map();

    (records || []).forEach((record) => {
      const normalized = normalizePutawayRecord(record);
      const activeLines = (normalized.lines || []).filter((line) => line.active !== false);

      activeLines.forEach((line, lineIndex) => {
        const lineWorkDate = editablePutawayDate(line) || normalized.workDate;
        const employeeName = normalizeEmployeeName(line.employeeName || line.worker || normalized.employeeName);
        const putawayNumber = String(line.putawayNumber || line.sheetNumber || normalized.putawayNumber || normalized.sheetNumber || "").trim();
        const key = [
          normalized.branchId || currentBranchId(),
          employeeName.toLowerCase(),
          lineWorkDate,
          putawayNumber.toLowerCase()
        ].join("|");

        const group = groupMap.get(key) || {
          key,
          branchId: normalized.branchId || currentBranchId(),
          employeeName,
          putawayNumber,
          sheetNumber: putawayNumber,
          status: line.status || normalized.status || "Completed",
          workDate: lineWorkDate,
          sourceRecords: [],
          lines: [],
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt
        };

        if (!group.sourceRecords.some((entry) => String(entry.id) === String(normalized.id))) {
          group.sourceRecords.push(normalized);
        }

        group.lines.push({
          ...line,
          workDate: lineWorkDate,
          submittedDate: lineWorkDate,
          sourceRecordId: normalized.id,
          sourceLineIndex: lineIndex
        });
        group.createdAt = [group.createdAt, normalized.createdAt].filter(Boolean).sort()[0] || group.createdAt;
        group.updatedAt = [group.updatedAt, normalized.updatedAt, line.submittedAt].filter(Boolean).sort().pop() || group.updatedAt;
        groupMap.set(key, group);
      });
    });

    return [...groupMap.values()]
      .map((group) => ({
        ...group,
        lines: sortPutawayLinesBySubmittedAt(group.lines),
        totalLines: group.lines.length,
        totalQty: group.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
      }))
      .sort((a, b) => String(b.workDate || b.updatedAt || "").localeCompare(String(a.workDate || a.updatedAt || "")));
  };

  window.renderPutawayDailyModalLines = function renderPutawayDailyModalLinesFixed(group, mode) {
    const body = $("putawayDailyLinesBody");
    if (!body) return;
    body.innerHTML = "";

    if (!group.lines.length) {
      body.insertAdjacentHTML("beforeend", `<tr><td colspan="8">No saved lines remain for this employee and date.</td></tr>`);
      return;
    }

    putawayLinesWithGaps(group.lines).forEach((line, index) => {
      const rowKey = `${line.sourceRecordId}|${line.sourceLineIndex}`;
      const actionCell = mode === "view"
        ? ""
        : mode === "edit"
          ? `<button type="button" class="primary" onclick="savePutawayDailyLine('${escapeHtml(line.sourceRecordId)}', ${Number(line.sourceLineIndex)})">Save Line</button>`
          : `<button type="button" class="danger" onclick="deletePutawayDailyLine('${escapeHtml(line.sourceRecordId)}', ${Number(line.sourceLineIndex)})">Delete Line</button>`;
      const valueCell = (field, value, type = "text", extra = "") => {
        if (mode === "view" || mode === "delete") return escapeHtml(value);
        return `<input id="putawayLine_${escapeHtml(rowKey)}_${field}" type="${type}" value="${escapeHtml(value)}" ${extra} />`;
      };

      const dateValue = editablePutawayDate(line);
      const timeValue = editablePutawayTime(line);

      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr class="${line.possibleDowntime ? "downtime-flag" : ""}">
          <td>${index + 1}</td>
          <td>${valueCell("item", line.itemNumber)}</td>
          <td>${valueCell("qty", line.quantity, "number", 'min="0"')}</td>
          <td>${valueCell("bin", line.binLocation)}</td>
          <td>${mode === "edit" ? valueCell("date", dateValue, "date") : escapeHtml(formatDateTime(line.submittedAt))}</td>
          <td>${mode === "edit" ? valueCell("time", timeValue, "time", 'step="1"') : escapeHtml(line.submittedTime || formatSubmittedTime(line.submittedAt))}</td>
          <td>
            <span class="${line.possibleDowntime ? "gap-badge alert" : "gap-badge"}">${escapeHtml(formatGapMinutes(line.gapMinutes))}</span>
            ${line.possibleDowntime ? `<span class="downtime-label">Possible downtime</span>` : ""}
          </td>
          <td>
            ${mode === "edit" ? valueCell("notes", line.notes) : escapeHtml(line.notes || "")}
            <div class="row-actions putaway-line-actions">${actionCell}</div>
          </td>
        </tr>
      `
      );
    });
  };

  window.savePutawayDailyLine = async function savePutawayDailyLineFixed(recordId, lineIndex) {
    const rowKey = `${recordId}|${lineIndex}`;
    const dateValue = $(`putawayLine_${rowKey}_date`)?.value || "";
    const timeValue = $(`putawayLine_${rowKey}_time`)?.value || "";
    const submittedAt = localTimestampIso(dateValue, timeValue);

    if (!dateValue || !submittedAt) {
      toast("Enter a valid submitted date and time.");
      return;
    }

    await updatePutawayRecordLines(recordId, (lines) => {
      if (!lines[lineIndex]) return lines;
      lines[lineIndex] = normalizePutawayLineForSave({
        ...lines[lineIndex],
        itemNumber: $(`putawayLine_${rowKey}_item`)?.value || "",
        quantity: $(`putawayLine_${rowKey}_qty`)?.value || 0,
        binLocation: $(`putawayLine_${rowKey}_bin`)?.value || "",
        submittedDate: dateValue,
        workDate: dateValue,
        submittedAt,
        submittedTime: formatSubmittedTime(submittedAt),
        notes: $(`putawayLine_${rowKey}_notes`)?.value || ""
      }, lineIndex);
      return lines;
    });

    closePutawayDailyModal();
    toast("Putaway line updated. Date/time and gaps recalculated.");
  };

  window.getPutawayRecordsByDateRange = function getPutawayRecordsByDateRangeFixed(records, startDate, endDate, options = {}) {
    const start = normalizeLeaderboardDate(startDate);
    const end = normalizeLeaderboardDate(endDate);
    const includeUndated = Boolean(options.includeUndated || (!start && !end));

    return (records || []).flatMap((rawRecord) => {
      const record = normalizePutawayRecord(rawRecord);
      const sourceLines = Array.isArray(record.lines) ? record.lines : [];

      if (!sourceLines.length) {
        const recordDate = getRecordDate(record);
        if (!recordDate) return includeUndated ? [record] : [];
        if (start && recordDate < start) return [];
        if (end && recordDate > end) return [];
        return [record];
      }

      const matchingLines = sourceLines.filter((line) => {
        if (line?.active === false) return false;
        const lineDate = editablePutawayDate(line);
        if (!lineDate) return includeUndated;
        if (start && lineDate < start) return false;
        if (end && lineDate > end) return false;
        return true;
      });

      if (!matchingLines.length) return [];

      return [{
        ...record,
        lines: matchingLines,
        totalLines: matchingLines.length,
        lineCount: matchingLines.length,
        totalQty: matchingLines.reduce((sum, line) => sum + numericValue(line?.quantity ?? line?.qty), 0)
      }];
    });
  };

  window.calculatePutawayStats = function calculatePutawayStatsFixed(records) {
    const byEmployee = new Map();

    (records || []).forEach((record) => {
      const activeLines = (Array.isArray(record?.lines) ? record.lines : []).filter((line) => line?.active !== false);
      const fallbackEmployee = normalizeEmployeeName(record?.employeeName || record?.worker || record?.employee);

      if (!activeLines.length) {
        const employee = fallbackEmployee;
        const entry = byEmployee.get(employee) || { employee, totalLines: 0, ticketIds: new Set(), dates: new Set() };
        const count = normalizedLineCount(record);
        entry.totalLines += count;
        entry.ticketIds.add(String(record?.id || `${employee}|${getRecordDate(record)}`));
        const date = getRecordDate(record);
        if (date) entry.dates.add(date);
        byEmployee.set(employee, entry);
        return;
      }

      activeLines.forEach((line) => {
        const employee = normalizeEmployeeName(line?.employeeName || line?.worker || fallbackEmployee);
        const entry = byEmployee.get(employee) || { employee, totalLines: 0, ticketIds: new Set(), dates: new Set() };
        entry.totalLines += 1;
        entry.ticketIds.add(String(record?.id || `${employee}|${editablePutawayDate(line)}`));
        const lineDate = editablePutawayDate(line);
        if (lineDate) entry.dates.add(lineDate);
        byEmployee.set(employee, entry);
      });
    });

    const rows = [...byEmployee.values()].map((entry) => {
      const sortedDates = [...entry.dates].sort();
      return {
        employee: entry.employee,
        totalLines: entry.totalLines,
        totalTickets: entry.ticketIds.size,
        averageLinesPerDay: entry.dates.size ? entry.totalLines / entry.dates.size : 0,
        lastActivityDate: sortedDates.length ? sortedDates[sortedDates.length - 1] : "Unknown"
      };
    });

    return sortLeaderboardRows(rows, "totalLines");
  };

  document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelector("nav.tabs");
    if (!tabs) return;

    const addLink = (href, label, key) => {
      if (tabs.querySelector(`[data-page-link="${key}"]`)) return;
      const link = document.createElement("a");
      link.href = href;
      link.className = "tab";
      link.dataset.pageLink = key;
      link.textContent = label;
      link.setAttribute("aria-label", `Open ${label}`);
      tabs.appendChild(link);
    };

    addLink("production.html", "Receiving Production", "receiving-production");
    addLink("po-checking.html", "PO Checking", "po-checking");
  });
})();
