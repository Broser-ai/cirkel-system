// extract-masters-full.mjs — kør: node extract-masters-full.mjs <sti-til-MasterTeamConsole.jsx>
// Udtrækker HVERT master/agent-objekt med ALLE felter → masters-roster.md + masters-roster.json
import { readFileSync, writeFileSync } from "node:fs"
import { parse } from "@babel/parser"          // npm i -D @babel/parser @babel/traverse
import _traverse from "@babel/traverse"
const traverse = _traverse.default

const file = process.argv[2]
const src = readFileSync(file, "utf8")
const ast = parse(src, { sourceType: "module", plugins: ["jsx"], errorRecovery: true })

const str = (n) => (n?.type === "StringLiteral" ? n.value : n?.type === "NumericLiteral" ? n.value : n?.type === "BooleanLiteral" ? n.value : null)
const arr = (n) => (n?.type === "ArrayExpression" ? n.elements.map(str).filter((x) => x !== null) : null)

// Saml ALLE skalar/array-felter fra et objekt (mister intet)
function readObject(node) {
  const o = {}
  for (const p of node.properties) {
    if (p.type !== "ObjectProperty" || !p.key) continue
    const k = p.key.name ?? p.key.value
    const v = p.value
    if (v.type === "ArrayExpression") o[k] = arr(v) ?? []
    else { const s = str(v); if (s !== null) o[k] = s }
  }
  return o
}

const masters = []
traverse(ast, {
  ObjectExpression(path) {
    const o = readObject(path.node)
    const flags = Object.keys(o).filter((k) => /^is.*(Master|Leader|Guru|Lead|Head|Chief)$/i.test(k))
    // Et master/agent-objekt: har navn + (tier | expertise | frameworks | role | et is*-flag)
    const isPerson = o.name && (o.tier || o.expertise || o.frameworks || o.role || o.title || flags.length)
    if (!isPerson) return
    o.__department = flags[0]?.replace(/^is|(Master|Leader|Guru|Lead|Head|Chief)$/g, "") || o.department || o.dept || "Ukategoriseret"
    o.__flags = flags
    masters.push(o)
  },
})

// dedup på navn+department
const seen = new Set()
const unique = masters.filter((m) => { const id = `${m.name}@${m.__department}`; if (seen.has(id)) return false; seen.add(id); return true })

const byDept = {}
for (const m of unique) (byDept[m.__department] ??= []).push(m)

// Skriv komplet JSON (alle felter bevaret)
writeFileSync("masters-roster.json", JSON.stringify({ count: unique.length, departments: byDept }, null, 2))

// Skriv komplet .md — ALT om hver master
let md = `# Master Gurus — komplet roster\n\n${unique.length} mestre · ${Object.keys(byDept).length} afdelinger · udtrukket fra ${file.split(/[\\/]/).pop()}\n\n`
for (const [dept, list] of Object.entries(byDept).sort()) {
  md += `\n## ${dept} (${list.length})\n\n`
  for (const m of list) {
    md += `### ${m.name}\n`
    const meta = []
    if (m.tier) meta.push(`**Tier:** ${m.tier}`)
    if (m.industry || m.branche) meta.push(`**Branche:** ${m.industry || m.branche}`)
    if (m.team || m.squad) meta.push(`**Team:** ${m.team || m.squad}`)
    if (m.role || m.title) meta.push(`**Rolle:** ${m.role || m.title}`)
    if (meta.length) md += meta.join(" · ") + "\n\n"
    if (m.bio) md += `${m.bio}\n\n`
    if (m.expertise?.length) md += `**Færdigheder:** ${m.expertise.join(", ")}\n\n`
    if (m.frameworks?.length) md += `**Frameworks:** ${m.frameworks.join(", ")}\n\n`
    // alle ØVRIGE felter (mister intet)
    const shown = new Set(["name","tier","industry","branche","team","squad","role","title","bio","expertise","frameworks","__department","__flags"])
    const rest = Object.entries(m).filter(([k]) => !shown.has(k) && !k.startsWith("__"))
    for (const [k, v] of rest) md += `**${k}:** ${Array.isArray(v) ? v.join(", ") : v}\n\n`
  }
}
writeFileSync("masters-roster.md", md)
console.log(`✅ ${unique.length} mestre · ${Object.keys(byDept).length} afdelinger → masters-roster.md + masters-roster.json`)
```
