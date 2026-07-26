# Cirkel Native Mobile — Scaffold Plan

**Target:** Skalering af `C:\Users\Ambro2\cirkel-app-native` fra "Physical Terminal" MVP (kamera + hyperspectral) til fuld B2C mobil-app med Passkey-login, Wallet+Payout, Give-marketplace, og Push.

**Status ved plan-tid (2026-07-21):** Expo Router 3.5 baseline med `app/{index,scan,wallet,marketplace}.tsx`. Ingen auth, ingen native tabs, ingen i18n, ingen push, ingen maps. Al api-integration mod `cirkel-system` Vercel-backend (`extra.cirkelHarnessApi`).

**Effort-estimat total:** ~5,5 person-uger (kvalificeret RN dev). Detaljeret breakdown i sidste sektion.

---

## 0. Arkitektur-beslutninger

### 0.1 Monorepo vs. symlink for type-reuse

Cirkel-system's types (bl.a. wallet-DTO'er, scan-response, nudge-schedule) skal genbruges 1:1.

**Anbefalet: pnpm workspaces monorepo** — omdøb til `cirkel-monorepo/` med:

```
cirkel-monorepo/
├── pnpm-workspace.yaml
├── package.json                     (root)
├── packages/
│   ├── shared-types/                (nyt — udtrukket fra cirkel-system/lib)
│   │   ├── src/{wallet,scan,nudge,auth,give}.ts
│   │   └── package.json             ("name": "@cirkel/shared-types")
│   ├── cirkel-system/               (uændret Vercel-repo)
│   └── cirkel-app-native/           (Expo)
└── tsconfig.base.json
```

`packages/cirkel-app-native/package.json`:
```json
{
  "dependencies": {
    "@cirkel/shared-types": "workspace:*"
  }
}
```

`packages/cirkel-app-native/metro.config.js` — Metro læser workspace-symlinks:
```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../shared-types')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];
module.exports = config;
```

**Fallback (hvis monorepo-migration er for dyr):** symlink `cirkel-system/lib/types` → `cirkel-app-native/lib/shared-types` via `mklink /D` (Windows) og tsconfig-paths `@shared/*`.

**Effort:** 1 dag monorepo-migration (inkl. flytning af `cirkel-system` uden at bryde Vercel-deploy — `rootDirectory: packages/cirkel-system` i Vercel-project).

---

### 0.2 Navigation — expo-router vs. React Navigation

Nuværende scaffold bruger `expo-router` (file-based). Skift til **React Navigation bottom-tabs** for at få native tab-bar med badge-support (til push-notifications). Alternativt kan expo-router v3 tabs bruges (`app/(tabs)/_layout.tsx`) — nemmere.

**Anbefalet: expo-router v3 tabs** (mindre refactor):

```
app/
├── _layout.tsx                    (root, Auth-gate)
├── (auth)/
│   ├── _layout.tsx
│   └── login.tsx                  (Passkey + magic link fallback)
└── (tabs)/
    ├── _layout.tsx                (bottom tabs)
    ├── scan.tsx                   (default aka index)
    ├── wallet.tsx
    ├── give.tsx
    └── profile.tsx
```

---

### 0.3 Auth-strategy

- **Primær:** Passkey (WebAuthn) via `react-native-passkey` → kalder `cirkel-system/api/webauthn/{challenge,authenticate,register}`.
- **Session:** Supabase Auth JWT lagret i `expo-secure-store` (KeyChain/Keystore). Refresh-token via Supabase klient.
- **Fallback:** Magic link (Supabase Auth OTP-email) hvis passkey ikke understøttes (Android <9, iOS <16).

---

## 1. Nye dependencies

Tilføj til `package.json`:

```json
{
  "dependencies": {
    "@react-navigation/native": "^6.1.18",
    "@react-navigation/bottom-tabs": "^6.6.1",
    "@supabase/supabase-js": "^2.45.0",
    "react-native-passkey": "^3.1.0",
    "react-native-vision-camera": "^4.5.0",
    "react-native-worklets-core": "^1.3.3",
    "vision-camera-code-scanner": "^0.2.0",
    "react-native-maps": "1.14.0",
    "expo-notifications": "~0.28.0",
    "expo-secure-store": "~13.0.0",
    "expo-device": "~6.0.0",
    "expo-location": "~17.0.0",
    "expo-linking": "~6.3.0",
    "i18n-js": "^4.4.3",
    "expo-localization": "~15.0.0",
    "react-native-mmkv": "^2.12.2",
    "zustand": "^4.5.4",
    "@tanstack/react-query": "^5.51.0",
    "react-native-url-polyfill": "^2.0.0"
  }
}
```

