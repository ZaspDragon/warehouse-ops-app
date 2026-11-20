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


  function populateReceivingRows(lines) {
    if(!lines.length) return;
    const existing=[...document.querySelectorAll("#manualLines .line-editor")];
    if(existing.some(r=>r.querySelector(".item-number").value.trim()) &&
       !confirm("Replace existing draft PO lines with these detected receiving-report lines?")) return;
    $("manualLines").replaceChildren();
    for(const line of lines){
      $("addLineBtn").click();
      const row=document.querySelector("#manualLines .line-editor:last-child");
      row.querySelector(".item-number").value=line.item||"";
      row.querySelector(".po-bin").value=line.bin||"";
      row.querySelector(".checked-qty").value=line.received==null?"":line.received;
      row.querySelector(".item-qty").value="";
      row.querySelector(".label-copies").value="1";
    }
    document.querySelector("#manualLines .item-number")?.dispatchEvent(new Event("input",{bubbles:true}));
  }
  async function scanReceivingColumns() {
    if(!pdf){$("fileStatus").textContent="Upload and read a PDF first.";return;}
    if(!window.Tesseract) { $("fileStatus").textContent="OCR text reader unavailable.";return;}
    const button=$("pdfScanReceivingBtn");
    button.disabled=true;
    let worker;
    try{
      $("fileStatus").textContent="Scanning only receiving report columns on the first page…";
      const pageOne=await pdf.getPage(1);
      const viewport=pageOne.getViewport({scale:2.2});
      const canvas=document.createElement("canvas");
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await pageOne.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
      worker=await Tesseract.createWorker("eng");
      const result=await worker.recognize(canvas);
      const words=(result.data.words||[]).map(w=>({text:String(w.text||"").trim().toUpperCase(),x:(w.bbox.x0+w.bbox.x1)/2/canvas.width,y:(w.bbox.y0+w.bbox.y1)/2/canvas.height})).filter(w=>w.text);
      // Briggs OH01 receiving-report form: item numbers in right-centre,
      // bin immediately to right and handwritten received qty at far right.
      // Never use ordered or remaining quantity columns as received quantity.
      const itemWords=words.filter(w=>w.x>.43&&w.x<.59&&w.y>.23&&w.y<.58 && /^\d{6}$/.test(w.text.replace(/[^0-9]/g,"")));
      const distinct=[];
      for(const w of itemWords) {
        const item=w.text.replace(/\D/g,"");
        if(distinct.some(x=>Math.abs(x.y-w.y)<.022))continue;
        const near=words.filter(a=>Math.abs(a.y-w.y)<.023);
        const binText=near.filter(a=>a.x>.58&&a.x<.75).map(a=>a.text).join(" ").replace(/\s+/g,"").replace(/[—–]/g,"-");
        const binMatch=binText.match(/[A-Z]{1,2}-?\d{1,2}(?:-\d{1,2}){1,2}/);
        const qtyWords=near.filter(a=>a.x>.895&&a.x<.998).map(a=>a.text.replace(/[^0-9]/g,"")).filter(Boolean);
        const received=qtyWords.length===1 && /^\d{1,5}$/.test(qtyWords[0])?Number(qtyWords[0]):null;
        distinct.push({item,bin:binMatch?.[0]||"",received,y:w.y});
      }
      distinct.sort((a,b)=>a.y-b.y);
      if(!distinct.length) {
        $("fileStatus").textContent="OCR couldn't reliably identify six-digit item numbers in the Item # column. Use the PDF preview and manually add or correct the five PO lines; no quantities were guessed.";
        return;
      }
      populateReceivingRows(distinct);
      $("fileStatus").textContent=distinct.length+" candidate lines imported from the Item #, Bin, and Qty Received columns. IMPORTANT: review every value against the PDF. Blank quantities mean OCR could not read the handwriting; never print until verified.";
    }catch(e){console.error(e);$("fileStatus").textContent="Receiving OCR failed: "+e.message;}
    finally{if(worker)await worker.terminate();button.disabled=false;}
  }
  $("pdfScanReceivingBtn")?.addEventListener("click",scanReceivingColumns);

  let imageLoaded = false;
  $("poFile")?.addEventListener("change", async () => {
    const file=$("poFile")?.files?.[0];
    imageLoaded=false;
    $("photoReviewArea")?.classList.add("hidden");
    if (!file || !/^image\//.test(file.type)) return;
    $("pdfReviewArea")?.classList.add("hidden");
    try {
      const image=await createImageBitmap(file);
      const canvas=$("photoReviewCanvas");
      const scale=Math.min(1,2200/Math.max(image.width,image.height));
      canvas.width=Math.round(image.width*scale);
      canvas.height=Math.round(image.height*scale);
      canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
      image.close?.();
      imageLoaded=true;
      $("photoOcrText").value="";
      $("photoReviewArea").classList.remove("hidden");
      $("fileStatus").textContent="Photo preview ready. Read Text From Photo, then verify the result before adding item numbers.";
    } catch(e) {$("fileStatus").textContent="Unable to preview this picture. Try JPG or PNG: "+e.message;}
  });
  $("photoOcrBtn")?.addEventListener("click", async () => {
    if(!imageLoaded) return;
    const btn=$("photoOcrBtn");
    btn.disabled=true; $("fileStatus").textContent="Reading the photo locally…";
    let worker;
    try {
      if(!window.Tesseract) throw Error("Text reader unavailable. Check connection.");
      worker=await Tesseract.createWorker("eng");
      const result=await worker.recognize($("photoReviewCanvas"));
      $("photoOcrText").value=result.data.text||"";
      $("fileStatus").textContent="Photo text detected. Review against the original image; handwriting may be inaccurate.";
    } catch(e) {$("fileStatus").textContent="Could not read photo: "+e.message;}
    finally {if(worker)await worker.terminate();btn.disabled=false;}
  });
  $("photoItemsBtn")?.addEventListener("click", () => {
    if(!imageLoaded) return;
    const text=$("photoOcrText").value;
    const matches=[...new Set((text.match(/\b\d{6}\b/g)||[]))].slice(0,100);
    if(!matches.length){$("fileStatus").textContent="No six-digit item numbers detected. Add PO lines manually.";return;}
    if(!confirm("Add "+matches.length+" six-digit candidates as draft item lines? Confirm they are Chadwell item numbers and enter actual quantities.")) return;
    const previous=[...document.querySelectorAll("#manualLines .item-number")].map(e=>e.value.trim());
    let count=0;
    for(const item of matches){
      if(previous.includes(item))continue;
      $("addLineBtn").click();
      const rows=[...document.querySelectorAll("#manualLines .line-editor")];
      const row=rows[rows.length-1];
      row.querySelector(".item-number").value=item;
      row.querySelector(".item-qty").value="";
      row.querySelector(".checked-qty").value="";
      count++;
    }
    document.querySelector("#manualLines .item-number")?.dispatchEvent(new Event("input",{bubbles:true}));
    $("fileStatus").textContent=count+" candidate items added. Check each item number and manually enter PO and checked quantities.";
  });
  $("readPoBtn")?.addEventListener("click",async event=>{
    const file=$("poFile")?.files?.[0];
    if (!file || !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name)) return;
    if (/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {event.stopImmediatePropagation();return;}
    event.stopImmediatePropagation();
    $("readPoBtn").disabled=true;
    $("fileStatus").textContent="Opening PDF locally…";
    try { await importPDF(file); }
    catch(e){console.error(e);$("fileStatus").textContent="PDF could not be opened: "+e.message;}
    finally{$("readPoBtn").disabled=false;}
  },true);
  $("pdfNextPage")?.addEventListener("click",()=>{if(pdf){page=page%pdf.numPages+1;showPage().catch(e=>$("fileStatus").textContent=e.message);}});
})();