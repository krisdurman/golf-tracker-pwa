const fs = require("fs");
const { JSDOM } = require("jsdom");

// COACH_TIP and COACH_TIP_DISMISSED_KEY are declared with `const` at the top of the app's
// <script>, so — unlike top-level `function` declarations — they don't attach to `window` and
// can't be read or mutated from outside the page (same reason `holes`/`history` aren't reachable
// either). This file drives the feature the same way a real player would: through the rendered
// DOM, the exposed `renderCoachTip()` function, and localStorage using the known, documented key.
// It also exercises the current image-based card: an <img> whose src/alt change per tip, alongside
// the optional text caption.
const DISMISSED_KEY = "golfTrackerCoachTipDismissedIdV1";
const CURRENT_TIP_ID = "2026-07-welcome";
const CURRENT_TIP_IMAGE = "coach-tip-2026-07-welcome.jpg";

function freshDom(){
  let html = fs.readFileSync("/tmp/index_for_test.html", "utf8");
  html = html.replace(
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js"><\/script>/,
    `<script>window.Chart = function(){ return { destroy(){}, update(){}, data:{datasets:[]} }; };</script>`
  );
  return new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
}
function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

(async () => {
  const results = [];
  function check(name, cond){ results.push({name, pass: !!cond}); }

  // ---- 1. First-ever load: no dismissal recorded, so the current tip shows automatically ----
  const dom1 = freshDom();
  const win1 = dom1.window;
  await wait(300);
  const doc1 = win1.document;
  const card1 = doc1.getElementById("coachTip");
  check("Coach's Tip is visible on a fresh install (nothing dismissed yet)", card1.classList.contains("show"));

  const img1 = doc1.getElementById("coachTipImg");
  check("Tip image element exists", !!img1);
  check("Tip image src points at the current tip's image file", (img1.getAttribute("src") || "").includes(CURRENT_TIP_IMAGE));
  check("Tip image has non-empty alt text (it carries real instructional content as pixels)", (img1.alt || "").length > 20);

  const bodyText = doc1.getElementById("coachTipBody").textContent;
  const titleText = doc1.getElementById("coachTipTitle").textContent;
  check("Tip caption body is populated with real content (not blank)", bodyText.length > 20);
  check("Tip caption title is populated", titleText.length > 0);

  // ---- 2. Dismissing it hides the card and records the dismissal against the CURRENT tip's id ----
  doc1.getElementById("coachTipDismissBtn").dispatchEvent(new win1.Event("click", {bubbles:true}));
  await wait(20);
  check("Dismiss button hides the card", !card1.classList.contains("show"));
  check("Dismissal is recorded under the documented localStorage key",
    win1.localStorage.getItem(DISMISSED_KEY) === CURRENT_TIP_ID);

  // ---- 3. Re-rendering the SAME tip stays dismissed — it doesn't nag every visit ----
  win1.renderCoachTip();
  await wait(20);
  check("Re-rendering the same (already-dismissed) tip stays hidden", !card1.classList.contains("show"));

  // ---- 4. A genuinely different tip id (simulating a NEW tip Kris has just posted, with a new
  //         image file) reappears even though the player dismissed a previous one — this is the
  //         actual mechanism Kris will rely on to post updates ----
  win1.localStorage.setItem(DISMISSED_KEY, "some-older-tip-that-is-not-the-current-one");
  win1.renderCoachTip();
  await wait(20);
  check("A dismissal recorded against a DIFFERENT tip id does not suppress the current tip",
    card1.classList.contains("show"));
  check("The current tip's image is what's shown", (img1.getAttribute("src") || "").includes(CURRENT_TIP_IMAGE));
  check("The current tip's caption text is what's shown", doc1.getElementById("coachTipBody").textContent === bodyText);

  // ---- 5. An independent, fresh device (no localStorage history at all) also sees the tip ----
  const dom2 = freshDom();
  const win2 = dom2.window;
  await wait(300);
  const doc2 = win2.document;
  check("A separate fresh device also sees the current tip", doc2.getElementById("coachTip").classList.contains("show"));
  check("A separate fresh device gets the same image reference",
    (doc2.getElementById("coachTipImg").getAttribute("src") || "").includes(CURRENT_TIP_IMAGE));

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
