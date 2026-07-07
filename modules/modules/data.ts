import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class DataModule extends BaseModule {
  name = "data";
  layer = "foundation";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
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
    return { module: this.name, ok: valid, data: clean, note: valid ? "valid" : "mangler material/vægt" };
  }
}
