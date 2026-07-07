// F3 — Admin-panel: on/off-toggles for portal-features
// Mekanisme, ikke indhold. Kun user_type='admin' må se + kalde POST /api/portal-features.
// INGEN service-role i frontend — alt går via /api/portal-features.
import React, { useState, useEffect } from 'react';
import { ShieldAlert, ToggleLeft, ToggleRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { UserProfile } from '../types';

interface AdminPanelProps {
  user: UserProfile;
}

interface FeaturesResponse {
  success: boolean;
  features?: {
    business_custom_content?: boolean;
    kommune_custom_content?: boolean;
  };
  error?: string;
}

export default function AdminPanel({ user }: AdminPanelProps) {
  const firebaseUid = (user as any).uid || user.id;

  const [business, setBusiness] = useState(false);
  const [kommune, setKommune] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/portal-features')
      .then((r) => r.json())
      .then((j: FeaturesResponse) => {
        if (!alive) return;
        if (j.success && j.features) {
          setBusiness(!!j.features.business_custom_content);
          setKommune(!!j.features.kommune_custom_content);
        } else {
          setError(j.error || 'Kunne ikke hente flag.');
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError('Netværksfejl — tjek forbindelsen.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  // Kun admin må se panelet — sekundær frontend-guard (backend er den ægte gate)
  if (user.user_type !== 'admin') {
    return (
      <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-24 text-center">
        <div className="bg-white border border-amber-200 rounded-3xl p-6 shadow-sm">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2" style={{ color: '#F97E19' }} />
          <p className="text-xs font-black" style={{ color: '#05361B' }}>
            Kun admin har adgang
          </p>
          <p className="text-[10px] font-semibold mt-1 leading-normal" style={{ color: '#6E6E6E' }}>
            Denne sektion er forbeholdt Cirkel-team-brugere.
          </p>
        </div>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const r = await fetch('/api/portal-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firebaseUid,
          business_custom_content: business,
          kommune_custom_content: kommune,
        }),
      });
      const j: FeaturesResponse = await r.json();
      if (!r.ok || !j.success) {
        setError(j.error || 'Kunne ikke gemme.');
      } else {
        setFlash('Gemt ✓ — flag opdateret.');
      }
    } catch {
      setError('Netværksfejl.');
    }
    setSaving(false);
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4 pt-4 pb-24 flex flex-col gap-5 select-none animate-in fade-in duration-200 text-left">
      <div
        className="rounded-3xl p-5 text-white shadow-lg relative overflow-hidden"
        style={{ background: '#05361B' }}
      >
        <div className="absolute right-0 top-0 w-32 h-32 rounded-full blur-2xl pointer-events-none" style={{ background: 'rgba(249, 126, 25, 0.15)' }} />
        <div className="flex items-center gap-2 relative">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(249, 126, 25, 0.2)' }}>
            <ShieldAlert className="w-4 h-4" style={{ color: '#F97E19' }} />
          </span>
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest block leading-none" style={{ color: 'rgba(255,255,255,0.55)' }}>Admin</span>
            <h3 className="text-sm font-black uppercase tracking-wider mt-1 leading-none">Portal-Features</h3>
          </div>
        </div>
        <p className="text-[11px] font-semibold mt-3 leading-normal relative" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Aktivér portal-specifikt indhold. Når slået til, viser den relevante portal en placeholder-slot i stedet for det fælles dashboard. Indholdet bygges i separat opgave.
        </p>
      </div>

      {loading ? (
        <div className="h-40 bg-white border border-gray-100 rounded-2xl animate-pulse" />
      ) : (
        <div className="bg-white border border-gray-150 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
          <button
            id="admin-toggle-business"
            onClick={() => setBusiness((v) => !v)}
            disabled={saving}
            className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all active:scale-98 cursor-pointer"
          >
            <div className="text-left">
              <p className="text-xs font-black" style={{ color: '#05361B' }}>💼 Erhverv custom_content</p>
              <p className="text-[10px] text-muted-text font-semibold mt-0.5">
                Aktivér placeholder-slot for erhverv-specifikt indhold
              </p>
            </div>
            {business
              ? <ToggleRight className="w-9 h-9 shrink-0" style={{ color: '#F97E19' }} />
              : <ToggleLeft className="w-9 h-9 shrink-0" style={{ color: '#6E6E6E' }} />}
          </button>

          <div className="h-px bg-gray-100" />

          <button
            id="admin-toggle-kommune"
            onClick={() => setKommune((v) => !v)}
            disabled={saving}
            className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all active:scale-98 cursor-pointer"
          >
            <div className="text-left">
              <p className="text-xs font-black" style={{ color: '#05361B' }}>🏛️ Kommune custom_content</p>
              <p className="text-[10px] text-muted-text font-semibold mt-0.5">
                Aktivér placeholder-slot for kommune-specifikt indhold
              </p>
            </div>
            {kommune
              ? <ToggleRight className="w-9 h-9 shrink-0" style={{ color: '#F97E19' }} />
              : <ToggleLeft className="w-9 h-9 shrink-0" style={{ color: '#6E6E6E' }} />}
          </button>

          <button
            id="admin-save"
            onClick={save}
            disabled={saving}
            className="mt-2 py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-98"
            style={{
              background: saving ? 'rgba(5, 54, 27, 0.08)' : '#F97E19',
              color: saving ? '#6E6E6E' : '#05361B',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Gemmer…' : 'Gem ændringer'}
          </button>

          {flash && (
            <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="text-[11px] font-black text-emerald-900">{flash}</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
              <span className="text-[11px] font-black text-rose-900">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
