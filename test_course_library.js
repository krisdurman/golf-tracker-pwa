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

// Builds an 18-hole CSV block for one club with two distinct tee-sets (Men/Championship,
// Women/Ladies) so the multi-tee-set import + dynamic gender/tee auto-fill path can be exercised.
function buildTwoTeeCsv(clubName){
  const header = "club_name,course_layout,union,city,tee_name,tee_colour,player_category,hole,par,stroke_index,distance_metres,course_rating,slope_rating,scorecard_status,source_url,source_checked_date,notes";
  const rows = [header];
  for(let h = 1; h <= 18; h++){
    // Men/Championship: all par 5, stroke index counts DOWN (18..1) — deliberately different
    // from the app's default hole (par 4, stroke = hole number) so a passing assertion proves
    // the real tee-set data was applied, not just that the untouched default happened to match.
    rows.push(`${clubName},,Test Union,Test City,Championship,,Men,${h},5,${19 - h},400,72.1,132,Extracted,,,`);
    // Women/Ladies: all par 3, stroke index rotated by 1 (2,3,...,18,1) — also non-default.
    const ladiesStroke = h < 18 ? h + 1 : 1;
    rows.push(`${clubName},,Test Union,Test City,Ladies,,Women,${h},3,${ladiesStroke},350,74.5,128,Extracted,,,`);
  }
  return rows.join("\n");
}

(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};
  window.confirm = () => true;

  // ---- 1. Admin adds a brand-new single-tee-set course via the Course Library card ----
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
  check("New course appears in Saved Courses dropdown with a tee-set count",
    libSelectOptions.some(t => t.includes("Boss Consulting Links") && t.includes("1 tee-set")));

  // ---- 2. It shows up in Round Entry's course autocomplete suggestions ----
  const roundCourse = doc.getElementById("roundCourse");
  roundCourse.value = "Boss Consulting";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const suggestionNames = [...doc.querySelectorAll(".course-suggestion-item")].map(el => el.dataset.name);
  check("Custom course appears in autocomplete suggestions", suggestionNames.includes("Boss Consulting Links"));

  // ---- 3. Selecting it (mousedown on the suggestion) refreshes Tee Marker and silently auto-fills ----
  const suggestionItem = [...doc.querySelectorAll(".course-suggestion-item")].find(el => el.dataset.name === "Boss Consulting Links");
  suggestionItem.dispatchEvent(new window.Event("mousedown", {bubbles:true}));
  await wait(30);

  check("Course field set from suggestion", doc.getElementById("roundCourse").value === "Boss Consulting Links");
  let liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  let liveHole1Stroke = liveRows[0].querySelector('select[data-field="stroke"]');
  let liveHole5Stroke = liveRows[4].querySelector('select[data-field="stroke"]');
  check("Round Entry auto-filled hole 1 Stroke Index from saved scorecard", liveHole1Stroke.value === "5");
  check("Round Entry auto-filled hole 5 Stroke Index from saved scorecard", liveHole5Stroke.value === "1");

  // ---- 4. Enter a score, mess up hole 1's stroke, then use "Load Saved Scorecard" explicitly ----
  const scoreInput = liveRows[0].querySelector('input[data-field="score"]');
  scoreInput.value = "4";
  scoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  scoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  liveHole1Stroke.value = "1";
  liveHole1Stroke.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  window.confirm = () => true; // accept the "this will overwrite Par/Stroke" prompt since a score is entered
  doc.getElementById("loadScorecardBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(30);

  liveRows = [...doc.querySelectorAll("#holeTable tbody tr")];
  const liveHole1StrokeAfter = liveRows[0].querySelector('select[data-field="stroke"]');
  check("Load Saved Scorecard restores hole 1 Stroke Index to 5", liveHole1StrokeAfter.value === "5");
  check("Load Saved Scorecard kept the entered score", liveRows[0].querySelector('input[data-field="score"]').value === "4");

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

  // ---- 6. CSV import: a club with two real tee-sets (Men/Championship, Women/Ladies) ----
  const csvText = buildTwoTeeCsv("Two Tee Golf Club");
  const parsed = window.parseCsvRows(csvText);
  check("parseCsvRows read 37 rows (1 header + 36 data rows)", parsed.length === 37);
  const { courses: importedCourses, extractedRowCount } = window.csvRowsToCourses(parsed);
  check("csvRowsToCourses extracted 36 hole-rows", extractedRowCount === 36);
  check("csvRowsToCourses grouped into exactly 1 course", importedCourses.length === 1);
  check("Imported course has 2 tee-sets", importedCourses[0] && importedCourses[0].teeSets.length === 2);

  const importResult = window.importCourses(importedCourses);
  check("importCourses reports 1 newly added course", importResult.added === 1 && importResult.updated === 0);
  await wait(20);
  doc.getElementById("csvImportFile") && null; // (file-input change flow is covered by importCourses directly above)

  const found = window.findCourse("Two Tee Golf Club");
  check("Imported course is retrievable via findCourse", !!found && found.teeSets.length === 2);

  // Re-populate the admin dropdown/autocomplete now that the import added data straight to the
  // library (bypassing the file-input UI, which jsdom can't simulate realistically).
  window.populateLibCourseSelect();
  const libSelectAfterImport = [...doc.getElementById("libCourseSelect").options].map(o=>o.textContent);
  check("Imported multi-tee course shows in dropdown with a 2 tee-sets label",
    libSelectAfterImport.some(t => t.includes("Two Tee Golf Club") && t.includes("2 tee-sets")));

  // ---- 7. Multi-tee-set courses are read-only in the manual admin editor ----
  const libSelect = doc.getElementById("libCourseSelect");
  const twoTeeOpt = [...libSelect.options].find(o => o.textContent.includes("Two Tee Golf Club"));
  libSelect.value = twoTeeOpt.value;
  libSelect.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  check("Save Course button disabled for a multi-tee-set course", doc.getElementById("saveCourseBtn").disabled === true);
  check("Multi-tee-set warning note is visible", doc.getElementById("libMultiTeeNote").style.display !== "none");

  let blockAlertMsg = null;
  window.alert = (m) => { blockAlertMsg = m; };
  doc.getElementById("saveCourseBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(20);
  check("Clicking a disabled-but-still-wired Save Course does not corrupt the multi-tee-set data",
    window.findCourse("Two Tee Golf Club").teeSets.length === 2);
  window.alert = () => {};

  // ---- 8. Selecting the multi-tee course in Round Entry offers both tee names, and Gender
  //         steers which one loads by default ----
  // Auto-fill deliberately never clobbers live data once any score is entered (see step 4), so
  // clear the score left over from earlier steps first — this models starting a fresh round.
  const clearScoreInput = [...doc.querySelectorAll("#holeTable tbody tr")][0].querySelector('input[data-field="score"]');
  clearScoreInput.value = "";
  clearScoreInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  clearScoreInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  const genderSelect = doc.getElementById("playerGender");
  genderSelect.value = "Women";
  genderSelect.dispatchEvent(new window.Event("change", {bubbles:true}));

  const roundCourse3 = doc.getElementById("roundCourse");
  roundCourse3.value = "Two Tee Golf Club";
  roundCourse3.dispatchEvent(new window.Event("input", {bubbles:true}));
  roundCourse3.dispatchEvent(new window.Event("change", {bubbles:true}));
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

  // ---- 9. Delete a course removes it from the library and from autocomplete ----
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
