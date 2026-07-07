import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class IntegrationModule extends BaseModule {
  name = "integration";
  layer = "integration";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Hook til eksterne kilder (GS1/DAWA). Ærlig: aktiv kun hvis konfigureret.
    const gs1 = !!process.env.GS1_API_KEY; const dawa = true; // DAWA er åbent API
    return { module: this.name, ok: true, data: { gs1Configured: gs1, dawaAvailable: dawa },
      note: gs1 ? "klar" : "GS1 ikke konfigureret (sæt GS1_API_KEY)" };
  }
}
