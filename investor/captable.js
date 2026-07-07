// Cirkel — Cap table & SAFE model (Node / exceljs)
// Genererer out/Cirkel_CapTable_SAFE.xlsx. Alle blå tal er inputs; resten er formler.
const ExcelJS = require("exceljs");
const path = require("path");

const FONT = "Calibri";
const DARK = "FF0C3A2C", MID = "FF2E7D5B", TINT = "FFEEF5F1", YELLOW = "FFFFF6D6";
const BLUE = "FF0000FF", BLACK = "FF16241D", WHITE = "FFFFFFFF", MUTED = "FF5E6E66", ACCENT = "FFF97E19";
const KR = '#,##0" kr";(#,##0)" kr";"-"';
const KR2 = '#,##0.00" kr"';
const PCT = "0.0%";
const NUM = "#,##0";

const thin = { style: "thin", color: { argb: "FFD5E3DC" } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

function S(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  c.value = value;
  c.font = { name: FONT, size: o.size || 10.5, bold: !!o.bold, italic: !!o.italic, color: { argb: o.color || BLACK } };
  if (o.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } };
  if (o.numFmt) c.numFmt = o.numFmt;
  c.alignment = { vertical: "middle", horizontal: o.align || "left", indent: o.indent != null ? o.indent : 1 };
  if (o.box) c.border = box;
  return c;
}
function header(ws, addr, text, fill = DARK) { return S(ws, addr, text, { bold: true, color: WHITE, fill, box: true }); }
function inp(ws, addr, val, numFmt = NUM) { return S(ws, addr, val, { color: BLUE, fill: YELLOW, numFmt, align: "right", box: true }); }
function calc(ws, addr, formula, numFmt = NUM, o = {}) {
  return S(ws, addr, { formula }, Object.assign({ align: "right", numFmt, box: true }, o));
}
function note(ws, addr, text) { return S(ws, addr, text, { size: 9.5, italic: true, color: MUTED }); }

