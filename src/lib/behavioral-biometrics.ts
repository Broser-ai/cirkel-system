/**
 * Cirkel — Modul 5.3
 * Behavioral Biometrics & Client-side Anti-Bot
 *
 * Klientside signaler til at skelne mennesker fra automatiserede scripts:
 *   - Canvas fingerprint (device rendering hash)
 *   - Touch telemetry buffer (interval / force / radius / koordinater)
 *   - Device fingerprint (hardware, skærm, tid, farvedybde)
 *   - Anomali-verifikation (perfekt regelmæssige intervaller = bot)
 *
 * Browser-only. Alle API'er kaldes bag `isBrowser()` guards, så modulet
 * kan importeres i SSR-kontekster (Next.js, edge functions) uden crash.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TouchTelemetryEvent {
  /** ms siden epoch (Date.now / event.timeStamp) */
  timestamp: number;
  /** Trykkraft 0.0–1.0 (0 hvis ikke understøttet) */
  force: number;
  /** Radius X af berøringen i px */
  radiusX: number;
  /** X-koordinat i viewport (clientX) */
  coordinateX: number;
  /** Y-koordinat i viewport (clientY) */
  coordinateY: number;
}

export interface DeviceFingerprint {
  /** SHA-lignende hash af canvas-render (djb2, hex) */
  canvasHash: string;
  /** Antal logiske CPU-kerner (navigator.hardwareConcurrency) */
  hardwareConcurrency: number;
  /** Format "1920x1080" */
  screenResolution: string;
  /** IANA-navn, fx "Europe/Copenhagen" */
  timezone: string;
  /** Farvedybde i bit (screen.colorDepth) */
  colorDepth: number;
}

export interface TelemetryPayload {
  /** Device fingerprint samlet ved kald */
  fingerprint: DeviceFingerprint;
  /** Nyeste touch-events i tidsrækkefølge */
  events: TouchTelemetryEvent[];
  /** Antal events registreret i alt (også dem der er faldet ud af bufferen) */
  totalEvents: number;
  /** ms siden epoch — hvornår payload blev genereret */
  generatedAt: number;
}

export interface BehavioralTracker {
  /** Skub et touch-event ind i den rullende buffer */
  addTouchEvent: (event: TouchTelemetryEvent) => void;
  /** Byg et fladt payload klar til POST til backend */
  generateTelemetryPayload: () => TelemetryPayload;
  /** Antal events aktuelt i bufferen */
  size: () => number;
  /** Tøm bufferen (fx efter succesfuld verifikation) */
  reset: () => void;
}

export interface AnomalyOptions {
  /**
   * Minimum antal events før vi overhovedet vurderer.
   * Færre end dette returnerer false (kan ikke udtale sig).
   */
  minEvents?: number;
  /**
   * Grænse for varians / gennemsnit — under denne betragtes
   * intervaller som "perfekt regelmæssige".
   * Default 0.02 (2 % relativ variation).
   */
  regularityThreshold?: number;
}

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 200;
const CANVAS_TEXT = "cirkel-anti-bot-✓-\u{1F510}"; // varieret unicode
const DEFAULT_MIN_EVENTS = 8;
const DEFAULT_REGULARITY_THRESHOLD = 0.02;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function hasDocument(): boolean {
  return isBrowser() && typeof document !== "undefined";
}

// ---------------------------------------------------------------------------
// Hash-hjælper (djb2 — deterministisk, ingen crypto-afhængighed)
// ---------------------------------------------------------------------------

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // Konverter til usigneret hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Canvas fingerprint
// ---------------------------------------------------------------------------

function computeCanvasHash(): string {
  if (!hasDocument()) {
    return "ssr-unavailable";
  }

  try {
    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;

    const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d");
    if (ctx === null) {
      return "no-2d-context";
    }

    // Baggrund
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Tekst-run 1
    ctx.textBaseline = "top";
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = "#1a73e8";
    ctx.fillText(CANVAS_TEXT, 8, 8);

    // Tekst-run 2 (anden font + farve for at fremtvinge render-forskelle)
    ctx.font = "14px 'Times New Roman'";
    ctx.fillStyle = "rgba(200, 30, 30, 0.75)";
    ctx.fillText(CANVAS_TEXT, 10, 30);

    // Geometri
    ctx.strokeStyle = "#00aa66";
    ctx.beginPath();
    ctx.arc(200, 30, 20, 0, Math.PI * 2, true);
    ctx.stroke();

    const dataUrl: string = canvas.toDataURL("image/png");
    return djb2Hash(dataUrl);
  } catch {
    return "canvas-error";
  }
}

// ---------------------------------------------------------------------------
// Device fingerprint
// ---------------------------------------------------------------------------

