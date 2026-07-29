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

// The standalone "Course Library (Admin)" card (manual creation form + CSV import + Saved
// Courses dropdown) was removed — bulk/library updates now happen by regenerating the embedded
// national seed in code, not through the app. What's left, and what this file covers, is the
// Round Entry-side workflow: saving/loading a course's scorecard on the fly via "Remember This
// Scorecard" / "Load Saved Scorecard", multi-tee-set gender/tee auto-fill, and the minimal
// "Delete Saved Course" cleanup control.
(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};
  window.confirm = () => true;

  // ---- 1. "Remember This Scorecard" saves the live Par/Stroke Index under a course name,
  //         entirely from Round Entry — no separate admin form involved ----
  const roundCourse = doc.getElementById("roundCourse");
  roundCourse.value = "Boss Consulting Links";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  // Defaults are stroke === hole number, so every value 1-18 is already "taken". Setting hole 1's
  // Stroke Index to 5 must swap with whichever hole currently holds 5 (hole 5) rather than being
  // rejected — one click gets both holes to the real scorecard's values.
  let liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const hole1Stroke = liveRows[0].querySelector('select[data-field="stroke"]');
  hole1Stroke.value = "5";
  hole1Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  doc.getElementById("saveScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  const savedCourse = window.findCourse("Boss Consulting Links");
  check('"Remember This Scorecard" creates a new Course Library entry', !!savedCourse && savedCourse.teeSets.length === 1);
  check("Saved scorecard captured the reassigned Stroke Index", Number(savedCourse.teeSets[0].holes[0].stroke) === 5);

  // ---- 2. It shows up in Round Entry's course autocomplete suggestions ----
  roundCourse.value = "Boss Consulting";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const suggestionNames = [...doc.querySelectorAll(".course-suggestion-item")].map(el => el.dataset.name);
  check("Saved course appears in autocomplete suggestions", suggestionNames.includes("Boss Consulting Links"));

  // ---- 3. Selecting it (mousedown on the suggestion) silently auto-fills its saved scorecard ----
  const suggestionItem = [...doc.querySelectorAll(".course-suggestion-item")].find(el => el.dataset.name === "Boss Consulting Links");
  suggestionItem.dispatchEvent(new window.Event("mousedown", {bubbles:true}));
  await wait(30);

  check("Course field set from suggestion", doc.getElementById("roundCourse").value === "Boss Consulting Links");
  liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  let liveHole1Stroke = liveRows[0].querySelector('select[data-field="stroke"]');
  check("Round Entry auto-filled hole 1 Stroke Index from the saved scorecard", liveHole1Stroke.value === "5");

  // ---- 4. Enter a real score, mess up hole 1's stroke, then use "Load Saved Scorecard" explicitly ----
  const scoreInput = liveRows[0].querySelector('input[data-field="score"]');
  scoreInput.value = "6"; // deliberately different from this hole's par so it's a genuine entry
  scoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  liveHole1Stroke.value = "1";
  liveHole1Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.confirm = () => true; // accept the "this will overwrite Par/Stroke" prompt since a real score is entered
  doc.getElementById("loadScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const liveHole1StrokeAfter = liveRows[0].querySelector('select[data-field="stroke"]');
  check("Load Saved Scorecard restores hole 1 Stroke Index to 5", liveHole1StrokeAfter.value === "5");
  check("Load Saved Scorecard kept the entered score", liveRows[0].querySelector('input[data-field="score"]').value === "6");

  // ---- 5. "Remember This Scorecard" under a NEW name adds a separate Course Library entry ----
  roundCourse.value = "Fresh New Course";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  doc.getElementById("saveScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);
  check('"Remember This Scorecard" under a new name adds a new entry', !!window.findCourse("Fresh New Course"));

  // ---- 6. Multi-tee-set course (injected directly, since bulk import is now a code-level, not
  //         in-app, workflow): Gender steers which tee-set auto-loads, and an exact Tee Marker
  //         match still wins over the gender-only fallback ----
  const twoTeeCourse = {
    name: "Two Tee Golf Club", union: "Test Union", city: "Test City",
    teeSets: [
      { teeName: "Championship", teeColour: "", gender: "Men", courseRating: 72.1, slopeRating: 132,
        holes: Array.from({length:18}, (_,i) => ({ hole: i+1, par: 5, stroke: 18 - i, distance: 400 })) },
      { teeName: "Ladies", teeColour: "", gender: "Women", courseRating: 74.5, slopeRating: 128,
        holes: Array.from({length:18}, (_,i) => ({ hole: i+1, par: 3, stroke: i < 17 ? i + 2 : 1, distance: 350 })) }
    ]
  };
  window.importCourses([twoTeeCourse]);
  const found = window.findCourse("Two Tee Golf Club");
  check("Two-tee-set course is retrievable via findCourse", !!found && found.teeSets.length === 2);

  // Clear the score left over from earlier steps first (auto-fill never clobbers a real score) —
  // this models starting a fresh round.
  const clearScoreInput = [...doc.querySelectorAll("#holeTable tbody tr")][0].querySelector('input[data-field="score"]');
  clearScoreInput.value = "";
  clearScoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  clearScoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  const genderSelect = doc.getElementById("playerGender");
  genderSelect.value = "Women";
  genderSelect.dispatchEvent(new window.Event("change", {bubbles:true}));

  roundCourse.value = "Two Tee Golf Club";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(30);

  const teeMarkerSelect = doc.getElementById("teeMarker");
  const teeMarkerOptionValues = [...teeMarkerSelect.options].map(o => o.value);
  check("Tee Marker options repopulated from the course's own tee-sets",
    teeMarkerOptionValues.includes("Championship") && teeMarkerOptionValues.includes("Ladies"));
  check("Gender=Women auto-selected the Ladies tee-set", teeMarkerSelect.value === "Ladies");

  liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  let liveHole1Par = liveRows[0].querySelector('select[data-field="par"]');
  let liveHole1StrokeCheck = liveRows[0].querySelector('select[data-field="stroke"]');
  check("Ladies tee-set auto-filled Par 3 for hole 1", liveHole1Par.value === "3");
  check("Ladies tee-set auto-filled Stroke Index 2 for hole 1", liveHole1StrokeCheck.value === "2");

  // Switching Tee Marker to Championship should load the Men's data even with Gender=Women,
  // since an exact tee-name match takes priority over the gender-only fallback.
  teeMarkerSelect.value = "Championship";
  teeMarkerSelect.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(30);
  liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  liveHole1Par = liveRows[0].querySelector('select[data-field="par"]');
  liveHole1StrokeCheck = liveRows[0].querySelector('select[data-field="stroke"]');
  check("Switching Tee Marker to Championship loads Par 5 for hole 1", liveHole1Par.value === "5");
  check("Switching Tee Marker to Championship loads Stroke Index 18 for hole 1", liveHole1StrokeCheck.value === "18");

  // ---- 7. "🗑️ Delete Saved Course" — the one bit of in-app cleanup kept after removing the
  //         full admin card ----
  let deleteAlertMsg = null;
  window.alert = (m) => { deleteAlertMsg = m; };
  roundCourse.value = "Not A Real Saved Course";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse.dispatchEvent(new window.Event("change", {bubbles:true}));
  doc.getElementById("deleteSavedCourseBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check("Deleting a name that isn't a saved course shows a clear message, doesn't crash",
    typeof deleteAlertMsg === "string" && /isn't a saved/i.test(deleteAlertMsg));
  window.alert = () => {};

  roundCourse.value = "Fresh New Course";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.confirm = () => true;
  doc.getElementById("deleteSavedCourseBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  check('Deleting "Fresh New Course" removes it from the Course Library', !window.findCourse("Fresh New Course"));
  roundCourse.value = "Fresh New";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const suggestionsAfterDelete = [...doc.querySelectorAll(".course-suggestion-item")].map(el => el.dataset.name);
  check("Deleted course no longer appears in autocomplete suggestions", !suggestionsAfterDelete.includes("Fresh New Course"));
  roundCourse.value = "";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);

  // Deleting from the library must never touch a round already saved to History.
  check("Other Course Library entries survive an unrelated delete", !!window.findCourse("Boss Consulting Links") && !!window.findCourse("Two Tee Golf Club"));

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
