# Rotation — Firebase apiKey (task #5)

> **Denne guide er til dig selv**, Michael. Firebase-projektet hedder `genven`; nøglen ligger i `firebase-applet-config.json` linje 4 og starter med `AIza…`.
>
> **Vigtigt om Firebase Web API keys:** i modsætning til Supabase anon-key er Firebase Web API keys **ikke hemmelige på samme måde** — de er beregnet til at ligge i frontend-kode. Men de skal **restricted** (API-restrictions + auth-domain whitelist), ellers kan enhver bruge dem til at ramme dit Firebase-projekts kvota og potentielt spamme auth-endpoints.
>
> Rotation er valgfrit — restriction er obligatorisk.

---

## Kontekst

- **Fil:** `cirkel-system/firebase-applet-config.json` (ikke committet — er i `.gitignore` linje 15).
- **Nøgle-type:** Firebase Web API Key (AIza-prefix). Anvendes i browser til Firebase Auth, Firestore-klient og andre klient-SDK'er.
- **Projekt:** `genven` (per CLAUDE.md — den blev arvet fra AI Studio-eksporten).
- **Reel risiko uden restriction:**
  - Nogen kan bruge din nøgle til at ramme dit Firebase-projekts Auth-endpoint (kvota-misbrug, brute-force forsøg).
  - Nogen kan læse fra din Firestore hvis Firestore-rules er svage.
  - Nogen kan bruge din nøgle til at generere requests der belaster dit budget.

**Hvad CLAUDE.md siger:** "Den er eksponeret — overvej at rotere/begræns den, før repoet pushes offentligt."

---

## Anbefalet plan: restrict før rotate

Restriction alene er nok hvis nøglen er nu i .gitignore. Rotation er kun nødvendigt hvis:
- Nøglen er allerede pushed offentligt (fx git-history på GitHub).
- Du er ikke sikker på hvor den er blevet delt.
- Du vil have en ren start.

---

## Del A: Restrict (obligatorisk, 10 min)

### 1. Åbn Google Cloud Console (ikke Firebase Console)
- [ ] Gå til https://console.cloud.google.com
- [ ] Vælg projektet `genven` (samme project-id som i Firebase Console).
- [ ] Menu: **APIs & Services → Credentials**.

### 2. Find den lækkede API key
- [ ] I listen "API Keys" — find den der starter med `AIza…` og matcher den værdi der ligger i `firebase-applet-config.json`.
- [ ] Klik på nøglens navn.

### 3. Sæt Application restrictions
Vælg **HTTP referrers (web sites)** og tilføj:
- [ ] `https://din-produktions-url.com/*` (Vercel eller Coolify-URL)
- [ ] `https://*.vercel.app/*` (hvis du bruger preview-deployments)
- [ ] `http://localhost:3000/*` (dev)
- [ ] `http://localhost:5173/*` (Vite dev-server hvis du bruger den)

**Ingen wildcards som `*` uden domain** — det svarer til ingen restriction.

### 4. Sæt API restrictions
Vælg **Restrict key**, og vælg kun de APIs du faktisk bruger:
- [ ] `Identity Toolkit API` (Firebase Auth)
- [ ] `Cloud Firestore API` (hvis I bruger Firestore)
- [ ] `Firebase Installations API`
- [ ] `Firebase Remote Config API` (kun hvis brugt)

**Vælg IKKE:**
- Andre Google Cloud APIs (Maps, YouTube, etc.) — de har intet at gøre med Firebase Web SDK.

### 5. Gem og verificér
- [ ] Klik **Save**.
- [ ] Vent 2-5 min på propagering.
- [ ] Test app'en fra en godkendt URL — skal virke.
- [ ] Test med `curl` fra terminal (ikke godkendt origin) — skal fejle med `API key not valid for this application`:
```bash
curl "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<DIN_NØGLE>" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
```

---

## Del B: Rotate (valgfrit, 15 min)

Kun nødvendigt hvis nøglen kan være pushed offentligt eller delt uden for kontrol.

### 1. Opret ny key
- [ ] Google Cloud Console → **APIs & Services → Credentials → + CREATE CREDENTIALS → API key**.
- [ ] Kopiér den nye nøgle til 1Password (vault: Cirkel, item: "Firebase Web API key genven").

### 2. Anvend samme restrictions som i Del A
- [ ] HTTP referrers whitelist
- [ ] API restrictions til kun de Firebase APIs I bruger

### 3. Opdatér apps
- [ ] `firebase-applet-config.json`: udskift `apiKey` (denne fil er i .gitignore — ok at redigere lokalt).
- [ ] Verificér at ingen `.env`-filer eller andre config-filer indeholder den gamle nøgle:
```bash
grep -r "AIza" C:/Users/Ambro2/cirkel-system 2>/dev/null | grep -v node_modules
```
- [ ] Deploy-envs (Vercel, Coolify) — hvis de har `VITE_FIREBASE_API_KEY` eller lignende, opdatér.

### 4. Slet den gamle key
- [ ] Google Cloud Console → **APIs & Services → Credentials** → find den gamle `AIza…`-key.
- [ ] Menu: **Delete**.
- [ ] Bekræft.

### 5. Verificér at gammel key er død
```bash
curl "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<GAMMEL_NØGLE>" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
# Forventet: "API key not valid" eller "API key expired"
```

---

## Firestore rules — bonus check

Selv en perfekt-restricted API key beskytter ikke Firestore hvis rules er åbne. Se task #6 (Firestore users-collection: for åben `list`/`get`). Restriction på API-key + stramning af Firestore-rules = fuld beskyttelse.

Anbefaling: løs task #6 i samme sving som denne rotation.

---

## Ekstra: har nøglen været misbrugt?

- [ ] Google Cloud Console → **APIs & Services → Dashboard** → check request-count på Identity Toolkit API og Firestore API for de sidste 30 dage.
- [ ] Store spikes uden matchende brugere = mistænkeligt.
- [ ] Firebase Console → **Authentication → Users** → check om der er nyoprettede test-users du ikke kender.

---

## Luk task #5

- [ ] Restrict done — noter timestamp i 1Password-item.
- [ ] (Valgfrit) rotate done — noter ny key-ID og gammel key slettet.
- [ ] Marker task #5 som completed.

---

## Hvorfor står den ikke bare i .gitignore og glemmer det?

`.gitignore` forhindrer **fremtidige** commits. Den beskytter ikke mod:
- Hvis filen tidligere blev committet (tjek `git log --all --full-history -- firebase-applet-config.json` i cirkel-system).
- Hvis nogen (dig, en anden agent, en bruger) allerede har set nøglen og gemt den et andet sted.
- Hvis den er endt i backups, chatlogs, screenshots, docs.

Restriction i Cloud Console er den eneste garanterede beskyttelse.
