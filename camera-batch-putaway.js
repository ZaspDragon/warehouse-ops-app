(function () {
  "use strict";
  const MAX = 25;
  let stream = null, worker = null, scanning = false, active = false, timer = null;
  let qrMode = false;
  let rackTarget = null; // null: receive labels; index: verify actual rack magnet
  const batch = [];
  const byId = (id) => document.getElementById(id);
  const field = (value) => String(value || "").trim().toUpperCase();
  const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const info = (s) => { byId("cameraBatchStatus").textContent = s; };
  // Correct OCR lookalikes only in contexts where the expected field is known.
  // Never silently turn an uncertain or missing field into a putaway record.
  function itemFrom(line) {
    const compact=String(line||"").toUpperCase().replace(/^(?:ITEM\s*#|ITEM|SKU|PART)\s*[:#-]?\s*/,"").replace(/[\s-]/g,"");
    if (!/^[0-9OQIL|SBZ]{6}$/.test(compact)) return "";
    const digits=compact.replace(/[OQ]/g,"0").replace(/[IL|]/g,"1").replace(/S/g,"5").replace(/B/g,"8").replace(/Z/g,"2");
    return /^\d{6}$/.test(digits)?digits:"";
  }
  function qtyFrom(line) {
    const clean=String(line||"").toUpperCase().trim();
    const match=clean.match(/^(?:(?:QTY|QUANTITY|PCS|PIECES|COUNT)\s*[:#=-]?\s*)?(\d{1,4})\s*(?:PCS|EA)?$/);
    return match && Number(match[1])>0?String(Number(match[1])):"";
  }
  function parseLabel(text) {
    // Receiving sticker rows: item, location, quantity, optional PO.
    // Never use an unrelated number as quantity when the row relationship is unclear.
    const lines=String(text||"").toUpperCase().split(/\n+/)
      .map(x=>x.trim().replace(/[·]/g,"-")).filter(Boolean);
    const locIndex=lines.findIndex(x=>Boolean(normalLocation(x)));
    const location=locIndex>=0?normalLocation(lines[locIndex]):"";
    const item=locIndex>0?itemFrom(lines[locIndex-1]):(!lines.length?"":itemFrom(lines[0]));
    const qty=locIndex>=0?qtyFrom(lines[locIndex+1]||""):"";
    const po=locIndex>=0?lines.slice(locIndex+2).map(x=>x.replace(/\s/g,"")).find(x=>/^(?:SP|SPO|PO|XFR|EDI)[A-Z0-9-]{4,}$/.test(x))||"":"";
    return {item,location,qty,po,reviewed:false,itemConfirmed:false,rackVerified:false,rackRead:"",raw:text,id:crypto.randomUUID?.()||String(Date.now()+Math.random())};
  }
  function normalLocation(value) {
    const clean=field(value).replace(/^(?:BIN|LOC|LOCATION|RACK)\s*[:#=-]?\s*/,"")
      .replace(/[\s_.]/g,"-").replace(/[—–]/g,"-").replace(/-+/g,"-");
    // Accept A01, A-01, A-01-2, XA-01-02, etc.; do not guess an invalid bin.
    const match=clean.match(/^([A-Z]{1,2})-?(\d{2})(?:-?(\d{1,2}))?$/);
    return match?match.slice(1).filter(Boolean).join("-"):"";
  }
  function readRack(text) {
    const cleaned=field(text).replace(/[—–]/g,"-");
    const candidates=(cleaned.match(/\b[A-Z]{1,2}\s*[-]?\s*\d{2}(?:\s*[-]\s*\d{1,2})?\b/g)||[])
      .map(normalLocation).filter(Boolean);
    return [...new Set(candidates)];
  }
  function valid(row) {return /^\d{6}$/.test(row.item) && Boolean(normalLocation(row.location)) && /^\d+$/.test(row.qty) && Number(row.qty) > 0;}
  function ready(row) {return valid(row) && row.reviewed && row.itemConfirmed === true && row.rackVerified && row.rackRead===normalLocation(row.location);}
  function redraw() {
    const body=byId("cameraBatchRows");
    body.innerHTML="";
    batch.forEach((r,i)=>{
      const tr=document.createElement("tr");
      tr.innerHTML='<td>'+ (i+1) +'</td>' +
        ["item","location","qty","po"].map(k=>'<td><input data-index="'+i+'" data-key="'+k+'" aria-label="'+k+' line '+(i+1)+'" value="'+escapeHTML(r[k])+'" style="min-width:85px;max-width:145px" /></td>').join("") +
        '<td><button type="button" data-rack="'+i+'">Scan magnet</button><small style="display:block">'+escapeHTML(r.rackVerified ? "✓ " + r.rackRead : (r.rackRead ? "Mismatch: " + r.rackRead : "Not scanned"))+'</small></td>' +
        '<td><label><input type="checkbox" data-confirm-item="'+i+'" '+(r.itemConfirmed?'checked':'')+' /> Item # checked</label></td>' +
        '<td><label><input type="checkbox" data-review="'+i+'" '+(r.reviewed?'checked':'')+' /> Verified</label></td>' +
        '<td><button type="button" data-remove="'+i+'">Remove</button></td>';
      if(!valid(r) || !r.rackVerified) tr.style.background="rgba(245,158,11,.13)";
      body.appendChild(tr);
    });
    byId("cameraBatchCount").textContent=batch.length+" / "+MAX+" labels";
    byId("cameraBatchSubmit").disabled= !batch.length || batch.some(r=>!ready(r));
  }
  function addManualLabel(){
    if(batch.length>=MAX)return info("Batch is full. Review and submit before adding more.");
    rackTarget=null;
    batch.push({item:"",location:"",qty:"",po:"",reviewed:false,itemConfirmed:false,rackVerified:false,rackRead:"",raw:"Manual correction",id:crypto.randomUUID?.()||String(Date.now()+Math.random())});
    redraw();
    info("Blank label added. Enter the four values, scan the actual rack magnet, and verify before submitting.");
    byId("cameraBatchRows")?.lastElementChild?.querySelector('input[data-key="item"]')?.focus();
  }
  function enhancedFrame(video){
    // Preserve grayscale detail: harsh binary thresholding erases thin handwriting.
    const w=video.videoWidth,h=video.videoHeight;
    const canvas=document.createElement("canvas");
    const cropW=Math.round(w*.9),cropH=Math.round(h*.85);
    canvas.width=Math.min(2200,Math.round(cropW*1.5));
    canvas.height=Math.min(2200,Math.round(cropH*1.5));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(video,(w-cropW)/2,(h-cropH)/2,cropW,cropH,0,0,canvas.width,canvas.height);
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<image.data.length;i+=4){
      const gray=.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2];
      const value=Math.max(0,Math.min(255,(gray-128)*1.35+138));
      image.data[i]=image.data[i+1]=image.data[i+2]=value;
    }
    ctx.putImageData(image,0,0);
    return canvas;
  }

  function readWarehouseQR(raw) {
    const parts=String(raw||"").trim().split("|");
    if(!((parts.length===5&&parts[0]==="WOS1")||(parts.length===6&&parts[0]==="WOS2"))) return null;
    const [,po,item,qty,branch,bin=""]=parts;
    if(!/^[A-Za-z0-9-]{4,32}$/.test(po) || !/^\d{6}$/.test(item) || !/^[1-9]\d{0,5}$/.test(qty) || branch!=="OH01") return null;
    if(bin && !normalLocation(bin)) return null;
    return {item,qty,po,location:normalLocation(bin),reviewed:false,itemConfirmed:false,rackVerified:false,rackRead:"",raw:"WarehouseOS QR ("+branch+")",id:crypto.randomUUID?.()||String(Date.now()+Math.random())};
  }
  async function scanWarehouseQR(canvas) {
    let value = "";
    if ("BarcodeDetector" in window) {
      try {
        const detector=new BarcodeDetector({formats:["qr_code"]});
        const codes=await detector.detect(canvas);
        if(codes.length===1) value=codes[0].rawValue || "";
        if(codes.length>1) throw Error("Multiple QR codes detected. Aim at one WarehouseOS Putaway QR.");
      } catch(e) {
        if(/Multiple QR/.test(e.message)) throw e;
      }
    }
    if(!value && typeof window.jsQR==="function"){
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      value=window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:"attemptBoth"})?.data||"";
    }
    if(!value) throw Error("QR not recognized. Move closer to the WarehouseOS Putaway QR and scan again.");
    const row=readWarehouseQR(value);
    if(!row) throw Error("This is not a valid OH01 WarehouseOS putaway QR label.");
    if(batch.some(x=>x.id===row.id)) return;
    // Repeated identical boxes are legitimate, so do not discard matching item/qty stickers.
    batch.push(row);redraw();
    info("QR read: item "+row.item+", box qty "+row.qty+", PO "+row.po+". Confirm the receiving bin or enter the correct destination, scan its rack magnet, and verify before submitting.");
  }

  async function capture() {
    if(scanning || !stream || batch.length>=MAX)return;
    scanning=true;
    try {
      info("Reading handwriting…");
      const video=byId("cameraBatchVideo"), canvas=document.createElement("canvas");
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext("2d").drawImage(video,0,0);
      if(qrMode && rackTarget===null){ await scanWarehouseQR(canvas); return; }
      if(!worker)worker=await Tesseract.createWorker("eng");
      let result=await worker.recognize(canvas);
      // Handwriting is difficult for standard OCR; try a contrast-enhanced crop
      // before declaring the label unreadable.
      if(rackTarget===null){
        const first=parseLabel(result.data.text || "");
        if(!first.item || !first.location || !first.qty){
          const second=await worker.recognize(enhancedFrame(video));
          const alt=parseLabel(second.data.text || "");
          if([alt.item,alt.location,alt.qty,alt.po].filter(Boolean).length >
             [first.item,first.location,first.qty,first.po].filter(Boolean).length){
            result=second;
          }
        }
      }
      if(rackTarget!==null){
        const target=rackTarget, record=batch[target];
        if(!record){rackTarget=null;info("That label is no longer in the batch.");return;}
        let found=readRack(result.data.text);
        if(found.length!==1){const enhanced=await worker.recognize(enhancedFrame(video));found=readRack(enhanced.data.text);}
        const expected=normalLocation(record.location);
        if(found.length!==1 || !expected){
          record.rackVerified=false;record.rackRead="";
          redraw();info("Could not identify exactly one rack magnet. Aim only at the location magnet and rescan.");return;
        }
        record.rackRead=found[0];
        record.rackVerified=record.rackRead===expected;
        record.reviewed=false;
        redraw();
        if(record.rackVerified){
          rackTarget=null;
          info("Rack "+record.rackRead+" matches receiving label #"+(target+1)+". Review all fields and check Verified.");
        }else{
          info("LOCATION MISMATCH: expected "+expected+", rack magnet says "+record.rackRead+". Putaway blocked. Correct the receiving location if necessary, then rescan the magnet.");
        }
        return;
      }
      const row=parseLabel(result.data.text);
      // Do not silently accept disagreeing OCR readings of the same label.
      // The employee must correct and confirm an uncertain item number.
      if(row.item){
        const crosscheck=await worker.recognize(enhancedFrame(video));
        const secondItem=parseLabel(crosscheck.data.text || "").item;
        if(secondItem && secondItem!==row.item){
          row.raw+=" | Alternate item reading: "+secondItem;
          row.item="";
        }
      }
      if(!row.item && !row.location && !row.qty && !row.po) {
        info("Handwriting not recognized. Tap Add label manually to enter it, or move closer and tap Scan now.");return;
      }
      const fingerprint=[row.item,row.location,row.qty,row.po].join("|");
      if(batch.some(r=>[r.item,r.location,r.qty,r.po].join("|")===fingerprint)){
        info("Same label already scanned. Move to the next label.");return;
      }
      batch.push(row);redraw();
      info("Captured label "+batch.length+". "+(valid(row)?"Review its values below.":"Some handwriting needs correction.")+" Move to the next label.");
      if(batch.length>=MAX)stop();
    } catch(e){console.error(e);info("Camera scan failed: "+e.message);}
    finally{scanning=false;}
  }

  async function readUploadedPhoto(file) {
    if(!file || !/^image\//.test(file.type)) return info("Choose a JPG, PNG, or WebP image.");
    if(file.size > 16*1024*1024) return info("Photo is too large (maximum 16 MB).");
    if(batch.length>=MAX) return info("Batch is full. Verify and submit first.");
    let bitmap, ocr;
    try{
      bitmap=await createImageBitmap(file);
      const canvas=document.createElement("canvas");
      const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
      if(qrMode && rackTarget===null){await scanWarehouseQR(canvas);return;}
      if(!worker) worker=await Tesseract.createWorker("eng");
      ocr=await worker.recognize(canvas);
      const raw=ocr.data.text||"";
      if(rackTarget!==null){
        const record=batch[rackTarget],matches=readRack(raw);
        if(!record)return info("No pallet selected for rack verification.");
        if(matches.length!==1)return info("Photo must show exactly one readable rack magnet. Retake or enter destination manually and scan the rack.");
        const expected=normalLocation(record.location);
        record.rackRead=matches[0];
        record.rackVerified=Boolean(expected&&record.rackRead===expected);
        record.reviewed=false;redraw();
        if(record.rackVerified){rackTarget=null;info("Photo magnet "+record.rackRead+" matches selected pallet. Confirm the item and review.");}
        else info("Magnet photo shows "+record.rackRead+", but destination is "+(expected||"missing")+". Putaway remains blocked.");
        return;
      }
      const row=parseLabel(raw);
      if(!row.item&&!row.qty&&!row.po&&!row.location)return info("Could not read useful pallet label fields. Try a closer photo or Add label manually.");
      // OCR text is only a draft. Item, quantity and exact air slot must be confirmed.
      batch.push(row);redraw();
      info("Bulk pallet picture read into draft row "+batch.length+". Confirm item, quantity and exact air location, then scan the actual rack magnet before submitting.");
    }catch(e){console.error(e);info("Photo could not be processed: "+e.message);}
    finally{bitmap?.close?.();const fileInput=byId("cameraBatchPhoto");if(fileInput)fileInput.value="";}
  }

  function stop(){
    active=false;clearInterval(timer);timer=null;
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const v=byId("cameraBatchVideo");if(v)v.srcObject=null;
    byId("cameraBatchStart").textContent="Start camera";
  }
  async function start(){
    if(active){stop();info("Camera paused. Your scanned batch is preserved.");return;}
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){info("Camera requires HTTPS and camera permission.");return;}
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280}},audio:false});
      const v=byId("cameraBatchVideo");v.srcObject=stream;await v.play();
      active=true;byId("cameraBatchStart").textContent="Pause camera";
      info("Camera ready. Hold one label steady and tap Scan now. Review each captured line.");
      // Manual capture prevents blurred frames and repeated records while moving.
      timer=null;
    }catch(e){info("Camera unavailable: "+e.message);stop();}
  }
  async function submit(){
    if(!batch.length || batch.some(r=>!ready(r)))return info("Every line needs a matching rack magnet scan and employee review before submission.");
    const workerName=byId("putWorker")?.value.trim();
    if(!workerName)return info("Enter the employee name in the Put Away Log above first.");
    const existing=[...document.querySelectorAll("#putawayBody tr")];
    if(existing.some(tr=>[".put-item",".put-qty",".put-location",".put-notes"].some(sel=>tr.querySelector(sel)?.value.trim()))) {
      return info("The putaway form already has data. Save or clear that draft before submitting this camera batch.");
    }
    if(existing.length<batch.length)return info("The putaway form has fewer than "+batch.length+" rows.");
    const sheet=byId("putSheetNumber");
    if(!sheet.value.trim())sheet.value="CAM-"+new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    batch.forEach((r,i)=>{
      const tr=existing[i];
      tr.querySelector(".put-item").value=r.item;
      tr.querySelector(".put-qty").value=r.qty;
      tr.querySelector(".put-location").value=r.location;
      tr.querySelector(".put-notes").value="Receiving PO: "+r.po+" | Rack magnet scanned: "+r.rackRead+" | Camera batch verified";
    });
    window.updatePutawayStats?.();
    document.querySelector("#putawayBody .put-item")?.dispatchEvent(new Event("input",{bubbles:true}));
    info("Submitting "+batch.length+" verified lines to Put Away Logs…");
    const button=byId("cameraBatchSubmit");button.disabled=true;
    try{
      await window.savePutaway();
      const remaining=existing.some(tr=>tr.querySelector(".put-item")?.value.trim());
      if(remaining) {info("Submission not confirmed. Batch retained; check employee, sheet and connection.");return;}
      batch.length=0;rackTarget=null;redraw();stop();
      info("Batch submitted to the existing putaway log.");
    } catch(e){info("Submission unsuccessful; batch retained: "+e.message);}
    finally{redraw();}
  }
  function setup(){
    const panel=byId("putawayTab")?.querySelector(".card");if(!panel)return;
    const section=document.createElement("div");
    section.id="cameraBatch";section.className="card";
    section.hidden=true;section.style.display="none";
    section.style.marginTop="16px";
    section.innerHTML='<h3>Camera Batch Scanner</h3><p class="hint">Drivers can upload or take a bulk-pallet photo, or scan up to 25 receiving labels using Scan now for each steady image. Scan each actual rack magnet and review every handwritten field before submitting through the existing Put Away Log. Photos stay on this device and are not uploaded.</p>'+
      '<div class="actions"><label style="display:inline-block;padding:8px;border:1px solid #ccc;border-radius:8px">📷 Upload / take pallet photo<input id="cameraBatchPhoto" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" style="display:block;max-width:240px" /></label><button type="button" id="cameraBatchQRMode">Mode: OCR labels</button><button type="button" id="cameraBatchStart" class="primary">Start camera</button><button type="button" id="cameraBatchCapture">Scan now</button><button type="button" id="cameraBatchClear">Clear batch</button><button type="button" id="cameraBatchManual">+ Add label manually</button></div>'+
      '<video id="cameraBatchVideo" playsinline muted style="width:100%;max-height:330px;background:#111;border-radius:8px;object-fit:contain"></video>'+
      '<p class="hint" id="cameraBatchStatus" role="status">Camera is stopped.</p><strong id="cameraBatchCount">0 / 25 labels</strong>'+
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Item #</th><th>Location</th><th>Qty</th><th>Purchase order</th><th>Rack magnet</th><th>Item # check</th><th>Review</th><th></th></tr></thead><tbody id="cameraBatchRows"></tbody></table></div>'+
      '<div class="actions"><button class="primary" type="button" id="cameraBatchSubmit" disabled>Submit verified batch</button></div>';
    panel.parentNode.insertBefore(section,panel.nextSibling);
    const toggle=byId("openCameraBatchBtn");
    if(toggle)toggle.addEventListener("click",()=>{
      const opening=section.hidden;
      section.hidden=!opening;
      section.style.display=opening?"block":"none";
      toggle.setAttribute("aria-expanded",String(opening));
      toggle.textContent=opening?"✕ Close Camera OCR":"📷 Camera OCR · Batch Scan";
      if(opening){section.scrollIntoView({behavior:"smooth",block:"start"});}
      else{stop();}
    });
    byId("cameraBatchPhoto").addEventListener("change",e=>readUploadedPhoto(e.target.files?.[0]));
    byId("cameraBatchQRMode").addEventListener("click",()=>{qrMode=!qrMode;byId("cameraBatchQRMode").textContent=qrMode?"Mode: WarehouseOS QR":"Mode: OCR labels";info(qrMode?"QR mode enabled. Aim at one WarehouseOS Putaway QR sticker and tap Scan now.":"OCR mode enabled.");});
    byId("cameraBatchStart").addEventListener("click",start);
    byId("cameraBatchCapture").addEventListener("click",capture);
    byId("cameraBatchManual").addEventListener("click",addManualLabel);
    byId("cameraBatchClear").addEventListener("click",()=>{if(batch.length&&!confirm("Discard all scanned labels?"))return;batch.length=0;rackTarget=null;redraw();info("Batch cleared.");});
    byId("cameraBatchSubmit").addEventListener("click",submit);
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      const i=Number(e.target.dataset.index),k=e.target.dataset.key;
      if(!Number.isInteger(i)||!batch[i]||!["item","location","qty","po"].includes(k))return;
      batch[i][k]=field(e.target.value);batch[i].reviewed=false;if(k==="item")batch[i].itemConfirmed=false;if(k==="location"){batch[i].rackVerified=false;batch[i].rackRead="";}redraw();
    });
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      if(e.target.dataset.review===undefined)return;
      const i=Number(e.target.dataset.review);
      if(batch[i]){batch[i].reviewed=e.target.checked && valid(batch[i]) && batch[i].rackVerified && batch[i].rackRead===normalLocation(batch[i].location);redraw();}
    });
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      if(e.target.dataset.confirmItem===undefined)return;
      const i=Number(e.target.dataset.confirmItem);
      if(!batch[i])return;
      batch[i].itemConfirmed=e.target.checked && /^\d{6}$/.test(batch[i].item);
      batch[i].reviewed=false;
      redraw();
    });
    byId("cameraBatchRows").addEventListener("click",(e)=>{
      if(e.target.dataset.rack!==undefined){
        if(rackTarget===Number(e.target.dataset.rack)){rackTarget=null;info("Rack scan cancelled. Receiving scan resumed.");return;}
        rackTarget=Number(e.target.dataset.rack);
        if(!batch[rackTarget]){rackTarget=null;return;}
        info("Rack verification for label #"+(rackTarget+1)+": aim at its physical location magnet, then tap Scan now. Receiving capture is paused until the magnet matches.");
        return;
      }
      if(e.target.dataset.remove===undefined)return;
      const removed=Number(e.target.dataset.remove);batch.splice(removed,1);if(rackTarget===removed)rackTarget=null;else if(rackTarget!==null&&rackTarget>removed)rackTarget--;redraw();
    });
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stop();});
    window.addEventListener("pagehide",stop);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();