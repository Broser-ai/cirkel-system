import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, RefreshCw, Key, Lock, ArrowRight, CheckCircle, 
  HelpCircle, Globe, Terminal, FileCode2, Copy, Check 
} from 'lucide-react';
import { UserProfile } from '../types';

interface MitIDAuthProps {
  onSuccess: (profile: UserProfile) => void;
  onCancel: () => void;
}

// Utility to generate a random string for state/verifier
const generateRandomString = (length: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Simplified SHA-256 helper simulating PKCE code challenge
const simulateSha256 = (str: string) => {
  // Return a realistic pseudo-hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `E9_e5_${hex}_Xq9_${Math.abs(hash * 3).toString(16).substring(0, 16)}`;
};

export default function MitIDAuth({ onSuccess, onCancel }: MitIDAuthProps) {
  // OAuth / PKCE States
  const [step, setStep] = useState<'intro' | 'authorizing' | 'callback' | 'token_exchange' | 'success'>('intro');
  const [copiedText, setCopiedText] = useState<'verifier' | 'challenge' | 'code' | 'token' | null>(null);
  
  // PKCE Parameters
  const [stateParam, setStateParam] = useState('');
  const [codeVerifier, setCodeVerifier] = useState('');
  const [codeChallenge, setCodeChallenge] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [idTokenPayload, setIdTokenPayload] = useState<any>(null);

  // User input simulation
  const [username, setUsername] = useState('');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  // Initialize PKCE values
  useEffect(() => {
    const state = generateRandomString(12);
    const verifier = generateRandomString(48);
    const challenge = simulateSha256(verifier);
    
    setStateParam(state);
    setCodeVerifier(verifier);
    setCodeChallenge(challenge);
    
    addLog(`[Client] Initiating PKCE transaction. Generated state entropy: ${state}`);
    addLog(`[Client] Computed secure challenge using SHA-256 code_challenge_method.`);
  }, []);

  const addLog = (msg: string) => {
    const timestamp = new Date().toTimeString().split(' ')[0];
    setLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
  };

  const copyToClipboard = (text: string, type: 'verifier' | 'challenge' | 'code' | 'token') => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleStartLogin = () => {
    if (!username.trim()) return;
    
    setStep('authorizing');
    addLog(`[Authorization] Redirecting browser context to MitID OpenID Connect endpoint...`);
    addLog(`[Authorization] Params: client_id=cirkel-web-app, response_type=code, code_challenge=${codeChallenge.substring(0, 12)}..., state=${stateParam}`);
    
    // Simulate user authentication on secure MitID screen
    let curr = 0;
    const interval = setInterval(() => {
      curr += 8;
      setProgress(Math.min(curr, 100));
      
      if (curr === 40) {
        addLog(`[MitID Portal] Request received from Cirkel. Awaiting signature validation on secure physical authenticator key...`);
      }
      if (curr === 80) {
        addLog(`[MitID Portal] Signature validated successfully for Dane-id: CPR-140683-XXXX.`);
      }

      if (curr >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          const mockCode = 'auth_' + generateRandomString(16);
          setAuthCode(mockCode);
          setStep('callback');
          addLog(`[Authorization] Authentication successful! Redirecting back to cirkel redirect_uri...`);
          addLog(`[Callback] Intercepted redirect payload: code=${mockCode.substring(0, 10)}..., state=${stateParam}`);
        }, 500);
      }
    }, 150);
  };

  const triggerTokenExchange = () => {
    setStep('token_exchange');
    addLog(`[Token Exchange] Dispatching POST request to /oauth2/token on backend server proxy path.`);
    addLog(`[Token Exchange] Sending: code_verifier=${codeVerifier.substring(0, 8)}..., code=${authCode.substring(0, 8)}...`);
    
    setTimeout(() => {
      const mockToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.' + btoa(JSON.stringify({
        sub: "mitid:c08fc45a-38bb-4a7b",
        name: username.endsWith(' (MitID)') ? username : `${username} (MitID)`,
        cpr_uuid: "6e28ef91-ba4a-449e-b9b0-9fcd18b260cf",
        iss: "https://auth.mitid.dk",
        aud: "cirkel-web-app",
        exp: Math.floor(Date.now() / 1000) + 3600,
        municipality: "Aarhus Kommune"
      }));
      
      setAccessToken('acc_tok_' + generateRandomString(24));
      setIdTokenPayload({
        iss: "https://auth.mitid.dk",
        aud: "cirkel-web-app",
        sub: "mitid:danid-491-039-2a",
        fullName: username.endsWith(' (MitID)') ? username : `${username} (MitID)`,
        email: `${username.toLowerCase().replace(/\s+/g, '')}@mitid-bruger.dk`,
        cpr_match: "TRUE (Valid)",
        loa: "Substantial (Level 3)",
        acr: "https://data.gov.dk/level3"
      });
      addLog(`[Token Exchange] Received response 200 OK.`);
      addLog(`[Token Exchange] Access token established. Decrypted Identity Claims confirmed.`);
      
      setStep('success');
    }, 1500);
  };

  const handleComplete = () => {
    // Produce profile structure consistent with the login handler
    const profile: UserProfile = {
      id: idTokenPayload?.sub || 'user-mitid-mock-id',
      fullName: idTokenPayload?.fullName || `${username} (MitID)`,
      email: idTokenPayload?.email || 'mads.mitid@cirkel.dk',
      isLoggedIn: true,
      municipality: 'Aarhus Kommune',
      balance: 247.50,
      points: 2140,
      scansCount: 892,
      co2SavedKg: 127.0,
      streakDays: 14,
      level: 12,
      memberStatus: 'Guld-medlem',
      verificationTier: 'mitid',
      isMitIDVerified: true,
    };
    
    // Save to offline storage Cache for robustness
    localStorage.setItem('cirkel_user', JSON.stringify(profile));
    onSuccess(profile);
  };

  return (
    <div className="fixed inset-0 bg-primary/70 backdrop-blur-md flex items-center justify-center p-4 z-55 select-none overflow-y-auto">
      <motion.div
        initial={{ scale: 0.95, y: 15, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 10, opacity: 0 }}
        className="bg-white rounded-[2rem] border border-slate-200 p-6.5 max-w-lg w-full shadow-2xl relative overflow-hidden text-left"
      >
        {/* MitID Top Bar decoration */}
        <div className="h-1.5 bg-gradient-to-r from-[#002b49] via-[#005c8a] to-[#008cc3] absolute top-0 left-0 right-0" />

        {/* Header bar */}
        <div className="flex justify-between items-center mb-5 mt-1 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-[#002b49] rounded-lg flex items-center justify-center text-white text-xs font-serif font-black shadow-2xs">🔑</span>
            <span className="text-lg font-black tracking-tight text-[#002b49]">MitID Secure Auth Proxy (PKCE)</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] bg-slate-100 text-slate-500 hover:text-slate-700 font-extrabold tracking-wider uppercase px-2.5 py-1 rounded-lg cursor-pointer"
          >
            Luk
          </button>
        </div>

        {/* Step-by-Step UI Panels */}
        <AnimatePresence mode="wait">
          
          {/* STEP 1: INITIALIZE / DISCOVERY */}
          {step === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-4 text-left"
            >
              <div>
                <h4 className="text-sm font-black text-[#002b49] uppercase tracking-wider">PKCE Client-Side Initialization</h4>
                <p className="text-[10px] text-slate-500 font-bold mt-1">
                  En ægte MitID login-transaktion benytter Proof Key for Code Exchange (OAuth 2.1), hvilket sikrer imod intercepting-angreb på offentlige netværk.
                </p>
              </div>

              {/* Cryptographic metadata sandbox */}
              <div className="bg-slate-900 rounded-2xl p-4 font-mono text-[9px] text-[#c8f24a] border border-slate-950 shadow-inner flex flex-col gap-2.5">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <Terminal className="w-3 h-3" /> CLIENT METADATA
                  </span>
                  <span className="text-[8px] font-black bg-emerald-950 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded-sm">SECURE</span>
                </div>
                
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">client_id:</span>
                    <span className="font-bold text-white">cirkel-web-app</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">scope:</span>
                    <span className="font-bold text-white">openid profile cpr email</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">redirect_uri:</span>
                    <span className="font-bold text-white">https://cirkel.dk/oidc/callback</span>
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-2.5 flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">code_verifier (Salted):</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-semibold truncate max-w-[140px]">{codeVerifier}</span>
                      <button 
                        type="button" 
                        onClick={() => copyToClipboard(codeVerifier, 'verifier')}
                        className="p-1 hover:bg-slate-800 rounded bg-slate-850 border border-slate-700 cursor-pointer text-slate-300"
                      >
                        {copiedText === 'verifier' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">code_challenge (S256):</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-semibold truncate max-w-[140px]">{codeChallenge}</span>
                      <button 
                        type="button" 
                        onClick={() => copyToClipboard(codeChallenge, 'challenge')}
                        className="p-1 hover:bg-slate-800 rounded bg-slate-850 border border-slate-700 cursor-pointer text-slate-300"
                      >
                        {copiedText === 'challenge' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">state (CSRF prevention):</span>
                    <span className="text-white font-semibold">{stateParam}</span>
                  </div>
                </div>
              </div>

              {/* Input for user */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">MitID Bruger-ID</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="E.g. Mads Hansen, soren_kierkegaard"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm text-[#002b49] focus:bg-white focus:border-[#002b49] outline-none font-bold transition-all placeholder-slate-400"
                  autoFocus
                />
              </div>

              <div className="bg-sky-50 border border-sky-150 p-3 rounded-xl flex gap-2.5 items-start">
                <ShieldCheck className="w-4.5 h-4.5 text-[#008cc3] shrink-0 mt-0.5" />
                <p className="text-[9px] font-semibold text-[#005c8a] leading-relaxed">
                  <strong>Sandbox Integration:</strong> Indtast dit foretrukne kaldenavn. MitID-flowet vil derefter simulere et sikkert PKCE token callback og logge dig ind.
                </p>
              </div>

              <button
                type="button"
                onClick={handleStartLogin}
                disabled={!username.trim()}
                className="w-full bg-[#002b49] disabled:opacity-50 hover:bg-[#001D33] text-white font-extrabold text-xs py-3.5 rounded-xl transition-all shadow-md mt-2 tracking-wide flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Log ind med MitID</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* STEP 2: AUTHORIZING OVERLAY ON PORTAL */}
          {step === 'authorizing' && (
            <motion.div
              key="authorizing"
              className="flex flex-col items-center text-center gap-5 py-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="relative w-16 h-16 rounded-full bg-[#002b49]/5 flex items-center justify-center text-[#002b49]">
                <RefreshCw className="w-8 h-8 stroke-[2.5] animate-spin" />
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#002b49]/20 animate-spin" style={{ animationDuration: '6s' }} />
              </div>

              <div>
                <h4 className="text-base font-black text-[#002b49]">Godkend i MitID Appen</h4>
                <p className="text-xs text-slate-500 font-semibold px-4 mt-1">
                  Åben din officielle MitID mobil-app eller find din elektroniske nøglebrik for at bekræfte anmodningen.
                </p>
              </div>

              {/* Secure code visualization */}
              <div className="bg-[#f8fafc] border border-slate-200 p-4.5 rounded-2xl w-full flex flex-col items-center justify-center gap-1 shadow-2xs">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">MitID Sikkerhedskode</span>
                <span className="text-3xl font-black font-mono tracking-widest text-[#002b49] mt-1">6839</span>
              </div>

              {/* Simulation progress bar */}
              <div className="w-full flex flex-col gap-1.5 px-1 mt-1">
                <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                  <span>Signeringsstatus</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#002b49] transition-all duration-150" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Afventer kryptografisk underskrift over Websocket tunnel...</span>
              </div>

              {/* Telemetry log preview */}
              <div className="w-full bg-slate-900 rounded-xl p-3 text-left font-mono text-[7.5px] text-slate-400 max-h-24 overflow-y-auto mt-1 border border-slate-950 flex flex-col gap-1.5">
                {logs.slice(-3).map((log, li) => (
                  <div key={li} className="leading-tight border-b border-slate-800/60 pb-1 last:border-b-0 last:pb-0">{log}</div>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 3: CALLBACK REDIRECT */}
          {step === 'callback' && (
            <motion.div
              key="callback"
              className="flex flex-col gap-4"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
            >
              <div>
                <h4 className="text-sm font-black text-emerald-800 uppercase tracking-wider">Callback Modtaget vha state</h4>
                <p className="text-[10px] text-slate-500 font-bold mt-1">
                  Portalen har bekræftet din identitet og omdirigeret browseren tilbage til Cirkel med en tidsbegrænset Authorization Code.
                </p>
              </div>

              <div className="bg-slate-900 rounded-2xl p-4 font-mono text-[9px] text-[#c8f24a] border border-slate-950 shadow-inner flex flex-col gap-2.5">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <FileCode2 className="w-3 h-3" /> REDIRECT INTERACTION
                  </span>
                  <span className="text-[8px] font-black bg-emerald-950 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded-sm">INTERCEPTED</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">state matched:</span>
                    <span className="font-bold text-white flex items-center gap-1">
                      {stateParam} <span className="text-emerald-400 text-[8px] font-sans">✓ OK</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">auth_code parameter:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white lg:font-bold truncate max-w-[140px]">{authCode}</span>
                      <button 
                        type="button" 
                        onClick={() => copyToClipboard(authCode, 'code')}
                        className="p-1 hover:bg-slate-800 rounded bg-slate-850 border border-slate-700 cursor-pointer text-slate-300"
                      >
                        {copiedText === 'code' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                Appen vil nu indsende authorization_code ryg-mod-ryg sammen med den oprindelige <strong>code_verifier</strong> til Token End-point for at modtage dine signerede token påstande.
              </p>

              <button
                type="button"
                onClick={triggerTokenExchange}
                className="w-full bg-[#005c8a] hover:bg-[#004b70] text-accent font-extrabold text-xs py-3.5 rounded-xl transition-all shadow-md mt-1 tracking-wide flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Byt Kode Til Token (PKCE)</span>
                <RefreshCw className="w-4 h-4 animate-spin-slow" />
              </button>
            </motion.div>
          )}

          {/* STEP 4: TOKEN EXCHANGE ACTIONS */}
          {step === 'token_exchange' && (
            <motion.div
              key="token_exchange"
              className="flex flex-col items-center text-center gap-5 py-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="relative w-14 h-14 rounded-full bg-sky-50 flex items-center justify-center text-[#005c8a]">
                <RefreshCw className="w-7 h-7 stroke-[2.5] animate-spin text-[#005c8a]" />
              </div>

              <div>
                <h4 className="text-base font-black text-[#002b49]">Indløser Token via secure channel...</h4>
                <p className="text-xs text-slate-500 font-semibold px-4 mt-1">
                  Validerer code_verifier mod den oprindelige SHA-256 hash-udfordring sendt under trin et.
                </p>
              </div>

              <div className="w-full bg-slate-950 p-3 rounded-xl border border-slate-900 text-left text-orange-400 font-mono text-[7px] flex flex-col gap-1">
                <div>&gt; Sending POST request to /oauth2/token</div>
                <div>&gt; Content-Type: application/x-www-form-urlencoded</div>
                <div className="text-slate-500">&gt; code_verifier = {codeVerifier.substring(0, 16)}...</div>
                <div className="text-slate-500">&gt; client_id = cirkel-web-app</div>
                <div>&gt; Status: 100 Continue (Verifying checksum matching...)</div>
              </div>
            </motion.div>
          )}

          {/* STEP 5: SUCCESSFUL LOGIN */}
          {step === 'success' && (
            <motion.div
              key="success"
              className="flex flex-col gap-4 text-left"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="flex gap-3 items-center">
                <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg">
                  <CheckCircle className="w-6 h-6 stroke-[3]" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-emerald-900 uppercase tracking-wider leading-none">Login Godkendt!</h4>
                  <span className="text-[10px] text-slate-400 font-black font-mono">ID TOKEN EXCHANGE SUCCESSFUL</span>
                </div>
              </div>

              {/* Claims visualization panel */}
              <div className="bg-slate-900 rounded-2xl p-4 font-mono text-[9px] text-[#c8f24a] border border-slate-950 shadow-inner flex flex-col gap-2.5">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <Lock className="w-3 h-3" /> IDENTITY CLAIMS (JWT)
                  </span>
                  <span className="text-[8px] font-black bg-emerald-950 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded-sm">SIGNED</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">name:</span>
                    <span className="font-bold text-white">{idTokenPayload?.fullName}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">email:</span>
                    <span className="font-bold text-white">{idTokenPayload?.email}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">sub:</span>
                    <span className="font-bold text-white text-[8px]">{idTokenPayload?.sub}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">loa_level:</span>
                    <span className="font-bold text-emerald-400">{idTokenPayload?.loa}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-400">issuer:</span>
                    <span className="font-bold text-slate-300">{idTokenPayload?.iss}</span>
                  </div>
                </div>
              </div>

              <div className="bg-[#f0fdf4] border border-emerald-150 p-3 rounded-xl flex gap-2.5 items-start">
                <CheckCircle className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[9px] font-semibold text-emerald-800 leading-relaxed">
                  <strong>Klar til afgang:</strong> Cirkels wallet, pointberegner og sikkerhedsledger er synkroniseret med din nye MitID profil. God fornøjelse med panten!
                </p>
              </div>

              <button
                type="button"
                onClick={handleComplete}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all shadow-md tracking-wide flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Fortsæt til appen</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
