// Cirkel — byg alle investor-dokumenter på én gang.
// Kør:  node build-all.js   (eller: npm run build:investor fra projektroden)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });

const jobs = [
  ["Investor-deck (PPTX)", "deck.js"],
  ["Cap table & SAFE-model (XLSX)", "captable.js"],
  ["SAFE / konvertibelt gældsbrev (DOCX)", "safe.js"],
  ["Pilot one-pager (DOCX)", "pilot.js"],
];

console.log("Bygger investor-materialer →", out, "\n");
for (const [label, file] of jobs) {
  process.stdout.write("• " + label + " … ");
  try {
    execFileSync("node", [path.join(__dirname, file)], { stdio: ["ignore", "ignore", "inherit"] });
    console.log("ok");
  } catch (e) {
    console.log("FEJLEDE");
    process.exitCode = 1;
  }
}
console.log("\nFærdige filer ligger i:", out);
for (const f of fs.readdirSync(out)) console.log("  -", f);
