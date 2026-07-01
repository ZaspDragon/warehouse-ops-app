const $ = (id) => document.getElementById(id);

const DEMO_STORAGE_KEY = "warehouseOpsDemoStateV1";
const TIMER_STORAGE_KEY = "warehouseOpsReceivingTimerV1";
const SETTINGS_STORAGE_KEY = "warehouseOpsSettingsV1";
const TERMS_STORAGE_KEY = "warehouseOpsTermsAcceptanceV1";
const PUTAWAY_DRAFT_KEY = "warehouseos_putaway_draft_v1";
const PUTAWAY_AUTOSAVE_DELAY_MS = 400;
const TERMS_VERSION = "warehouseos-legal-2026-v1";
const CYCLE_TIMER_KEY = "warehouseOps_cycleCountTimers_v1";
const CYCLE_AUDIT_KEY = "warehouseOps_cycleCountAudit_v1";
const CYCLE_PRODUCTION_KEY = "warehouseOps_cycleCountProduction_v1";
const COUNT_CREATION_KEY = "warehouseOps_countCreationLog_v1";
const VARIANCE_RESEARCH_KEY = "warehouseOps_varianceResearchLog_v1";
const HOLD_BATCH_KEY = "warehouseOps_holdBatchLog_v1";
const HIGH_RISK_KEY = "warehouseOps_highRiskInventory_v1";
const ROOT_CAUSE_KEY = "warehouseOps_rootCauseLog_v1";
const DATA_BACKUP_META_KEY = "warehouseOps_dataBackups_v1";
const DEMO_PRODUCTION_CLEANUP_KEY = "warehouseOps_demoProductionCleanup_v1";
const ROLE_OWNER_EMAIL = "brandon.evanshine@chadwellsupply.com";
const DAILY_COUNT_GOAL = 200;
const DEMO_PRODUCTION_USER_EMAILS = new Set(["ilevanshine@gmail.com", "putawaysreceiving@gmail.com"]);
const DEMO_USER = {
  uid: "demo-user",
  email: "demo@warehouse-ops-app.local"
};

const state = {
  user: null,
  isDemoMode: false,
  employees: [],
  putawayLogs: [],
  cycleSessions: [],
  pickingSessions: [],
  activityLogs: [],
  itemHistoryRows: [],
  leaderboard: { activeView: "putaway", rows: [], recordCount: 0 },
  timer: readJson(TIMER_STORAGE_KEY, { status: "idle", elapsedMinutes: 0 }),
  settings: readJson(SETTINGS_STORAGE_KEY, { operatorName: "", operatorRole: "worker" }),
  cycleTimers: readArrayJson(CYCLE_TIMER_KEY),
  cycleProduction: readArrayJson(CYCLE_PRODUCTION_KEY),
  countCreationLog: readArrayJson(COUNT_CREATION_KEY),
  varianceResearchLog: readArrayJson(VARIANCE_RESEARCH_KEY),
  holdBatchLog: readArrayJson(HOLD_BATCH_KEY),
  highRiskInventory: readArrayJson(HIGH_RISK_KEY),
  rootCauseLog: readArrayJson(ROOT_CAUSE_KEY),
  cycleAuditLog: readArrayJson(CYCLE_AUDIT_KEY),
  editingHistory: null,
  putawayAutosaveTimer: null
};

let pendingLegalConsent = false;
let storageBackupCreatedThisSession = false;

const COLLECTIONS = {
  employees: "employees",
  putaway: "putAwayLogs",
  cycle: "cycleCountSessions",
  picking: "orderPickingSessions",
  activity: "activityLogs"
};

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Local storage write failed:", err);
  }
}

function readArrayJson(key) {
  const value = readJson(key, []);
  return Array.isArray(value) ? value : [];
}

document.addEventListener("DOMContentLoaded", () => {
  setTodayDefaults();
  buildAllTables();
  initializeDataProtection();
  initializeCycleProductionData();
  initializePutawayDraft();
  wireEvents();
  syncLeaderboardDateControls();
  syncSettingsUi();
  renderReceivingTimer();
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
  window.setInterval(renderReceivingTimer, 1000);
  window.setInterval(renderCyclePacketTimer, 1000);
  watchAuth();
  if (new URLSearchParams(window.location.search).get("demo") === "1") {
    enterDemoMode({ silent: true });
  }
});

function setTodayDefaults() {
  const today = todayValue();

  ["putDate", "cycleDate", "pickDate", "cycleTimerDate", "creationDate", "varianceDate", "holdDate", "riskDate"].forEach((id) => {
    if ($(id)) $(id).value = today;
  });
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function initializePutawayDraft() {
  restorePutawayDraft();
  updatePutawayStats();
}

function putawayDraftRows() {
  return [...document.querySelectorAll("#putawayBody tr")];
}

function collectPutawayDraft() {
  return {
    worker: $("putWorker")?.value.trim() || "",
    date: $("putDate")?.value || "",
    dockToStockMinutes: calculateDockToStock(),
    updatedAt: new Date().toISOString(),
    lines: putawayDraftRows().map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".put-item"),
      qty: rowValue(row, ".put-qty"),
      location: rowValue(row, ".put-location"),
      notes: rowValue(row, ".put-notes")
    }))
  };
}

function hasPutawayDraftData(draft = collectPutawayDraft()) {
  const hasLines = (draft.lines || []).some((line) =>
    [line.item, line.qty, line.location, line.notes].some((value) => String(value || "").trim())
  );

  return Boolean(
    (draft.worker || "").trim() ||
      hasLines ||
      ((draft.date || "").trim() && draft.date !== todayValue())
  );
}

function isPutawayDraftField(target) {
  if (!target?.closest) return false;

  if (target.id === "putWorker" || target.id === "putDate") return true;
  return Boolean(target.closest("#putawayBody"));
}

function debouncedSavePutawayDraft() {
  window.clearTimeout(state.putawayAutosaveTimer);
  state.putawayAutosaveTimer = window.setTimeout(() => {
    savePutawayDraft({ statusMessage: "Auto-saved just now" });
  }, PUTAWAY_AUTOSAVE_DELAY_MS);
}

function flushPutawayDraftSave(options = {}) {
  window.clearTimeout(state.putawayAutosaveTimer);
  state.putawayAutosaveTimer = null;
  savePutawayDraft(options);
}

function savePutawayDraft(options = {}) {
  const { statusMessage = "Auto-saved just now" } = options;
  const draft = collectPutawayDraft();

  try {
    window.localStorage.setItem(PUTAWAY_DRAFT_KEY, JSON.stringify(draft));
    setPutawayAutosaveStatus(statusMessage);
    return true;
  } catch (err) {
    console.error("Put Away draft save failed:", err);
    setPutawayAutosaveStatus("Auto-save failed");
    return false;
  }
}

function restorePutawayDraft() {
  if (!putawayDraftRows().length || hasPutawayDraftData()) {
    return false;
  }

  let draft = null;

  try {
    const raw = window.localStorage.getItem(PUTAWAY_DRAFT_KEY);
    draft = raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Put Away draft restore failed:", err);
    setPutawayAutosaveStatus("Auto-save failed");
    return false;
  }

  if (!draft || !hasPutawayDraftData(draft)) {
    setPutawayAutosaveStatus("All changes saved");
    return false;
  }

  if ($("putWorker")) $("putWorker").value = draft.worker || "";
  if ($("putDate")) $("putDate").value = draft.date || todayValue();

  putawayDraftRows().forEach((row, idx) => {
    const line = draft.lines?.[idx] || {};
    setRowValue(row, ".put-item", line.item || "");
    setRowValue(row, ".put-qty", line.qty || "");
    setRowValue(row, ".put-location", line.location || "");
    setRowValue(row, ".put-notes", line.notes || "");
  });

  updatePutawayStats();
  setPutawayAutosaveStatus("Draft restored");
  return true;
}

function clearPutawayDraft(options = {}) {
  const { keepStatus = false } = options;

  window.clearTimeout(state.putawayAutosaveTimer);
  state.putawayAutosaveTimer = null;

  try {
    window.localStorage.removeItem(PUTAWAY_DRAFT_KEY);
  } catch (err) {
    console.error("Put Away draft clear failed:", err);
  }

  if (!keepStatus) {
    setPutawayAutosaveStatus("All changes saved");
  }
}

function setPutawayAutosaveStatus(message) {
  const el = $("putawayAutosaveStatus");
  if (!el) return;

  el.textContent = message;
  el.dataset.state = /failed/i.test(message)
    ? "error"
    : /restored/i.test(message)
      ? "info"
      : "saved";
}

function wireEvents() {
  $("loginBtn")?.addEventListener("click", login);
  $("demoLoginBtn")?.addEventListener("click", () => {
    if (!hasLoginConsent()) {
      setLoginMessage("You must agree to the Terms of Use and Privacy Policy.");
      return;
    }

    enterDemoMode({ consentGiven: true });
  });
  $("resetPasswordBtn")?.addEventListener("click", resetPassword);
  $("logoutBtn")?.addEventListener("click", logoutCurrentUser);
  $("resetDemoBtn")?.addEventListener("click", () => resetDemoData());

  $("startReceivingTimerBtn")?.addEventListener("click", startReceivingTimer);
  $("stopReceivingTimerBtn")?.addEventListener("click", stopReceivingTimer);
  $("resetReceivingTimerBtn")?.addEventListener("click", resetReceivingTimer);

  $("loadCycleFileBtn")?.addEventListener("click", loadCycleCountFile);
  $("exportCurrentCycleBtn")?.addEventListener("click", exportCurrentCycle);
  $("startCyclePacketBtn")?.addEventListener("click", startCyclePacket);
  $("finishCyclePacketBtn")?.addEventListener("click", finishCyclePacket);
  $("addCycleDelayBtn")?.addEventListener("click", addCycleDelayNote);
  $("resetCyclePacketBtn")?.addEventListener("click", resetCyclePacketBySupervisor);
  $("voidCyclePacketBtn")?.addEventListener("click", voidCyclePacketBySupervisor);
  $("applyProductionFiltersBtn")?.addEventListener("click", renderCycleProductionDashboard);
  $("clearProductionFiltersBtn")?.addEventListener("click", clearProductionFilters);
  $("saveCreationLogBtn")?.addEventListener("click", saveCountCreationLog);
  $("saveVarianceLogBtn")?.addEventListener("click", saveVarianceResearchLog);
  $("saveHoldBatchBtn")?.addEventListener("click", saveHoldBatchLog);
  $("saveHighRiskBtn")?.addEventListener("click", saveHighRiskInventory);
  $("rollbackCycleProductionBtn")?.addEventListener("click", rollbackLatestWarehouseOpsBackup);
  $("loadPickFileBtn")?.addEventListener("click", loadPickTicketFile);
  $("exportCurrentPickingBtn")?.addEventListener("click", exportCurrentPicking);

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("addEmployeeBtn")?.addEventListener("click", addEmployee);

  $("savePutawayBtn")?.addEventListener("click", savePutaway);
  $("clearPutawayBtn")?.addEventListener("click", confirmClearPutawayForm);

  $("saveCycleBtn")?.addEventListener("click", saveCycle);
  $("clearCycleBtn")?.addEventListener("click", () => clearRows("cycleBody"));

  $("savePickingBtn")?.addEventListener("click", savePicking);
  $("clearPickingBtn")?.addEventListener("click", () => clearRows("pickingBody"));

  $("refreshHistoryBtn")?.addEventListener("click", loadHistory);
  $("exportHistoryBtn")?.addEventListener("click", () => exportCsv("history"));
  $("searchItemHistoryBtn")?.addEventListener("click", renderItemHistory);
  $("exportItemHistoryBtn")?.addEventListener("click", exportItemHistory);
  $("leaderboardRangePreset")?.addEventListener("change", syncLeaderboardDateControls);
  $("leaderboardStartDate")?.addEventListener("change", renderLeaderboard);
  $("leaderboardEndDate")?.addEventListener("change", renderLeaderboard);
  $("leaderboardSearch")?.addEventListener("input", renderLeaderboard);
  $("exportLeaderboardBtn")?.addEventListener("click", exportLeaderboardCsv);
  $("saveSettingsBtn")?.addEventListener("click", saveSettings);
  $("legalConsent")?.addEventListener("change", syncLoginConsent);
  $("termsAgree")?.addEventListener("change", () => {
    if ($("acceptTermsBtn")) $("acceptTermsBtn").disabled = !$("termsAgree").checked;
  });
  $("acceptTermsBtn")?.addEventListener("click", acceptTerms);
  $("declineTermsBtn")?.addEventListener("click", declineTerms);
  $("closeHistoryModalBtn")?.addEventListener("click", closeHistoryModal);
  $("saveHistoryEditBtn")?.addEventListener("click", saveHistoryEdit);
  $("deleteHistoryRecordBtn")?.addEventListener("click", deleteHistoryRecord);

  document.querySelectorAll(".exportBtn").forEach((btn) => {
    btn.addEventListener("click", () => exportCsv(btn.dataset.export));
  });

  document.querySelectorAll(".productionExportBtn").forEach((btn) => {
    btn.addEventListener("click", () => exportProductionCsv(btn.dataset.export));
  });

  document.querySelectorAll(".leaderboard-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchLeaderboardView(btn.dataset.leaderboardView));
  });

  document.addEventListener("input", (e) => {
    if (isPutawayDraftField(e.target)) {
      if (e.target.closest("#putawayBody")) updatePutawayStats();
      savePutawayDraft({ statusMessage: "Auto-saved just now" });
    }
    if (e.target.closest("#cycleBody")) updateCycleStats();
    if (e.target.id === "cycleWorker" && $("cycleTimerEmployee")) $("cycleTimerEmployee").value = e.target.value;
    if (e.target.id === "cycleId" && $("cycleTimerCountId")) $("cycleTimerCountId").value = e.target.value;
    if (e.target.id === "cycleDate" && $("cycleTimerDate")) $("cycleTimerDate").value = e.target.value;

    if (e.target.closest("#pickingBody")) {
      if (e.target.classList.contains("pick-picked") || e.target.classList.contains("pick-required")) {
        autoStatusForRow(e.target.closest("tr"));
      }

      updatePickingStats();
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "cycleWorker" && $("cycleTimerEmployee")) $("cycleTimerEmployee").value = e.target.value;
    if (e.target.id === "cycleId" && $("cycleTimerCountId")) $("cycleTimerCountId").value = e.target.value;
    if (e.target.id === "cycleDate" && $("cycleTimerDate")) $("cycleTimerDate").value = e.target.value;
    if (isPutawayDraftField(e.target)) {
      updatePutawayStats();
      savePutawayDraft({ statusMessage: "All changes saved" });
    }
    if (e.target.closest("#pickingBody")) updatePickingStats();
    if (e.target.closest("#cycleBody")) updateCycleStats();
  });

  document.addEventListener("click", (e) => {
    const startItemBtn = e.target.closest(".startItemTimerBtn");
    if (startItemBtn) {
      startCycleItemTimer(startItemBtn.closest("tr"));
      return;
    }

    const endItemBtn = e.target.closest(".endItemTimerBtn");
    if (endItemBtn) {
      endCycleItemTimer(endItemBtn.closest("tr"));
      return;
    }

    const reviewBtn = e.target.closest(".delayReviewBtn");
    if (reviewBtn) {
      reviewDelayNote(reviewBtn.dataset.timerId, reviewBtn.dataset.delayId, reviewBtn.dataset.status);
    }
  });

  document.addEventListener(
    "blur",
    (e) => {
      if (isPutawayDraftField(e.target)) {
        flushPutawayDraftSave();
      }
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPutawayDraftSave({ force: true, statusMessage: "All changes saved" });
    }
  });

  window.addEventListener("pagehide", () => {
    flushPutawayDraftSave({ force: true, statusMessage: "All changes saved" });
  });

  window.addEventListener("beforeunload", () => {
    flushPutawayDraftSave({ force: true, statusMessage: "All changes saved" });
  });

  syncLoginConsent();
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.remove("active");
  });

  const panel = $(`${tab}Tab`);
  if (panel) panel.classList.add("active");

  if (tab === "putaway") restorePutawayDraft();
  if (tab === "history") loadHistory();
  if (tab === "itemHistory") renderItemHistory();
  if (tab === "leaderboard") renderLeaderboard();
  if (tab === "settings") syncSettingsUi();
  if (tab === "cycleProduction") renderCycleProductionDashboard();
}

function legalUserId(user = state.user) {
  return String(user?.uid || user?.email || "");
}

function hasAcceptedTerms(user = state.user) {
  const record = readJson(TERMS_STORAGE_KEY, null);
  return Boolean(
    record?.accepted &&
    record.version === TERMS_VERSION &&
    record.userId === legalUserId(user)
  );
}

function hasLoginConsent() {
  return Boolean($("legalConsent")?.checked);
}

function syncLoginConsent() {
  const accepted = hasLoginConsent();
  if ($("loginBtn")) $("loginBtn").disabled = !accepted;
  if ($("demoLoginBtn")) $("demoLoginBtn").disabled = !accepted;
}

function resetLoginConsent() {
  if ($("legalConsent")) $("legalConsent").checked = false;
  syncLoginConsent();
}

function showTermsModal() {
  if (hasAcceptedTerms(state.user)) return;
  if ($("termsAgree")) $("termsAgree").checked = false;
  if ($("acceptTermsBtn")) $("acceptTermsBtn").disabled = true;
  $("termsModal")?.classList.remove("hidden");
  $("termsModal")?.setAttribute("aria-hidden", "false");
}

