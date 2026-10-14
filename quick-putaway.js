(function(){
"use strict";
const $=id=>document.getElementById(id);
const key="warehouseOps_quickPutaway_reference_OH01_v1";
let catalog={};let stream=null,detector=null;
function msg(t){$("quickStatus").textContent=t;}
function normalize(x){return String(x||"").trim().toUpperCase().replace(/\s/g,"");}
function location(x){const v=normalize(x);return /^[A-Z]{1,2}-\d{2}(?:-\d{1,2})?$/.test(v)?v:"";}
function load(){try{catalog=JSON.parse(localStorage.getItem(key)||"{}");}catch{catalog={};}msg(Object.keys(catalog).length+" reference items on this device. No live BinMgr connection.");}
function lookup(){
 const item=normalize($("quickItem").value),bin=catalog[item]||"";
 $("quickBin").value=bin;
 $("quickAdd").disabled=!(/^\d{6}$/.test(item)&&bin);
 msg(bin?"Primary bin found in imported reference. Confirm item and quantity before adding.":"No primary bin found. Import an authorized item/bin export to use Quick Putaway.");
}
async function importFile(file){
 if(!file)return;
 const text=await file.text();const rows=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());
 const split=line=>line.split(/,|\t/).map(x=>x.trim().replace(/^"|"$/g,""));
 const headers=split(rows.shift()).map(x=>x.toLowerCase().replace(/[^a-z0-9]/g,""));
 const ix=headers.findIndex(x=>["item","itemnumber","itemno","sku","chadwellitem"].includes(x));
 const bx=headers.findIndex(x=>["primarybin","primarylocation","bin","binlocation","location"].includes(x));
 if(ix<0||bx<0){msg("Import requires Item Number and Primary Bin columns.");return;}
 const next={};let conflicts=0;
 rows.forEach(line=>{const cols=split(line),item=normalize(cols[ix]),bin=location(cols[bx]);if(!/^\d{6}$/.test(item)||!bin)return;if(next[item]&&next[item]!==bin){delete next[item];conflicts++;return;}next[item]=bin;});
 if(!Object.keys(next).length){msg("No valid item-to-primary-bin rows found.");return;}
 if(!confirm("Replace this device's local reference list with "+Object.keys(next).length+" items? Existing putaway history is not affected."))return;
 catalog=next;localStorage.setItem(key,JSON.stringify(catalog));msg("Imported "+Object.keys(catalog).length+" items. "+conflicts+" conflicting rows excluded.");lookup();
}
function add(){
 const item=normalize($("quickItem").value),bin=location($("quickBin").value),qty=Number($("quickQty").value);
 if(!/^\d{6}$/.test(item)||!bin||catalog[item]!==bin||!Number.isInteger(qty)||qty<=0)return msg("Enter a valid item, imported primary bin and positive whole-number quantity.");
 if(!$("quickConfirm").checked)return msg("Visually confirm the item number printed on the box.");
 const rows=[...document.querySelectorAll("#putawayBody tr")];
 const empty=rows.find(row=>![".put-item",".put-qty",".put-location",".put-notes"].some(sel=>row.querySelector(sel)?.value.trim()));
 if(!empty)return msg("The 25-line putaway sheet is full. Save your existing lines before adding more.");
 empty.querySelector(".put-item").value=item;empty.querySelector(".put-qty").value=String(qty);empty.querySelector(".put-location").value=bin;
 empty.querySelector(".put-notes").value="Quick Putaway | primary bin from imported reference | rack not camera-verified";
 empty.querySelector(".put-item").dispatchEvent(new Event("input",{bubbles:true}));
 $("quickItem").value="";$("quickQty").value="";$("quickBin").value="";$("quickConfirm").checked=false;$("quickAdd").disabled=true;
 msg("Added "+item+" to the next empty putaway row. Review actual rack before saving the sheet.");
 $("quickItem").focus();
}
async function camera(){
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;$("quickVideo").srcObject=null;$("quickCamera").textContent="Start item barcode camera";return;}
 if(!("BarcodeDetector" in window)){msg("This browser does not support built-in barcode detection. Enter the six-digit Chadwell item number or use a compatible scanner.");return;}
 try{
 detector=new BarcodeDetector({formats:["code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf"]});
 stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
 $("quickVideo").srcObject=stream;await $("quickVideo").play();$("quickCamera").textContent="Stop camera";
 const run=async()=>{if(!stream)return;try{
 const matches=await detector.detect($("quickVideo"));
 const six=matches.map(m=>normalize(m.rawValue)).find(v=>/^\d{6}$/.test(v));
 if(six){$("quickItem").value=six;lookup();await camera();msg("Scanned "+six+". Confirm that it matches the box.");return;}
 }catch(e){msg("Barcode scan retry: "+e.message);}
 setTimeout(run,700);};run();
 }catch(e){msg("Camera unavailable: "+e.message);if(stream)await camera();}
}
function setup(){
 const target=$("openCameraBatchBtn");if(!target||$("quickPutaway"))return;
 const button=document.createElement("button");button.type="button";button.className="primary";button.textContent="Quick Putaway · Item #";button.id="openQuickPutaway";button.style.marginLeft="8px";
 target.insertAdjacentElement("afterend",button);
 const panel=document.createElement("section");panel.className="card";panel.id="quickPutaway";panel.hidden=true;panel.style.display="none";
 panel.innerHTML='<h3>Quick Putaway · Item Number</h3><p class="hint">Read-only reference mode: import an approved CSV/TSV with Item Number and Primary Bin columns. No live BinMgr sync or inventory changes.</p>'+
 '<label>Load item/primary-bin reference (local to this device)<input id="quickFile" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label>'+
 '<div class="grid"><label>Chadwell item number<input id="quickItem" inputmode="numeric" maxlength="6" placeholder="Six-digit item number"></label><label>Primary bin (reference)<input id="quickBin" readonly placeholder="Import and enter item number"></label><label>Quantity (manual)<input id="quickQty" type="number" min="1" step="1" placeholder="Quantity"></label></div>'+
 '<div class="actions"><button type="button" id="quickCamera">Start item barcode camera</button><label><input id="quickConfirm" type="checkbox"> I verified the item number on the box</label><button type="button" class="primary" id="quickAdd" disabled>Add to existing putaway sheet</button></div>'+
 '<video id="quickVideo" playsinline muted style="width:100%;max-height:240px;background:#111;border-radius:8px"></video><p id="quickStatus" role="status" class="message"></p>';
 const card=$("putawayTab").querySelector(".card");card.parentNode.insertBefore(panel,card.nextSibling);
 button.addEventListener("click",()=>{panel.hidden=!panel.hidden;panel.style.display=panel.hidden?"none":"block";if(!panel.hidden)panel.scrollIntoView({behavior:"smooth",block:"start"});if(panel.hidden&&stream)camera();});
 $("quickItem").addEventListener("input",()=>{ $("quickConfirm").checked=false;lookup();});
 $("quickFile").addEventListener("change",e=>importFile(e.target.files[0]).catch(err=>msg("Import failed: "+err.message)));
 $("quickAdd").addEventListener("click",add);$("quickCamera").addEventListener("click",camera);
 document.addEventListener("visibilitychange",()=>{if(document.hidden&&stream)camera();});
 load();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();
})();