export function getFingerprint(): DeviceFingerprint {
  if (!isBrowser()) {
    return {
      canvasHash: "ssr-unavailable",
      hardwareConcurrency: 0,
      screenResolution: "0x0",
      timezone: "UTC",
      colorDepth: 0,
    };
  }

  const hardwareConcurrency: number =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 0;

  const width: number =
    typeof window.screen !== "undefined" && typeof window.screen.width === "number"
      ? window.screen.width
      : 0;
  const height: number =
    typeof window.screen !== "undefined" && typeof window.screen.height === "number"
      ? window.screen.height
      : 0;
  const colorDepth: number =
    typeof window.screen !== "undefined" && typeof window.screen.colorDepth === "number"
      ? window.screen.colorDepth
      : 0;

  let timezone = "UTC";
  try {
    const resolved: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === "string" && resolved.length > 0) {
      timezone = resolved;
    }
  } catch {
    timezone = "UTC";
  }

  return {
    canvasHash: computeCanvasHash(),
    hardwareConcurrency,
    screenResolution: `${width}x${height}`,
    timezone,
    colorDepth,
  };
}

// ---------------------------------------------------------------------------
// Behavioral tracker (touch telemetry buffer)
// ---------------------------------------------------------------------------

export function initializeBehavioralTracker(): BehavioralTracker {
  const buffer: TouchTelemetryEvent[] = [];
  let total = 0;

  const addTouchEvent = (event: TouchTelemetryEvent): void => {
    // Defensiv validering — silently drop malformed input
    if (
      typeof event.timestamp !== "number" ||
      typeof event.force !== "number" ||
      typeof event.radiusX !== "number" ||
      typeof event.coordinateX !== "number" ||
      typeof event.coordinateY !== "number"
    ) {
      return;
    }

    buffer.push({
      timestamp: event.timestamp,
      force: event.force,
      radiusX: event.radiusX,
      coordinateX: event.coordinateX,
      coordinateY: event.coordinateY,
    });
    total += 1;

    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }
  };

  const generateTelemetryPayload = (): TelemetryPayload => {
    return {
      fingerprint: getFingerprint(),
      events: buffer.slice(),
      totalEvents: total,
      generatedAt: isBrowser() ? Date.now() : 0,
    };
  };

  const size = (): number => buffer.length;

  const reset = (): void => {
    buffer.length = 0;
    total = 0;
  };

  return {
    addTouchEvent,
    generateTelemetryPayload,
    size,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Anomali-verifikation
// ---------------------------------------------------------------------------

/**
 * Returnerer `true` hvis telemetri ser bot-agtig ud, dvs. intervaller
 * mellem touch-events er (næsten) perfekt regelmæssige.
 *
 * Metode:
 *   1. Bereg delta(t) mellem konsekutive events.
 *   2. Beregn middel og standardafvigelse.
 *   3. Coefficient of variation = stddev / middel.
 *   4. CV < threshold => bot.
 *
 * Ekstra bot-signaler:
 *   - Alle force-værdier identiske
 *   - Alle radiusX identiske
 *   - Alle events samme (x, y) koordinat
 */
export function verifyTelemetryAnomalies(
  telemetry: TelemetryPayload,
  options: AnomalyOptions = {},
): boolean {
  const minEvents: number = options.minEvents ?? DEFAULT_MIN_EVENTS;
  const regularityThreshold: number =
    options.regularityThreshold ?? DEFAULT_REGULARITY_THRESHOLD;

  const events: TouchTelemetryEvent[] = telemetry.events;
  if (events.length < minEvents) {
    return false;
  }

  // Interval-analyse
  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const delta: number = events[i].timestamp - events[i - 1].timestamp;
    if (delta > 0) {
      intervals.push(delta);
    }
  }

  if (intervals.length < minEvents - 1) {
    return false;
  }

  const mean: number =
    intervals.reduce((sum, v) => sum + v, 0) / intervals.length;

  if (mean <= 0) {
    return true; // simultane events => scriptet
  }

  const variance: number =
    intervals.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) /
    intervals.length;
  const stddev: number = Math.sqrt(variance);
  const cv: number = stddev / mean;

  if (cv < regularityThreshold) {
    return true;
  }

  // Ensartede force-værdier
  const firstForce: number = events[0].force;
  const allSameForce: boolean = events.every((e) => e.force === firstForce);
  if (allSameForce && firstForce === 0) {
    // Mange botter emitter force=0 uniformt; menneskers touch varierer
    // — men mange desktop-browsere sender også 0. Kræv ekstra signal.
    const firstRadius: number = events[0].radiusX;
    const allSameRadius: boolean = events.every(
      (e) => e.radiusX === firstRadius,
    );
    if (allSameRadius) {
      return true;
    }
  }

  // Identiske koordinater
  const firstX: number = events[0].coordinateX;
  const firstY: number = events[0].coordinateY;
  const allSameCoord: boolean = events.every(
    (e) => e.coordinateX === firstX && e.coordinateY === firstY,
  );
  if (allSameCoord) {
    return true;
  }

  return false;
}