function hideTermsModal() {
  $("termsModal")?.classList.add("hidden");
  $("termsModal")?.setAttribute("aria-hidden", "true");
}

async function recordTermsAcceptance(user = state.user) {
  const record = {
    accepted: true,
    version: TERMS_VERSION,
    acceptedAt: new Date().toISOString(),
    userEmail: user?.email || "",
    userId: legalUserId(user)
  };

  writeJson(TERMS_STORAGE_KEY, record);

  if (!state.isDemoMode && user?.uid && window.db) {
    try {
      const acceptanceId = `${user.uid}_${TERMS_VERSION}`;
      await db.collection("termsAcceptances").doc(acceptanceId).set({
        ...record,
        userAgent: navigator.userAgent,
        termsSummary: "WarehouseOS Terms of Use and Privacy Policy accepted."
      }, { merge: true });
      writeJson(TERMS_STORAGE_KEY, { ...record, serverAcceptanceId: acceptanceId });
    } catch (err) {
      console.warn("Terms acceptance saved locally only:", err);
    }
  }

  return record;
}

async function acceptTerms() {
  if (!$("termsAgree")?.checked) return;

  await recordTermsAcceptance(state.user);
  hideTermsModal();

  if (!state.isDemoMode && state.user) {
    await loadAllData();
  }
}

function declineTerms() {
  alert("You must accept the terms before using WarehouseOS.");
  logoutCurrentUser();
}

function watchAuth() {
  auth.onAuthStateChanged(async (user) => {
    if (state.isDemoMode) return;

    state.user = user;
    syncShell();

    if (user) {
      if (pendingLegalConsent) {
        await recordTermsAcceptance(user);
        pendingLegalConsent = false;
        resetLoginConsent();
      }

      if (!hasAcceptedTerms(user)) {
        clearLoadedState();
        showTermsModal();
        return;
      }

      hideTermsModal();
      await loadAllData();
      return;
    }

    pendingLegalConsent = false;
    hideTermsModal();
    clearLoadedState();
  });
}

function syncShell() {
  const signedIn = !!state.user;

  $("loginPanel")?.classList.toggle("hidden", signedIn);
  $("appPanel")?.classList.toggle("hidden", !signedIn);
  $("logoutBtn")?.classList.toggle("hidden", !signedIn);
  $("demoBanner")?.classList.toggle("hidden", !state.isDemoMode);

  if ($("logoutBtn")) {
    $("logoutBtn").textContent = state.isDemoMode ? "Exit Demo" : "Logout";
  }

  if ($("userBadge")) {
    $("userBadge").textContent = state.isDemoMode
      ? "Demo Mode"
      : state.user?.email || "Signed out";
  }

  document.body.classList.toggle("demo-mode", state.isDemoMode);
  syncSettingsUi();
  if (signedIn) restorePutawayDraft();
}

function clearLoadedState() {
  state.employees = [];
  state.putawayLogs = [];
  state.cycleSessions = [];
  state.pickingSessions = [];
  state.activityLogs = [];

  resetWorkingForms();
  renderEmployees();
  renderLogs();
  renderHistory();
  renderItemHistory();
  populateEmployeeDropdowns();
}

function resetWorkingForms() {
  clearRows("putawayBody");
  clearRows("cycleBody");
  clearRows("pickingBody");
  setTodayDefaults();

  if ($("cycleId")) $("cycleId").value = "";
  if ($("pickOrder")) $("pickOrder").value = "";
}

function logoutCurrentUser() {
  if (state.isDemoMode) {
    exitDemoMode();
    return;
  }

  auth.signOut();
}

function enterDemoMode(options = {}) {
  const { silent = false, consentGiven = false } = options;
  const savedState = readDemoState();

  state.isDemoMode = true;
  state.user = { ...DEMO_USER };

  if (savedState) {
    applyDemoState(savedState);
  } else {
    applyDemoState(buildDemoState());
    persistDemoState();
  }

  resetWorkingForms();
  syncShell();
  switchTab("putaway");
  setLoginMessage("");
  updateDemoUrl(true);

  if (consentGiven) {
    recordTermsAcceptance(state.user);
    resetLoginConsent();
    hideTermsModal();
  } else if (!hasAcceptedTerms(state.user)) {
    showTermsModal();
  }

  if (!silent) {
    toast("Demo mode loaded.");
  }
}

function exitDemoMode() {
  state.isDemoMode = false;
  state.user = auth.currentUser || null;

  syncShell();
  if (state.user && hasAcceptedTerms(state.user)) {
    loadAllData();
  } else if (state.user) {
    clearLoadedState();
    showTermsModal();
  } else {
    clearLoadedState();
  }

  setLoginMessage("Demo mode ended.");
  updateDemoUrl(false);
}

function resetDemoData(options = {}) {
  if (!state.isDemoMode) return;

  const { silent = false } = options;
  applyDemoState(buildDemoState());
  resetWorkingForms();
  persistDemoState();
  switchTab("putaway");

  if (!silent) {
    toast("Demo data reset.");
  }
}

function updateDemoUrl(enabled) {
  const url = new URL(window.location.href);

  if (enabled) {
    url.searchParams.set("demo", "1");
  } else {
    url.searchParams.delete("demo");
  }

  window.history.replaceState({}, "", url);
}

function persistDemoState() {
  if (!state.isDemoMode) return;

  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(snapshotDemoState()));
  } catch (err) {
    console.warn("Demo state persist failed:", err);
  }
}

function readDemoState() {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed?.employees)) {
      return null;
    }

    return {
      employees: parsed.employees || [],
      putawayLogs: parsed.putawayLogs || [],
      cycleSessions: parsed.cycleSessions || [],
      pickingSessions: parsed.pickingSessions || [],
      activityLogs: parsed.activityLogs || [],
      cycleTimers: parsed.cycleTimers || null,
      cycleProduction: parsed.cycleProduction || null,
      countCreationLog: parsed.countCreationLog || null,
      varianceResearchLog: parsed.varianceResearchLog || null,
      holdBatchLog: parsed.holdBatchLog || null,
      highRiskInventory: parsed.highRiskInventory || null,
      rootCauseLog: parsed.rootCauseLog || null,
      cycleAuditLog: parsed.cycleAuditLog || null
    };
  } catch (err) {
    console.warn("Demo state load failed:", err);
    return null;
  }
}

function snapshotDemoState() {
  return {
    employees: state.employees,
    putawayLogs: state.putawayLogs,
    cycleSessions: state.cycleSessions,
    pickingSessions: state.pickingSessions,
    activityLogs: state.activityLogs,
    cycleTimers: state.cycleTimers,
    cycleProduction: state.cycleProduction,
    countCreationLog: state.countCreationLog,
    varianceResearchLog: state.varianceResearchLog,
    holdBatchLog: state.holdBatchLog,
    highRiskInventory: state.highRiskInventory,
    rootCauseLog: state.rootCauseLog,
    cycleAuditLog: state.cycleAuditLog
  };
}

function applyDemoState(data) {
  state.employees = data.employees || [];
  state.putawayLogs = sortByCreatedAtDesc(data.putawayLogs || []);
  state.cycleSessions = sortByCreatedAtDesc(data.cycleSessions || []);
  state.pickingSessions = sortByCreatedAtDesc(data.pickingSessions || []);
  state.activityLogs = sortByCreatedAtDesc(data.activityLogs || []);
  applyDemoCycleProductionState(data);

  renderEmployees();
  renderLogs();
  renderHistory();
  renderItemHistory();
  populateEmployeeDropdowns();
}

function applyDemoCycleProductionState(data = {}) {
  const fallback = buildDemoCycleProductionState();
  state.cycleTimers = Array.isArray(data.cycleTimers) ? data.cycleTimers : fallback.cycleTimers;
  state.cycleProduction = Array.isArray(data.cycleProduction) ? data.cycleProduction : fallback.cycleProduction;
  state.countCreationLog = Array.isArray(data.countCreationLog) ? data.countCreationLog : fallback.countCreationLog;
  state.varianceResearchLog = Array.isArray(data.varianceResearchLog) ? data.varianceResearchLog : fallback.varianceResearchLog;
  state.holdBatchLog = Array.isArray(data.holdBatchLog) ? data.holdBatchLog : fallback.holdBatchLog;
  state.highRiskInventory = Array.isArray(data.highRiskInventory) ? data.highRiskInventory : fallback.highRiskInventory;
  state.rootCauseLog = Array.isArray(data.rootCauseLog) ? data.rootCauseLog : fallback.rootCauseLog;
  state.cycleAuditLog = Array.isArray(data.cycleAuditLog) ? data.cycleAuditLog : fallback.cycleAuditLog;
}

function buildDemoState() {
  const employees = [
    createDemoEmployee("emp-ava", "Ava Patel", "Put Away", true, 9),
    createDemoEmployee("emp-diego", "Diego Martinez", "Cycle Count", true, 7),
    createDemoEmployee("emp-jordan", "Jordan Lee", "Order Picking", true, 6),
    createDemoEmployee("emp-maya", "Maya Chen", "Lead", true, 12),
    createDemoEmployee("emp-noah", "Noah Brooks", "Order Picking", false, 4)
  ];

  const putawayLogs = [
    {
      id: "put-demo-1",
      worker: "Ava Patel",
      date: demoDate(0),
      dockToStockMinutes: 46,
      lines: [
        { line: 1, item: "SKU-4401", qty: 24, location: "A1-04", notes: "Top rack reserve" },
        { line: 2, item: "SKU-1188", qty: 12, location: "B2-09", notes: "Fast mover refill" },
        { line: 3, item: "SKU-7720", qty: 18, location: "C1-02", notes: "Received sealed" }
      ],
      lineCount: 3,
      totalQty: 54,
      createdAt: demoTimestamp(0, 8, 4)
    },
    {
      id: "put-demo-2",
      worker: "Maya Chen",
      date: demoDate(1),
      dockToStockMinutes: 52,
      lines: [
        { line: 1, item: "SKU-9042", qty: 8, location: "D4-01", notes: "Overflow pallet" },
        { line: 2, item: "SKU-2207", qty: 30, location: "A3-07", notes: "Split between cases" }
      ],
      lineCount: 2,
      totalQty: 38,
      createdAt: demoTimestamp(1, 14, 2)
    }
  ];

  const cycleSessions = [
    {
      id: "cycle-demo-1",
      counter: "Diego Martinez",
      date: demoDate(0),
      countId: "COUNT-0531-A",
      lines: [
        {
          line: 1,
          item: "SKU-1188",
          description: "24in Packing Tape",
          location: "B2-09",
          systemQty: 48,
          countedQty: 48,
          variance: 0,
          reason: "Count Verified",
          done: true
        },
        {
          line: 2,
          item: "SKU-7720",
          description: "Dock Seal Kit",
          location: "C1-02",
          systemQty: 22,
          countedQty: 20,
          variance: -2,
          reason: "Short Pick",
          done: true
        },
        {
          line: 3,
          item: "SKU-5521",
          description: "Safety Gloves Large",
          location: "E1-03",
          systemQty: 36,
          countedQty: 36,
          variance: 0,
          reason: "Count Verified",
          done: true
        }
      ],
      lineCount: 3,
      varianceLines: 1,
      createdAt: demoTimestamp(0, 10, 35)
    },
    {
      id: "cycle-demo-2",
      counter: "Maya Chen",
      date: demoDate(2),
      countId: "COUNT-0529-B",
      lines: [
        {
          line: 1,
          item: "SKU-2207",
          description: "Stretch Wrap",
          location: "A3-07",
          systemQty: 15,
          countedQty: 17,
          variance: 2,
          reason: "Receiving Error",
          done: true
        }
      ],
      lineCount: 1,
      varianceLines: 1,
      createdAt: demoTimestamp(2, 15, 22)
    }
  ];

  const pickingSessions = [
    {
      id: "pick-demo-1",
      picker: "Jordan Lee",
      date: demoDate(0),
      orderNumber: "SXFR205813",
      lines: [
        {
          line: 1,
          item: "SKU-4401",
          description: "Blue Tote 18L",
          slot: "A1-04",
          fromSlot: "A1-04",
          requiredQty: 10,
          availableQty: 14,
          pickedQty: 10,
          remainingQty: 0,
          status: "Picked",
          uom: "EA",
          notes: ""
        },
        {
          line: 2,
          item: "SKU-9042",
          description: "Pallet Corner Boards",
          slot: "D4-01",
          fromSlot: "D4-01",
          requiredQty: 6,
          availableQty: 5,
          pickedQty: 5,
          remainingQty: 1,
          status: "Short",
          uom: "EA",
          notes: "1 short, waiting replenishment"
        },
        {
          line: 3,
          item: "SKU-5521",
          description: "Safety Gloves Large",
          slot: "E1-03",
          fromSlot: "E1-03",
          requiredQty: 12,
          availableQty: 18,
          pickedQty: 12,
          remainingQty: 0,
          status: "Picked",
          uom: "PR",
          notes: ""
        }
      ],
      lineCount: 3,
      totalPicked: 27,
      issueLines: 1,
      createdAt: demoTimestamp(0, 13, 42)
    },
    {
      id: "pick-demo-2",
      picker: "Noah Brooks",
      date: demoDate(1),
      orderNumber: "SO2405308",
      lines: [
        {
          line: 1,
          item: "SKU-1188",
          description: "24in Packing Tape",
          slot: "B2-09",
          fromSlot: "B2-09",
          requiredQty: 20,
          availableQty: 24,
          pickedQty: 18,
          remainingQty: 2,
          status: "Partial",
          uom: "EA",
          notes: "Last two held for QA"
        }
      ],
      lineCount: 1,
      totalPicked: 18,
      issueLines: 1,
      createdAt: demoTimestamp(1, 16, 10)
    }
  ];

  return {
    employees,
    putawayLogs,
    cycleSessions,
    pickingSessions,
    activityLogs: buildDemoActivityLogs(putawayLogs, cycleSessions, pickingSessions),
    ...buildDemoCycleProductionState()
  };
}

function createDemoEmployee(id, name, role, active, daysAgo) {
  return {
    id,
    name,
    role,
    active,
    createdAt: demoTimestamp(daysAgo, 9, 0),
    createdBy: DEMO_USER.uid,
    createdByEmail: DEMO_USER.email
  };
}

function buildDemoActivityLogs(putawayLogs, cycleSessions, pickingSessions) {
  const activityLogs = [
    ...putawayLogs.flatMap((session) => createActivityEntries("putaway", session, session.lines, session.createdAt)),
    ...cycleSessions.flatMap((session) => createActivityEntries("cycleCount", session, session.lines, session.createdAt)),
    ...pickingSessions.flatMap((session) => createActivityEntries("orderPicking", session, session.lines, session.createdAt))
  ];

  return sortByCreatedAtDesc(activityLogs);
}

function demoDate(daysAgo) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function demoDateTimeLocal(daysAgo, hours, minutes) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return formatDateTimeLocal(date);
}

function demoTimestamp(daysAgo, hours, minutes) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function formatDateTimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sortByCreatedAtDesc(rows) {
  return [...rows].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function createLocalId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function login() {
  if (state.isDemoMode) {
    state.isDemoMode = false;
    updateDemoUrl(false);
  }

  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value;

  if (!email || !password) return setLoginMessage("Enter email and password.");
  if (!hasLoginConsent()) {
    return setLoginMessage("You must agree to the Terms of Use and Privacy Policy.");
  }

  try {
    pendingLegalConsent = true;
    await auth.signInWithEmailAndPassword(email, password);
    setLoginMessage("");
  } catch (err) {
    pendingLegalConsent = false;
    setLoginMessage(err.message);
  }
}

async function resetPassword() {
  const email = $("emailInput")?.value.trim();

  if (!email) return setLoginMessage("Enter your email first.");

  try {
    await auth.sendPasswordResetEmail(email);
    setLoginMessage("Password reset email sent.");
  } catch (err) {
    setLoginMessage(err.message);
  }
}

function setLoginMessage(msg) {
  if ($("loginMessage")) $("loginMessage").textContent = msg;
}

function setUploadMessage(msg) {
  if ($("uploadMessage")) $("uploadMessage").textContent = msg;
}

async function loadAllData() {
  if (state.isDemoMode) return;

  try {
    await Promise.all([
      loadCollection(COLLECTIONS.employees, "employees"),
      loadCollection(COLLECTIONS.putaway, "putawayLogs"),
      loadCollection(COLLECTIONS.cycle, "cycleSessions"),
      loadCollection(COLLECTIONS.picking, "pickingSessions"),
      loadCollection(COLLECTIONS.activity, "activityLogs")
    ]);

    renderEmployees();
    renderLogs();
    renderHistory();
    renderItemHistory();
    populateEmployeeDropdowns();
    initializeCycleProductionData();
    renderCyclePacketTimer();
    renderCycleProductionDashboard();
  } catch (err) {
    console.error("Load data failed:", err);
    toast("Load failed: " + err.message);
  }
}

async function loadCollection(collection, key) {
  const snap = await db
    .collection(collection)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  state[key] = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function loadHistory() {
  if (state.isDemoMode) {
    renderHistory();
    toast("History refreshed.");
    return;
  }

  try {
    await loadCollection(COLLECTIONS.activity, "activityLogs");
    renderHistory();
    toast("History refreshed.");
  } catch (err) {
    console.error("History load failed:", err);
    toast("History failed: " + err.message);
  }
}

function currentOperatorName() {
  return state.settings.operatorName || state.user?.email || $("putWorker")?.value || "Warehouse Operator";
}

function isRoleOwner() {
  return String(state.user?.email || "").toLowerCase() === ROLE_OWNER_EMAIL;
}

function canResetTimer() {
  return isRoleOwner() || ["lead", "manager", "admin"].includes(String(state.settings.operatorRole || "").toLowerCase());
}

function timerSeconds() {
  if (!state.timer.startedAt) return Math.round(Number(state.timer.elapsedMinutes || 0) * 60);
  const start = new Date(state.timer.startedAt).getTime();
  const end = state.timer.stoppedAt ? new Date(state.timer.stoppedAt).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 1000));
}

