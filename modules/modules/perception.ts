import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class PerceptionModule extends BaseModule {
  name = "perception";
  layer = "processing";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
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
    return { module: this.name, ok: type !== "Ukendt", data: observation };
  }
}
