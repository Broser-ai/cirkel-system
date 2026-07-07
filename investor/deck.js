const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

// ---------- palette ----------
const DARK = "0C3A2C";    // deep forest (dominant)
const MID = "2E7D5B";     // emerald
const ACCENT = "F97E19";  // orange (energy / CTA)
const INK = "16241D";     // near-black green
const MUTED = "5E6E66";   // muted gray-green
const LIGHT = "FFFFFF";
const TINT = "EEF5F1";    // mint tint
const TINT2 = "E4EFE9";
const WHITE = "FFFFFF";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Michael Del Pilar Ambrosius";
pres.title = "Cirkel — Pre-seed investoroplæg";

const W = 13.3, H = 7.5;
const HEAD = "Cambria";
const BODY = "Calibri";

// ---------- icon helper ----------
async function icon(IconComponent, color = "#FFFFFF", size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const sh = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 90, opacity: 0.13 });

function pageNum(slide, n) {
  slide.addText(`${n}`, { x: W - 0.7, y: H - 0.5, w: 0.4, h: 0.3, fontSize: 9, color: MUTED, align: "right", fontFace: BODY });
  slide.addText("Cirkel · Fortroligt", { x: 0.5, y: H - 0.5, w: 4, h: 0.3, fontSize: 9, color: MUTED, fontFace: BODY });
}

