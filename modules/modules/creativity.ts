import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class CreativityModule extends BaseModule {
  name = "creativity";
  layer = "intelligence";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Genererer kampagnenavn-varianter ud fra brand + materiale.
    const brand = input?.brand || "Cirkel";
    const mat = ctx.state.knowledge?.type || "Materiale";
    const variants = [
      `${brand} ${mat} Loop`,
      `${brand} Grøn Retur — ${mat}`,
      `${mat}-Helten fra ${brand}`,
    ];
    return { module: this.name, ok: true, data: { variants } };
  }
}
