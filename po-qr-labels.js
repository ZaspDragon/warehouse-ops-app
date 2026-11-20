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
    return ["WOS2", line.po, line.item, String(line.qty), line.branch, line.bin].join("|");
  }
  function readLines() {
    const po=$("poNumber").value.trim(), checker=$("checkerName").value.trim();
    const branch=$("qrBranch").value.trim().toUpperCase()||"OH01";
    const date=$("workDate").value;
    if(!po || !checker) throw Error("Enter the PO number and checker name first.");
    if(!/^[A-Za-z0-9-]{4,32}$/.test(po)) throw Error("Invalid PO number.");
    const lines=[];
    [...document.querySelectorAll("#manualLines .line-editor")].forEach((row,index)=>{
      const item=row.querySelector(".item-number")?.value.trim()||"";
      const bin=(row.querySelector(".po-bin")?.value||"").trim().toUpperCase();
      const qtyRaw=row.querySelector(".checked-qty")?.value.trim()||"";
      const copiesRaw=row.querySelector(".label-copies")?.value.trim()||"";
      if(!item && !qtyRaw && !bin) return;
      if(!/^\d{6}$/.test(item)) throw Error("Line "+(index+1)+": verify the six-digit Item #.");
      if(!/^[A-Z]{1,2}-\d{2}(?:-\d{1,2}){0,2}$/.test(bin)) throw Error("Line "+(index+1)+": verify the Bin (for example G-32-1 or RD-01).");
      const qty=Number(qtyRaw),copies=Number(copiesRaw);
      if(!qtyRaw||!Number.isSafeInteger(qty)||qty<1) throw Error("Line "+(index+1)+": confirm Qty Received before printing.");
      if(!Number.isSafeInteger(copies)||copies<1||copies>100)throw Error("Line "+(index+1)+": enter 1–100 stickers.");
      if(copies>qty)throw Error("Line "+(index+1)+": cannot split "+qty+" units across "+copies+" positive-quantity labels.");
      const base=Math.floor(qty/copies),extra=qty%copies;
      for(let i=0;i<copies;i++)lines.push({item,bin,qty:base+(i<extra?1:0),po,checker,branch,date,sequence:index+1,copy:i+1,copies,received:qty});
    });
    if(!lines.length) throw Error("Review at least one item, bin and received quantity before printing.");
    if(lines.length>100) throw Error("Print at most 100 stickers at a time.");
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
        '<div class="qr-small"><b>RECEIVING BIN:</b> '+esc(line.bin)+'</div>'+ '<div class="qr-large">STICKER QTY: '+esc(line.qty)+' EA</div>'+
        '<div class="qr-pair"><div><div>CHADWELL ITEM SEARCH</div><div class="qr-website"></div></div><div><div>WAREHOUSEOS PUTAWAY QR</div><div class="qr-checked"></div></div></div>'+
        '<div class="qr-small">Checker: '+esc(line.checker)+' · '+esc(line.date)+' · Line '+line.sequence+' · Sticker '+line.copy+'/'+line.copies+'</div>';
      out.appendChild(section);
      addQR(section.querySelector(".qr-website"),line.website);
      addQR(section.querySelector(".qr-checked"),line.checked);
    });
    status("Ready: "+urls.length+" sticker(s), with received quantities distributed across them. Scan WarehouseOS Putaway QR in the Camera Batch Scanner. Website QR remains a provisional item search link.");
    return urls.length;
  }

  // Always show a live sticker preparation view after importing a PO.
  // A draft is NOT a printable/scan-ready label until fields are verified.
  function updateDraftPreview(){
    const rows=[...document.querySelectorAll("#manualLines .line-editor")].filter(r=>r.querySelector(".item-number")?.value.trim());
    const out=$("poQrLabels");if(!out)return;
    if(!rows.length){out.replaceChildren();status("Upload a PO to create sticker drafts automatically.");return;}
    const po=$("poNumber")?.value.trim()||"PO pending";
    out.replaceChildren();
    let complete=0;
    for(const [i,row] of rows.entries()){
      const item=row.querySelector(".item-number")?.value.trim()||"Needs review";
      const bin=row.querySelector(".po-bin")?.value.trim()||"Needs review";
      const raw=row.querySelector(".checked-qty")?.value.trim()||"";
      const copies=Number(row.querySelector(".label-copies")?.value||1);
      const valid=/^\d{6}$/.test(item)&&/^[A-Z]{1,2}-\d{2}(?:-\d{1,2}){0,2}$/.test(bin)&&/^[1-9]\d*$/.test(raw)&&Number(raw)>=copies&&copies>=1&&copies<=100;
      if(valid)complete++;
      const card=document.createElement("section");
      card.className="qr-label";
      card.innerHTML='<div class="qr-large">STICKER DRAFT · '+(i+1)+'</div>'+
        '<div class="qr-small"><b>PO:</b> '+esc(po)+'</div>'+
        '<div class="qr-large">ITEM '+esc(item)+'</div>'+
        '<div class="qr-small"><b>BIN:</b> '+esc(bin)+'</div>'+
        '<div class="qr-large">QTY RECEIVED: '+esc(raw||"Needs review")+'</div>'+
        '<div class="qr-small"><b>Sticker copies:</b> '+esc(String(copies))+'</div>'+
        '<div class="qr-small"><b>Status:</b> '+(valid?"Fields ready — verify against PO":"Review missing or invalid fields")+'</div>';
      out.appendChild(card);
    }
    status(rows.length+" PO sticker draft(s) loaded automatically. "+complete+" line(s) have complete fields. Verify against the PO, enter checker name, then Preview QR Stickers or Print Checked Labels.");
  }
  document.addEventListener("warehouseos:po-lines-updated",updateDraftPreview);
  $("manualLines")?.addEventListener("input",updateDraftPreview);
  $("manualLines")?.addEventListener("change",updateDraftPreview);
  $("poNumber")?.addEventListener("input",updateDraftPreview);
  $("poNumberUpload")?.addEventListener("input",updateDraftPreview);
  $("previewPoLabelsBtn")?.addEventListener("click", () => {try{preview();}catch(e){status(e.message)}});
  $("printPoLabelsBtn")?.addEventListener("click", () => {
    try {preview(); window.setTimeout(() => window.print(), 160);}
    catch (e) {status(e.message);}
  });
})();
