(function () {
  "use strict";
  const MAX = 25;
  let stream = null, worker = null, scanning = false, active = false, timer = null;
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
    const locLine = normalized.find(s=>/[A-Z][-]?\d{2}[-]?\d{1,2}/.test(s)) || "";
    const locMatch = locLine.match(/([A-Z])[-]?(\d{2})[-]?(\d{1,2})/);
    const location = locMatch ? locMatch.slice(1).join("-") : "";
    const afterLoc = normalized.indexOf(locLine);
    const qtyLine = normalized.slice(afterLoc + 1).find(s=>/^\d{1,4}$/.test(s)) || "";
    const poLine = normalized.find(s=>/^(SP|PO|SPO|EDI|XFR)[A-Z0-9-]{4,}$/.test(s)) || "";
    return {item, location, qty:qtyLine, po:poLine, reviewed:false, raw:text, id:crypto.randomUUID?.() || String(Date.now()+Math.random())};
  }
  function valid(row) {return /^\d{6}$/.test(row.item) && /^[A-Z]-\d{2}-\d{1,2}$/.test(row.location) && /^\d+$/.test(row.qty) && Number(row.qty) > 0 && Boolean(row.po);}
  function redraw() {
    const body=byId("cameraBatchRows");
    body.innerHTML="";
    batch.forEach((r,i)=>{
      const tr=document.createElement("tr");
      tr.innerHTML='<td>'+ (i+1) +'</td>' +
        ["item","location","qty","po"].map(k=>'<td><input data-index="'+i+'" data-key="'+k+'" aria-label="'+k+' line '+(i+1)+'" value="'+escapeHTML(r[k])+'" style="min-width:85px;max-width:145px" /></td>').join("") +
        '<td><label><input type="checkbox" data-review="'+i+'" '+(r.reviewed?'checked':'')+' /> Verified</label></td>' +
        '<td><button type="button" data-remove="'+i+'">Remove</button></td>';
      if(!valid(r)) tr.style.background="rgba(245,158,11,.13)";
      body.appendChild(tr);
    });
    byId("cameraBatchCount").textContent=batch.length+" / "+MAX+" labels";
    byId("cameraBatchSubmit").disabled= !batch.length || batch.some(r=>!r.reviewed || !valid(r));
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
      timer=setInterval(()=>{if(active&&!scanning&&batch.length<MAX)capture();},3500);
    }catch(e){info("Camera unavailable: "+e.message);stop();}
  }
  async function submit(){
    if(!batch.length || batch.some(r=>!r.reviewed||!valid(r)))return info("Verify every row and correct highlighted fields first.");
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
      tr.querySelector(".put-notes").value="Receiving PO: "+r.po+" | Camera batch verified";
    });
    window.updatePutawayStats?.();
    document.querySelector("#putawayBody .put-item")?.dispatchEvent(new Event("input",{bubbles:true}));
    info("Submitting "+batch.length+" verified lines to Put Away Logs…");
    const button=byId("cameraBatchSubmit");button.disabled=true;
    try{
      await window.savePutaway();
      const remaining=existing.some(tr=>tr.querySelector(".put-item")?.value.trim());
      if(remaining) {info("Submission not confirmed. Batch retained; check employee, sheet and connection.");return;}
      batch.length=0;redraw();stop();
      info("Batch submitted to the existing putaway log.");
    } catch(e){info("Submission unsuccessful; batch retained: "+e.message);}
    finally{redraw();}
  }
  function setup(){
    const panel=byId("putawayTab")?.querySelector(".card");if(!panel)return;
    const section=document.createElement("div");
    section.id="cameraBatch";section.className="card";
    section.style.marginTop="16px";
    section.innerHTML='<h3>Camera Batch Scanner</h3><p class="hint">Scan up to 25 receiving labels continuously. Review every handwritten field before submitting through the existing Put Away Log. Photos stay on this device and are not uploaded.</p>'+
      '<div class="actions"><button type="button" id="cameraBatchStart" class="primary">Start camera</button><button type="button" id="cameraBatchCapture">Scan now</button><button type="button" id="cameraBatchClear">Clear batch</button></div>'+
      '<video id="cameraBatchVideo" playsinline muted style="width:100%;max-height:330px;background:#111;border-radius:8px;object-fit:contain"></video>'+
      '<p class="hint" id="cameraBatchStatus" role="status">Camera is stopped.</p><strong id="cameraBatchCount">0 / 25 labels</strong>'+
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>Item #</th><th>Location</th><th>Qty</th><th>Purchase order</th><th>Review</th><th></th></tr></thead><tbody id="cameraBatchRows"></tbody></table></div>'+
      '<div class="actions"><button class="primary" type="button" id="cameraBatchSubmit" disabled>Submit verified batch</button></div>';
    panel.parentNode.insertBefore(section,panel.nextSibling);
    byId("cameraBatchStart").addEventListener("click",start);
    byId("cameraBatchCapture").addEventListener("click",capture);
    byId("cameraBatchClear").addEventListener("click",()=>{if(batch.length&&!confirm("Discard all scanned labels?"))return;batch.length=0;redraw();info("Batch cleared.");});
    byId("cameraBatchSubmit").addEventListener("click",submit);
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      const i=Number(e.target.dataset.index),k=e.target.dataset.key;
      if(!Number.isInteger(i)||!batch[i]||!["item","location","qty","po"].includes(k))return;
      batch[i][k]=field(e.target.value);batch[i].reviewed=false;redraw();
    });
    byId("cameraBatchRows").addEventListener("change",(e)=>{
      if(e.target.dataset.review===undefined)return;
      const i=Number(e.target.dataset.review);
      if(batch[i]){batch[i].reviewed=e.target.checked && valid(batch[i]);redraw();}
    });
    byId("cameraBatchRows").addEventListener("click",(e)=>{
      if(e.target.dataset.remove===undefined)return;
      batch.splice(Number(e.target.dataset.remove),1);redraw();
    });
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stop();});
    window.addEventListener("pagehide",stop);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();