function timerMinutes() {
  return Math.round((timerSeconds() / 60) * 100) / 100;
}

function formatTimer(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hrs, mins, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderReceivingTimer() {
  const minutes = timerMinutes();
  if ($("receivingClock")) $("receivingClock").textContent = formatTimer(timerSeconds());
  if ($("dockToStockStat")) $("dockToStockStat").textContent = minutes;
  if ($("dockToStockSheetStat")) $("dockToStockSheetStat").textContent = minutes;
  if ($("timerStatus")) $("timerStatus").textContent = titleCase(state.timer.status || "idle");
  if ($("timerStartedBy")) $("timerStartedBy").textContent = state.timer.startedByName || "-";
  if ($("timerStartedAt")) $("timerStartedAt").textContent = formatDateTime(state.timer.startedAt);
  if ($("timerStoppedBy")) $("timerStoppedBy").textContent = state.timer.stoppedByName || "-";
  if ($("timerStoppedAt")) $("timerStoppedAt").textContent = formatDateTime(state.timer.stoppedAt);
  if ($("startReceivingTimerBtn")) $("startReceivingTimerBtn").disabled = state.timer.status === "running";
  if ($("stopReceivingTimerBtn")) $("stopReceivingTimerBtn").disabled = state.timer.status !== "running";
  if ($("resetReceivingTimerBtn")) $("resetReceivingTimerBtn").disabled = !canResetTimer();
}

function persistTimer() {
  state.timer.elapsedMinutes = timerMinutes();
  writeJson(TIMER_STORAGE_KEY, state.timer);
}

function startReceivingTimer() {
  if (state.timer.status === "running") return;
  state.timer = {
    status: "running",
    startedAt: new Date().toISOString(),
    startedBy: state.user?.email || "",
    startedByName: currentOperatorName(),
    stoppedAt: "",
    stoppedBy: "",
    stoppedByName: "",
    elapsedMinutes: 0
  };
  persistTimer();
  addReceivingActivity("Started");
  renderReceivingTimer();
}

function stopReceivingTimer() {
  if (state.timer.status !== "running") return;
  state.timer.stoppedAt = new Date().toISOString();
  state.timer.stoppedBy = state.user?.email || "";
  state.timer.stoppedByName = currentOperatorName();
  state.timer.status = "stopped";
  persistTimer();
  addReceivingActivity("Stopped");
  renderReceivingTimer();
}

function resetReceivingTimer() {
  if (!canResetTimer()) return toast("Only a Lead/Admin or Brandon can reset the timer.");
  state.timer = { status: "idle", elapsedMinutes: 0 };
  writeJson(TIMER_STORAGE_KEY, state.timer);
  renderReceivingTimer();
}

function addReceivingActivity(status) {
  const entry = {
    type: "receiving",
    employee: currentOperatorName(),
    date: new Date().toISOString().slice(0, 10),
    item: "",
    description: "Receiving Timer",
    qty: timerMinutes(),
    location: "Dock",
    status,
    notes: `Dock-To-Stock Minutes: ${timerMinutes()}`,
    createdAt: new Date().toISOString(),
    createdBy: state.user?.uid || "",
    createdByEmail: state.user?.email || ""
  };
  state.activityLogs = sortByCreatedAtDesc([entry, ...state.activityLogs]).slice(0, 500);
  if (state.isDemoMode) persistDemoState();
  renderItemHistory();
}

function titleCase(value) {
  return String(value || "").replace(/^\w/, (letter) => letter.toUpperCase());
}

function syncSettingsUi() {
  if (!state.settings.operatorName) {
    state.settings.operatorName = state.user?.email || "";
  }
  if ($("operatorName")) $("operatorName").value = state.settings.operatorName || "";
  if ($("operatorRole")) {
    $("operatorRole").value = state.settings.operatorRole || "worker";
    $("operatorRole").disabled = !isRoleOwner();
  }
  if ($("employeeRole")) $("employeeRole").disabled = !isRoleOwner();
  if ($("roleLockNotice")) {
    $("roleLockNotice").textContent = isRoleOwner()
      ? "Brandon access detected. Role changes are enabled."
      : "Only brandon.evanshine@chadwellsupply.com can change operator roles.";
  }
  renderReceivingTimer();
}

function saveSettings() {
  state.settings.operatorName = $("operatorName")?.value.trim() || state.user?.email || "Warehouse Operator";
  if (isRoleOwner()) {
    state.settings.operatorRole = $("operatorRole")?.value || "worker";
  } else {
    state.settings.operatorRole = "worker";
  }
  writeJson(SETTINGS_STORAGE_KEY, state.settings);
  syncSettingsUi();
  toast("Settings saved.");
}

function calculateDockToStock() {
  const minutes = timerMinutes();
  if ($("dockToStockStat")) $("dockToStockStat").textContent = minutes;
  if ($("dockToStockSheetStat")) $("dockToStockSheetStat").textContent = minutes;
  return minutes;
}

function buildAllTables() {
  buildPutawayRows();
  buildCycleRows();
  buildPickingRows();
}

async function saveActivityLogs(type, sessionDoc, lines) {
  if (!lines.length) return;

  const batch = db.batch();
  const entries = createActivityEntries(type, sessionDoc, lines);

  entries.forEach((entry) => {
    const ref = db.collection(COLLECTIONS.activity).doc();

    batch.set(ref, entry);
  });

  await batch.commit();
}

function createActivityEntries(type, sessionDoc, lines, createdAtBase = Date.now()) {
  return lines.map((line, index) =>
    buildActivityEntry(
      type,
      sessionDoc,
      line,
      typeof createdAtBase === "string"
        ? new Date(new Date(createdAtBase).getTime() - index * 1000).toISOString()
        : new Date(createdAtBase - index * 1000).toISOString()
    )
  );
}

function buildActivityEntry(type, sessionDoc, line, createdAt) {
  return {
    type,
    employee: sessionDoc.worker || sessionDoc.counter || sessionDoc.picker || "",
    date: sessionDoc.date || "",
    item: line.item || "",
    description: line.description || "",
    qty: Number(line.qty || line.pickedQty || line.countedQty || 0),
    systemQty: Number(line.systemQty || 0),
    countedQty: Number(line.countedQty || 0),
    requiredQty: Number(line.requiredQty || 0),
    pickedQty: Number(line.pickedQty || 0),
    remainingQty: Number(line.remainingQty || 0),
    availableQty: Number(line.availableQty || 0),
    variance: Number(line.variance || 0),
    location: line.location || line.slot || line.fromSlot || "",
    uom: line.uom || "",
    dockToStockMinutes: Number(sessionDoc.dockToStockMinutes || 0),
    status: line.status || "",
    reason: line.reason || "",
    notes: line.notes || "",
    createdAt,
    createdBy: state.user?.uid || "",
    createdByEmail: state.user?.email || ""
  };
}

function appendDemoActivityEntries(type, sessionDoc, lines) {
  state.activityLogs = sortByCreatedAtDesc([
    ...createActivityEntries(type, sessionDoc, lines),
    ...state.activityLogs
  ]);
}

function buildPutawayRows() {
  const body = $("putawayBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= 25; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr class="putaway-row">
        <td data-label="Line" class="putaway-line-number">${i}</td>
        <td data-label="Item #"><input class="item-input put-item" placeholder="Item #" /></td>
        <td data-label="Qty"><input class="qty-input put-qty" type="number" min="0" placeholder="Qty" /></td>
        <td data-label="Location"><input class="loc-input put-location" placeholder="Location" /></td>
        <td data-label="Notes"><input class="desc-input put-notes" placeholder="Notes" /></td>
      </tr>
    `
    );
  }
}

function buildCycleRows(rowCount = 25) {
  const body = $("cycleBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= rowCount; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${i}</td>
        <td><input class="item-input cycle-item" placeholder="Item #" /></td>
        <td><input class="desc-input cycle-desc" placeholder="Description" /></td>
        <td><input class="loc-input cycle-location" placeholder="Location" /></td>
        <td><input class="qty-input cycle-system" type="number" min="0" placeholder="System" /></td>
        <td><input class="qty-input cycle-counted" type="number" min="0" placeholder="Counted" /></td>
        <td class="cycle-variance">0</td>
        <td>
          <select class="cycle-reason">
            <option>Count Verified</option>
            <option>Misplaced Inventory</option>
            <option>Short Pick</option>
            <option>Over Pick</option>
            <option>Receiving Error</option>
            <option>Putaway Error</option>
            <option>Transfer Error</option>
            <option>Damage</option>
            <option>Recount Required</option>
          </select>
        </td>
        <td><input class="cycle-done" type="checkbox" /></td>
        <td>
          <div class="row-actions item-timing-actions">
            <button class="startItemTimerBtn" type="button">Start</button>
            <button class="endItemTimerBtn" type="button">End</button>
            <span class="item-minutes">0 min</span>
          </div>
        </td>
        <td>
          <select class="cycle-item-delay">
            <option>Normal</option>
            <option>Mixed Product</option>
            <option>Wrong Bin</option>
            <option>Product Not Found</option>
            <option>Multiple Locations</option>
            <option>Damaged Product</option>
            <option>UOM Issue</option>
            <option>Waiting For Lift</option>
            <option>Waiting For Supervisor</option>
            <option>Hold Batch Research</option>
            <option>Overstock Investigation</option>
            <option>Count Sheet Issue</option>
            <option>GP/System Issue</option>
            <option>Other</option>
          </select>
          <input class="desc-input cycle-item-delay-notes" placeholder="Item delay notes" />
        </td>
      </tr>
    `
    );
  }
}

function buildPickingRows(rowCount = 25) {
  const body = $("pickingBody");
  if (!body) return;

  body.innerHTML = "";

  for (let i = 1; i <= rowCount; i++) {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${i}</td>
        <td><input class="item-input pick-item" placeholder="Item #" /></td>
        <td><input class="desc-input pick-desc" placeholder="Description" /></td>
        <td><input class="loc-input pick-slot" placeholder="From Slot" /></td>
        <td><input class="qty-input pick-required" type="number" min="0" placeholder="Required" /></td>
        <td><input class="qty-input pick-available" type="number" min="0" placeholder="Available" /></td>
        <td><input class="qty-input pick-picked" type="number" min="0" placeholder="Picked" /></td>
        <td class="pick-remaining">0</td>
        <td>
          <select class="pick-status">
            <option>Pending</option>
            <option>Partial</option>
            <option>Picked</option>
            <option>Overpicked</option>
            <option>Short</option>
            <option>Damaged</option>
            <option>Wrong Slot</option>
          </select>
        </td>
        <td><input class="uom-input pick-uom" placeholder="UM" /></td>
        <td><input class="desc-input pick-notes" placeholder="Notes" /></td>
      </tr>
    `
    );
  }
}

/* ---------------------------
   WORKSHEET UPLOADS
---------------------------- */

async function loadCycleCountFile() {
  const file = $("cycleFileUpload")?.files?.[0];

  if (!file) {
    setCycleUploadMessage("Choose a cycle count file first.");
    return toast("Choose a cycle count file first.");
  }

  try {
    const rows = await readWorksheetRows(file);
    const parsedLines = parseCycleUploadRows(rows);

    if (!parsedLines.length) {
      setCycleUploadMessage("No cycle count rows found.");
      return toast("No cycle count rows found.");
    }

    fillCycleTableFromUpload(parsedLines);
    setCycleUploadMessage(`Loaded ${parsedLines.length} cycle count lines from ${file.name}.`);
    toast(`Loaded ${parsedLines.length} cycle count lines.`);
  } catch (err) {
    console.error("Cycle count upload failed:", err);
    setCycleUploadMessage("Upload failed: " + err.message);
    toast("Upload failed: " + err.message);
  }
}

async function readWorksheetRows(file) {
  const extension = file.name.split(".").pop().toLowerCase();

  if (extension === "pdf") {
    const text = await readPdfText(file);
    return text
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s{2,}|\t|,/).map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
  }

  if (typeof XLSX === "undefined") {
    throw new Error("Excel reader failed to load. Refresh the page and try again.");
  }

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false
  });
}

async function readPdfText(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF reader failed to load. Refresh the page and try again.");
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  const text = pages.join("\n").trim();
  if (text) return text;

  if (typeof Tesseract === "undefined") {
    throw new Error("PDF text was empty and OCR is unavailable.");
  }

  const ocrPages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await Tesseract.recognize(canvas, "eng");
    ocrPages.push(result.data.text || "");
  }
  return ocrPages.join("\n");
}

function parseCycleUploadRows(rows) {
  const headerIndex = rows.findIndex((row) => row.map(cleanHeader).some((cell) => cell.includes("ITEM")));
  const headers = (headerIndex >= 0 ? rows[headerIndex] : []).map(cleanHeader);
  const col = buildFlexibleColumnMap(headers);
  const start = headerIndex >= 0 ? headerIndex + 1 : 0;
  const parsed = [];

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const item = getFlexibleCell(row, col, ["ITEM #", "ITEM", "ITEM NUMBER", "SKU"]);
    const description = getFlexibleCell(row, col, ["DESCRIPTION", "DESC"]);
    const location = getFlexibleCell(row, col, ["LOCATION", "BIN", "BIN LOC", "SLOT"]);
    const systemQty = toNumber(getFlexibleCell(row, col, ["SYSTEM QTY", "ON HAND QTY", "ON HAND", "QOH"]));
    const countedQty = toNumber(getFlexibleCell(row, col, ["COUNTED QTY", "COUNT QTY", "COUNTED", "COUNT"]));
    const variance = countedQty - systemQty;
    const reason = getFlexibleCell(row, col, ["REASON", "NOTES"]) || (variance === 0 ? "Count Verified" : "Recount Required");

    if (!item && !description && !location) continue;
    parsed.push({ item, description, location, systemQty, countedQty, variance, reason, done: false });
  }

  return parsed;
}

function buildFlexibleColumnMap(headers) {
  const map = {};
  headers.forEach((header, index) => {
    if (header) map[header] = index;
  });
  return map;
}

function getFlexibleCell(row, col, names) {
  for (const name of names) {
    const key = cleanHeader(name);
    if (col[key] !== undefined) return getCell(row, col[key]);
  }
  return "";
}

function fillCycleTableFromUpload(lines) {
  const rowCount = Math.max(25, lines.length);
  buildCycleRows(rowCount);
  const tableRows = [...document.querySelectorAll("#cycleBody tr")];

  lines.forEach((line, index) => {
    const row = tableRows[index];
    if (!row) return;
    setRowValue(row, ".cycle-item", line.item);
    setRowValue(row, ".cycle-desc", line.description);
    setRowValue(row, ".cycle-location", line.location);
    setRowValue(row, ".cycle-system", line.systemQty);
    setRowValue(row, ".cycle-counted", line.countedQty);
    setRowValue(row, ".cycle-reason", line.reason);
    if (row.querySelector(".cycle-done")) row.querySelector(".cycle-done").checked = Boolean(line.done);
  });

  updateCycleStats();
}

function setCycleUploadMessage(msg) {
  if ($("cycleUploadMessage")) $("cycleUploadMessage").textContent = msg || "";
}

async function loadPickTicketFile() {
  const fileInput = $("pickFileUpload");
  const file = fileInput?.files?.[0];

  if (!file) {
    setUploadMessage("Choose a pick ticket file first.");
    return toast("Choose a pick ticket file first.");
  }

  try {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel reader failed to load. Refresh the page and try again.");
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false
    });

    const orderNumber = extractOrderNumber(rows);
    if ($("pickOrder") && orderNumber) $("pickOrder").value = orderNumber;

    const parsedLines = parsePickTicketRows(rows, orderNumber);

    if (!parsedLines.length) {
      setUploadMessage("No picking lines found. Make sure the sheet has BIN LOC and ITEM # headers.");
      return toast("No picking lines found.");
    }

    fillPickingTableFromUpload(parsedLines);

    setUploadMessage(`Loaded ${parsedLines.length} picking lines from ${file.name}.`);
    toast(`Loaded ${parsedLines.length} picking lines.`);
  } catch (err) {
    console.error("Pick ticket upload failed:", err);
    setUploadMessage("Upload failed: " + err.message);
    toast("Upload failed: " + err.message);
  }
}

function parsePickTicketRows(rows, orderNumber = "") {
  const headerRowIndex = findPickTicketHeaderRow(rows);

  if (headerRowIndex === -1) {
    return [];
  }

  const headers = rows[headerRowIndex].map(cleanHeader);
  const col = buildColumnMap(headers);

  const parsedLines = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];

    const binLoc = getCell(row, col["BIN LOC"]);
    const item = getCell(row, col["ITEM #"]);
    const requiredQty = toNumber(getCell(row, col["ORDER QTY"]));
    const pickedQtyRaw = getCell(row, col["PICK QTY"]);
    const pickedQty = pickedQtyRaw === "" ? 0 : toNumber(pickedQtyRaw);
    const availableQty = toNumber(getCell(row, col["AVAIL"]));
    const description = getCell(row, col["DESCRIPTION"]);
    const uom = getCell(row, col["UM"]);

    const itemLooksValid =
      item &&
      !cleanHeader(item).includes("ITEM") &&
      /^[A-Z0-9-]+$/i.test(item);

    const binLooksValid =
      binLoc &&
      !cleanHeader(binLoc).includes("BIN") &&
      !cleanHeader(binLoc).includes("LOC");

    if (!itemLooksValid && !binLooksValid && !description) continue;
    if (!itemLooksValid) continue;

    parsedLines.push({
      orderNumber,
      item,
      description,
      fromSlot: binLoc,
      requiredQty,
      availableQty,
      pickedQty,
      remainingQty: requiredQty - pickedQty,
      status: getPickStatus(requiredQty, pickedQty),
      uom,
      notes: ""
    });
  }

  return parsedLines;
}

function findPickTicketHeaderRow(rows) {
  return rows.findIndex((row) => {
    const cleaned = row.map(cleanHeader);
    return cleaned.includes("BIN LOC") && cleaned.includes("ITEM #");
  });
}

function cleanHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function buildColumnMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    if (header) map[header] = index;
  });

  return map;
}

function getCell(row, index) {
  if (index === undefined || index === -1) return "";
  return String(row[index] ?? "").trim();
}

function extractOrderNumber(rows) {
  let orderNumber = "";

  rows.forEach((row) => {
    row.forEach((cell) => {
      const text = String(cell || "").trim();

      if (!text) return;

      const match = text.match(/\*?(S?XFR|XFR|SO|PO)\d+\*?/i);
      if (match) {
        orderNumber = match[0].replace(/\*/g, "").trim().toUpperCase();
      }
    });
  });

  return orderNumber;
}

function fillPickingTableFromUpload(lines) {
  const rowCount = Math.max(25, lines.length);
  buildPickingRows(rowCount);

  const tableRows = [...document.querySelectorAll("#pickingBody tr")];

  lines.forEach((line, index) => {
    const row = tableRows[index];
    if (!row) return;

    setRowValue(row, ".pick-item", line.item);
    setRowValue(row, ".pick-desc", line.description);
    setRowValue(row, ".pick-slot", line.fromSlot);
    setRowValue(row, ".pick-required", line.requiredQty);
    setRowValue(row, ".pick-available", line.availableQty);
    setRowValue(row, ".pick-picked", line.pickedQty);
    setRowValue(row, ".pick-uom", line.uom);
    setRowValue(row, ".pick-notes", line.notes);

    const statusSelect = row.querySelector(".pick-status");
    if (statusSelect) statusSelect.value = line.status;

    autoStatusForRow(row);
  });

  updatePickingStats();
}

function setRowValue(row, selector, value) {
  const el = row.querySelector(selector);
  if (el) el.value = value ?? "";
}

function getPickStatus(requiredQty, pickedQty) {
  const required = Number(requiredQty || 0);
  const picked = Number(pickedQty || 0);

  if (picked === 0) return "Pending";
  if (picked > required) return "Overpicked";
  if (picked === required) return "Picked";
  if (picked > 0 && picked < required) return "Partial";

  return "Pending";
}

function autoStatusForRow(row) {
  if (!row) return;

  const required = rowNumber(row, ".pick-required");
  const picked = rowNumber(row, ".pick-picked");

  const remainingCell = row.querySelector(".pick-remaining");
  if (remainingCell) remainingCell.textContent = required - picked;

  const statusSelect = row.querySelector(".pick-status");
  if (!statusSelect) return;

  const current = statusSelect.value;
  const manualException = ["Short", "Damaged", "Wrong Slot"].includes(current);

  if (!manualException) {
    statusSelect.value = getPickStatus(required, picked);
  }
}

/* ---------------------------
   GENERAL HELPERS / STATS
---------------------------- */

function toNumber(value) {
  const clean = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

function rowValue(row, selector) {
  const el = row.querySelector(selector);
  return el ? String(el.value || "").trim() : "";
}

function rowNumber(row, selector) {
  return Number(rowValue(row, selector) || 0);
}

function updatePutawayStats() {
  const rows = [...document.querySelectorAll("#putawayBody tr")];

  const used = rows.filter(
    (r) =>
      rowValue(r, ".put-item") ||
      rowValue(r, ".put-location") ||
      rowNumber(r, ".put-qty")
  ).length;

  const qty = rows.reduce((sum, r) => sum + rowNumber(r, ".put-qty"), 0);

  if ($("putUsed")) $("putUsed").textContent = used;
  if ($("putQty")) $("putQty").textContent = qty;
  calculateDockToStock();
}

function updateCycleStats() {
  const rows = [...document.querySelectorAll("#cycleBody tr")];

  let used = 0;
  let done = 0;
  let varianceLines = 0;
  const totals = {};

  rows.forEach((row) => {
    const item = rowValue(row, ".cycle-item");
    const system = rowNumber(row, ".cycle-system");
    const counted = rowNumber(row, ".cycle-counted");
    const variance = counted - system;

    const varianceCell = row.querySelector(".cycle-variance");
    if (varianceCell) varianceCell.textContent = variance;

    if (item || system || counted) used++;
    if (row.querySelector(".cycle-done")?.checked) done++;
    if (variance !== 0 && (item || system || counted)) varianceLines++;

    if (item) {
      totals[item] ||= { system: 0, counted: 0 };
      totals[item].system += system;
      totals[item].counted += counted;
    }
  });

  if ($("cycleRows")) $("cycleRows").textContent = used;
  if ($("cycleDone")) $("cycleDone").textContent = done;
  if ($("cycleVariance")) $("cycleVariance").textContent = varianceLines;

  const body = $("cycleSummaryBody");
  if (!body) return;

  body.innerHTML = "";

  Object.entries(totals).forEach(([item, t]) => {
    const variance = t.counted - t.system;

    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.system}</td>
        <td>${t.counted}</td>
        <td>${variance}</td>
        <td>${variance === 0 ? '<span class="badge ok">Balanced</span>' : '<span class="badge bad">Variance</span>'}</td>
      </tr>
    `
    );
  });
}

