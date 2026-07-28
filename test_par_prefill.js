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

(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};
  window.confirm = () => true;

  // ---- 1. defaultHole() pre-fills Score with Par instead of leaving it blank ----
  const h = window.defaultHole(7);
  check("defaultHole().score equals defaultHole().par", h.score === h.par);
  check("defaultHole().score is not blank", h.score !== "");

  // ---- 2. holeHasRealEntry(): the core "has this hole actually been played" signal ----
  const untouchedHole = window.defaultHole(1);
  check("Fresh default hole has no real entry", window.holeHasRealEntry(untouchedHole) === false);

  const scoreChanged = Object.assign(window.defaultHole(1), {score: 6});
  check("Changing Score away from Par counts as a real entry", window.holeHasRealEntry(scoreChanged) === true);

  const clearedScore = Object.assign(window.defaultHole(1), {score: ""});
  check("Explicitly clearing Score back to blank is NOT a real entry (same as untouched)", window.holeHasRealEntry(clearedScore) === false);

  const puttsEntered = Object.assign(window.defaultHole(1), {putts: 2});
  check("Recording putts (even a routine 2-putt) counts as a real entry even if Score still equals Par", window.holeHasRealEntry(puttsEntered) === true);

  const fairwayHit = Object.assign(window.defaultHole(1), {fairway: "hit"});
  check("Recording Fairway result counts as a real entry", window.holeHasRealEntry(fairwayHit) === true);

  // ---- 3. Live Round Entry: score inputs are pre-filled to each hole's Par, not blank ----
  const scoreInputs = [...doc.querySelectorAll("#holeTable tbody tr")].map(tr => tr.querySelector('input[data-field="score"]'));
  const parSelects = [...doc.querySelectorAll("#holeTable tbody tr")].map(tr => tr.querySelector('select[data-field="par"]'));
  check("Round Entry has 18 score inputs, all pre-filled (none blank)", scoreInputs.length === 18 && scoreInputs.every(el => el.value !== ""));
  check("Each pre-filled score input matches that hole's own Par", scoreInputs.every((el, i) => el.value === parSelects[i].value));

  // ---- 4. Unsaved banner / dirty tracking stay quiet on a totally untouched round ----
  const banner = doc.getElementById("unsavedBanner");
  check("Unsaved banner hidden on a fresh, untouched round", !banner.classList.contains("show"));

  // ---- 5. Manually changing a hole's Par (without touching Score) nudges the still-untouched
  //         Score to match the new Par, so it never shows a stale value against the new Par ----
  const parSelect1 = parSelects[0];
  parSelect1.value = "3";
  parSelect1.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  const scoreInput1After = [...doc.querySelectorAll("#holeTable tbody tr")][0].querySelector('input[data-field="score"]');
  check("Changing Par on an untouched hole updates its pre-filled Score to match", scoreInput1After.value === "3");

  // Now actually play hole 2 (score genuinely different from its par), then change ITS par —
  // the real score must NOT be silently overwritten.
  const rows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const scoreInput2 = rows[1].querySelector('input[data-field="score"]');
  scoreInput2.value = "6";
  scoreInput2.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput2.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  const parSelect2 = rows[1].querySelector('select[data-field="par"]');
  parSelect2.value = "5";
  parSelect2.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  const scoreInput2After = [...doc.querySelectorAll("#holeTable tbody tr")][1].querySelector('input[data-field="score"]');
  check("Changing Par on a hole with a real entered score leaves that score alone", scoreInput2After.value === "6");

  // ---- 6. Unsaved banner now shows, since hole 2 has a genuine entry ----
  check("Unsaved banner shows once a hole has a real entry", banner.classList.contains("show"));

  // ---- 7. Totals assume par for anything still untouched: Total Score = sum of every hole's
  //         current Par/Score, shown immediately rather than "-", per the "counts as par if
  //         untouched" design choice ----
  const totScoreText = doc.getElementById("totScore").textContent;
  check('Total Score shows a real number (not "-") even though most holes are untouched', totScoreText !== "-" && !isNaN(Number(totScoreText)));

  // ---- 8. Save validation: an entirely untouched round is still blocked from being saved ----
  // Build a fresh round (reload the page context is overkill here — instead directly assert via
  // the exposed holeHasRealEntry over a freshly-built holes array, mirroring what commitRound checks).
  const freshHoles = Array.from({length:18}, (_,i) => window.defaultHole(i+1));
  check("A fully fresh set of holes has zero real entries (would block Save)", freshHoles.filter(window.holeHasRealEntry).length === 0);

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
