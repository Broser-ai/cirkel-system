import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Key, Database, RefreshCw, Check, Copy, Sparkles, BookOpen, 
  ArrowRight, Server, Play, Code, Cpu, ShieldCheck, Layers, HelpCircle
} from 'lucide-react';
import { triggerHaptic, HapticPattern } from '../lib/haptics';

interface EnterpriseCrmCirkelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddLog?: (service: string, msg: string, type: 'info' | 'success' | 'warn' | 'error') => void;
}

type CrmPlatform = 'salesforce' | 'hubspot' | 'dynamics' | 'custom_web';
type DocLanguage = 'curl' | 'nodejs' | 'apex' | 'python';

interface CrmKey {
  id: string;
  name: string;
  crmType: CrmPlatform;
  key: string;
  scopes: string[];
  createdAt: string;
  status: 'active' | 'suspended';
}

export default function EnterpriseCrmCirkelModal({ isOpen, onClose, onAddLog }: EnterpriseCrmCirkelModalProps) {
  const [selectedCrm, setSelectedCrm] = useState<CrmPlatform>('salesforce');
  const [selectedLang, setSelectedLang] = useState<DocLanguage>('nodejs');
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [copiedDoc, setCopiedDoc] = useState<boolean>(false);
  
  // Custom API Key Generation State
  const [newKeyName, setNewKeyName] = useState<string>('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['scans:read', 'loyalty:write']);
  
  // Persistent or initial key state
  const [crmKeys, setCrmKeys] = useState<CrmKey[]>([
    {
      id: 'key-1',
      name: 'Salesforce Marketing Cloud Sync',
      crmType: 'salesforce',
      key: 'cirkel_crm_sf_7f3b909df92d40e2b92f7ea2',
      scopes: ['scans:read', 'loyalty:write'],
      createdAt: '2026-05-18 Z',
      status: 'active'
    },
    {
      id: 'key-2',
      name: 'HubSpot Sustainable Loyalty Trigger',
      crmType: 'hubspot',
      key: 'cirkel_crm_hs_c8a9d10e0f2f3d91ea4489a1',
      scopes: ['scans:read', 'users:sync'],
      createdAt: '2026-06-02 Z',
      status: 'active'
    }
  ]);

  // Sandbox Live Stream Simulator States
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'sending' | 'synced' | 'error'>('idle');
  const [sandboxLogs, setSandboxLogs] = useState<any[]>([]);
  const [simulatedMaterial, setSimulatedMaterial] = useState<string>('Arla Økologisk Letmælk 1L (Karton)');
  const [simulatedPoints, setSimulatedPoints] = useState<number>(20);

  if (!isOpen) return null;

  const toggleScope = (scope: string) => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.LIGHT_TAP);
    if (selectedScopes.includes(scope)) {
      setSelectedScopes(prev => prev.filter(s => s !== scope));
    } else {
      setSelectedScopes(prev => [...prev, scope]);
    }
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.SCAN_SUCCESS);

    const prefix = selectedCrm === 'salesforce' ? 'sf' : selectedCrm === 'hubspot' ? 'hs' : selectedCrm === 'dynamics' ? 'ms' : 'cw';
    const randomHex = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const generatedKey = `cirkel_crm_${prefix}_${randomHex}`;

    const newKeyRecord: CrmKey = {
      id: `key-${Date.now()}`,
      name: newKeyName,
      crmType: selectedCrm,
      key: generatedKey,
      scopes: [...selectedScopes],
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' Z',
      status: 'active'
    };

    setCrmKeys(prev => [newKeyRecord, ...prev]);
    setNewKeyName('');
    
    if (onAddLog) {
      onAddLog('CRM_CONNECT', `Ny CRM-nøgle '${newKeyRecord.name}' oprettet til ${selectedCrm.toUpperCase()}.`, 'success');
    }

    const toast = (window as any).showToast;
    if (toast) toast(`CRM-nøgle oprettet for ${selectedCrm.toUpperCase()}!`, 'success');
  };

  const handleDeleteKey = (id: string, name: string) => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.HEAVY_TAP);
    setCrmKeys(prev => prev.filter(k => k.id !== id));
    if (onAddLog) {
      onAddLog('CRM_CONNECT', `Slettede CRM-integrationstoken: '${name}'.`, 'warn');
    }
    const toast = (window as any).showToast;
    if (toast) toast('Integrationstoken slettet', 'info');
  };

  const handleCopyKey = (keyId: string, keyValue: string) => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.LIGHT_TAP);
    navigator.clipboard.writeText(keyValue);
    setCopiedKeyId(keyId);
    setTimeout(() => setCopiedKeyId(null), 2000);
    const toast = (window as any).showToast;
    if (toast) toast('API-nøgle kopieret til udklipsholder!', 'success');
  };

  const handleCopyDoc = (text: string) => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.LIGHT_TAP);
    navigator.clipboard.writeText(text);
    setCopiedDoc(true);
    setTimeout(() => setCopiedDoc(false), 2050);
    const toast = (window as any).showToast;
    if (toast) toast('Dokumentationskode kopieret!', 'success');
  };

  // Run dynamic sync simulation to mimic a client scan pushing straight into high-value CRMs
  const handleSimulateSync = () => {
    if (typeof triggerHaptic === 'function') triggerHaptic(HapticPattern.SCAN_SUCCESS);
    setSimulationStatus('sending');
    
    const startTimeString = new Date().toLocaleTimeString();
    const mockId = Math.floor(Math.random() * 90000) + 10000;
    const mockEmail = `citizen.${Math.random().toString(36).substring(2, 6)}@aarhus.dk`;

    const initialLog = {
      time: startTimeString,
      step: 'EVENT_CAPTURE',
      type: 'info',
      msg: `[Cirkel Webhook] Borger scannede og returnerede 1x ${simulatedMaterial}. Registrerer hændelse ID #${mockId}...`
    };

    setSandboxLogs([initialLog]);

    setTimeout(() => {
      const step2Log = {
        time: new Date().toLocaleTimeString(),
        step: 'CRM_RESOLUTION',
        type: 'info',
        msg: `Søger efter eksisterende CRM-kontakt via krypteret email-hash: [${mockEmail}]...`
      };
      setSandboxLogs(prev => [...prev, step2Log]);
    }, 700);

    setTimeout(() => {
      // Create specific CRM resolution log
      let detailLog = '';
      if (selectedCrm === 'salesforce') {
        detailLog = `Salesforce Marketing Cloud Match: Fundet kundenøgle 'Contact_0018f0003KaZ4A'. Opretter tilhørende 'Sustained_Recycling__c' Custom Object.`;
      } else if (selectedCrm === 'hubspot') {
        detailLog = `HubSpot API: Match fundet (V9 Contact ID: 'hs_8492019'). Trigger custom workflow event 'cirkel_recycling_scan_event'.`;
      } else if (selectedCrm === 'dynamics') {
        detailLog = `Microsoft Dynamics 365 Dataverse: Oprettet 'crk_carbon_saving' record med 185g CO2 credit linket til SystemUser ID: 'ms-8s29a'.`;
      } else {
        detailLog = `Udsteder webhook payload med JSON event stream til godkendt callback endpoint. Http status 200 OK modtaget.`;
      }

      const step3Log = {
        time: new Date().toLocaleTimeString(),
        step: 'CRM_OBJECT_PERSISTENCE',
        type: 'success',
        msg: detailLog
      };
      setSandboxLogs(prev => [...prev, step3Log]);
    }, 1400);

    setTimeout(() => {
      const step4Log = {
        time: new Date().toLocaleTimeString(),
        step: 'LOYALTY_SYNC_OK',
        type: 'success',
        msg: `Loyalitets-synkronisering færdig! Tilskrev +${simulatedPoints} Eco-Points direkte til borgerens profil i jeres interne CRM-database. Grønt ESG-aftryk opdateret!`
      };
      setSandboxLogs(prev => [...prev, step4Log]);
      setSimulationStatus('synced');
      
      if (onAddLog) {
        onAddLog('CRM_CONNECT', `Simuleret CRM-synkronisering fuldført: ${simulatedMaterial} -> ${selectedCrm.toUpperCase()}`, 'success');
      }
    }, 2100);
  };

  const codeSnippets = {
    nodejs: {
      title: 'Node.js (TypeScript)',
      code: `import express from 'express';
import { verifyCirkelSignature } from '@cirkel/sdk';

const app = express();
app.use(express.json());

// API route der modtager Cirkel scanhændelser direkte
app.post('/api/cirkel-crm-webhook', async (req, res) => {
  const signature = req.headers['cirkel-signature'];
  const endpointSecret = process.env.CIRKEL_WEBHOOK_SECRET;

  // 1. Valider signalet for at sikre det kommer sikkert fra Cirkel
  const isValid = verifyCirkelSignature(req.body, signature, endpointSecret);
  if (!isValid) {
    return res.status(401).send('Uautoriseret forespørgsel');
  }

  const { eventType, data } = req.body;

  if (eventType === 'scan.returned') {
    const { citizenEmailHash, pointsEarned, materialWeightGrams, productName } = data;
    
    console.log(\`[Cirkel Connect] Borger har afleveret \${productName} (\${materialWeightGrams}g)\`);

    try {
      // 2. Synkroniser direkte med jeres CRM
      await updateCrmContactLoyalty({
        emailHash: citizenEmailHash,
        points: pointsEarned,
        co2SavedKg: materialWeightGrams * 0.001 * 1.5 // Multiplikator
      });
      
      return res.status(200).json({ status: 'synced_with_crm' });
    } catch (err) {
      console.error('CRM Synkroniseringsfejl:', err);
      return res.status(500).send('Intern CRM fejl');
    }
  }

  res.status(200).send('Hændelse ignoreret');
});`
    },
    curl: {
      title: 'REST API via cURL',
      code: `# Anmod om liste over de seneste scanningshændelser for jeres tilknyttede brand
curl -X GET "https://api.cirkel.dk/v1/enterprise/scans?limit=5" \\
  -H "Authorization: Bearer ${crmKeys.find(k => k.crmType === selectedCrm)?.key || 'cirkel_crm_token_not_found'}" \\
  -H "Content-Type: application/json"`
    },
    apex: {
      title: 'Salesforce Apex (REST Resource)',
      code: `@RestResource(urlMapping='/cirkel/scans/*')
global with sharing class CirkelScanCrmSyncService {

    @HttpPost
    global static void handleIncomingEvent() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        
        String requestBody = req.requestBody.toString();
        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(requestBody);
        
        // Uddrag felter fra Cirkel's data stream
        String crmContactHash = (String) payload.get('citizenEmailHash');
        Integer points = (Integer) payload.get('pointsEarned');
        String productName = (String) payload.get('productName');

        // Søg og opdater Salesforce Loyalty / Contact record
        List<Contact> contacts = [SELECT Id, Cirkel_Points__c FROM Contact WHERE Email_Hash__c = :crmContactHash LIMIT 1];
        if (!contacts.isEmpty()) {
            Contact citizen = contacts[0];
            citizen.Cirkel_Points__c = (citizen.Cirkel_Points__c == null ? 0 : citizen.Cirkel_Points__c) + points;
            update citizen;

            // Opret Log-hændelse for CSRD sporing
            Sustained_Recycling__c log = new Sustained_Recycling__c();
            log.Contact__c = citizen.Id;
            log.Product_Scanned__c = productName;
            log.Points_Awarded__c = points;
            insert log;
            
            res.statusCode = 200;
            res.responseBody = Blob.valueOf('{"status": "salesforce_synced"}');
        } else {
            res.statusCode = 404;
            res.responseBody = Blob.valueOf('{"error": "Contact mapping missing"}');
        }
    }
}`
    },
    python: {
      title: 'Python (HubSpot REST)',
      code: `import requests
import hashlib

# Cirkel Event sync til HubSpot Pipeline
def sync_cirkel_event_to_hubspot(event_payload, api_token):
    # API adgangsstyring
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }

    citizen_hash = event_payload['data']['citizenEmailHash']
    points_to_add = event_payload['data']['pointsEarned']
    material_type = event_payload['data']['materialType']

    # HubSpot v3 Custom Events API endpoint
    hubspot_url = "https://api.hubapi.com/crm/v3/objects/contacts/search"
    search_query = {
        "filterGroups": [{
            "filters": [{
                "propertyName": "cirkel_email_hash",
                "operator": "EQ",
                "value": citizen_hash
            }]
        }]
    }

    # 1. Lokoliser den rigtige HubSpot-kontakt
    response = requests.post(hubspot_url, json=search_query, headers=headers)
    if response.status_code == 200:
        results = response.json().get('results', [])
        if results:
            contact_id = results[0]['id']
            current_points = int(results[0]['properties'].get('eco_loyalty_points', '0'))
            
            # 2. Patch kontaktens eco-loyalty data direkte
            update_url = f"https://api.hubapi.com/crm/v3/objects/contacts/{contact_id}"
            patch_data = {
                "properties": {
                    "eco_loyalty_points": str(current_points + points_to_add),
                    "last_recycled_material": material_type
                }
            }
            requests.patch(update_url, json=patch_data, headers=headers)
            print("HubSpot CRM opdateret med grøn eco-loyalty.")
            return True

    print("Kunne ikke matche borger med HubSpot CRM kontakt.")
    return False`
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-[#001424]/45 backdrop-blur-md z-50 flex items-center justify-center p-3 select-none">
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="bg-white rounded-3xl border border-gray-200/90 shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col font-sans"
        >
          
          {/* Header Banner - Distinct Dark Style consistent with B2B Connect brand */}
          <div className="bg-gradient-to-r from-primary to-[#00223b] text-white px-6 py-5 flex justify-between items-center relative">
            <div className="absolute top-0 right-0 w-44 h-full bg-[#C8F24A]/5 rounded-bl-full pointer-events-none" />
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-black tracking-widest text-[#C8F24A] bg-[#C8F24A]/10 border border-[#C8F24A]/25 px-2 py-0.5 rounded uppercase font-mono">
                  Enterprise Node Co-Pilot
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <h2 className="text-lg font-black tracking-tight mt-1 text-white flex items-center gap-2">
                <Cpu className="text-[#C8F24A] w-5 h-5 animate-pulse" />
                Intern CRM-Integration & API Dokumentationsværktøj
              </h2>
            </div>
            
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                onClose();
              }}
              className="bg-white/10 hover:bg-white/20 text-white/85 hover:text-white p-2 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Container Body split into Left Panel scroll (Config + Docs) and Right Panel (Simulator) */}
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-150">
            
            {/* Left Portion: Docs & Key builder (7 cols) */}
            <div className="lg:col-span-7 p-6 overflow-y-auto flex flex-col gap-6 text-left">
              
              {/* Introduction statement */}
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-2">
                  <BookOpen className="w-4.5 h-4.5 text-[#85A912]" />
                  Hub For Sorteringsstrøm & Loyalitet
                </h3>
                <p className="text-xs font-semibold text-gray-500 leading-relaxed">
                  Forbind Cirkels decentraliserede emballagesensor- og QR-logningsstrøm direkte ind i jeres virksomheds CRM-systemer. Herved kan I belønne forbrugere for dokumenteret cirkulær returadfærd og opdatere jeres CSRD-scope 3 data i realtid.
                </p>
              </div>

              {/* Step 1: Select Platforms */}
              <div className="bg-gray-50 border border-gray-150 p-4 rounded-2xl flex flex-col gap-3">
                <span className="text-[10px] font-black text-primary/70 uppercase tracking-widest block font-sans">
                  Trin 1: Vælg jeres eksisterende CRM-platform
                </span>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'salesforce', label: 'Salesforce', icon: '☁️', desc: 'Marketing Cloud & Core CRM' },
                    { id: 'hubspot', label: 'HubSpot', icon: '🧡', desc: 'Loyalty Trigger & workflows' },
                    { id: 'dynamics', label: 'MS Dynamics 365', icon: '⚙️', desc: 'Dataverse & Microsoft CRM' },
                    { id: 'custom_web', label: 'Custom SDK/API', icon: '📡', desc: 'Webhooks & REST APIs' }
                  ].map((p) => {
                    const isSelected = selectedCrm === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setSelectedCrm(p.id as CrmPlatform);
                        }}
                        className={`p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-between gap-1.5 h-26 hover:scale-102 ${
                          isSelected 
                            ? 'bg-primary text-white border-primary shadow-sm' 
                            : 'bg-white text-primary border-gray-200/90 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-lg">{p.icon}</span>
                        <div className="flex flex-col">
                          <span className="text-[10.5px] font-black leading-tight">{p.label}</span>
                          <span className={`text-[8px] mt-0.5 max-w-[90px] mx-auto text-ellipsis overflow-hidden ${isSelected ? 'text-indigo-200' : 'text-gray-450'}`}>{p.desc}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Key Generator with scopes */}
              <div className="bg-white border border-gray-150 rounded-2xl p-4.5 flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-black text-primary/70 uppercase tracking-widest block font-sans">
                      Trin 2: Opret adgangsnøgle (API-Credentials)
                    </span>
                    <p className="text-[10.5px] text-gray-450 mt-0.5">Godkend specifikke adgangsniveauer og opbyg sikre tokens.</p>
                  </div>
                </div>

                <form onSubmit={handleCreateKey} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5 text-left">
                    <label className="text-[8.5px] font-black text-gray-550 uppercase">Navn på Integration/Token</label>
                    <input
                      type="text"
                      className="border border-gray-250 px-3.5 py-2.5 text-xs rounded-xl outline-none text-slate-800 font-bold"
                      placeholder="F.eks. Salesforce loyalty sync event"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                  </div>

                  {/* Scopes choice selection */}
                  <div>
                    <label className="text-[8.5px] font-black text-gray-550 uppercase block mb-1.5 text-left">Tildelte Rettighedsområder (OAuth-Scopes)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { scope: 'scans:read', label: 'Læs scanhændelser', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                        { scope: 'loyalty:write', label: 'Opdater CRM-point', color: 'bg-emerald-50 border-emerald-250 text-emerald-800' },
                        { scope: 'users:sync', label: 'E-mail kontakt-matching', color: 'bg-amber-50 border-amber-250 text-amber-850' }
                      ].map((item) => {
                        const isGranted = selectedScopes.includes(item.scope);
                        return (
                          <button
                            type="button"
                            key={item.scope}
                            onClick={() => toggleScope(item.scope)}
                            className={`px-3 py-2 rounded-xl text-[10px] font-black border transition-all cursor-pointer uppercase flex items-center justify-between gap-1 ${
                              isGranted 
                                ? `${item.color} shadow-xs border-2` 
                                : 'bg-gray-50 border-gray-200 text-gray-400 hover:text-gray-650'
                            }`}
                          >
                            <span>{item.label}</span>
                            <span className="text-[8px] font-mono opacity-80">{isGranted ? '✓' : '+'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!newKeyName.trim()}
                    className={`w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider transition-all select-none flex items-center justify-center gap-1 cursor-pointer ${
                      newKeyName.trim() 
                        ? 'bg-[#C8F24A] text-slate-900 border border-slate-950/10 shadow-xs hover:bg-[#b5db3b]' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200'
                    }`}
                  >
                    Opret Sikker CRM Token <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>

                {/* List of active keys */}
                <div className="border-t border-gray-150 pt-4 text-left">
                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest block mb-2.5">
                    Aktive CRM-Nøgler ({crmKeys.filter(k => k.crmType === selectedCrm).length} for {selectedCrm.toUpperCase()})
                  </span>

                  <div className="flex flex-col gap-2.5 max-h-34 overflow-y-auto pr-1">
                    {crmKeys.filter(k => k.crmType === selectedCrm).length === 0 ? (
                      <div className="text-[10px] font-bold text-gray-400 text-center py-4 bg-slate-50 rounded-xl border border-dotted border-gray-200">
                        Ingen aktive API-nøgler oprettet til denne platform endnu.
                      </div>
                    ) : (
                      crmKeys.filter(k => k.crmType === selectedCrm).map((k) => (
                        <div key={k.id} className="bg-slate-50 border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row justify-between sm:items-center gap-2 text-xs">
                          <div className="flex flex-col gap-0.5 text-left">
                            <span className="font-extrabold text-primary">{k.name}</span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[9px] text-gray-500">
                              <span className="bg-gray-200/80 px-1.5 py-0.2 rounded font-bold">{k.key.substring(0, 14)}...</span>
                              <span>·</span>
                              <span>Scopes: {k.scopes.join(', ')}</span>
                            </div>
                          </div>

                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => handleCopyKey(k.id, k.key)}
                              className="bg-white hover:bg-gray-100 border border-gray-200 text-gray-650 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all"
                            >
                              {copiedKeyId === k.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  Kopieret
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  Kopier
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => handleDeleteKey(k.id, k.name)}
                              className="bg-rose-50 hover:bg-rose-100 border border-rose-150 text-rose-700 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all"
                            >
                              Slet
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Step 3: Interactive Developer Code Documentation */}
              <div className="bg-slate-900 border border-slate-950 rounded-2xl p-5 text-left flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <div>
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block font-sans">
                      Trin 3: Integrationskode og API SDK-Dokumentation
                    </span>
                    <h4 className="text-sm font-black text-white mt-0.5">Integrationsvejledning & Event-hooks</h4>
                  </div>
                  
                  {/* Language selectors */}
                  <div className="flex rounded-lg bg-black/40 p-1 border border-slate-800">
                    {(['nodejs', 'curl', 'apex', 'python'] as DocLanguage[]).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => {
                          triggerHaptic(HapticPattern.LIGHT_TAP);
                          setSelectedLang(lang);
                        }}
                        className={`text-[9px] font-black px-2.5 py-1 rounded-md transition-all cursor-pointer uppercase ${
                          selectedLang === lang 
                            ? 'bg-slate-850 text-[#C8F24A] font-extrabold shadow-xs' 
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {lang === 'nodejs' ? 'Node.js' : lang === 'curl' ? 'cURL' : lang === 'apex' ? 'Apex / SF' : 'Python'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Markdown Code Viewer Panel */}
                <div className="relative">
                  {/* Copy snippet button */}
                  <button
                    onClick={() => handleCopyDoc(codeSnippets[selectedLang].code)}
                    className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[9px] text-[#C8F24A] font-black px-3 py-1.5 rounded-lg cursor-pointer transition-all select-none uppercase z-10"
                  >
                    {copiedDoc ? '✓ Kopieret!' : 'Kopier kode 📋'}
                  </button>

                  <div className="bg-slate-950 rounded-xl p-4 overflow-x-auto border border-slate-900 max-h-72">
                    <pre className="font-mono text-[10.5px] leading-relaxed text-slate-350 text-left select-all">
                      <code>{codeSnippets[selectedLang].code}</code>
                    </pre>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-[10px] text-slate-450 leading-relaxed font-semibold bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                  <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <p>
                    <strong className="text-indigo-300">Crypto Signature Verification:</strong> Alle realtids-webhooks sendes krypteret med en <code className="text-slate-200">cirkel-signature</code> header baseret på SHA-256 HMAC for at modvirke man-in-the-middle forfalskninger.
                  </p>
                </div>
              </div>

            </div>

            {/* Right Portion: Simulated Live Stream Sandbox (5 cols) */}
            <div className="lg:col-span-5 p-6 bg-slate-50/50 flex flex-col gap-5 text-left">
              
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black text-[#85A912] uppercase tracking-wider block">Integrations-sandbox</span>
                <h3 className="text-sm font-black text-primary uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-4.5 h-4.5 text-accent animate-pulse text-[#85A912] fill-[#85A912]/10" />
                  API Sandbox & Synk-Simulator
                </h3>
                <p className="text-xs font-semibold text-gray-500 leading-snug">
                  Test den fulde data-flow synkronicitet mellem Cirkel IoT sensorstrømmen og jeres valgte CRM-system. Indtast herunder og simuler en borger-aflevering.
                </p>
              </div>

              {/* Configurator Card */}
              <div className="bg-white border border-gray-150 rounded-2xl p-4.5 flex flex-col gap-3.5 shadow-3xs text-left">
                <div className="flex flex-col gap-1 text-left">
                  <label className="text-[8px] font-black text-gray-450 uppercase uppercase">Simuleret Emballage-Materiale</label>
                  <select
                    className="bg-white border border-gray-200 text-xs px-3 py-2 rounded-xl outline-none text-slate-800 font-bold"
                    value={simulatedMaterial}
                    onChange={(e) => setSimulatedMaterial(e.target.value)}
                  >
                    <option value="Arla Økologisk Letmælk 1L (Karton)">Arla Letmælk 1L (Karton)</option>
                    <option value="Coca-Cola Zero 0.5L rPET Flaske">Coca-Cola Zero 0.5L (rPET)</option>
                    <option value="Royal Pilsner Aluminiumsdåse 0.33L">Royal Pilsner (Aluminiums-dåse)</option>
                    <option value="KiMs Havsalt Chips pose (Restaffald)">KiMs Chips pose (Restaffald-folie)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 text-left">
                    <label className="text-[8px] font-black text-gray-450 uppercase">Eco-Bonus Point</label>
                    <input
                      type="number"
                      className="border border-gray-200 text-xs px-3 py-2 rounded-xl outline-none font-bold text-slate-800"
                      value={simulatedPoints}
                      onChange={(e) => setSimulatedPoints(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-left">
                    <label className="text-[8px] font-black text-gray-450 uppercase">CRM Mål-kontakt</label>
                    <span className="font-mono text-xs font-bold text-slate-800 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl truncate block">
                      aarhus_cit_8210
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSimulateSync}
                  disabled={simulationStatus === 'sending'}
                  className="bg-primary hover:bg-[#153147] text-[#C8F24A] font-black text-xs uppercase py-3.5 px-4 rounded-xl shadow-xs transition-all select-none flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current shrink-0" />
                  {simulationStatus === 'sending' ? 'Synkroniserer hændelse...' : 'Simuler Webhook & CRM Synk ⚡'}
                </button>
              </div>

              {/* Console Pipeline Feed */}
              <div className="bg-[#111111] border border-gray-900 rounded-2xl p-4 flex-1 flex flex-col gap-3 text-left">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                  <span className="text-[8.5px] font-black text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    Pipeline Terminal Live-Feed
                  </span>
                  
                  <span className={`text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                    simulationStatus === 'sending' ? 'bg-amber-400/25 text-amber-300 animate-pulse' :
                    simulationStatus === 'synced' ? 'bg-emerald-500/25 text-emerald-400' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {simulationStatus === 'sending' ? 'Sender' : simulationStatus === 'synced' ? 'Synkroniseret' : 'Klar'}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-2 font-mono text-[10px] leading-relaxed max-h-48 lg:max-h-64">
                  {sandboxLogs.length === 0 ? (
                    <div className="text-gray-500 italic flex flex-col items-center justify-center gap-2 h-full py-8 text-center">
                      <Cpu className="w-6 h-6 text-slate-700 animate-spin" style={{ animationDuration: '6s' }} />
                      <span>Ingen aktive data i pipeline.<br />Klik på 'Simuler' for at udløse en API test-forespørgsel.</span>
                    </div>
                  ) : (
                    sandboxLogs.map((log, index) => (
                      <div key={index} className="flex flex-col gap-0.5 font-mono border-b border-white/5 pb-2">
                        <div className="flex justify-between items-center text-[8.5px] text-gray-500 font-mono mb-0.5">
                          <span>{log.time} · {log.step}</span>
                        </div>
                        <span className={`${log.type === 'success' ? 'text-[#C8F24A]' : 'text-gray-300'} text-left text-[9.5px]`}>
                          {log.msg}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Interactive validation status checklist */}
                <div className="border-t border-slate-800 pt-3 mt-1 grid grid-cols-2 gap-2 text-[9px] font-mono text-slate-450 uppercase">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sandboxLogs.length > 0 ? 'bg-[#C8F24A]' : 'bg-slate-700'}`} />
                    Headers verified
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sandboxLogs.length > 2 ? 'bg-[#C8F24A]' : 'bg-slate-700'}`} />
                    CRM mapping OK
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${sandboxLogs.length > 1 ? 'bg-[#C8F24A]' : 'bg-slate-700'}`} />
                    OAuth payload verified
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${simulationStatus === 'synced' ? 'bg-[#C8F24A]' : 'bg-slate-700'}`} />
                    200 Callback Sync
                  </div>
                </div>
              </div>

              {/* Dynamic Success Prompt */}
              {simulationStatus === 'synced' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-emerald-50 border border-emerald-250 p-3.5 rounded-2xl text-[10px] text-emerald-800 font-bold flex gap-2 w-full text-left"
                >
                  <p>
                    🎉 <strong className="text-emerald-950">Synkronisering oprettet!</strong> Cirkels data stream har opnået 100% succesfuld to-vejs match med {selectedCrm.toUpperCase()} i sandkassen. Integrationen kan nu tages i test (Sandbox/Staging) ved hjælp af dokumentationstokenen til venstre.
                  </p>
                </motion.div>
              )}

            </div>

          </div>

          {/* Footer controls */}
          <div className="border-t border-gray-150 p-4.5 bg-gray-50 flex justify-between items-center">
            <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest leading-none">
              CIRKEL SYSTEMS © 2026 Enterprise API
            </span>
            <button
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                onClose();
              }}
              className="bg-primary hover:bg-slate-900 text-white font-black text-[10.5px] uppercase py-2.5 px-5 rounded-xl cursor-pointer"
            >
              Luk integrationsværktøj
            </button>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
}
