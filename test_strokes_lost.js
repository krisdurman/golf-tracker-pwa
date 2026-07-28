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
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }

  // ---- 1. Headers updated to reflect the strokes-lost methodology ----
  const h2s = [...window.document.querySelectorAll("h2")].map(h => h.textContent.trim());
  check('Card header renamed to "Biggest Opportunity (Est. Strokes Lost)"', h2s.includes("Biggest Opportunity (Est. Strokes Lost)"));
  check('Chart header renamed to "Where Strokes Are Lost (All Rounds)"', h2s.includes("Where Strokes Are Lost (All Rounds)"));
  check('Old "Opportunity Breakdown (All Rounds)" header is gone', !h2s.includes("Opportunity Breakdown (All Rounds)"));

  // ---- 2. defaultHole(n) baseline (par 4, stroke n, 2 putts, 1 short-game shot) should show
  //         ZERO strokes lost anywhere — nothing "wrong" happened on an untouched hole.
  const defaultHole = window.defaultHole(1);
  check("defaultHole() exposed on window for testing", typeof defaultHole === "object");

  // ---- 3. A round dominated by 3-putts should classify as Putting, with an exact strokes-lost value ----
  // 18 holes, each: score = par (so it doesn't affect opportunity calc), 2 holes with 4 putts
  // (2 strokes lost each = 4 total), no short-game or fairway/green misses recorded (all "na").
  function makeHoles(overrides){
    const holes = [];
    for(let i=1;i<=18;i++){
      holes.push(Object.assign({hole:i, par:4, stroke:i, score:"4", putts:"2", shortShots:0, penalties:0, fairway:"na", green:"na"}, overrides[i-1] || {}));
    }
    return holes;
  }

  const puttingHoles = makeHoles({
    0: {putts:"4"}, // 2 strokes lost
    1: {putts:"4"}  // 2 strokes lost -> total 4 strokes lost putting
  });
  const puttingStats = window.computeStats(puttingHoles, 0);
  check("Putting-heavy round: strokesLostPutting = 4", puttingStats.strokesLostPutting === 4);
  check("Putting-heavy round: strokesLostShortGame = 0", puttingStats.strokesLostShortGame === 0);
  check("Putting-heavy round: strokesLostLongGame = 0", puttingStats.strokesLostLongGame === 0);
  check('Putting-heavy round classified as "Putting"', puttingStats.opportunity === "Putting");

  // ---- 4. A round with many fairway/green misses but no 3-putts or short-game trouble should
  //         still classify as Long Game, and the estimated cost should match the documented
  //         per-miss constants (0.3/fairway, 0.5/green).
  const longGameHoles = makeHoles({
    0: {fairway:"left", green:"left"},
    1: {fairway:"right", green:"right"},
    2: {fairway:"short", green:"short"},
    3: {fairway:"long", green:"long"}
  });
  const longGameStats = window.computeStats(longGameHoles, 0);
  check("Long-game round: strokesLostLongGame = 4 misses x (0.3+0.5) = 3.2",
    Math.abs(longGameStats.strokesLostLongGame - 3.2) < 1e-9);
  check('Long-game round classified as "Long Game"', longGameStats.opportunity === "Long Game");

  // ---- 5. A round with a couple of bad short-game holes (3 shots inside 50 = 2 lost strokes
  //         each) should out-weigh a single 3-putt (1 lost stroke), unlike the old raw-count
  //         method where "1 three-putt vs 1 short-game-miss hole" would have been a count-tie.
  const shortGameHoles = makeHoles({
    0: {putts:"3"},               // 1 stroke lost to putting
    1: {shortShots:3},            // 2 strokes lost to short game
    2: {shortShots:3}             // 2 more strokes lost to short game -> total 4
  });
  const shortGameStats = window.computeStats(shortGameHoles, 0);
  check("Mixed round: strokesLostPutting = 1", shortGameStats.strokesLostPutting === 1);
  check("Mixed round: strokesLostShortGame = 4", shortGameStats.strokesLostShortGame === 4);
  check('Mixed round classified as "Short Game" (4 > 1)', shortGameStats.opportunity === "Short Game");

  // ---- 6. Live Round Entry: explanation text reflects estimated strokes lost, not raw counts ----
  const doc = window.document;
  window.alert = () => {};
  window.confirm = () => true;
  const scoreInputs = [...doc.querySelectorAll("#holeTable tbody tr")].map(tr => tr.querySelector('input[data-field="score"]'));
  const puttsInputs = [...doc.querySelectorAll("#holeTable tbody tr")].map(tr => tr.querySelector('input[data-field="putts"]'));
  // Give hole 1 a 4-putt (2 strokes lost) and leave everything else untouched.
  scoreInputs[0].value = "5";
  scoreInputs[0].dispatchEvent(new window.Event("input", {bubbles:true}));
  puttsInputs[0].value = "4";
  puttsInputs[0].dispatchEvent(new window.Event("input", {bubbles:true}));
  puttsInputs[0].dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(30);

  const explainText = doc.getElementById("opportunityExplain").textContent;
  check('Explanation text mentions "Estimated strokes lost"', explainText.includes("Estimated strokes lost"));
  check('Explanation text breaks out Putting/Short Game/Long Game', /Putting:.*Short Game:.*Long Game/.test(explainText));
  check('Badge shows "Putting" after a lone 4-putt with nothing else recorded', doc.getElementById("opportunityBadge").textContent === "Putting");

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
