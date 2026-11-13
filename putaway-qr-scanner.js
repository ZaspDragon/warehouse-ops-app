(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const message = text => { if ($("putawayQrStatus")) $("putawayQrStatus").textContent = text; };
  let scanner = null, mode = "", pending = null, reading = false;
  function normalizeLocation(text) {
    const value = String(text || "").trim().toUpperCase().replace(/\s+/g, "");
    return /^[A-Z]{1,3}[0-9A-Z-]{1,24}$/.test(value) ? value : "";
  }
  function parsePackage(decoded) {
    let url;
    try { url = new URL(decoded); } catch { throw Error("Scan the finished checked quantity QR from PO Checking, not the website QR."); }
    if (url.origin !== location.origin || !url.pathname.endsWith("/po-checked-label.html")) {
      throw Error("This is not a WarehouseOps finished-quantity QR. Use the second QR on the box label.");
    }
    const item = String(url.searchParams.get("item") || "").trim();
    const qty = Number(url.searchParams.get("qty"));
    const po = String(url.searchParams.get("po") || "").trim();
    if (!/^\d{4,10}$/.test(item) || !Number.isSafeInteger(qty) || qty <= 0 || !po) {
      throw Error("Checked label has an invalid item, quantity or PO. Ask the checker to reprint it.");
    }
    return {item, qty, po};
  }
  function emptyRow() {
    return [...document.querySelectorAll("#putawayBody tr")].find(row =>
      [".put-item", ".put-qty", ".put-location", ".put-notes"].every(sel => !row.querySelector(sel)?.value.trim()));
  }
  function setRow(row, data, locationCode) {
    if (!row) throw Error("No empty putaway row remains. Save the existing lines before scanning more.");
    const fields = {".put-item":data.item,".put-qty":String(data.qty),".put-location":locationCode,
      ".put-notes":"Checked PO: "+data.po+" | QR label verified; destination confirmed by operator"};
    for (const [sel,val] of Object.entries(fields)) {
      const input = row.querySelector(sel);
      if (!input) throw Error("Putaway form fields are unavailable.");
      input.value = val;
    }
    row.querySelector(".put-item").dispatchEvent(new Event("input", {bubbles:true}));
    window.updatePutawayStats?.();
  }
  async function stop() {
    if (scanner) {
      try { await scanner.stop(); } catch {}
      try { await scanner.clear(); } catch {}
      scanner = null;
    }
    const box = $("putawayQrCamera");
    if (box) box.style.display = "none";
    $("putawayStopQr").disabled = true;
    reading = false;
  }
  async function start(type) {
    if (scanner) await stop();
    if (!window.isSecureContext) return message("Camera requires HTTPS; open the deployed WarehouseOps page.");
    if (typeof Html5Qrcode === "undefined") return message("QR reader unavailable. Check the connection or try again.");
    mode = type;
    reading = false;
    $("putawayQrCamera").style.display = "block";
    $("putawayStopQr").disabled = false;
    try {
      scanner = new Html5Qrcode("putawayQrCamera");
      await scanner.start({facingMode:"environment"},{fps:8,qrbox:{width:240,height:240}},decoded => {
        if (reading) return;
        reading = true;
        handleScan(decoded).finally(() => {reading = false});
      });
      message(type === "package" ? "Aim at the FINISHED CHECKED QTY QR, not the Chadwell website QR." :
        "Aim at the destination location QR.");
    } catch (err) {
      await stop();
      message("Could not start camera: "+String(err?.message || err));
    }
  }
  async function handleScan(decoded) {
    if (mode === "package") {
      try {
        const data = parsePackage(decoded);
        if (!emptyRow()) throw Error("Putaway lines are full. Save the current form first.");
        pending = data;
        await stop();
        $("putawayScanLocation").disabled = false;
        $("putawayApplyManualLocation").disabled = false;
        message("Captured item "+data.item+" · "+data.qty+" EA · PO "+data.po+". Scan a location QR or enter the magnet location.");
      } catch(err) {
        message(String(err.message || err));
      }
      return;
    }
    const locationCode = normalizeLocation(decoded);
    if (!locationCode) {message("Unrecognized destination location QR. Rescan or enter the magnet text.");return;}
    await applyLocation(locationCode);
  }
  async function applyLocation(locationCode) {
    if (!pending) return message("Scan the box checked-quantity QR first.");
    if (!locationCode) return message("Enter a valid destination location.");
    const row = emptyRow();
    if (!row) return message("No empty row available. Save the current putaway before continuing.");
    try {
      setRow(row, pending, locationCode);
      pending = null;
      await stop();
      $("putawayScanLocation").disabled = true;
      $("putawayApplyManualLocation").disabled = true;
      $("putawayManualQrLocation").value = "";
      message("Putaway row filled. VERIFY item, quantity and location, then use Save All Lines. Nothing was posted by scanning.");
    } catch(err) {message(String(err.message || err));}
  }
  $("putawayScanPackage")?.addEventListener("click", () => start("package"));
  $("putawayScanLocation")?.addEventListener("click", () => {if (pending) start("location");});
  $("putawayStopQr")?.addEventListener("click", stop);
  $("putawayApplyManualLocation")?.addEventListener("click", () =>
    applyLocation(normalizeLocation($("putawayManualQrLocation").value)));
})();
