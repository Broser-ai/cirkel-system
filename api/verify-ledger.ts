// F4.x — Ledger Integrity Verifier
// ============================================================================
// Nightly cron-friendly endpoint der re-beregner SHA-256 hash-chain over hele
// public.ledger og flagger enhver mismatch mellem stored hash og forventet hash.
//
// Kontrakt (samme som Postgres-triggeren i supabase_schema.sql):
//   hash = SHA-256( prev_hash || scan_id::text || points::text || balance::text || user_id::text )
//   Genesis (id lavest) → prev_hash = '0' * 64
//
// - GET only (405 for alt andet)
// - Kræver ADMIN_TOKEN i "x-admin-token" (eller Authorization: Bearer <t>)
// - Læser op til 10.000 rows i én batch — INGEN writes til DB
// - Returnerer 500 + logger.fatal hvis mismatches.length > 0
// ----------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import logger from "../src/lib/logger.js";

// ---------- Typer ----------------------------------------------------------

interface LedgerRow {
  id: number;
  scan_id: string;
  user_id: string;
  points: number;
  // numeric(10,2) leveres af PostgREST som string for at bevare præcision;
  // vi tolererer number som fallback hvis en anden klient/parser normaliserer.
  balance: string | number;
  prev_hash: string;
  hash: string;
}

interface Mismatch {
  id: number;
  expected_hash: string;
  actual_hash: string;
}

interface VerifyResponse {
  total_rows: number;
  valid: boolean;
  mismatches: Mismatch[];
  genesis_ok: boolean;
  duration_ms: number;
}

// ---------- Konstanter -----------------------------------------------------

const GENESIS_PREV_HASH = "0".repeat(64);
const MAX_ROWS = 10_000;
const LEDGER_TABLE = "ledger";

// ---------- Hjælpere -------------------------------------------------------

// Fast textual repræsentation af numeric(10,2). Postgres' ::text på numeric
// bevarer scale, så 10.5 → "10.50". Vi må matche det uanset om supabase-js
// returnerer string eller number.
function balanceToText(v: string | number): string {
  if (typeof v === "string") return v;
  return v.toFixed(2);
}

function computeHash(row: LedgerRow, prevHashOverride?: string): string {
  const prev = prevHashOverride ?? row.prev_hash;
  const payload =
    prev +
    row.scan_id +
    String(row.points) +
    balanceToText(row.balance) +
    row.user_id;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(bufA.length);
    timingSafeEqual(bufA, dummy);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function extractAdminToken(req: any): string | null {
  const raw =
    req.headers?.["x-admin-token"] ??
    req.headers?.["X-Admin-Token"] ??
    (typeof req.headers?.authorization === "string"
      ? req.headers.authorization.replace(/^Bearer\s+/i, "")
      : undefined);
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : String(raw);
}

// Lazy Supabase-klient (service-role, server-only). Cached mellem invocations.
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  _sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _sb;
}

// ---------- Handler --------------------------------------------------------

export default async function handler(req: any, res: any): Promise<void> {
  const started = Date.now();

  // 1. Kun GET.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // 2. Admin-token krav.
  const expectedToken = process.env.ADMIN_TOKEN;
  if (!expectedToken) {
    logger.error("verify-ledger: ADMIN_TOKEN env-var er ikke sat");
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }
  const providedToken = extractAdminToken(req);
  if (!providedToken || !timingSafeEquals(providedToken, expectedToken)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 3. Supabase-klient.
  const sb = getSupabase();
  if (!sb) {
    logger.error("verify-ledger: Supabase env-vars mangler", undefined, {
      has_url: !!process.env.VITE_SUPABASE_URL,
      has_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  // 4. Læs op til 10.000 rows i chain-order.
  const { data, error } = await sb
    .from(LEDGER_TABLE)
    .select("id, scan_id, user_id, points, balance, prev_hash, hash")
    .order("id", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    logger.error("verify-ledger: SELECT fejlede", error, {
      code: error.code,
      details: error.details,
    });
    res.status(500).json({ error: "Ledger query failed" });
    return;
  }

  const rows = (data ?? []) as LedgerRow[];
  const total = rows.length;

  // Tom kæde er teknisk gyldig — genesis anses OK by-vacuous-truth.
  if (total === 0) {
    const duration_ms = Date.now() - started;
    const body: VerifyResponse = {
      total_rows: 0,
      valid: true,
      mismatches: [],
      genesis_ok: true,
      duration_ms,
    };
    logger.info("verify-ledger: tom ledger — intet at verificere", {
      duration_ms,
    });
    res.status(200).json(body);
    return;
  }

  // 5. Genesis-check: første row skal have prev_hash = 64 nuller.
  const genesis_ok = rows[0].prev_hash === GENESIS_PREV_HASH;

  // 6. Kør chain: for hver row genberegn hash. Første row bruger sit eget
  //    prev_hash (verificeret ovenfor); efterfølgende bruger PREVIOUS ROWS
  //    STORED hash — dermed fanger vi både lokale hash-fejl og brudte links.
  const mismatches: Mismatch[] = [];
  let prevStoredHash = rows[0].prev_hash;

  for (let i = 0; i < total; i++) {
    const row = rows[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : prevStoredHash;

    // Flag prev_hash-mismatch som hash-mismatch: expected_hash gengiver hvad
    // hash'en VILLE have været hvis linket var korrekt; dermed får revisoren
    // både forventet chain-fortsættelse og den faktiske afvigelse i én linje.
    const expected_hash = computeHash(row, expectedPrev);
    const actual_hash = row.hash;

    if (!timingSafeEquals(expected_hash, actual_hash)) {
      mismatches.push({
        id: row.id,
        expected_hash,
        actual_hash,
      });
    }

    prevStoredHash = row.hash;
  }

  const duration_ms = Date.now() - started;
  const valid = mismatches.length === 0 && genesis_ok;

  const body: VerifyResponse = {
    total_rows: total,
    valid,
    mismatches,
    genesis_ok,
    duration_ms,
  };

  if (!valid) {
    logger.fatal(
      "verify-ledger: LEDGER INTEGRITY BREACH",
      undefined,
      {
        total_rows: total,
        mismatch_count: mismatches.length,
        genesis_ok,
        first_bad_id: mismatches[0]?.id,
        duration_ms,
      },
    );
    res.status(500).json(body);
    return;
  }

  logger.info("verify-ledger: chain valid", {
    total_rows: total,
    duration_ms,
  });
  res.status(200).json(body);
}
