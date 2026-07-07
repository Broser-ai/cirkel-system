# CIRKEL — KOMPLET ARKITEKTUR, DESIGN & KODEBASE
## VERSION 3.0 — 13. april 2026
## ALT ER I DENNE FIL

> Upload denne fil til en ny Claude-chat og sig:
> "Jeg er Michael. Her er HELE Cirkel-projektet med al kode, arkitektur og design. Hjælp mig videre fra [trin X]."

---

# DEL 1: PROJEKT & PERSON

## Hvem er Michael
- Michael Del Pilar Ambrosius, Aarhus, Danmark
- Nybegynder i programmering — kræver micro-trin instruktioner
- Windows PC (brugernavn: Ambro2), iPhone til test
- VS Code + Expo Go + Git Bash
- Projekt: C:\Users\Ambro2\Desktop\cirkel-app\

## Hvad er Cirkel
Danmarks første cirkulære økonomi super-app.
7 aktørtyper i ét AI-drevet system: forbrugere, brands, retailers, freelance collectors, affaldsvirksomheder, kommuner, boligforeninger.

- Vision: En verden uden affald
- Mission: Giv alt en værdi
- Kerneflow: Scan → Se materialepass → Sortér korrekt → Få penge (MobilePay)
- Indtægt: Brand-abonnementer (4.900-14.900+ kr/md), transaktionsgebyr, CPA på rewards
- Konkurrenter: Bower (700k brugere, Google-backed), MyTOMRA
- Cirkel slår begge på 17 af 19 features

---

# DEL 2: STATUS & FREMSKRIDT (84% — 21/25 trin)

## ✅ Færdigt
- [x] Koncept & prototyper (7 brugertyper, 40+ features)
- [x] Brand identity (logo SVG/PNG, farver, typografi, PPTX guidelines)
- [x] Database schema komplet (15 tabeller med RLS)
- [x] App-kode v3 (React Native, login + 3 premium-skærme)
- [x] Website designet (Next.js, landing + B2B)
- [x] Digital pant-system design (3 modeller)
- [x] Verifikationssystem (5 niveauer)
- [x] Commerce & rewards design
- [x] B2B portal design (8 sektioner)
- [x] AI Dashboard design
- [x] Systemdokumentation
- [x] Alle designbeslutninger v2
- [x] Node.js v24.14.1, VS Code, Expo Go, Git v2.53.0 installeret
- [x] Cirkel-projekt oprettet på Desktop
- [x] App kører på iPhone via Expo Go
- [x] 3 premium-skærme (Scan, Wallet, Profil)
- [x] Supabase oprettet + tabeller kørt
- [x] Supabase forbundet til app
- [x] Login/signup skærm bygget
- [x] Splash screen (loading state)
- [x] Logout-funktion

## 🔲 Næste trin
- [ ] Test login (opret bruger + log ind via app)
- [ ] Ægte kamera stregkode-scanning
- [ ] Deploy website til Vercel
- [ ] Deploy app til TestFlight

---

# DEL 3: ARKITEKTUR

## System-arkitektur
```
┌─────────────────────────────────────────────┐
│              FORBRUGER-APP                    │
│         (React Native / Expo)                │
│  ┌─────────┬──────────┬───────────┐         │
│  │  Scan   │  Wallet  │  Profil   │         │
│  └────┬────┴────┬─────┴─────┬─────┘         │
│       │         │           │                │
│  ┌────┴─────────┴───────────┴─────┐         │
│  │      Custom Tab Navigation      │         │
│  │      (useState, IKKE React Nav) │         │
│  └──────────────┬──────────────────┘         │
└─────────────────┼───────────────────────────┘
                  │ HTTPS
┌─────────────────┼───────────────────────────┐
│           SUPABASE BACKEND                   │
│  ┌──────────────┴──────────────────┐        │
│  │        Auth (email/password)     │        │
│  │        → MitID (fase 2)          │        │
│  └──────────────┬──────────────────┘        │
│  ┌──────────────┴──────────────────┐        │
│  │     PostgreSQL Database          │        │
│  │  profiles, scans, products,      │        │
│  │  rewards, collectors, brands...  │        │
│  │  + Row Level Security (RLS)      │        │
│  └──────────────┬──────────────────┘        │
│  ┌──────────────┴──────────────────┐        │
│  │     Realtime + Storage           │        │
│  │  (fotos, push, live updates)     │        │
│  └─────────────────────────────────┘        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│              WEBSITE                         │
│         (Next.js / Vercel)                   │
│  Landing page + B2B portal + Brand signup    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│           EKSTERNE SERVICES                  │
│  MobilePay · MitID (Idura.eu) · Google      │
│  Vision API · Open Food Facts API ·         │
│  Dansk Retursystem API · PostGIS            │
└─────────────────────────────────────────────┘
```

## Data Flow — Scan
```
Bruger scanner stregkode
  → App sender EAN til Open Food Facts API
  → Returnerer: navn, brand, materiale, billede
  → App beregner: CO₂, vandaftryk, energi, pantværdi
  → Viser materialepass (forest green kort)
  → Bruger vælger verifikationsniveau
  → Scan gemmes i Supabase (scans-tabel)
  → Profil opdateres (total_scans, total_earned, total_co2_saved)
  → Belønning: DKK + Cirkel Points
```

## Data Flow — Login
```
Bruger åbner app
  → Splash screen (forest green + "cirkel" logo)
  → Check session (supabase.auth.getSession)
  → Hvis session: vis Scan-tab
  → Hvis ingen session: vis Login-skærm
  → Bruger opretter konto (email + password)
  → Supabase auth.signUp → opretter auth.users row
  → App inserter profiles row med bruger-ID
  → Bruger er logget ind → vis Scan-tab
```

## Data Flow — Collector Pickup
```
Bruger opretter afhentningsanmodning
  → Tager foto af materialer
  → Bekræfter med biometri + juridisk tekst (MitID-koblet)
  → Anmodning synlig for collectors i nærheden
  → Collector accepterer (ser foto, afstand, estimeret indtjening)
  → Bruger sætter materialer uden for dør
  → Collector ankommer, tager foto
  → AI sammenligner bruger-foto med collector-foto
  → Match: auto-godkend, begge betales
  → Mismatch: collector kan justere eller afvise
  → 3 advarsler = bruger-ban + MitID re-verifikation
```

## Sikkerhedsarkitektur
```
Lag 0: Email + password (Supabase Auth)
Lag 1: Biometri — Face ID / fingeraftryk (expo-local-authentication)
Lag 2: 6-cifret PIN (fallback)
Lag 3: MitID-verifikation (ved oprettelse, via Idura.eu OpenID Connect)
Lag 4: Row Level Security (RLS) i database
Lag 5: 7-lags svindl-forebyggelse (se nedenfor)
Lag 6: Progressiv tillid (nye brugere = lavere beløb)
```

