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

  // 1. playerName input now lives inside .profile-row, alongside the Profile select and Save button
  const profileRow = doc.querySelector(".profile-row");
  const nameInInRow = profileRow.querySelector("#playerName");
  check("Player Name input is inside .profile-row", !!nameInInRow);

  const rowChildren = [...profileRow.children];
  const selectWrap = rowChildren.find(el => el.querySelector && el.querySelector("#profileSelect"));
  const nameWrap = rowChildren.find(el => el.querySelector && el.querySelector("#playerName"));
  const saveBtn = doc.getElementById("saveProfileBtn");
  const selectIdx = rowChildren.indexOf(selectWrap);
  const nameIdx = rowChildren.indexOf(nameWrap);
  const saveIdx = rowChildren.indexOf(saveBtn);
  check("Order is Profile select, then Player Name, then Save button", selectIdx < nameIdx && nameIdx < saveIdx);

  // 2. only one #playerName in the whole doc
  check("Exactly one #playerName element", doc.querySelectorAll("#playerName").length === 1);

  // 3. functional: typing a name + clicking Save Profile still creates a profile (drives the real save flow)
  window.alert = () => {};
  const nameInput = doc.getElementById("playerName");
  nameInput.value = "Test Golfer";
  nameInput.dispatchEvent(new window.Event("input", {bubbles:true}));
  nameInput.dispatchEvent(new window.Event("change", {bubbles:true}));
  await wait(20);

  doc.getElementById("saveProfileBtn").dispatchEvent(new window.Event("click", {bubbles:true}));
  await wait(50);

  const profileSelect = doc.getElementById("profileSelect");
  const optLabels = [...profileSelect.options].map(o=>o.textContent);
  check("New profile 'Test Golfer' appears in Profile dropdown after Save", optLabels.includes("Test Golfer"));

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
