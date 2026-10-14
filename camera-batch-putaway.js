(function () {
  "use strict";
  const MAX = 25;
  let stream = null, worker = null, scanning = false, active = false, timer = null;
  let rackTarget = null; // null: receive labels; index: verify actual rack magnet
  const batch = [];
  const byId = (id) => document.getElementById(id);
  const field = (value) => String(value || "").trim().toUpperCase();
  const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const info = (s) => { byId("cameraBatchStatus").textContent = s; };
  function parseLabel(text) {
    const lines = text.toUpperCase().split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const normalized = lines.map(s=>s.replace(/\s/g, "").replace(/[.·]/g,"-"));
    const itemLine = normalized.find(s=>/\b\d{6}\b/.test(s)) || "";
    const item = (itemLine.match(/\d{6}/) || [""])[0];
    const locLine = normalized.find(s=>/^[A-Z]{1,2}-?\d{2}(?:-?\d{1,2})?$/.test(s)) || "";
    const locMatch = locLine.match(/([A-Z]{1,2})[-]?(\d{2})(?:[-]?(\d{1,2}))?/);
    const location = locMatch ? locMatch.slice(1).filter(Boolean).join("-") : "";
    const afterLoc = normalized.indexOf(locLine);
    const qtyLine = normalized.slice(afterLoc + 1).find(s=>/^\d{1,4}$/.test(s)) || "";
    const poLine = normalized.find(s=>/^(SP|PO|SPO|EDI|XFR)[A-Z0-9-]{4,}$/.test(s)) || "";
    return {item, location, qty:qtyLine, po:poLine, reviewed:false, rackVerified:false, rackRead:"", raw:text, id:crypto.randomUUID?.() || String(Date.now()+Math.random())};
  }
  function normalLocation(value) {
    const clean=field(value).replace(/[\s_]/g,"").replace(/[—–]/g,"-").replace(/[.]/g,"-");
    const match=clean.match(/^([A-Z]{1,2})-?(\d{2})(?:-?(\d{1,2}))?$/);
    return match ? match.slice(1).filter(Boolean).join("-") : "";
  }
  function readRack(text) {
    const cleaned=field(text).replace(/[—–]/g,"-");
    const candidates=(cleaned.match(/\b[A-Z]{1,2}\s*[-]?\s*\d{2}(?:\s*[-]\s*\d{1,2})?\b/g)||[])
      .map(normalLocation).filter(Boolean);
    return [...new Set(candidates)];
  }
  function valid(row) {return /^\d{6}$/.test(row.item) && Boolean(normalLocation(row.location)) && /^\d+$/.test(row.qty) && Number(row.qty) > 0 && Boolean(row.po);}
  function ready(row) {return valid(row) && row.reviewed && row.rackVerified && row.rackRead===normalLocation(row.location);}
  function redraw() {
    const body=byId("cameraBatchRows");
    body.innerHTML="";
    batch.forEach((r,i)=>{
      const tr=document.createElement("tr");
      tr.innerHTML='<td>'+ (i+1) +'</td>' +
        ["item","location","qty","po"].map(k=>'<td><input data-index="'+i+'" data-key="'+k+'" aria-label="'+k+' line '+(i+1)+'" value="'+escapeHTML(r[k])+'" style="min-width:85px;max-width:145px" /></td>').join("") +
        '<td><button type="button" data-rack="'+i+'">Scan magnet</button><small style="display:block">'+escapeHTML(r.rackVerified ? "✓ " + r.rackRead : (r.rackRead ? "Mismatch: " + r.rackRead : "Not scanned"))+'</small></td>' +
        '<td><label><input type="checkbox" data-review="'+i+'" '+(r.reviewed?'checked':'')+' /> Verified</label></td>' +
        '<td><button type="button" data-remove="'+i+'">Remove</button></td>';
      if(!valid(r) || !r.rackVerified) tr.style.background="rgba(245,158,11,.13)";
      body.appendChild(tr);
    });
    byId("cameraBatchCount").textContent=batch.length+" / "+MAX+" labels";
    byId("cameraBatchSubmit").disabled= !batch.length || batch.some(r=>!ready(r));
  }
  async function capture() {
    if(scanning || !stream || batch.length>=MAX)return;
    scanning=true;
    try {
      info("Reading handwriting…");
      const video=byId("cameraBatchVideo"), canvas=document.createElement("canvas");
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext("2d").drawImage(video,0,0);
      if(!worker)worker=await Tesseract.createWorker("eng");
      const result=await worker.recognize(canvas);
      if(rackTarget!==null){
        const target=rackTarget, record=batch[target];
        if(!record){rackTarget=null;info("That label is no longer in the batch.");return;}
        const found=readRack(result.data.text), expected=normalLocation(record.location);
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
      if(!row.item && !row.location && !row.qty && !row.po) {
        info("Could not read this label. Adjust lighting and try again.");return;
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
      info("Camera ready. Hold each label steady, then move to the next.");
      timer=setInterval(()=>{if(active && rackTarget===null && !scanning && batch.length<MAX)capture();},3500);
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
    section.style.marginTop="16px";
    section.innerHTML='<h3>Camera Batch Scanner</h3><p class="hint">Scan up to 25 receiving labels continuously. Scan each actual rack magnet and review every handwritten field before submitting through the existing Put Away Log. Photos stay on this device and are not uploaded.</p>'+
      '<div class="actions"><button type="button" id="cameraBatchStart" class="primary">Start camera</button><button type="button" id="cameraBatchCapture">Scan now</button><button type="button" id="cameraBatchClear">Clear batch</button></div>'+
      '<video id="cameraBatchVideo" playsinline muted style="width:100%;max-height:330px;background:#111;border-radius:8px;object-fit:contain"></video>'+
      '<p class="hint" id="cameraBatchStatus" role="status">Camera is stopped.</p><strong id="cameraBatchCount">0 / 25 labels</strong>'+
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Item #</th><th>Location</th><th>Qty</th><th>Purchase order</th><th>Rack magnet</th><th>Review</th><th></th></tr></thead><tbody id="cameraBatchRows"></tbody></table></div>'+
      '<div class="actions"><button class="primary" type="button" id="cameraBatchSubmit" disabled>Submit verified batch</button></div>';
    panel.parentNode.insertBefore(section,panel.nextSibling);
    byId("cameraBatchStart").addEventListener("click",start);
    byId("cameraBatchCapture").addEventListener("click",capture);
    byId("cameraBatchClear").addEventListener("click",()=>{if(batch.length&&!confirm("Discard all scanned labels?"))return;batch.length=0;rackTarget=null;redraw();info("Batch cleared.");});
    byId("cameraBatchSubmit").addEventListener("click",submit);
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      const i=Number(e.target.dataset.index),k=e.target.dataset.key;
      if(!Number.isInteger(i)||!batch[i]||!["item","location","qty","po"].includes(k))return;
      batch[i][k]=field(e.target.value);batch[i].reviewed=false;if(k==="location"){batch[i].rackVerified=false;batch[i].rackRead="";}redraw();
    });
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      if(e.target.dataset.review===undefined)return;
      const i=Number(e.target.dataset.review);
      if(batch[i]){batch[i].reviewed=e.target.checked && valid(batch[i]) && batch[i].rackVerified && batch[i].rackRead===normalLocation(batch[i].location);redraw();}
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