**app.json plugin-tilføjelser:**

```json
"plugins": [
  "expo-router",
  "expo-secure-store",
  "expo-localization",
  ["expo-camera", { "cameraPermission": "Cirkel bruger kameraet til materiale-scan." }],
  ["react-native-vision-camera", {
    "cameraPermissionText": "Cirkel bruger kameraet til at scanne materialer.",
    "enableCodeScanner": true
  }],
  ["expo-notifications", {
    "icon": "./assets/notification-icon.png",
    "color": "#22c55e"
  }],
  ["react-native-maps", {
    "androidGoogleMapsApiKey": "${GOOGLE_MAPS_ANDROID_KEY}"
  }]
]
```

Bemærk: `react-native-vision-camera` kræver **custom dev-client** (kan ikke køre i Expo Go). Skift til `npx expo prebuild` + EAS Build. Effort: 0,5 dag.

---

## 2. Screen 1 — LoginScreen (Passkey + Supabase)

**Fil:** `app/(auth)/login.tsx`

```tsx
import { View, Text, Pressable, ActivityIndicator, useColorScheme } from 'react-native';
import { useState } from 'react';
import { Passkey } from 'react-native-passkey';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { colors } from '../../lib/theme';

export default function LoginScreen() {
  const scheme = useColorScheme();
  const c = colors[scheme ?? 'light'];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loginWithPasskey() {
    setLoading(true); setError(null);
    try {
      // 1. Hent challenge fra cirkel-system
      const { challenge, rpId, userId } = await api.post('/webauthn/challenge', {
        purpose: 'authenticate',
      });

      // 2. Native biometric prompt
      const assertion = await Passkey.authenticate({
        challenge,
        rpId,
        userVerification: 'required',
      });

      // 3. Verificer på server → få Supabase-session
      const { access_token, refresh_token } = await api.post('/webauthn/authenticate', {
        assertion,
        userId,
      });

      // 4. Persister session
      await supabase.auth.setSession({ access_token, refresh_token });
      await SecureStore.setItemAsync('cirkel_refresh', refresh_token);

      router.replace('/(tabs)/scan');
    } catch (e: any) {
      setError(e.message ?? t('login.error'));
    } finally {
      setLoading(false);
    }
  }

  async function loginWithMagicLink() {
    // Fallback: prompt for email, kalder supabase.auth.signInWithOtp
    router.push('/(auth)/magic-link');
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center' }}>
      <Text style={{ color: c.fg, fontSize: 32, fontWeight: '700', marginBottom: 8 }}>
        {t('login.title')}
      </Text>
      <Text style={{ color: c.muted, fontSize: 16, marginBottom: 48 }}>
        {t('login.subtitle')}
      </Text>

      <Pressable
        onPress={loginWithPasskey}
        disabled={loading}
        style={{
          backgroundColor: c.accent,
          padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12,
        }}
      >
        {loading
          ? <ActivityIndicator color={c.bg} />
          : <Text style={{ color: c.bg, fontSize: 16, fontWeight: '600' }}>
              {t('login.passkey')}
            </Text>}
      </Pressable>

      <Pressable onPress={loginWithMagicLink} style={{ padding: 16, alignItems: 'center' }}>
        <Text style={{ color: c.muted }}>{t('login.magicLink')}</Text>
      </Pressable>

      {error && <Text style={{ color: '#ef4444', marginTop: 16 }}>{error}</Text>}
    </View>
  );
}
```

**Auth-gate i root-layout:** `app/_layout.tsx` tjekker session, redirecter til `/(auth)/login` hvis mangler.

**Backend-krav:** `api/webauthn/authenticate.ts` skal returnere `{ access_token, refresh_token }` i stedet for kun boolean. Se `cirkel-system/api/webauthn/authenticate.ts` — allerede påbegyndt.

**Effort:** 3 dage (Passkey-integration + Supabase-session + auth-gate + magic-link fallback + fejl-håndtering).

---

## 3. Screen 2 — ScanTab (VisionCamera → api/scan)

**Fil:** `app/(tabs)/scan.tsx`

Erstatter nuværende `app/scan.tsx` (som bruger `expo-camera`). VisionCamera giver 30-60 FPS frame-processor for real-time EdgeTAM inference.

