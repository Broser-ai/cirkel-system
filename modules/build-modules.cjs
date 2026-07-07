// Bygger 23 ÆGTE Cirkel-moduler i TypeScript (modsat V5's tomme stubs).
// Hvert modul har rigtig logik og kører. Kør: node build-modules.cjs
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "src");
const MROOT = path.join(ROOT, "modules");
fs.mkdirSync(MROOT, { recursive: true });

// ---- base.ts ----
fs.writeFileSync(path.join(ROOT, "base.ts"), `// Fælles kontrakt for alle Cirkel-moduler.
export interface Ctx {
  state: Record<string, any>;
  log: (msg: string) => void;
}
export interface ModuleResult {
  module: string;
  ok: boolean;
  data?: any;
  note?: string;
}
export abstract class BaseModule {
  abstract name: string;
  abstract layer: string;
  state: "init" | "ready" | "error" = "init";
  async initialize(): Promise<void> { this.state = "ready"; }
  async health() { return { module: this.name, layer: this.layer, state: this.state }; }
  abstract process(input: any, ctx: Ctx): Promise<ModuleResult>;
}
`);

// ---- modulerne: navn, lag, og ÆGTE process-krop ----
const MODULES = [
  // LAG 1 — FOUNDATION
  { file: "data", cls: "DataModule", layer: "foundation", body: `
    // Validerer og normaliserer en scan-record.
    const rec = input || {};
    const clean = {
      barcode: String(rec.barcode || "").trim(),
      material: String(rec.material || "").trim(),
      weight_grams: Math.max(0, Number(rec.weight_grams) || 0),
      municipality: rec.municipality || "Aarhus Kommune",
    };
    const valid = clean.material.length > 0 && clean.weight_grams > 0;
    ctx.state.record = clean;
    return { module: this.name, ok: valid, data: clean, note: valid ? "valid" : "mangler material/vægt" };` },

  { file: "memory", cls: "MemoryManager", layer: "foundation", extra: `
  private store = new Map<string, any[]>();`, body: `
    // Episodisk hukommelse: gem og hent seneste hændelser pr. bruger.
    const { userId = "anon", event } = input || {};
    if (!this.store.has(userId)) this.store.set(userId, []);
    const log = this.store.get(userId)!;
    if (event) { log.push({ ...event, at: Date.now() }); if (log.length > 100) log.shift(); }
    const recent = log.slice(-5);
    ctx.state.memory = recent;
    return { module: this.name, ok: true, data: { count: log.length, recent } };` },

  { file: "security", cls: "SecurityModule", layer: "foundation", extra: `
  private hits = new Map<string, { n: number; t: number }>();`, body: `
    // Input-validering, simpel rate-limit og redaktion af hemmeligheder.
    const { userId = "anon", text = "" } = input || {};
    const now = Date.now();
    const h = this.hits.get(userId) || { n: 0, t: now };
    if (now - h.t > 60000) { h.n = 0; h.t = now; }
    h.n++; this.hits.set(userId, h);
    const limited = h.n > 60; // max 60/min
    const redacted = String(text).replace(/(AIza[\\w-]{10,}|sb_secret_[\\w-]+|eyJ[\\w-]{20,})/g, "***REDACTED***");
    return { module: this.name, ok: !limited, data: { redacted }, note: limited ? "rate-limit" : "ok" };` },

  { file: "context", cls: "ContextModule", layer: "foundation", body: `
    // Samler request-kontekst (bruger, kommune, hukommelse).
    const c = {
      userId: input?.userId || "anon",
      municipality: ctx.state.record?.municipality || "Aarhus Kommune",
      history: ctx.state.memory || [],
      ts: new Date().toISOString(),
    };
    ctx.state.context = c;
    return { module: this.name, ok: true, data: c };` },

  // LAG 2 — PROCESSING
  { file: "perception", cls: "PerceptionModule", layer: "processing", body: `
    // "Sanser" et scan: udleder materialetype fra barcode/material/billede-flag.
    const rec = ctx.state.record || input || {};
    const material = (rec.material || "").toLowerCase();
    const type =
      /pet|rpet|flaske/.test(material) ? "PET" :
      /pp5|pp|polypropylen/.test(material) ? "PP5" :
      /hdpe/.test(material) ? "HDPE" :
      /alu|metal|dåse/.test(material) ? "Aluminium" :
      /pap|karton|mælk/.test(material) ? "Karton" :
      /glas/.test(material) ? "Glas" : "Ukendt";
    const observation = { material: rec.material, detectedType: type, hasImage: !!rec.image };
    ctx.state.observation = observation;
    return { module: this.name, ok: type !== "Ukendt", data: observation };` },

  { file: "knowledge", cls: "KnowledgeModule", layer: "processing", extra: `
  private kb: Record<string, { recyclable: number; bin: string; co2PerKg: number; fact: string }> = {
    PET: { recyclable: 100, bin: "Plast", co2PerKg: 1.5, fact: "rPET kan genanvendes igen og igen til nye flasker." },
    PP5: { recyclable: 100, bin: "Plast", co2PerKg: 1.3, fact: "PP5 kan genanvendes 6-7 gange hvis det er rent." },
    HDPE: { recyclable: 95, bin: "Plast", co2PerKg: 1.4, fact: "HDPE bliver til rør, spande og bænke." },
    Aluminium: { recyclable: 100, bin: "Metal", co2PerKg: 9.0, fact: "Genbrug af alu kræver kun 5% af den oprindelige energi." },
    Karton: { recyclable: 85, bin: "Mad- og drikkekartoner", co2PerKg: 0.9, fact: "Fold kartonen fladt for at spare plads." },
    Glas: { recyclable: 100, bin: "Glas", co2PerKg: 0.6, fact: "Returglas genbruges i snit 30 gange." },
  };`, body: `
    // Slår genanvendelses-fakta op for den sansede materialetype.
    const type = ctx.state.observation?.detectedType || "Ukendt";
    const facts = this.kb[type] || { recyclable: 50, bin: "Restaffald", co2PerKg: 0.3, fact: "Tjek din kommunes sorteringsguide." };
    ctx.state.knowledge = { type, ...facts };
    return { module: this.name, ok: !!this.kb[type], data: ctx.state.knowledge };` },

  { file: "reasoning_engine", cls: "ReasoningEngine", layer: "processing", body: `
    // Udleder karakter + sorteringsanbefaling ud fra viden (regelbaseret).
    const k = ctx.state.knowledge || { recyclable: 50, bin: "Restaffald" };
    const grade = k.recyclable >= 100 ? "A+" : k.recyclable >= 90 ? "A" : k.recyclable >= 70 ? "B" : k.recyclable >= 50 ? "C" : "D";
    const reasoning = {
      grade,
      bin: k.bin,
      circularScore: Math.round(k.recyclable * 0.95),
      sorting: \`Sortér som \${k.bin}. Skyl kort og pres fladt for bedst genanvendelse.\`,
    };
    ctx.state.reasoning = reasoning;
    return { module: this.name, ok: true, data: reasoning };` },

  { file: "analytics", cls: "AnalyticsModule", layer: "processing", body: `
    // Aggregerer KPI'er fra en liste af scans (eller den aktuelle).
    const scans = (input?.scans || (ctx.state.execution ? [ctx.state.execution] : [])) as any[];
    const sum = (f: (s: any) => number) => scans.reduce((a, s) => a + (f(s) || 0), 0);
    const kpi = {
      scans: scans.length,
      totalPoints: sum((s) => s.points),
      totalKroner: Number(sum((s) => s.kroner).toFixed(2)),
      totalCo2Kg: Number(sum((s) => s.co2Kg).toFixed(2)),
    };
    ctx.state.kpi = kpi;
    return { module: this.name, ok: true, data: kpi };` },

  // LAG 3 — INTELLIGENCE
  { file: "planning", cls: "PlanningModule", layer: "intelligence", body: `
    // Lægger den ordnede plan for et scan-forløb.
    const plan = ["perception", "knowledge", "reasoning_engine", "execution", "action", "analytics", "communication"];
    ctx.state.plan = plan;
    return { module: this.name, ok: true, data: { steps: plan } };` },

  { file: "execution", cls: "ExecutionModule", layer: "intelligence", body: `
    // Beregner points, kroner og CO2 ud fra materiale + vægt (ægte formel).
    const rec = ctx.state.record || {};
    const k = ctx.state.knowledge || { co2PerKg: 0.3, recyclable: 50 };
    const kg = (rec.weight_grams || 0) / 1000;
    const points = Math.round(kg * 1000 * (k.recyclable / 100) * 2);
    const kroner = Number((points * 0.01).toFixed(2));
    const co2Kg = Number((kg * k.co2PerKg).toFixed(3));
    const result = { points, kroner, co2Kg, material: ctx.state.knowledge?.type };
    ctx.state.execution = result;
    return { module: this.name, ok: points >= 0, data: result };` },

  { file: "action", cls: "ActionModule", layer: "intelligence", body: `
    // Danner den konkrete handling: tildel reward + forbered ledger-blok.
    const ex = ctx.state.execution || { points: 0, kroner: 0 };
    const action = { type: "AWARD_REWARD", points: ex.points, kroner: ex.kroner, ledgerReady: true };
    ctx.state.action = action;
    return { module: this.name, ok: true, data: action };` },

  { file: "creativity", cls: "CreativityModule", layer: "intelligence", body: `
    // Genererer kampagnenavn-varianter ud fra brand + materiale.
    const brand = input?.brand || "Cirkel";
    const mat = ctx.state.knowledge?.type || "Materiale";
    const variants = [
      \`\${brand} \${mat} Loop\`,
      \`\${brand} Grøn Retur — \${mat}\`,
      \`\${mat}-Helten fra \${brand}\`,
    ];
    return { module: this.name, ok: true, data: { variants } };` },

  { file: "ethics", cls: "EthicsModule", layer: "intelligence", body: `
    // Guardrail: blokér uønsket indhold, sikr børnevenlighed.
    const text = String(input?.text || "").toLowerCase();
    const blocked = ["våben", "selvskade", "narko"].some((w) => text.includes(w));
    return { module: this.name, ok: !blocked, data: { allowed: !blocked }, note: blocked ? "blokeret" : "ok" };` },

  // LAG 4 — INTEGRATION
  { file: "communication", cls: "CommunicationModule", layer: "integration", body: `
    // Formaterer en brugervendt dansk besked ud fra resultatet.
    const r = ctx.state.reasoning || {}; const e = ctx.state.execution || {}; const k = ctx.state.knowledge || {};
    const msg = \`♻️ \${k.type || "Materiale"} (karakter \${r.grade || "-"}). Sortér som \${r.bin || "restaffald"}. \` +
      \`Du tjente \${e.points || 0} point (\${e.kroner || 0} kr) og sparede \${e.co2Kg || 0} kg CO₂. \${k.fact || ""}\`;
    ctx.state.message = msg;
    return { module: this.name, ok: true, data: { message: msg } };` },

  { file: "integration", cls: "IntegrationModule", layer: "integration", body: `
    // Hook til eksterne kilder (GS1/DAWA). Ærlig: aktiv kun hvis konfigureret.
    const gs1 = !!process.env.GS1_API_KEY; const dawa = true; // DAWA er åbent API
    return { module: this.name, ok: true, data: { gs1Configured: gs1, dawaAvailable: dawa },
      note: gs1 ? "klar" : "GS1 ikke konfigureret (sæt GS1_API_KEY)" };` },

  { file: "collaboration", cls: "CollaborationModule", layer: "integration", body: `
    // Samler output fra flere moduler til ét svar-objekt.
    const merged = {
      observation: ctx.state.observation, knowledge: ctx.state.knowledge,
      reasoning: ctx.state.reasoning, reward: ctx.state.execution, message: ctx.state.message,
    };
    return { module: this.name, ok: true, data: merged };` },

  { file: "orchestration", cls: "OrchestrationModule", layer: "integration", body: `
    // Vælger AI-provider-rækkefølge (spejler api/_ai.ts).
    const p = (process.env.AI_PROVIDER || "gemini").toLowerCase();
    const order = p === "claude" ? ["claude"] : p === "auto" ? ["gemini", "claude"] : ["gemini"];
    ctx.state.providerOrder = order;
    return { module: this.name, ok: true, data: { order } };` },

  { file: "monitoring", cls: "MonitoringModule", layer: "integration", extra: `
  private metrics: Record<string, number> = {};`, body: `
    // Tæller hændelser og leverer health/metrics.
    const key = input?.metric || "process";
    this.metrics[key] = (this.metrics[key] || 0) + 1;
    return { module: this.name, ok: true, data: { metrics: { ...this.metrics } } };` },

  // LAG 5 — EVOLUTION
  { file: "learning", cls: "LearningModule", layer: "evolution", extra: `
  private stats: Record<string, { n: number; avg: number }> = {};`, body: `
    // Opdaterer løbende gennemsnit (fx konverteringsrate) fra udfald.
    const { metric = "points", value = 0 } = input || {};
    const s = this.stats[metric] || { n: 0, avg: 0 };
    s.avg = (s.avg * s.n + Number(value)) / (s.n + 1); s.n++;
    this.stats[metric] = s;
    return { module: this.name, ok: true, data: { metric, n: s.n, avg: Number(s.avg.toFixed(2)) } };` },

  { file: "adaptation", cls: "AdaptationModule", layer: "evolution", body: `
    // Justerer en parameter ud fra seneste performance (ægte tærskel-logik).
    const rate = Number(input?.recentConversion ?? 0.5);
    const nudgeFrequency = rate < 0.3 ? 5 : rate < 0.6 ? 3 : 2;
    return { module: this.name, ok: true, data: { nudgeFrequency } };` },

  { file: "optimization", cls: "OptimizationModule", layer: "evolution", body: `
    // Vælger billigste/hurtigste vej: cache-nøgle + provider-valg.
    const rec = ctx.state.record || {};
    const cacheKey = \`scan:\${rec.barcode || rec.material || "x"}:\${rec.municipality || ""}\`;
    return { module: this.name, ok: true, data: { cacheKey, prefer: (ctx.state.providerOrder || ["gemini"])[0] } };` },

  { file: "evolution", cls: "EvolutionModule", layer: "evolution", extra: `
  private flags: Record<string, boolean> = { claudeFallback: true, ledgerV2: false };`, body: `
    // Feature-flag/version-register til gradvis udrulning.
    const { flag, value } = input || {};
    if (flag && typeof value === "boolean") this.flags[flag] = value;
    return { module: this.name, ok: true, data: { version: "5.0", flags: { ...this.flags } } };` },
];

