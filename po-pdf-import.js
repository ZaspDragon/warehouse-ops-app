(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let pdf = null;
  async function showPage() {
    if (!pdf) return;
    const p = await pdf.getPage(1);
    const viewport = p.getViewport({scale:1.6});
    const canvas = $("pdfReviewCanvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await p.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    $("pdfReviewHint").textContent = "Only page 1 is used (" + pdf.numPages + " total pages). Review all detected fields before printing.";
  }
  async function importPDF(file) {
    if (!window.pdfjsLib) throw new Error("PDF reader did not load. Refresh and retry.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdf = await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    $("pdfReviewArea").classList.remove("hidden");
    await showPage();
    let foundPo = "";
    const first = await pdf.getPage(1);
    const text = (await first.getTextContent()).items.map(x=>x.str).join(" ");
    foundPo = (text.match(/\b(?:SPO|PO)[- ]?\d{5,12}\b/i)||[])[0] || "";
    if (foundPo && !$("poNumber").value.trim()) { $("poNumber").value=foundPo.replace(/\s/g,""); $("poNumberUpload").value=$("poNumber").value; }
    if(!$("poNumber").value.trim()) {const fromName=(file.name.match(/(?:SPO|PO)[-_ ]?\d{5,12}/i)||[])[0];if(fromName){$("poNumber").value=fromName.replace(/[-_ ]/g,"");$("poNumberUpload").value=$("poNumber").value;}}
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
    $("fileStatus").textContent = file.name+" loaded. Detection uses page 1 only of "+pdf.numPages+" pages. "+
      (text.trim() ? "Selectable text found. Review each item line and box quantity before printing." :
      "This is a scanned image PDF, so there are no selectable item lines. Review the page preview and add/verify the lines manually; no quantities have been guessed.")+
      " Nothing from this PDF is uploaded to Firestore.";
  }


  function populateReceivingRows(lines) {
    if(!lines.length) return;
    const existing=[...document.querySelectorAll("#manualLines .line-editor")];
    if(existing.some(r=>r.querySelector(".item-number").value.trim()) &&
       !confirm("A different PO draft is open. Replace existing lines with the newly uploaded PO?")) return;
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
    document.dispatchEvent(new CustomEvent("warehouseos:po-lines-updated"));
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
      // The source receiving form has five horizontal rows. Read the
      // printed item-number column first, then read bin and received qty
      // independently within each matched row. This avoids requiring a
      // perfect five-item OCR result from every column.
      const itemCrop=crop(.305,.235,.445,.555);
      const itemResult=await worker.recognize(itemCrop);
      const itemText=String(itemResult.data?.text||"").toUpperCase();
      const getItems=text=>[...new Set((text.match(/\b\d{6}\b/g)||[]))];
      const itemWords=(itemResult.data?.words||[]).filter(w=>/^\d{6}$/.test(String(w.text||"").trim()));
      const itemPositions=itemWords.map(w=>({
        item:String(w.text).trim(),
        y:.235+((w.bbox.y0+w.bbox.y1)/2)/itemCrop.height*.32
      }));
      // The report's five row centers, measured from the photographed
      // receiving form. Used only as a fallback when OCR loses word boxes.
      const rowCenters=[.267,.324,.382,.435,.493];
      const itemList=getItems(itemText);
      let rows=itemList.map((item,index)=>({
        item,bin:"",received:null,
        y:itemPositions.find(w=>w.item===item)?.y ?? rowCenters[index] ?? NaN
      }));
      if(rows.length<2){
        const broad=await worker.recognize(crop(.28,.23,.47,.57));
        const more=getItems(String(broad.data?.text||""));
        if(more.length>rows.length)rows=more.map((item,index)=>({
          item,bin:"",received:null,y:rowCenters[index]??NaN
        }));
      }
      const readField=async (x1,x2,y0,y1)=>{
        const result=await worker.recognize(crop(x1,y0,x2,y1));
        return String(result.data?.text||"").toUpperCase().trim();
      };
      for(let i=0;i<rows.length;i++){
        const r=rows[i];
        if(!Number.isFinite(r.y))continue;
        const top=Math.max(.238,r.y-.022),bottom=Math.min(.547,r.y+.022);
        $("fileStatus").textContent="Reading bin and received quantity for item "+r.item+" ("+(i+1)+"/"+rows.length+")…";
        const binText=await readField(.447,.575,top,bottom);
        const m=binText.replace(/\s+/g,"").match(/[A-Z]{1,2}-?\d{1,2}(?:-\d{1,2}){1,2}/);
        if(m)r.bin=m[0];
        // Only read handwritten quantity from the actual received column.
        // Do not substitute ordered or remaining values from other columns.
        const qtyText=await readField(.914,.997,top,bottom);
        const candidates=qtyText.match(/\d{1,5}/g)||[];
        if(candidates.length===1)r.received=Number(candidates[0]);
      }
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
      const items=[...new Set(($("photoOcrText").value.match(/\b\d{6}\b/g)||[]))].slice(0,100);
      if(items.length){
        const rows=items.map(item=>({item,bin:"",received:null}));
        populateReceivingRows(rows);
        $("fileStatus").textContent="Automatically added "+items.length+" candidate item lines from the photo. Review bin and quantity before printing.";
      }else $("fileStatus").textContent="No clear six-digit item numbers in photo. Review image and add lines manually.";
      document.dispatchEvent(new CustomEvent("warehouseos:po-lines-updated"));
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

  // Selecting a PO now performs the read AND starts extraction without requiring
  // the separate Read / Detect buttons. Old buttons are retained for retries.
  let autoSequence=0;
  $("poFile")?.addEventListener("change",async ()=>{
    const file=$("poFile")?.files?.[0]; if(!file)return;
    const seq=++autoSequence;
    const btn=$("readPoBtn");
    btn.disabled=true;
    $("fileStatus").textContent="Auto-processing "+file.name+"…";
    try{
      if(/\.pdf$/i.test(file.name) || file.type==="application/pdf"){
        await importPDF(file);
        if(seq!==autoSequence)return;
        await scanReceivingColumns();
      }else if(/\.(xlsx?|csv)$/i.test(file.name)){
        btn.disabled=false;
        // Existing spreadsheet parser is wired to this button.
        btn.click();
        document.dispatchEvent(new CustomEvent("warehouseos:po-lines-updated"));
      }else if(/^image\//.test(file.type)){
        // Photo preview already occurs in the change handler above.
        // Await an image load before firing the photo OCR action.
        await new Promise(resolve=>setTimeout(resolve,400));
        if(seq!==autoSequence)return;
        if(imageLoaded){
          $("photoOcrBtn").click();
          $("fileStatus").textContent="Image loaded. Reading item numbers; verify them before printing.";
        }
      }else{
        $("fileStatus").textContent="Unsupported file type. Use PDF, photo, Excel, or CSV.";
      }
    }catch(e){console.error(e);$("fileStatus").textContent="Automatic PO detection failed: "+e.message;}
    finally{btn.disabled=false;}
  });
})();