async function build() {
  const I = {
    leaf: await icon(fa.FaLeaf, "#FFFFFF"),
    leafG: await icon(fa.FaLeaf, "#2E7D5B"),
    qr: await icon(fa.FaQrcode, "#FFFFFF"),
    robot: await icon(fa.FaRobot, "#FFFFFF"),
    coins: await icon(fa.FaCoins, "#FFFFFF"),
    lock: await icon(fa.FaLock, "#FFFFFF"),
    shield: await icon(fa.FaShieldAlt, "#0C3A2C"),
    link: await icon(fa.FaLink, "#0C3A2C"),
    gavel: await icon(fa.FaGavel, "#FFFFFF"),
    clock: await icon(fa.FaClock, "#FFFFFF"),
    chart: await icon(fa.FaChartLine, "#0C3A2C"),
    building: await icon(fa.FaBuilding, "#FFFFFF"),
    landmark: await icon(fa.FaLandmark, "#FFFFFF"),
    users: await icon(fa.FaUsers, "#FFFFFF"),
    fingerprint: await icon(fa.FaFingerprint, "#FFFFFF"),
    code: await icon(fa.FaCode, "#FFFFFF"),
    mobile: await icon(fa.FaMobileAlt, "#FFFFFF"),
    map: await icon(fa.FaMapMarkedAlt, "#FFFFFF"),
    handshake: await icon(fa.FaHandshake, "#FFFFFF"),
    rocket: await icon(fa.FaRocket, "#FFFFFF"),
    flag: await icon(fa.FaFlagCheckered, "#0C3A2C"),
    recycle: await icon(fa.FaRecycle, "#FFFFFF"),
    check: await icon(fa.FaCheckCircle, "#2E7D5B"),
    arrow: await icon(fa.FaArrowRight, "#F97E19"),
    euro: await icon(fa.FaEuroSign, "#FFFFFF"),
    seedling: await icon(fa.FaSeedling, "#FFFFFF"),
    bullseye: await icon(fa.FaBullseye, "#0C3A2C"),
  };

  // helper: icon in colored circle
  function iconCircle(slide, x, y, d, fill, iconData, idScale = 0.55) {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, shadow: sh() });
    const ip = d * idScale, off = (d - ip) / 2;
    slide.addImage({ data: iconData, x: x + off, y: y + off, w: ip, h: ip });
  }

  // =========================================================
  // 1. COVER
  // =========================================================
  let s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.shapes.OVAL, { x: 9.4, y: -2.2, w: 6.6, h: 6.6, fill: { color: MID, transparency: 78 } });
  s.addShape(pres.shapes.OVAL, { x: 11.0, y: 3.6, w: 5.2, h: 5.2, fill: { color: ACCENT, transparency: 86 } });
  iconCircle(s, 0.85, 0.8, 1.0, MID, I.recycle, 0.5);
  s.addText("CIRKEL", { x: 2.0, y: 0.95, w: 6, h: 0.7, fontSize: 26, bold: true, color: WHITE, fontFace: HEAD, charSpacing: 3 });

  s.addText("Affald bliver til\nverificerbar værdi.", { x: 0.85, y: 2.55, w: 9.6, h: 2.0, fontSize: 50, bold: true, color: WHITE, fontFace: HEAD, lineSpacingMultiple: 1.0 });
  s.addText("En cirkulær-økonomi-platform der gør forbrugeres genanvendelse til kryptografisk verificerbart bevis — det producenter og kommuner skal bruge under EU's nye producentansvar.",
    { x: 0.9, y: 4.75, w: 8.6, h: 1.1, fontSize: 16, color: "CFE3D8", fontFace: BODY, lineSpacingMultiple: 1.15 });

  s.addText([
    { text: "Pre-seed investoroplæg", options: { bold: true, color: ACCENT } },
    { text: "   ·   Juni 2026   ·   Fortroligt", options: { color: "9FBBAE" } },
  ], { x: 0.9, y: 6.35, w: 9, h: 0.4, fontSize: 13, fontFace: BODY });
  s.addText("Michael Del Pilar Ambrosius · Grundlægger", { x: 0.9, y: 6.75, w: 9, h: 0.4, fontSize: 12, color: "9FBBAE", fontFace: BODY });

  // =========================================================
  // 2. PROBLEM
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("PROBLEMET", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Producentansvar er nu lovpligtigt — men beviset findes ikke", { x: 0.7, y: 0.92, w: 12, h: 0.9, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  const probs = [
    [I.gavel, "Lovpligt uden data", "EU's PPWR og udvidet producentansvar (EPR) tvinger producenter til at dokumentere, at deres emballage faktisk indsamles og genanvendes. De har ingen pålidelig kilde til den dokumentation."],
    [I.recycle, "Husholdningen er den blinde vinkel", "Pant dækker dåser og flasker. Resten — plast, karton, folie, glas — sorteres i hjemmet uden sporbarhed. Det er størstedelen af emballagen og helt udokumenteret."],
    [I.users, "Borgeren mangler en grund", "Uden belønning eller feedback sorterer folk inkonsekvent. Compliance-tallene, kommuner og brands rapporterer på, er gæt — ikke målinger."],
  ];
  let px = 0.7;
  for (const [ic, h, b] of probs) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px, y: 2.15, w: 3.92, h: 4.5, fill: { color: TINT }, rectRadius: 0.12, shadow: sh() });
    iconCircle(s, px + 0.35, 2.55, 0.95, DARK, ic, 0.5);
    s.addText(h, { x: px + 0.35, y: 3.7, w: 3.3, h: 0.7, fontSize: 18, bold: true, color: INK, fontFace: HEAD });
    s.addText(b, { x: px + 0.35, y: 4.45, w: 3.3, h: 2.0, fontSize: 13.5, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.12 });
    px += 4.12;
  }
  pageNum(s, 2);

  // =========================================================
  // 3. WHY NOW (timeline)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("HVORFOR NU", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Et reguleringsvindue der lukker hurtigt", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });
  s.addText("Producenter skal investere i indsamlingsbevis nu — ikke om tre år. Den der ejer datalaget, når kravene rammer, vinder kategorien.", { x: 0.7, y: 1.7, w: 11.8, h: 0.6, fontSize: 14.5, color: MUTED, fontFace: BODY });

  const tl = [
    ["Mar 2026", "Omnibus I i kraft", "CSRD-omfang indsnævret, men EPR-rapporteringskrav for emballage består fuldt ud."],
    ["2026–27", "PPWR-krav fases ind", "Genanvendelsesmål og dokumentationskrav per materiale træder i kraft på tværs af EU."],
    ["2027+", "Producenter søger bevis", "Brands og producentansvars-ordninger leder efter verificerbare adfærdsdata at rapportere på."],
    ["Vinduet", "First-mover på datalaget", "Cirkel etablerer det neutrale, reviderbare bevislag før kategorien har en standard."],
  ];
  const tY = 3.5, segW = 11.9 / tl.length;
  s.addShape(pres.shapes.LINE, { x: 0.95, y: tY, w: 11.4, h: 0, line: { color: TINT2, width: 3 } });
  let tx = 0.7;
  tl.forEach(([d, h, b], i) => {
    const cx = tx + segW / 2;
    s.addShape(pres.shapes.OVAL, { x: cx - 0.13, y: tY - 0.13, w: 0.26, h: 0.26, fill: { color: i === tl.length - 1 ? ACCENT : MID } });
    s.addText(d, { x: tx + 0.1, y: tY - 0.95, w: segW - 0.2, h: 0.4, fontSize: 14, bold: true, color: i === tl.length - 1 ? ACCENT : MID, fontFace: HEAD, align: "center" });
    s.addText(h, { x: tx + 0.1, y: tY + 0.35, w: segW - 0.2, h: 0.6, fontSize: 14.5, bold: true, color: INK, fontFace: HEAD, align: "center" });
    s.addText(b, { x: tx + 0.12, y: tY + 1.0, w: segW - 0.24, h: 2.2, fontSize: 12, color: "3C4A43", fontFace: BODY, align: "center", lineSpacingMultiple: 1.12 });
    tx += segW;
  });
  pageNum(s, 3);

  // =========================================================
  // 4. SOLUTION (4-step loop)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("LØSNINGEN", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Én scanning lukker hele kredsløbet", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  const steps = [
    [I.qr, "1 · Scan", "Borgeren scanner emballagens stregkode på vej til sortering."],
    [I.robot, "2 · Identificér", "Gemini-AI bestemmer materiale og korrekt sortering for borgerens kommune."],
    [I.coins, "3 · Beløn", "Point og kroner udløses — adfærd der ellers er usynlig, bliver belønnet."],
    [I.lock, "4 · Verificér", "Hver hændelse låses i et hash-kædet ledger: reviderbart, manipulationssikkert bevis."],
  ];
  let sx = 0.7;
  const cardW = 2.78;
  steps.forEach(([ic, h, b], i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: sx, y: 2.35, w: cardW, h: 4.1, fill: { color: i === 3 ? DARK : TINT }, rectRadius: 0.12, shadow: sh() });
    iconCircle(s, sx + cardW / 2 - 0.5, 2.7, 1.0, i === 3 ? ACCENT : MID, ic, 0.5);
    s.addText(h, { x: sx + 0.2, y: 3.85, w: cardW - 0.4, h: 0.5, fontSize: 17, bold: true, color: i === 3 ? WHITE : INK, fontFace: HEAD, align: "center" });
    s.addText(b, { x: sx + 0.25, y: 4.4, w: cardW - 0.5, h: 1.9, fontSize: 12.5, color: i === 3 ? "CFE3D8" : "3C4A43", fontFace: BODY, align: "center", lineSpacingMultiple: 1.12 });
    sx += cardW + 0.18;
    if (i < 3) s.addImage({ data: I.arrow, x: sx - 0.27, y: 4.15, w: 0.26, h: 0.26 });
  });
  s.addText("Forbrugeren får en grund til at sortere. Producenten får det bevis, loven kræver. Begge sider af kredsløbet i ét greb.", { x: 0.7, y: 6.7, w: 11.9, h: 0.5, fontSize: 13.5, italic: true, color: MID, fontFace: BODY, align: "center" });
  pageNum(s, 4);

  // =========================================================
  // 5. PRODUKTET ER BYGGET (de-risk proof)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("STATUS: BYGGET", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Ikke en idé på en serviet — et færdigt produkt", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  // left: big stat block
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 2.1, w: 3.5, h: 4.55, fill: { color: DARK }, rectRadius: 0.12, shadow: sh() });
  s.addText("~25.000", { x: 0.85, y: 2.65, w: 3.2, h: 0.9, fontSize: 46, bold: true, color: ACCENT, fontFace: HEAD });
  s.addText("linjer produktionskode", { x: 0.85, y: 3.55, w: 3.2, h: 0.4, fontSize: 14, color: WHITE, fontFace: BODY });
  s.addText([
    { text: "React 19 · Vite · Tailwind", options: { breakLine: true, color: "CFE3D8" } },
    { text: "Supabase · Firebase", options: { breakLine: true, color: "CFE3D8" } },
    { text: "Gemini-AI · 3 endpoints", options: { breakLine: true, color: "CFE3D8" } },
    { text: "DA / EN · klar til deploy", options: { color: "CFE3D8" } },
  ], { x: 0.85, y: 4.25, w: 3.2, h: 2.0, fontSize: 13.5, fontFace: BODY, lineSpacingMultiple: 1.45 });

  // right: feature grid 2x3
  const feats = [
    [I.fingerprint, "MitID-verifikation", "Dansk-grade identitet i tre tillidstrin."],
    [I.lock, "Hash-kædet ledger", "Append-only SHA-256 bevis-kæde i databasen."],
    [I.mobile, "Dual-mode app", "Borger-app + B2B-partnerdashboard i ét."],
    [I.robot, "AI-sorteringsmotor", "Materialeidentifikation + kommune-specifikke regler."],
    [I.building, "EPR-dashboard", "Compliance-deadlines, kampagner, persona-segmenter."],
    [I.map, "Kort & locator", "DAWA-adresser, genbrugsstationer, skraldespande."],
  ];
  let fx = 4.5, fy = 2.1;
  feats.forEach(([ic, h, b], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 4.5 + col * 4.18, y = 2.1 + row * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 4.0, h: 1.4, fill: { color: TINT }, rectRadius: 0.1 });
    iconCircle(s, x + 0.2, y + 0.32, 0.75, MID, ic, 0.5);
    s.addText(h, { x: x + 1.1, y: y + 0.2, w: 2.75, h: 0.4, fontSize: 14.5, bold: true, color: INK, fontFace: HEAD });
    s.addText(b, { x: x + 1.1, y: y + 0.6, w: 2.8, h: 0.7, fontSize: 11.5, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.05 });
  });
  s.addText("Den største risiko i pre-seed — kan teamet bygge produktet — er allerede afløftet.", { x: 4.5, y: 6.78, w: 8.3, h: 0.4, fontSize: 13, italic: true, color: MID, fontFace: BODY });
  pageNum(s, 5);

  // =========================================================
  // 6. THE TRUST LAYER (dark, differentiator)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.shapes.OVAL, { x: 10.5, y: -1.8, w: 5.5, h: 5.5, fill: { color: MID, transparency: 82 } });
  s.addText("KERNEN", { x: 0.7, y: 0.6, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Tillidslaget er moaten", { x: 0.7, y: 0.97, w: 12, h: 0.7, fontSize: 30, bold: true, color: WHITE, fontFace: HEAD });
  s.addText("Enhver kan bygge en scanner-app med belønninger. Det andre ikke har, er et bevis en revisor og en myndighed kan stole på. Cirkels ledger er en append-only, write-once SHA-256-kæde: hver hændelse hashes sammen med den forrige. Data kan ikke ændres bagud uden at kæden brydes.",
    { x: 0.7, y: 1.85, w: 7.2, h: 2.3, fontSize: 16, color: "DCEAE2", fontFace: BODY, lineSpacingMultiple: 1.25 });

  const layers = [
    [I.check, "Reviderbar", "Hver krone og hvert point spores til en scanning i en uforanderlig kæde."],
    [I.shield, "Manipulationssikker", "Row-level security + write-once-politik. Ingen kan redigere historik."],
    [I.link, "Rapporteringsklar", "Det datasæt producenter har brug for at lægge i deres EPR-rapport."],
  ];
  let ly = 2.0;
  layers.forEach(([ic, h, b]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.35, y: ly, w: 4.25, h: 1.45, fill: { color: WHITE }, rectRadius: 0.1, shadow: sh() });
    iconCircle(s, 8.55, ly + 0.32, 0.78, TINT, ic, 0.5);
    s.addText(h, { x: 9.5, y: ly + 0.22, w: 3.0, h: 0.4, fontSize: 15, bold: true, color: INK, fontFace: HEAD });
    s.addText(b, { x: 9.5, y: ly + 0.62, w: 3.0, h: 0.75, fontSize: 11, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.05 });
    ly += 1.62;
  });
  s.addText("\u201CVerificerbar adfærd\u201D er produktet. Appen er bare hvordan vi indsamler den.", { x: 0.7, y: 5.7, w: 7.4, h: 0.9, fontSize: 17, italic: true, bold: true, color: ACCENT, fontFace: HEAD, lineSpacingMultiple: 1.1 });
  pageNum(s, 6);

  // =========================================================
  // 7. FORRETNINGSMODEL
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("FORRETNINGSMODEL", { x: 0.7, y: 0.55, w: 5, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Gratis for borgeren. Betalt af dem loven forpligter", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 29, bold: true, color: INK, fontFace: HEAD });

  const payers = [
    [I.building, "Producenter & brands", "Abonnement + kampagner", "Verificeret indsamlingsbevis til EPR-rapportering, plus målrettede retur-kampagner på egne SKU'er med adfærdsdata."],
    [I.landmark, "Kommuner", "Data-abonnement", "Sorterings-compliance og adfærdsindsigt per område — det de i dag mangler for at styre indsats og rapportering."],
    [I.handshake, "Pant- & retursystemer", "Partnerskab / rev-share", "Cirkel dækker den ikke-pantbelagte husholdningsemballage som komplement, ikke konkurrent."],
  ];
  let yx = 0.7;
  payers.forEach(([ic, h, tag, b]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: yx, y: 2.1, w: 3.92, h: 4.45, fill: { color: TINT }, rectRadius: 0.12, shadow: sh() });
    iconCircle(s, yx + 0.35, 2.45, 0.9, DARK, ic, 0.5);
    s.addText(h, { x: yx + 0.35, y: 3.5, w: 3.3, h: 0.5, fontSize: 18, bold: true, color: INK, fontFace: HEAD });
    s.addText(tag, { x: yx + 0.35, y: 4.0, w: 3.3, h: 0.4, fontSize: 12.5, bold: true, color: ACCENT, fontFace: BODY });
    s.addText(b, { x: yx + 0.35, y: 4.5, w: 3.3, h: 1.9, fontSize: 13, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.15 });
    yx += 4.12;
  });
  s.addText("Indtægten følger en lovpligt — ikke et marketingbudget der kan skæres væk i en nedtur.", { x: 0.7, y: 6.7, w: 11.9, h: 0.4, fontSize: 13.5, italic: true, color: MID, fontFace: BODY, align: "center" });
  pageNum(s, 7);

  // =========================================================
  // 8. MARKED (funnel)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("MARKED", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Start i Danmark, struktur til hele EU", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  const funnel = [
    ["TAM", "EU's producentansvar for emballage", "Hele EU's EPR- og PPWR-compliancemarked for emballage — drevet af lovpligtig rapportering.", DARK, 11.6],
    ["SAM", "Dansk husholdningsemballage uden pant", "Plast, karton, folie og glas i danske hjem — producent- og kommunebetalt compliance + adfærd.", MID, 9.0],
    ["SOM (3 år)", "Tidlige partnere", "Et håndterbart antal brand- og kommunekontrakter fra pilot til betalt udrulning.", ACCENT, 6.0],
  ];
  let fyy = 2.25;
  funnel.forEach(([tag, h, b, col, w]) => {
    const x = 0.7 + (11.9 - w) / 2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: fyy, w, h: 1.28, fill: { color: col }, rectRadius: 0.1, shadow: sh() });
    s.addText(tag, { x: x + 0.35, y: fyy + 0.18, w: 2.2, h: 0.9, fontSize: 20, bold: true, color: WHITE, fontFace: HEAD, valign: "middle" });
    s.addText(h, { x: x + 2.6, y: fyy + 0.16, w: w - 3.0, h: 0.5, fontSize: 15.5, bold: true, color: WHITE, fontFace: HEAD });
    s.addText(b, { x: x + 2.6, y: fyy + 0.62, w: w - 3.0, h: 0.6, fontSize: 11.5, color: "EAF3EE", fontFace: BODY, lineSpacingMultiple: 1.0 });
    fyy += 1.5;
  });
  s.addText("Markedsstørrelser er retningsgivende estimater til validering med partnere — ikke reviderede tal.", { x: 0.7, y: 6.85, w: 11.9, h: 0.35, fontSize: 11, italic: true, color: MUTED, fontFace: BODY, align: "center" });
  pageNum(s, 8);

  // =========================================================
  // 9. POSITIONERING
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("POSITIONERING", { x: 0.7, y: 0.55, w: 5, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Vi konkurrerer ikke med pant — vi udfylder hullet ved siden af", { x: 0.7, y: 0.92, w: 12.2, h: 0.7, fontSize: 27, bold: true, color: INK, fontFace: HEAD });

  // two columns: pant/TOMRA vs Cirkel
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 2.2, w: 5.85, h: 4.35, fill: { color: TINT }, rectRadius: 0.12, shadow: sh() });
  s.addText("Pant & retursystemer (TOMRA)", { x: 1.0, y: 2.5, w: 5.3, h: 0.5, fontSize: 18, bold: true, color: INK, fontFace: HEAD });
  s.addText([
    { text: "Dækker dåser, flasker, genbrugskopper", options: { bullet: true, breakLine: true } },
    { text: "Ejer fx Aarhus' genbrugskop-loop", options: { bullet: true, breakLine: true } },
    { text: "Pantbelagte beholdere med depositum", options: { bullet: true, breakLine: true } },
    { text: "Hardware-tungt indsamlingssystem", options: { bullet: true } },
  ], { x: 1.0, y: 3.15, w: 5.3, h: 2.4, fontSize: 14, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.3, paraSpaceAfter: 6 });
  s.addText("Potentiel partner — ikke konkurrent", { x: 1.0, y: 5.9, w: 5.3, h: 0.4, fontSize: 13, bold: true, italic: true, color: MID, fontFace: BODY });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.75, y: 2.2, w: 5.85, h: 4.35, fill: { color: DARK }, rectRadius: 0.12, shadow: sh() });
  s.addText("Cirkel", { x: 7.05, y: 2.5, w: 5.3, h: 0.5, fontSize: 18, bold: true, color: ACCENT, fontFace: HEAD });
  s.addText([
    { text: "Husholdningsemballage UDEN pant", options: { bullet: true, breakLine: true } },
    { text: "Plast, karton, folie, glas i hjemmet", options: { bullet: true, breakLine: true } },
    { text: "Verificerbart adfærds- og bevislag", options: { bullet: true, breakLine: true } },
    { text: "Software — ingen hardware at udrulle", options: { bullet: true } },
  ], { x: 7.05, y: 3.15, w: 5.3, h: 2.4, fontSize: 14, color: "DCEAE2", fontFace: BODY, lineSpacingMultiple: 1.3, paraSpaceAfter: 6 });
  s.addText("Det segment ingen i dag dokumenterer", { x: 7.05, y: 5.9, w: 5.3, h: 0.4, fontSize: 13, bold: true, italic: true, color: ACCENT, fontFace: BODY });
  pageNum(s, 9);

  // =========================================================
  // 10. GO-TO-MARKET
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("GO-TO-MARKET", { x: 0.7, y: 0.55, w: 5, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Land én pilot. Gør den til reference. Udrul.", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  const gtm = [
    [I.bullseye, "1 · Pilot", "Ét brand eller én kommune. 60–90 dage. Rigtige scan-data fra rigtige borgere.", DARK],
    [I.flag, "2 · Reference", "Verificeret impact-rapport bliver bevis-casen der gør næste salg let.", MID],
    [I.rocket, "3 · Udrul", "Fra pilot til betalt abonnement, så flere brands/kommuner på samme motor.", ACCENT],
  ];
  let gx = 0.7;
  gtm.forEach(([ic, h, b, col], i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: gx, y: 2.35, w: 3.78, h: 3.6, fill: { color: i === 2 ? DARK : TINT }, rectRadius: 0.12, shadow: sh() });
    iconCircle(s, gx + 0.35, 2.7, 0.95, col, ic, 0.5);
    s.addText(h, { x: gx + 0.35, y: 3.8, w: 3.1, h: 0.5, fontSize: 19, bold: true, color: i === 2 ? WHITE : INK, fontFace: HEAD });
    s.addText(b, { x: gx + 0.35, y: 4.35, w: 3.15, h: 1.5, fontSize: 13.5, color: i === 2 ? "CFE3D8" : "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.15 });
    gx += 3.95;
    if (i < 2) s.addImage({ data: I.arrow, x: gx - 0.29, y: 4.0, w: 0.28, h: 0.28 });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 6.2, w: 11.9, h: 0.95, fill: { color: TINT2 }, rectRadius: 0.1 });
  s.addText([
    { text: "Hele rejsen hænger på ét punkt:  ", options: { bold: true, color: INK } },
    { text: "den første pilot der producerer ægte data. Det er den runden finansierer.", options: { color: "3C4A43" } },
  ], { x: 1.0, y: 6.42, w: 11.3, h: 0.5, fontSize: 14, fontFace: BODY, valign: "middle" });
  pageNum(s, 10);

  // =========================================================
  // 11. MILESTONES & USE OF FUNDS
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("PLAN FOR KAPITALEN", { x: 0.7, y: 0.55, w: 5, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("12–18 måneder, bundet til milepæle", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  // left: milestone ladder
  const miles = [
    ["0–3 mdr", "Deploy til produktion + sikkerhed (nøglerotation, dedikeret Supabase)."],
    ["3–6 mdr", "Første betalte pilot live; udløser EIFO-matchlån."],
    ["6–12 mdr", "Impact-rapport + 2–3 yderligere partnere fra reference-casen."],
    ["12–18 mdr", "Gentagelig omsætning; data til en priset seed-runde."],
  ];
  let my = 2.2;
  miles.forEach(([d, b], i) => {
    s.addShape(pres.shapes.OVAL, { x: 0.75, y: my + 0.05, w: 0.42, h: 0.42, fill: { color: i === miles.length - 1 ? ACCENT : MID } });
    s.addText(`${i + 1}`, { x: 0.75, y: my + 0.05, w: 0.42, h: 0.42, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: HEAD });
    s.addText(d, { x: 1.35, y: my, w: 1.5, h: 0.5, fontSize: 13.5, bold: true, color: INK, fontFace: HEAD });
    s.addText(b, { x: 2.95, y: my - 0.02, w: 3.5, h: 1.0, fontSize: 12.5, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.05 });
    my += 1.12;
  });

  // right: use of funds chart
  s.addText("Anvendelse af midler", { x: 7.4, y: 2.05, w: 5, h: 0.4, fontSize: 16, bold: true, color: INK, fontFace: HEAD });
  s.addChart(pres.charts.DOUGHNUT, [{
    name: "Anvendelse",
    labels: ["Produkt & deploy", "Pilot & GTM", "Compliance & juridisk", "Drift & buffer"],
    values: [40, 30, 15, 15],
  }], {
    x: 7.2, y: 2.4, w: 5.2, h: 4.2, holeSize: 58,
    chartColors: [DARK, MID, ACCENT, "9FBBAE"],
    showLegend: true, legendPos: "b", legendColor: INK, legendFontSize: 11,
    showValue: false, showPercent: true, dataLabelColor: "FFFFFF", dataLabelFontSize: 11,
  });
  s.addText("Illustrativ fordeling — justeres efter rundens størrelse.", { x: 7.2, y: 6.75, w: 5.2, h: 0.3, fontSize: 10.5, italic: true, color: MUTED, fontFace: BODY, align: "center" });
  pageNum(s, 11);

  // =========================================================
  // 12. THE ASK (dark)
  // =========================================================
  s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.shapes.OVAL, { x: -1.8, y: 3.6, w: 5.5, h: 5.5, fill: { color: MID, transparency: 82 } });
  s.addText("THE ASK", { x: 0.7, y: 0.7, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Pre-seed — struktureret for minimal fortynding", { x: 0.7, y: 1.07, w: 12, h: 0.7, fontSize: 30, bold: true, color: WHITE, fontFace: HEAD });

  const asks = [
    [I.seedling, "1,5 mio. kr.", "Angel-investering via SAFE med valuation cap — prisen fastlåses ikke nu."],
    [I.euro, "+ 1,5 mio. kr.", "EIFO-matchlån 1:1 oven på angel-checken. Lån, ingen ekstra equity."],
    [I.rocket, "= 3,0 mio. kr.", "Samlet runway til produktion, første pilot og vejen til en seed-runde."],
  ];
  let ax = 0.7;
  asks.forEach(([ic, big, b], i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ax, y: 2.5, w: 3.92, h: 3.3, fill: { color: i === 2 ? ACCENT : WHITE }, rectRadius: 0.12, shadow: sh() });
    iconCircle(s, ax + 0.35, 2.8, 0.85, i === 2 ? DARK : MID, ic, 0.5);
    s.addText(big, { x: ax + 0.35, y: 3.75, w: 3.3, h: 0.6, fontSize: 27, bold: true, color: i === 2 ? DARK : INK, fontFace: HEAD });
    s.addText(b, { x: ax + 0.35, y: 4.4, w: 3.3, h: 1.3, fontSize: 13, color: i === 2 ? "3A2206" : "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.15 });
    ax += 4.12;
  });
  s.addText("Beløb og cap er illustrative og justeres i den vedlagte cap table-model. Kapitalen, plus et produkt der allerede ser færdigt ud, køber den første betalte pilot.",
    { x: 0.7, y: 6.15, w: 11.9, h: 0.9, fontSize: 14, color: "CFE3D8", fontFace: BODY, lineSpacingMultiple: 1.2 });
  pageNum(s, 12);

  // =========================================================
  // 13. TEAM
  // =========================================================
  s = pres.addSlide();
  s.background = { color: LIGHT };
  s.addText("TEAM", { x: 0.7, y: 0.55, w: 4, h: 0.35, fontSize: 13, bold: true, color: ACCENT, fontFace: BODY, charSpacing: 3 });
  s.addText("Grundlæggeren", { x: 0.7, y: 0.92, w: 12, h: 0.7, fontSize: 30, bold: true, color: INK, fontFace: HEAD });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 2.15, w: 3.4, h: 4.4, fill: { color: DARK }, rectRadius: 0.12, shadow: sh() });
  s.addShape(pres.shapes.OVAL, { x: 1.55, y: 2.6, w: 1.7, h: 1.7, fill: { color: MID } });
  s.addText("MA", { x: 1.55, y: 2.6, w: 1.7, h: 1.7, fontSize: 40, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: HEAD });
  s.addText("Michael Del Pilar\nAmbrosius", { x: 0.85, y: 4.45, w: 3.1, h: 0.9, fontSize: 19, bold: true, color: WHITE, align: "center", fontFace: HEAD, lineSpacingMultiple: 1.0 });
  s.addText("Grundlægger & CEO", { x: 0.85, y: 5.35, w: 3.1, h: 0.4, fontSize: 13, color: ACCENT, align: "center", fontFace: BODY });

  const bio = [
    [I.chart, "Europæisk kommerciel ledelse", "VP European Markets hos Manwah Holdings og HTL International — opbygget og skaleret B2B-salg på tværs af europæiske markeder."],
    [I.recycle, "Cirkulær økonomi i forvejen", "Grundlægger af Genven, dansk B2B-markedsplads for cirkulær økonomi. Dyb domæneindsigt i regulering og materialestrømme."],
    [I.code, "Bygger selv produktet", "Har drevet hele Cirkel-build'et fra arkitektur til deploy — produktdybde uden at brænde kapital på et team endnu."],
  ];
  let by = 2.2;
  bio.forEach(([ic, h, b]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.4, y: by, w: 8.2, h: 1.4, fill: { color: TINT }, rectRadius: 0.1 });
    iconCircle(s, 4.65, by + 0.33, 0.78, MID, ic, 0.5);
    s.addText(h, { x: 5.65, y: by + 0.2, w: 6.7, h: 0.4, fontSize: 15.5, bold: true, color: INK, fontFace: HEAD });
    s.addText(b, { x: 5.65, y: by + 0.6, w: 6.8, h: 0.75, fontSize: 12.5, color: "3C4A43", fontFace: BODY, lineSpacingMultiple: 1.08 });
    by += 1.5;
  });
  pageNum(s, 13);

  // =========================================================
  // 14. CLOSE
  // =========================================================
  s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.shapes.OVAL, { x: 9.6, y: 3.4, w: 6.2, h: 6.2, fill: { color: MID, transparency: 80 } });
  s.addShape(pres.shapes.OVAL, { x: -1.6, y: -1.8, w: 4.8, h: 4.8, fill: { color: ACCENT, transparency: 88 } });
  iconCircle(s, 0.85, 1.4, 1.1, MID, I.recycle, 0.5);
  s.addText("Lad os lukke kredsløbet.", { x: 0.85, y: 2.9, w: 11, h: 1.0, fontSize: 44, bold: true, color: WHITE, fontFace: HEAD });
  s.addText("Det produkt er bygget. Markedet er tvunget af loven. Det der mangler, er den første pilot — og kapitalen til at lande den.",
    { x: 0.9, y: 4.05, w: 9.4, h: 1.0, fontSize: 16, color: "CFE3D8", fontFace: BODY, lineSpacingMultiple: 1.2 });

  s.addText([
    { text: "Michael Del Pilar Ambrosius", options: { bold: true, color: WHITE, breakLine: true } },
    { text: "Grundlægger, Cirkel", options: { color: "9FBBAE", breakLine: true } },
    { text: "[e-mail]   ·   [telefon]   ·   [website]", options: { color: ACCENT } },
  ], { x: 0.9, y: 5.7, w: 9, h: 1.1, fontSize: 14, fontFace: BODY, lineSpacingMultiple: 1.35 });

  await pres.writeFile({ fileName: "" + require("path").join(__dirname,"out","Cirkel_Investoroplaeg.pptx") + "" });
  console.log("deck written");
}
build();
