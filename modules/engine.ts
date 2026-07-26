import { BaseModule, Ctx } from "./base.js";
import { DataModule } from "./modules/data.js";
import { MemoryManager } from "./modules/memory.js";
import { SecurityModule } from "./modules/security.js";
import { ContextModule } from "./modules/context.js";
import { PerceptionModule } from "./modules/perception.js";
import { KnowledgeModule } from "./modules/knowledge.js";
import { ReasoningEngine } from "./modules/reasoning_engine.js";
import { AnalyticsModule } from "./modules/analytics.js";
import { PlanningModule } from "./modules/planning.js";
import { ExecutionModule } from "./modules/execution.js";
import { ActionModule } from "./modules/action.js";
import { CreativityModule } from "./modules/creativity.js";
import { EthicsModule } from "./modules/ethics.js";
import { CommunicationModule } from "./modules/communication.js";
import { IntegrationModule } from "./modules/integration.js";
import { CollaborationModule } from "./modules/collaboration.js";
import { OrchestrationModule } from "./modules/orchestration.js";
import { MonitoringModule } from "./modules/monitoring.js";
import { LearningModule } from "./modules/learning.js";
import { AdaptationModule } from "./modules/adaptation.js";
import { OptimizationModule } from "./modules/optimization.js";
import { EvolutionModule } from "./modules/evolution.js";

// Sovereign ESG Ecosystem (24/7 autonomous runtime)
import { SovereignLedger } from "../sovereign/ledger.js";
import { EventBus } from "../sovereign/event-bus.js";
import { DataFabric } from "../sovereign/models/data-fabric.js";
import { SupplierEngine } from "../sovereign/models/supplier-engine.js";
import { DPPEngine } from "../sovereign/models/dpp-engine.js";
import { CarbonTaxEngine } from "../sovereign/models/carbon-tax.js";
import { MaterialityEngine } from "../sovereign/models/materiality-engine.js";
import { ScenarioEngine } from "../sovereign/models/scenario-engine.js";
import { SurveyEngine } from "../sovereign/models/survey-engine.js";
import { AuditEngine } from "../sovereign/models/audit-engine.js";

// CirkelEngine = core-modulet (det 32.): registrerer alle moduler og kører pipelines.
export class CirkelEngine {
  private modules = new Map<string, BaseModule>();
  layer = "core";
  name = "engine";

  constructor() {
    this.register(new DataModule());
    this.register(new MemoryManager());
    this.register(new SecurityModule());
    this.register(new ContextModule());
    this.register(new PerceptionModule());
    this.register(new KnowledgeModule());
    this.register(new ReasoningEngine());
    this.register(new AnalyticsModule());
    this.register(new PlanningModule());
    this.register(new ExecutionModule());
    this.register(new ActionModule());
    this.register(new CreativityModule());
    this.register(new EthicsModule());
    this.register(new CommunicationModule());
    this.register(new IntegrationModule());
    this.register(new CollaborationModule());
    this.register(new OrchestrationModule());
    this.register(new MonitoringModule());
    this.register(new LearningModule());
    this.register(new AdaptationModule());
    this.register(new OptimizationModule());
    this.register(new EvolutionModule());

    // Sovereign ESG Ecosystem (24/7 autonomous runtime)
    this.register(new SovereignLedger());
    this.register(new EventBus());
    this.register(new DataFabric());
    this.register(new SupplierEngine());
    this.register(new DPPEngine());
    this.register(new CarbonTaxEngine());
    this.register(new MaterialityEngine());
    this.register(new ScenarioEngine());
    this.register(new SurveyEngine());
    this.register(new AuditEngine());
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