function updatePickingStats() {
  const rows = [...document.querySelectorAll("#pickingBody tr")];

  let used = 0;
  let qty = 0;
  let issues = 0;
  const totals = {};

  rows.forEach((row) => {
    const item = rowValue(row, ".pick-item");
    const required = rowNumber(row, ".pick-required");
    const picked = rowNumber(row, ".pick-picked");
    const status = rowValue(row, ".pick-status");
    const remaining = required - picked;

    const remainingCell = row.querySelector(".pick-remaining");
    if (remainingCell) remainingCell.textContent = remaining;

    if (item || required || picked || rowValue(row, ".pick-slot")) used++;
    qty += picked;

    if (["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(status)) issues++;

    if (item) {
      totals[item] ||= { required: 0, picked: 0 };
      totals[item].required += required;
      totals[item].picked += picked;
    }
  });

  if ($("pickRows")) $("pickRows").textContent = used;
  if ($("pickQty")) $("pickQty").textContent = qty;
  if ($("pickIssues")) $("pickIssues").textContent = issues;

  const body = $("pickSummaryBody");
  if (!body) return;

  body.innerHTML = "";

  Object.entries(totals).forEach(([item, t]) => {
    const remaining = t.required - t.picked;

    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(item)}</td>
        <td>${t.required}</td>
        <td>${t.picked}</td>
        <td>${remaining}</td>
        <td>${remaining <= 0 ? '<span class="badge ok">Complete</span>' : '<span class="badge warn">Needs More</span>'}</td>
      </tr>
    `
    );
  });
}

/* ---------------------------
   EMPLOYEES
---------------------------- */

async function addEmployee() {
  const name = $("employeeName")?.value.trim();
  const role = isRoleOwner() ? $("employeeRole")?.value : "Worker";

  if (!name) return toast("Enter employee name.");

  if (state.isDemoMode) {
    state.employees.unshift({
      id: createLocalId("emp"),
      name,
      role,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    });

    if ($("employeeName")) $("employeeName").value = "";

    persistDemoState();
    renderEmployees();
    populateEmployeeDropdowns();
    toast("Employee added.");
    return;
  }

  try {
    const entry = {
      name,
      role,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.employees).add(entry);

    state.employees.unshift({ id: ref.id, ...entry });

    if ($("employeeName")) $("employeeName").value = "";

    renderEmployees();
    populateEmployeeDropdowns();

    toast("Employee added.");
  } catch (err) {
    console.error("Add employee failed:", err);
    toast("Add failed: " + err.message);
  }
}

async function toggleEmployee(id, active) {
  if (state.isDemoMode) {
    const emp = state.employees.find((employee) => employee.id === id);
    if (!emp) return;

    emp.active = active;
    persistDemoState();
    renderEmployees();
    populateEmployeeDropdowns();
    toast(active ? "Employee activated." : "Employee deactivated.");
    return;
  }

  try {
    await db.collection(COLLECTIONS.employees).doc(id).update({ active });

    const emp = state.employees.find((e) => e.id === id);
    if (emp) emp.active = active;

    renderEmployees();
    populateEmployeeDropdowns();

    toast(active ? "Employee activated." : "Employee deactivated.");
  } catch (err) {
    console.error("Toggle employee failed:", err);
    toast("Update failed: " + err.message);
  }
}

window.toggleEmployee = toggleEmployee;

function renderEmployees() {
  const body = $("employeeBody");
  if (!body) return;

  body.innerHTML = "";

  state.employees.forEach((emp) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(emp.name)}</td>
        <td>${escapeHtml(emp.role)}</td>
        <td>${emp.active ? '<span class="badge ok">Active</span>' : '<span class="badge bad">Inactive</span>'}</td>
        <td>
          <button onclick="toggleEmployee('${emp.id}', ${!emp.active})">
            ${emp.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `
    );
  });
}

