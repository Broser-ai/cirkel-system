import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../lib/i18n';
import { triggerHaptic, HapticPattern } from '../lib/haptics';
import { 
  Search, Check, AlertTriangle, HelpCircle, ChevronDown, ChevronUp, 
  Sparkles, Award, Trash2, Info, BookOpen, ThumbsUp, RefreshCw 
} from 'lucide-react';

interface GuideItem {
  id: string;
  nameDa: string;
  nameEn: string;
  category: 'plastics' | 'glass' | 'metals' | 'paper';
  code: string;
  difficultyDa: 'Nem' | 'Middel' | 'Svær';
  difficultyEn: 'Easy' | 'Medium' | 'Hard';
  co2SavedPerKg: number;
  tipsDa: string[];
  tipsEn: string[];
  dosDa: string[];
  dosEn: string[];
  dontsDa: string[];
  dontsEn: string[];
  funFactDa: string;
  funFactEn: string;
  colorClass: string;
  bgGradient: string;
  borderClass: string;
  icon: string;
}

export default function RecyclingGuides() {
  const { language } = useLanguage();
  const isDa = language === 'da';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'plastics' | 'glass' | 'metals' | 'paper'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sorting Checklist/Interactive tool states
  const [checklistState, setChecklistState] = useState<{ [key: string]: boolean }>({
    rinsed: false,
    flattened: false,
    separated: false,
    labelRemoved: false
  });

  // Interactive Quiz game states
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizEnded, setQuizEnded] = useState(false);

  const guides: GuideItem[] = useMemo(() => [
    {
      id: 'g_plastics',
      nameDa: 'Plastik (Plast)',
      nameEn: 'Plastics',
      category: 'plastics',
      code: 'PET (1), HDPE (2), LDPE (4), PP (5)',
      difficultyDa: 'Middel',
      difficultyEn: 'Medium',
      co2SavedPerKg: 1.5,
      tipsDa: [
        'Tøm og skyl emballagen for fødevarer.',
        'Skeln mellem blød plast (folier) og hård plast (bøtter/dunke).',
        'Lad skruelåg sidde på flasker for at undgå at de tabes i sorteringsanlægget.'
      ],
      tipsEn: [
        'Empty and rinse the packaging to remove food residue.',
        'Distinguish between soft plastic (foils) and hard plastic (tubs/bottles).',
        'Leave screw caps on bottles so they do not get lost in the sorting plant.'
      ],
      dosDa: [
        'Rens ketchupflasker, skyrbøtter og kødอ่ะbakker.',
        'Smid blød plast i plastbeholderen (medmindre andet er angivet).',
        'Aflever husholdningsfilm uden madkontaminering.'
      ],
      dosEn: [
        'Clean ketchup bottles, skyr tubs, and meat trays.',
        'Toss soft plastics in the plastic bin (unless specified otherwise).',
        'Recycle household wrap that has no food contamination.'
      ],
      dontsDa: [
        'Ingen flamingokasser (EPS/Polystyren) – skal på genbrugsstationen.',
        'Ingen bioplast (PLA) – det ødelægger det almindelige genanvendelige plast.',
        'Ingen tynde chipsposer, der har metalbelægning på indersiden.'
      ],
      dontsEn: [
        'No styrofoam boxes (EPS) – these must go to the recycling center.',
        'No bioplastic (PLA) – it ruins the normal recyclable plastic streams.',
        'No legacy chips packets with metal coating on the inside.'
      ],
      funFactDa: 'Genanvendelse af ét enkelt ton plastik sparer omkring 1.5 tons CO₂-udledning, hvilket svarer til et års kørsel i en gennemsnitlig personbil!',
      funFactEn: 'Recycling just one ton of plastic saves about 1.5 tons of carbon emissions, equivalent to driving an average car for a whole year!',
      colorClass: 'text-sky-700 bg-sky-50',
      bgGradient: 'from-sky-50 to-sky-100/60',
      borderClass: 'border-sky-150',
      icon: '🥤'
    },
    {
      id: 'g_glass',
      nameDa: 'Glas & Flasker',
      nameEn: 'Glass & Bottles',
      category: 'glass',
      code: 'GL (70, 71, 72)',
      difficultyDa: 'Nem',
      difficultyEn: 'Easy',
      co2SavedPerKg: 0.9,
      tipsDa: [
        'Glas skal være skrabet tomt, men behøver ikke være spejlblankt.',
        'Skru metallåg af syltetøjsglas og put dem i metalbeholderen.',
        'Både farvet og klart glas må i de fleste kommuner blandes.'
      ],
      tipsEn: [
        'Glass should be scraped empty of food, though it does not need to be sparkling clean.',
        'Unscrew metal lids from jam jars and place them in the metal bin.',
        'Both colored and clear glass can be mixed together in most municipalities.'
      ],
      dosDa: [
        'Syltetøjsglas, konservesglas og vinflasker (uden pant).',
        'Smuldrer eller knust emballageglas er okay.',
        'Medtag gerne papiretiketten – den fjernes under smelteprocessen.'
      ],
      dosEn: [
        'Jam jars, food jars, and wine bottles (without deposit/pant).',
        'Cracked or broken packaging glass is perfectly fine to deposit.',
        'Do not worry about paper labels – they are burned off during melting.'
      ],
      dontsDa: [
        'Ingen drikkeglas eller porcelæn (har andre smeltepunkter og ødelægger glasmasse).',
        'Ingen spejle eller vinduesglas (indeholder kemikalier eller bly).',
        'Ingen ildfaste fade (f.eks. Pyrex – tåler ekstrem varme og kan ikke smeltes om).'
      ],
      dontsEn: [
        'No drinking glasses or ceramics (different melting points ruin the batch).',
        'No mirrors or window panes (contain special chemicals or lead additives).',
        'No oven-safe glassware (e.g., Pyrex – designed for extreme heat, cannot be melted).'
      ],
      funFactDa: 'Glas er 100% genanvendeligt og kan smeltes om uendeligt mange gange i et lukket kredsløb uden nogensinde at miste sin styrke eller renhed!',
      funFactEn: 'Glass is 100% recyclable and can be remelted infinitely without any loss of strength, durability, or quality!',
      colorClass: 'text-emerald-700 bg-emerald-50',
      bgGradient: 'from-emerald-50 to-emerald-100/60',
      borderClass: 'border-emerald-150',
      icon: '🍾'
    },
    {
      id: 'g_metals',
      nameDa: 'Metal & Dåser',
      nameEn: 'Metals & Cans',
      category: 'metals',
      code: 'FE (40), ALU (41)',
      difficultyDa: 'Nem',
      difficultyEn: 'Easy',
      co2SavedPerKg: 4.8,
      tipsDa: [
        'Konservesdåser skal blot tømmes helt for madvare.',
        'Alufolie og fyrfadslysholdere i metal må gerne sorteres som metal.',
        'Brug ikke metalbeholderen til elektronik eller batterier.'
      ],
      tipsEn: [
        'Thoroughly empty food cans of any solid foods.',
        'Aluminum foil and metal tealight holders are highly recyclable as metal.',
        'Never use the metal bin for electronics, circuit boards, or batteries.'
      ],
      dosDa: [
        'Konservesdåser, makreldåser, og tomme sodavandsdåser uden pant.',
        'Metallåg, metalredskaber, søm, skruer og kapsler.',
        'Rene alubakker fra madretter.'
      ],
      dosEn: [
        'Food cans, mackerel tins, and non-refillable soda cans without deposit.',
        'Metal lids, metal utensils, nails, screws, and crown caps.',
        'Clean aluminum trays from convenience food.'
      ],
      dontsDa: [
        'Ingen spraydåser (farligt affald, medmindre de er 100% tomme/punkterede).',
        'Ingen gaspatroner eller udtjente trykbeholdere (eksplosionsfare!).',
        'Ingen kaffeposer med plastoverflade (skal oftest i restaffald).'
      ],
      dontsEn: [
        'No spray cans (hazardous waste unless completely empty and depressurized).',
        'No gas cartridges or cylinders (significant explosion hazard!).',
        'No coffee bags with laminated plastic-metal blends (usually residual waste).'
      ],
      funFactDa: 'Gendannelse af aluminium sparer svimlende 95% af den energi, der oprindeligt skal bruges til at fremstille nyt aluminium fra råstoffet bauxit!',
      funFactEn: 'Recycling aluminum saves a massive 95% of the energy required to make brand new aluminum from raw bauxite ore!',
      colorClass: 'text-amber-700 bg-amber-50',
      bgGradient: 'from-amber-50 to-amber-100/60',
      borderClass: 'border-amber-150',
      icon: '🥫'
    },
    {
      id: 'g_paper',
      nameDa: 'Papir & Pap',
      nameEn: 'Paper & Cardboard',
      category: 'paper',
      code: 'PAP (20, 21, 22)',
      difficultyDa: 'Middel',
      difficultyEn: 'Medium',
      co2SavedPerKg: 0.8,
      tipsDa: [
        'Papir og pap må aldrig være vådt, fedtet eller beskidt.',
        'Fold papkasser helt flade, så de ikke optager al plads i beholderen.',
        'Fjern plastikindpakning, tape og store clips hvis muligt.'
      ],
      tipsEn: [
        'Paper and cardboard must never be wet, greasy, or heavily soiled.',
        'Fold boxes completely flat so they do not exhaust bin volumes.',
        'Strip away plastic film, excessive adhesive tape, and massive staples if possible.'
      ],
      dosDa: [
        'Aviser, reklamer, breve, kontorpapir og ugeblade.',
        'Rene papkasser, skoæsker, og paprør fra toiletpapir.',
        'Æggebakker (så længe de er helt tørre og fri for æggerester).'
      ],
      dosEn: [
        'Newspapers, fliers, letters, office sheets, and magazines.',
        'Clean cardboard boxes, shoe containers, and toilet paper rolls.',
        'Egg cartons (provided they are completely dry and free of egg residue).'
      ],
      dontsDa: [
        'Ingen pizzabakker! (Madaffald og fedt ødelægger genanvendelsesslammet – skal i restaffald).',
        'Ingen kvitteringer (bacon-papir og termopapir har flourstoffer i sig).',
        'Ingen juice- og mælkekartoner (sorteres i stedet som Mad- & Drikkekartoner).'
      ],
      dontsEn: [
        'No pizza boxes! (Grease and food degrade paper pulp batches – must go in residual waste).',
        'No thermal till receipts (most contain bisphenols and chemicals harmful to reuse).',
        'No juice and milk cartons (these are categorized as Food & Drink cartons instead).'
      ],
      funFactDa: 'Fibre i papir kan genanvendes op til 6-7 gange til nye papirprodukter før fibrene bliver for korte og svage til at binde sig sammen.',
      funFactEn: 'Paper fibers can be recycled 6 to 7 times into new paper products before the fibers become too short and weak to bind together.',
      colorClass: 'text-stone-700 bg-stone-50',
      bgGradient: 'from-stone-50 to-stone-100/60',
      borderClass: 'border-stone-150',
      icon: '📦'
    }
  ], []);

  // Search filter
  const itemsToSearch = useMemo(() => [
    { nameDa: 'syltetøjsglas', nameEn: 'jam jar', category: 'glass', responseDa: 'Glas • Skyl let, skru metallåg af (lægges i metal), aflever i glas.', responseEn: 'Glass • Rinse lightly, unscrew metal lid (put in metal), deposit in glass.' },
    { nameDa: 'pizzabakke', nameEn: 'pizza box', category: 'paper', responseDa: 'Restaffald • Fedt og maderester ødelægger papargenanvendelsen.', responseEn: 'Residual waste • Grease and food oil ruin paper recycling processes.' },
    { nameDa: 'mælkekarton', nameEn: 'milk carton', category: 'paper', responseDa: 'Mad- & Drikkekartoner • Foldes flade. Husk låget på (hvis plast) eller i plast.', responseEn: 'Food & Drink cartons • Fold flat. Leave plastic cap on or sort into plastic.' },
    { nameDa: 'makreldåse', nameEn: 'mackerel tin', category: 'metals', responseDa: 'Metal • Skyl fedt af, så rotter og lugt mindskes. Sorteres som metal.', responseEn: 'Metal • Rinse off oily residue to prevent pests. Sort in metal.' },
    { nameDa: 'skyrbøtte', nameEn: 'skyr tub', category: 'plastics', responseDa: 'Plastik (Hård) • Skyl og tøm. Pappaschet udenpå trækkes af og sorteres som pap.', responseEn: 'Plastic (Hard) • Rinse and empty. Peel off the cardboard sleeve and sort as paper.' },
    { nameDa: 'spraydåse', nameEn: 'spray can', category: 'metals', responseDa: 'Farligt affald • Gas under tryk kan eksplodere i skraldebilen. Skal i miljøkasse.', responseEn: 'Hazardous waste • Pressurized gas is an explosion risk. Place in hazardous box.' },
    { nameDa: 'chips pose', nameEn: 'chips bag', category: 'plastics', responseDa: 'Plastik / Restaffald (Tjek kommune) • Ofte lamineret med aluminium.', responseEn: 'Plastic / Residual (Check municipality) • Frequently laminated with aluminum.' },
    { nameDa: 'øldåse', nameEn: 'beer can', category: 'metals', responseDa: 'PANT • Bringes til pantautomat eller Drop Point for at redde cirkulære kr.', responseEn: 'DEPOSIT (Pant) • Return to deposit machine or Drop Point to get cash back.' },
    { nameDa: 'porcelænstallerken', nameEn: 'porcelain plate', category: 'glass', responseDa: 'Genbrugsstation (Porcelæn) • Sorteres ALDRIG med emballageglas.', responseEn: 'Recycling center (Ceramics) • NEVER mix with food packaging glass.' },
  ], []);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return itemsToSearch.filter(
      item => item.nameDa.includes(query) || item.nameEn.includes(query)
    );
  }, [searchQuery, itemsToSearch]);

  const filteredGuides = useMemo(() => {
    if (selectedCategory === 'all') return guides;
    return guides.filter(g => g.category === selectedCategory);
  }, [selectedCategory, guides]);

  // Mini quiz data
  const quizItems = useMemo(() => [
    {
      itemDa: 'Tom pizzabakke med lidt tør ost',
      itemEn: 'Empty pizza box with some dry cheese',
      optionsDa: ['Pap (papirbeholder)', 'Restaffald', 'Madaffald', 'Plastik'],
      optionsEn: ['Cardboard (paper bin)', 'Residual waste', 'Food waste', 'Plastic'],
      correctIndex: 1,
      explanationDa: 'Forkert sorteret papir ødelægger partiet. Pizzabakker hører til RESTAFFALD på grund af fedt og fastbrændte rester.',
      explanationEn: 'Greasy cardboard ruins paper pulp. Pizza boxes belong in RESIDUAL WASTE due to grease and burnt crusts.',
      co2Saved: 0
    },
    {
      itemDa: 'Metal skruelåg fra syltetøjsglas',
      itemEn: 'Metal screw cap from a jar of jam',
      optionsDa: ['Restaffald', 'Glas', 'Metal', 'Farligt affald'],
      optionsEn: ['Residual waste', 'Glass', 'Metal', 'Hazardous waste'],
      correctIndex: 2,
      explanationDa: 'Korrekt! Metal skruelåg skal tages af glasset og sorteres separat som METAL.',
      explanationEn: 'Correct! Metal screw lids should be removed from glass and sorted separately as METAL.',
      co2Saved: 0.5
    },
    {
      itemDa: 'Knust drikkeglas fra køkkenet',
      itemEn: 'Broken drinking glass from the kitchen',
      optionsDa: ['Glasflasker', 'Porcelæn og keramik', 'Genbrugsstation (Småt brændbart)', 'Genbrugsstation (Hårdt glas/deponi) og ALDRIG emballageglas'],
      optionsEn: ['Glass packaging', 'Porcelain and ceramics', 'Recycling center (small combustible)', 'Recycling center (ceramics/hard glass) and NEVER packaging glass'],
      correctIndex: 3,
      explanationDa: 'Husholdningsglas og vinglas indeholder andre råstoffer med højere smeltepunkt. De ødelægger genanvendeselsglasset og hører til på genbrugspladsen.',
      explanationEn: 'Drinking glasses require higher melting temperatures. They contaminate the consumer glass batch and belong at the recycling center.',
      co2Saved: 0
    },
    {
      itemDa: 'Skyrbøtte af plastik med papomslag udenom',
      itemEn: 'Plastic skyr tub with a cardboard sleeve',
      optionsDa: ['Beholdes som den er og smides i plast', 'Træk papomslaget af: Sorter plast i plast og pap i pap', 'Alt skal i Restaffald', 'Plastikbøtten smides ud, pappet brændes'],
      optionsEn: ['Keep it as-is and throw in plastic', 'Pull off sleeve: separate plastic into plastic, card into paper', 'Everything in Residual waste', 'Throw away plastic, burn paper'],
      correctIndex: 1,
      explanationDa: 'Adskillelse gør genanvendelse markant bedre! Papomslaget og plastikbøtten skal deles op og sorteres hver for sig.',
      explanationEn: 'Separation makes a dramatic difference! Cardboard sleeve and plastic tub must be separated and recycled individually.',
      co2Saved: 1.2
    }
  ], []);

  const handleQuizAnswer = (optionIdx: number) => {
    if (quizAnswered) return;
    setSelectedAnswer(optionIdx);
    setQuizAnswered(true);
    if (optionIdx === quizItems[quizIndex].correctIndex) {
      setQuizScore(s => s + 1);
      triggerHaptic(HapticPattern.SUCCESS_LONG);
    } else {
      triggerHaptic(HapticPattern.ERROR_PATTERN);
    }
  };

  const handleNextQuiz = () => {
    triggerHaptic(HapticPattern.LIGHT_TAP);
    setSelectedAnswer(null);
    setQuizAnswered(false);
    if (quizIndex < quizItems.length - 1) {
      setQuizIndex(i => i + 1);
    } else {
      setQuizEnded(true);
    }
  };

  const handleRestartQuiz = () => {
    triggerHaptic(HapticPattern.LIGHT_TAP);
    setQuizIndex(0);
    setQuizScore(0);
    setQuizAnswered(false);
    setSelectedAnswer(null);
    setQuizEnded(false);
  };

  return (
    <div id="recycling-guides-component" className="flex flex-col gap-5 pt-1">
      {/* Category header */}
      <div className="flex justify-between items-center bg-[#C8F24A]/10 border border-[#C8F24A]/25 rounded-2xl p-4.5 text-left">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#C8F24A] flex items-center justify-center text-xl shadow-2xs">📚</span>
          <div className="flex flex-col">
            <h4 className="text-sm font-black text-primary uppercase tracking-wider leading-snug">
              {isDa ? 'Interaktive Materialeguider' : 'Interactive Material Guides'}
            </h4>
            <p className="text-[10px] text-muted-text font-bold">
              {isDa ? 'Udforsk tips, undgå sorteringsfejl & test din viden' : 'Explore sorting tips, avoid common errors & verify skills'}
            </p>
          </div>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div id="guide-search-wrapper" className="flex flex-col gap-1.5 text-left">
        <label className="text-[9.5px] font-black text-primary uppercase tracking-wider pl-1 font-mono">
          {isDa ? 'Hurtigsøg efter emballagetyper' : 'Quick Search packaging materials'}
        </label>
        <div className="relative">
          <input
            id="guide-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isDa ? "Søg f.eks.: pizzabakke, skyrbøtte, øldåse..." : "Search e.g. pizza box, jam jar, soda can..."}
            className="w-full bg-white border border-gray-200 rounded-2xl py-3 pl-11 pr-4 text-xs font-semibold text-primary placeholder-gray-400 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
          />
          <Search className="w-4.5 h-4.5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 hover:text-primary cursor-pointer"
            >
              Ryd
            </button>
          )}
        </div>

        {/* Search Results Display */}
        <AnimatePresence>
          {searchQuery && (
            <motion.div 
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white border border-gray-200 rounded-2xl p-3 shadow-md flex flex-col gap-2 mt-1.5"
            >
              <h5 className="text-[9px] font-black uppercase text-primary/50 tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-emerald-500" />
                {isDa ? `Søgeresultater (${searchResults.length})` : `Matches (${searchResults.length})`}
              </h5>
              
              {searchResults.length > 0 ? (
                <div className="flex flex-col gap-2 divide-y divide-gray-100 max-h-48 overflow-y-auto pr-1">
                  {searchResults.map((sr, idx) => (
                    <div key={idx} className="pt-2 first:pt-0 text-left">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-primary uppercase font-mono">{isDa ? sr.nameDa : sr.nameEn}</span>
                        <span className="text-[8.5px] font-black uppercase px-2 py-0.5 rounded bg-gray-150 text-gray-700 leading-none">
                          {sr.category}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#222] font-semibold mt-1 leading-snug">
                        {isDa ? sr.responseDa : sr.responseEn}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2 text-center text-[10.5px] text-muted-text font-bold">
                  😞 {isDa ? 'Ingen præcis match fundet. Prøv med andre søgeord.' : 'No items matched. Try other search words.'}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* FILTER BUTTONS */}
      <div id="guide-material-filters" className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {(['all', 'plastics', 'glass', 'metals', 'paper'] as const).map((cat) => {
          const isActive = selectedCategory === cat;
          const labels: { [key: string]: string } = {
            all: isDa ? 'Alle' : 'All',
            plastics: isDa ? 'Plast' : 'Plastics',
            glass: isDa ? 'Glas' : 'Glass',
            metals: isDa ? 'Metal' : 'Metals',
            paper: isDa ? 'Pap/Papir' : 'Paper'
          };
          const emojis: { [key: string]: string } = {
            all: '🔍',
            plastics: '🥤',
            glass: '🍾',
            metals: '🥫',
            paper: '📦'
          };

          return (
            <button
              key={cat}
              onClick={() => {
                triggerHaptic(HapticPattern.LIGHT_TAP);
                setSelectedCategory(cat);
                setExpandedId(null);
              }}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border select-none cursor-pointer transition-all flex items-center gap-1.5 shrink-0 ${
                isActive 
                  ? 'bg-primary text-accent border-primary' 
                  : 'bg-white text-primary border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>{emojis[cat]}</span>
              <span>{labels[cat]}</span>
            </button>
          );
        })}
      </div>

      {/* GUIDES LIST */}
      <div id="guides-list-container" className="flex flex-col gap-3">
        {filteredGuides.map((guide) => {
          const isExpanded = expandedId === guide.id;
          
          return (
            <div
              id={`material-guide-card-${guide.id}`}
              key={guide.id}
              className={`border rounded-3xl overflow-hidden transition-all text-left ${guide.borderClass} ${
                isExpanded ? 'shadow-sm ring-1 ring-primary/5' : 'hover:shadow-3xs'
              }`}
            >
              {/* Card Title Box */}
              <button
                onClick={() => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setExpandedId(isExpanded ? null : guide.id);
                }}
                className={`w-full p-4 flex justify-between items-center outline-none cursor-pointer ${
                  isExpanded ? 'bg-gradient-to-r ' + guide.bgGradient : 'bg-[#FAFFAF]/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl shrink-0">{guide.icon}</span>
                  <div className="flex flex-col">
                    <h5 className="text-[12px] font-black text-primary uppercase tracking-wide leading-tight">
                      {isDa ? guide.nameDa : guide.nameEn}
                    </h5>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[8.5px] font-mono uppercase bg-white/80 border border-gray-150 px-1.5 py-0.5 rounded text-gray-500 font-bold leading-none">
                        {guide.code}
                      </span>
                      <span className="text-[8px] font-black uppercase flex items-center gap-0.5 text-muted-text">
                        {isDa ? 'Besparelse:' : 'Savings:'}{' '}
                        <span className="text-emerald-700 font-bold font-mono">-{guide.co2SavedPerKg.toFixed(1)} kg CO₂/kg</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-md ${
                    guide.difficultyDa === 'Nem' ? 'bg-emerald-50 text-emerald-750 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                  }`}>
                    {isDa ? guide.difficultyDa : guide.difficultyEn}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4.5 h-4.5 text-primary" />
                  ) : (
                    <ChevronDown className="w-4.5 h-4.5 text-gray-400" />
                  )}
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="border-t border-gray-150 bg-white"
                  >
                    <div className="p-4 flex flex-col gap-4">
                      
                      {/* Tips highlights */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9.5px] font-black text-primary uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <Info className="w-3.5 h-3.5 text-sky-600" />
                          {isDa ? 'Hurtige Sorteringstips' : 'Quick Sorting Tips'}
                        </span>
                        <ul className="flex flex-col gap-1 list-none pl-0">
                          {(isDa ? guide.tipsDa : guide.tipsEn).map((tip, tIdx) => (
                            <li key={tIdx} className="text-[10px] text-[#222] font-semibold flex items-start gap-1.5 leading-snug">
                              <span className="text-[9.5px] text-sky-600 shrink-0 mt-0.5">•</span>
                              <span>{tip}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Do's and Dont's columns */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-1">
                        
                        {/* DO'S CONTAINER */}
                        <div className="flex flex-col gap-1.5 bg-emerald-50/20 border border-emerald-100 p-2.5 rounded-2xl">
                          <span className="text-[9px] font-black text-emerald-800 uppercase tracking-wider flex items-center gap-1 font-mono">
                            <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/10 border border-emerald-300 flex items-center justify-center text-[7px] font-bold text-emerald-700">✓</span>
                            {isDa ? 'JA TAK' : 'YES PLEASE'}
                          </span>
                          <ul className="flex flex-col gap-1 pl-0 list-none">
                            {(isDa ? guide.dosDa : guide.dosEn).map((doItem, dIdx) => (
                              <li key={dIdx} className="text-[9.5px] text-[#1e293b] font-extrabold flex items-start gap-1.5 leading-tight">
                                <span className="text-emerald-500 shrink-0 select-none">✓</span>
                                <span>{doItem}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* DONT'S CONTAINER */}
                        <div className="flex flex-col gap-1.5 bg-red-50/20 border border-red-100 p-2.5 rounded-2xl">
                          <span className="text-[9px] font-black text-red-700 uppercase tracking-wider flex items-center gap-1 font-mono">
                            <span className="w-3.5 h-3.5 rounded-full bg-red-500/10 border border-red-300 flex items-center justify-center text-[7px] font-bold text-red-700">✕</span>
                            {isDa ? 'NEJ TAK' : 'NO THANKS'}
                          </span>
                          <ul className="flex flex-col gap-1 pl-0 list-none">
                            {(isDa ? guide.dontsDa : guide.dontsEn).map((dontItem, dtIdx) => (
                              <li key={dtIdx} className="text-[9.5px] text-[#1e293b] font-extrabold flex items-start gap-1.5 leading-tight">
                                <span className="text-red-500 shrink-0 select-none">✕</span>
                                <span>{dontItem}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                      </div>

                      {/* Climate impact box */}
                      <div className="bg-[#FAF9F6] border border-gray-200 p-3 rounded-2xl flex items-start gap-3">
                        <span className="text-xl mt-0.5 shrink-0">🌿</span>
                        <div className="text-left">
                          <span className="text-[9px] font-black uppercase text-emerald-850 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded leading-none font-mono">
                            CO₂ REDUKTION: -{guide.co2SavedPerKg} kg / kg
                          </span>
                          <p className="text-[10px] text-muted-text font-bold leading-normal mt-1.5">
                            {isDa ? guide.funFactDa : guide.funFactEn}
                          </p>
                        </div>
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* INTERACTIVE COMPLIANCE CHECKER */}
      <div id="compliance-checklist-widget" className="bg-white border border-gray-200 rounded-3xl p-4.5 shadow-2xs text-left">
        <div className="flex gap-2 items-center mb-1">
          <span className="text-lg">⚖️</span>
          <h4 className="text-xs font-black text-primary uppercase tracking-wider">
            {isDa ? 'Kvalitetssikring af dit Affald' : 'Sorting Quality Checklist'}
          </h4>
        </div>
        <p className="text-[10px] text-muted-text font-bold mb-3">
          {isDa ? 'Tjek om dit affald overholder standarderne for maksimal CP bonus' : 'Verify if container satisfies guidelines for high CP conversion'}
        </p>

        <div className="flex flex-col gap-2">
          {[
            { key: 'rinsed', labelDa: 'Skyllet & tømt (Ingen snavs/madrester)', labelEn: 'Rinsed & emptied (No residual grease)' },
            { key: 'flattened', labelDa: 'Fladtrykt/komprimeret (Sparer bulk volume i container)', labelEn: 'Flattened (Saves bulk logistics space)' },
            { key: 'separated', labelDa: 'Adskilt papomslag, metallåg og låg', labelEn: 'Separated cardboard, metal parts & caps' },
            { key: 'labelRemoved', labelDa: 'Plastikfilm pillet af hvis nødvendigt', labelEn: 'Cardboard wrappers/foils separated' }
          ].map((item) => (
            <label 
              key={item.key} 
              className="flex items-center gap-2.5 bg-[#FAF9F6] p-2.5 rounded-xl border border-gray-150 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={checklistState[item.key] || false}
                onChange={(e) => {
                  triggerHaptic(HapticPattern.LIGHT_TAP);
                  setChecklistState(prev => ({ ...prev, [item.key]: e.target.checked }));
                }}
                className="w-4 h-4 rounded accent-primary border-gray-300 transition-all cursor-pointer"
              />
              <span className="text-[10.5px] font-semibold text-primary">
                {isDa ? item.labelDa : item.labelEn}
              </span>
            </label>
          ))}
        </div>

        {/* Dynamic calculation indicator */}
        <div className="mt-3.5 bg-slate-900 text-slate-100 p-3 rounded-2xl flex justify-between items-center bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-950">
          <div className="text-left">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest block font-mono">Compliance rating</span>
            <span className="text-xs font-black text-[#C8F24A] uppercase font-mono">
              {Object.values(checklistState).filter(Boolean).length * 25}% {isDa ? 'OPFYLDT' : 'READY'}
            </span>
          </div>

          <div className="text-right">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest block font-mono">Points-koefficient</span>
            <span className="text-xs font-black text-white font-mono">
              x{(0.5 + Object.values(checklistState).filter(Boolean).length * 0.125).toFixed(3)}
            </span>
          </div>
        </div>
      </div>

      {/* INTERACTIVE MINI QUIZ SECTION */}
      <div id="material-quiz-card" className="bg-slate-50 border border-gray-200 rounded-3xl p-4.5 text-left relative overflow-hidden">
        {/* Absolute style decoration */}
        <div className="absolute right-0 top-0 w-24 h-24 bg-gradient-to-tr from-[#C8F24A]/0 to-[#C8F24A]/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex justify-between items-center mb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-primary text-accent flex items-center justify-center text-xs font-bold font-mono">🏆</span>
            <div>
              <h4 className="text-xs font-black text-primary uppercase tracking-wider">
                {isDa ? 'Test Din Sorteringsviden!' : 'Test your Sorting IQ!'}
              </h4>
              <p className="text-[9.5px] text-muted-text font-bold">
                {isDa ? 'Træn dine færdigheder og optjen viden' : 'Master your rules and collect stats'}
              </p>
            </div>
          </div>
          {!quizEnded && (
            <span className="text-[8.5px] font-black uppercase text-[#475569] bg-slate-200/60 px-2 py-0.5 rounded-md leading-none font-mono">
              {quizIndex + 1} / {quizItems.length}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          {!quizEnded ? (
            <motion.div 
              key={quizIndex}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex flex-col gap-3"
            >
              {/* Question area */}
              <div className="bg-white border border-gray-200 p-4 rounded-2xl shadow-3xs">
                <span className="text-[8.5px] font-black tracking-widest text-[#64748b] uppercase block font-mono">Hvor sorteres:</span>
                <p className="text-[12px] font-black text-primary leading-snug mt-1 font-serif">
                  {isDa ? quizItems[quizIndex].itemDa : quizItems[quizIndex].itemEn} ?
                </p>
              </div>

              {/* Options */}
              <div className="flex flex-col gap-1.5 mt-1">
                {(isDa ? quizItems[quizIndex].optionsDa : quizItems[quizIndex].optionsEn).map((option, idx) => {
                  const isCorrect = idx === quizItems[quizIndex].correctIndex;
                  const isSelected = idx === selectedAnswer;
                  
                  let buttonStyle = 'bg-white border-gray-200 text-primary hover:bg-gray-50';
                  if (quizAnswered) {
                    if (isCorrect) {
                      buttonStyle = 'bg-emerald-500/10 border-emerald-400 text-emerald-800 font-extrabold';
                    } else if (isSelected) {
                      buttonStyle = 'bg-red-500/10 border-red-300 text-red-700 font-extrabold';
                    } else {
                      buttonStyle = 'bg-white border-gray-150 text-gray-400 opacity-60';
                    }
                  }

                  return (
                    <button
                      key={idx}
                      disabled={quizAnswered}
                      onClick={() => handleQuizAnswer(idx)}
                      className={`w-full py-2.5 px-4 text-left rounded-xl border text-[10.5px] transition-all font-semibold select-none flex items-center justify-between ${
                        !quizAnswered ? 'cursor-pointer active:scale-99' : 'cursor-default'
                      } ${buttonStyle}`}
                    >
                      <span>{option}</span>
                      {quizAnswered && isCorrect && (
                        <span className="text-[11px] text-emerald-600 font-bold">✓ {isDa ? 'Rigtigt' : 'Correct'}</span>
                      )}
                      {quizAnswered && isSelected && !isCorrect && (
                        <span className="text-[11px] text-red-600 font-bold">✕ {isDa ? 'Forkert' : 'Wrong'}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Quiz feedback explanation panel */}
              {quizAnswered && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-primary/5 border border-primary/10 rounded-2xl p-3 flex flex-col gap-2 text-left"
                >
                  <p className="text-[10px] text-primary/80 font-bold leading-normal">
                    {isDa ? quizItems[quizIndex].explanationDa : quizItems[quizIndex].explanationEn}
                  </p>
                  <button
                    onClick={handleNextQuiz}
                    className="w-full py-2 bg-primary text-[#C8F24A] hover:bg-primary/95 font-black text-[9.5px] uppercase tracking-wider rounded-xl transition-all cursor-pointer border-none text-center"
                  >
                    {quizIndex === quizItems.length - 1 
                      ? (isDa ? 'Se dit resultat ⚡' : 'See your results ⚡') 
                      : (isDa ? 'Fortsæt til næste →' : 'Continue to next →')
                    }
                  </button>
                </motion.div>
              )}

            </motion.div>
          ) : (
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col gap-3 py-2 text-center"
            >
              <span className="text-3xl">🎉</span>
              <div>
                <h5 className="text-[14px] font-black text-primary uppercase tracking-wide">
                  {isDa ? 'Test Gennemført!' : 'Quiz Finished!'}
                </h5>
                <p className="text-[11px] font-extrabold text-muted-text mt-1">
                  {isDa ? `Du fik svarét rigtigt på: ${quizScore} ud af ${quizItems.length} emner!` : `Matched correctness: ${quizScore} of ${quizItems.length} items!`}
                </p>
              </div>

              <div className="bg-emerald-500/10 border border-emerald-400/20 p-2.5 rounded-2xl text-[10px] text-emerald-800 font-extrabold leading-normal mt-1">
                {quizScore === quizItems.length 
                  ? (isDa ? '🌟 Perfekt! Du er en absolut Genbrugs-Mester!' : '🌟 Perfect! You are an absolute Recycling Champ!')
                  : (isDa ? 'Næsten der! Læs guiderne ovenfor for at nå fejlfri status.' : 'Great job! Check the guides above to become flawless.')
                }
              </div>

              <button
                onClick={handleRestartQuiz}
                className="w-full py-2 border border-gray-300 bg-white text-primary hover:bg-gray-50 font-black text-[9.5px] uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isDa ? 'Prøv igen' : 'Try Again'}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
