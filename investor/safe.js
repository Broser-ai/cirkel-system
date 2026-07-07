const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber } = require("docx");

const DARK = "0C3A2C", MID = "2E7D5B", ACCENT = "B85C00", MUTED = "5E6E66";
const CW = 9026; // A4 content width @1" margins

const H = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (runs, opts = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, ...opts,
  children: Array.isArray(runs) ? runs : [new TextRun(runs)] });
const t = (text, o = {}) => new TextRun({ text, font: "Calibri", size: 21, ...o });

let numId = 0;
function numbered(items) {
  const ref = "n" + (numId++);
  return { config: { reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 360 } } } }] },
    paras: items.map(it => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 90, line: 276 }, children: Array.isArray(it) ? it : [t(it)] })) };
}

function cell(text, { w, bold = false, fill = null, color = "16241D", align = AlignmentType.LEFT, size = 20 } = {}) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "D5E3DC" };
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, font: "Calibri", size, bold, color })] })],
  });
}

const numberings = [];
const children = [];

// Title
children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "CIRKEL", font: "Cambria", size: 30, bold: true, color: DARK })] }));
children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Konvertibelt Gældsbrev (SAFE-struktur)", font: "Cambria", size: 30, bold: true, color: "16241D" })] }));
children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Convertible Loan Note · Pre-seed · Udkast til drøftelse", font: "Calibri", size: 20, italic: true, color: MUTED })] }));

// Disclaimer box
children.push(new Table({
  width: { size: CW, type: WidthType.DXA }, columnWidths: [CW],
  rows: [new TableRow({ children: [new TableCell({
    width: { size: CW, type: WidthType.DXA },
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT }, bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT }, left: { style: BorderStyle.SINGLE, size: 4, color: ACCENT }, right: { style: BorderStyle.SINGLE, size: 4, color: ACCENT } },
    shading: { fill: "FCF1E3", type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    children: [new Paragraph({ children: [
      new TextRun({ text: "Vigtigt — udkast: ", font: "Calibri", size: 20, bold: true, color: ACCENT }),
      new TextRun({ text: "Dette er en arbejdsskabelon, ikke juridisk rådgivning. Et konvertibelt gældsbrev skal gennemgås og tilpasses af en dansk advokat (selskabs- og skatteret) før underskrift. Felter i [kantede parenteser] udfyldes. Tal afstemmes med cap table-modellen (Cirkel_CapTable_SAFE.xlsx).", font: "Calibri", size: 20, color: "5A3410" }),
    ] })],
  })] })],
}));
children.push(P("", { spacing: { after: 120 } }));

// Parties
children.push(H("Parter"));
children.push(P([t("Dette konvertible gældsbrev (\u201CGældsbrevet\u201D) er indgået mellem:")]));
children.push(P([t("Selskabet: ", { bold: true }), t("[Cirkel] [ApS], CVR-nr. [•], [adresse] (\u201CSelskabet\u201D)")]));
children.push(P([t("Investor: ", { bold: true }), t("[Fulde navn / selskab], [CPR/CVR], [adresse] (\u201CInvestor\u201D)")]));
children.push(P([t("Selskabet og Investor benævnes hver for sig en \u201CPart\u201D og samlet \u201CParterne\u201D.")]));

// 1. Baggrund
children.push(H("1. Baggrund"));
children.push(P([t("Investor yder Selskabet et lån, der efter vilkårene nedenfor konverteres til kapitalandele i Selskabet ved en fremtidig finansieringsrunde, en exit eller ved udløb. Formålet er at tilføre Selskabet kapital nu uden at fastlåse en værdiansættelse på nuværende tidspunkt.")]));

// 2. Lånebeløb
children.push(H("2. Lånebeløb og udbetaling"));
const n2 = numbered([
  [t("Investor yder Selskabet et lån på "), t("[1.500.000] kr.", { bold: true }), t(" (\u201CHovedstolen\u201D).")],
  "Hovedstolen udbetales til Selskabets konto senest [5] bankdage efter begge Parters underskrift.",
  "Lånet er usikret og efterstillet Selskabets eventuelle bankgæld, herunder et EIFO-matchlån.",
]);
numberings.push(n2.config); children.push(...n2.paras);

// 3. Forrentning
children.push(H("3. Forrentning"));
children.push(P([t("Hovedstolen forrentes med [0]% p.a. Påløbne renter (hvis nogen) tillægges Hovedstolen og konverteres på samme vilkår som denne.")]));

// 4. Konvertering ved kvalificeret runde
children.push(H("4. Konvertering ved kvalificeret finansieringsrunde"));
const n4 = numbered([
  [t("Ved en Kvalificeret Runde (jf. pkt. 6) konverteres Hovedstolen automatisk til kapitalandele i Selskabet af samme klasse som udstedes i runden.")],
  [t("Konverteringskursen pr. kapitalandel er den "), t("laveste", { bold: true }), t(" af (a) Cap-kursen og (b) Rabat-kursen, jf. pkt. 5.")],
  "Antallet af kapitalandele, Investor modtager, beregnes som Hovedstolen divideret med Konverteringskursen, afrundet ned til nærmeste hele kapitalandel.",
  "Selskabet gennemfører de nødvendige selskabsretlige handlinger (kapitalforhøjelse mv.) for at udstede kapitalandelene ved konvertering.",
]);
numberings.push(n4.config); children.push(...n4.paras);

