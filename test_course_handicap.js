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
