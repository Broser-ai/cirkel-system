#!/bin/bash
# scripts/clean-mtc.sh — [Fase 1 · Modul 1.3 / Isolation · Modul 20.2 / Hygiene]
# Erstatter MTC/NEXUS project-ID med <MTC_ID_FORBIDDEN> placeholder på tværs af repoet.
# Kør fra repo-roden. Idempotent.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "🧹 Renser MTC/NEXUS project-ID (tbuluvvqhrbgfcpoifjl) → <MTC_ID_FORBIDDEN>"

FILES_BEFORE=$(grep -rl "tbuluvvqhrbgfcpoifjl" . \
  --include="*.md" --include="*.ts" --include="*.tsx" \
  --include="*.cjs" --include="*.mjs" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=.next --exclude-dir=.vercel 2>/dev/null | wc -l)

echo "  Fandt $FILES_BEFORE filer med MTC-ref"

if [ "$FILES_BEFORE" -eq 0 ]; then
  echo "✅ Ingen MTC-refs. Nothing to do."
  exit 0
fi

grep -rl "tbuluvvqhrbgfcpoifjl" . \
  --include="*.md" --include="*.ts" --include="*.tsx" \
  --include="*.cjs" --include="*.mjs" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=.next --exclude-dir=.vercel \
  | xargs sed -i 's/tbuluvvqhrbgfcpoifjl/<MTC_ID_FORBIDDEN>/g'

FILES_AFTER=$(grep -rl "tbuluvvqhrbgfcpoifjl" . \
  --include="*.md" --include="*.ts" --include="*.tsx" \
  --include="*.cjs" --include="*.mjs" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=.next --exclude-dir=.vercel 2>/dev/null | wc -l)

if [ "$FILES_AFTER" -eq 0 ]; then
  echo "✅ MTC-ID renset fra $FILES_BEFORE fil(er). 0 refs tilbage."
else
  echo "❌ $FILES_AFTER filer har stadig MTC-ref efter kørsel. Manuel verifikation kræves."
  exit 1
fi
