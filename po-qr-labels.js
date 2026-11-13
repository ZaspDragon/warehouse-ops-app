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
  function checkedUrl(line) {
    const url = new URL(appOrigin.href);
    [["po",line.po],["item",line.item],["qty",String(line.qty)],["branch",line.branch],["checker",line.checker],["date",line.date]].forEach(([key,value]) => url.searchParams.set(key,value));
    return url.href;
  }
  function readLines() {
    const po = $("poNumber").value.trim();
    const checker = $("checkerName").value.trim();
    const branch = $("qrBranch").value.trim().toUpperCase() || "OH01";
    const date = $("workDate").value;
    if (!po || !checker) throw Error("Enter the PO number and checker name first.");
    const lines = [...document.querySelectorAll("#manualLines .line-editor")].map((row, index) => {
      const item = row.querySelector(".item-number")?.value.trim() || "";
      const input = row.querySelector(".checked-qty");
      const raw = input?.value.trim() || "";
      if (!item || !raw) return null;
      const qty = Number(raw);
      if (!Number.isSafeInteger(qty) || qty < 0) throw Error("Checked quantity must be a nonnegative whole number on line " + (index + 1) + ".");
      return {item,qty,po,checker,branch,date,sequence:index+1};
    }).filter(Boolean);
    if (!lines.length) throw Error("Enter at least one verified Finished Checked Qty before printing.");
    if (lines.length > 100) throw Error("Print at most 100 labels at once.");
    return lines;
  }
  function addQR(container, value) {
    new QRCode(container, {text:value,width:118,height:118,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  }
  function preview() {
    if (typeof QRCode === "undefined") throw Error("QR code generator did not load. Check internet access and refresh.");
    const lines = readLines();
    const urls = lines.map(line => ({...line,website:websiteUrl(line.item),checked:checkedUrl(line)}));
    const out = $("poQrLabels");
    out.replaceChildren();
    urls.forEach(line => {
      const section = document.createElement("section");
      section.className = "qr-label";
      section.innerHTML = '<div class="qr-large">CHADWELL SUPPLY · '+esc(line.branch)+'</div>'+
        '<div class="qr-small"><b>PO:</b> '+esc(line.po)+' &nbsp; <b>ITEM:</b> '+esc(line.item)+'</div>'+
        '<div class="qr-large">CHECKED: '+esc(line.qty)+' EA</div>'+
        '<div class="qr-pair"><div><div>CHADWELL ITEM SEARCH</div><div class="qr-website"></div></div><div><div>FINISHED CHECKED QTY</div><div class="qr-checked"></div></div></div>'+
        '<div class="qr-small">Checker: '+esc(line.checker)+' · '+esc(line.date)+' · Line '+line.sequence+'</div>';
      out.appendChild(section);
      addQR(section.querySelector(".qr-website"),line.website);
      addQR(section.querySelector(".qr-checked"),line.checked);
    });
    status("Ready: "+urls.length+" sticker(s). Website search QR uses a provisional link; test it on Chadwell Supply.");
    return urls.length;
  }
  $("previewPoLabelsBtn")?.addEventListener("click", () => {try{preview();}catch(e){status(e.message)}});
  $("printPoLabelsBtn")?.addEventListener("click", () => {
    try {preview(); window.setTimeout(() => window.print(), 160);}
    catch (e) {status(e.message);}
  });
})();