```tsx
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Camera, useCameraDevice, useCameraPermission, useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS, useSharedValue } from 'react-native-worklets-core';
import { api } from '../../lib/api';
import { EdgeTAMEngine } from '../../lib/edge/EdgeTAMEngine';
import { t } from '../../lib/i18n';
import { colors } from '../../lib/theme';

export default function ScanTab() {
  const scheme = useColorScheme();
  const c = colors[scheme ?? 'light'];
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const engine = useRef(new EdgeTAMEngine()).current;

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission]);

  // Real-time frame processor (16 FPS Aurelle target)
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const mask = engine.segment(frame);
    if (mask.confidence > 0.85) {
      runOnJS(setLastResult)({
        materialGuess: mask.label,
        confidence: mask.confidence,
        bbox: mask.bbox,
      });
    }
  }, [engine]);

  const capture = useCallback(async () => {
    if (!camera.current || scanning) return;
    setScanning(true);
    try {
      const photo = await camera.current.takePhoto({ flash: 'auto' });
      const result = await api.uploadScan({
        uri: `file://${photo.path}`,
        edgeMask: lastResult,   // Fra frame-processor
      });
      // Naviger til result-screen
    } finally { setScanning(false); }
  }, [scanning, lastResult]);

  if (!hasPermission)
    return <View style={styles.center}><Text style={{ color: c.fg }}>{t('scan.needPermission')}</Text></View>;
  if (!device)
    return <View style={styles.center}><Text style={{ color: c.fg }}>{t('scan.noCamera')}</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        frameProcessor={frameProcessor}
      />
      {/* Overlay med detected material label */}
      {lastResult && (
        <View style={{ position: 'absolute', top: 60, left: 20, right: 20 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>
            {lastResult.materialGuess} — {Math.round(lastResult.confidence * 100)}%
          </Text>
        </View>
      )}
      <Pressable
        onPress={capture}
        style={{
          position: 'absolute', bottom: 60, alignSelf: 'center',
          width: 80, height: 80, borderRadius: 40, backgroundColor: c.accent,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });

type ScanResult = { materialGuess: string; confidence: number; bbox: number[] };
```

**Framework mod `api/scan`:** `lib/api.ts` uploader multipart/form-data til `cirkel-system.vercel.app/api/scan` (se `cirkel-system/api/scan.ts`). Response parses ind i shared type `@cirkel/shared-types/scan`.

**Effort:** 4 dage (VisionCamera custom dev-client + frame processor + EdgeTAM WASM-bind + upload + result-visning).

---

## 4. Screen 3 — WalletTab (balance + payout)

**Fil:** `app/(tabs)/wallet.tsx`

```tsx
import { View, Text, Pressable, RefreshControl, ScrollView, useColorScheme } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import type { WalletBalance, PayoutRequest } from '@cirkel/shared-types/wallet';
import { PayoutSheet } from '../../components/PayoutSheet';
import { t } from '../../lib/i18n';
import { colors } from '../../lib/theme';

export default function WalletTab() {
  const scheme = useColorScheme();
  const c = colors[scheme ?? 'light'];
  const qc = useQueryClient();
  const [payoutOpen, setPayoutOpen] = useState(false);

  const balanceQ = useQuery({
    queryKey: ['wallet', 'balance'],
    queryFn: () => api.get<WalletBalance>('/wallet/balance'),
    staleTime: 30_000,
  });

  const payoutMut = useMutation({
    mutationFn: (req: PayoutRequest) => api.post('/wallet/request-payout', req),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wallet'] }); setPayoutOpen(false); },
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      refreshControl={<RefreshControl refreshing={balanceQ.isFetching} onRefresh={() => balanceQ.refetch()} />}
    >
      <View style={{ padding: 24 }}>
        <Text style={{ color: c.muted, fontSize: 14, textTransform: 'uppercase' }}>
          {t('wallet.balance')}
        </Text>
        <Text style={{ color: c.fg, fontSize: 48, fontWeight: '700', marginTop: 4 }}>
          {balanceQ.data ? `${(balanceQ.data.oreCents / 100).toFixed(2)} kr` : '—'}
        </Text>
        <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
          {t('wallet.co2Saved', { kg: balanceQ.data?.co2SavedKg?.toFixed(1) ?? '0' })}
        </Text>

        <Pressable
          onPress={() => setPayoutOpen(true)}
          disabled={!balanceQ.data || balanceQ.data.oreCents < 5000}
          style={{
            backgroundColor: c.accent, padding: 16, borderRadius: 12,
            alignItems: 'center', marginTop: 32,
            opacity: balanceQ.data && balanceQ.data.oreCents >= 5000 ? 1 : 0.4,
          }}
        >
          <Text style={{ color: c.bg, fontSize: 16, fontWeight: '600' }}>
            {t('wallet.requestPayout')}
          </Text>
        </Pressable>
        {balanceQ.data && balanceQ.data.oreCents < 5000 && (
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            {t('wallet.minPayout', { min: '50,00' })}
          </Text>
        )}

        {/* Recent transactions */}
        <View style={{ marginTop: 48 }}>
          <Text style={{ color: c.fg, fontSize: 18, fontWeight: '600', marginBottom: 12 }}>
            {t('wallet.history')}
          </Text>
          {balanceQ.data?.transactions.map(tx => (
            <View key={tx.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ color: c.fg }}>{tx.type} — {tx.amountKr} kr</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{new Date(tx.createdAt).toLocaleString('da-DK')}</Text>
            </View>
          ))}
        </View>
      </View>

      <PayoutSheet
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        maxKr={(balanceQ.data?.oreCents ?? 0) / 100}
        onSubmit={(req) => payoutMut.mutate(req)}
        submitting={payoutMut.isPending}
      />
    </ScrollView>
  );
}
```

**PayoutSheet:** modal med `TextInput` for beløb + MobilePay-nr / IBAN + valg af metode. `PayoutRequest`-DTO deles med `cirkel-system/api/wallet/request-payout.ts` via `@cirkel/shared-types`.

**Kritiske detaljer:**
- Beløb valideres client-side + server-side (min 50 kr, max saldo, KYC-tjek server-side).
- Payout-metoder: MobilePay (dominans DK), IBAN, gaveafgift til NGO (Modul 20).
- Rate-limit 1/døgn per bruger (håndhæves server-side).

**Effort:** 3 dage (Balance-query + PayoutSheet + validation + i18n + tomstands-UX).

---

## 5. Screen 4 — GiveTab (Modul 19 marketplace + maps)

**Fil:** `app/(tabs)/give.tsx`

P2P give-away marked (jf. `project_cirkel_give_marketplace.md` — DAWA lukker 17 aug 2026, så skift til intern adresse-cache er allerede planlagt).

```tsx
import { View, Text, Pressable, useColorScheme } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from '../../lib/api';
import type { GiveListing } from '@cirkel/shared-types/give';
import { t } from '../../lib/i18n';
import { colors } from '../../lib/theme';

export default function GiveTab() {
  const scheme = useColorScheme();
  const c = colors[scheme ?? 'light'];
  const [region, setRegion] = useState({
    latitude: 56.1629, longitude: 10.2039,   // Aarhus default
    latitudeDelta: 0.05, longitudeDelta: 0.05,
  });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setRegion(r => ({ ...r, latitude: loc.coords.latitude, longitude: loc.coords.longitude }));
    })();
  }, []);

  const listingsQ = useQuery({
    queryKey: ['give', region.latitude.toFixed(2), region.longitude.toFixed(2)],
    queryFn: () => api.get<GiveListing[]>('/give/nearby', {
      lat: region.latitude, lon: region.longitude, radiusKm: 5,
    }),
  });

  const listings = useMemo(() => listingsQ.data ?? [], [listingsQ.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        region={region}
        onRegionChangeComplete={setRegion}
        showsUserLocation
        userInterfaceStyle={scheme ?? 'light'}
      >
        {listings.map(listing => (
          <Marker
            key={listing.id}
            coordinate={{ latitude: listing.lat, longitude: listing.lon }}
            title={listing.title}
            description={listing.category}
            pinColor={listing.category === 'furniture' ? '#22c55e' : '#3b82f6'}
          >
            <Callout onPress={() => router.push(`/give/${listing.id}`)}>
              <View style={{ padding: 8, minWidth: 180 }}>
                <Text style={{ fontWeight: '600' }}>{listing.title}</Text>
                <Text style={{ color: '#666', fontSize: 12 }}>{listing.distanceKm.toFixed(1)} km</Text>
                <Text style={{ color: c.accent, fontSize: 12, marginTop: 4 }}>{t('give.viewDetails')}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <Pressable
        onPress={() => router.push('/give/create')}
        style={{
          position: 'absolute', bottom: 24, right: 24,
          backgroundColor: c.accent, width: 56, height: 56, borderRadius: 28,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Text style={{ color: c.bg, fontSize: 24, fontWeight: '700' }}>+</Text>
      </Pressable>
    </View>
  );
}
```

**Backend-krav:** Nye endpoints i cirkel-system:
- `GET /api/give/nearby?lat&lon&radiusKm` → array of `GiveListing`
- `POST /api/give/create` (multipart: photos + metadata + adresse)
- `GET /api/give/:id`
- `POST /api/give/:id/claim`

**Fraud-defense (DK-fraud-epidemi 131k svindlet 2024):**
- MitID-verificerede givere får badge (kobler til `api/auth/mitid-callback.ts`).
- Kun fysisk pickup, ingen forsendelse, ingen betaling in-app.
- Reporting-flow til modul 20.

**Effort:** 5 dage (Maps + Location + listings-CRUD + create-flow + adresse-cache mod post-DAWA + fraud-badges).

---

## 6. Screen 5 — Profile (bonus, ikke i original spec men nødvendig)

Simpel: brugerdata, sprog-toggle, log-ud, delete-account. **Effort:** 1 dag.

---

## 7. Push-notifications (expo-notifications → api/nudge/schedule)

**Fil:** `lib/push.ts`

```ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: true, shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Cirkel', importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250], lightColor: '#22c55e',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  // Registrer på cirkel-system så api/nudge/schedule kan sende
  await api.post('/nudge/register-device', {
    expoPushToken: token,
    platform: Platform.OS,
    locale: Constants.systemFonts, // erstattes med expo-localization
  });

  return token;
}

export function useNotificationListeners() {
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.type === 'scan-reminder') router.push('/(tabs)/scan');
      if (data?.type === 'payout-ready') router.push('/(tabs)/wallet');
      if (data?.type === 'give-match')  router.push(`/give/${data.listingId}`);
    });
    return () => sub.remove();
  }, []);
}
```

**Backend-krav:** cirkel-system skal have:
- `POST /api/nudge/register-device` (gemmer `expo_push_token` på user-row i Supabase).
- `api/nudge/schedule.ts` udvidet til at kalde Expo Push API (`https://exp.host/--/api/v2/push/send`) med bulk-batching.
- Cron: dagligt nudge, ugentligt payout-summary, event-baseret give-match.