---

# DEL 4: DESIGNSYSTEM (ÆNDR ALDRIG)

## Principper
1. SIMPELT OG CLEAN — ingen ekstra knapper, ingen rod
2. Scan → Resultat → Sortér → Penge (4 trin, aldrig mere)
3. Rigtige penge (DKK via MobilePay), IKKE gamification
4. Premium: Fraunces serif + DM Sans, Forest/Lime palette
5. En 70-årig og en 12-årig skal kunne bruge appen
6. Design er LÅST — nye features bag eksisterende knapper, ikke nye skærme

## Farvepalette
| Navn | Hex | Brug |
|------|-----|------|
| Forest Green | #0B3D2E | Primær, knapper, header |
| Lime | #C8F24A | Accent, CTA, beløb |
| Cream | #F5F1EB | Baggrund (ALDRIG pure white) |
| Charcoal | #1A1A1A | Tekst |
| Mint | #2DD4A0 | Succes, positive beløb |
| Blue | #4DA8DA | Info |
| Gold | #F5C542 | Loyalitet, points |
| Coral | #FF6B5A | Advarsel, streak |
| Purple | #A78BFA | AI/premium, collector |
| Orange | #FF8C42 | Collector |
| Teal | #20B2AA | Kommune/affald |

## Typografi
| Font | Brug |
|------|------|
| Fraunces (serif) | Overskrifter, tal, valuta |
| DM Sans (sans-serif) | Brødtekst, UI |
| JetBrains Mono | Data, kode |

