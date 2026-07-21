// masters-to-agents.mjs
// Læser masters-roster.json (output fra extract-masters-full.mjs) og indsætter de
// CIRKEL-RELEVANTE masters som Claude Code-agenter i .claude/agents/.
// Resten parkeres i parked-agents/. Ingen eksterne deps.
//
// Kør:  node extract-masters-full.mjs <sti-til-MasterTeamConsole.jsx>   (laver roster)
//       node masters-to-agents.mjs [sti-til-masters-roster.json]        (laver agenter)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");                       // cirkel-team/
const OUT = join(ROOT, ".claude", "agents");
const PARKED = join(ROOT, "parked-agents");
mkdirSync(OUT, { recursive: true });
mkdirSync(PARKED, { recursive: true });

const rosterPath = process.argv[2] || join(process.cwd(), "masters-roster.json");
if (!existsSync(rosterPath)) {
  console.error(`\nFANDT IKKE ${rosterPath}`);
  console.error("Kør først:  node extract-masters-full.mjs <sti-til-MasterTeamConsole.jsx>");
  console.error("…eller giv stien:  node masters-to-agents.mjs <sti-til-masters-roster.json>\n");
  process.exit(1);
}

const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
const all = Object.values(roster.departments || {}).flat();

// --- Cirkel-relevans: nøgleord der gør en master nyttig for DETTE projekt ---
const KEYWORDS = [
  "backend","server","api","rest","graphql","database","postgres","sql","supabase","schema","rls",
  "auth","authentication","identity","mitid","oauth","sso",
  "security","secret","encryption","crypto","ledger","hash","integrity",
  "frontend","react","typescript","javascript","ui","ux","design","tailwind","vite","accessib","i18n","localization",
  "devops","deploy","deployment","vercel","ci","cd","docker","cloud","infra","infrastructure","observability","monitoring","logging",
  "qa","test","testing","verification","adversarial","performance","optimization","scalab",
  "ai","ml","llm","gemini","prompt","rag","vector","embedding","agent",
  "data","analytics","kpi","dashboard","etl",
  "compliance","gdpr","privacy","legal","regulation","epr","ppwr","esg","sustainab","circular","recycl","waste",
  "payment","billing","stripe","fintech","growth","product","architect","copy","content","marketing","conversion",
];

const slugify = (s) => String(s).toLowerCase()
  .replace(/æ/g,"ae").replace(/ø/g,"oe").replace(/å/g,"aa")
  .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);

function haystack(m) {
  return [m.__department, m.role, m.title, m.industry, m.branche, m.team, m.squad, m.bio,
    ...(m.expertise||[]), ...(m.frameworks||[])].filter(Boolean).join(" ").toLowerCase();
}
function score(m) {
  const h = haystack(m);
  const hits = KEYWORDS.filter((k) => h.includes(k));
  return { n: hits.length, hits: [...new Set(hits)].slice(0,6) };
}

const RULES = `## Ufravigelige regler (gælder dig altid)
1. Intet udføres før Michael har accepteret det — eksplicit "Accepteret".
2. Alt kan ændres — også design og funktioner — men intet uden hans accept.
3. Enhver ændring fremlægges FØRST som forslag/plan (diff eller preview). Vent på accept.
4. Én ændring ad gangen. Ingen bundling.
5. Hans Gemini-app og supabase_schema.sql er kanoniske; redesign foreslås, udføres aldrig uvarslet.
6. Cirkel har sit eget Supabase-projekt — rør ALDRIG det delte MTC/NEXUS (<MTC_ID_FORBIDDEN>).
7. Commit aldrig hemmeligheder. Dansk som standard; teknisk indhold på engelsk.`;

function agentMd(m, why) {
  const role = m.role || m.title || m.__department || "Master";
  const exp = (m.expertise||[]).slice(0,8);
  const fw = (m.frameworks||[]).slice(0,8);
  const desc = `${role}${m.industry||m.branche?` · ${m.industry||m.branche}`:""}. Cirkel-relevant: ${why.hits.join(", ")||"generel"}.`;
  return `---
name: master-${slugify(m.name)}
description: ${desc.replace(/\n/g," ").slice(0,180)}
tools: Read, Grep, Glob
model: sonnet
---

Du er **${m.name}**${m.tier?` (Tier: ${m.tier})`:""} — master/ekspert i Cirkel-projektet (cirkulær økonomi · Supabase + Vercel · kørt i Claude Code).
Afdeling: ${m.__department || "Ukategoriseret"}${role?` · Rolle: ${role}`:""}.

## Din mission
${m.bio || `Bidrag med din ekspertise (${role}) til at forbedre Cirkel — rådgiv, reviewer og foreslå.`}

## Adfærd
Du er **rådgivende som udgangspunkt** (read-only). Du reviewer, analyserer og anbefaler;
udførelse sker via en udførende master efter Michaels accept. Vil Michael have dig som
udførende, gives du redigeringsværktøjer eksplicit.

## Din ekspertise
${exp.length?exp.map(e=>"- "+e).join("\n"):"- "+role}
${fw.length?`\n**Frameworks:** ${fw.join(", ")}`:""}

## Gurus/masters fra andre chats — udvid her
<!-- INDSÆT EKSTRA PROMPT/VIDEN FRA ANDEN CHAT HER -->

${RULES}
`;
}

let inserted = 0, parked = 0;
const insertedList = [], parkedList = [];
for (const m of all) {
  if (!m?.name) continue;
  const why = score(m);
  const md = agentMd(m, why);
  if (why.n >= 1) { writeFileSync(join(OUT, `master-${slugify(m.name)}.md`), md); inserted++; insertedList.push(`${m.name} [${why.hits.join(", ")}]`); }
  else { writeFileSync(join(PARKED, `master-${slugify(m.name)}.md`), md); parked++; parkedList.push(m.name); }
}

console.log(`\nMasters i roster: ${all.length}`);
console.log(`✅ Indsat (Cirkel-relevante) → .claude/agents/: ${inserted}`);
insertedList.slice(0,40).forEach(s=>console.log("   + "+s));
console.log(`🅿️  Parkeret (ikke relevant nu) → parked-agents/: ${parked}`);
console.log(`\nJustér nøgleordene i KEYWORDS øverst for at ændre hvad der tæller som relevant.`);