function populateEmployeeDropdowns() {
  const employees = state.employees.filter((e) => e.active);

  const workerOptions = $("workerOptions");
  if (workerOptions) {
    workerOptions.innerHTML = "";
    employees.forEach((emp) => {
      workerOptions.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(emp.name)}"></option>`);
    });
  }

  [
    "cycleWorker",
    "cycleTimerEmployee",
    "pickWorker",
    "prodFilterEmployee",
    "creationEmployee",
    "varianceEmployee",
    "holdEmployee"
  ].forEach((id) => {
    const select = $(id);
    if (!select) return;

    const current = select.value;

    select.innerHTML = '<option value="">Select worker</option>';

    employees.forEach((emp) => {
      select.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</option>`
      );
    });

    select.value = current;
  });
}

/* ---------------------------
   SAVE / COLLECT
---------------------------- */

function collectPutawayLines() {
  return [...document.querySelectorAll("#putawayBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".put-item"),
      qty: rowNumber(row, ".put-qty"),
      location: rowValue(row, ".put-location"),
      notes: rowValue(row, ".put-notes")
    }))
    .filter((x) => x.item || x.qty || x.location || x.notes);
}

function confirmClearPutawayForm() {
  const hasCurrentData = hasPutawayDraftData();
  const hasSavedDraft = hasPutawayDraftData(readJson(PUTAWAY_DRAFT_KEY, {}));

  if ((hasCurrentData || hasSavedDraft) && !confirm("Clear the current Put Away draft? Unsaved entries will be removed.")) {
    return;
  }

  clearPutawayDraft();
  clearRows("putawayBody");
}

async function savePutaway() {
  flushPutawayDraftSave({ force: true, statusMessage: "All changes saved" });
  const lines = collectPutawayLines();

  if (!lines.length) return toast("Enter at least one put away line.");

  if (state.isDemoMode) {
    const dockToStockMinutes = calculateDockToStock();
    const doc = {
      id: createLocalId("put"),
      worker: $("putWorker")?.value || "",
      date: $("putDate")?.value || "",
      dockToStockMinutes,
      timer: { ...state.timer, elapsedMinutes: dockToStockMinutes },
      lines,
      lineCount: lines.length,
      totalQty: lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    state.putawayLogs = sortByCreatedAtDesc([{ ...doc }, ...state.putawayLogs]);
    appendDemoActivityEntries("putaway", doc, lines);
    persistDemoState();
    renderLogs();
    renderHistory();
    renderItemHistory();
    clearPutawayDraft({ keepStatus: true });
    clearRows("putawayBody");
    setPutawayAutosaveStatus("All changes saved");
    toast("Put away log saved.");
    return;
  }

  try {
    const dockToStockMinutes = calculateDockToStock();

    const doc = {
      worker: $("putWorker")?.value || "",
      date: $("putDate")?.value || "",
      dockToStockMinutes,
      timer: { ...state.timer, elapsedMinutes: dockToStockMinutes },
      lines,
      lineCount: lines.length,
      totalQty: lines.reduce((s, x) => s + Number(x.qty || 0), 0),
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.putaway).add(doc);
    await saveActivityLogs("putaway", doc, lines);

    state.putawayLogs.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    renderItemHistory();
    clearPutawayDraft({ keepStatus: true });
    clearRows("putawayBody");
    setPutawayAutosaveStatus("All changes saved");

    toast("Put away log saved.");
  } catch (err) {
    console.error("Put away save failed:", err);
    toast("Save failed: " + err.message);
  }
}

function collectCycleLines() {
  return [...document.querySelectorAll("#cycleBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".cycle-item"),
      description: rowValue(row, ".cycle-desc"),
      location: rowValue(row, ".cycle-location"),
      systemQty: rowNumber(row, ".cycle-system"),
      countedQty: rowNumber(row, ".cycle-counted"),
      variance: rowNumber(row, ".cycle-counted") - rowNumber(row, ".cycle-system"),
      reason: rowValue(row, ".cycle-reason"),
      done: row.querySelector(".cycle-done")?.checked || false,
      itemStartedAt: row.dataset.itemStartedAt || null,
      itemFinishedAt: row.dataset.itemFinishedAt || null,
      itemMinutes: row.dataset.itemMinutes ? Number(row.dataset.itemMinutes) : null,
      itemDelayReason: rowValue(row, ".cycle-item-delay") || "Normal",
      itemDelayNotes: rowValue(row, ".cycle-item-delay-notes") || ""
    }))
    .filter((x) => x.item || x.location || x.systemQty || x.countedQty);
}

async function saveCycle() {
  updateCycleStats();

  const lines = collectCycleLines();

  if (!lines.length) return toast("Enter at least one cycle count line.");

  if (state.isDemoMode) {
    const doc = {
      id: createLocalId("cycle"),
      counter: $("cycleWorker")?.value || "",
      date: $("cycleDate")?.value || "",
      countId: $("cycleId")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      varianceLines: lines.filter((line) => line.variance !== 0).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    state.cycleSessions = sortByCreatedAtDesc([{ ...doc }, ...state.cycleSessions]);
    appendDemoActivityEntries("cycleCount", doc, lines);
    persistDemoState();
    renderLogs();
    renderHistory();
    renderItemHistory();
    clearRows("cycleBody");
    toast("Cycle count saved.");
    return;
  }

  try {
    const doc = {
      counter: $("cycleWorker")?.value || "",
      date: $("cycleDate")?.value || "",
      countId: $("cycleId")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      varianceLines: lines.filter((x) => x.variance !== 0).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.cycle).add(doc);
    await saveActivityLogs("cycleCount", doc, lines);

    state.cycleSessions.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    renderItemHistory();
    clearRows("cycleBody");

    toast("Cycle count saved.");
  } catch (err) {
    console.error("Cycle count save failed:", err);
    toast("Save failed: " + err.message);
  }
}

function collectPickingLines() {
  updatePickingStats();

  return [...document.querySelectorAll("#pickingBody tr")]
    .map((row, idx) => ({
      line: idx + 1,
      item: rowValue(row, ".pick-item"),
      description: rowValue(row, ".pick-desc"),
      slot: rowValue(row, ".pick-slot"),
      fromSlot: rowValue(row, ".pick-slot"),
      requiredQty: rowNumber(row, ".pick-required"),
      availableQty: rowNumber(row, ".pick-available"),
      pickedQty: rowNumber(row, ".pick-picked"),
      remainingQty: rowNumber(row, ".pick-required") - rowNumber(row, ".pick-picked"),
      status: rowValue(row, ".pick-status"),
      uom: rowValue(row, ".pick-uom"),
      notes: rowValue(row, ".pick-notes")
    }))
    .filter((x) => x.item || x.slot || x.requiredQty || x.pickedQty || x.description);
}

async function savePicking() {
  updatePickingStats();

  const lines = collectPickingLines();

  if (!lines.length) return toast("Enter at least one picking line.");

  if (state.isDemoMode) {
    const doc = {
      id: createLocalId("pick"),
      picker: $("pickWorker")?.value || "",
      date: $("pickDate")?.value || "",
      orderNumber: $("pickOrder")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      totalPicked: lines.reduce((sum, line) => sum + Number(line.pickedQty || 0), 0),
      issueLines: lines.filter((line) =>
        ["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(line.status)
      ).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    state.pickingSessions = sortByCreatedAtDesc([{ ...doc }, ...state.pickingSessions]);
    appendDemoActivityEntries("orderPicking", doc, lines);
    persistDemoState();
    renderLogs();
    renderHistory();
    renderItemHistory();
    clearRows("pickingBody");
    toast("Picking session saved.");
    return;
  }

  try {
    const doc = {
      picker: $("pickWorker")?.value || "",
      date: $("pickDate")?.value || "",
      orderNumber: $("pickOrder")?.value.trim() || "",
      lines,
      lineCount: lines.length,
      totalPicked: lines.reduce((s, x) => s + Number(x.pickedQty || 0), 0),
      issueLines: lines.filter((x) =>
        ["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(x.status)
      ).length,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.uid || "",
      createdByEmail: state.user?.email || ""
    };

    const ref = await db.collection(COLLECTIONS.picking).add(doc);
    await saveActivityLogs("orderPicking", doc, lines);

    state.pickingSessions.unshift({ id: ref.id, ...doc });

    await loadHistory();

    renderLogs();
    renderItemHistory();
    clearRows("pickingBody");

    toast("Picking session saved.");
  } catch (err) {
    console.error("Picking save failed:", err);
    toast("Save failed: " + err.message);
  }
}

/* ---------------------------
   LEADERBOARD
---------------------------- */

function normalizeLeaderboardDate(value) {
  if (!value) return "";

  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toISOString().slice(0, 10);
  }

  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return "";

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function getRecordDate(record) {
  return (
    normalizeLeaderboardDate(record?.completedDate) ||
    normalizeLeaderboardDate(record?.date) ||
    normalizeLeaderboardDate(record?.timestamp) ||
    normalizeLeaderboardDate(record?.createdAt) ||
    normalizeLeaderboardDate(record?.savedAt)
  );
}

function getRecordsByDateRange(records, startDate, endDate, options = {}) {
  const start = normalizeLeaderboardDate(startDate);
  const end = normalizeLeaderboardDate(endDate);
  const includeUndated = Boolean(options.includeUndated || (!start && !end));

  return [...(records || [])].filter((record) => {
    const recordDate = getRecordDate(record);
    if (!recordDate) return includeUndated;
    if (start && recordDate < start) return false;
    if (end && recordDate > end) return false;
    return true;
  });
}

function normalizeEmployeeName(value) {
  const name = String(value || "").trim();
  return name || "Unknown";
}

function getRecordEmployee(record, fields) {
  const keys = fields?.length ? fields : ["worker", "counter", "picker", "employee"];
  for (const key of keys) {
    if (record?.[key]) return normalizeEmployeeName(record[key]);
  }
  return normalizeEmployeeName(record?.createdByEmail || record?.createdBy);
}

function groupRecordsByEmployee(records, fields) {
  return (records || []).reduce((groups, record) => {
    const employee = getRecordEmployee(record, fields);
    groups[employee] ||= [];
    groups[employee].push(record);
    return groups;
  }, {});
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedLineCount(record) {
  const savedCount = numericValue(record?.lineCount, NaN);
  if (Number.isFinite(savedCount) && savedCount >= 0) return savedCount;
  return Array.isArray(record?.lines) ? record.lines.length : 0;
}

function distinctWorkDays(records) {
  const dates = new Set((records || []).map(getRecordDate).filter(Boolean));
  return Math.max(dates.size, records?.length ? 1 : 0);
}

function lastActivityDate(records) {
  const dates = (records || []).map(getRecordDate).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : "Unknown";
}

function averagePerDay(total, records) {
  const days = distinctWorkDays(records);
  return days ? total / days : 0;
}

function sortLeaderboardRows(rows, primaryField) {
  return [...rows].sort((a, b) => {
    const scoreDiff = numericValue(b[primaryField]) - numericValue(a[primaryField]);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.employee || "").localeCompare(String(b.employee || ""));
  });
}

function calculatePutawayStats(records) {
  const groups = groupRecordsByEmployee(records, ["worker", "employee"]);

  return sortLeaderboardRows(
    Object.entries(groups).map(([employee, employeeRecords]) => {
      const totalLines = employeeRecords.reduce((sum, record) => sum + normalizedLineCount(record), 0);
      return {
        employee,
        totalLines,
        totalTickets: employeeRecords.length,
        averageLinesPerDay: averagePerDay(totalLines, employeeRecords),
        lastActivityDate: lastActivityDate(employeeRecords)
      };
    }),
    "totalLines"
  );
}

function cycleCompletedCount(record) {
  const lines = Array.isArray(record?.lines) ? record.lines : [];
  const doneLines = lines.filter((line) => line.done === true || String(line.status || "").toLowerCase() === "done").length;
  if (doneLines) return doneLines;
  return normalizedLineCount(record);
}

function cycleVarianceCount(record) {
  const saved = numericValue(record?.varianceItems ?? record?.varianceLines, NaN);
  if (Number.isFinite(saved) && saved >= 0) return saved;

  const lines = Array.isArray(record?.lines) ? record.lines : [];
  return lines.filter((line) => numericValue(line.variance) !== 0).length;
}

function calculateCycleCountStats(records) {
  const groups = groupRecordsByEmployee(records, ["counter", "worker", "employee"]);

  return sortLeaderboardRows(
    Object.entries(groups).map(([employee, employeeRecords]) => {
      const totalCounts = employeeRecords.reduce((sum, record) => sum + cycleCompletedCount(record), 0);
      const varianceItems = employeeRecords.reduce((sum, record) => sum + cycleVarianceCount(record), 0);
      const accuracyPercentage = totalCounts ? Math.max(0, Math.min(100, ((totalCounts - varianceItems) / totalCounts) * 100)) : null;
      return {
        employee,
        totalCounts,
        varianceItems,
        accuracyPercentage,
        averageCountsPerDay: averagePerDay(totalCounts, employeeRecords),
        lastActivityDate: lastActivityDate(employeeRecords)
      };
    }),
    "totalCounts"
  );
}

function transferOrderKey(record) {
  return String(record?.orderNumber || record?.transferNumber || record?.transferOrder || record?.id || "").trim();
}

function calculateTransferStats(records) {
  const groups = groupRecordsByEmployee(records, ["picker", "worker", "employee"]);

  return sortLeaderboardRows(
    Object.entries(groups).map(([employee, employeeRecords]) => {
      const totalTransferLines = employeeRecords.reduce((sum, record) => sum + normalizedLineCount(record), 0);
      const orderKeys = new Set();
      let missingOrderKeys = 0;

      employeeRecords.forEach((record) => {
        const key = transferOrderKey(record);
        if (key) orderKeys.add(key);
        else missingOrderKeys += 1;
      });

      return {
        employee,
        totalTransferLines,
        totalTransferOrders: orderKeys.size + missingOrderKeys,
        averageTransferLinesPerDay: averagePerDay(totalTransferLines, employeeRecords),
        lastActivityDate: lastActivityDate(employeeRecords)
      };
    }),
    "totalTransferLines"
  );
}

function calculateOverallLeaderboard(putawayRows, cycleRows, transferRows) {
  const byEmployee = {};

  putawayRows.forEach((row) => {
    byEmployee[row.employee] ||= { employee: row.employee, putawayLines: 0, cycleCounts: 0, transferLines: 0, totalScore: 0 };
    byEmployee[row.employee].putawayLines += numericValue(row.totalLines);
  });

  cycleRows.forEach((row) => {
    byEmployee[row.employee] ||= { employee: row.employee, putawayLines: 0, cycleCounts: 0, transferLines: 0, totalScore: 0 };
    byEmployee[row.employee].cycleCounts += numericValue(row.totalCounts);
  });

  transferRows.forEach((row) => {
    byEmployee[row.employee] ||= { employee: row.employee, putawayLines: 0, cycleCounts: 0, transferLines: 0, totalScore: 0 };
    byEmployee[row.employee].transferLines += numericValue(row.totalTransferLines);
  });

  Object.values(byEmployee).forEach((row) => {
    row.totalScore = row.putawayLines + row.cycleCounts + row.transferLines;
  });

  return sortLeaderboardRows(Object.values(byEmployee), "totalScore");
}

function getLeaderboardDateRange() {
  const preset = $("leaderboardRangePreset")?.value || "today";
  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);

  if (preset === "all") {
    return { preset, start: "", end: "", label: "All time", includeUndated: true };
  }

  if (preset === "custom") {
    const start = $("leaderboardStartDate")?.value || "";
    const end = $("leaderboardEndDate")?.value || start;
    return { preset, start, end, label: start && end ? `${start} to ${end}` : "Custom", includeUndated: false };
  }

  if (preset === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    return { preset, start: start.toISOString().slice(0, 10), end: todayText, label: "This week", includeUndated: false };
  }

  if (preset === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { preset, start: start.toISOString().slice(0, 10), end: todayText, label: "This month", includeUndated: false };
  }

  return { preset: "today", start: todayText, end: todayText, label: "Today", includeUndated: false };
}

function syncLeaderboardDateControls() {
  const preset = $("leaderboardRangePreset")?.value || "today";
  const custom = preset === "custom";

  ["leaderboardStartDate", "leaderboardEndDate"].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.disabled = !custom;
    if (!custom) input.value = "";
  });

  renderLeaderboard();
}

function switchLeaderboardView(view) {
  state.leaderboard.activeView = view || "putaway";
  document.querySelectorAll(".leaderboard-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.leaderboardView === state.leaderboard.activeView);
  });
  renderLeaderboard();
}

function getLeaderboardSourceRecords(range) {
  return {
    putaway: getRecordsByDateRange(state.putawayLogs, range.start, range.end, { includeUndated: range.includeUndated }),
    cycle: getRecordsByDateRange(state.cycleSessions, range.start, range.end, { includeUndated: range.includeUndated }),
    transfer: getRecordsByDateRange(state.pickingSessions, range.start, range.end, { includeUndated: range.includeUndated })
  };
}

function buildLeaderboardRows(range) {
  const records = getLeaderboardSourceRecords(range);
  const putawayRows = calculatePutawayStats(records.putaway);
  const cycleRows = calculateCycleCountStats(records.cycle);
  const transferRows = calculateTransferStats(records.transfer);

  const view = state.leaderboard.activeView || "putaway";
  const rowsByView = {
    putaway: putawayRows,
    cycle: cycleRows,
    transfer: transferRows,
    overall: calculateOverallLeaderboard(putawayRows, cycleRows, transferRows)
  };

  const recordCounts = {
    putaway: records.putaway.length,
    cycle: records.cycle.length,
    transfer: records.transfer.length,
    overall: records.putaway.length + records.cycle.length + records.transfer.length
  };

  return { rows: rowsByView[view] || [], recordCount: recordCounts[view] || 0 };
}

function leaderboardColumns(view) {
  if (view === "cycle") {
    return [
      ["employee", "Employee"],
      ["totalCounts", "Counts Completed"],
      ["varianceItems", "Variance Items"],
      ["accuracyPercentage", "Accuracy"],
      ["averageCountsPerDay", "Avg Counts / Day"],
      ["lastActivityDate", "Last Activity"]
    ];
  }

  if (view === "transfer") {
    return [
      ["employee", "Employee"],
      ["totalTransferLines", "Transfer Lines"],
      ["totalTransferOrders", "Transfer Orders"],
      ["averageTransferLinesPerDay", "Avg Lines / Day"],
      ["lastActivityDate", "Last Activity"]
    ];
  }

  if (view === "overall") {
    return [
      ["employee", "Employee"],
      ["totalScore", "Total Score"],
      ["putawayLines", "Putaway Lines"],
      ["cycleCounts", "Cycle Counts"],
      ["transferLines", "Transfer Lines"]
    ];
  }

  return [
    ["employee", "Employee"],
    ["totalLines", "Putaway Lines"],
    ["totalTickets", "Tickets / Orders"],
    ["averageLinesPerDay", "Avg Lines / Day"],
    ["lastActivityDate", "Last Activity"]
  ];
}

function formatLeaderboardValue(key, value) {
  if (value === null || value === undefined || value === "") return "-";
  if (key === "accuracyPercentage") return `${Number(value).toFixed(1)}%`;
  if (key.startsWith("average")) return Number(value).toFixed(1);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return String(value);
}

function renderLeaderboard() {
  const body = $("leaderboardTableBody");
  const head = $("leaderboardTableHead");
  if (!body || !head) return;

  const range = getLeaderboardDateRange();
  const view = state.leaderboard.activeView || "putaway";
  const search = $("leaderboardSearch")?.value.trim().toLowerCase() || "";
  const result = buildLeaderboardRows(range);
  const rows = result.rows.filter((row) => !search || String(row.employee || "").toLowerCase().includes(search));
  const columns = leaderboardColumns(view);

  state.leaderboard.rows = rows;
  state.leaderboard.recordCount = result.recordCount;

  if ($("leaderboardEmployeeCount")) $("leaderboardEmployeeCount").textContent = rows.length;
  if ($("leaderboardRecordCount")) $("leaderboardRecordCount").textContent = result.recordCount;
  if ($("leaderboardRangeLabel")) $("leaderboardRangeLabel").textContent = range.label;

  head.innerHTML = `
    <tr>
      <th>Rank</th>
      ${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}
    </tr>
  `;

  body.innerHTML = "";

  if (!rows.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="${columns.length + 1}">No data found for this date range.</td></tr>`);
    return;
  }

  rows.forEach((row, index) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${index + 1}</td>
        ${columns.map(([key]) => `<td>${escapeHtml(formatLeaderboardValue(key, row[key]))}</td>`).join("")}
      </tr>
    `
    );
  });
}

function exportLeaderboardCsv() {
  const view = state.leaderboard.activeView || "putaway";
  if (!state.leaderboard.rows.length) renderLeaderboard();
  if (!state.leaderboard.rows.length) return toast("No leaderboard data to export.");

  const columns = leaderboardColumns(view);
  const rows = state.leaderboard.rows.map((row, index) => {
    const out = { rank: index + 1 };
    columns.forEach(([key, label]) => {
      out[label] = formatLeaderboardValue(key, row[key]);
    });
    return out;
  });

  downloadCsv(rows, `leaderboard-${view}-${new Date().toISOString().slice(0, 10)}.csv`);
}

/* ---------------------------
   RENDER LOGS
---------------------------- */

function renderLogs() {
  renderPutawayLogs();
  renderCycleLogs();
  renderPickingLogs();
  renderLeaderboard();
}

function renderPutawayLogs() {
  const body = $("putawayLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.putawayLogs.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.worker || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalQty || 0}</td>
        <td>${log.dockToStockMinutes || 0} min</td>
        <td>${escapeHtml(
          (log.lines || [])
            .slice(0, 3)
            .map((x) => `${x.item} x${x.qty} @ ${x.location}`)
            .join(" | ")
        )}</td>
      </tr>
    `
    );
  });
}

function renderCycleLogs() {
  const body = $("cycleLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.cycleSessions.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.counter || "")}</td>
        <td>${escapeHtml(log.countId || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.varianceLines || 0}</td>
      </tr>
    `
    );
  });
}

function renderPickingLogs() {
  const body = $("pickingLogBody");
  if (!body) return;

  body.innerHTML = "";

  state.pickingSessions.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.picker || "")}</td>
        <td>${escapeHtml(log.orderNumber || "")}</td>
        <td>${log.lineCount || log.lines?.length || 0}</td>
        <td>${log.totalPicked || 0}</td>
        <td>${log.issueLines || 0}</td>
      </tr>
    `
    );
  });
}

function renderHistory() {
  const body = $("historyBody");
  if (!body) return;

  body.innerHTML = "";

  if (!state.activityLogs.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No activity history found yet.</td></tr>`);
    return;
  }

  state.activityLogs.forEach((log) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(log.date || "")}</td>
        <td>${escapeHtml(log.type || "")}</td>
        <td>${escapeHtml(log.employee || "")}</td>
        <td>${escapeHtml(log.item || "")}</td>
        <td>${escapeHtml(log.qty ?? "")}</td>
        <td>${escapeHtml(log.location || "")}</td>
        <td>${escapeHtml(log.documentNumber || "")}</td>
        <td>${log.dockToStockMinutes || 0} min</td>
        <td>${escapeHtml(log.status || log.reason || "")}</td>
      </tr>
    `
    );
  });
}

