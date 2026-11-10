"use strict";
/* Embedded aisle breakdown for Cycle Count Detail imports. Counts are based
 * on actual Bin #, not the batch's employee/aisle code. */
(() => {
  const AISLES = [..."ABCDEFGHIJKL", ..."ABCDEFG".split("").map(c => "X" + c)];
  const AISLE_SET = new Set(AISLES);
  const countNumber = value => {
    const num = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  };
  const normalizeHeader = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g," ");
  const aisleFromBin = value => {
    const raw = String(value ?? "").trim().toUpperCase();
    const match = raw.match(/^([A-Z]{1,2})(?=[\s-]|\d|$)/);
    return match && AISLE_SET.has(match[1]) ? match[1] : null;
  };
  function readCounts() {
    const counts = Object.fromEntries(AISLES.map(a => [a, { counts:0, rows:0, bins:new Set() }]));
    let other = 0, total = 0;
    if (!state.workbook || !$("sourceSheet")?.value) return {counts,total,other};
    const matrix = workbookMatrix(state.workbook, $("sourceSheet").value);
    let column = {date:-1,bin:-1,times:-1};
    for (const row of matrix) {
      const head = row.map(normalizeHeader);
      const binIndex = head.findIndex(h => h === "bin" || h === "bin ");
      const binHashIndex = head.findIndex(h => h === "bin " || h === "bin");
      const detectedBin = head.findIndex(h => /^bin( |$)/.test(h));
      const detectedTimes = head.findIndex(h => h === "times counted");
      const detectedDate = head.findIndex(h => h === "count date");
      if (detectedBin >= 0 && detectedTimes >= 0 && detectedDate >= 0) {
        column = {date:detectedDate,bin:detectedBin,times:detectedTimes};
        continue;
      }
      if (column.bin < 0) continue;
      const bin = String(row[column.bin] ?? "").trim();
      const date = String(row[column.date] ?? "").trim();
      const times = countNumber(row[column.times]);
      if (!bin || !date || times === 0 || /^count date$/i.test(date)) continue;
      const aisle = aisleFromBin(bin);
      total += times;
      if (aisle) {
        counts[aisle].counts += times;
        counts[aisle].rows += 1;
        counts[aisle].bins.add(bin.toUpperCase());
      } else other += times;
    }
    return {counts,total,other};
  }
  function renderAisleBreakdown() {
    const section = $("aisleBreakdown");
    if (!section) return;
    const {counts,total,other} = readCounts();
    section.classList.toggle("hidden", !state.workbook);
    if (!state.workbook) return;
    const tracked = AISLES.reduce((sum,a) => sum+counts[a].counts,0);
    $("aisleBreakdownStatus").textContent = total.toLocaleString()+" completed counts";
    $("aisleBreakdownTotals").innerHTML =
      '<div class="kpi"><span>A–L + XA–XG counts</span><strong>'+tracked.toLocaleString()+'</strong></div>'+
      '<div class="kpi"><span>Other location counts</span><strong>'+other.toLocaleString()+'</strong></div>'+
      '<div class="kpi"><span>Total count actions</span><strong>'+total.toLocaleString()+'</strong></div>';
    $("aisleBreakdownRows").innerHTML = AISLES.map(a => {
      const item=counts[a], pct=total ? item.counts/total*100 : 0;
      return '<tr><td><strong>'+a+'</strong></td><td>'+item.counts.toLocaleString()+
        '</td><td>'+item.bins.size.toLocaleString()+'</td><td>'+
        pct.toFixed(1)+'%<div class="aisle-share-meter"><span style="width:'+
        Math.min(pct,100)+'%"></span></div></td></tr>';
    }).join("");
  }
  const previousCalculate = calculateProduction;
  calculateProduction = function calculateProductionWithAisleBreakdown(...args) {
    const result = previousCalculate.apply(this,args);
    renderAisleBreakdown();
    return result;
  };
  $("sourceSheet")?.addEventListener("change", renderAisleBreakdown);
  $("branchSelect")?.addEventListener("change", renderAisleBreakdown);
  renderAisleBreakdown();
})();
