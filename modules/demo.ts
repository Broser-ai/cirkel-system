import { CirkelEngine } from "./engine.js";

async function main() {
  const engine = new CirkelEngine();
  await engine.initialize();

  const h = await engine.health();
  console.log(`\n✅ Moduler klar: ${h.count} (22 moduler + 1 kerne = 23)`);

  // Ægte scan-forløb gennem modulerne:
  const input = { userId: "morten", barcode: "5711953068515", material: "Arla Skyr PP5 bæger", weight_grams: 18, municipality: "Aarhus Kommune" };
  const plan = ["data", "perception", "knowledge", "reasoning_engine", "execution", "action", "communication"];
  const { output, trace } = await engine.run(plan, input);

  console.log("\n🔁 Pipeline-trace:");
  for (const t of trace) console.log(`  ${t.ok ? "✓" : "✗"} ${t.step}`, t.data ? JSON.stringify(t.data) : "");
  console.log("\n💬 Brugerbesked:\n  " + output.message);
}
main();
