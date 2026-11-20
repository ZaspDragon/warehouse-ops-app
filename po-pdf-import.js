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
    if(!pdf) { $("fileStatus").textContent="Upload and read a PDF first."; return; }
    if(!window.Tesseract) { $("fileStatus").textContent="OCR library unavailable. Check your internet connection."; return; }
    const button=$("pdfScanReceivingBtn");
    button.disabled=true;
    let worker=null;
    try {
      $("fileStatus").textContent="Reading Item # column on page 1…";
      const p=await pdf.getPage(1);
      const viewport=p.getViewport({scale:2.8});
      const full=document.createElement("canvas");
      full.width=Math.ceil(viewport.width);full.height=Math.ceil(viewport.height);
      await p.render({canvasContext:full.getContext("2d"),viewport}).promise;
      worker=await Tesseract.createWorker("eng");
      const crop=(x1,y1,x2,y2)=>{
        const c=document.createElement("canvas");
        c.width=Math.max(1,Math.round((x2-x1)*full.width));
        c.height=Math.max(1,Math.round((y2-y1)*full.height));
        c.getContext("2d").drawImage(full,Math.round(x1*full.width),Math.round(y1*full.height),c.width,c.height,0,0,c.width,c.height);
        return c;
      };
      // On this receiving report the printed Item # column is positioned
      // between the description and BIN column. Separate crops prevent
      // unrelated digits in descriptions, ordered quantity and PO metadata
      // from being used as labels.
      const itemCrop=crop(.435,.225,.585,.555);
      let itemResult=await worker.recognize(itemCrop);
      const textFor=result=>String(result.data?.text||"").toUpperCase();
      let itemText=textFor(itemResult);
      const getItems=text=>[...new Set((text.match(/(?:^|[^0-9])([0-9]{6})(?=[^0-9]|$)/gm)||[])
        .map(x=>(x.match(/[0-9]{6}/)||[])[0]).filter(Boolean))];
      let items=getItems(itemText);
      // A wider crop helps if the PDF was scanned a little off-center.
      if(items.length<2){
        const alternate=await worker.recognize(crop(.39,.23,.61,.565));
        const found=getItems(textFor(alternate));
        if(found.length>items.length){items=found;itemResult=alternate;itemText=textFor(alternate);}
      }
      // Use line positions to pair bin/quantity with the correct item when
      // OCR supplies word boxes; otherwise import item-only draft rows.
      const words=itemResult.data?.words||[];
      const matches=words.filter(w=>/^\d{6}$/.test(String(w.text||"").replace(/\s/g,"")));
      let rows=items.map(item=>({
        item,bin:"",received:null,
        y:(matches.find(w=>String(w.text||"").replace(/\s/g,"")===item)?.bbox?.y0??NaN)/(itemResult===undefined?1:itemCrop.height)
      }));
      // Received values are handwritten, therefore never take ordered or
      // remaining numbers as a fallback. Keep missing values blank.
      $("fileStatus").textContent="Found "+items.length+" possible item numbers; reading bin column…";
      const binResult=await worker.recognize(crop(.58,.225,.74,.555));
      const binText=textFor(binResult);
      const binCandidates=(binText.match(/[A-Z]{1,2}\s*[-]?\s*\d{1,2}\s*(?:-\s*\d{1,2}){1,2}/g)||[])
        .map(v=>v.replace(/\s+/g,"").toUpperCase());
      // Associate bin values by the visible row order only when their counts match.
      if(binCandidates.length===rows.length)rows.forEach((row,i)=>row.bin=binCandidates[i]);
      // OCR the far right edge of the table separately. These handwritten
      // quantities must still be confirmed manually by the checker.
      const qtyResult=await worker.recognize(crop(.875,.225,.99,.555));
      const qtyCandidates=textFor(qtyResult).split(/\n+/).map(v=>v.replace(/[^0-9]/g,""))
        .filter(v=>/^\d{1,5}$/.test(v)).map(Number);
      if(qtyCandidates.length===rows.length)rows.forEach((row,i)=>row.received=qtyCandidates[i]);
      if(!rows.length){
        $("fileStatus").textContent="No six-digit item numbers confidently found. Try a clearer scan, or add the five rows manually. OCR text (Item #): "+(itemText.trim().slice(0,160)||"[blank]");
        return;
      }
      populateReceivingRows(rows);
      $("fileStatus").textContent="Automatically added "+rows.length+" detected item-number rows. "+
        rows.filter(r=>!r.bin||r.received===null).length+" lines need a bin or received-quantity review. "+
        "Verify all three columns against the PDF before printing. OCR sample: "+itemText.trim().slice(0,100);
      $("manualLines")?.scrollIntoView({behavior:"smooth",block:"start"});
    } catch(e){ console.error(e);$("fileStatus").textContent="PO detection failed: "+e.message; }
    finally {if(worker)await worker.terminate();button.disabled=false;}
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