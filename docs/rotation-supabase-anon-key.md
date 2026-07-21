# Rotation — Supabase anon-key (task #4)

> Nøglen der skal roteres tilhører det **delte MTC/NEXUS-projekt** (project-ref begynder `tbulu…`). Cirkel må per CLAUDE.md rule #6 **ALDRIG ændre** det projekt — men den lækkede anon-key skal alligevel roteres, fordi den lå åbent i den gamle `Downloads/CIRKEL-EVERYTHING-v3.md` og kan være caret af enhver der har set filen.
>
> **Denne guide er til dig selv**, Michael. En anden session/agent må ikke udføre den — det ville bryde CLAUDE.md #6.

---

## Kontekst

- **Hvor lækkede:** `Downloads/CIRKEL-EVERYTHING-v3.md` linje 421 (anon-key JWT) og linje 487 (samme, i kodeblok).
- **Redaktion status:** Filen er i bid 1 kopieret til `cirkel-system/docs/CIRKEL-EVERYTHING-v3.md` med `[REDACTED — see 1Password]` og originalen slettet. Commit: `c306a08` i cirkel-system-repoet.
- **Nøgle-type:** Supabase **anon-key** (public JWT, `role: anon`). Ikke service-role. Den er designet til at være i frontend-kode og beskyttet af RLS.
- **Reel risiko:** Selv om anon-key skal være offentligt kendt, giver en lækket historisk nøgle enhver mulighed for at spam-teste RLS. Rotation forhindrer også, at nøgler tilfældigvis dukker op i git-history hvis nogen skulle push'e cirkel-system offentligt.

**Ekstra kontekst fra CLAUDE.md:** Cirkel skulle **ikke** bruge denne project-ref overhovedet. Rotation er derfor både en cleanup **og** en anledning til at bekræfte at Cirkel ikke længere peger på det delte projekt.

---

## Trin-for-trin

### 1. Bekræft ejerskab (2 min)
- [ ] Log ind på https://supabase.com/dashboard med den konto der ejer `tbulu…`-projektet (MTC/NEXUS ejer, ikke Cirkel).
- [ ] Bekræft at project-ref begynder med `tbulu` — hvis ikke, du er logget ind på det forkerte projekt.

### 2. Verificér at Cirkel IKKE bruger nøglen (5 min)
Kør i cirkel-system-mappen:
```bash
grep -r "tbulu" C:/Users/Ambro2/cirkel-system/src C:/Users/Ambro2/cirkel-system/api 2>/dev/null
grep -r "VITE_SUPABASE_URL" C:/Users/Ambro2/cirkel-system 2>/dev/null | grep -v node_modules
```
Forventet: `tbulu` findes kun i `docs/CIRKEL-EVERYTHING-v3.md` (redakteret) og ingen andre steder. `VITE_SUPABASE_URL` skal pege på Cirkels eget projekt, ikke det delte.

Hvis der er hits i `src/` eller `api/`: **stop og fix først** — Cirkel må ikke pege på det delte projekt.

### 3. Rotér JWT-secret i Supabase Dashboard (5 min)
- [ ] Vælg `tbulu…`-projektet i Dashboard.
- [ ] Menu: **Project Settings → API**.
- [ ] Find sektion **JWT Settings**.
- [ ] Klik **Roll JWT secret** (rød knap). Bekræft.
- [ ] Bemærk: dette invaliderer **alle** eksisterende anon- og service-role-nøgler for projektet.

### 4. Kopier de nye nøgler (2 min)
Under **Project API keys** dukker nye værdier op:
- [ ] `anon public` — kopiér til 1Password (vault: MTC/NEXUS, item: "Supabase anon key")
- [ ] `service_role secret` — kopiér til 1Password (samme vault, item: "Supabase service role")

**Del aldrig service_role i frontend eller docs.**

### 5. Opdatér alle apps der bruger den GAMLE nøgle (10-30 min)
Dette er den vigtigste del. Rotation brækker enhver app der brugte den gamle nøgle. Tjeklisten skal dække:

- [ ] MTC/NEXUS backend — env-vars på Vercel/Coolify/hvor det end kører
- [ ] MTC/NEXUS frontend — env-vars i deploy
- [ ] Evt. edge functions i Supabase-projektet
- [ ] Evt. andre projekter der har fået lov at kalde det delte projekt
- [ ] Cron-jobs / scheduled tasks der bruger service_role

**Cirkel:** ingen ændring nødvendig — Cirkel bruger sit eget Supabase-projekt.

### 6. Verificér at MTC/NEXUS stadig virker (5 min)
- [ ] Åbn MTC/NEXUS frontend, log ind, udfør en typisk operation
- [ ] Tjek Supabase logs i Dashboard for 401/403-fejl efter rotation-tidspunktet

### 7. Verificér at den gamle nøgle er død (2 min)
```bash
# Erstat <OLD_ANON_KEY> med den gamle værdi fra 1Password (hvis du gemte den)
# Eller ignorér dette trin hvis nøglen er slettet lokalt
curl -s "https://<MTC_ID_FORBIDDEN>.supabase.co/rest/v1/profiles?limit=1" \
  -H "apikey: <OLD_ANON_KEY>" \
  -H "Authorization: Bearer <OLD_ANON_KEY>"
# Forventet: 401 Invalid JWT
```

### 8. Luk task #4
- [ ] Marker task #4 som completed
- [ ] Notér rotation-timestamp i 1Password-item'et

---

## Rollback

Hvis noget brænder efter rotation og du skal tilbage:
- Supabase har **ingen** "un-roll" — den gamle secret er væk permanent.
- Fix er at opdatére de apps der stadig brugte den gamle nøgle med den nye.
- Har du glemt at kopiere den nye nøgle: rul JWT igen (nu får du en tredje ny nøgle). Alle gamle nøgler dør.

---

## Ekstra: separér Cirkel og MTC/NEXUS permanent

Hvis der stadig findes nogen krydskontamination:
1. Opret Cirkels **eget** Supabase-projekt (hvis det ikke allerede findes).
2. Kør `supabase_schema.sql` i Cirkels projekt.
3. Opdatér `VITE_SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` i Cirkels env-vars.
4. Verificér at Cirkel **kun** taler med sit eget projekt (grep + logs).

Dette er ikke rotation — det er separation. Men det er en god anledning til at gøre det når du alligevel er inde i Supabase-consollen.
