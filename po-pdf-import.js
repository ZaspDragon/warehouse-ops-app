(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let pdf = null, page = 1;
  async function showPage() {
    if (!pdf) return;
    const p = await pdf.getPage(page);
    const viewport = p.getViewport({scale:1.6});
    const canvas = $("pdfReviewCanvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await p.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    $("pdfReviewHint").textContent = "Page " + page + " of " + pdf.numPages + ". Confirm each item and quantity against the original.";
  }
  async function importPDF(file) {
    if (!window.pdfjsLib) throw new Error("PDF reader did not load. Refresh and retry.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdf = await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    page = 1;
    $("pdfReviewArea").classList.remove("hidden");
    await showPage();
    let foundPo = "";
    const first = await pdf.getPage(1);
    const text = (await first.getTextContent()).items.map(x=>x.str).join(" ");
    foundPo = (text.match(/\b(?:SPO|PO)[- ]?\d{5,12}\b/i)||[])[0] || "";
    if (foundPo && !$("poNumber").value.trim()) $("poNumber").value=foundPo.replace(/\s/g,"");
    const lines = text.split(/\n/).map(x=>x.trim());
    const candidates = [];
    // Digitally-generated PO documents may contain structured text lines.
    // Never guess quantities from unrelated numbers on a scanned packing list.
    for (const line of lines) {
      const match=line.match(/^\s*(\d{6})\s+[^\n]*?\b(?:QTY|QUANTITY|ORDERED)\s*[: ]\s*(\d{1,6})\s*$/i);
      if(match) candidates.push({item:match[1],qty:Number(match[2])});
    }
    if (candidates.length) {
      if (!confirm("Found "+candidates.length+" possible PO lines. Import these for manual verification?")) return;
      $("manualLines").replaceChildren();
      for (const line of candidates) $("addLineBtn").click();
      const rows=[...document.querySelectorAll("#manualLines .line-editor")];
      candidates.forEach((line,i)=>{rows[i].querySelector(".item-number").value=line.item;rows[i].querySelector(".item-qty").value=line.qty;});
      rows[0]?.querySelector(".item-number").dispatchEvent(new Event("input",{bubbles:true}));
    }
    $("fileStatus").textContent = file.name+" loaded ("+pdf.numPages+" pages). "+
      (text.trim() ? "Selectable text found. Review each item line and box quantity before printing." :
      "This is a scanned image PDF, so there are no selectable item lines. Review the page preview and add/verify the lines manually; no quantities have been guessed.")+
      " Nothing from this PDF is uploaded to Firestore.";
  }
  $("readPoBtn")?.addEventListener("click",async event=>{
    const file=$("poFile")?.files?.[0];
    if (!file || !/\.pdf$/i.test(file.name)) return;
    event.stopImmediatePropagation();
    $("readPoBtn").disabled=true;
    $("fileStatus").textContent="Opening PDF locally…";
    try { await importPDF(file); }
    catch(e){console.error(e);$("fileStatus").textContent="PDF could not be opened: "+e.message;}
    finally{$("readPoBtn").disabled=false;}
  },true);
  $("pdfNextPage")?.addEventListener("click",()=>{if(pdf){page=page%pdf.numPages+1;showPage().catch(e=>$("fileStatus").textContent=e.message);}});
})();