// skriv hvert modul
for (const m of MODULES) {
  const file = `import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class ${m.cls} extends BaseModule {
  name = "${m.file}";
  layer = "${m.layer}";${m.extra || ""}

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {${m.body}
  }
}
`;
  fs.writeFileSync(path.join(MROOT, `${m.file}.ts`), file);
}

// ---- engine.ts (det 23. = kernen: registry + pipeline) ----
const imports = MODULES.map((m) => `import { ${m.cls} } from "./modules/${m.file}.js";`).join("\n");
const regs = MODULES.map((m) => `    this.register(new ${m.cls}());`).join("\n");
fs.writeFileSync(path.join(ROOT, "engine.ts"), `import { BaseModule, Ctx } from "./base.js";
${imports}

// CirkelEngine = core-modulet (det 23.): registrerer alle moduler og kører pipelines.
export class CirkelEngine {
  private modules = new Map<string, BaseModule>();
  layer = "core";
  name = "engine";

  constructor() {
${regs}
  }
  private register(m: BaseModule) { this.modules.set(m.name, m); }
  get(name: string) { return this.modules.get(name); }
  list() { return [...this.modules.keys()]; }

  async initialize() {
    for (const m of this.modules.values()) await m.initialize();
  }
  async health() {
    const mods = [];
    for (const m of this.modules.values()) mods.push(await m.health());
    return { engine: "ready", count: mods.length + 1, modules: mods };
  }
  // Kør en ordnet pipeline gennem udvalgte moduler med delt context.
  async run(steps: string[], input: any) {
    const ctx: Ctx = { state: {}, log: (msg) => console.log("  ·", msg) };
    const trace: any[] = [];
    for (const name of steps) {
      const m = this.modules.get(name);
      if (!m) { trace.push({ step: name, ok: false, note: "ukendt modul" }); continue; }
      const r = await m.process(input, ctx);
      trace.push({ step: name, ok: r.ok, data: r.data });
    }
    return { output: ctx.state, trace };
  }
}
`);

