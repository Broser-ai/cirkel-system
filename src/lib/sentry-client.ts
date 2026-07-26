/**
 * Sentry frontend-instrumentation for Cirkel.
 *
 * Denne fil kaldes fra `src/main.tsx` via `initSentry()` ved app-boot,
 * og eksponerer `CirkelErrorBoundary` / `withCirkelErrorBoundary` /
 * `setSentryUser` / `captureException` til brug i UI-koden. Filen er
 * dermed IKKE dead code — den er den kanoniske indgang til fejlrapportering
 * fra browseren.
 *
 * GDPR-notes:
 *  - Session Replay er DEAKTIVERET som default (kan aktiveres eksplicit via env).
 *  - `beforeSend` fjerner PII (email, CPR, telefon) fra alle events, breadcrumbs
 *    og request-strings inden de forlader browseren.
 *  - `sendDefaultPii` er sat til `false` — ingen IP, cookies eller headers.
 *
 * ESM-note:
 *  - React importeres statisk i toppen (ingen `require()`), så filen bygger
 *    korrekt under Vite/ESM. Dynamic `require` er bevidst udeladt.
 */

import React from 'react';
import * as Sentry from '@sentry/react';
import type {
  Breadcrumb,
  ErrorEvent,
  EventHint,
  Request as SentryRequest,
} from '@sentry/react';
import type { TransactionEvent } from '@sentry/core';
import type { ComponentType, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentryInitOptions {
  /** Override DSN. Default: import.meta.env.VITE_SENTRY_DSN. */
  readonly dsn?: string;
  /** Release/version tag (fx git-sha). Default: import.meta.env.VITE_APP_VERSION. */
  readonly release?: string;
  /** Miljø-tag. Default: import.meta.env.MODE. */
  readonly environment?: string;
  /** Aktivér Session Replay (default: false — GDPR). */
  readonly enableReplay?: boolean;
  /** Override traces sample-rate. */
  readonly tracesSampleRate?: number;
}

interface ImportMetaEnvLike {
  readonly MODE?: string;
  readonly PROD?: boolean;
  readonly DEV?: boolean;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_SENTRY_ENABLE_REPLAY?: string;
}

// Vite-safe env access (uden `any`).
function readEnv(): ImportMetaEnvLike {
  try {
    const meta = import.meta as unknown as { env?: ImportMetaEnvLike };
    return meta.env ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// PII-scrubbing
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Dansk CPR: 6 cifre + valgfri bindestreg + 4 cifre (fx 010190-1234 eller 0101901234).
const CPR_RE = /\b\d{6}[- ]?\d{4}\b/g;
// Dansk telefon: 8 cifre, eller +45 / 0045 prefix, med valgfri mellemrum/bindestreger.
const PHONE_RE =
  /(?:(?:\+|00)45[\s-]?)?(?:\d[\s-]?){7}\d\b/g;

const REDACTED = '[redacted]';

function scrubString(input: string): string {
  return input
    .replace(EMAIL_RE, REDACTED)
    .replace(CPR_RE, REDACTED)
    .replace(PHONE_RE, REDACTED);
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function scrubValue<T>(value: T): T {
  if (typeof value === 'string') {
    return scrubString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v);
    }
    return out as unknown as T;
  }
  return value;
}

function scrubRequest(req: SentryRequest | undefined): SentryRequest | undefined {
  if (!req) return req;
  const cleaned: SentryRequest = { ...req };
  if (typeof cleaned.url === 'string') {
    cleaned.url = scrubString(cleaned.url);
  }
  if (typeof cleaned.query_string === 'string') {
    cleaned.query_string = scrubString(cleaned.query_string);
  }
  if (cleaned.data !== undefined) {
    cleaned.data = scrubValue(cleaned.data as JsonValue) as SentryRequest['data'];
  }
  // Bevidst: fjern headers og cookies helt.
  delete cleaned.headers;
  delete cleaned.cookies;
  return cleaned;
}

function scrubBreadcrumb(bc: Breadcrumb): Breadcrumb {
  const cleaned: Breadcrumb = { ...bc };
  if (typeof cleaned.message === 'string') {
    cleaned.message = scrubString(cleaned.message);
  }
  if (cleaned.data) {
    cleaned.data = scrubValue(cleaned.data as Record<string, JsonValue>) as Record<
      string,
      unknown
    >;
  }
  return cleaned;
}

function scrubEvent<E extends ErrorEvent | TransactionEvent>(event: E): E {
  const cleaned: E = { ...event };

  // Fjern user-PII fuldstændigt — vi identificerer med intern user_id andetsteds.
  if (cleaned.user) {
    const { id, ip_address: _ip, email: _email, username: _username, ...rest } =
      cleaned.user;
    cleaned.user = id !== undefined ? { id, ...rest } : { ...rest };
  }

  if (typeof cleaned.message === 'string') {
    cleaned.message = scrubString(cleaned.message);
  }

  if (cleaned.request) {
    cleaned.request = scrubRequest(cleaned.request);
  }

  if (cleaned.breadcrumbs) {
    cleaned.breadcrumbs = cleaned.breadcrumbs.map(scrubBreadcrumb);
  }

  if (cleaned.extra) {
    cleaned.extra = scrubValue(cleaned.extra as Record<string, JsonValue>) as Record<
      string,
      unknown
    >;
  }

  if (cleaned.tags) {
    const tags: Record<string, string | number | boolean | null | undefined> = {};
    for (const [k, v] of Object.entries(cleaned.tags)) {
      tags[k] = typeof v === 'string' ? scrubString(v) : v as string | number | boolean | null | undefined;
    }
    cleaned.tags = tags;
  }

  // Scrub exception-values (fx fejlbeskeder der indeholder emails).
  if ('exception' in cleaned && cleaned.exception?.values) {
    cleaned.exception = {
      ...cleaned.exception,
      values: cleaned.exception.values.map((ex) => ({
        ...ex,
        value: typeof ex.value === 'string' ? scrubString(ex.value) : ex.value,
      })),
    };
  }

  return cleaned;
}

// Eksporteret så scrubbing kan enhedstestes uden at initialisere Sentry.
export const __piiScrubbers = {
  scrubString,
  scrubValue,
  scrubEvent,
} as const;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Initialiser Sentry-klienten. Kaldes fra `src/main.tsx` FØR React monteres,
 * så tidlige boot-fejl fanges. Idempotent — sikkert at kalde flere gange.
 *
 * Returnerer `true` hvis Sentry blev initialiseret (eller allerede var),
 * `false` hvis der ingen DSN er (fx lokal udvikling uden Sentry).
 */
export function initSentry(options: SentryInitOptions = {}): boolean {
  if (initialized) return true;

  const env = readEnv();
  const dsn = options.dsn ?? env.VITE_SENTRY_DSN;
  if (!dsn) {
    // Ingen DSN konfigureret — no-op (fx lokal udvikling uden Sentry).
    return false;
  }

  const mode = options.environment ?? env.MODE ?? 'development';
  const isProd = env.PROD === true || mode === 'production';
  const tracesSampleRate = options.tracesSampleRate ?? (isProd ? 0.1 : 1.0);

  const enableReplay =
    options.enableReplay ?? env.VITE_SENTRY_ENABLE_REPLAY === 'true';

  const integrations: ReturnType<typeof Sentry.browserTracingIntegration>[] = [
    Sentry.browserTracingIntegration(),
  ];

  if (enableReplay) {
    // Kun aktiveret hvis eksplicit opt-in — GDPR default: OFF.
    integrations.push(
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }) as unknown as ReturnType<typeof Sentry.browserTracingIntegration>,
    );
  }

  Sentry.init({
    dsn,
    release: options.release ?? env.VITE_APP_VERSION,
    environment: mode,
    integrations,
    tracesSampleRate,
    replaysSessionSampleRate: enableReplay ? (isProd ? 0.0 : 0.1) : 0.0,
    replaysOnErrorSampleRate: enableReplay ? 1.0 : 0.0,
    sendDefaultPii: false,
    beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
      return scrubEvent(event);
    },
    beforeSendTransaction(event: TransactionEvent): TransactionEvent | null {
      return scrubEvent(event);
    },
    beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
      return scrubBreadcrumb(breadcrumb);
    },
  });

  initialized = true;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers til app-kode