function buildItemHistoryRows() {
  const activityRows = (state.activityLogs || []).map((log) => ({
    date: log.date || String(log.createdAt || "").slice(0, 10),
    process: processLabel(log.type),
    worker: log.employee || "",
    item: log.item || "",
    description: log.description || "",
    qty: log.qty ?? "",
    location: log.location || "",
    status: log.status || log.reason || "",
    notes: log.notes || "",
    createdAt: log.createdAt || ""
  }));

  const fallbackRows = [];
  [
    ["putaway", state.putawayLogs],
    ["cycleCount", state.cycleSessions],
    ["orderPicking", state.pickingSessions]
  ].forEach(([type, sessions]) => {
    (sessions || []).forEach((session) => {
      (session.lines || []).forEach((line) => {
        fallbackRows.push({
          date: session.date || String(session.createdAt || "").slice(0, 10),
          process: processLabel(type),
          worker: session.worker || session.counter || session.picker || "",
          item: line.item || "",
          description: line.description || "",
          qty: line.qty ?? line.countedQty ?? line.pickedQty ?? "",
          location: line.location || line.fromSlot || line.slot || "",
          status: line.status || (Number(line.variance || 0) ? "Variance" : line.done ? "Counted" : ""),
          notes: line.notes || line.reason || "",
          createdAt: session.createdAt || ""
        });
      });
    });
  });

  const seen = new Set();
  return [...activityRows, ...fallbackRows]
    .filter((row) => {
      const key = [row.date, row.process, row.worker, row.item, row.qty, row.location, row.createdAt].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}

function renderItemHistory() {
  const body = $("itemHistoryBody");
  if (!body) return;

  const item = $("itemHistorySearch")?.value.trim().toLowerCase() || "";
  const worker = $("itemHistoryWorker")?.value.trim().toLowerCase() || "";
  const process = $("itemHistoryProcess")?.value || "";
  const start = $("itemHistoryStart")?.value || "";
  const end = $("itemHistoryEnd")?.value || "";

  state.itemHistoryRows = buildItemHistoryRows().filter((row) => {
    const date = String(row.date || "").slice(0, 10);
    if (item && !String(row.item || "").toLowerCase().includes(item)) return false;
    if (worker && !String(row.worker || "").toLowerCase().includes(worker)) return false;
    if (process && normalizeProcessValue(row.process) !== normalizeProcessValue(process)) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });

  body.innerHTML = "";

  if (!state.itemHistoryRows.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="9">No item activity found.</td></tr>`);
    return;
  }

  state.itemHistoryRows.forEach((row) => {
    body.insertAdjacentHTML(
      "beforeend",
      `
      <tr>
        <td>${escapeHtml(row.date || "")}</td>
        <td>${escapeHtml(row.process || "")}</td>
        <td>${escapeHtml(row.worker || "")}</td>
        <td>${escapeHtml(row.item || "")}</td>
        <td>${escapeHtml(row.description || "")}</td>
        <td>${escapeHtml(row.qty ?? "")}</td>
        <td>${escapeHtml(row.location || "")}</td>
        <td>${escapeHtml(row.status || "")}</td>
        <td>${escapeHtml(row.notes || "")}</td>
      </tr>
    `
    );
  });
}

function exportItemHistory() {
  if (!state.itemHistoryRows.length) renderItemHistory();
  if (!state.itemHistoryRows.length) return toast("No item history to export.");
  downloadCsv(state.itemHistoryRows, `item-history-${new Date().toISOString().slice(0, 10)}.csv`);
}

function processLabel(type) {
  const normalized = normalizeProcessValue(type);
  if (normalized === "putaway") return "Put Away";
  if (normalized === "cyclecount" || normalized === "cycle") return "Cycle Count";
  if (normalized === "orderpicking" || normalized === "picking") return "Order Picking";
  if (normalized === "receiving") return "Receiving";
  return type || "";
}

function normalizeProcessValue(value) {
  return String(value || "").toLowerCase().replace(/[_\s-]+/g, "");
}

function historyStateKey(type) {
  if (type === "putaway") return "putawayLogs";
  if (type === "cycle") return "cycleSessions";
  if (type === "picking") return "pickingSessions";
  return "";
}

function historyCollection(type) {
  if (type === "putaway") return COLLECTIONS.putaway;
  if (type === "cycle") return COLLECTIONS.cycle;
  if (type === "picking") return COLLECTIONS.picking;
  return "";
}

function parseHistoryLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("History lines could not be parsed:", err);
    return [];
  }
}

function historyLineValue(line, keys, fallback = "") {
  for (const key of keys) {
    const value = line?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return fallback;
}

function renderHistoryLinesView(lines) {
  const body = $("historyLinesTableBody");
  const notesBody = $("historyLinesNotesBody");
  if (!body || !notesBody) return;

  body.innerHTML = "";
  notesBody.innerHTML = "";

  if (!lines.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="5">No saved worksheet lines found.</td></tr>`);
  } else {
    lines.forEach((line, index) => {
      const lineNumber = historyLineValue(line, ["line", "lineNumber"], index + 1);
      const item = historyLineValue(line, ["item", "itemNumber", "sku"]);
      const location = historyLineValue(line, ["location", "fromSlot", "slot", "bin"]);
      const qty = historyLineValue(line, ["qty", "countedQty", "pickedQty", "requiredQty"], 0);

      body.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td data-label="#">${index + 1}</td>
          <td data-label="Item">${escapeHtml(item)}</td>
          <td data-label="Location">${escapeHtml(location)}</td>
          <td data-label="Qty">${escapeHtml(qty)}</td>
          <td data-label="Line">${escapeHtml(lineNumber)}</td>
        </tr>
      `
      );
    });
  }

  const notes = lines
    .map((line, index) => ({
      line: historyLineValue(line, ["line", "lineNumber"], index + 1),
      notes: String(historyLineValue(line, ["notes", "note"], "")).trim()
    }))
    .filter((entry) => entry.notes);

  if (!notes.length) {
    notesBody.innerHTML = `<p class="history-no-notes">No notes available for this record.</p>`;
    return;
  }

  notes.forEach((entry) => {
    notesBody.insertAdjacentHTML(
      "beforeend",
      `
      <div class="history-note-row">
        <strong>Line ${escapeHtml(entry.line)}</strong>
        <p>${escapeHtml(entry.notes)}</p>
      </div>
    `
    );
  });
}

function openHistoryRecord(type, id, mode = "view") {
  const key = historyStateKey(type);
  const record = (state[key] || []).find((row) => String(row.id) === String(id));
  if (!record) return;

  const lines = parseHistoryLines(record.lines);
  state.editingHistory = { type, id, mode };
  $("historyModalTitle").textContent = mode === "edit" ? "Edit History Record" : "View History Record";
  $("historyEditDate").value = record.date || record.completedDate || "";
  $("historyEditWorker").value = record.worker || record.counter || record.picker || "";
  $("historyEditReference").value = record.countId || record.orderNumber || "";
  $("historyEditMessage").textContent = mode === "view" ? "Viewing saved worksheet lines." : "";

  const editable = mode === "edit";
  const linesView = $("historyLinesView");
  const linesEditField = $("historyLinesEditField");
  const linesEditor = $("historyEditLines");

  if (linesView) {
    linesView.hidden = editable;
    linesView.classList.toggle("hidden", editable);
  }

  if (linesEditField) {
    linesEditField.hidden = !editable;
    linesEditField.classList.toggle("hidden", !editable);
  }

  if (editable) {
    if (linesEditor) linesEditor.value = JSON.stringify(lines, null, 2);
  } else {
    if (linesEditor) linesEditor.value = "";
    renderHistoryLinesView(lines);
  }

  ["historyEditDate", "historyEditWorker", "historyEditReference", "historyEditLines"].forEach((fieldId) => {
    if ($(fieldId)) $(fieldId).disabled = !editable;
  });
  if ($("saveHistoryEditBtn")) $("saveHistoryEditBtn").classList.toggle("hidden", !editable);
  if ($("deleteHistoryRecordBtn")) $("deleteHistoryRecordBtn").classList.toggle("hidden", false);
  $("historyModal")?.classList.remove("hidden");
  $("historyModal")?.setAttribute("aria-hidden", "false");
}

function closeHistoryModal() {
  state.editingHistory = null;
  $("historyModal")?.classList.add("hidden");
  $("historyModal")?.setAttribute("aria-hidden", "true");
}

async function saveHistoryEdit() {
  const context = state.editingHistory;
  if (!context || context.mode !== "edit") return;

  const key = historyStateKey(context.type);
  const index = (state[key] || []).findIndex((row) => String(row.id) === String(context.id));
  if (index < 0) return;

  let lines;
  try {
    lines = JSON.parse($("historyEditLines")?.value || "[]");
    if (!Array.isArray(lines)) throw new Error("Lines must be a JSON array.");
  } catch (err) {
    $("historyEditMessage").textContent = "Lines must be valid JSON.";
    return;
  }

  const record = { ...state[key][index] };
  record.date = $("historyEditDate")?.value || record.date || "";
  record.completedDate = record.date;
  record.lines = lines;
  record.lineCount = lines.length;

  if (context.type === "putaway") {
    record.worker = $("historyEditWorker")?.value.trim() || "";
    record.totalQty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  }
  if (context.type === "cycle") {
    record.counter = $("historyEditWorker")?.value.trim() || "";
    record.countId = $("historyEditReference")?.value.trim() || "";
    record.varianceLines = lines.filter((line) => Number(line.variance || 0) !== 0).length;
  }
  if (context.type === "picking") {
    record.picker = $("historyEditWorker")?.value.trim() || "";
    record.orderNumber = $("historyEditReference")?.value.trim() || "";
    record.totalPicked = lines.reduce((sum, line) => sum + Number(line.pickedQty || 0), 0);
    record.issueLines = lines.filter((line) => ["Short", "Damaged", "Wrong Slot", "Partial", "Overpicked"].includes(line.status)).length;
  }

  record.updatedAt = new Date().toISOString();
  state[key][index] = record;

  if (state.isDemoMode) {
    persistDemoState();
  } else {
    await db.collection(historyCollection(context.type)).doc(context.id).update(record);
  }

  renderLogs();
  renderHistory();
  renderItemHistory();
  closeHistoryModal();
  toast("History record updated.");
}

async function deleteHistoryRecord() {
  const context = state.editingHistory;
  if (!context) return;
  await deleteHistoryRecordByKey(context.type, context.id);
  closeHistoryModal();
}

async function deleteHistoryRecordByKey(type, id) {
  const key = historyStateKey(type);
  const record = (state[key] || []).find((row) => String(row.id) === String(id));
  if (!record) return;
  if (!confirm(`Delete ${processLabel(type)} history record?`)) return;

  state[key] = state[key].filter((row) => String(row.id) !== String(id));

  if (state.isDemoMode) {
    persistDemoState();
  } else {
    await db.collection(historyCollection(type)).doc(id).delete();
  }

  renderLogs();
  renderHistory();
  renderItemHistory();
  toast("History record deleted.");
}

window.openHistoryRecord = openHistoryRecord;
window.deleteHistoryRecordByKey = deleteHistoryRecordByKey;

/* ---------------------------
   CYCLE COUNT PRODUCTION
   Additive storage only. Existing keys and old records are preserved.
---------------------------- */

function allWarehouseStorageKeys() {
  return [
    DEMO_STORAGE_KEY,
    TIMER_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    TERMS_STORAGE_KEY,
    PUTAWAY_DRAFT_KEY,
    CYCLE_TIMER_KEY,
    CYCLE_AUDIT_KEY,
    CYCLE_PRODUCTION_KEY,
    COUNT_CREATION_KEY,
    VARIANCE_RESEARCH_KEY,
    HOLD_BATCH_KEY,
    HIGH_RISK_KEY,
    ROOT_CAUSE_KEY,
    DEMO_PRODUCTION_CLEANUP_KEY
  ];
}

function cycleProductionStorageKeys() {
  return [
    CYCLE_TIMER_KEY,
    CYCLE_AUDIT_KEY,
    CYCLE_PRODUCTION_KEY,
    COUNT_CREATION_KEY,
    VARIANCE_RESEARCH_KEY,
    HOLD_BATCH_KEY,
    HIGH_RISK_KEY,
    ROOT_CAUSE_KEY
  ];
}

function isCycleProductionStorageKey(key) {
  return cycleProductionStorageKeys().includes(key);
}

function initializeDataProtection() {
  window.warehouseOpsRollbackLatestBackup = rollbackLatestWarehouseOpsBackup;
  backupKnownStorageKeys("startup");
  storageBackupCreatedThisSession = true;
}

function backupKnownStorageKeys(reason = "manual") {
  const created = [];
  const timestamp = new Date().toISOString();

  allWarehouseStorageKeys().forEach((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return;
    const backupKey = nextBackupKey(key);
    window.localStorage.setItem(backupKey, raw);
    created.push({ key, backupKey, timestamp, reason });
  });

  if (created.length) {
    const metadata = readArrayJson(DATA_BACKUP_META_KEY);
    window.localStorage.setItem(DATA_BACKUP_META_KEY, JSON.stringify([...created, ...metadata].slice(0, 250)));
  }

  return created;
}

function nextBackupKey(key) {
  let version = 1;
  while (window.localStorage.getItem(`${key}_backup_v${version}`) !== null) {
    version += 1;
  }
  return `${key}_backup_v${version}`;
}

function rollbackLatestWarehouseOpsBackup() {
  if (!canResetTimer()) return toast("Only Supervisor/Admin can run rollback.");
  if (!confirm("Restore latest localStorage backups for WarehouseOS keys? Current values will be backed up first.")) return;

  backupKnownStorageKeys("pre_rollback");
  const metadata = readArrayJson(DATA_BACKUP_META_KEY);
  const restored = [];

  allWarehouseStorageKeys().forEach((key) => {
    const latest = metadata.find((entry) => entry.key === key && entry.backupKey);
    if (!latest) return;
    const raw = window.localStorage.getItem(latest.backupKey);
    if (raw === null) return;
    window.localStorage.setItem(key, raw);
    restored.push(key);
  });

  reloadCycleProductionState();
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
  toast(restored.length ? `Rollback restored ${restored.length} keys.` : "No backups were available to restore.");
}

function safeWriteStorageKey(key, value, reason) {
  if (!storageBackupCreatedThisSession) {
    backupKnownStorageKeys(reason);
    storageBackupCreatedThisSession = true;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function safeSaveArray(key, stateKey, rows, reason) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (state.isDemoMode && isCycleProductionStorageKey(key)) {
    state[stateKey] = safeRows;
    persistDemoState();
    return;
  }
  safeWriteStorageKey(key, safeRows, reason);
  state[stateKey] = safeRows;
}

function safeUpsertArrayRecord(key, stateKey, record, reason) {
  if (!record || !validateRecordId(record.id)) {
    console.error("Invalid record blocked:", record);
    toast("Record was not saved because its ID was invalid.");
    return null;
  }
  const rows = state.isDemoMode && isCycleProductionStorageKey(key)
    ? (Array.isArray(state[stateKey]) ? state[stateKey] : [])
    : readArrayJson(key);
  const index = rows.findIndex((row) => row.id === record.id);
  const merged = index >= 0
    ? { ...rows[index], ...record, updatedAt: new Date().toISOString() }
    : { ...record, createdAt: record.createdAt || new Date().toISOString() };
  const nextRows = index >= 0
    ? rows.map((row, idx) => (idx === index ? merged : row))
    : [merged, ...rows];
  safeSaveArray(key, stateKey, nextRows, reason);
  return merged;
}

function validateRecordId(id) {
  return typeof id === "string" && /^[a-z0-9_-]{3,}$/i.test(id);
}

function reloadCycleProductionState() {
  if (state.isDemoMode) {
    const savedDemoState = readDemoState();
    applyDemoCycleProductionState(savedDemoState || buildDemoState());
    return;
  }

  removeDemoCycleProductionFromStandardStorage();
  state.cycleTimers = readArrayJson(CYCLE_TIMER_KEY);
  state.cycleProduction = readArrayJson(CYCLE_PRODUCTION_KEY);
  state.countCreationLog = readArrayJson(COUNT_CREATION_KEY);
  state.varianceResearchLog = readArrayJson(VARIANCE_RESEARCH_KEY);
  state.holdBatchLog = readArrayJson(HOLD_BATCH_KEY);
  state.highRiskInventory = readArrayJson(HIGH_RISK_KEY);
  state.rootCauseLog = readArrayJson(ROOT_CAUSE_KEY);
  state.cycleAuditLog = readArrayJson(CYCLE_AUDIT_KEY);
}

function initializeCycleProductionData() {
  const today = todayValue();
  if ($("cycleTimerDate")) $("cycleTimerDate").value = today;
  ["creationDate", "varianceDate", "holdDate", "riskDate"].forEach((id) => {
    if ($(id) && !$(id).value) $(id).value = today;
  });
  if (state.isDemoMode) {
    applyDemoCycleProductionState(readDemoState() || buildDemoState());
  } else {
    reloadCycleProductionState();
  }
  syncSupervisorControls();
}

function removeDemoCycleProductionFromStandardStorage() {
  if (state.isDemoMode) return 0;
  const userEmail = String(state.user?.email || "").toLowerCase();
  const cleanupReason = DEMO_PRODUCTION_USER_EMAILS.has(userEmail)
    ? `demo_cleanup_${userEmail}`
    : "demo_cleanup_standard_mode";
  const targets = [
    { key: CYCLE_TIMER_KEY, stateKey: "cycleTimers" },
    { key: CYCLE_AUDIT_KEY, stateKey: "cycleAuditLog" },
    { key: CYCLE_PRODUCTION_KEY, stateKey: "cycleProduction" },
    { key: COUNT_CREATION_KEY, stateKey: "countCreationLog" },
    { key: VARIANCE_RESEARCH_KEY, stateKey: "varianceResearchLog" },
    { key: HOLD_BATCH_KEY, stateKey: "holdBatchLog" },
    { key: HIGH_RISK_KEY, stateKey: "highRiskInventory" },
    { key: ROOT_CAUSE_KEY, stateKey: "rootCauseLog" }
  ];
  let removedTotal = 0;

  targets.forEach(({ key, stateKey }) => {
    const rows = readArrayJson(key);
    if (!rows.length) {
      state[stateKey] = rows;
      return;
    }

    const keptRows = rows.filter((row) => !isDemoCycleProductionRecord(row));
    const removed = rows.length - keptRows.length;
    removedTotal += removed;

    if (removed > 0) {
      safeSaveArray(key, stateKey, keptRows, cleanupReason);
    } else {
      state[stateKey] = rows;
    }
  });

  if (removedTotal > 0) {
    writeDemoProductionCleanupReceipt(userEmail || "standard_mode", removedTotal);
  }

  return removedTotal;
}

function writeDemoProductionCleanupReceipt(userEmail, removedTotal) {
  const receipts = readArrayJson(DEMO_PRODUCTION_CLEANUP_KEY);
  safeWriteStorageKey(DEMO_PRODUCTION_CLEANUP_KEY, [
    {
      id: createLocalId("demo-cleanup"),
      userEmail,
      removedTotal,
      timestamp: new Date().toISOString(),
      note: "Removed seeded cycle count production demo records from standard app storage only."
    },
    ...receipts
  ].slice(0, 50), "demo_production_cleanup_receipt");
}

function isDemoCycleProductionRecord(row = {}) {
  const id = String(row.id || "").toLowerCase();
  const stockCountId = String(row.stockCountId || row.countId || "").toUpperCase();
  const employee = String(row.employee || "").toLowerCase();
  const startedBy = String(row.timing?.startedBy || row.startedBy || "").toLowerCase();
  const finishedBy = String(row.timing?.finishedBy || row.finishedBy || "").toLowerCase();
  const demoEmployees = ["ava patel", "diego martinez", "jordan lee", "maya chen"];
  const demoIdPrefixes = ["timer-demo-", "creation-demo-", "variance-demo-", "hold-demo-", "risk-demo-", "audit-demo-", "demo-"];

  return demoIdPrefixes.some((prefix) => id.startsWith(prefix))
    || stockCountId.startsWith("COUNT-DEMO")
    || (demoEmployees.includes(employee) && (startedBy === DEMO_USER.email || finishedBy === DEMO_USER.email));
}

function buildDemoCycleProductionState() {
  const seeds = buildCycleProductionDemoRecords();
  return {
    cycleTimers: seeds.timers,
    cycleProduction: [],
    countCreationLog: seeds.creation,
    varianceResearchLog: seeds.variance,
    holdBatchLog: seeds.holdBatch,
    highRiskInventory: seeds.highRisk,
    rootCauseLog: seeds.rootCause,
    cycleAuditLog: seeds.audit
  };
}

function buildCycleProductionDemoRecords() {
  const baseDate = todayValue();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const now = Date.now();
  const adjusted = demoTimer("timer-demo-adjusted", "Maya Chen", "COUNT-DEMO-105", twoDaysAgo, "2", demoTimestamp(2, 12, 0), demoTimestamp(2, 14, 20), 118, []);
  adjusted.timing.status = "supervisor_adjusted";
  adjusted.supervisorNote = "Adjusted for confirmed lunch overlap.";
  return {
    timers: [
      demoTimer("timer-demo-normal", "Diego Martinez", "COUNT-DEMO-100", baseDate, "1", new Date(now - 105 * 60000).toISOString(), new Date(now - 30 * 60000).toISOString(), 100, []),
      demoTimer("timer-demo-mixed", "Maya Chen", "COUNT-DEMO-101", yesterday, "1", demoTimestamp(1, 8, 0), demoTimestamp(1, 9, 25), 86, [demoDelay("Mixed Product", "Mixed cartons in A3-07 needed sort before count.")]),
      demoTimer("timer-demo-lift", "Diego Martinez", "COUNT-DEMO-102", yesterday, "2", demoTimestamp(1, 10, 0), demoTimestamp(1, 11, 40), 92, [demoDelay("Waiting For Lift", "Needed lift driver to pull top rack pallet.")]),
      { ...demoTimer("timer-demo-flag", "Jordan Lee", "COUNT-DEMO-103", twoDaysAgo, "1", demoTimestamp(2, 7, 0), demoTimestamp(2, 7, 3), 60, []), flags: [buildFlag("packet_under_5_minutes", "high", "Packet finished in under 5 minutes.")] },
      {
        id: "timer-demo-active",
        employee: "Ava Patel",
        stockCountId: "COUNT-DEMO-104",
        date: baseDate,
        packetNumber: "3",
        lineCount: 0,
        timing: { packetStartedAt: new Date(now - 42 * 60000).toISOString(), packetFinishedAt: null, totalElapsedMinutes: null, activeMinutes: null, startedBy: "demo@warehouse-ops-app.local", finishedBy: "", status: "active", deviceInfo: deviceInfo() },
        delayNotes: [],
        flags: [],
        createdAt: new Date(now - 42 * 60000).toISOString()
      },
      adjusted
    ],
    creation: [{ id: "creation-demo-1", date: baseDate, employee: "Maya Chen", stockCountId: "COUNT-DEMO-100", packetsCreated: 2, countLinesCreated: 205, reason: "ABC Count", notes: "GP packet created for fast movers.", createdAt: new Date().toISOString() }],
    variance: [{ id: "variance-demo-1", date: baseDate, employee: "Diego Martinez", stockCountId: "COUNT-DEMO-101", itemNumber: "SKU-7720", binLocation: "C1-02", varianceQuantity: -2, varianceDollarAmount: 184, status: "Researching", rootCause: "Picking Error", actionTaken: "Recounted", notes: "Found short-pick pattern in history.", createdAt: new Date().toISOString() }],
    holdBatch: [{ id: "hold-demo-1", date: baseDate, employee: "Ava Patel", batchId: "HB-4451", itemNumber: "SKU-2207", binLocation: "A3-07", issueType: "Negative Quantity", status: "Open", actionTaken: "Sent To Supervisor", notes: "Needs GP quantity review.", createdAt: new Date().toISOString() }],
    highRisk: [{ id: "risk-demo-1", dateAdded: baseDate, itemNumber: "SKU-1188", binLocation: "B2-09", aisle: "B", riskType: "Fast Mover", priority: "High", notes: "Count weekly until variance trend stabilizes.", lastCountDate: yesterday, nextRecommendedCountDate: baseDate, status: "Active", createdAt: new Date().toISOString() }],
    rootCause: [],
    audit: []
  };
}

function demoTimer(id, employee, stockCountId, date, packetNumber, startedAt, finishedAt, lineCount, delayNotes) {
  const minutes = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  return { id, employee, stockCountId, date, packetNumber, lineCount, timing: { packetStartedAt: startedAt, packetFinishedAt: finishedAt, totalElapsedMinutes: minutes, activeMinutes: minutes, startedBy: "demo@warehouse-ops-app.local", finishedBy: "demo@warehouse-ops-app.local", status: "finished", deviceInfo: deviceInfo() }, delayNotes, flags: [], createdAt: startedAt };
}

function demoDelay(reason, note) {
  return { id: createLocalId("delay"), timestamp: new Date().toISOString(), employee: "Demo User", reason, note, approvalStatus: "pending", supervisorNote: "", reviewedBy: "", reviewedAt: "" };
}

function currentRole() {
  return String(state.settings.operatorRole || "worker").toLowerCase();
}

function syncSupervisorControls() {
  const supervisor = canResetTimer();
  document.querySelectorAll(".supervisor-only-action").forEach((el) => {
    el.disabled = !supervisor;
    el.classList.toggle("hidden", !supervisor);
  });
}

function cycleTimerFormValues() {
  return { employee: $("cycleTimerEmployee")?.value || $("cycleWorker")?.value || currentOperatorName(), stockCountId: $("cycleTimerCountId")?.value.trim() || $("cycleId")?.value.trim() || "", date: $("cycleTimerDate")?.value || $("cycleDate")?.value || todayValue(), packetNumber: $("cycleTimerPacket")?.value.trim() || "" };
}

function findActiveCycleTimer(values = cycleTimerFormValues()) {
  return state.cycleTimers.find((timer) => timer.timing?.status === "active" && timer.employee === values.employee && (!values.stockCountId || timer.stockCountId === values.stockCountId));
}

function startCyclePacket() {
  const values = cycleTimerFormValues();
  if (!values.employee || !values.stockCountId || !values.date) return toast("Employee, Stock Count ID, and Date are required.");
  if (state.cycleTimers.some((timer) => timer.timing?.status === "active" && timer.employee === values.employee)) return toast("This employee already has an active unfinished packet.");
  const startedAt = new Date().toISOString();
  const record = { id: createLocalId("cycle-timer"), ...values, lineCount: 0, timing: { packetStartedAt: startedAt, packetFinishedAt: null, totalElapsedMinutes: null, activeMinutes: null, startedBy: state.user?.email || "", finishedBy: "", status: "active", deviceInfo: deviceInfo() }, delayNotes: [], flags: [], createdAt: startedAt };
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", record, "cycle_packet_started");
  writeCycleAudit("packet_started", record, null, record);
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
  toast("Cycle count packet started.");
}

function finishCyclePacket() {
  const active = findActiveCycleTimer(cycleTimerFormValues());
  if (!active) return toast("Start a packet before finishing.");
  const startedMs = new Date(active.timing.packetStartedAt).getTime();
  if (!startedMs || Number.isNaN(startedMs)) return toast("Invalid start timestamp. Supervisor review required.");
  const lines = collectCycleLines();
  const minutes = Math.max(0, Math.round((Date.now() - startedMs) / 60000));
  const next = { ...active, lineCount: lines.length, varianceLines: lines.filter((line) => Number(line.variance || 0) !== 0).length, timing: { ...active.timing, packetFinishedAt: new Date().toISOString(), totalElapsedMinutes: minutes, activeMinutes: minutes, finishedBy: state.user?.email || "", status: "finished" } };
  next.flags = buildCycleFlags(next);
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", next, "cycle_packet_finished");
  writeCycleAudit("packet_finished", next, active, next);
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
  toast("Cycle count packet finished.");
}

function addCycleDelayNote() {
  const active = findActiveCycleTimer(cycleTimerFormValues());
  if (!active) return toast("Start a packet before adding delay notes.");
  const reason = $("cycleDelayReason")?.value || "Normal";
  const note = $("cycleDelayNote")?.value.trim() || "";
  if (reason === "Other" && !note) return toast("Notes are required when Delay Reason is Other.");
  const delay = { id: createLocalId("delay"), timestamp: new Date().toISOString(), employee: active.employee, reason, note, approvalStatus: "pending", supervisorNote: "", reviewedBy: "", reviewedAt: "" };
  const next = { ...active, delayNotes: [...(active.delayNotes || []), delay] };
  next.flags = buildCycleFlags(next);
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", next, "cycle_delay_added");
  writeCycleAudit("delay_added", next, null, delay);
  if ($("cycleDelayNote")) $("cycleDelayNote").value = "";
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
}

function resetCyclePacketBySupervisor() {
  if (!canResetTimer()) return toast("Only Supervisor/Admin can reset cycle timers.");
  const active = findActiveCycleTimer();
  if (!active) return toast("No active matching packet to reset.");
  const next = { ...active, timing: { ...active.timing, status: "supervisor_adjusted", packetFinishedAt: null, totalElapsedMinutes: null, activeMinutes: null }, supervisorNote: "Timer reset by Supervisor/Admin.", flags: [...(active.flags || []), buildFlag("timer_reset_by_admin", "medium", "Timer reset by Supervisor/Admin.")] };
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", next, "cycle_timer_reset");
  writeCycleAudit("timer_reset_by_admin", next, active, next);
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
}

function voidCyclePacketBySupervisor() {
  if (!canResetTimer()) return toast("Only Supervisor/Admin can void cycle timers.");
  const values = cycleTimerFormValues();
  const timer = findActiveCycleTimer(values) || state.cycleTimers.find((row) => row.employee === values.employee && row.stockCountId === values.stockCountId);
  if (!timer) return toast("No matching packet found.");
  const next = { ...timer, timing: { ...(timer.timing || {}), status: "voided" }, flags: [...(timer.flags || []), buildFlag("record_voided_by_admin", "high", "Record voided by Supervisor/Admin.")] };
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", next, "cycle_timer_voided");
  writeCycleAudit("record_voided_by_admin", next, timer, next);
  renderCyclePacketTimer();
  renderCycleProductionDashboard();
}

function renderCyclePacketTimer() {
  syncSupervisorControls();
  const values = cycleTimerFormValues();
  const active = findActiveCycleTimer(values) || state.cycleTimers.find((timer) => timer.timing?.status === "active" && timer.employee === values.employee);
  const status = active?.timing?.status || "inactive";
  if ($("cycleTimerStatusBadge")) {
    $("cycleTimerStatusBadge").textContent = titleCase(status);
    $("cycleTimerStatusBadge").className = `status-pill ${status}`;
  }
  if ($("cyclePacketClock")) {
    const startedMs = active?.timing?.packetStartedAt ? new Date(active.timing.packetStartedAt).getTime() : 0;
    $("cyclePacketClock").textContent = startedMs ? formatDuration(Date.now() - startedMs) : "00:00:00";
  }
  if ($("cyclePacketStartedAt")) $("cyclePacketStartedAt").textContent = active?.timing?.packetStartedAt ? formatDateTime(active.timing.packetStartedAt) : "-";
  if ($("cyclePacketFinishedAt")) $("cyclePacketFinishedAt").textContent = active?.timing?.packetFinishedAt ? formatDateTime(active.timing.packetFinishedAt) : "-";
  if ($("finishCyclePacketBtn")) $("finishCyclePacketBtn").disabled = !active;
  if ($("cycleTimerMessage")) $("cycleTimerMessage").textContent = active ? `Active packet for ${active.employee} / ${active.stockCountId}.` : "No active packet selected.";
}

function startCycleItemTimer(row) {
  if (!row) return;
  row.dataset.itemStartedAt = new Date().toISOString();
  row.dataset.itemFinishedAt = "";
  row.dataset.itemMinutes = "";
  updateItemTimerDisplay(row);
  writeCycleAudit("item_started", { stockCountId: $("cycleId")?.value || "" }, null, collectCycleLineFromRow(row));
}

function endCycleItemTimer(row) {
  if (!row) return;
  if (!row.dataset.itemStartedAt) return toast("Start item before ending item.");
  row.dataset.itemFinishedAt = new Date().toISOString();
  row.dataset.itemMinutes = String(Math.max(0, Math.round((new Date(row.dataset.itemFinishedAt) - new Date(row.dataset.itemStartedAt)) / 60000)));
  updateItemTimerDisplay(row);
  writeCycleAudit("item_finished", { stockCountId: $("cycleId")?.value || "" }, null, collectCycleLineFromRow(row));
}

function updateItemTimerDisplay(row) {
  const el = row.querySelector(".item-minutes");
  if (el) el.textContent = row.dataset.itemMinutes ? `${row.dataset.itemMinutes} min` : row.dataset.itemStartedAt ? "Running" : "0 min";
}

function collectCycleLineFromRow(row) {
  return { item: rowValue(row, ".cycle-item"), location: rowValue(row, ".cycle-location"), itemStartedAt: row.dataset.itemStartedAt || null, itemFinishedAt: row.dataset.itemFinishedAt || null, itemMinutes: row.dataset.itemMinutes || null };
}

function buildCycleFlags(record) {
  const flags = [...(record.flags || [])];
  const add = (type, severity, message) => {
    if (!flags.some((flag) => flag.type === type)) flags.push(buildFlag(type, severity, message));
  };
  const minutes = Number(record.timing?.activeMinutes ?? record.timing?.totalElapsedMinutes ?? 0);
  const lineCount = Number(record.lineCount || 0);
  const countsPerHour = minutes > 0 ? lineCount / minutes * 60 : 0;
  if (record.timing?.status === "finished" && minutes < 5) add("packet_under_5_minutes", "high", "Packet finished in under 5 minutes.");
  if (record.timing?.status === "active" && elapsedMinutes(record.timing.packetStartedAt) > 240) add("packet_over_4_hours", "high", "Packet active over 4 hours.");
  if (record.timing?.status === "active" && !record.timing?.packetFinishedAt) add("missing_finish_time", "medium", "Packet is active with no finish time.");
  if ((record.delayNotes || []).some((note) => note.reason === "Other" && !note.note)) add("other_delay_no_notes", "medium", "Other delay reason has no notes.");
  if ((record.delayNotes || []).length > 3) add("more_than_3_delay_notes", "medium", "More than 3 delay notes on one packet.");
  if (record.timing?.status === "finished" && lineCount === 0) add("finished_zero_lines", "high", "Finished packet has 0 count lines.");
  if (countsPerHour > 300) add("counts_per_hour_high", "medium", "Counts per hour unusually high.");
  if (record.timing?.status === "finished" && countsPerHour > 0 && countsPerHour < 25) add("counts_per_hour_low", "medium", "Counts per hour unusually low.");
  return flags;
}

function buildFlag(type, severity, message) {
  return { type, severity, message, createdAt: new Date().toISOString(), reviewed: false, reviewedBy: "", reviewedAt: "", supervisorNote: "" };
}

function elapsedMinutes(iso) {
  const ms = iso ? new Date(iso).getTime() : 0;
  return ms ? Math.round((Date.now() - ms) / 60000) : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

function deviceInfo() {
  return { userAgent: navigator.userAgent, platform: navigator.platform || "", capturedAt: new Date().toISOString() };
}

function writeCycleAudit(actionType, context = {}, oldValue = null, newValue = null) {
  const entry = { id: createLocalId("audit"), timestamp: new Date().toISOString(), actionType, employee: context.employee || currentOperatorName(), role: currentRole(), stockCountId: context.stockCountId || context.countId || $("cycleId")?.value || "", itemNumber: newValue?.item || newValue?.itemNumber || "", oldValue, newValue, notes: context.supervisorNote || "", deviceInfo: deviceInfo() };
  safeUpsertArrayRecord(CYCLE_AUDIT_KEY, "cycleAuditLog", entry, `audit_${actionType}`);
}

function currentRole() {
  return String(state.settings.operatorRole || "worker").toLowerCase();
}

function saveCountCreationLog() {
  const record = { id: createLocalId("creation"), date: $("creationDate")?.value || todayValue(), employee: $("creationEmployee")?.value || currentOperatorName(), stockCountId: $("creationCountId")?.value.trim() || "", packetsCreated: Number($("creationPackets")?.value || 0), countLinesCreated: Number($("creationLines")?.value || 0), reason: $("creationReason")?.value || "Other", notes: $("creationNotes")?.value.trim() || "" };
  if (!record.employee || !record.stockCountId) return toast("Employee and Stock Count ID are required.");
  safeUpsertArrayRecord(COUNT_CREATION_KEY, "countCreationLog", record, "count_creation_added");
  writeCycleAudit("count_creation_added", record, null, record);
  renderCycleProductionDashboard();
}

function saveVarianceResearchLog() {
  const record = { id: createLocalId("variance"), date: $("varianceDate")?.value || todayValue(), employee: $("varianceEmployee")?.value || currentOperatorName(), stockCountId: $("varianceCountId")?.value.trim() || "", itemNumber: $("varianceItem")?.value.trim() || "", binLocation: $("varianceBin")?.value.trim() || "", varianceQuantity: Number($("varianceQty")?.value || 0), varianceDollarAmount: Number($("varianceDollars")?.value || 0), status: $("varianceStatus")?.value || "Open", rootCause: $("varianceRootCause")?.value || "Unknown", actionTaken: $("varianceAction")?.value || "", notes: $("varianceNotes")?.value.trim() || "" };
  if (!record.employee || !record.stockCountId || !record.itemNumber) return toast("Employee, Stock Count ID, and Item Number are required.");
  safeUpsertArrayRecord(VARIANCE_RESEARCH_KEY, "varianceResearchLog", record, "variance_log_added");
  writeCycleAudit("variance_log_added", record, null, record);
  renderCycleProductionDashboard();
}

function saveHoldBatchLog() {
  const record = { id: createLocalId("hold"), date: $("holdDate")?.value || todayValue(), employee: $("holdEmployee")?.value || currentOperatorName(), batchId: $("holdBatchId")?.value.trim() || "", itemNumber: $("holdItem")?.value.trim() || "", binLocation: $("holdBin")?.value.trim() || "", issueType: $("holdIssue")?.value || "Other", status: $("holdStatus")?.value || "Open", actionTaken: $("holdAction")?.value.trim() || "", notes: $("holdNotes")?.value.trim() || "" };
  if (!record.employee || !record.batchId) return toast("Employee and Batch ID are required.");
  safeUpsertArrayRecord(HOLD_BATCH_KEY, "holdBatchLog", record, "hold_batch_added");
  writeCycleAudit("hold_batch_added", record, null, record);
  renderCycleProductionDashboard();
}

function saveHighRiskInventory() {
  const record = { id: createLocalId("risk"), dateAdded: $("riskDate")?.value || todayValue(), itemNumber: $("riskItem")?.value.trim() || "", binLocation: $("riskBin")?.value.trim() || "", aisle: $("riskAisle")?.value.trim() || "", riskType: $("riskType")?.value || "Other", priority: $("riskPriority")?.value || "Medium", notes: $("riskNotes")?.value.trim() || "", lastCountDate: $("riskLastCount")?.value || "", nextRecommendedCountDate: $("riskNextCount")?.value || "", status: $("riskStatus")?.value || "Active" };
  if (!record.itemNumber && !record.binLocation) return toast("Item Number or Bin Location is required.");
  safeUpsertArrayRecord(HIGH_RISK_KEY, "highRiskInventory", record, "high_risk_item_added");
  writeCycleAudit("high_risk_item_added", record, null, record);
  renderCycleProductionDashboard();
}

function clearProductionFilters() {
  ["prodFilterDate", "prodFilterStart", "prodFilterEnd", "prodFilterEmployee", "prodFilterRole", "prodFilterCountId", "prodFilterDelay", "prodFilterRootCause", "prodFilterFlag"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  renderCycleProductionDashboard();
}

function filteredCycleTimers() {
  const date = $("prodFilterDate")?.value || "";
  const start = $("prodFilterStart")?.value || "";
  const end = $("prodFilterEnd")?.value || "";
  const employee = $("prodFilterEmployee")?.value || "";
  const countId = ($("prodFilterCountId")?.value || "").toLowerCase();
  const delay = $("prodFilterDelay")?.value || "";
  const flag = $("prodFilterFlag")?.value || "";
  return state.cycleTimers.filter((row) => {
    const rowDate = row.date || "";
    const hasDelay = !delay || (row.delayNotes || []).some((note) => note.reason === delay);
    const hasFlag = (row.flags || []).length > 0;
    const reviewed = (row.flags || []).some((f) => f.reviewed);
    return (!date || rowDate === date) && (!start || rowDate >= start) && (!end || rowDate <= end) && (!employee || row.employee === employee) && (!countId || String(row.stockCountId || "").toLowerCase().includes(countId)) && hasDelay && (!flag || (flag === "flagged" && hasFlag) || (flag === "reviewed" && reviewed) || (flag === "unreviewed" && hasFlag && !reviewed));
  });
}

function renderCycleProductionDashboard() {
  reloadCycleProductionState();
  populateProductionFilterOptions();
  syncSupervisorControls();
  const rows = filteredCycleTimers();
  const finishedRows = rows.filter((row) => ["finished", "supervisor_adjusted"].includes(row.timing?.status));
  const today = todayValue();
  const weekStart = getWeekStart(today);
  const dailyLines = finishedRows.filter((row) => row.date === today).reduce((sum, row) => sum + Number(row.lineCount || 0), 0);
  const weeklyLines = finishedRows.filter((row) => row.date >= weekStart).reduce((sum, row) => sum + Number(row.lineCount || 0), 0);
  const totalMinutes = finishedRows.reduce((sum, row) => sum + Number(row.timing?.activeMinutes || row.timing?.totalElapsedMinutes || 0), 0);
  const totalLines = finishedRows.reduce((sum, row) => sum + Number(row.lineCount || 0), 0);
  setText("dailyProductionLines", dailyLines);
  setText("weeklyProductionLines", weeklyLines);
  setText("packetsCompleted", finishedRows.length);
  setText("countsPerHour", totalMinutes ? Math.round(totalLines / totalMinutes * 60) : 0);
  setText("goalPercent", `${Math.round(dailyLines / DAILY_COUNT_GOAL * 100)}%`);
  setText("flaggedRecords", rows.filter((row) => (row.flags || []).length).length);
  renderRootCauseSummary();
  renderFlaggedRecords(rows);
  renderDelayReviewList(rows);
  renderProductionRecords(rows);
}

function populateProductionFilterOptions() {
  populateSimpleSelect("prodFilterEmployee", state.employees.filter((e) => e.active).map((e) => e.name), "All");
}

function populateSimpleSelect(id, values, blankLabel = "Select") {
  const select = $(id);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${blankLabel}</option>`;
  [...new Set(values.filter(Boolean))].sort().forEach((value) => {
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
  });
  select.value = current;
}

function renderRootCauseSummary() {
  const rootCauses = {};
  state.varianceResearchLog.forEach((row) => {
    rootCauses[row.rootCause || "Unknown"] = (rootCauses[row.rootCause || "Unknown"] || 0) + 1;
  });
  renderSummaryList("rootCauseSummary", Object.entries(rootCauses).map(([label, count]) => ({ label, value: `${count}` })), "No root causes logged.");
}

function renderFlaggedRecords(rows) {
  const flagged = rows.flatMap((row) => (row.flags || []).map((flag) => ({ label: `${row.employee} / ${row.stockCountId}`, value: `${flag.severity}: ${flag.message}` })));
  renderSummaryList("flaggedRecordList", flagged, "No flagged records.");
}

function renderDelayReviewList(rows) {
  const el = $("delayReviewList");
  if (!el) return;
  const notes = rows.flatMap((row) => (row.delayNotes || [])
    .filter((note) => note.approvalStatus === "pending")
    .map((note) => ({ row, note })));
  if (!notes.length) {
    el.innerHTML = '<div class="empty-state">No pending delay notes.</div>';
    return;
  }
  el.innerHTML = notes.map(({ row, note }) => `
    <div class="summary-row">
      <strong>${escapeHtml(row.employee)} / ${escapeHtml(row.stockCountId)}</strong>
      <span>${escapeHtml(note.reason)}: ${escapeHtml(note.note || "No note")}</span>
      <div class="row-actions">
        <button class="delayReviewBtn" data-timer-id="${escapeHtml(row.id)}" data-delay-id="${escapeHtml(note.id)}" data-status="approved" type="button">Approve</button>
        <button class="delayReviewBtn danger" data-timer-id="${escapeHtml(row.id)}" data-delay-id="${escapeHtml(note.id)}" data-status="rejected" type="button">Reject</button>
      </div>
    </div>
  `).join("");
}

function reviewDelayNote(timerId, delayId, status) {
  if (!canResetTimer()) return toast("Only Supervisor/Admin can review delay notes.");
  const timer = state.cycleTimers.find((row) => row.id === timerId);
  if (!timer) return toast("Timer record not found.");
  const delayNotes = (timer.delayNotes || []).map((note) => {
    if (note.id !== delayId) return note;
    return {
      ...note,
      approvalStatus: status,
      reviewedBy: currentOperatorName(),
      reviewedAt: new Date().toISOString()
    };
  });
  const next = { ...timer, delayNotes };
  safeUpsertArrayRecord(CYCLE_TIMER_KEY, "cycleTimers", next, status === "approved" ? "delay_approved" : "delay_rejected");
  writeCycleAudit(status === "approved" ? "delay_approved" : "delay_rejected", next, timer, next);
  renderCycleProductionDashboard();
}

function renderProductionRecords(rows) {
  const items = rows.slice(0, 10).map((row) => ({ label: `${row.date || "-"} ${row.employee || "-"}`, value: `${row.stockCountId || "-"} / ${row.lineCount || 0} lines / ${row.timing?.status || "-"}` }));
  renderSummaryList("productionRecordList", items, "No production records.");
}

function renderSummaryList(id, rows, emptyText) {
  const el = $(id);
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  el.innerHTML = rows.map((row) => `<div class="summary-row"><strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(row.value)}</span></div>`).join("");
}

function setText(id, value) {
  if ($(id)) $(id).textContent = value;
}

function getWeekStart(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function exportProductionCsv(type) {
  let rows = [];
  if (type === "daily") rows = filteredCycleTimers().filter((row) => row.date === todayValue());
  if (type === "weekly") rows = filteredCycleTimers().filter((row) => row.date >= getWeekStart(todayValue()));
  if (type === "employee") rows = employeeProductionRows(filteredCycleTimers());
  if (type === "delays") rows = delayReasonRows(filteredCycleTimers());
  if (type === "rootCauses") rows = state.varianceResearchLog;
  if (type === "creation") rows = state.countCreationLog;
  if (type === "variance") rows = state.varianceResearchLog;
  if (type === "holdBatch") rows = state.holdBatchLog;
  if (type === "highRisk") rows = state.highRiskInventory;
  if (type === "flags") rows = flagExportRows(filteredCycleTimers());
  if (type === "audit") {
    if (!canResetTimer()) return toast("Only Supervisor/Admin can export audit log.");
    rows = state.cycleAuditLog;
  }
  if (!rows.length) return toast("No production data to export.");
  downloadCsv(rows.map(flattenProductionRow), `cycle-${type}-${todayValue()}.csv`);
}

function employeeProductionRows(rows) {
  const map = {};
  rows.forEach((row) => {
    const key = row.employee || "Unknown";
    map[key] ||= { employee: key, countLinesCompleted: 0, packetsCompleted: 0, activeMinutes: 0, delayNotes: 0, varianceLines: 0 };
    map[key].countLinesCompleted += Number(row.lineCount || 0);
    map[key].packetsCompleted += ["finished", "supervisor_adjusted"].includes(row.timing?.status) ? 1 : 0;
    map[key].activeMinutes += Number(row.timing?.activeMinutes || row.timing?.totalElapsedMinutes || 0);
    map[key].delayNotes += (row.delayNotes || []).length;
    map[key].varianceLines += Number(row.varianceLines || 0);
  });
  return Object.values(map).map((row) => ({ ...row, countsPerHour: row.activeMinutes ? Math.round(row.countLinesCompleted / row.activeMinutes * 60) : 0, goalPercent: Math.round(row.countLinesCompleted / DAILY_COUNT_GOAL * 100) }));
}

function delayReasonRows(rows) {
  return rows.flatMap((row) => (row.delayNotes || []).map((note) => ({ stockCountId: row.stockCountId, employee: row.employee, date: row.date, ...note })));
}

function flagExportRows(rows) {
  return rows.flatMap((row) => (row.flags || []).map((flag) => ({ stockCountId: row.stockCountId, employee: row.employee, date: row.date, ...flag })));
}

function flattenProductionRow(row) {
  const out = { ...row };
  if (row.timing) {
    Object.entries(row.timing).forEach(([key, value]) => {
      out[`timing_${key}`] = typeof value === "object" ? JSON.stringify(value) : value;
    });
    delete out.timing;
  }
  if (Array.isArray(row.delayNotes)) out.delayNotes = JSON.stringify(row.delayNotes);
  if (Array.isArray(row.flags)) out.flags = JSON.stringify(row.flags);
  if (row.deviceInfo && typeof row.deviceInfo === "object") out.deviceInfo = JSON.stringify(row.deviceInfo);
  return out;
}

/* ---------------------------
   CLEAR / EXPORT
---------------------------- */

function clearRows(bodyId) {
  if (bodyId === "putawayBody") {
    buildPutawayRows();
    if ($("putWorker")) $("putWorker").value = "";
    if ($("putDate")) $("putDate").value = todayValue();
  }

  if (bodyId === "cycleBody") buildCycleRows();

  if (bodyId === "pickingBody") {
    buildPickingRows();

    if ($("pickFileUpload")) $("pickFileUpload").value = "";
    setUploadMessage("");
  }

  updatePutawayStats();
  updateCycleStats();
  updatePickingStats();
}

function exportCurrentPicking() {
  const rows = collectPickingLines();

  if (!rows.length) return toast("No current picking rows to export.");

  const orderNumber = $("pickOrder")?.value.trim() || "pick-ticket";

  const exportRows = rows.map((line) => ({
    transferNumber: orderNumber,
    item: line.item,
    description: line.description,
    fromSlot: line.fromSlot,
    requiredQty: line.requiredQty,
    availableQty: line.availableQty,
    pickedQty: line.pickedQty,
    remainingQty: line.remainingQty,
    uom: line.uom,
    status: line.status,
    notes: line.notes,
    timestamp: new Date().toISOString()
  }));

  downloadCsv(exportRows, `${orderNumber || "picking"}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportCurrentCycle() {
  const rows = collectCycleLines();

  if (!rows.length) return toast("No current cycle count rows to export.");

  const countId = $("cycleId")?.value.trim() || "cycle-count";
  const exportRows = rows.map((line) => ({
    stockCountId: countId,
    item: line.item,
    description: line.description,
    location: line.location,
    systemQty: line.systemQty,
    countedQty: line.countedQty,
    variance: line.variance,
    reason: line.reason,
    done: line.done ? "Yes" : "No",
    itemStartedAt: line.itemStartedAt || "",
    itemFinishedAt: line.itemFinishedAt || "",
    itemMinutes: line.itemMinutes ?? "",
    itemDelayReason: line.itemDelayReason || "",
    itemDelayNotes: line.itemDelayNotes || "",
    timestamp: new Date().toISOString()
  }));

  downloadCsv(exportRows, `${countId}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportCsv(type) {
  let rows = [];

  if (type === "putaway") rows = flattenSessions(state.putawayLogs, "putaway");
  if (type === "cycle") rows = flattenSessions(state.cycleSessions, "cycle");
  if (type === "picking") rows = flattenSessions(state.pickingSessions, "picking");
  if (type === "history") rows = state.activityLogs;

  if (!rows.length) return toast("No data to export.");

  downloadCsv(rows, `${type}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function flattenSessions(sessions, type) {
  const out = [];

  sessions.forEach((session) => {
    (session.lines || []).forEach((line) => {
      out.push({
        type,
        sessionDate: session.date,
        worker: session.worker || session.counter || session.picker,
        dockToStockMinutes: session.dockToStockMinutes || "",
        ...line
      });
    });
  });

  return out;
}

function downloadCsv(rows, filename) {
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  const csv = [
    headers,
    ...rows.map((r) => headers.map((h) => r[h] ?? ""))
  ]
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();

  URL.revokeObjectURL(a.href);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const el = $("toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, 2500);
}
