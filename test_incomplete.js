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

  // Give the player a name so Round History is scoped to them.
  const nameInput = doc.getElementById("playerName");
  nameInput.value = "Incomplete Tester";
  nameInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  // ---- 1. Unsaved banner starts hidden ----
  const banner = doc.getElementById("unsavedBanner");
  check("Unsaved banner hidden initially", !banner.classList.contains("show"));

  // ---- 2. Entering a score marks the round dirty and shows the banner ----
  const rows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const scoreInput1 = rows[0].querySelector('input[data-field="score"]');
  scoreInput1.value = "5";
  scoreInput1.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput1.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  check("Unsaved banner shows after entering a score", banner.classList.contains("show"));

  // ---- 3. beforeunload handler blocks navigation while dirty ----
  const ev = new window.Event("beforeunload", {cancelable:true});
  window.dispatchEvent(ev);
  check("beforeunload is prevented while dirty with a score entered", ev.defaultPrevented);

  // ---- 4. Save as Incomplete ----
  doc.getElementById("saveIncompleteBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  check("Unsaved banner hides after Save as Incomplete", !banner.classList.contains("show"));

  const historyRows = [...doc.querySelectorAll("#historyBody tr")];
  check("One row appears in Round History", historyRows.length === 1);

  const statusTag = historyRows[0].querySelector(".tag.incomplete");
  check("Round History shows an Incomplete tag", !!statusTag && /incomplete/i.test(statusTag.textContent));

  const scoreCell = historyRows[0].children[4]; // #, Date, Course, Status, Score...
  check("Score cell shows 'X/Y holes' for incomplete round", /\d+\/\d+ holes/.test(scoreCell.textContent));

  const continueBtn = historyRows[0].querySelector('[data-continue]');
  check("Continue button present for incomplete round", !!continueBtn);

  // ---- 5. Career Totals / trend charts exclude the incomplete round ----
  const careerRounds = doc.getElementById("careerRounds");
  check("Career Totals shows 0 rounds (incomplete excluded)", careerRounds.textContent.trim() === "0" || careerRounds.textContent.trim() === "-");

  // ---- 6. Continue opens the modal already in edit mode ----
  continueBtn.dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  const modal = doc.getElementById("historyDetailModal");
  check("Round Detail modal is shown", modal.classList.contains("show"));

  const hdScoreInputs = [...doc.querySelectorAll('#historyDetailBody input[data-field="score"]')];
  check("Modal score inputs are enabled (edit mode) via Continue", hdScoreInputs.every(el => !el.disabled));
  // Score now always has a value (pre-filled to Par) — never blank — even on a round saved as
  // Incomplete, so this is no longer a signal of "still needs playing".
  check("Modal score inputs are never blank (pre-filled to par)", hdScoreInputs.every(el => el.value !== ""));

  // ---- 7. Saving Changes on an Incomplete round now ASKS before promoting to Complete, instead of
  //         silently inferring it from "every hole has a score" (which is always true now). Mock
  //         confirm() to decline first, to prove the round stays Incomplete when the player says so.
  window.confirm = () => false;
  doc.getElementById("historyDetailSaveBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  const historyRowsAfterDecline = [...doc.querySelectorAll("#historyBody tr")];
  check("Round stays Incomplete when the Complete-promotion confirm is declined",
    !!historyRowsAfterDecline[0].querySelector(".tag.incomplete"));
  check("Continue button still present after declining promotion", !!historyRowsAfterDecline[0].querySelector('[data-continue]'));

  // ---- 8. Continue again, actually fill in the rest of the holes, and accept the promotion prompt ----
  historyRowsAfterDecline[0].querySelector('[data-continue]').dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  const hdScoreInputs2 = [...doc.querySelectorAll('#historyDetailBody input[data-field="score"]')];
  hdScoreInputs2.forEach((el)=>{
    el.value = "4";
    el.dispatchEvent(new window.Event("input", {bubbles:true}));
    el.dispatchEvent(new window.Event("change", {bubbles:true}));
  });
  await wait(20);

  window.confirm = () => true;
  doc.getElementById("historyDetailSaveBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  const historyRowsAfter = [...doc.querySelectorAll("#historyBody tr")];
  const completeTag = historyRowsAfter[0].querySelector(".tag.complete");
  check("Round promoted to Complete after accepting the confirm prompt", !!completeTag);
  check("Continue button gone now that round is Complete", !historyRowsAfter[0].querySelector('[data-continue]'));

  const careerRoundsAfter = doc.getElementById("careerRounds");
  check("Career Totals now counts the completed round", careerRoundsAfter.textContent.trim() === "1");

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