// ---------------------------------------------------------------------------

/** Identificér bruger med intern id (aldrig email/CPR). */
export function setSentryUser(userId: string | null): void {
  if (!initialized) return;
  if (userId === null) {
    Sentry.setUser(null);
  } else {
    Sentry.setUser({ id: userId });
  }
}

/** Rapportér en fanget fejl manuelt. */
export function captureException(
  error: unknown,
  context?: Record<string, JsonValue>,
): void {
  if (!initialized) {
    // eslint-disable-next-line no-console
    console.error('[sentry-client:not-init]', error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: scrubValue(context) } : undefined);
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

export interface CirkelErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode | Sentry.FallbackRender;
  readonly onError?: (error: Error, componentStack: string, eventId: string) => void;
  readonly showDialog?: boolean;
}

const DefaultFallback: Sentry.FallbackRender = ({ resetError }) => {
  // Bevidst render-only — ingen JSX for at holde filen ren TS uden .tsx-krav.
  // App'en kan overskrive dette via `fallback`-prop.
  return React.createElement(
    'div',
    { role: 'alert', style: { padding: '2rem', textAlign: 'center' } },
    React.createElement('h2', null, 'Der opstod en fejl'),
    React.createElement(
      'p',
      null,
      'Vi er blevet notificeret. Prøv at genindlæse siden.',
    ),
    React.createElement(
      'button',
      { type: 'button', onClick: resetError },
      'Prøv igen',
    ),
  );
};

export const CirkelErrorBoundary: ComponentType<CirkelErrorBoundaryProps> = (
  props,
) => {
  return React.createElement(
    Sentry.ErrorBoundary,
    {
      fallback: props.fallback ?? DefaultFallback,
      onError: props.onError,
      showDialog: props.showDialog ?? false,
    },
    props.children,
  );
};

/** HOC-variant hvis komponent-træet skal wrappes ét sted. */
export function withCirkelErrorBoundary<P extends object>(
  Component: ComponentType<P>,
  options?: Omit<CirkelErrorBoundaryProps, 'children'>,
): ComponentType<P> {
  return Sentry.withErrorBoundary(Component, {
    fallback: options?.fallback ?? DefaultFallback,
    onError: options?.onError,
    showDialog: options?.showDialog ?? false,
  });
}

export { Sentry };
