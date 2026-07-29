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

// Round Entry's course field is the only course selector left in the app (the separate Course
// Library admin card — manual creation form, CSV import, Saved Courses dropdown — was removed;
// bulk course-data updates now happen by regenerating the embedded seed in code). This test
// covers what's left: alphabetical ordering, and typing narrowing the suggestion list down.
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

  // ---- 2. Round Entry's live typeahead suggestion list narrows down and is itself alphabetical ----
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

  // ---- 3. Narrowing to a specific, real query returns only genuinely matching names ----
  roundCourse.value = "royal johannesburg";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(30);
  const royalMatches = [...doc.querySelectorAll(".course-suggestion-item .course-suggestion-name")].map(el => el.textContent);
  check("Typing a specific query returns at least one match", royalMatches.length > 0);
  check("Every match actually contains the typed text", royalMatches.every(t => t.toLowerCase().includes("royal johannesburg")));
  roundCourse.value = "";
  roundCourse.dispatchEvent(new window.Event("input", {bubbles:true}));
  await wait(20);

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