## UI-regler
- Kort: white bg, 14px radius, 1px border #E8E4DE, INGEN shadow
- Baggrund: altid cream (#F5F1EB)
- Badges: 9px, bold, farve-bg med 15% opacity
- Knapper: Forest bg + Lime tekst (primær), eller Lime bg + Forest tekst
- Tab-bar: white, border-top #E8E4DE, Scan-tab har grøn cirkel-ikon
- fontWeight: ALTID 'bold' eller 'normal' — ALDRIG '600', '700', '800' (crasher)
- ALDRIG brug `gap` i StyleSheet — brug marginHorizontal/marginBottom

---

# DEL 5: BESLUTNINGER v2 (ALLE GODKENDT)

## Splash Screen
- Forest Green (#0B3D2E) fuld skærm
- Cirkel "C" ikon i lime (#C8F24A), centreret
- "cirkel" ordmærke i Fraunces, lime
- "Alt har en værdi." i DM Sans, cream, fade-in
- 2 sek, via Expo SplashScreen API

## Login & Sikkerhed (3 lag)
### Oprettelse:
1. Åbn app → Splash screen
2. "Opret konto" → Email + password
3. MitID-verifikation (via Idura.eu, OpenID Connect) — FASE 2
4. MitID returnerer: navn, CPR, fødselsdato
5. Vælg PIN + aktivér Face ID/fingeraftryk
6. Velkommen → Hjem

### Daglig login:
- Face ID / fingeraftryk (expo-local-authentication) + 6-cifret PIN fallback
- 30-dages session (som MobilePay)

### Sikkerhedsniveauer:
| Handling | Auth |
|----------|------|
| Scan & se info | Ingen ekstra |
| Bekræft sortering | Ingen ekstra |
| Opret afhentning | Biometri + juridisk tekst |
| Brug points i butik | QR + PIN/biometri |
| Udbetal MobilePay | Biometri + MitID (første gang) |
| Slet konto | MitID re-verifikation |

### MitID broker:
- Anbefalet: Idura.eu (certificeret, gratis test, OpenID Connect)
- Pris: 0,50-2 kr pr. verifikation
- MitID fra 13 år

## Digital Pant (3 modeller i rækkefølge)
### Model A — EAN-stregkode + digital token (dag 1):
- Scanner eksisterende stregkode
- Digital token: bruger-ID + tidsstempel + GPS + foto
- Verifikation: 5 niveauer (0,15-1,50 kr)
- KRÆVER INGEN BRAND-PARTNERE

### Model B — AI billedgenkendelse (fase 2, 3-6 md):
- Tag foto — ingen stregkode nødvendig
- Google Vision API → custom TensorFlow
- Virker med ALT affald

### Model C — Unikke QR-koder (fase 3, 6-12 md):
- Polytag-lignende unik-per-enhed QR
- Engangs-scan, UV-tag, GS1 Digital Link
- Kun for betalende brand-partnere

## Verifikationsniveauer
| Level | Metode | Belønning | Tillid |
|-------|--------|-----------|--------|
| 1 | Hjemme-foto | 0,15 kr + 2 CP | 60% |
| 2 | IoT-sensor | 0,35 kr + 4 CP | 80% |
| 3 | Drop Point | 0,75 kr + 6 CP | 95% |
| 4 | Pant-automat | 1,50 kr + 8 CP | 98% |
| 5 | Collector | 0,60 kr + 5 CP | 95% |

## Collector-afhentning (udvidet)
### Materialer:
| Type | Collector-sats |
|------|---------------|
| Pant (flasker/dåser) | Pantværdi minus brugers andel |
| Plast & metal | 5,20 kr/kg |
| Pap & papir | 2,10 kr/kg |
| Elektronik (WEEE) | 15,00 kr/kg |
| Møbler (trade-in) | Fast gebyr |
| Tøj | 3,20 kr/kg |

### Kontaktløs afhentning:
1. Bruger opretter anmodning (foto + beskrivelse)
2. Godkender med biometri + juridisk tekst (MitID-koblet)
3. Collector accepterer → bruger sætter ud
4. Collector tager foto ved ankomst (dobbelt foto-system)
5. AI sammenligner → match/mismatch håndtering

### Uoverensstemmelse:
| Situation | Handling |
|-----------|---------|
| Stemmer overens | Auto-godkend, begge betales |
| Mindre afvigelse | Collector markerer "færre" → justér beløb |
| Stor afvigelse | Collector afviser uden straf |
| Tomt/forkert | Bruger får advarsel |
| 3 advarsler | Midlertidig ban + MitID re-verifikation |

## Svindl-forebyggelse (7 lag)
1. AI foto-verifikation (Google Vision API)
2. GPS-geofence (scan kun nær registreret punkt)
3. Max 1 scan/produkt/bruger/dag
4. Købsverifikation (Coop/Nemlig — fase 2)
5. ML anomali-detektion (fase 2)
6. Community-rapportering
7. Progressiv tillid (nye brugere = lavere beløb)

## Commerce & Rewards
- Dual valuta: DKK + Cirkel Points (1 CP = 0,10 kr)
- 4-tier loyalitet: Bronze → Sølv → Guld → Diamant
- Rewards shop: 50+ partnere (Coop, Joe & The Juice, Matas, Biograf)
- Trade-in: +20% bonus for CP
- Give Back: Charity-donationer + skattefradrag

## GPS & Kort
- Live kort med afleveringspunkter (react-native-maps + Supabase PostGIS)
- Navigation til nærmeste punkt (åbn Google Maps)
- Fase 2: Live collector-positioner (som Wolt)
- Fase 2: Heatmap over nabolags-sortering

---

# DEL 6: B2B PORTAL (8 sektioner)

## Dashboard
- Overblik: aktive brugere, scanninger, CO₂ sparet, engagement
- Real-time data fra forbruger-app

## Product Passports (EU Digital Product Passport)
- Upload produktdata → auto-generér DPP
- QR-kode til emballage
- Fuld sporbarhed fra produktion til genbrug

## ESG & CO₂ (Scope 3, CSRD)
- Automatisk CO₂-beregning fra scanning-data
- CSRD-rapport generator
- Scope 3 rapportering

## Campaigns (self-serve)
- Brands opretter belønnings-kampagner
- "Scan 5 Arla-produkter → få 25 kr rabat"
- Real-time performance tracking

## Analytics
- Kommune-sorteringsdata
- Konkurrent-benchmark
- Demografisk indsigt
- Recycling-rates per material

## Compliance
- EPR auto-compliance
- EU DPP compliance
- Ecodesign Regulation
- CSRD rapportering
- Dansk miljølovgivning

## API (6 endpoints)
- GET /products — produktdata
- POST /scans — registrér scanning
- GET /analytics — hent statistik
- POST /campaigns — opret kampagne
- GET /compliance — compliance-status
- POST /webhooks — real-time notifikationer

## Pricing
| Plan | Pris | Features |
|------|------|----------|
| Starter | 4.900 kr/md | Dashboard, 1.000 scans |
| Growth | 14.900 kr/md | + Campaigns, Analytics, API |
| Enterprise | Custom | + Compliance, DPP, dedicated support |
| 30-dages gratis trial for alle |

---

# DEL 7: KONKURRENTANALYSE

| Feature | Cirkel | Bower | MyTOMRA |
|---------|--------|-------|---------|
| AI scanning (3 metoder) | ✅ | Kun stregkode | Kun RVM |
| Materialepass | ✅ | ❌ | ❌ |
| Rigtige DKK / MobilePay | ✅ | Points | PayPal |
| 4-niveaus loyalitet | ✅ | Badges | Badges |
| Rewards butik 50+ | ✅ | Begrænset | ❌ |
| Trade-in | ✅ | ❌ | ❌ |
| Give Back + skattefradrag | ✅ | ❌ | ❌ |
| Genbrug-markedsplads | ✅ | ❌ | ❌ |
| Digital produktpas (DPP) | ✅ | ❌ | ❌ |
| ESG & CO₂ rapportering | ✅ | ❌ | ❌ |
| EPR auto-compliance | ✅ | ❌ | ❌ |
| B2B self-serve portal | ✅ | Book demo | API only |
| Kommune-integration | ✅ | ❌ | ❌ |
| Collector-platform | ✅ | ❌ | ❌ |
| Boligforeninger | ✅ | ❌ | ❌ |
| Peer-to-peer afhentning | ✅ | ❌ | ❌ |
| 7-lags svindl-forebyggelse | ✅ | Begrænset | Hardware |

Polytag trial: 20.000 indløsninger, 93% positive, 71% foretrækker QR over automat.

---

# DEL 8: TEKNISKE CONSTRAINTS (VIGTIGT!)

Disse fejl er fundet og SKAL undgås:
1. `createBottomTabNavigator` crasher med "expected dynamic type 'boolean'" på Expo SDK 54 — BRUG CUSTOM TAB med useState
2. `gap` property i StyleSheet crasher — BRUG marginHorizontal/marginBottom
3. `fontWeight` SKAL være 'bold' eller 'normal' — ALDRIG '600', '700', '800'
4. Kode kopieret fra chat til VS Code bliver ofte afskåret — LEVER ALTID som downloadbar fil
5. PowerShell kræver: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
6. React Navigation pakken bruges IKKE — alt navigation er custom useState i App.tsx
7. Alle skærme er i ÉN App.tsx fil (simplere, ingen import-fejl)
8. Supabase import: `import { createClient } from '@supabase/supabase-js'`

---

# DEL 9: CREDENTIALS & CONFIG

## Supabase
- Project URL: [REDACTED — see 1Password]
- Anon Key: [REDACTED — see 1Password]
- Email Auth: ON
- Confirm Email: OFF (for test)
- Database tabeller oprettet: profiles + scans (med RLS)

## Filstruktur
```
C:\Users\Ambro2\Desktop\cirkel-app\
├── App.tsx                 ← HELE APPEN (login + 3 skærme, ~450 linjer)
├── app/
│   ├── screens/            ← (tomme, alt er i App.tsx)
│   └── services/
│       └── supabase.ts     ← Database-forbindelse (6 linjer)
├── app.json
├── index.ts
├── package.json
└── node_modules/
```

## Installerede pakker
- expo (SDK 54)
- @supabase/supabase-js
- @react-navigation/native (installeret men bruges IKKE pga crash)
- @react-navigation/bottom-tabs (installeret men bruges IKKE pga crash)
- react-native-screens
- react-native-safe-area-context

---

# DEL 10: TIDSPLAN

| Hvornår | Hvad |
|---------|------|
| Næste session | Test login + ægte scanning |
| Uge 1-2 | 10-20 testbrugere via TestFlight |
| Uge 2 | CVR, domæne (cirkel.dk), email |
| Uge 3 | App Store + Google Play launch (Aarhus) |
| Uge 4-6 | 100 brugere + første brand-partner |
| 6-8 uger total til første brand-partner |

---

# DEL 11: INSTRUKTIONER TIL CLAUDE

Når du arbejder med Michael:
- Han er NYBEGYNDER — forklar alt trin for trin med screenshots
- Giv ALTID downloadbare filer, IKKE copy-paste i chat (det mislykkes)
- Designet er LÅST — tilføj ALDRIG nye knapper eller ændr udseende
- Brug IKKE React Navigation — brug custom tabs med useState
- Brug IKKE `gap` i StyleSheet — brug margin i stedet
- Brug `fontWeight: 'bold'` ALDRIG '600' eller '800'
- Alt kode i ÉN App.tsx fil (ingen separate screen-filer)
- Supabase er forbundet — brug det direkte
- Michael kommunikerer på dansk, bruger ALL CAPS for vigtige ting
- Han sender screenshots efter hvert trin — vent på dem


---
---

# DEL 12: KOMPLET KODE — supabase.ts

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = '[REDACTED — see 1Password]';
const SUPABASE_ANON_KEY = '[REDACTED — see 1Password]';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

# DEL 13: KOMPLET KODE — App.tsx (login + 3 premium-skærme)

```typescript
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { supabase } from './app/services/supabase';

export default function App() {
  var [user, setUser] = useState(null as any);
  var [loading, setLoading] = useState(true);
  var [tab, setTab] = useState('scan');
  var [scanPhase, setScanPhase] = useState('ready');
  var bal = 247.5;
  var cp = 2140;

  useEffect(function () {
    supabase.auth.getSession().then(function (result: any) {
      var s = result.data.session;
      setUser(s ? s.user : null);
      setLoading(false);
    });
    var sub = supabase.auth.onAuthStateChange(function (_event: any, session: any) {
      setUser(session ? session.user : null);
    });
    return function () {
      sub.data.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B3D2E', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 36, fontWeight: 'bold', color: '#C8F24A' }}>cirkel</Text>
        <Text style={{ fontSize: 13, color: '#C8F24A80', marginTop: 6 }}>Alt har en vaerdi.</Text>
        <ActivityIndicator color="#C8F24A" style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen setUser={setUser} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F1EB' }}>
      <View style={{ flex: 1 }}>
        {tab === 'scan' && (
          <ScanTab phase={scanPhase} setPhase={setScanPhase} bal={bal} />
        )}
        {tab === 'wallet' && <WalletTab bal={bal} cp={cp} />}
        {tab === 'profil' && <ProfilTab bal={bal} user={user} />}
      </View>
      <View style={t.tabBar}>
        <TouchableOpacity
          onPress={function () {
            setTab('scan');
            setScanPhase('ready');
          }}
          style={t.tabItem}
        >
          <View style={[t.scanIcon, tab === 'scan' && t.scanIconActive]}>
            <Text style={{ fontSize: 20 }}>📸</Text>
          </View>
          <Text style={[t.tabLabel, tab === 'scan' && t.tabLabelActive]}>Scan</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={function () { setTab('wallet'); }} style={t.tabItem}>
          <Text style={{ fontSize: 20 }}>💰</Text>
          <Text style={[t.tabLabel, tab === 'wallet' && t.tabLabelActive]}>Wallet</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={function () { setTab('profil'); }} style={t.tabItem}>
          <Text style={{ fontSize: 20 }}>👤</Text>
          <Text style={[t.tabLabel, tab === 'profil' && t.tabLabelActive]}>Profil</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function LoginScreen(props: any) {
  var [email, setEmail] = useState('');
  var [password, setPassword] = useState('');
  var [isSignUp, setIsSignUp] = useState(false);
  var [loading, setLoading] = useState(false);
  var [name, setName] = useState('');

  var handleAuth = async function () {
    if (!email || !password) {
      Alert.alert('Fejl', 'Udfyld email og adgangskode');
      return;
    }
    setLoading(true);
    if (isSignUp) {
      var result = await supabase.auth.signUp({
        email: email,
        password: password,
      });
      if (result.error) {
        Alert.alert('Fejl', result.error.message);
      } else if (result.data.user) {
        await supabase.from('profiles').insert({
          id: result.data.user.id,
          full_name: name || 'Cirkel Bruger',
          email: email,
        });
        Alert.alert('Velkommen til Cirkel!', 'Din konto er oprettet.');
      }
    } else {
      var result2 = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (result2.error) {
        Alert.alert('Fejl', result2.error.message);
      }
    }
    setLoading(false);
  };

  return (
    <View style={login.container}>
      <View style={login.top}>
        <Text style={login.logo}>cirkel</Text>
        <Text style={login.slogan}>Alt har en vaerdi.</Text>
      </View>

      <View style={login.form}>
        <Text style={login.title}>{isSignUp ? 'Opret konto' : 'Log ind'}</Text>

        {isSignUp && (
          <TextInput
            style={login.input}
            placeholder="Dit navn"
            placeholderTextColor="#8A8A7A"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={login.input}
          placeholder="Email"
          placeholderTextColor="#8A8A7A"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={login.input}
          placeholder="Adgangskode"
          placeholderTextColor="#8A8A7A"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={true}
        />

        <TouchableOpacity
          style={login.btn}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0B3D2E" />
          ) : (
            <Text style={login.btnText}>
              {isSignUp ? 'Opret konto' : 'Log ind'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={function () { setIsSignUp(!isSignUp); }}
          style={{ marginTop: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#C8F24A', fontSize: 14 }}>
            {isSignUp ? 'Har allerede en konto? Log ind' : 'Ny bruger? Opret konto'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ScanTab(props: any) {
  var phase = props.phase;
  var setPhase = props.setPhase;
  var bal = props.bal;

  if (phase === 'ready') {
    return (
      <View style={s.container}>
        <View style={s.top}>
          <Text style={{ fontSize: 14, color: '#8A8A7A' }}>Hej! 👋</Text>
          <Text style={s.bigTitle}>Scan din emballage</Text>
          <Text style={{ fontSize: 14, color: '#8A8A7A', textAlign: 'center', marginTop: 6 }}>
            Peg kameraet mod stregkoden{'\n'}eller tag et foto
          </Text>
        </View>
        <TouchableOpacity style={s.scanBtn} onPress={function () { setPhase('loading'); }}>
          <Text style={{ fontSize: 48 }}>📸</Text>
          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#C8F24A', marginTop: 6 }}>
            Tryk for at scanne
          </Text>
        </TouchableOpacity>
        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Text style={s.statVal}>{bal} kr</Text>
            <Text style={s.statLbl}>Optjent</Text>
          </View>
          <View style={{ width: 1, backgroundColor: '#E8E4DE' }} />
          <View style={s.statItem}>
            <Text style={s.statVal}>892</Text>
            <Text style={s.statLbl}>Scanninger</Text>
          </View>
          <View style={{ width: 1, backgroundColor: '#E8E4DE' }} />
          <View style={s.statItem}>
            <Text style={s.statVal}>127 kg</Text>
            <Text style={s.statLbl}>CO₂ sparet</Text>
          </View>
        </View>
      </View>
    );
  }

  if (phase === 'loading') {
    setTimeout(function () { setPhase('result'); }, 1500);
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a1f16' }}>
        <Text style={{ fontSize: 48 }}>🧠</Text>
        <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#C8F24A', marginTop: 12 }}>
          AI analyserer...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 30 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#0B3D2E', marginBottom: 12 }}>Fundet!</Text>

      <View style={s.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0B3D2E' }}>Arla® Skyr Naturel 450g</Text>
            <Text style={{ fontSize: 11, color: '#8A8A7A', marginTop: 3 }}>PP5 plast · EAN: 5711953068515</Text>
          </View>
          <View style={{ backgroundColor: '#2DD4A020', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#2DD4A0' }}>A+</Text>
          </View>
        </View>
      </View>

      <View style={s.passport}>
        <Text style={{ fontSize: 9, letterSpacing: 1.5, color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>AI MATERIALEPASS</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={s.passItem}><Text style={{ fontSize: 14 }}>🌍</Text><Text style={s.passV}>42g</Text><Text style={s.passL}>CO₂</Text></View>
          <View style={s.passItem}><Text style={{ fontSize: 14 }}>💧</Text><Text style={s.passV}>1.2L</Text><Text style={s.passL}>Vand</Text></View>
          <View style={s.passItem}><Text style={{ fontSize: 14 }}>⚡</Text><Text style={s.passV}>0.8kWh</Text><Text style={s.passL}>Energi</Text></View>
          <View style={s.passItem}><Text style={{ fontSize: 14 }}>💰</Text><Text style={s.passV}>0,35kr</Text><Text style={s.passL}>Pant</Text></View>
        </View>
        <View style={{ marginTop: 10 }}>
          <View style={s.passRow}><Text style={s.passK}>Materiale</Text><Text style={s.passVV}>Polypropylen PP5</Text></View>
          <View style={s.passRow}><Text style={s.passK}>Genanvendeligt</Text><Text style={s.passVV}>100%</Text></View>
          <View style={s.passRow}><Text style={s.passK}>Producent</Text><Text style={s.passVV}>Arla Foods, Viby</Text></View>
          <View style={s.passRow}><Text style={s.passK}>Emballage</Text><Text style={s.passVV}>18g</Text></View>
          <View style={s.passRow}><Text style={s.passK}>Cirkulaer-score</Text><Text style={s.passVV}>92/100</Text></View>
          <View style={s.passRow}><Text style={s.passK}>EPR</Text><Text style={s.passVV}>Registreret ✓</Text></View>
        </View>
      </View>

      <View style={s.sortCard}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#0B3D2E', letterSpacing: 1 }}>SORTERING — AARHUS KOMMUNE</Text>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#0B3D2E', marginTop: 4 }}>♻️ Plastik (haard)</Text>
        <Text style={{ fontSize: 12, color: '#8A8A7A', marginTop: 4 }}>Skyl, flad, laeg i plastik-beholderen</Text>
      </View>

      <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#8A8A7A', letterSpacing: 1, marginBottom: 6 }}>AFLEVER & VERIFICER</Text>

      <TouchableOpacity style={s.verifyRow} onPress={function () { Alert.alert('🎉', '+0,15 kr +2 CP'); setPhase('ready'); }}>
        <Text style={{ fontSize: 11 }}>📸 Hjemme-foto</Text>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 11, fontWeight: 'bold', color: '#8A8A7A' }}>+0,15 kr +2 CP</Text><Text style={{ fontSize: 8, color: '#8A8A7A' }}>Tillid: 60%</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={s.verifyRow} onPress={function () { Alert.alert('🎉', '+0,35 kr +4 CP'); setPhase('ready'); }}>
        <Text style={{ fontSize: 11 }}>📡 IoT-sensor</Text>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 11, fontWeight: 'bold', color: '#4DA8DA' }}>+0,35 kr +4 CP</Text><Text style={{ fontSize: 8, color: '#8A8A7A' }}>Tillid: 80%</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={s.verifyRow} onPress={function () { Alert.alert('🎉', '+0,75 kr +6 CP'); setPhase('ready'); }}>
        <Text style={{ fontSize: 11 }}>📦 Drop Point</Text>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 11, fontWeight: 'bold', color: '#2DD4A0' }}>+0,75 kr +6 CP</Text><Text style={{ fontSize: 8, color: '#8A8A7A' }}>Tillid: 95%</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={s.verifyRow} onPress={function () { Alert.alert('🎉', '+1,50 kr +8 CP'); setPhase('ready'); }}>
        <Text style={{ fontSize: 11 }}>🏧 Pant-automat</Text>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 11, fontWeight: 'bold', color: '#2DD4A0' }}>+1,50 kr +8 CP</Text><Text style={{ fontSize: 8, color: '#8A8A7A' }}>Tillid: 98%</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={s.verifyRow} onPress={function () { Alert.alert('🎉', '+0,60 kr +5 CP'); setPhase('ready'); }}>
        <Text style={{ fontSize: 11 }}>🚴 Collector</Text>
        <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 11, fontWeight: 'bold', color: '#A78BFA' }}>+0,60 kr +5 CP</Text><Text style={{ fontSize: 8, color: '#8A8A7A' }}>Tillid: 95%</Text></View>
      </TouchableOpacity>

      <TouchableOpacity onPress={function () { setPhase('ready'); }} style={{ alignItems: 'center', padding: 12, marginTop: 8 }}>
        <Text style={{ color: '#8A8A7A', fontSize: 13 }}>← Scan en anden</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function WalletTab(props: any) {
  var bal = props.bal;
  var cp = props.cp;

  return (
    <ScrollView style={s.container}>
      <View style={s.walletCard}>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Din saldo</Text>
        <Text style={{ fontSize: 38, fontWeight: 'bold', color: '#C8F24A', marginTop: 2 }}>{bal.toFixed(2)} kr</Text>
        <Text style={{ fontSize: 13, color: '#F5C542', marginTop: 6 }}>{cp} Cirkel Points = {Math.round(cp * 0.1)} kr</Text>
        <TouchableOpacity style={s.payBtn}>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#0B3D2E' }}>Udbetal til MobilePay →</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.sectionLabel}>Brug dine points</Text>
      <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        <View style={s.offerCard}><Text style={{ fontSize: 26 }}>🛒</Text><Text style={s.offerName}>Coop</Text><Text style={s.offerDesc}>50 kr rabat</Text><Text style={s.offerCost}>500 CP</Text></View>
        <View style={s.offerCard}><Text style={{ fontSize: 26 }}>☕</Text><Text style={s.offerName}>Kaffe</Text><Text style={s.offerDesc}>Gratis</Text><Text style={s.offerCost}>200 CP</Text></View>
        <View style={s.offerCard}><Text style={{ fontSize: 26 }}>🎬</Text><Text style={s.offerName}>Biograf</Text><Text style={s.offerDesc}>1 billet</Text><Text style={s.offerCost}>800 CP</Text></View>
        <View style={s.offerCard}><Text style={{ fontSize: 26 }}>🌳</Text><Text style={s.offerName}>Trae</Text><Text style={s.offerDesc}>Plant 1</Text><Text style={s.offerCost}>100 CP</Text></View>
      </ScrollView>

      <Text style={s.sectionLabel}>Seneste</Text>
      <View style={s.txRow}><View style={{ flex: 1 }}><Text style={{ fontSize: 13 }}>Plastik sorteret</Text><Text style={{ fontSize: 10, color: '#8A8A7A', marginTop: 2 }}>I dag</Text></View><Text style={s.txAmount}>+0,75 kr</Text></View>
      <View style={s.txRow}><View style={{ flex: 1 }}><Text style={{ fontSize: 13 }}>Daase scannet</Text><Text style={{ fontSize: 10, color: '#8A8A7A', marginTop: 2 }}>I dag</Text></View><Text style={s.txAmount}>+0,15 kr</Text></View>
      <View style={s.txRow}><View style={{ flex: 1 }}><Text style={{ fontSize: 13 }}>Bonus: 10 scanninger!</Text><Text style={{ fontSize: 10, color: '#8A8A7A', marginTop: 2 }}>I gaar</Text></View><Text style={s.txAmount}>+2,00 kr</Text></View>
      <View style={s.txRow}><View style={{ flex: 1 }}><Text style={{ fontSize: 13 }}>Glasflaske</Text><Text style={{ fontSize: 10, color: '#8A8A7A', marginTop: 2 }}>Mandag</Text></View><Text style={s.txAmount}>+0,15 kr</Text></View>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

function ProfilTab(props: any) {
  var bal = props.bal;
  var user = props.user;

  var handleLogout = async function () {
    await supabase.auth.signOut();
  };

  return (
    <ScrollView style={s.container}>
      <View style={{ alignItems: 'center', marginBottom: 20 }}>
        <View style={s.avatar}><Text style={{ fontSize: 32 }}>👤</Text></View>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#0B3D2E', marginTop: 8 }}>
          {user.email}
        </Text>
        <View style={{ marginTop: 8, backgroundColor: '#F5C54220', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#F5C542' }}>⭐ Guld-medlem · Level 12</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>Din effekt</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={s.statCard}><Text style={{ fontSize: 18 }}>📸</Text><Text style={s.statCardVal}>892</Text><Text style={s.statCardLbl}>Scanninger</Text></View>
        <View style={s.statCard}><Text style={{ fontSize: 18 }}>🌍</Text><Text style={s.statCardVal}>127 kg</Text><Text style={s.statCardLbl}>CO₂ sparet</Text></View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        <View style={s.statCard}><Text style={{ fontSize: 18 }}>💰</Text><Text style={s.statCardVal}>{bal} kr</Text><Text style={s.statCardLbl}>Optjent</Text></View>
        <View style={s.statCard}><Text style={{ fontSize: 18 }}>🔥</Text><Text style={s.statCardVal}>14 dage</Text><Text style={s.statCardLbl}>Streak</Text></View>
      </View>

      <Text style={s.sectionLabel}>Indstillinger</Text>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>🏛️ Min kommune — Aarhus</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>💳 MobilePay — Ikke tilsluttet</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>🔔 Notifikationer — Til</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>🌐 Sprog — Dansk</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>💬 Hjaelp & feedback</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>
      <View style={s.settingRow}><Text style={{ fontSize: 14 }}>ℹ️ Om Cirkel v1.0</Text><Text style={{ color: '#8A8A7A' }}>→</Text></View>

      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={{ fontSize: 13, color: '#FF6B5A' }}>Log ud</Text>
      </TouchableOpacity>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

var login = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B3D2E' },
  top: { alignItems: 'center', paddingTop: 100, marginBottom: 40 },
  logo: { fontSize: 42, fontWeight: 'bold', color: '#C8F24A' },
  slogan: { fontSize: 14, color: '#C8F24A80', marginTop: 6 },
  form: { flex: 1, backgroundColor: '#F5F1EB', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 30, paddingTop: 36 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0B3D2E', marginBottom: 20 },
  input: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, fontSize: 15, borderWidth: 1, borderColor: '#E8E4DE', marginBottom: 12, color: '#1A1A1A' },
  btn: { backgroundColor: '#C8F24A', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 8 },
  btnText: { fontSize: 16, fontWeight: 'bold', color: '#0B3D2E' },
});

var t = StyleSheet.create({
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E8E4DE', backgroundColor: '#FFFFFF', paddingBottom: 20, paddingTop: 6 },
  tabItem: { flex: 1, alignItems: 'center' },
  scanIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(11,61,46,0.1)', alignItems: 'center', justifyContent: 'center' },
  scanIconActive: { backgroundColor: '#0B3D2E' },
  tabLabel: { fontSize: 10, color: '#8A8A7A', marginTop: 2 },
  tabLabelActive: { color: '#0B3D2E', fontWeight: 'bold' },
});

var s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F1EB', padding: 20, paddingTop: 50 },
  bigTitle: { fontSize: 26, fontWeight: 'bold', color: '#0B3D2E' },
  top: { alignItems: 'center', marginBottom: 28 },
  scanBtn: { width: 170, height: 170, borderRadius: 85, backgroundColor: '#0B3D2E', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 36, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#E8E4DE' },
  statItem: { alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: 'bold', color: '#0B3D2E' },
  statLbl: { fontSize: 10, color: '#8A8A7A', marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E8E4DE', marginBottom: 8 },
  passport: { borderRadius: 14, padding: 14, backgroundColor: '#0B3D2E', marginBottom: 8 },
  passItem: { flex: 1, alignItems: 'center', padding: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, marginHorizontal: 2 },
  passV: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF', marginTop: 3 },
  passL: { fontSize: 8, color: 'rgba(255,255,255,0.3)' },
  passRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  passK: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  passVV: { fontSize: 10, color: '#FFFFFF', fontWeight: 'bold' },
  sortCard: { borderRadius: 12, padding: 12, backgroundColor: 'rgba(200,242,74,0.08)', borderWidth: 1, borderColor: 'rgba(200,242,74,0.2)', marginBottom: 12 },
  verifyRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 10, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E4DE', marginBottom: 4, alignItems: 'center' },
  walletCard: { backgroundColor: '#0B3D2E', borderRadius: 18, padding: 20, marginBottom: 20 },
  payBtn: { backgroundColor: '#C8F24A', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14 },
  sectionLabel: { fontSize: 12, fontWeight: 'bold', color: '#8A8A7A', letterSpacing: 1, marginBottom: 8 },
  offerCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginRight: 10, width: 105, alignItems: 'center', borderWidth: 1, borderColor: '#E8E4DE' },
  offerName: { fontSize: 12, fontWeight: 'bold', marginTop: 6 },
  offerDesc: { fontSize: 9, color: '#8A8A7A', marginTop: 2 },
  offerCost: { fontSize: 10, fontWeight: 'bold', color: '#0B3D2E', marginTop: 6 },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E8E4DE' },
  txAmount: { fontSize: 14, fontWeight: 'bold', color: '#2DD4A0' },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(11,61,46,0.06)', alignItems: 'center', justifyContent: 'center' },
  statCard: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E8E4DE' },
  statCardVal: { fontSize: 17, fontWeight: 'bold', color: '#0B3D2E', marginTop: 4 },
  statCardLbl: { fontSize: 9, color: '#8A8A7A', marginTop: 2 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#E8E4DE' },
  logoutBtn: { marginTop: 20, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#FF6B5A40', alignItems: 'center' },
});
```

---

# DEL 14: KOMPLET KODE — Database Schema (fuld version, 15 tabeller)

```sql
-- ============================================
-- CIRKEL DATABASE SCHEMA
-- Kør dette i Supabase → SQL Editor
-- ============================================

-- ┌─────────────────────────────────┐
-- │  BRUGERE & AUTH                 │
-- └─────────────────────────────────┘

-- Brugerprofiler (udvidelse af Supabase auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT DEFAULT 'Aarhus',
  municipality TEXT DEFAULT 'Aarhus Kommune',
  
  -- Wallet
  balance_kr DECIMAL(10,2) DEFAULT 0,      -- Kontant saldo i kr
  cirkel_points INTEGER DEFAULT 0,          -- Cirkel Points (CP)
  
  -- Loyalitet
  level INTEGER DEFAULT 1,                  -- Nuværende level
  xp INTEGER DEFAULT 0,                     -- Experience points
  tier TEXT DEFAULT 'bronze',               -- bronze/silver/gold/diamond
  streak_days INTEGER DEFAULT 0,            -- Aktuel streak
  
  -- Stats
  total_scans INTEGER DEFAULT 0,
  total_co2_saved DECIMAL(8,2) DEFAULT 0,   -- i gram
  total_items_recycled INTEGER DEFAULT 0,
  
  -- Rolle
  role TEXT DEFAULT 'consumer',             -- consumer/collector/brand_admin/retailer_admin/muni_admin/housing_admin/waste_admin
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  PRODUKTER & MATERIALER         │
-- └─────────────────────────────────┘

-- Produktdatabase (fra EAN-stregkoder)
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ean_code TEXT UNIQUE,                     -- EAN/UPC stregkode
  name TEXT NOT NULL,
  brand TEXT,
  brand_id UUID REFERENCES brands(id),
  
  -- Materialepass
  material_type TEXT,                       -- PP5, PET, glas, aluminium, pap...
  material_subtype TEXT,                    -- hård plast, blød plast...
  weight_grams DECIMAL(8,2),               -- Emballagevægt
  recyclable BOOLEAN DEFAULT true,
  recyclability_pct INTEGER DEFAULT 100,    -- 0-100%
  
  -- Miljødata (AI-beregnet)
  co2_grams DECIMAL(8,2),                  -- CO₂-aftryk
  water_liters DECIMAL(8,2),               -- Vandforbrug
  energy_kwh DECIMAL(8,4),                 -- Energiforbrug
  
  -- Scoring
  circularity_score INTEGER,               -- 0-100
  
  -- Pant
  deposit_kr DECIMAL(4,2) DEFAULT 0,       -- Pantværdi
  deposit_type TEXT,                        -- A, B, C eller null
  
  -- Sortering
  sort_category TEXT,                       -- "plastik_haard", "metal", "glas"...
  sort_instruction TEXT,                    -- "Skyl, flad, læg i plastik-beholderen"
  
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  SCANNINGER                     │
-- └─────────────────────────────────┘

-- Hver scanning en bruger laver
CREATE TABLE scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  product_id UUID REFERENCES products(id),
  
  -- Scanning-metode
  scan_method TEXT NOT NULL,                -- 'barcode', 'qr', 'ai_photo'
  
  -- Data
  ean_code TEXT,
  photo_url TEXT,                           -- Foto af emballagen
  ai_material_result TEXT,                  -- AI-genkendelsesresultat
  ai_confidence DECIMAL(3,2),              -- 0.00-1.00
  
  -- Lokation
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  
  -- Verifikation
  verification_level INTEGER DEFAULT 1,     -- 1=foto, 2=IoT, 3=drop_point, 4=automat, 5=collector
  verification_photo_url TEXT,
  verified_at TIMESTAMPTZ,
  
  -- Belønning
  reward_kr DECIMAL(6,2) DEFAULT 0,
  reward_cp INTEGER DEFAULT 0,
  reward_xp INTEGER DEFAULT 0,
  
  -- Sortering
  sort_category TEXT,
  municipality TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  BRANDS (B2B)                   │
-- └─────────────────────────────────┘

CREATE TABLE brands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  
  -- B2B tier
  plan TEXT DEFAULT 'starter',              -- starter/growth/enterprise
  
  -- Scores
  circularity_score INTEGER DEFAULT 50,     -- 0-100
  total_scans INTEGER DEFAULT 0,
  sorting_rate DECIMAL(5,2) DEFAULT 0,      -- Procent korrekt sorteret
  co2_saved_kg DECIMAL(10,2) DEFAULT 0,
  
  -- EPR
  epr_registered BOOLEAN DEFAULT false,
  epr_report_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  KAMPAGNER                      │
-- └─────────────────────────────────┘

CREATE TABLE campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES brands(id),
  
  title TEXT NOT NULL,
  description TEXT,
  
  -- Type
  type TEXT DEFAULT 'scan_challenge',       -- scan_challenge, sort_challenge, trade_in, give_back
  
  -- Mål
  target_scans INTEGER,
  current_scans INTEGER DEFAULT 0,
  
  -- Belønning
  reward_type TEXT,                          -- 'kr', 'cp', 'discount', 'product'
  reward_value DECIMAL(8,2),
  reward_description TEXT,
  
  -- Periode
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',              -- draft/live/ended
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  TRANSAKTIONER (WALLET)         │
-- └─────────────────────────────────┘

CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  type TEXT NOT NULL,                       -- 'scan_reward', 'deposit', 'shop_purchase', 'mobilepay_withdrawal', 'donation', 'trade_in', 'partner_discount'
  
  amount_kr DECIMAL(8,2) DEFAULT 0,
  amount_cp INTEGER DEFAULT 0,
  
  description TEXT,
  
  -- Reference
  scan_id UUID REFERENCES scans(id),
  campaign_id UUID REFERENCES campaigns(id),
  shop_item_id UUID REFERENCES shop_items(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  REWARDS BUTIK                  │
-- └─────────────────────────────────┘

CREATE TABLE shop_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  partner_name TEXT NOT NULL,               -- "Coop", "Joe & The Juice"
  title TEXT NOT NULL,                      -- "50 kr rabatkupon"
  description TEXT,
  image_url TEXT,
  
  -- Pris
  price_cp INTEGER,                         -- Pris i Cirkel Points
  price_kr DECIMAL(8,2),                    -- Alternativ pris i kr
  
  -- Værdi
  savings_kr DECIMAL(8,2),                  -- Hvad brugeren sparer
  
  category TEXT,                            -- 'dagligvarer', 'mad_drikke', 'oplevelser', 'baeredygtig', 'gavekort'
  
  -- Tilgængelighed
  tier_required TEXT DEFAULT 'bronze',       -- Minimum tier
  stock INTEGER,                            -- Antal tilgængelige (null = ubegrænset)
  active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  GENBRUG-MARKEDSPLADS           │
-- └─────────────────────────────────┘

CREATE TABLE reuse_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  title TEXT NOT NULL,
  description TEXT,
  photo_urls TEXT[],                        -- Array af billeder
  
  category TEXT,                            -- 'mobler', 'elektronik', 'toj', 'boger', 'legetoj', 'sport'
  condition TEXT,                           -- 'som_ny', 'god', 'ok', 'slidt'
  
  -- Pris
  price_type TEXT DEFAULT 'free',           -- 'free', 'kr', 'cp', 'trade'
  price_amount DECIMAL(8,2),
  
  -- Lokation
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  neighborhood TEXT,
  
  status TEXT DEFAULT 'active',             -- active/reserved/completed/expired
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  AFLEVERINGSPUNKTER             │
-- └─────────────────────────────────┘

CREATE TABLE drop_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  name TEXT NOT NULL,
  type TEXT NOT NULL,                       -- 'pant_automat', 'genbrugsstation', 'drop_point', 'tekstil', 'batteri', 'collector'
  
  address TEXT,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  
  -- Status
  accepts TEXT[],                           -- ['plast', 'metal', 'glas', 'pap', 'tekstil', 'elektronik', 'farligt']
  fill_level INTEGER,                       -- 0-100 (hvis IoT-tilsluttet)
  wait_time_minutes INTEGER,
  
  verification_level INTEGER DEFAULT 3,     -- Standard verifikationsniveau
  
  opening_hours JSONB,
  municipality TEXT,
  
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  HJEMME-BEHOLDERE               │
-- └─────────────────────────────────┘

CREATE TABLE home_bins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  bin_type TEXT NOT NULL,                   -- 'restaffald', 'plast_metal', 'papir_pap', 'glas', 'farligt', 'mad', 'tekstil'
  
  -- Lokation (for geofence-verifikation)
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  
  photo_url TEXT,                           -- Foto af beholderen (verificering)
  verified BOOLEAN DEFAULT false,
  
  -- IoT sensor (valgfrit)
  has_sensor BOOLEAN DEFAULT false,
  sensor_id TEXT,
  fill_level INTEGER DEFAULT 0,            -- 0-100
  last_emptied TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  GIVE BACK & TRADE-IN           │
-- └─────────────────────────────────┘

CREATE TABLE trade_ins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  category TEXT NOT NULL,                   -- 'elektronik', 'toj', 'mobler', 'boger', 'legetoj', 'sport'
  title TEXT NOT NULL,
  description TEXT,
  photo_urls TEXT[],
  
  -- AI vurdering
  ai_condition TEXT,                        -- 'som_ny', 'god', 'ok', 'slidt'
  ai_estimated_value_kr DECIMAL(8,2),
  ai_estimated_value_cp INTEGER,
  
  -- Brugerens valg
  payout_type TEXT,                         -- 'kr' eller 'cp' (cp giver +20%)
  payout_amount DECIMAL(8,2),
  
  -- Partner
  partner_name TEXT,                        -- "Refurb.dk", "IKEA Circular Hub"
  
  -- Status
  status TEXT DEFAULT 'pending',            -- pending/accepted/pickup_scheduled/completed
  pickup_date TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE donations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  type TEXT NOT NULL,                       -- 'points' eller 'item'
  
  -- Points-donation
  amount_cp INTEGER,
  
  -- Item-donation
  item_description TEXT,
  item_photo_url TEXT,
  item_category TEXT,
  
  -- Modtager
  charity_name TEXT NOT NULL,               -- "Røde Kors", "Plant et Træ"
  
  -- Bonus
  bonus_cp INTEGER DEFAULT 0,              -- CP bonus for at donere
  tax_deduction_kr DECIMAL(8,2),           -- Skattefradrag
  
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  COLLECTOR (freelance)          │
-- └─────────────────────────────────┘

CREATE TABLE collectors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  
  level TEXT DEFAULT 'starter',             -- starter/pro/elite/partner
  rating DECIMAL(2,1) DEFAULT 5.0,
  total_kg_collected DECIMAL(10,2) DEFAULT 0,
  total_earned_kr DECIMAL(10,2) DEFAULT 0,
  
  -- Aktive ruter
  active_route JSONB,                       -- { stops: [], estimated_earnings: 0 }
  
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pickup_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID REFERENCES profiles(id) NOT NULL,
  collector_id UUID REFERENCES collectors(id),
  
  items_description TEXT,
  category TEXT,
  
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  address TEXT,
  
  preferred_time TEXT,                      -- "I dag 14-16"
  
  status TEXT DEFAULT 'open',               -- open/accepted/completed/cancelled
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ┌─────────────────────────────────┐
-- │  INDEXES FOR PERFORMANCE        │
-- └─────────────────────────────────┘

CREATE INDEX idx_scans_user ON scans(user_id);
CREATE INDEX idx_scans_date ON scans(created_at);
CREATE INDEX idx_products_ean ON products(ean_code);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_drop_points_location ON drop_points(latitude, longitude);
CREATE INDEX idx_reuse_listings_location ON reuse_listings(latitude, longitude);
CREATE INDEX idx_home_bins_user ON home_bins(user_id);

-- ┌─────────────────────────────────┐
-- │  ROW LEVEL SECURITY (RLS)       │
-- └─────────────────────────────────┘

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE reuse_listings ENABLE ROW LEVEL SECURITY;

-- Brugere kan kun se/ændre egne data
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can view own scans" ON scans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scans" ON scans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);

-- Alle kan se produkter og afleveringspunkter
CREATE POLICY "Anyone can view products" ON products FOR SELECT USING (true);
CREATE POLICY "Anyone can view drop points" ON drop_points FOR SELECT USING (true);
CREATE POLICY "Anyone can view shop items" ON shop_items FOR SELECT USING (true);
CREATE POLICY "Anyone can view active listings" ON reuse_listings FOR SELECT USING (status = 'active');
```

---

# DEL 15: LOGO SVG

## Primær logo (forest + lime)
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <circle cx="20" cy="30" r="18" fill="none" stroke="#C8F24A" stroke-width="4" stroke-dasharray="90 20"/>
  <text x="48" y="40" font-family="Fraunces, Georgia, serif" font-size="32" font-weight="700" fill="#0B3D2E">cirkel</text>
</svg>
```

## App-ikon
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="44" fill="#0B3D2E"/>
  <circle cx="100" cy="90" r="45" fill="none" stroke="#C8F24A" stroke-width="8" stroke-dasharray="220 50"/>
  <text x="100" y="165" text-anchor="middle" font-family="Fraunces, serif" font-size="28" font-weight="700" fill="#C8F24A">cirkel</text>
</svg>
```

---

*— SLUT PÅ CIRKEL KOMPLET REFERENCE v3 —*
*Genereret 13. april 2026*
*Indeholder: Arkitektur, Design, Beslutninger, Kode, Database, B2B, Konkurrenter, Tidsplan*
*Upload denne fil + App.tsx til ny Claude-chat for at fortsætte*
