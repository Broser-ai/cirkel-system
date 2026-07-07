import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class KnowledgeModule extends BaseModule {
  name = "knowledge";
  layer = "processing";
  private kb: Record<string, { recyclable: number; bin: string; co2PerKg: number; fact: string }> = {
    PET: { recyclable: 100, bin: "Plast", co2PerKg: 1.5, fact: "rPET kan genanvendes igen og igen til nye flasker." },
    PP5: { recyclable: 100, bin: "Plast", co2PerKg: 1.3, fact: "PP5 kan genanvendes 6-7 gange hvis det er rent." },
    HDPE: { recyclable: 95, bin: "Plast", co2PerKg: 1.4, fact: "HDPE bliver til rør, spande og bænke." },
    Aluminium: { recyclable: 100, bin: "Metal", co2PerKg: 9.0, fact: "Genbrug af alu kræver kun 5% af den oprindelige energi." },
    Karton: { recyclable: 85, bin: "Mad- og drikkekartoner", co2PerKg: 0.9, fact: "Fold kartonen fladt for at spare plads." },
    Glas: { recyclable: 100, bin: "Glas", co2PerKg: 0.6, fact: "Returglas genbruges i snit 30 gange." },
  };

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Slår genanvendelses-fakta op for den sansede materialetype.
    const type = ctx.state.observation?.detectedType || "Ukendt";
    const facts = this.kb[type] || { recyclable: 50, bin: "Restaffald", co2PerKg: 0.3, fact: "Tjek din kommunes sorteringsguide." };
    ctx.state.knowledge = { type, ...facts };
    return { module: this.name, ok: !!this.kb[type], data: ctx.state.knowledge };
  }
}
