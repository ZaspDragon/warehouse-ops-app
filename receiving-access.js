(function () {
  const RECEIVER_ROLE = "receiverTemp";
  const LEAD_ROLES = ["admin", "lead", "platformOwner"];
  const context = {
    profile: null,
    role: "",
    appliedRestrictedMode: false
  };

  document.addEventListener("DOMContentLoaded", () => {
    installReceivingUi();
    wireReceivingRoleWatcher();
  });

  function wireReceivingRoleWatcher() {
    if (!window.auth || !window.db) return;

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        clearReceivingRoleMode();
        return;
      }

      context.profile = await loadUserProfile(user);
      context.role = getRoleFromProfile(context.profile);

      if (context.role === RECEIVER_ROLE) {
        applyReceiverTempMode();
        return;
      }

      clearReceiverTempMode();
      applyLeadAdminReceivingMode();
    });
  }

  async function loadUserProfile(user) {
    if (state?.isDemoMode) {
      const params = new URLSearchParams(window.location.search);
      return {
        uid: user.uid,
        email: user.email,
        role: params.get("role") || "lead",
        site: params.get("site") || "demo-site",
        department: params.get("department") || "receiving"
      };
    }

    try {
      const snap = await db.collection("users").doc(user.uid).get();
      return snap.exists ? { uid: user.uid, email: user.email, ...snap.data() } : { uid: user.uid, email: user.email };
    } catch (err) {
      console.warn("User profile load failed:", err);
      return { uid: user.uid, email: user.email };
    }
  }

  function getRoleFromProfile(profile) {
    return String(profile?.role || "").trim();
  }

  function isLeadAdmin() {
    return LEAD_ROLES.includes(context.role);
  }

  function installReceivingUi() {
    const putawayCard = document.querySelector("#putawayTab > .card:first-child");
    if (!putawayCard || $("receivedAt")) return;

    putawayCard.classList.add("receiving-entry-card");

    const stockedLabel = $("stockedTime")?.closest("label");
    if (stockedLabel) {
      stockedLabel.insertAdjacentHTML(
        "beforebegin",
        `
        <label class="lead-receiving-field">Received At
          <input id="receivedAt" type="datetime-local" />
        </label>
      `
      );
    }

    if (!$("receiverTempMessage")) {
      document.querySelector("#putawayTab .actions")?.insertAdjacentHTML(
        "afterend",
        `<p id="receiverTempMessage" class="message receiver-temp-message" aria-live="polite"></p>`
      );
    }

    setDefaultReceivedAt();
    installLeadAdminFirestorePatch();
  }

  function setDefaultReceivedAt() {
    const field = $("receivedAt");
    if (field && !field.value) field.value = formatDateTimeLocalValue(new Date());
  }

  function applyLeadAdminReceivingMode() {
    setDefaultReceivedAt();

    const receivedAt = $("receivedAt");
    if (receivedAt) {
      receivedAt.disabled = !isLeadAdmin();
      receivedAt.closest("label")?.classList.toggle("hidden", false);
    }
  }

  function applyReceiverTempMode() {
    context.appliedRestrictedMode = true;
    document.body.classList.add("receiver-temp-mode");

    switchTab?.("putaway");
    hideNonReceivingTabs();
    simplifyPutawayForReceiver();
    installReceiverSubmitHandler();
  }

  function clearReceiverTempMode() {
    if (!context.appliedRestrictedMode) {
      applyLeadAdminReceivingMode();
      return;
    }

    context.appliedRestrictedMode = false;
    document.body.classList.remove("receiver-temp-mode");

    document.querySelectorAll("[data-receiver-temp-hidden='true']").forEach((el) => {
      el.classList.remove("hidden");
      el.removeAttribute("data-receiver-temp-hidden");
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.remove("hidden");
    });

    const saveButton = $("savePutawayBtn");
    if (saveButton) {
      saveButton.textContent = "Submit Put Away";
      saveButton.disabled = false;
    }

    const message = $("receiverTempMessage");
    if (message) message.textContent = "";

    unlockReceivingLineInputs();
    applyLeadAdminReceivingMode();
  }

  function clearReceivingRoleMode() {
    context.profile = null;
    context.role = "";
    clearReceiverTempMode();
  }

  function hideNonReceivingTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      if (tab.dataset.tab !== "putaway") tab.classList.add("hidden");
    });
  }

  function simplifyPutawayForReceiver() {
    const putawayTab = $("putawayTab");
    const putawayCard = document.querySelector("#putawayTab > .card:first-child");
    if (!putawayTab || !putawayCard) return;

    putawayCard.querySelector("h2").textContent = "Receiving Line Entry";

    [
      "#putWorker",
      "#putDate",
      "#putDoc",
      "#receivedAt",
      "#receivedTime",
      "#stockedTime",
      "#dockToStockMinutes"
    ].forEach((selector) => hideClosestLabel(selector));

    document.querySelector("#putawayTab .stats") && hideForReceiver(document.querySelector("#putawayTab .stats"));
    document.querySelector("#putawayTab > .card:nth-child(2)") && hideForReceiver(document.querySelector("#putawayTab > .card:nth-child(2)"));
    $("clearPutawayBtn") && hideForReceiver($("clearPutawayBtn"));

    const saveButton = $("savePutawayBtn");
    if (saveButton) {
      saveButton.textContent = "Submit Lines";
      saveButton.disabled = false;
    }

    buildPutawayRows?.();
    hideLocationCells();
    unlockReceivingLineInputs();
  }

  function hideClosestLabel(selector) {
    const el = document.querySelector(selector);
    const label = el?.closest("label");
    if (label) hideForReceiver(label);
  }

  function hideForReceiver(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("data-receiver-temp-hidden", "true");
  }

  function hideLocationCells() {
    document.querySelectorAll("#putawayBody tr").forEach((row) => {
      row.querySelector(".put-location")?.closest("td")?.classList.add("receiver-temp-location-cell");
    });
  }

  function installReceiverSubmitHandler() {
    const button = $("savePutawayBtn");
    if (!button || button.__receiverTempHandlerInstalled) return;

    button.addEventListener("click", (event) => {
      if (context.role !== RECEIVER_ROLE) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      submitReceiverTempLines();
    }, true);
    button.__receiverTempHandlerInstalled = true;
  }

  async function submitReceiverTempLines() {
    const lines = collectReceiverTempLines();
    const message = $("receiverTempMessage");

    if (!lines.length) {
      toast?.("Enter at least one receiving line.");
      return;
    }

    const site = context.profile?.site || context.profile?.assignedSite || "";
    const department = context.profile?.department || context.profile?.assignedDepartment || "receiving";

    if (!state?.isDemoMode && (!site || !department)) {
      toast?.("Your user profile needs an assigned site and department.");
      return;
    }

    const doc = {
      site,
      department,
      lines,
      lineCount: lines.length,
      totalQty: lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: state?.user?.uid || "",
      createdByEmail: state?.user?.email || ""
    };

    try {
      if (!state?.isDemoMode) {
        const ref = await db.collection("receivingLines").add(doc);
        await writeAuditLog("receivingLinesChanged", {
          collection: "receivingLines",
          documentId: ref.id,
          changedFields: ["lines"],
          site,
          department,
          lineCount: lines.length
        });
      }

      lockReceivingLineInputs();
      if (message) message.textContent = "Lines submitted for review";
      toast?.("Lines submitted for review");
    } catch (err) {
      console.error("Receiver temp submit failed:", err);
      toast?.("Submit failed: " + err.message);
    }
  }

  function collectReceiverTempLines() {
    return [...document.querySelectorAll("#putawayBody tr")]
      .map((row, index) => ({
        line: index + 1,
        item: rowValue(row, ".put-item"),
        qty: rowNumber(row, ".put-qty"),
        notes: rowValue(row, ".put-notes")
      }))
      .filter((line) => line.item || line.qty || line.notes);
  }

  function lockReceivingLineInputs() {
    document.querySelectorAll("#putawayBody input").forEach((input) => {
      input.disabled = true;
    });

    const button = $("savePutawayBtn");
    if (button) button.disabled = true;
  }

  function unlockReceivingLineInputs() {
    document.querySelectorAll("#putawayBody input").forEach((input) => {
      input.disabled = false;
    });
  }

  function installLeadAdminFirestorePatch() {
    if (!window.db || window.db.__receivingAccessPatched) return;

    const originalCollection = window.db.collection.bind(window.db);
    window.db.collection = function receivingAccessCollection(name) {
      const collectionRef = originalCollection(name);

      if (name !== "putAwayLogs") return collectionRef;

      return new Proxy(collectionRef, {
        get(target, prop, receiver) {
          if (prop === "add") {
            return async function patchedPutAwayAdd(doc) {
              const enrichedDoc = enrichReceivingSessionDoc(doc);
              const ref = await target.add(enrichedDoc);
              await writeReceivingAuditEntries(ref.id, doc || {}, enrichedDoc);
              return ref;
            };
          }

          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };

    window.db.__receivingAccessPatched = true;
  }

  function enrichReceivingSessionDoc(doc) {
    const receivedAt = normalizeDateTime($("receivedAt")?.value) ||
      normalizeDateTime(doc?.receivedAt) ||
      normalizeDateTime(doc?.receivedTime) ||
      new Date().toISOString();

    const putawayCompletedAt = normalizeDateTime(doc?.putawayCompletedAt) ||
      normalizeDateTime(doc?.stockedTime) ||
      "";

    return {
      ...(doc || {}),
      receivedAt,
      putawayCompletedAt,
      dockToStockMinutes: calculateDockToStockFromFields(receivedAt, putawayCompletedAt, doc?.dockToStockMinutes)
    };
  }

  function calculateDockToStockFromFields(receivedAt, putawayCompletedAt, fallback) {
    if (!receivedAt || !putawayCompletedAt) return Number(fallback || 0);

    const start = new Date(receivedAt);
    const end = new Date(putawayCompletedAt);
    const minutes = Math.round((end - start) / 60000);

    return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
  }

  async function writeReceivingAuditEntries(documentId, originalDoc, enrichedDoc) {
    const changedFields = [];
    if (enrichedDoc.receivedAt !== originalDoc.receivedAt) changedFields.push("receivedAt");
    if (enrichedDoc.putawayCompletedAt !== originalDoc.putawayCompletedAt) changedFields.push("putawayCompletedAt");
    changedFields.push("lines");

    await writeAuditLog("receivingSessionChanged", {
      collection: "putAwayLogs",
      documentId,
      changedFields,
      receivedAt: enrichedDoc.receivedAt || "",
      putawayCompletedAt: enrichedDoc.putawayCompletedAt || "",
      dockToStockMinutes: Number(enrichedDoc.dockToStockMinutes || 0),
      lineCount: Array.isArray(enrichedDoc.lines) ? enrichedDoc.lines.length : 0
    });
  }

  async function writeAuditLog(eventType, details) {
    if (state?.isDemoMode || !window.db) return;

    try {
      await db.collection("auditLogs").add({
        eventType,
        details,
        createdAt: new Date().toISOString(),
        createdBy: state?.user?.uid || "",
        createdByEmail: state?.user?.email || ""
      });
    } catch (err) {
      console.warn("Audit log write failed:", err);
    }
  }

  function normalizeDateTime(value) {
    if (!value) return "";

    const text = String(value).trim();
    if (!text) return "";

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

    return "";
  }

  function formatDateTimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
})();