// ---- demo.ts (beviser at det kører) ----
fs.writeFileSync(path.join(ROOT, "demo.ts"), `import { CirkelEngine } from "./engine.js";

async function main() {
  const engine = new CirkelEngine();
  await engine.initialize();

  const h = await engine.health();
  console.log(\`\\n✅ Moduler klar: \${h.count} (22 moduler + 1 kerne = 23)\`);

  // Ægte scan-forløb gennem modulerne:
  const input = { userId: "morten", barcode: "5711953068515", material: "Arla Skyr PP5 bæger", weight_grams: 18, municipality: "Aarhus Kommune" };
  const plan = ["data", "perception", "knowledge", "reasoning_engine", "execution", "action", "communication"];
  const { output, trace } = await engine.run(plan, input);

  console.log("\\n🔁 Pipeline-trace:");
  for (const t of trace) console.log(\`  \${t.ok ? "✓" : "✗"} \${t.step}\`, t.data ? JSON.stringify(t.data) : "");
  console.log("\\n💬 Brugerbesked:\\n  " + output.message);
}
main();
`);

console.log("Skrev base.ts, engine.ts, demo.ts + " + MODULES.length + " moduler → " + MROOT);
console.log("I alt moduler: " + (MODULES.length + 1) + " (inkl. engine-kernen)");
