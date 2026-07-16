// cirkel-system/api/roboflow-fallback.ts
//
// Integration-Audit forslag #4 (accepteret 2026-07-16).
// Roboflow-fallback for scanninger hvor Gemini har lav confidence.
// Kalder Michaels ReNew Intake workflow direkte via serverless endpoint.
//
// SIKKERHED: ROBOFLOW_API_KEY er server-side kun. Klient kan aldrig se den.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ROBOFLOW_WORKSPACE = process.env.ROBOFLOW_WORKSPACE || 'michaels-workspace-ccviv';
const ROBOFLOW_WORKFLOW_ID = process.env.ROBOFLOW_WORKFLOW_ID
  || 'renew-material-intake-agent-1784198501613';
const ROBOFLOW_TIMEOUT_MS = 15_000;
const CONFIDENCE_TRIGGER = 0.70;

interface WorkflowInput {
  image_base64: string;
  gemini_confidence?: number;
}

interface NormalizedResponse {
  material_type: string;
  material_confidence: number;
  quantity_kg_estimate: number | null;
  contamination_pct: number | null;
  purity_score: number | null;
  source: 'roboflow_michaels_workflow' | 'stub_no_api_key';
  raw_workflow_response: any;
}

function stripPrefix(b64: string): string {
  if (b64.startsWith('data:')) {
    const idx = b64.indexOf(',');
    return idx >= 0 ? b64.substring(idx + 1) : b64;
  }
  return b64;
}

/** Deep-find utility — same shape som ReNewIntakeSpecialist.normalize(). */
function deepFind(obj: any, keys: string[], depth = 0): any {
  if (obj === null || obj === undefined || depth > 4) return undefined;
  if (typeof obj !== 'object') return undefined;
  for (const k of keys) if (k in obj) return obj[k];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const v of Object.values(obj)) {
    const found = deepFind(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stubResponse(): NormalizedResponse {
  return {
    material_type: 'UNKNOWN',
    material_confidence: 0,
    quantity_kg_estimate: null,
    contamination_pct: null,
    purity_score: null,
    source: 'stub_no_api_key',
    raw_workflow_response: { stub: true },
  };
}

async function callWorkflow(imageB64: string, apiKey: string): Promise<NormalizedResponse> {
  const url = `https://serverless.roboflow.com/infer/workflows/${ROBOFLOW_WORKSPACE}/${ROBOFLOW_WORKFLOW_ID}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROBOFLOW_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        inputs: { image: { type: 'base64', value: stripPrefix(imageB64) } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new Error(`Roboflow HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    const json = await res.json();
    const flat = Array.isArray(json?.outputs) ? json.outputs[0] : json;

    const material = deepFind(flat, ['material_type', 'material', 'class', 'label']) ?? 'UNKNOWN';
    const rawConfidence = deepFind(flat, ['material_confidence', 'confidence', 'top_confidence']);
    const confidence = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : 0;
    const qty = deepFind(flat, ['quantity_kg', 'estimated_weight_kg']);
    const contam = deepFind(flat, ['contamination_pct', 'contamination']);
    const purity = deepFind(flat, ['purity_score', 'purity']);

    return {
      material_type: String(material),
      material_confidence: confidence,
      quantity_kg_estimate: typeof qty === 'number' ? qty : null,
      contamination_pct: typeof contam === 'number' ? contam : null,
      purity_score: typeof purity === 'number' ? purity : (typeof contam === 'number' ? 1 - contam / 100 : null),
      source: 'roboflow_michaels_workflow',
      raw_workflow_response: flat,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = req.body as Partial<WorkflowInput>;
  const imageB64 = String(body?.image_base64 ?? '');
  if (!imageB64) return res.status(400).json({ error: 'missing_image_base64' });

  const geminiConfidence = typeof body?.gemini_confidence === 'number' ? body.gemini_confidence : null;
  if (geminiConfidence !== null && geminiConfidence >= CONFIDENCE_TRIGGER) {
    return res.status(200).json({
      skipped: true,
      reason: 'gemini_confidence_ok',
      gemini_confidence: geminiConfidence,
      trigger_threshold: CONFIDENCE_TRIGGER,
    });
  }

  const apiKey = process.env.ROBOFLOW_API_KEY;
  if (!apiKey) {
    return res.status(200).json(stubResponse());
  }

  try {
    const result = await callWorkflow(imageB64, apiKey);
    return res.status(200).json({
      ...result,
      trigger_reason: geminiConfidence !== null
        ? `gemini_confidence_${geminiConfidence.toFixed(2)}_below_${CONFIDENCE_TRIGGER}`
        : 'explicit_call',
    });
  } catch (err: any) {
    console.error('[roboflow-fallback] fejlede:', err?.message ?? err);
    return res.status(502).json({
      error: 'roboflow_call_failed',
      detail: String(err?.message ?? err).substring(0, 200),
    });
  }
}
