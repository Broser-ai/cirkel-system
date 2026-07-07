const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType } = require("docx");

const DARK = "0C3A2C", MID = "2E7D5B", ACCENT = "B85C00", MUTED = "5E6E66", TINT = "EEF5F1";
const CW = 9026;
const t = (text, o = {}) => new TextRun({ text, font: "Calibri", size: 19, ...o });

let nid = 0;
const numberings = [];
function bullets(items, color = "16241D") {
  const ref = "b" + (nid++);
  numberings.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 200 } } } }] });
  return items.map(it => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 50, line: 250 },
    children: [new TextRun({ text: it, font: "Calibri", size: 18, color })] }));
}

function noBorder() { const n = { style: BorderStyle.NONE }; return { top: n, bottom: n, left: n, right: n }; }

function colCard(title, items, fill = TINT, titleColor = DARK) {
  const w = (CW - 240) / 3;
  return new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: noBorder(),
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 130, bottom: 130, left: 150, right: 150 },
    children: [
      new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: title, font: "Cambria", size: 19, bold: true, color: titleColor })] }),
      ...bullets(items),
    ],
  });
}
function spacerCell() { return new TableCell({ width: { size: 120, type: WidthType.DXA }, borders: noBorder(), children: [new Paragraph({ children: [] })] }); }

const children = [];

// Header band
children.push(new Table({
  width: { size: CW, type: WidthType.DXA }, columnWidths: [CW],
  rows: [new TableRow({ children: [new TableCell({
    width: { size: CW, type: WidthType.DXA }, borders: noBorder(),
    shading: { fill: DARK, type: ShadingType.CLEAR }, margins: { top: 180, bottom: 180, left: 240, right: 240 },
    children: [
      new Paragraph({ children: [new TextRun({ text: "CIRKEL", font: "Cambria", size: 30, bold: true, color: "FFFFFF" }), new TextRun({ text: "   ·   Pilotpartnerskab", font: "Cambria", size: 24, color: "CFE3D8" })] }),
      new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "Gør jeres emballage til verificerbart genanvendelsesbevis — på 60–90 dage.", font: "Calibri", size: 19, color: "CFE3D8", italic: true })] }),
    ],
  })] })],
}));
children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));

// Intro
children.push(new Paragraph({ spacing: { after: 160, line: 264 }, children: [
  t("Cirkel er en cirkulær-økonomi-platform, hvor borgere scanner emballage ved sortering, belønnes, og hvor hver hændelse låses i et kryptografisk verificerbart ledger. Vi tilbyder ["), t("brand / kommune", { italic: true, color: ACCENT }),
  t("] et afgrænset pilotsamarbejde, der producerer rigtige data på jeres egne produkter eller område — det dokumentationsgrundlag, EU's producentansvar (EPR/PPWR) kræver."),
]}));

// Three columns
children.push(new Table({
  width: { size: CW, type: WidthType.DXA }, columnWidths: [(CW - 240) / 3, 120, (CW - 240) / 3, 120, (CW - 240) / 3],
  rows: [new TableRow({ children: [
    colCard("Vi leverer", ["App + B2B-dashboard sat op til jer", "AI-sortering for de relevante materialer", "Verificeret impact-rapport ved pilotens slut", "Onboarding og løbende support"], TINT, DARK),
    spacerCell(),
    colCard("I får", ["EPR-klar, verificeret indsamlingsdata", "Adfærds- og sorteringsindsigt", "En brandet retur-kampagne på egne SKU'er", "Reference-case til jeres rapportering"], "E4EFE9", MID),
    spacerCell(),
    colCard("Vi har brug for", ["Udvalgte produkter / emballagelinjer (SKU)", "Et defineret område eller en brugergruppe", "Co-promovering til jeres kunder/borgere", "Én kontaktperson hos jer"], "FCF1E3", ACCENT),
  ]})],
}));
children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

// KPIs
children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Sådan måler vi succes", font: "Cambria", size: 20, bold: true, color: DARK })] }));
const kw = CW / 5;
const kpi = (h, s) => new TableCell({ width: { size: kw, type: WidthType.DXA },
  borders: { top: { style: BorderStyle.SINGLE, size: 1, color: "D5E3DC" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "D5E3DC" }, left: { style: BorderStyle.SINGLE, size: 1, color: "D5E3DC" }, right: { style: BorderStyle.SINGLE, size: 1, color: "D5E3DC" } },
  margins: { top: 90, bottom: 90, left: 100, right: 100 },
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, font: "Cambria", size: 18, bold: true, color: MID })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 30 }, children: [new TextRun({ text: s, font: "Calibri", size: 15, color: MUTED })] })] });
children.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [kw, kw, kw, kw, kw],
  rows: [new TableRow({ children: [kpi("Scanninger", "samlet volumen"), kpi("Unikke brugere", "aktiverede borgere"), kpi("Sortering", "compliance-%"), kpi("CO₂", "estimeret sparet"), kpi("Retention", "30/60/90 dage")] })] }));
children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

// Timeline
children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Tidslinje", font: "Cambria", size: 20, bold: true, color: DARK })] }));
const tw = CW / 4;
const tl = (w, h, s) => new TableCell({ width: { size: tw, type: WidthType.DXA }, borders: noBorder(), shading: { fill: TINT, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 130, right: 130 },
  children: [new Paragraph({ children: [new TextRun({ text: w, font: "Calibri", size: 15, bold: true, color: ACCENT })] }),
    new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: h, font: "Cambria", size: 17, bold: true, color: "16241D" })] }),
    new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: s, font: "Calibri", size: 15, color: MUTED })] })] });
children.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [tw - 40, tw - 40, tw - 40, tw - 40],
  rows: [new TableRow({ children: [
    tl("Uge 0", "Opsætning", "Konfiguration, SKU'er, område"),
    tl("Uge 1–2", "Launch", "Go-live + co-promovering"),
    tl("Uge 3–12", "Drift", "Indsamling af data og adfærd"),
    tl("Uge 13", "Rapport", "Verificeret impact-rapport"),
  ]})] }));
children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

// CTA
children.push(new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [CW],
  rows: [new TableRow({ children: [new TableCell({ width: { size: CW, type: WidthType.DXA }, borders: noBorder(), shading: { fill: MID, type: ShadingType.CLEAR }, margins: { top: 140, bottom: 140, left: 220, right: 220 },
    children: [new Paragraph({ children: [new TextRun({ text: "Næste skridt: ", font: "Cambria", size: 19, bold: true, color: "FFFFFF" }),
      new TextRun({ text: "et 30-minutters intromøde, hvor vi rammer SKU'er, område og succesmål af. Skriv til ", font: "Calibri", size: 18, color: "FFFFFF" }),
      new TextRun({ text: "[e-mail]", font: "Calibri", size: 18, bold: true, color: "FFFFFF" }),
      new TextRun({ text: " eller ring [telefon].", font: "Calibri", size: 18, color: "FFFFFF" })] })] })] })] }));

children.push(new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: "Michael Del Pilar Ambrosius · Grundlægger, Cirkel · [website]   ·   Tilpasses brand eller kommune efter behov.", font: "Calibri", size: 15, italic: true, color: MUTED })] }));

const doc = new Document({
  styles: { default: { document: { run: { font: "Calibri", size: 19, color: "16241D" } } } },
  numbering: { config: numberings.map(n => ({ reference: n.reference, levels: n.levels })) },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } }, children }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(require("path").join(__dirname,"out","Cirkel_Pilot_Onepager.docx"), b); console.log("pilot written"); });
