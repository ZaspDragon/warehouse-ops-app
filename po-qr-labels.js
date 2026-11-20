(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const status = message => { $("poQrStatus").textContent = message; };
  const appOrigin = new URL("po-checked-label.html", location.href);
  function websiteUrl(item) {
    const template = $("qrSearchTemplate").value.trim();
    if (!template.includes("{item}")) throw Error("Website template must include {item}.");
    const url = new URL(template.replaceAll("{item}", encodeURIComponent(item)));
    if (url.protocol !== "https:" || !["chadwellsupply.com","www.chadwellsupply.com"].includes(url.hostname.toLowerCase())) {
      throw Error("Website QR must link to the official chadwellsupply.com domain.");
    }
    return url.href;
  }
  function putawayPayload(line) {
    // Offline-readable QR. Only contains checked label fields; it is not a proof of receipt.
    return ["WOS1", line.po, line.item, String(line.qty), line.branch].join("|");
  }
  function readLines() {
    const po = $("poNumber").value.trim();
    const checker = $("checkerName").value.trim();
    const branch = $("qrBranch").value.trim().toUpperCase() || "OH01";
    const date = $("workDate").value;
    if (!po || !checker) throw Error("Enter the PO number and checker name first.");
    if (!/^[A-Za-z0-9-]{4,32}$/.test(po)) throw Error("PO number may contain only letters, digits and hyphens.");
    const lines = [];
    [...document.querySelectorAll("#manualLines .line-editor")].forEach((row, index) => {
      const item = row.querySelector(".item-number")?.value.trim() || "";
      const checkedRaw = row.querySelector(".checked-qty")?.value.trim() || "";
      const boxRaw = row.querySelector(".box-qty")?.value.trim() || "";
      const copiesRaw = row.querySelector(".label-copies")?.value.trim() || "";
      if (!item && !checkedRaw && !boxRaw) return;
      if (!/^\d{6}$/.test(item)) throw Error("Item must be six digits on line "+(index+1)+".");
      const checked = Number(checkedRaw), box = Number(boxRaw), copies = Number(copiesRaw);
      if (!checkedRaw || !Number.isSafeInteger(checked) || checked < 1) throw Error("Enter a positive verified Finished Checked Qty on line "+(index+1)+".");
      if (!boxRaw || !Number.isSafeInteger(box) || box < 1) throw Error("Enter Qty per sticker on line "+(index+1)+".");
      if (!Number.isSafeInteger(copies) || copies < 1 || copies > 100) throw Error("Sticker copies must be 1–100 on line "+(index+1)+".");
      if (box * copies > checked) throw Error("Line "+(index+1)+": stickers total more than verified checked quantity. Adjust copies or box quantity.");
      for(let i=0;i<copies;i++) lines.push({item,qty:box,po,checker,branch,date,sequence:index+1,copy:i+1,copies,checked});
    });
    if (!lines.length) throw Error("Complete at least one verified item line, per-box qty and sticker copies.");
    if (lines.length > 100) throw Error("Print at most 100 stickers in one batch.");
    return lines;
  }
  function addQR(container, value) {
    new QRCode(container, {text:value,width:118,height:118,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  }
  function preview() {
    if (typeof QRCode === "undefined") throw Error("QR code generator did not load. Check internet access and refresh.");
    const lines = readLines();
    const urls = lines.map(line => ({...line,website:websiteUrl(line.item),checked:putawayPayload(line)}));
    const out = $("poQrLabels");
    out.replaceChildren();
    urls.forEach(line => {
      const section = document.createElement("section");
      section.className = "qr-label";
      section.innerHTML = '<div class="qr-large">CHADWELL SUPPLY · '+esc(line.branch)+'</div>'+
        '<div class="qr-small"><b>PO:</b> '+esc(line.po)+' &nbsp; <b>ITEM:</b> '+esc(line.item)+'</div>'+
        '<div class="qr-large">BOX QTY: '+esc(line.qty)+' EA</div>'+
        '<div class="qr-pair"><div><div>CHADWELL ITEM SEARCH</div><div class="qr-website"></div></div><div><div>WAREHOUSEOS PUTAWAY QR</div><div class="qr-checked"></div></div></div>'+
        '<div class="qr-small">Checker: '+esc(line.checker)+' · '+esc(line.date)+' · Line '+line.sequence+' · Sticker '+line.copy+'/'+line.copies+'</div>';
      out.appendChild(section);
      addQR(section.querySelector(".qr-website"),line.website);
      addQR(section.querySelector(".qr-checked"),line.checked);
    });
    status("Ready: "+urls.length+" box sticker(s). Scan WarehouseOS Putaway QR in the Camera Batch Scanner. Website QR remains a provisional item search link.");
    return urls.length;
  }
  $("previewPoLabelsBtn")?.addEventListener("click", () => {try{preview();}catch(e){status(e.message)}});
  $("printPoLabelsBtn")?.addEventListener("click", () => {
    try {preview(); window.setTimeout(() => window.print(), 160);}
    catch (e) {status(e.message);}
  });
})();