**Effort:** 2 dage (klient + backend + testing på fysisk device).

---

## 8. Dark mode support

**Fil:** `lib/theme.ts`

```ts
export const colors = {
  light: {
    bg: '#ffffff', fg: '#0a0a0a', muted: '#737373',
    accent: '#16a34a', border: '#e5e5e5', card: '#f5f5f5',
  },
  dark: {
    bg: '#0a0a0a', fg: '#fafafa', muted: '#a3a3a3',
    accent: '#22c55e', border: '#262626', card: '#171717',
  },
} as const;
```

Alle skærme bruger `useColorScheme()` (Expo re-render ved system-toggle). `app.json` har allerede `"userInterfaceStyle": "automatic"`.

**Optional:** Persist user-override via MMKV (`theme_pref: 'light' | 'dark' | 'system'`).

**Effort:** 1 dag (theme-tokens + audit af alle screens + MMKV-override).

---

## 9. i18n DA/EN via i18n-js

**Fil:** `lib/i18n.ts`

```ts
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

const translations = {
  da: {
    login: {
      title: 'Velkommen tilbage',
      subtitle: 'Log ind med biometri for at fortsætte',
      passkey: 'Log ind med Face ID / Touch ID',
      magicLink: 'Send mig et link i stedet',
      error: 'Kunne ikke logge ind — prøv igen',
    },
    scan: {
      needPermission: 'Vi har brug for kamera-adgang',
      noCamera: 'Intet kamera fundet',
      capture: 'Scan',
    },
    wallet: {
      balance: 'Saldo',
      co2Saved: '{{kg}} kg CO2 sparet',
      requestPayout: 'Anmod om udbetaling',
      minPayout: 'Minimum {{min}} kr for udbetaling',
      history: 'Historik',
    },
    give: {
      viewDetails: 'Se detaljer',
    },
  },
  en: {
    login: {
      title: 'Welcome back',
      subtitle: 'Sign in with biometrics to continue',
      passkey: 'Sign in with Face ID / Touch ID',
      magicLink: 'Send me a link instead',
      error: 'Could not sign in — please try again',
    },
    scan: {
      needPermission: 'We need camera access',
      noCamera: 'No camera found',
      capture: 'Scan',
    },
    wallet: {
      balance: 'Balance',
      co2Saved: '{{kg}} kg CO2 saved',
      requestPayout: 'Request payout',
      minPayout: 'Minimum {{min}} kr for payout',
      history: 'History',
    },
    give: {
      viewDetails: 'View details',
    },
  },
};

export const i18n = new I18n(translations);
i18n.enableFallback = true;
i18n.defaultLocale = 'da';

const stored = storage.getString('locale');
i18n.locale = stored ?? (Localization.getLocales()[0]?.languageCode ?? 'da');

export const t = (key: string, opts?: Record<string, any>) => i18n.t(key, opts);

export function setLocale(locale: 'da' | 'en') {
  i18n.locale = locale;
  storage.set('locale', locale);
}
```

