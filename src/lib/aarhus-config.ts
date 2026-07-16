// cirkel-system/src/lib/aarhus-config.ts
//
// Integration-Audit forslag #6 (accepteret 2026-07-16).
// Delt Aarhus-konfiguration — erstatter hardkodede koordinater 6+ steder.
//
// Fase 2: erstat statiske IoT-spande med kald til /api/nudge (spatial occupancy
// fra WorldModel + Smart Nudging fra Modul 13).

export const AARHUS_COORDS = { lat: 56.1522, lng: 10.2037 } as const;

export const AARHUS_C_REGION_ID = 'aarhus-c' as const;

export const AARHUS_KOMMUNE = 'Aarhus Kommune' as const;

export interface IoTContainer {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: 'Aarhus';
}

/** Kanoniske Cirkel-spande i Aarhus C — Fase 1 pilot. */
export const AARHUS_IOT_CONTAINERS: readonly IoTContainer[] = [
  {
    id: 'aarhus-c-01',
    name: 'Cirkel IoT Smart-Spand Banegårdspladsen',
    address: 'Banegårdspladsen 1, 8000 Aarhus C',
    lat: 56.1504,
    lng: 10.2045,
    city: 'Aarhus',
  },
  {
    id: 'aarhus-c-02',
    name: 'Cirkel IoT Smart-Spand Åboulevarden',
    address: 'Åboulevarden 26, 8000 Aarhus C',
    lat: 56.1565,
    lng: 10.2095,
    city: 'Aarhus',
  },
  {
    id: 'aarhus-c-03',
    name: 'Cirkel IoT Smart-Spand Salling',
    address: 'Østergade 25, 8000 Aarhus C',
    lat: 56.1558,
    lng: 10.2069,
    city: 'Aarhus',
  },
] as const;

/** Standard bin-kapacitet (matches cirkel-harness/simulation/WorldModel). */
export const AARHUS_CONTAINER_CAPACITY_GRAMS = 50_000;

/** DK 2026 emballageafgift-rate — brug til CEA-certifikat udregninger. */
export const DK_PACKAGING_TAX_RATE_2026 = 0.15;
