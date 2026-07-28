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
  await wait(500);
  const doc = window.document;
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }

  window.populateLibCourseSelect();
  const options = [...doc.getElementById("libCourseSelect").options].map(o=>o.textContent);
  check("National seed populated on first load", options.length > 400);

  // Breadth check: clubs outside Gauteng should now be present (previously this app only ever
  // shipped Gauteng data).
  check("Adelaide Golf Club (Border region) present", options.some(t => t.toLowerCase().includes("adelaide golf club")));
  check("A Western/Southern Cape-style club is present", options.some(t => /stellenbosch|george golf club|mossel bay/i.test(t)));

  // Royal Johannesburg should now carry FULL official data across multiple layouts, each with
  // several tee-sets (vs. the old 1-layout/1-tee-set placeholder-derived seed).
  const royalOptions = options.filter(t => t.toLowerCase().includes("royal johannesburg"));
  check("Royal Johannesburg has multiple layout entries", royalOptions.length >= 2);

  const eastCourse = window.findCourse("Royal Johannesburg & Kensington Golf Club — Royal Jhb East Course") ||
                      [...royalOptions].map(t => window.findCourse(t.split(" — ").length > 1 ? t.replace(/\s*—\s*\d+.*$/, "").trim() : t)).find(Boolean);
  // Fall back: just grab any Royal Johannesburg course directly via a scan, since exact naming
  // punctuation/casing from the live site may differ slightly from any prior assumption.
  const anyRoyal = royalOptions.length ? window.findCourse(royalOptions[0].split(" — 2")[0].split(" — no")[0].replace(/ — .*/, (m)=>{
    // reconstruct exact name (before the " — N tee-sets" suffix populateLibCourseSelect appends)
    return "";
  })) : null;

  // populateLibCourseSelect labels are "<name> — N tee-set(s)" or "<name> — no scorecard yet";
  // strip that suffix to get the real course name, then look it up directly.
  function realNameFromOption(optionText){
    return optionText.replace(/\s+—\s+(\d+\s+tee-sets?|no scorecard yet)$/i, "");
  }
  const royalRealNames = royalOptions.map(realNameFromOption);
  let royalHasMultiTee = false;
  let royalHasBothGenders = false;
  for(const n of royalRealNames){
    const c = window.findCourse(n);
    if(c && c.teeSets && c.teeSets.length >= 3) royalHasMultiTee = true;
    if(c && c.teeSets && c.teeSets.some(t=>t.gender==="Men") && c.teeSets.some(t=>t.gender==="Women")) royalHasBothGenders = true;
  }
  check("At least one Royal Johannesburg layout has 3+ tee-sets", royalHasMultiTee);
  check("At least one Royal Johannesburg layout has both Men and Women tee-sets", royalHasBothGenders);

  // Pick any real club and validate its hole data shape end-to-end.
  const sampleName = royalRealNames[0];
  const sample = window.findCourse(sampleName);
  check("Sample course has at least one 18-hole tee-set", sample && sample.teeSets.some(t => t.holes.length === 18));
  const sampleTee = sample.teeSets.find(t => t.holes.length === 18);
  check("Sample tee-set holes have numeric par 3-5", sampleTee.holes.every(h => h.par >= 3 && h.par <= 5));
  check("Sample tee-set holes have unique Stroke Index 1-18", new Set(sampleTee.holes.map(h=>h.stroke)).size === 18);

  // Re-running loadCourses() must not duplicate anything (COURSES_SEEDED_KEY guard).
  const before = options.length;
  window.loadCourses();
  window.populateLibCourseSelect();
  const after = [...doc.getElementById("libCourseSelect").options].length;
  check("Re-running loadCourses() does not duplicate the national seed", before === after);

  // Upgrade-placeholder logic: simulate an existing user who only had the OLD thin Gauteng seed
  // (name-only placeholder for a club that the NEW seed has real data for), then confirm a fresh
  // seedCoursesIfMissing call upgrades it instead of leaving the placeholder in place.
  const placeholderName = "___TEST PLACEHOLDER UPGRADE CLUB___";
  const before2 = window.findCourse(placeholderName);
  check("Sanity: test placeholder name not already in library", !before2);
  // Inject directly via the exposed courseLibrary-affecting functions: reuse importCourses (adds/replaces
  // by name) to place a placeholder, then call seedCoursesIfMissing with a matching-name real record.
  window.importCourses([{name: placeholderName, union: "", city: "", teeSets: []}]);
  const placeholderBefore = window.findCourse(placeholderName);
  check("Placeholder course added with zero tee-sets", placeholderBefore && placeholderBefore.teeSets.length === 0);
  window.seedCoursesIfMissing([{name: placeholderName, union: "Test Union", city: "", teeSets: [{teeName:"Main", teeColour:"", gender:"Men", courseRating:70, slopeRating:120, holes: Array.from({length:18},(_,i)=>({hole:i+1,par:4,stroke:i+1,distance:350}))}]}]);
  const placeholderAfter = window.findCourse(placeholderName);
  check("Placeholder upgraded to real data by seedCoursesIfMissing", placeholderAfter && placeholderAfter.teeSets.length === 1);

  // And confirm it does NOT clobber a course that already has real data.
  const alreadyRealBefore = window.findCourse(sampleName);
  const teeCountBefore = alreadyRealBefore.teeSets.length;
  window.seedCoursesIfMissing([{name: sampleName, union: "", city: "", teeSets: [{teeName:"BOGUS", teeColour:"", gender:"Men", courseRating:1, slopeRating:1, holes:[]}]}]);
  const alreadyRealAfter = window.findCourse(sampleName);
  check("seedCoursesIfMissing does not overwrite a course that already has real tee-sets",
    alreadyRealAfter.teeSets.length === teeCountBefore && !alreadyRealAfter.teeSets.some(t=>t.teeName==="BOGUS"));

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
