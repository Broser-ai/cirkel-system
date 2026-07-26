import { CirkelEngine } from "./engine.js";

async function main() {
  const engine = new CirkelEngine();
  await engine.initialize();

  const h = await engine.health();
  console.log(`\n✅ Moduler klar: ${h.count} (22 moduler + 2 sovereign + 1 kerne = 25)`);

  // Ægte scan-forløb gennem modulerne:
  const input = { userId: "morten", barcode: "5711953068515", material: "Arla Skyr PP5 bæger", weight_grams: 18, municipality: "Aarhus Kommune" };
  const plan = ["data", "perception", "knowledge", "reasoning_engine", "execution", "action", "communication"];
  const { output, trace } = await engine.run(plan, input);

  console.log("\n🔁 Pipeline-trace:");
  for (const t of trace) console.log(`  ${t.ok ? "✓" : "✗"} ${t.step}`, t.data ? JSON.stringify(t.data) : "");
  console.log("\n💬 Brugerbesked:\n  " + output.message);

  // Sovereign ESG demo: ledger write + event publish
  console.log("\n--- Sovereign ESG demo ---");
  const sovereignPlan = ["sovereign-ledger", "event-bus"];
  const sovereignInput = {
    action: "write",
    domain: "compliance",
    key: "demo-scan",
    data: { material: "PP5", weight_grams: 18, municipality: "Aarhus Kommune" },
    actorId: "demo-user",
    // event-bus fields (used when pipeline reaches event-bus)
    type: "MATERIAL_SCANNED",
    source: "demo",
    payload: { barcode: "5711953068515", material: "PP5" },
  };
  const sovereign = await engine.run(sovereignPlan, sovereignInput);
  console.log("🔁 Sovereign trace:");
  for (const t of sovereign.trace) console.log(`  ${t.ok ? "✓" : "✗"} ${t.step}`, t.data ? JSON.stringify(t.data).slice(0, 120) : t.note ?? "");
}
main();