async function build(outDir) {
  const wb = new ExcelJS.Workbook();

  // ============ ANTAGELSER ============
  const A = wb.addWorksheet("Antagelser", { views: [{ showGridLines: false }] });
  A.columns = [{ width: 2 }, { width: 40 }, { width: 18 }, { width: 16 }, { width: 42 }];
  A.mergeCells("B2:E2"); S(A, "B2", "CIRKEL — CAP TABLE & SAFE-MODEL", { size: 16, bold: true, color: WHITE, fill: DARK });
  A.mergeCells("B3:E3"); S(A, "B3", "Pre-seed finansieringsmodel · alle inputs (blå/gul) kan ændres", { size: 10, italic: true, color: MUTED });

  header(A, "B5", "Eksisterende ejerskab"); header(A, "C5", "Værdi"); header(A, "D5", ""); header(A, "E5", "Note");
  S(A, "B6", "Stifteraktier (antal)", { box: true }); inp(A, "C6", 1000000); S(A, "D6", "", { box: true }); note(A, "E6", "Samlet stifterbeholdning (kan splittes senere)");
  S(A, "B7", "Eksisterende optionspulje (antal)", { box: true }); inp(A, "C7", 0); S(A, "D7", "", { box: true }); note(A, "E7", "Sat til 0 hvis ingen pulje endnu");

  header(A, "B9", "Pre-seed SAFE-runde"); header(A, "C9", "Værdi"); header(A, "D9", ""); header(A, "E9", "Note");
  S(A, "B10", "SAFE-investering (kr)", { box: true }); inp(A, "C10", 1500000, KR); S(A, "D10", "", { box: true }); note(A, "E10", "Angel-check via SAFE / konvertibelt lån");
  S(A, "B11", "Valuation cap (kr)", { box: true }); inp(A, "C11", 12000000, KR); S(A, "D11", "", { box: true }); note(A, "E11", "Loft for konverteringsprisen");
  S(A, "B12", "Rabat ved konvertering", { box: true }); inp(A, "C12", 0.20, PCT); S(A, "D12", "", { box: true }); note(A, "E12", "Rabat på seed-prisen");
  S(A, "B13", "EIFO matchlån (kr)", { box: true }); inp(A, "C13", 1500000, KR); S(A, "D13", "", { box: true }); note(A, "E13", "1:1 match — lån, ingen equity");
  S(A, "B14", "Månedligt burn (kr)", { box: true }); inp(A, "C14", 120000, KR); S(A, "D14", "", { box: true }); note(A, "E14", "Driftsforbrug pr. måned");

  header(A, "B16", "Seed-runde (konverteringsudløser)"); header(A, "C16", "Værdi"); header(A, "D16", ""); header(A, "E16", "Note");
  S(A, "B17", "Seed pre-money (kr)", { box: true }); inp(A, "C17", 18000000, KR); S(A, "D17", "", { box: true }); note(A, "E17", "Værdiansættelse før ny kapital");
  S(A, "B18", "Seed ny kapital (kr)", { box: true }); inp(A, "C18", 6000000, KR); S(A, "D18", "", { box: true }); note(A, "E18", "Beløb seed-investor lægger ind");
  S(A, "B19", "Ny optionspulje ved seed (% af post)", { box: true }); inp(A, "C19", 0.10, PCT); S(A, "D19", "", { box: true }); note(A, "E19", "Medarbejderpulje oprettet ved seed");

  S(A, "B21", "Blå tal = inputs du kan ændre · sorte tal = beregninger", { size: 9.5, italic: true, color: ACCENT });

  const FOUNDER = "Antagelser!$C$6", EXPOOL = "Antagelser!$C$7";
  const SAFE = "Antagelser!$C$10", CAP = "Antagelser!$C$11", DISC = "Antagelser!$C$12", EIFO = "Antagelser!$C$13", BURN = "Antagelser!$C$14";
  const PRE = "Antagelser!$C$17", NEW = "Antagelser!$C$18", POOLPCT = "Antagelser!$C$19";

  // ============ FINANSIERING ============
  const F = wb.addWorksheet("Finansiering", { views: [{ showGridLines: false }] });
  F.columns = [{ width: 2 }, { width: 38 }, { width: 18 }, { width: 4 }, { width: 38 }, { width: 18 }];
  F.mergeCells("B2:F2"); S(F, "B2", "FINANSIERING & RUNWAY", { size: 15, bold: true, color: WHITE, fill: DARK });
  header(F, "B4", "Kapital rejst"); header(F, "C4", "Beløb");
  S(F, "B5", "SAFE (equity, fortyndende)", { box: true }); calc(F, "C5", `${SAFE}`, KR);
  S(F, "B6", "EIFO matchlån (gæld, ikke-fortyndende)", { box: true }); calc(F, "C6", `${EIFO}`, KR);
  S(F, "B7", "Samlet kapital til rådighed", { bold: true, box: true }); calc(F, "C7", "C5+C6", KR, { bold: true, color: WHITE, fill: MID });
  header(F, "E4", "Runway"); header(F, "F4", "Værdi");
  S(F, "E5", "Månedligt burn", { box: true }); calc(F, "F5", `${BURN}`, KR);
  S(F, "E6", "Runway (måneder)", { bold: true, box: true }); calc(F, "F6", "C7/F5", '0.0" mdr"', { bold: true, color: WHITE, fill: MID });
  S(F, "E7", "Andel ikke-fortyndende", { box: true }); calc(F, "F7", "C6/C7", PCT);
  F.mergeCells("B9:F9"); note(F, "B9", "EIFO matcher angel-investeringen 1:1 som lån. Det fordobler kapitalen uden ekstra fortynding — derfor tæller kun SAFE-delen i cap table'en.");

  // ============ CAP TABLE ============
  const C = wb.addWorksheet("Cap Table", { views: [{ showGridLines: false }] });
  C.columns = [{ width: 2 }, { width: 34 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 14 }];
  C.mergeCells("B2:F2"); S(C, "B2", "CAP TABLE — FRA PRE-SEED TIL POST-SEED", { size: 15, bold: true, color: WHITE, fill: DARK });
  header(C, "B4", "Konverteringsmekanik (SAFE → seed)"); C.mergeCells("C4:F4"); header(C, "C4", "Værdi");
  S(C, "B5", "Pre-seed fuldt udvandede aktier", { box: true }); calc(C, "C5", `${FOUNDER}+${EXPOOL}`, NUM);
  S(C, "B6", "Cap-pris pr. aktie", { box: true }); calc(C, "C6", `${CAP}/C5`, KR2);
  S(C, "B7", "Seed-pris pr. aktie (headline)", { box: true }); calc(C, "C7", `${PRE}/C5`, KR2);
  S(C, "B8", "Rabat-pris pr. aktie", { box: true }); calc(C, "C8", `C7*(1-${DISC})`, KR2);
  S(C, "B9", "SAFE-konverteringspris (laveste)", { box: true }); calc(C, "C9", "MIN(C6,C8)", KR2);
  S(C, "B10", "SAFE-aktier udstedt", { box: true }); calc(C, "C10", `${SAFE}/C9`, NUM);
  S(C, "B11", "Seed-investoraktier udstedt", { box: true }); calc(C, "C11", `${NEW}/C7`, NUM);
  S(C, "B12", "Ny optionspulje (aktier)", { box: true }); calc(C, "C12", `(${POOLPCT}*(C5+C10+C11))/(1-${POOLPCT})`, NUM);
  C.mergeCells("B13:F13"); note(C, "B13", "SAFE konverterer til laveste af cap- og rabat-pris — cap'en beskytter investor hvis seed-værdien bliver høj.");

  header(C, "B15", "Ejerandel"); header(C, "C15", "Aktier"); header(C, "D15", "Pre-seed %"); header(C, "E15", "Post-seed %"); header(C, "F15", "Type");
  const own = [
    ["Stiftere", `${FOUNDER}`, `${FOUNDER}/C5`, "Equity"],
    ["Eksisterende optionspulje", `${EXPOOL}`, `${EXPOOL}/C5`, "Equity"],
    ["SAFE-investor (pre-seed)", "C10", null, "Equity (konv.)"],
    ["Seed-investor", "C11", null, "Equity"],
    ["Ny optionspulje (seed)", "C12", null, "Equity"],
  ];
  let r = 16;
  own.forEach(([lab, sh, pre, typ]) => {
    S(C, `B${r}`, lab, { box: true }); calc(C, `C${r}`, sh, NUM);
    if (pre === null) S(C, `D${r}`, "—", { align: "right", box: true });
    else calc(C, `D${r}`, pre, PCT);
    calc(C, `E${r}`, `C${r}/$C$21`, PCT);
    S(C, `F${r}`, typ, { size: 9.5, color: MUTED, box: true });
    r++;
  });
  S(C, "B21", "Post-seed i alt (fuldt udvandet)", { bold: true, box: true });
  calc(C, "C21", "SUM(C16:C20)", NUM, { bold: true, color: WHITE, fill: MID });
  S(C, "D21", "", { box: true });
  calc(C, "E21", "SUM(E16:E20)", PCT, { bold: true, color: WHITE, fill: MID });
  S(C, "F21", "", { fill: MID, box: true });
  S(C, "B23", "Stifternes ejerandel efter seed-runden:", { size: 11, bold: true, color: DARK });
  calc(C, "C23", "E16", PCT, { bold: true, color: ACCENT, size: 13, align: "left" });

  // ============ SCENARIER ============
  const Sc = wb.addWorksheet("Scenarier", { views: [{ showGridLines: false }] });
  Sc.columns = [{ width: 2 }, { width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }];
  Sc.mergeCells("B2:E2"); S(Sc, "B2", "SCENARIER — SEED-VÆRDI vs. FORTYNDING", { size: 15, bold: true, color: WHITE, fill: DARK });
  Sc.mergeCells("B3:E3"); S(Sc, "B3", "Samme SAFE, cap, rabat og seed-kapital. Kun seed pre-money ændres.", { size: 10, italic: true, color: MUTED });
  header(Sc, "B5", "", MID); header(Sc, "C5", "Lav", MID); header(Sc, "D5", "Base", MID); header(Sc, "E5", "Høj", MID);
  S(Sc, "B6", "Seed pre-money (kr)", { box: true });
  inp(Sc, "C6", 12000000, KR); inp(Sc, "D6", 18000000, KR); inp(Sc, "E6", 28000000, KR);
  const labels = [
    "Pre-seed FD aktier", "Seed-pris pr. aktie", "Cap-pris pr. aktie", "Rabat-pris pr. aktie",
    "SAFE-konv.pris (laveste)", "SAFE-aktier", "Seed-aktier", "Ny optionspulje (aktier)",
    "Post-seed FD aktier", "Stiftere % post", "SAFE-investor % post", "Seed-investor % post",
  ];
  labels.forEach((lab, k) => S(Sc, `B${7 + k}`, lab, { box: true, bold: (k === 9) }));
  ["C", "D", "E"].forEach((col) => {
    calc(Sc, `${col}7`, `${FOUNDER}+${EXPOOL}`, NUM);
    calc(Sc, `${col}8`, `${col}6/${col}7`, KR2);
    calc(Sc, `${col}9`, `${CAP}/${col}7`, KR2);
    calc(Sc, `${col}10`, `${col}8*(1-${DISC})`, KR2);
    calc(Sc, `${col}11`, `MIN(${col}9,${col}10)`, KR2);
    calc(Sc, `${col}12`, `${SAFE}/${col}11`, NUM);
    calc(Sc, `${col}13`, `${NEW}/${col}8`, NUM);
    calc(Sc, `${col}14`, `(${POOLPCT}*(${col}7+${col}12+${col}13))/(1-${POOLPCT})`, NUM);
    calc(Sc, `${col}15`, `${col}7+${col}12+${col}13+${col}14`, NUM);
    calc(Sc, `${col}16`, `${FOUNDER}/${col}15`, PCT, { bold: true, color: ACCENT, fill: TINT });
    calc(Sc, `${col}17`, `${col}12/${col}15`, PCT);
    calc(Sc, `${col}18`, `${col}13/${col}15`, PCT);
  });
  S(Sc, "B16", "Stiftere % post", { box: true, bold: true, fill: TINT });
  Sc.mergeCells("B20:E21");
  note(Sc, "B20", "Bemærk: ved lav seed-værdi rammer cap'en, så SAFE-investor får flere aktier — den indbyggede beskyttelse. Modellen er illustrativ og erstatter ikke juridisk/skattemæssig rådgivning.");

  const out = path.join(outDir, "Cirkel_CapTable_SAFE.xlsx");
  await wb.xlsx.writeFile(out);
  return out;
}

module.exports = { build };
if (require.main === module) build(path.join(__dirname, "out")).then(p => console.log("written", p));
