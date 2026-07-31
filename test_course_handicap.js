const fs = require("fs");
const { JSDOM } = require("jsdom");

// Course Handicap now auto-calculates from the player's HI plus the selected Course/Tee/Gender's
// real Course Rating + Slope Rating (WHS formula), whenever that combination matches a Course
// Library entry with rating data on file. "ADELAIDE GOLF CLUB" is used as the real-data fixture
// throughout — confirmed present in the national seed with both Men and Women tee-sets:
//   White/Men:   CR 70.3, Slope 114, Par 74  -> HI 14.2 => HC 11
//   White/Women: CR 76.8, Slope 127, Par 74  -> HI 14.2 => HC 19
// (round(14.2 * slope/113 + (CR - par)))

let html = fs.readFileSync("/tmp/index_for_test.html", "utf8");
html = html.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js"><\/script>/,
  `<script>window.Chart = function(){ return { destroy(){}, update(){}, data:{datasets:[]} }; };</script>`
);

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
function fire(el, type){ el.dispatchEvent(new window.Event(type, {bubbles:true})); }

(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};
  window.confirm = () => true;

  // ---- 1. Pure function math, using Adelaide's real on-file numbers ----
  check("calculateCourseHandicap: HI 14.2 at White/Men (CR 70.3, Slope 114, Par 74) = 11",
    window.calculateCourseHandicap(14.2, {courseRating:70.3, slopeRating:114}, 74) === 11);
  check("calculateCourseHandicap: HI 14.2 at White/Women (CR 76.8, Slope 127, Par 74) = 19",
    window.calculateCourseHandicap(14.2, {courseRating:76.8, slopeRating:127}, 74) === 19);
  check("calculateCourseHandicap: returns null with no HI entered",
    window.calculateCourseHandicap("", {courseRating:70.3, slopeRating:114}, 74) === null);
  check("calculateCourseHandicap: returns null with no tee-set",
    window.calculateCourseHandicap(14.2, null, 74) === null);
  check("calculateCourseHandicap: returns null when tee-set has no rating data",
    window.calculateCourseHandicap(14.2, {courseRating:null, slopeRating:null}, 74) === null);

  // ---- 2. Selecting a real, rated course auto-fills HC once HI is entered ----
  const genderSel = doc.getElementById("playerGender");
  const courseInput = doc.getElementById("roundCourse");
  const teeSel = doc.getElementById("teeMarker");
  const hiInput = doc.getElementById("playerHI");
  const hcInput = doc.getElementById("playerHC");
  const note = doc.getElementById("courseRatingNote");

  genderSel.value = "Men";
  fire(genderSel, "change");
  courseInput.value = "ADELAIDE GOLF CLUB";
  fire(courseInput, "change");
  await wait(20);

  check("Tee Marker auto-selected White for Adelaide/Men", teeSel.value === "White");
  check("HC still blank before any HI is entered", hcInput.value === "");
  check("Course rating note shows CR/Slope even before HC can be calculated",
    note.textContent.includes("CR 70.3") && note.textContent.includes("Slope 114"));

  hiInput.value = "14.2";
  fire(hiInput, "input");
  fire(hiInput, "change");
  await wait(20);

  check("HC auto-calculated to 11 for HI 14.2 at Adelaide White/Men", hcInput.value === "11");
  check("Course rating note reports the calculated Course Handicap",
    note.textContent.includes("Course Handicap 11"));

  // ---- 3. Switching Gender re-picks the tee-set and recalculates HC from ITS OWN rating ----
  genderSel.value = "Women";
  fire(genderSel, "change");
  await wait(20);
  check("HC recalculated to 19 for the same HI at Adelaide White/Women", hcInput.value === "19");

  // ---- 4. Changing HI alone (same course/tee/gender) recalculates live ----
  hiInput.value = "20";
  fire(hiInput, "input");
  await wait(20);
  const expected20 = window.calculateCourseHandicap(20, {courseRating:76.8, slopeRating:127}, 74);
  check("Changing HI alone live-recalculates HC", Number(hcInput.value) === expected20);

  // ---- 5. A course NOT in the library never overwrites a manually-entered HC ----
  hcInput.value = "99";
  fire(hcInput, "change");
  courseInput.value = "Some Fake Golf Club Not In The Library";
  fire(courseInput, "change");
  await wait(20);
  check("Manual HC is left untouched for a course with no library/rating match", hcInput.value === "99");
  check("Course rating note clears when the course isn't a library match", note.textContent === "");

  // ---- 6. Regression: switching Tee Marker AFTER a real score is already entered must not pair
  // the newly-selected tee's Course Rating/Slope with the PREVIOUS tee's Par. Once any real score
  // exists, tryAutoFillCourseScorecard deliberately skips reloading the live holes (so it never
  // clobbers what's been entered) — but the HC calculation must still use the new tee's OWN rated
  // Par, not whatever Par happens to still be sitting in the live scorecard. This is the bug behind
  // reports of "inconsistent" HC, most visible on courses/tees commonly picked mid-round.
  const par4x18 = Array.from({length:18}, (_,i)=>({hole:i+1, par:4, stroke:i+1}));       // Red: total par 72
  const mixedPar = par4x18.map((h,i)=> i < 2 ? {...h, par:5} : h);                        // White: total par 74
  window.importCourses([{
    name: "Test Mismatch Golf Club",
    teeSets: [
      { teeName: "Red", teeColour:"", gender: "Men", courseRating: 68.0, slopeRating: 118, holes: par4x18 },
      { teeName: "White", teeColour:"", gender: "Men", courseRating: 70.0, slopeRating: 125, holes: mixedPar }
    ]
  }]);

  genderSel.value = "Men";
  fire(genderSel, "change");
  courseInput.value = "Test Mismatch Golf Club";
  fire(courseInput, "change");
  await wait(20);
  teeSel.value = "Red";
  fire(teeSel, "change");
  await wait(20);

  hiInput.value = "10";
  fire(hiInput, "input");
  fire(hiInput, "change");
  await wait(20);
  const expectedRed = window.calculateCourseHandicap(10, {courseRating:68.0, slopeRating:118}, 72);
  check("Setup check: HC correct at Red (Par 72) before switching tees", Number(hcInput.value) === expectedRed);

  // Enter a real score so the live holes now hold a genuine entry (blocks silent reload).
  const scoreInput = doc.querySelectorAll("#holeTable tbody tr")[0].querySelector('input[data-field="score"]');
  scoreInput.value = "9";
  fire(scoreInput, "input");
  fire(scoreInput, "change");
  await wait(20);

  // Switch to White — silently skips reloading the scorecard (a real score exists), but HC must
  // still be computed against White's OWN Par (74), not Red's stale live Par (72).
  teeSel.value = "White";
  fire(teeSel, "change");
  await wait(20);
  const expectedWhite = window.calculateCourseHandicap(10, {courseRating:70.0, slopeRating:125}, 74);
  const buggyMismatch = window.calculateCourseHandicap(10, {courseRating:70.0, slopeRating:125}, 72);
  check("Sanity: the correct and mismatched results are actually distinguishable", expectedWhite !== buggyMismatch);
  check("HC after switching tees mid-round uses White's own Par, not the stale Red Par",
    Number(hcInput.value) === expectedWhite);
  check("HC does NOT show the mismatched (stale-Par) result", Number(hcInput.value) !== buggyMismatch);

  // ---- 7. Regression: some real clubs only have a "Yellow" tee filed for ONE gender, with the
  // other gender's data sitting under a different tee name (e.g. "Blue"). If "Yellow" is just
  // left over from a previous course/screen (not a deliberate pick at THIS club) and a Women
  // golfer opens this club, the app must not silently default the Tee Marker to the Men-only
  // "Yellow" tee just because that name happens to carry over — it should land on the correct-
  // gender "Blue" tee instead, both in the dropdown itself and in the HC calculation. (A player
  // who deliberately types/selects "Yellow" herself afterwards still gets the Men's Yellow data,
  // same as explicitly picking a men-only "Championship" tee elsewhere — deliberate tee-name
  // choices are always honoured. This regression is specifically about the automatic default.)
  const yellowMenHoles = Array.from({length:18}, (_,i)=>({hole:i+1, par:4, stroke:i+1}));       // Par 72
  const blueWomenHoles = yellowMenHoles.map((h,i)=> i < 3 ? {...h, par:5} : h);                   // Par 75
  window.importCourses([{
    name: "Test Gender Priority Golf Club",
    teeSets: [
      { teeName: "Yellow", teeColour:"", gender: "Men", courseRating: 68.0, slopeRating: 110, holes: yellowMenHoles },
      { teeName: "Blue", teeColour:"", gender: "Women", courseRating: 74.0, slopeRating: 130, holes: blueWomenHoles }
    ]
  }]);

  // Simulate "Yellow" being left over as the Tee Marker value from earlier (a different course,
  // or just the app's own default), then a Women golfer opens this new club.
  genderSel.value = "Women";
  fire(genderSel, "change");
  window.restoreDefaultTeeOptions(); // simulate "Yellow" being a valid, pre-existing dropdown value
  teeSel.value = "Yellow";
  fire(teeSel, "change");

  courseInput.value = "Test Gender Priority Golf Club";
  fire(courseInput, "change");
  await wait(20);

  check('"Yellow" is offered as a Tee Marker option even though it is only filed for Men here',
    [...teeSel.options].some(o => o.value === "Yellow"));
  check('Opening this club auto-corrects the Tee Marker to "Blue" instead of defaulting to the Men-only "Yellow"',
    teeSel.value === "Blue");

  hiInput.value = "12";
  fire(hiInput, "input");
  fire(hiInput, "change");
  await wait(20);

  const expectedCorrectGender = window.calculateCourseHandicap(12, {courseRating:74.0, slopeRating:130}, 75);
  const buggyWrongGender = window.calculateCourseHandicap(12, {courseRating:68.0, slopeRating:110}, 72);
  check("Sanity: correct-gender and wrong-gender results are distinguishable", expectedCorrectGender !== buggyWrongGender);
  check("HC uses the Women's (Blue) rating, not the leftover Men's Yellow rating",
    Number(hcInput.value) === expectedCorrectGender);
  check("HC does NOT use the wrong-gender Men's Yellow numbers", Number(hcInput.value) !== buggyWrongGender);
  check("Course rating note reflects the actual tee used (Blue), not the leftover name (Yellow)",
    note.textContent.includes("Blue") && note.textContent.includes("CR 74"));

  // ---- 8. Deliberate override still works: explicitly picking "Yellow" herself afterwards shows
  // the Men's Yellow data for that specific named tee — same precedent as a men-only "Championship"
  // tee elsewhere. This is intentional (there's no better data for that exact tee she chose), and
  // must keep working even after the auto-default fix above.
  teeSel.value = "Yellow";
  fire(teeSel, "change");
  await wait(20);
  const expectedDeliberateYellow = window.calculateCourseHandicap(12, {courseRating:68.0, slopeRating:110}, 72);
  check('Deliberately selecting "Yellow" herself still shows the Men\'s Yellow data for that named tee',
    Number(hcInput.value) === expectedDeliberateYellow);

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
