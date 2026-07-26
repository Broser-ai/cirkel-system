/**
 * Structured logger — Sentry-compatible output format.
 *
 * - JSON-emit i production, pretty-print i development.
 * - Redaction af kendte secret-mønstre (Google, Anthropic, Stripe, AWS, PEM).
 * - Async batching: op til 20 events i kø, flush hvert 5. sekund eller ved fatal.
 * - Ingen 3rd-party deps — kan wired til Sentry via replace-emit senere.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  request_id?: string;
  user_id?: string;
}

export interface LoggerOptions {
  source: string;
  min_level?: 'info' | 'debug';
}

interface EmitMeta {
  request_id?: string;
  user_id?: string;
}

type UnknownRecord = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const MAX_QUEUE = 20;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Regex-panel for kendte secret-mønstre. Ordre er ligegyldig — vi kører alle.
 * Hver post erstattes med sit navn i firkantede parenteser.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // Google API-nøgler: AIza + 35 base64-lignende tegn.
  { name: 'GOOGLE_API_KEY', pattern: /AIza[0-9A-Za-z_-]{35}/g },
  // Anthropic: sk-ant- + resten (typisk ~90 tegn, matcher konservativt bredt).
  { name: 'ANTHROPIC_KEY', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  // Stripe live/test-nøgler og restricted keys: sk_live_, sk_test_, rk_live_, pk_live_...
  { name: 'STRIPE_KEY', pattern: /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  // Generisk sk_-token som falder uden for Stripe (fx sk_abcdef...).
  { name: 'GENERIC_SK_KEY', pattern: /\bsk_[A-Za-z0-9]{20,}/g },
  // AWS Access Key ID: AKIA + 16 store bogstaver/tal.
  { name: 'AWS_ACCESS_KEY', pattern: /AKIA[0-9A-Z]{16}/g },
  // OpenAI classic keys: sk- + 40+ tegn (ekskl. sk-ant- via lookahead).
  { name: 'OPENAI_KEY', pattern: /sk-(?!ant-)[A-Za-z0-9]{20,}/g },
  // JWT-lignende tokens (3 base64url-segmenter).
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // PEM private keys.
  {
    name: 'PRIVATE_KEY',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
];

/**
 * Feltnavne der altid maskeres uanset værdi.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'api_key',
  'apikey',
  'private_key',
  'client_secret',
  'session_token',
]);

function isProduction(): boolean {
  const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
  return env === 'production';
}

function redactString(value: string): string {
  let out = value;
  for (const { name, pattern } of SECRET_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${name}]`);
  }
  return out;
}

function isPlainObject(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Rekursiv redaction — dybt kopierer og maskerer strenge, sensitive nøgler,
 * og cirkulære refs. Tåler Date, Error, Array, plain objects.
 */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    return value.map((item) => redactValue(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const out: UnknownRecord = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = redactValue(v, seen);
    }
    return out;
  }
  // Fallback: ukendt objekttype — konverter til streng og redact.
  try {
    return redactString(String(value));
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

function formatError(err: unknown): LogRecord['error'] | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message),
      stack: err.stack ? redactString(err.stack) : undefined,
    };
  }
  return {
    name: 'NonErrorThrown',
    message: redactString(String(err)),
  };
}

function prettyEmit(record: LogRecord): void {
  const ts = record.timestamp;
  const lvl = record.level.toUpperCase().padEnd(5);
  const parts: string[] = [`[${ts}] ${lvl} ${record.message}`];
  if (record.request_id) parts.push(`request_id=${record.request_id}`);
  if (record.user_id) parts.push(`user_id=${record.user_id}`);
  if (record.context && Object.keys(record.context).length > 0) {
    parts.push(`context=${JSON.stringify(record.context)}`);
  }
  if (record.error) {
    parts.push(`error=${record.error.name}: ${record.error.message}`);
    if (record.error.stack) parts.push(`\n${record.error.stack}`);
  }
  console.log(parts.join(' '));
}

function jsonEmit(record: LogRecord): void {
  console.log(JSON.stringify(record));
}

export class Logger {
  private readonly source: string;
  private readonly minWeight: number;
  private readonly production: boolean;
  private queue: LogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LoggerOptions) {
    this.source = options.source;
    const min = options.min_level ?? (isProduction() ? 'info' : 'debug');
    this.minWeight = LEVEL_WEIGHT[min];
    this.production = isProduction();
    this.startTimer();
  }

  private startTimer(): void {
    // Kør kun timer i Node-lignende miljøer hvor setInterval eksisterer.
    if (typeof setInterval !== 'function') return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
    // Undgå at holde event loop i live.
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  /**
   * Fjern secrets fra vilkårlig context før den ryger i emit.
   * Eksponeret så konsumenter kan sanitere payloads uden for logger.
   */
  redact(context: Record<string, unknown>): Record<string, unknown> {
    const cleaned = redactValue(context, new WeakSet()) as Record<string, unknown>;
    return cleaned;
  }

  private shouldEmit(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= this.minWeight;
  }

  private buildRecord(
    level: LogLevel,
    message: string,
    context: UnknownRecord | undefined,
    err: unknown,
    meta: EmitMeta | undefined,
  ): LogRecord {
    const cleanedContext = context ? this.redact(context) : undefined;
    const baseContext: UnknownRecord = { source: this.source, ...(cleanedContext ?? {}) };
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message: redactString(message),
      context: baseContext,
    };
    const formatted = formatError(err);
    if (formatted) record.error = formatted;
    if (meta?.request_id) record.request_id = meta.request_id;
    if (meta?.user_id) record.user_id = meta.user_id;
    return record;
  }

  private enqueue(record: LogRecord): void {
    this.queue.push(record);
    if (record.level === 'fatal' || this.queue.length >= MAX_QUEUE) {
      this.flush();
    }
  }

  /**
   * Tømmer kø til stdout. Returnerer resolved Promise når emit er kørt —
   * konsole-baseret emit er synkron, men signaturen er async så Sentry-adapter
   * senere kan udføre HTTP-flush uden ABI-brud.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    for (const record of batch) {
      if (this.production) jsonEmit(record);
      else prettyEmit(record);
    }
  }

  debug(message: string, context?: UnknownRecord, meta?: EmitMeta): void {
    if (!this.shouldEmit('debug')) return;
    this.enqueue(this.buildRecord('debug', message, context, undefined, meta));
  }

  info(message: string, context?: UnknownRecord, meta?: EmitMeta): void {
    if (!this.shouldEmit('info')) return;
    this.enqueue(this.buildRecord('info', message, context, undefined, meta));
  }

  warn(message: string, context?: UnknownRecord, meta?: EmitMeta): void {
    if (!this.shouldEmit('warn')) return;
    this.enqueue(this.buildRecord('warn', message, context, undefined, meta));
  }

  error(message: string, err?: unknown, context?: UnknownRecord, meta?: EmitMeta): void {
    if (!this.shouldEmit('error')) return;
    this.enqueue(this.buildRecord('error', message, context, err, meta));
  }

  fatal(message: string, err?: unknown, context?: UnknownRecord, meta?: EmitMeta): void {
    if (!this.shouldEmit('fatal')) return;
    this.enqueue(this.buildRecord('fatal', message, context, err, meta));
    // fatal fremtvinger straks flush via enqueue-branch — men vi kalder igen
    // for at sikre synkron drain hvis køen var tom før.
    void this.flush();
  }

  /**
   * Stopper batch-timer. Kald ved graceful shutdown.
   */
  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.flush();
  }
}

const defaultLogger = new Logger({ source: 'cirkel-system' });

export default defaultLogger;
