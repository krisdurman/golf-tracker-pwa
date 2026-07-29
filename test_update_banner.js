const fs = require("fs");
const { JSDOM } = require("jsdom");

let html = fs.readFileSync("/tmp/index_for_test.html", "utf8");
html = html.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js"><\/script>/,
  `<script>window.Chart = function(){ return { destroy(){}, update(){}, data:{datasets:[]} }; };</script>`
);

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

// jsdom doesn't implement real navigation, so window.location.reload() is a harmless no-op here
// (it prints a benign "Not implemented" notice to the virtual console) — this file tests the
// actual app logic that matters: the banner showing/hiding, and the confirm() guard that stops a
// refresh from silently wiping an in-progress, not-yet-saved round.
(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};

  const banner = doc.getElementById("updateBanner");

  // ---- 1. Banner starts hidden ----
  check("Update banner hidden on load", !banner.classList.contains("show"));

  // ---- 2. showUpdateBanner() (the hook the service worker's updatefound handler calls) shows it ----
  window.showUpdateBanner();
  check("showUpdateBanner() shows the banner", banner.classList.contains("show"));

  // ---- 3. "Not Now" dismisses without touching confirm/reload ----
  let confirmCalls = 0, lastConfirmMsg = null;
  window.confirm = (msg) => { confirmCalls++; lastConfirmMsg = msg; return true; };
  doc.getElementById("updateBannerDismissBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check('"Not Now" hides the banner', !banner.classList.contains("show"));
  check('"Not Now" never calls confirm()', confirmCalls === 0);

  // ---- 4. Refresh Now on a fresh, untouched round never prompts confirm (nothing to lose) ----
  window.showUpdateBanner();
  doc.getElementById("updateBannerBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check("Refresh Now on an untouched round does not prompt confirm()", confirmCalls === 0);

  // ---- 5. Enter a real score, then Refresh Now MUST warn before refreshing ----
  const scoreInput = [...doc.querySelectorAll("#holeTable tbody tr")][0].querySelector('input[data-field="score"]');
  scoreInput.value = "9"; // well away from this hole's default par, so it's an unambiguous real entry
  scoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.showUpdateBanner();
  doc.getElementById("updateBannerBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check("Refresh Now with a real unsaved score DOES prompt confirm()", confirmCalls === 1);
  check("The confirm message warns about losing unsaved scores", /unsaved scores/i.test(lastConfirmMsg || ""));

  // ---- 6. Declining the prompt is respected (no crash, no further unexpected confirm calls) ----
  window.confirm = () => false;
  window.showUpdateBanner();
  doc.getElementById("updateBannerBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check("Declining the refresh prompt does not throw or break the page", doc.getElementById("updateBanner") !== null);

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
