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

function isAlphabetical(names){
  for(let i=1;i<names.length;i++){
    if(names[i-1].localeCompare(names[i], undefined, {sensitivity:"base"}) > 0) return false;
  }
  return true;
}

(async () => {
  await wait(300);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }
  window.alert = () => {};
  window.confirm = () => true;

  // ---- 1. getAllCourseSuggestions() (feeds Round Entry's course autocomplete) is alphabetical ----
  const allSuggestions = window.getAllCourseSuggestions().map(c => c.name);
  check("getAllCourseSuggestions() returns 400+ entries (national seed loaded)", allSuggestions.length > 400);
  check("getAllCourseSuggestions() is sorted alphabetically (case-insensitive)", isAlphabetical(allSuggestions));

  // ---- 2. Round Entry's live typeahead suggestion list is itself alphabetical for a broad query ----
  const roundCourse = doc.getElementById("roundCourse");
  roundCourse.value = "golf club"; // broad substring guaranteed to match many national entries
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(30);
  const suggestionNames = [...doc.querySelectorAll(".course-suggestion-item .course-suggestion-name")].map(el => el.textContent);
  check("Typing narrows the live suggestion list down (<=8 shown)", suggestionNames.length > 0 && suggestionNames.length <= 8);
  check("Live suggestion list itself is alphabetically ordered", isAlphabetical(suggestionNames));
  roundCourse.value = "";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);

  // ---- 3. Saved Courses admin dropdown is alphabetical, "+ New Course" always first ----
  window.populateLibCourseSelect();
  const libSelect = doc.getElementById("libCourseSelect");
  const libOptionLabels = [...libSelect.options].map(o => o.textContent);
  check('"+ New Course" is always the first option', libOptionLabels[0] === "+ New Course");
  check("Saved Courses dropdown has 400+ real entries", libOptionLabels.length > 400);
  // Strip the " — N tee-set(s)" / " — no scorecard yet" suffix before checking sort order.
  const libNames = libOptionLabels.slice(1).map(t => t.replace(/\s+—\s+.*$/, ""));
  check("Saved Courses dropdown is sorted alphabetically", isAlphabetical(libNames));

  // ---- 4. Typing in the new filter box narrows the dropdown to matching names only ----
  const filterInput = doc.getElementById("libCourseFilter");
  check("#libCourseFilter input exists", !!filterInput);
  filterInput.value = "royal johannesburg";
  filterInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const filteredLabels = [...libSelect.options].map(o => o.textContent);
  check('Filtering to "royal johannesburg" keeps "+ New Course"', filteredLabels[0] === "+ New Course");
  check("Filtering narrows the list down to a small number of matches", filteredLabels.length > 1 && filteredLabels.length < 20);
  check("Every remaining real option actually matches the filter text",
    filteredLabels.slice(1).every(t => t.toLowerCase().includes("royal johannesburg")));

  // ---- 5. Selecting a course from the narrowed-down list still loads the RIGHT course (option
  //         value stays the true courseLibrary index even though display order/subset changed) ----
  const matchOpt = [...libSelect.options].find(o => o.textContent.toLowerCase().includes("royal johannesburg"));
  libSelect.value = matchOpt.value;
  libSelect.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);
  const loadedName = doc.getElementById("libCourseName").value;
  check("Selecting from the filtered dropdown loads the matching course into the form",
    loadedName.toLowerCase().includes("royal johannesburg"));

  // ---- 6. Clearing the filter restores the full sorted list ----
  filterInput.value = "";
  filterInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  const restoredLabels = [...libSelect.options].map(o => o.textContent);
  check("Clearing the filter restores the full 400+ entry list", restoredLabels.length > 400);

  // ---- 7. populateLibCourseSelect(name) bypasses the filter so a just-saved/imported course is
  //         guaranteed visible and selected, even if unrelated text is still typed in the filter ----
  filterInput.value = "zzz_no_such_course_zzz";
  filterInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);
  check("An unrelated filter query narrows the list down to nothing", [...libSelect.options].length === 1);

  const anyRealName = restoredLabels[1].replace(/\s+—\s+.*$/, "");
  window.populateLibCourseSelect(anyRealName);
  const bypassLabels = [...libSelect.options].map(o => o.textContent);
  check("populateLibCourseSelect(name) ignores a stale filter and shows the full list again", bypassLabels.length > 400);
  check("...and selects the requested course", libSelect.options[libSelect.selectedIndex].textContent.startsWith(anyRealName));

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