**Krav:** Alle strings routes gennem `t()`. Lint-regel (custom ESLint plugin) kan checke for hard-codede danske strings i JSX (nice-to-have).

**Effort:** 2 dage (setup + oversætte alle screens + toggle i profile).

---

## 10. Shared type-udtræk (fra cirkel-system → shared-types)

Konkrete typer der SKAL flyttes til `packages/shared-types/src`:

```
wallet.ts     — WalletBalance, PayoutRequest, PayoutMethod, Transaction
scan.ts       — ScanRequest, ScanResult, MaterialLabel, EdgeMask
nudge.ts      — NudgeType, NudgeSchedule, DeviceRegistration
auth.ts       — SessionTokens, WebAuthnChallenge, WebAuthnAssertion
give.ts       — GiveListing, GiveCategory, ClaimRequest, GiveCreatePayload
user.ts       — UserProfile, UserRole, MitIdStatus
```

Efter migration importerer BÅDE cirkel-system og cirkel-app-native fra `@cirkel/shared-types/*`. Ingen duplikat-definitioner.

**Effort:** 1,5 dag (udtræk + refactor imports i cirkel-system + verify build stadig grøn).

---

## 11. Tab-navigation layout

**Fil:** `app/(tabs)/_layout.tsx`

```tsx
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { t } from '../../lib/i18n';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const c = colors[scheme ?? 'light'];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.fg,
      }}
    >
      <Tabs.Screen name="scan"    options={{ title: t('tabs.scan'),    tabBarIcon: ({ color, size }) => <Ionicons name="scan"      color={color} size={size} /> }} />
      <Tabs.Screen name="wallet"  options={{ title: t('tabs.wallet'),  tabBarIcon: ({ color, size }) => <Ionicons name="wallet"    color={color} size={size} /> }} />
      <Tabs.Screen name="give"    options={{ title: t('tabs.give'),    tabBarIcon: ({ color, size }) => <Ionicons name="gift"      color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person"    color={color} size={size} /> }} />
    </Tabs>
  );
}
```