// 5. Definitioner / nøglevilkår table
children.push(H("5. Nøglevilkår (Valuation Cap og Rabat)"));
const half = CW / 2;
children.push(new Table({
  width: { size: CW, type: WidthType.DXA }, columnWidths: [half, half],
  rows: [
    new TableRow({ tableHeader: true, children: [cell("Vilkår", { w: half, bold: true, fill: DARK, color: "FFFFFF" }), cell("Værdi / definition", { w: half, bold: true, fill: DARK, color: "FFFFFF" })] }),
    new TableRow({ children: [cell("Valuation Cap", { w: half, bold: true, fill: "EEF5F1" }), cell("[12.000.000] kr.", { w: half })] }),
    new TableRow({ children: [cell("Rabat", { w: half, bold: true, fill: "EEF5F1" }), cell("[20]% af kursen i den Kvalificerede Runde", { w: half })] }),
    new TableRow({ children: [cell("Cap-kurs", { w: half }), cell("Valuation Cap divideret med Selskabets fuldt udvandede kapitalandele før runden", { w: half })] }),
    new TableRow({ children: [cell("Rabat-kurs", { w: half }), cell("Rundens kurs pr. kapitalandel × (1 − Rabat)", { w: half })] }),
    new TableRow({ children: [cell("Kvalificeret Runde", { w: half }), cell("Egenkapitalrunde hvor Selskabet rejser mindst [3.000.000] kr. i ny kapital", { w: half })] }),
  ],
}));
children.push(P("", { spacing: { after: 80 } }));

// 6. Definition Kvalificeret + exit
children.push(H("6. Konvertering ved exit (likviditetshændelse)"));
children.push(P([t("Sker der en Exit (salg af flertallet af kapitalandele eller af alle/væsentligt alle aktiver) før konvertering efter pkt. 4, kan Investor efter eget valg modtage enten (a) tilbagebetaling af Hovedstolen med tillæg af [0]–[1]× Hovedstolen, eller (b) konvertere til Cap-kursen umiddelbart før Exit og deltage i provenuet. Det for Investor mest fordelagtige alternativ lægges til grund, medmindre andet aftales skriftligt.")]));

// 7. Udløb
children.push(H("7. Udløb (longstop)"));
children.push(P([t("Er der ikke sket konvertering eller Exit senest [24] måneder efter udbetaling (\u201CUdløbsdatoen\u201D), konverteres Hovedstolen på Investors anmodning til Cap-kursen, alternativt forfalder Hovedstolen til betaling efter Parternes nærmere aftale.")]));

// 8. Investorrettigheder
children.push(H("8. Investorrettigheder"));
const n8 = numbered([
  "Selskabet giver Investor sædvanlig økonomisk rapportering [kvartalsvis] samt adgang til årsrapport.",
  "Investor har ingen bestyrelses- eller stemmerettigheder før konvertering, medmindre andet særskilt aftales.",
]);
numberings.push(n8.config); children.push(...n8.paras);

// 9. MFN
children.push(H("9. Most Favored Nation (MFN)"));
children.push(P([t("Udsteder Selskabet inden konvertering et andet konvertibelt instrument med vilkår, der samlet er mere gunstige for indehaveren, tilbydes Investor at få nærværende Gældsbrev tilpasset til de tilsvarende vilkår.")]));

// 10. Diverse
children.push(H("10. Diverse"));
const n10 = numbered([
  "Overdragelse af Gældsbrevet kræver Selskabets skriftlige samtykke, som ikke afslås uden rimelig grund.",
  "Ændringer skal være skriftlige og underskrevet af begge Parter.",
  "Gældsbrevet udgør hele aftalen mellem Parterne om det konvertible lån og erstatter tidligere tilkendegivelser herom.",
]);
numberings.push(n10.config); children.push(...n10.paras);

// 11. Lovvalg
children.push(H("11. Lovvalg og værneting"));
children.push(P([t("Gældsbrevet er underlagt dansk ret. Tvister søges løst i mindelighed; i mangel heraf afgøres de ved [Retten i •] / [voldgift ved Voldgiftsinstituttet].")]));

// Signatures
children.push(H("Underskrifter"));
children.push(P([t("Sted og dato: ____________________________")], { spacing: { before: 120, after: 300 } }));
children.push(new Table({
  width: { size: CW, type: WidthType.DXA }, columnWidths: [half, half],
  rows: [new TableRow({ children: [
    new TableCell({ width: { size: half, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      children: [new Paragraph({ spacing: { before: 300 }, children: [t("_______________________________")] }), new Paragraph({ children: [t("For Selskabet · Cirkel [ApS]", { bold: true })] }), new Paragraph({ children: [t("Navn: [Michael Del Pilar Ambrosius]", { color: MUTED })] }), new Paragraph({ children: [t("Titel: Direktør", { color: MUTED })] })] }),
    new TableCell({ width: { size: half, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      children: [new Paragraph({ spacing: { before: 300 }, children: [t("_______________________________")] }), new Paragraph({ children: [t("Investor", { bold: true })] }), new Paragraph({ children: [t("Navn: [•]", { color: MUTED })] }), new Paragraph({ children: [t("Titel: [•]", { color: MUTED })] })] }),
  ] })],
}));

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 21, color: "16241D" } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Cambria", color: DARK },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Cambria", color: "16241D" },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: numberings },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Cirkel · Konvertibelt Gældsbrev · Fortroligt", font: "Calibri", size: 16, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Side ", font: "Calibri", size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: MUTED })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(require("path").join(__dirname,"out","Cirkel_SAFE_Konvertibelt_Gaeldsbrev.docx"), b); console.log("safe written"); });
