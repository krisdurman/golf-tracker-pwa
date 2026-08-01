const fs = require("fs");
const { JSDOM } = require("jsdom");

// Broad, whole-seed sanity sweep for the Course Handicap pipeline — prompted by a live bug
// report (ERPM GOLF CLUB) where the displayed Tee Marker and the tee-set actually used for the
// HC calculation had silently diverged. Rather than hand-picking a couple more courses, this
// walks EVERY tee-set of EVERY course in the national seed (500+ clubs, 2500+ tee-sets) and
// checks two separate things that must both hold everywhere for the HC shown to ever be trusted:
//   1. calculateCourseHandicap's pure math matches the WHS formula exactly for every real,
//      rated tee-set on file (no NaN/Infinity/off-by-one drift anywhere in the seed).
//   2. pickBestTeeSet always resolves the EXACT tee-set a caller asked for (by its own name +
//      gender) whenever that exact combination exists in the course — i.e. it never silently
//      substitutes a different tee-set's rating when the one that was actually requested is
//      right there. This is the invariant the ERPM bug violated (Red was requested/selected but
//      the note/HC briefly reflected Blue).

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
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }

  const snapshot = window.getCourseLibrarySnapshot();
  check("Sanity: national seed is actually loaded before sweeping it", snapshot.length > 400);

  const testHIs = [0, 5.4, 12.0, 18.7, 24.3, 36.0];
  let ratedTeeSetCount = 0;
  let exactMatchChecked = 0;
  let mathMismatches = [];
  let exactMatchFailures = [];
  let badNumberFailures = [];

  for(const course of snapshot){
    const real = window.findCourse(course.name);
    if(!real || !real.teeSets) continue;

    for(const teeSet of real.teeSets){
      if(!teeSet.courseRating || !teeSet.slopeRating || !teeSet.holes || teeSet.holes.length === 0) continue;
      ratedTeeSetCount++;
      const par = teeSet.holes.reduce((sum, h) => sum + (Number(h.par) || 0), 0);

      // ---- 1. Pure math check against the WHS formula, for a spread of realistic HIs ----
      for(const hi of testHIs){
        const got = window.calculateCourseHandicap(hi, teeSet, par);
        if(got === null || !Number.isFinite(got)){
          badNumberFailures.push(`${course.name} / ${teeSet.teeName} (${teeSet.gender}) HI=${hi} -> ${got}`);
          continue;
        }
        const expected = Math.round(hi * (teeSet.slopeRating / 113) + (teeSet.courseRating - par));
        if(got !== expected){
          mathMismatches.push(`${course.name} / ${teeSet.teeName} (${teeSet.gender}) HI=${hi}: got ${got}, expected ${expected}`);
        }
      }

      // ---- 2. pickBestTeeSet must resolve to THIS exact tee-set when asked for it by its own
      // name + gender, regardless of what else the course has on file (the ERPM invariant) ----
      exactMatchChecked++;
      const resolved = window.pickBestTeeSet(real, teeSet.teeName, teeSet.gender);
      const isSameTeeSet = resolved === teeSet ||
        (resolved && resolved.teeName === teeSet.teeName && resolved.gender === teeSet.gender &&
         resolved.courseRating === teeSet.courseRating && resolved.slopeRating === teeSet.slopeRating);
      if(!isSameTeeSet){
        exactMatchFailures.push(`${course.name} / requested "${teeSet.teeName}" (${teeSet.gender}) but resolved to ` +
          `"${resolved && resolved.teeName}" (${resolved && resolved.gender})`);
      }
    }
  }

  check(`Swept a substantial number of real, rated tee-sets (found ${ratedTeeSetCount})`, ratedTeeSetCount > 1000);

  check("No NaN/Infinity/null Course Handicaps anywhere in the national seed",
    badNumberFailures.length === 0);
  if(badNumberFailures.length){
    console.log("Bad-number failures (showing up to 10):");
    badNumberFailures.slice(0, 10).forEach(m => console.log("  " + m));
  }

  check("calculateCourseHandicap's math matches the WHS formula exactly across the whole seed",
    mathMismatches.length === 0);
  if(mathMismatches.length){
    console.log("Math mismatches (showing up to 10):");
    mathMismatches.slice(0, 10).forEach(m => console.log("  " + m));
  }

  check(`pickBestTeeSet never substitutes a different tee-set when the exact one requested exists ` +
    `(checked ${exactMatchChecked} tee-sets)`, exactMatchFailures.length === 0);
  if(exactMatchFailures.length){
    console.log("Exact-match failures (showing up to 10):");
    exactMatchFailures.slice(0, 10).forEach(m => console.log("  " + m));
  }

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