---

## 12. Root layout + auth-gate

**Fil:** `app/_layout.tsx`

```tsx
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import 'react-native-url-polyfill/auto';
import { supabase } from '../lib/supabase';
import { registerForPush, useNotificationListeners } from '../lib/push';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthed(!!session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
      if (session) registerForPush().catch(() => {});
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!authed && !inAuth) router.replace('/(auth)/login');
    if (authed && inAuth) router.replace('/(tabs)/scan');
  }, [ready, authed, segments]);

  useNotificationListeners();

  return (
    <QueryClientProvider client={qc}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
```

---

## 13. Supabase-klient + api-wrapper

**Fil:** `lib/supabase.ts`

```ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const ExpoSecureStoreAdapter = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};

export const supabase = createClient(
  Constants.expoConfig!.extra!.supabaseUrl,
  Constants.expoConfig!.extra!.supabaseAnonKey,
  {
    auth: {
      storage: ExpoSecureStoreAdapter as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

`app.json` udvides:
```json
"extra": {
  "cirkelHarnessApi": "https://cirkel-system.vercel.app/api",
  "supabaseUrl": "https://sycmpguhdudyejmxxaic.supabase.co",
  "supabaseAnonKey": "${SUPABASE_ANON_KEY}",
  "eas": { "projectId": "TBD-efter-eas-init" }
}
```

**Fil:** `lib/api.ts` — tynd wrapper der injecter `Authorization: Bearer <supabase-jwt>`:

```ts
import Constants from 'expo-constants';
import { supabase } from './supabase';

