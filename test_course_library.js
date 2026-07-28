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

  // ---- 1. Admin adds a brand-new course (not in TOP100) via the Course Library card ----
  const libName = doc.getElementById("libCourseName");
  libName.value = "Boss Consulting Links";
  libName.dispatchEvent(new window.Event("input", {bubbles:true}));

  // Defaults are stroke === hole number, so every value 1-18 is already "taken". Setting hole 1's
  // Stroke Index to 5 must swap with whichever hole currently holds 5 (hole 5) rather than being
  // rejected — one click gets both holes to the real scorecard's values.
  let libRows = [...doc.querySelectorAll("#libScorecardBody tr")];
  const hole1Stroke = libRows[0].querySelector('select[data-field="stroke"]');
  let libAlertMsg = null;
  window.alert = (m) => { libAlertMsg = m; };
  hole1Stroke.value = "5";
  hole1Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  check("No blocking alert when reassigning Stroke Index in Course Library editor", libAlertMsg === null);

  libRows = [...doc.querySelectorAll("#libScorecardBody tr")];
  const hole1StrokeAfter = libRows[0].querySelector('select[data-field="stroke"]');
  const hole5StrokeAfter = libRows[4].querySelector('select[data-field="stroke"]');
  check("Hole 1 now holds Stroke Index 5", hole1StrokeAfter.value === "5");
  check("Hole 5 swapped to Stroke Index 1 in exchange", hole5StrokeAfter.value === "1");
  window.alert = () => {};

  doc.getElementById("saveCourseBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  const libSelectOptions = [...doc.getElementById("libCourseSelect").options].map(o=>o.textContent);
  check("New course appears in Saved Courses dropdown", libSelectOptions.some(t => t.includes("Boss Consulting Links") && t.includes("18 holes")));

  // ---- 2. It shows up in Round Entry's course autocomplete suggestions ----
  const roundCourse = doc.getElementById("roundCourse");
  roundCourse.value = "Boss Consulting";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const suggestionNames = [...doc.querySelectorAll(".course-suggestion-item")].map(el => el.dataset.name);
  check("Custom course appears in autocomplete suggestions", suggestionNames.includes("Boss Consulting Links"));

  // ---- 3. Selecting it (mousedown on the suggestion) silently auto-fills Par/Stroke since no scores yet ----
  const suggestionItem = [...doc.querySelectorAll(".course-suggestion-item")].find(el => el.dataset.name === "Boss Consulting Links");
  suggestionItem.dispatchEvent(new window.Event("mousedown", {bubbles:true}));
  await wait(30);

  check("Course field set from suggestion", doc.getElementById("roundCourse").value === "Boss Consulting Links");
  const liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const liveHole1Stroke = liveRows[0].querySelector('select[data-field="stroke"]');
  const liveHole5Stroke = liveRows[4].querySelector('select[data-field="stroke"]');
  check("Round Entry auto-filled hole 1 Stroke Index from saved scorecard", liveHole1Stroke.value === "5");
  check("Round Entry auto-filled hole 5 Stroke Index from saved scorecard", liveHole5Stroke.value === "1");

  // ---- 4. Enter a score, change Course to something else, then use "Load Saved Scorecard" explicitly ----
  const scoreInput = liveRows[0].querySelector('input[data-field="score"]');
  scoreInput.value = "4";
  scoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  // Manually mess up hole 1's stroke value, then reload via the button to confirm it restores it.
  liveHole1Stroke.value = "1";
  liveHole1Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.confirm = () => true; // accept the "this will overwrite Par/Stroke" prompt since a score is entered
  doc.getElementById("loadScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  const liveRowsAfter = [...doc.querySelectorAll("#holeTable tbody tr")];
  const liveHole1StrokeAfter = liveRowsAfter[0].querySelector('select[data-field="stroke"]');
  check("Load Saved Scorecard restores hole 1 Stroke Index to 5", liveHole1StrokeAfter.value === "5");
  check("Load Saved Scorecard kept the entered score", liveRowsAfter[0].querySelector('input[data-field="score"]').value === "4");

  // ---- 5. "Remember This Scorecard" saves the current live Par/Stroke under a NEW course name ----
  const roundCourse2 = doc.getElementById("roundCourse");
  roundCourse2.value = "Fresh New Course";
  roundCourse2.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse2.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  doc.getElementById("saveScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  const libSelectOptionsAfter = [...doc.getElementById("libCourseSelect").options].map(o=>o.textContent);
  check('"Remember This Scorecard" adds a new Course Library entry', libSelectOptionsAfter.some(t => t.includes("Fresh New Course")));

  // ---- 6. Delete a course removes it from the library and from autocomplete ----
  const select = doc.getElementById("libCourseSelect");
  const optToDelete = [...select.options].find(o => o.textContent.includes("Fresh New Course"));
  select.value = optToDelete.value;
  select.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  doc.getElementById("deleteCourseBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  const libSelectFinal = [...doc.getElementById("libCourseSelect").options].map(o=>o.textContent);
  check('Deleted course removed from Saved Courses dropdown', !libSelectFinal.some(t => t.includes("Fresh New Course")));

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
