// lib/cirkel.ts — Cirkel kerne-loop wiring (F1.11 v2 — Firebase-bro).
// Auth-broen er løst i databasen: process_scan + get_dashboard tager Firebase-uid
// og opretter/finder selv profilen. Server-side med service-role (aldrig klient).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScanResult {
  user_id: string;
  scan_id: string;
  points_earned: number;
  kroner_earned: number;
  co2_kg: number;
  new_balance: number;
  new_points: number;
  streak_days: number;
  member_status: "Standard-medlem" | "Sølv-medlem" | "Guld-medlem";
  level: number;
  ledger_hash: string;
  // Reward-lag v3 — udvidet af process_scan
  spendable_points?: number;
  lifetime_points?: number;
  new_achievements?: string[];
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  cost_points: number;
  category: string;
  stock: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  level: number;
  member_status: string;
  points: number;
  co2_kg: number;
}

export interface ScanInput {
  firebaseUid: string;        // user.uid fra Firebase
  email?: string;             // user.email
  fullName?: string;          // user.displayName
  material: string;
  weightGrams: number;
  points: number;
  kroner: number;
  co2Kg: number;
  barcode?: string;
  sortingCompliance?: number; // default 100
  municipality?: string;
}

// Persistér scan atomisk (scan + ledger-hash + saldo + streak + tier + level)
// og auto-byg/find profil via Firebase-uid-broen.
export async function processScan(sb: SupabaseClient, input: ScanInput): Promise<ScanResult> {
  const { data, error } = await sb.rpc("process_scan", {
    p_firebase_uid: input.firebaseUid,
    p_email: input.email ?? null,
    p_full_name: input.fullName ?? null,
    p_material: input.material,
    p_weight_grams: input.weightGrams,
    p_points: input.points,
    p_kroner: input.kroner,
    p_co2_kg: input.co2Kg,
    p_barcode: input.barcode ?? null,
    p_sorting_compliance: input.sortingCompliance ?? 100,
    p_municipality: input.municipality ?? "Aarhus Kommune",
  });
  if (error) throw new Error("process_scan: " + error.message);
  return data as ScanResult;
}

// Hent profil + seneste scans + KPI'er via Firebase-uid (ÉT kald).
// Reward-lag v3 udvider med achievements[] + leaderboard_rank.
export async function getDashboard(sb: SupabaseClient, firebaseUid: string) {
  const { data, error } = await sb.rpc("get_dashboard", { p_firebase_uid: firebaseUid });
  if (error) throw new Error("get_dashboard: " + error.message);
  return data as {
    profile: Record<string, any>;
    recent_scans: any[];
    kpi: { total_scans: number; total_points: number; total_kroner: number; total_co2_kg: number };
    achievements?: any[];
    leaderboard_rank?: number;
  };
}

// Reward-lag v3 — katalog over rewards (læseligt for alle authenticated).
export async function getRewards(sb: SupabaseClient): Promise<Reward[]> {
  const { data, error } = await sb.rpc("get_rewards");
  if (error) throw new Error("get_rewards: " + error.message);
  return data as Reward[];
}

// Reward-lag v3 — indløs en reward; trækker spendable_points (lifetime bevares så tier ikke ryger).
export async function redeemReward(sb: SupabaseClient, firebaseUid: string, rewardId: string) {
  const { data, error } = await sb.rpc("redeem_reward", { p_firebase_uid: firebaseUid, p_reward_id: rewardId });
  if (error) throw new Error("redeem_reward: " + error.message);
  return data as { redemption_id: string; reward: string; cost_points: number; remaining_points: number };
}

// Reward-lag v3 — top-N brugere (kun fornavn for privacy).
export async function getLeaderboard(sb: SupabaseClient, limit = 10): Promise<LeaderboardEntry[]> {
  const { data, error } = await sb.rpc("get_leaderboard", { p_limit: limit });
  if (error) throw new Error("get_leaderboard: " + error.message);
  return data as LeaderboardEntry[];
}