const BASE = Constants.expoConfig!.extra!.cirkelHarnessApi;

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export const api = {
  async get<T>(path: string, query?: Record<string, any>): Promise<T> {
    const qs = query ? '?' + new URLSearchParams(query as any).toString() : '';
    const r = await fetch(`${BASE}${path}${qs}`, { headers: await authHeader() });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  },
  async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  },
  async uploadScan(input: { uri: string; edgeMask?: any }) {
    const form = new FormData();
    form.append('image', { uri: input.uri, name: 'scan.jpg', type: 'image/jpeg' } as any);
    if (input.edgeMask) form.append('edgeMask', JSON.stringify(input.edgeMask));
    const r = await fetch(`${BASE}/scan`, { method: 'POST', body: form, headers: await authHeader() });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.json();
  },
};
```

---

## 14. EAS Build + release-pipeline

Nødvendig fordi VisionCamera og react-native-maps kræver custom native code.

```bash
npm install -g eas-cli
eas login
eas build:configure
```

`eas.json` skitse:
```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "ios": { "simulator": true } },
    "preview":     { "distribution": "internal", "channel": "preview" },
    "production":  { "channel": "production", "autoIncrement": true }
  },
  "submit": {
    "production": {
      "ios":     { "appleId": "TBD", "ascAppId": "TBD" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

**Effort:** 2 dage (EAS-setup + første dev-build + App Store Connect metadata + Play Console listing).

---

## 15. Sikkerhed — non-negotiables

Bygger videre på eksisterende regler i `feedback_dpn_critical_infra` og `docs/F3.8-server-side-auth.md`:

1. **Supabase anon-key** i `app.json.extra` — OK, den er publisher-safe. Aldrig service-role-key i klient.
2. **JWT-verifikation** på alle cirkel-system endpoints (allerede `_verify-firebase-token.ts` for legacy; ny `_verify-supabase-jwt.ts` skal skrives).
3. **RLS på Supabase** — alle tabeller skal have policies der matcher `auth.uid()`. Kritisk for wallet_transactions + give_listings.
4. **Refresh-token i expo-secure-store** — aldrig AsyncStorage.
5. **Roboflow-key** forbliver server-side (allerede etableret).
6. **Ingen deep-link auth-callbacks** uden PKCE.
7. **Passkey-attestation** verificeres server-side mod cirkel-system's WebAuthn RP.

---

## 16. Migration-plan (rækkefølge)

Anbefalet sekventiel udrulning så hver PR er reviewable:

1. **Uge 1:** Monorepo + shared-types udtræk + eas prebuild (blocker for alt andet).
2. **Uge 2:** Supabase-klient + auth-gate + LoginScreen + Passkey-flow (frigør resten).
3. **Uge 3:** VisionCamera ScanTab + refactor gammel scan.tsx + upload-flow.
4. **Uge 4:** WalletTab + PayoutSheet + backend-endpoints komplet.
5. **Uge 5:** GiveTab + maps + backend give/*-endpoints + fraud-badges.
6. **Uge 6:** Push + i18n + dark-mode-audit + EAS production build + TestFlight/Play internal.

Buffer: 0,5 uge til bugfixes efter beta-test.

---

## 17. Effort-estimat (kondenseret)

| # | Område | Effort |
|---|---|---|
| 0.1 | Monorepo + shared-types | 1,0 dag |
| 0.3 | Auth-strategy plumbing | 1,0 dag |
| 1 | Deps + app.json + prebuild + EAS init | 1,0 dag |
| 2 | LoginScreen + Passkey + Supabase-session | 3,0 dage |
| 3 | ScanTab + VisionCamera + EdgeTAM binding | 4,0 dage |
| 4 | WalletTab + PayoutSheet | 3,0 dage |
| 5 | GiveTab + Maps + backend endpoints | 5,0 dage |
| 6 | Profile-skærm | 1,0 dag |
| 7 | Push + backend nudge/register-device | 2,0 dage |
| 8 | Dark mode audit | 1,0 dag |
| 9 | i18n DA/EN | 2,0 dage |
| 10 | Shared-types refactor på cirkel-system side | 1,5 dag |
| 11 | Tab-layout + navigation glue | 0,5 dag |
| 12 | Root layout + auth-gate | 0,5 dag |
| 13 | Supabase-klient + api-wrapper | 0,5 dag |
| 14 | EAS Build + release-pipeline + store-listings | 2,0 dage |
| — | Beta-test + bugfix-buffer | 3,0 dage |
| **TOTAL** | | **32 dage ≈ 6,4 person-uger** |

Bemærk: forudsætter én kvalificeret RN-udvikler. Med parallel backend-arbejde (endpoints i cirkel-system kan skrives af separat dev) trimmes ~1 uge.

---

## 18. Kritiske risici

1. **VisionCamera + EAS-migration** kan ædelæg det nuværende Physical-Terminal-flow — kør parallel git-branch, verify med `cirkel-harness` kernemodul-tests før merge.
2. **DAWA lukker 17 aug 2026** (kendt fra memory) — Give-modulet SKAL bruge intern adresse-cache fra dag 1. Aftal med backend hvornår `/api/dawa-v2` skifter til cache-only.
3. **App Store Passkey-review** kan tage 2 uger — send LoginScreen først til TestFlight for at få review-runde tidligt.
4. **Push-tokens roterer** — implementer `Notifications.addPushTokenListener` og re-register mod backend automatisk.
5. **Supabase JWT expiry** — tanstack-query skal have retry-on-401 der kalder `supabase.auth.refreshSession()` (ikke autopilot i standard-config).
6. **RN 0.74 + expo-router v3** har kendt bug med `useSegments()` under fast-refresh — vær opmærksom under dev.

---

## 19. Ikke i scope for denne scaffold

- Offline-first SQLite cache (Aurelle Fase 2)
- Origin Lens C2PA-signering
- Real-time Agent-X NPU-acceleration
- ElevenLabs voice
- B2B upload one-tap (kræver separat modul-19 aftale)
- Voice-onboarding via expo-speech
- Web-version (Expo Web fungerer men ikke prioritet — brug cirkel-system PWA)

Disse dokumenteres i separat "Fase 2 targets"-fil hvis prioriteret.

---

## 20. Filer der oprettes/ændres

**Nye:**
```
packages/shared-types/                    (hele pakken)
packages/cirkel-app-native/eas.json
packages/cirkel-app-native/metro.config.js
packages/cirkel-app-native/babel.config.js  (worklets plugin)
packages/cirkel-app-native/app/(auth)/_layout.tsx
packages/cirkel-app-native/app/(auth)/login.tsx
packages/cirkel-app-native/app/(auth)/magic-link.tsx
packages/cirkel-app-native/app/(tabs)/_layout.tsx
packages/cirkel-app-native/app/(tabs)/scan.tsx
packages/cirkel-app-native/app/(tabs)/wallet.tsx
packages/cirkel-app-native/app/(tabs)/give.tsx
packages/cirkel-app-native/app/(tabs)/profile.tsx
packages/cirkel-app-native/app/give/[id].tsx
packages/cirkel-app-native/app/give/create.tsx
packages/cirkel-app-native/components/PayoutSheet.tsx
packages/cirkel-app-native/components/ListingCard.tsx
packages/cirkel-app-native/lib/supabase.ts
packages/cirkel-app-native/lib/api.ts
packages/cirkel-app-native/lib/theme.ts
packages/cirkel-app-native/lib/i18n.ts
packages/cirkel-app-native/lib/push.ts
```

**Ændres:**
```
packages/cirkel-app-native/app/_layout.tsx        (auth-gate + query-client + push)
packages/cirkel-app-native/app.json               (plugins + extra)
packages/cirkel-app-native/package.json           (deps)
packages/cirkel-app-native/tsconfig.json          (paths for @cirkel/shared-types)
packages/cirkel-system/api/webauthn/authenticate.ts    (returner Supabase-tokens)
packages/cirkel-system/api/nudge/schedule.ts           (Expo Push API integration)
packages/cirkel-system/lib/*                           (typer flyttet til shared-types)
```

**Slettes (efter migration):**
```
packages/cirkel-app-native/app/index.tsx           (erstattet af (tabs)/scan.tsx)
packages/cirkel-app-native/app/scan.tsx            (flyttet)
packages/cirkel-app-native/app/wallet.tsx          (flyttet)
packages/cirkel-app-native/app/marketplace.tsx     (erstattet af give.tsx)
```

---

**Slut på plan.** Klar til Architect's Gate-review inden implementation påbegyndes.
