const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let html = fs.readFileSync("/tmp/index_for_test.html", "utf8");
// Strip the Chart.js CDN script (no network in sandbox) and stub a global Chart before app script runs.
html = html.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js"><\/script>/,
  `<script>window.Chart = function(){ return { destroy(){}, update(){}, data:{datasets:[]} }; };</script>`
);

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "http://localhost/",
});

const { window } = dom;

function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

(async () => {
  await wait(300); // let scripts execute & any async init settle

  const doc = window.document;
  const results = [];
  function check(name, cond){
    results.push({name, pass: !!cond});
  }

  // ---- 1. thead order on live entry table ----
  const theadCells = [...doc.querySelectorAll("#holeTable thead th")].map(th=>th.textContent.trim());
  check("Live thead ends with Penalties then Putts", (()=>{
    const pIdx = theadCells.findIndex(t=>/penalt/i.test(t));
    const puIdx = theadCells.findIndex(t=>/putt/i.test(t));
    return pIdx !== -1 && puIdx !== -1 && puIdx === pIdx + 1 && puIdx === theadCells.length - 1;
  })());

  // ---- 2. tbody row cell order for live table (first row) ----
  const firstRow = doc.querySelector("#holeTable tbody tr");
  const cellFields = [...firstRow.querySelectorAll("td")].map(td=>{
    const inp = td.querySelector("input,select");
    return inp ? inp.dataset.field : null;
  });
  check("Live row field order", JSON.stringify(cellFields) === JSON.stringify([
    null, "stroke", "par", "score", null, null, "fairway", "green", "shortShots", "penalties", "putts"
  ]));

  // ---- 3. Stroke select has options 1-18 ----
  const strokeSelect = firstRow.querySelector('select[data-field="stroke"]');
  const strokeOpts = [...strokeSelect.options].map(o=>o.value);
  check("Stroke options are 1..18", JSON.stringify(strokeOpts) === JSON.stringify(Array.from({length:18},(_,i)=>String(i+1))));

  // ---- 4. Par select has options 3,4,5 ----
  const parSelect = firstRow.querySelector('select[data-field="par"]');
  const parOpts = [...parSelect.options].map(o=>o.value);
  check("Par options are 3,4,5", JSON.stringify(parOpts) === JSON.stringify(["3","4","5"]));

  // ---- 5. tfoot order (grand total row) ----
  const grandCells = [...doc.querySelectorAll("#holeTable tfoot tr")].pop();
  const grandLabels = [...grandCells.children].map(td=>td.id || "");
  check("Live tfoot putts total is last cell", /putts/i.test(grandLabels[grandLabels.length-1]));

  // ---- 6. Duplicate stroke index is resolved by an automatic swap, not a blocking alert ----
  // hole 2's stroke select -> set to same value as hole 1's stroke select
  const rows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const row1Stroke = rows[0].querySelector('select[data-field="stroke"]');
  const row2Stroke = rows[1].querySelector('select[data-field="stroke"]');
  const origRow1Val = row1Stroke.value;
  const origRow2Val = row2Stroke.value;

  let alertMsg = null;
  window.alert = (msg) => { alertMsg = msg; };

  row2Stroke.value = origRow1Val; // set hole 2's Stroke Index to hole 1's current value
  row2Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(50);

  check("No blocking alert on duplicate stroke (swap instead)", alertMsg === null);

  // Hole 2 should now hold hole 1's old value, and hole 1 should have picked up hole 2's old
  // value in exchange — a clean swap, so both holes still hold unique Stroke Index values.
  const rows2 = [...doc.querySelectorAll("#holeTable tbody tr")];
  const row1StrokeAfter = rows2[0].querySelector('select[data-field="stroke"]');
  const row2StrokeAfter = rows2[1].querySelector('select[data-field="stroke"]');
  check("Hole 2 took hole 1's Stroke Index", row2StrokeAfter.value === origRow1Val);
  check("Hole 1 took hole 2's old Stroke Index in exchange", row1StrokeAfter.value === origRow2Val);

  // ---- 7. Round Detail modal: thead / row order ----
  const hdTheadCells = [...doc.querySelectorAll("#historyDetailTable thead th")].map(th=>th.textContent.trim());
  check("Modal thead ends with Penalties then Putts", (()=>{
    const pIdx = hdTheadCells.findIndex(t=>/penalt/i.test(t));
    const puIdx = hdTheadCells.findIndex(t=>/putt/i.test(t));
    return pIdx !== -1 && puIdx !== -1 && puIdx === pIdx + 1 && puIdx === hdTheadCells.length - 1;
  })());

  // `historyDetailHoles`/`history` are module-scoped `let` bindings in the app script — they do NOT
  // attach to `window`, so we can't just assign them from the test. Drive a real save through the UI
  // instead (enter a score, click Save) then open the Round Detail modal via the app's own function,
  // which is a top-level function declaration and therefore IS reachable on `window`.
  const scoreInput = rows2[0].querySelector('input[data-field="score"]');
  scoreInput.value = "4";
  scoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.alert = () => {}; // swallow the "Round saved to history." alert
  doc.getElementById("saveRoundBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  window.showHistoryDetail(0);
  await wait(50);

  const hdFirstRow = doc.querySelector("#historyDetailBody tr");
  const hdCellFields = [...hdFirstRow.querySelectorAll("td")].map(td=>{
    const inp = td.querySelector("input,select");
    return inp ? inp.dataset.field : null;
  });
  check("Modal row field order", JSON.stringify(hdCellFields) === JSON.stringify([
    null, "stroke", "par", "score", null, null, "fairway", "green", "shortShots", "penalties", "putts"
  ]));

  const hdStrokeSelect = hdFirstRow.querySelector('select[data-field="stroke"]');
  const hdStrokeOpts = [...hdStrokeSelect.options].map(o=>o.value);
  check("Modal stroke options are 1..18", JSON.stringify(hdStrokeOpts) === JSON.stringify(Array.from({length:18},(_,i)=>String(i+1))));

  const hdParSelect = hdFirstRow.querySelector('select[data-field="par"]');
  const hdParOpts = [...hdParSelect.options].map(o=>o.value);
  check("Modal par options are 3,4,5", JSON.stringify(hdParOpts) === JSON.stringify(["3","4","5"]));

  // ---- 8. Duplicate stroke in modal resolves by swap, not a blocking alert ----
  window.setHistoryDetailEditable(true);
  await wait(20);

  const hdRows = [...doc.querySelectorAll("#historyDetailBody tr")];
  const hdRow1Stroke = hdRows[0].querySelector('select[data-field="stroke"]');
  const hdRow2Stroke = hdRows[1].querySelector('select[data-field="stroke"]');
  const hdOrigRow1Val = hdRow1Stroke.value;
  const hdOrigRow2Val = hdRow2Stroke.value;

  let hdAlertMsg = null;
  window.alert = (msg) => { hdAlertMsg = msg; };

  hdRow2Stroke.value = hdRow1Stroke.value;
  hdRow2Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(50);

  check("No blocking alert on modal duplicate stroke (swap instead)", hdAlertMsg === null);

  const hdRows2 = [...doc.querySelectorAll("#historyDetailBody tr")];
  const hdRow1StrokeAfter = hdRows2[0].querySelector('select[data-field="stroke"]');
  const hdRow2StrokeAfter = hdRows2[1].querySelector('select[data-field="stroke"]');
  check("Modal hole 2 took hole 1's Stroke Index", hdRow2StrokeAfter.value === hdOrigRow1Val);
  check("Modal hole 1 took hole 2's old Stroke Index in exchange", hdRow1StrokeAfter.value === hdOrigRow2Val);

  // ---- report ----
  let allPass = true;
  for(const r of results){
    console.log((r.pass ? "PASS" : "FAIL") + " - " + r.name);
    if(!r.pass) allPass = false;
  }
  console.log(allPass ? "\nALL TESTS PASSED" : "\nSOME TESTS FAILED");
  process.exit(allPass ? 0 : 1);
})().catch(err=>{
  console.error("TEST ERROR:", err);
  process.exit(1);
});
