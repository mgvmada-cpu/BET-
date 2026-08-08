import React, { useState, useEffect, useMemo } from "react";
import {
  Wifi, Clock, Globe, TrendingUp, TrendingDown, Calculator, Trophy,
  Wallet, Search, Info, ChevronRight, Circle, Zap, Target, BarChart3,
  Save, PlayCircle, CheckCircle2, XCircle, Radio, RefreshCw
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

/* ============================================================
   DESIGN TOKENS
   ============================================================ */
const COLORS = {
  bg: "#0B1220",
  bgAlt: "#0F172A",
  card: "#141F38",
  cardAlt: "#182444",
  border: "#243252",
  borderSoft: "#1B2743",
  textHi: "#F1F5FB",
  textMid: "#B7C3DE",
  textLow: "#748099",
  positive: "#10B981",
  positiveSoft: "rgba(16,185,129,0.14)",
  negative: "#EF4444",
  negativeSoft: "rgba(239,68,68,0.14)",
  accent: "#6366F1",
  accentSoft: "rgba(99,102,241,0.14)",
  amber: "#F59E0B",
  amberSoft: "rgba(245,158,11,0.14)",
};

/* ============================================================
   MATH ENGINE — Tennis (Markov) & Table Tennis (Elo)
   ============================================================ */
const clamp = (v, lo = 0.01, hi = 0.99) => Math.max(lo, Math.min(hi, v));

// Probability of winning a service game given point-win prob p
function gameWinProb(p) {
  const q = 1 - p;
  const memo = {};
  function f(a, b) {
    if (a >= 4 && a - b >= 2) return 1;
    if (b >= 4 && b - a >= 2) return 0;
    const key = a + "_" + b;
    if (memo[key] !== undefined) return memo[key];
    let result;
    if (a === 3 && b === 3) {
      result = (p * p) / (p * p + q * q);
    } else if (a - b === 1 && a >= 3) {
      result = p + q * f(3, 3);
    } else if (b - a === 1 && b >= 3) {
      result = p * f(3, 3);
    } else {
      result = p * f(a + 1, b) + q * f(a, b + 1);
    }
    memo[key] = result;
    return result;
  }
  return f(0, 0);
}

// Tiebreak win prob for A given each player's point-win prob on their own serve
function tiebreakProb(pAServe, pBServe) {
  const memo = {};
  function serverAt(n) {
    if (n === 0) return "A";
    const m = n - 1;
    const pairIndex = Math.floor(m / 2);
    return pairIndex % 2 === 0 ? "B" : "A";
  }
  function f(a, b) {
    if (a >= 7 && a - b >= 2) return 1;
    if (b >= 7 && b - a >= 2) return 0;
    if (a >= 6 && b >= 6 && a === b) {
      const pAvg = (pAServe + (1 - pBServe)) / 2;
      return (pAvg * pAvg) / (pAvg * pAvg + (1 - pAvg) * (1 - pAvg));
    }
    const key = a + "_" + b;
    if (memo[key] !== undefined) return memo[key];
    const s = serverAt(a + b);
    const pAwin = s === "A" ? pAServe : 1 - pBServe;
    const result = pAwin * f(a + 1, b) + (1 - pAwin) * f(a, b + 1);
    memo[key] = result;
    return result;
  }
  return f(0, 0);
}

// Set win prob for A given hold probabilities and tiebreak prob
function setWinProb(holdA, holdB, tbProbA) {
  const memo = {};
  function serverAt(n) {
    return n % 2 === 0 ? "A" : "B";
  }
  function f(a, b) {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 6 && b === 6) return tbProbA;
    const key = a + "_" + b;
    if (memo[key] !== undefined) return memo[key];
    const s = serverAt(a + b);
    const pAwinGame = s === "A" ? holdA : 1 - holdB;
    const result = pAwinGame * f(a + 1, b) + (1 - pAwinGame) * f(a, b + 1);
    memo[key] = result;
    return result;
  }
  return f(0, 0);
}

function combin(n, k) {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

// Match win prob given a per-set win prob (sets treated as i.i.d.)
function matchWinProb(pSet, setsToWin) {
  const maxSets = 2 * setsToWin - 1;
  let total = 0;
  for (let k = setsToWin; k <= maxSets; k++) {
    total +=
      combin(k - 1, setsToWin - 1) *
      Math.pow(pSet, setsToWin) *
      Math.pow(1 - pSet, k - setsToWin);
  }
  return total;
}

const SURFACE_BOOST = { hard: 0, clay: -0.04, grass: 0.05, indoor: 0.03 };
function surfaceAdjust(p, surface) {
  const boost = SURFACE_BOOST[surface] || 0;
  const delta = p - 0.5 >= 0 ? boost : -boost;
  return clamp(p + delta);
}

function eloWinProb(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/* Betting math */
function removeOverround(oddsA, oddsB) {
  const iA = 1 / oddsA;
  const iB = 1 / oddsB;
  const overround = iA + iB;
  return { pA: iA / overround, pB: iB / overround, overround };
}
function evPct(pReal, odds) {
  return pReal * odds - 1;
}
function kellyFraction(pReal, odds) {
  const b = odds - 1;
  const q = 1 - pReal;
  const f = (b * pReal - q) / b;
  return Math.max(f, 0);
}
function recommendedStake(pReal, odds, bankroll, fraction = 0.25) {
  return bankroll * kellyFraction(pReal, odds) * fraction;
}
function verdictFor(ev) {
  if (ev > 0.06) return "strong";
  if (ev > 0) return "slight";
  return "none";
}

/* ============================================================
   TRANSLATIONS
   ============================================================ */
const T = {
  fr: {
    appName: "QuantCourt",
    tagline: "Analyste Quantitatif de Paris Sportifs",
    apiConnected: "API connectée",
    autoSync: "Sync auto active",
    navLive: "Matchs du jour",
    navTennis: "Analyse Tennis",
    navTT: "Tennis de Table",
    navHistory: "Historique",
    navBankroll: "Bankroll",
    upcoming: "À venir",
    live: "En direct",
    finished: "Terminé",
    analyze: "Analyser",
    todayMatches: "Matchs du jour",
    todayMatchesSub: "Cotes en direct converties dans votre fuseau horaire local",
    surface: "Surface",
    hard: "Dur",
    clay: "Terre battue",
    grass: "Gazon",
    indoor: "Dur (indoor)",
    playerA: "Joueur A",
    playerB: "Joueur B",
    oddsA: "Cote A",
    oddsB: "Cote B",
    format: "Format",
    bo3: "3 sets gagnants (BO3)",
    bo5: "5 sets gagnants (BO5)",
    bo5tt: "5 manches gagnantes (BO5)",
    bo7tt: "7 manches gagnantes (BO7)",
    bankroll: "Bankroll",
    serveWin: "% points gagnés au service",
    returnWin: "% points gagnés au retour",
    eloRating: "Classement Elo",
    engineTitle: "Moteur analytique Markov",
    engineTitleTT: "Moteur Elo & variance",
    winProbTitle: "Probabilité de victoire (match)",
    secondaryMarkets: "Marchés secondaires",
    setHandicap: "Handicap en sets",
    totalGames: "Total de jeux",
    over: "Plus de",
    under: "Moins de",
    variance: "Indice de variance",
    varianceHigh: "Élevée — sets courts à 11 points",
    valueTitle: "Value Bet & Critère de Kelly",
    impliedProb: "Probabilité implicite (bookmaker)",
    realProb: "Probabilité réelle (modèle)",
    overround: "Marge bookmaker",
    ev: "Valeur espérée (EV)",
    recommendedStake: "Mise recommandée (Kelly 1/4)",
    verdictStrong: "VALEUR FORTE",
    verdictSlight: "VALEUR LÉGÈRE",
    verdictNone: "AUCUNE VALEUR",
    aiSynthesis: "Synthèse Expert IA",
    saveAnalysis: "Enregistrer l'analyse",
    saved: "Analyse enregistrée",
    historyTitle: "Historique des analyses",
    historyEmpty: "Aucune analyse enregistrée pour le moment. Lancez une analyse et enregistrez-la.",
    bankrollTitle: "Suivi de la Bankroll",
    bankrollStart: "Bankroll initiale",
    bankrollCurrent: "Bankroll actuelle",
    roi: "ROI",
    winRate: "Taux de réussite",
    totalStaked: "Total misé",
    betLog: "Journal des paris",
    pending: "En attente",
    won: "Gagné",
    lost: "Perdu",
    stake: "Mise",
    result: "Résultat",
    profit: "Profit",
    match: "Match",
    date: "Date",
    pendingStakes: "Mises en attente (analyses enregistrées)",
    langToggle: "EN",
    kellyTooltip: "Le critère de Kelly calcule la fraction optimale de la bankroll à miser selon l'avantage estimé, réduite ici au 1/4 pour limiter la variance.",
    evTooltip: "EV = (Probabilité réelle × Cote) − 1. Un EV positif signifie un pari statistiquement avantageux sur le long terme.",
    overroundTooltip: "La marge (overround) est la surcote intégrée par le bookmaker ; on la retire pour obtenir la probabilité implicite réelle du marché.",
    noSelection: "Sélectionnez un match dans « Matchs du jour » ou saisissez les joueurs manuellement.",
    prefillNote: "Pré-rempli depuis le flux en direct",
    manualOverride: "Cotes ajustables manuellement",
    tour: "Circuit",
    apiMockNotice: "Données simulées — clé API non configurée",
    apiErrorNotice: "Erreur API — repli sur les données simulées",
    refresh: "Actualiser",
    refreshing: "Actualisation…",
    lastUpdate: "Dernière mise à jour",
  },
  en: {
    appName: "QuantCourt",
    tagline: "Quantitative Sports Betting Analyst",
    apiConnected: "API Connected",
    autoSync: "Auto-sync Active",
    navLive: "Today's Matches",
    navTennis: "Tennis Analysis",
    navTT: "Table Tennis",
    navHistory: "History",
    navBankroll: "Bankroll",
    upcoming: "Upcoming",
    live: "Live",
    finished: "Finished",
    analyze: "Analyze",
    todayMatches: "Today's Matches",
    todayMatchesSub: "Live odds converted to your local timezone",
    surface: "Surface",
    hard: "Hard",
    clay: "Clay",
    grass: "Grass",
    indoor: "Indoor Hard",
    playerA: "Player A",
    playerB: "Player B",
    oddsA: "Odds A",
    oddsB: "Odds B",
    format: "Format",
    bo3: "Best of 3 sets",
    bo5: "Best of 5 sets",
    bo5tt: "Best of 5 games",
    bo7tt: "Best of 7 games",
    bankroll: "Bankroll",
    serveWin: "% points won on serve",
    returnWin: "% points won on return",
    eloRating: "Elo Rating",
    engineTitle: "Analytical Markov Engine",
    engineTitleTT: "Elo & Variance Engine",
    winProbTitle: "Match Win Probability",
    secondaryMarkets: "Secondary Markets",
    setHandicap: "Set Handicap",
    totalGames: "Total Games",
    over: "Over",
    under: "Under",
    variance: "Confidence / Variance Score",
    varianceHigh: "High — short 11-point games",
    valueTitle: "Value Bet & Kelly Criterion",
    impliedProb: "Implied Probability (bookmaker)",
    realProb: "Real Probability (model)",
    overround: "Bookmaker Overround",
    ev: "Expected Value (EV)",
    recommendedStake: "Recommended Stake (1/4 Kelly)",
    verdictStrong: "STRONG VALUE BET",
    verdictSlight: "SLIGHT VALUE",
    verdictNone: "NO VALUE / NO BET",
    aiSynthesis: "Expert AI Synthesis",
    saveAnalysis: "Save Analysis",
    saved: "Analysis saved",
    historyTitle: "Match History",
    historyEmpty: "No analyses saved yet. Run an analysis and save it.",
    bankrollTitle: "Bankroll Tracker",
    bankrollStart: "Starting Bankroll",
    bankrollCurrent: "Current Bankroll",
    roi: "ROI",
    winRate: "Win Rate",
    totalStaked: "Total Staked",
    betLog: "Bet Log",
    pending: "Pending",
    won: "Won",
    lost: "Lost",
    stake: "Stake",
    result: "Result",
    profit: "Profit",
    match: "Match",
    date: "Date",
    pendingStakes: "Pending Stakes (saved analyses)",
    langToggle: "FR",
    kellyTooltip: "The Kelly criterion computes the optimal bankroll fraction to stake given the estimated edge, reduced here to 1/4 to limit variance.",
    evTooltip: "EV = (Real Probability × Odds) − 1. A positive EV means a statistically favorable bet over the long run.",
    overroundTooltip: "The overround is the margin built into bookmaker odds; removing it gives the market's true implied probability.",
    noSelection: "Select a match from \"Today's Matches\" or enter players manually.",
    prefillNote: "Pre-filled from live feed",
    manualOverride: "Odds are manually adjustable",
    tour: "Tour",
    apiMockNotice: "Mock data — API key not configured",
    apiErrorNotice: "API error — falling back to mock data",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    lastUpdate: "Last updated",
  },
};

/* ============================================================
   MOCK DATA
   ============================================================ */
function isoInHours(h, m = 0) {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + h, m, 0, 0);
  return d.toISOString();
}

const TODAY_MATCHES = [
  { id: "m1", sport: "tennis", tour: "ATP", tournament: "Cincinnati Masters", playerA: "C. Alcaraz", playerB: "J. Sinner", startTimeUTC: isoInHours(2), surface: "hard", oddsA: 1.85, oddsB: 1.98, status: "upcoming" },
  { id: "m2", sport: "tennis", tour: "WTA", tournament: "Cincinnati Open", playerA: "I. Swiatek", playerB: "A. Sabalenka", startTimeUTC: isoInHours(-1), surface: "hard", oddsA: 2.10, oddsB: 1.75, status: "live" },
  { id: "m3", sport: "tennis", tour: "ATP", tournament: "Cincinnati Masters", playerA: "N. Djokovic", playerB: "D. Medvedev", startTimeUTC: isoInHours(5), surface: "hard", oddsA: 1.60, oddsB: 2.35, status: "upcoming" },
  { id: "m4", sport: "tabletennis", tour: "WTT", tournament: "WTT Contender", playerA: "F. Wang", playerB: "T. Ito", startTimeUTC: isoInHours(1), surface: null, oddsA: 1.55, oddsB: 2.45, status: "upcoming" },
  { id: "m5", sport: "tabletennis", tour: "ITTF", tournament: "ITTF World Cup", playerA: "M. Falck", playerB: "H. Moregard", startTimeUTC: isoInHours(-3), surface: null, oddsA: 2.05, oddsB: 1.78, status: "finished" },
  { id: "m6", sport: "tennis", tour: "WTA", tournament: "Cincinnati Open", playerA: "C. Gauff", playerB: "J. Pegula", startTimeUTC: isoInHours(8), surface: "hard", oddsA: 1.92, oddsB: 1.90, status: "upcoming" },
];

const MOCK_BET_LOG = [
  { date: "2026-07-28", match: "Alcaraz vs Zverev", stake: 42, odds: 1.9, result: "won" },
  { date: "2026-07-30", match: "Swiatek vs Rybakina", stake: 35, odds: 1.65, result: "won" },
  { date: "2026-08-01", match: "Fan Zhendong vs Ma Long", stake: 28, odds: 2.2, result: "lost" },
  { date: "2026-08-02", match: "Medvedev vs Rublev", stake: 50, odds: 1.78, result: "lost" },
  { date: "2026-08-04", match: "Sabalenka vs Gauff", stake: 45, odds: 1.55, result: "won" },
  { date: "2026-08-05", match: "Sinner vs Fritz", stake: 60, odds: 1.42, result: "won" },
  { date: "2026-08-06", match: "Ito vs Moregard", stake: 30, odds: 2.6, result: "won" },
];

/* ============================================================
   SMALL UI PRIMITIVES
   ============================================================ */
function Gauge({ pct, size = 132, color = COLORS.positive, label, sub }) {
  const cx = size / 2;
  const cy = size / 2 - 6;
  const r = size / 2 - 18;
  const toXY = (deg) => {
    const a = ((deg - 180) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const arcPath = (fromDeg, toDeg) => {
    const s = toXY(fromDeg);
    const e = toXY(toDeg);
    const large = toDeg - fromDeg <= 180 ? 0 : 1;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const sweep = 180 * Math.max(0, Math.min(1, pct / 100));
  const ticks = [0, 25, 50, 75, 100];
  return (
    <svg width={size} height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`}>
      <path d={arcPath(0, 180)} stroke={COLORS.borderSoft} strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d={arcPath(0, sweep)} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />
      {ticks.map((t) => {
        const p1 = toXY(t * 1.8);
        const inner = { x: cx + (r - 14) * Math.cos(((t * 1.8 - 180) * Math.PI) / 180), y: cy + (r - 14) * Math.sin(((t * 1.8 - 180) * Math.PI) / 180) };
        return <line key={t} x1={p1.x} y1={p1.y} x2={inner.x} y2={inner.y} stroke={COLORS.textLow} strokeWidth="1.5" />;
      })}
      <text x={cx} y={cy - 6} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="26" fontWeight="700" fill={COLORS.textHi}>
        {pct.toFixed(1)}%
      </text>
      {label && (
        <text x={cx} y={cy + 16} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fill={COLORS.textLow} letterSpacing="0.5">
          {label}
        </text>
      )}
    </svg>
  );
}

function VerdictBadge({ verdict, t }) {
  const map = {
    strong: { bg: COLORS.positiveSoft, fg: COLORS.positive, label: t.verdictStrong },
    slight: { bg: COLORS.amberSoft, fg: COLORS.amber, label: t.verdictSlight },
    none: { bg: COLORS.negativeSoft, fg: COLORS.negative, label: t.verdictNone },
  };
  const s = map[verdict];
  return (
    <span
      style={{
        background: s.bg, color: s.fg, border: `1px solid ${s.fg}44`,
        padding: "6px 14px", borderRadius: 999, fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      <Zap size={13} /> {s.label}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${COLORS.card}, ${COLORS.bgAlt})`,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {icon}
      <h3 style={{ margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, color: COLORS.textHi, letterSpacing: "0.01em" }}>
        {children}
      </h3>
    </div>
  );
}

function StatRow({ label, value, valueColor, tooltip }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${COLORS.borderSoft}` }}>
      <span style={{ fontSize: 12.5, color: COLORS.textMid, display: "flex", alignItems: "center", gap: 5 }}>
        {label}
        {tooltip && (
          <span title={tooltip} style={{ cursor: "help", color: COLORS.textLow }}>
            <Info size={12} />
          </span>
        )}
      </span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5, fontWeight: 600, color: valueColor || COLORS.textHi }}>
        {value}
      </span>
    </div>
  );
}

function NumberField({ label, value, onChange, step = 0.01, min = 1.01 }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <input
        type="number" step={step} min={min} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: "100%", marginTop: 5, background: COLORS.bgAlt, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: "8px 10px", color: COLORS.textHi, fontFamily: "'JetBrains Mono', monospace", fontSize: 14,
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", marginTop: 5, background: COLORS.bgAlt, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: "8px 10px", color: COLORS.textHi, fontFamily: "Inter, sans-serif", fontSize: 14,
        }}
      />
    </label>
  );
}

function Slider({ label, value, onChange, min = 20, max = 90 }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: COLORS.accent }}>{value}%</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{ width: "100%", marginTop: 6, accentColor: COLORS.accent }}
      />
    </label>
  );
}

/* ============================================================
   HEADER
   ============================================================ */
function Header({ lang, setLang, t, apiState }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const offsetMin = -now.getTimezoneOffset();
  const offsetStr = `UTC${offsetMin >= 0 ? "+" : ""}${offsetMin / 60}`;
  const timeStr = now.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${COLORS.border}`,
        background: `radial-gradient(1200px 200px at 10% -20%, ${COLORS.accentSoft}, transparent)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${COLORS.accent}, #4338CA)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Target size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: COLORS.textHi, lineHeight: 1 }}>
            {t.appName}
          </div>
          <div style={{ fontSize: 10.5, color: COLORS.textLow, letterSpacing: "0.03em" }}>{t.tagline}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: COLORS.textMid, background: COLORS.bgAlt, padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.borderSoft}` }}>
          <Clock size={13} /> {timeStr} <span style={{ color: COLORS.textLow }}>({offsetStr})</span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          color: apiState === "live" ? COLORS.positive : apiState === "error" ? COLORS.negative : COLORS.amber,
          background: apiState === "live" ? COLORS.positiveSoft : apiState === "error" ? COLORS.negativeSoft : COLORS.amberSoft,
          padding: "6px 10px", borderRadius: 8,
          border: `1px solid ${apiState === "live" ? COLORS.positive : apiState === "error" ? COLORS.negative : COLORS.amber}33`,
        }}>
          <Circle size={8} fill="currentColor" color="currentColor" />
          {apiState === "live" ? `${t.apiConnected} · ${t.autoSync}` : apiState === "error" ? t.apiErrorNotice : t.apiMockNotice}
        </div>
        <button
          onClick={() => setLang(lang === "fr" ? "en" : "fr")}
          style={{
            display: "flex", alignItems: "center", gap: 6, background: COLORS.bgAlt, border: `1px solid ${COLORS.border}`,
            color: COLORS.textHi, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Globe size={13} /> {t.langToggle}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   NAV
   ============================================================ */
function Nav({ tab, setTab, t }) {
  const items = [
    { id: "live", label: t.navLive, icon: Radio },
    { id: "tennis", label: t.navTennis, icon: Calculator },
    { id: "tabletennis", label: t.navTT, icon: Trophy },
    { id: "history", label: t.navHistory, icon: BarChart3 },
    { id: "bankroll", label: t.navBankroll, icon: Wallet },
  ];
  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.bg }}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            style={{
              display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
              padding: "9px 14px", borderRadius: 9, border: `1px solid ${active ? COLORS.accent : "transparent"}`,
              background: active ? COLORS.accentSoft : "transparent",
              color: active ? "#C7C9FF" : COLORS.textMid, fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <Icon size={15} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   LIVE FEED VIEW
   ============================================================ */
function StatusPill({ status, t }) {
  const map = {
    live: { c: COLORS.negative, label: t.live, pulse: true },
    upcoming: { c: COLORS.accent, label: t.upcoming, pulse: false },
    finished: { c: COLORS.textLow, label: t.finished, pulse: false },
  };
  const s = map[status];
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: s.c, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      <Circle size={7} fill={s.c} color={s.c} /> {s.label}
    </span>
  );
}

function LiveFeedView({ t, lang, onAnalyze, liveMatches, apiState, onRefresh, isRefreshing, lastSync }) {
  // Vrais matchs de tennis (si l'API répond) + matchs de tennis de table simulés
  // (The Odds API ne couvre pas le tennis de table — branche une autre source si besoin,
  // voir la note dans api/odds-tennis.js).
  const matches = liveMatches && liveMatches.length > 0
    ? [...liveMatches, ...TODAY_MATCHES.filter((m) => m.sport === "tabletennis")]
    : TODAY_MATCHES;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <SectionTitle icon={<Radio size={17} color={COLORS.accent} />}>{t.todayMatches}</SectionTitle>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{
            display: "flex", alignItems: "center", gap: 7, background: COLORS.bgAlt,
            border: `1px solid ${COLORS.border}`, color: COLORS.textHi, borderRadius: 9,
            padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: isRefreshing ? "default" : "pointer",
            opacity: isRefreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} style={isRefreshing ? { animation: "spin 0.9s linear infinite" } : {}} />
          {isRefreshing ? t.refreshing : t.refresh}
        </button>
      </div>
      <p style={{ color: COLORS.textLow, fontSize: 12.5, marginTop: -8, marginBottom: 6 }}>
        {t.todayMatchesSub}
        {lastSync && (
          <> · {t.lastUpdate} {lastSync.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}</>
        )}
      </p>
      {apiState === "mock" && (
        <p style={{ color: COLORS.amber, fontSize: 11.5, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <Circle size={7} fill={COLORS.amber} color={COLORS.amber} /> {t.apiMockNotice}
        </p>
      )}
      {apiState === "error" && (
        <p style={{ color: COLORS.negative, fontSize: 11.5, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <Circle size={7} fill={COLORS.negative} color={COLORS.negative} /> {t.apiErrorNotice}
        </p>
      )}
      {apiState === "live" && <div style={{ marginBottom: 16 }} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {matches.map((m) => {
          const time = new Date(m.startTimeUTC).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" });
          const date = new Date(m.startTimeUTC).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short" });
          return (
            <Card key={m.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10.5, color: COLORS.accent, fontWeight: 700, letterSpacing: "0.05em" }}>
                  {m.tour} · {m.tournament}
                </span>
                <StatusPill status={m.status} t={t} />
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15.5, fontWeight: 600, color: COLORS.textHi, marginBottom: 4 }}>
                {m.playerA} <span style={{ color: COLORS.textLow, fontWeight: 400 }}>vs</span> {m.playerB}
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.textLow, marginBottom: 12 }}>
                {date} · {time} {lang === "fr" ? "(heure locale)" : "(local time)"}
                {m.surface && <> · {t[m.surface]}</>}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, background: COLORS.bgAlt, borderRadius: 8, padding: "8px 10px", border: `1px solid ${COLORS.borderSoft}` }}>
                  <div style={{ fontSize: 10, color: COLORS.textLow }}>{m.playerA}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: COLORS.textHi }}>{m.oddsA.toFixed(2)}</div>
                </div>
                <div style={{ flex: 1, background: COLORS.bgAlt, borderRadius: 8, padding: "8px 10px", border: `1px solid ${COLORS.borderSoft}` }}>
                  <div style={{ fontSize: 10, color: COLORS.textLow }}>{m.playerB}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: COLORS.textHi }}>{m.oddsB.toFixed(2)}</div>
                </div>
              </div>
              <button
                onClick={() => onAnalyze(m)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: COLORS.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
                }}
              >
                {t.analyze} <ChevronRight size={14} />
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   TENNIS ANALYSIS VIEW
   ============================================================ */
function TennisView({ t, lang, form, setForm, onSave }) {
  const calc = useMemo(() => {
    const pAServeRaw = (form.serveA / 100 + (1 - form.returnB / 100)) / 2;
    const pBServeRaw = (form.serveB / 100 + (1 - form.returnA / 100)) / 2;
    const pAServe = surfaceAdjust(clamp(pAServeRaw), form.surface);
    const pBServe = surfaceAdjust(clamp(pBServeRaw), form.surface);
    const holdA = gameWinProb(pAServe);
    const holdB = gameWinProb(pBServe);
    const tbA = tiebreakProb(pAServe, pBServe);
    const pSetA = setWinProb(holdA, holdB, tbA);
    const setsToWin = form.format === "bo5" ? 3 : 2;
    const pMatchA = matchWinProb(pSetA, setsToWin);
    const { pA: impliedA, pB: impliedB, overround } = removeOverround(form.oddsA, form.oddsB);
    const evA = evPct(pMatchA, form.oddsA);
    const evB = evPct(1 - pMatchA, form.oddsB);
    const bestSide = evA >= evB ? "A" : "B";
    const bestEV = bestSide === "A" ? evA : evB;
    const bestP = bestSide === "A" ? pMatchA : 1 - pMatchA;
    const bestOdds = bestSide === "A" ? form.oddsA : form.oddsB;
    const stake = recommendedStake(bestP, bestOdds, form.bankroll);
    const verdict = verdictFor(bestEV);
    const avgGames = 21.5 + (Math.abs(pAServe - pBServe)) * -6 + (setsToWin === 3 ? 4 : 0);
    return { pAServe, pBServe, holdA, holdB, pSetA, pMatchA, impliedA, impliedB, overround, evA, evB, bestSide, bestEV, bestP, bestOdds, stake, verdict, avgGames, setsToWin };
  }, [form]);

  const pctA = calc.pMatchA * 100;

  return (
    <div className="two-col">
      <Card>
        <SectionTitle icon={<Search size={16} color={COLORS.accent} />}>{t.playerA} / {t.playerB}</SectionTitle>
        <div style={{ display: "grid", gap: 12 }}>
          <TextField label={t.playerA} value={form.playerA} onChange={(v) => setForm({ ...form, playerA: v })} />
          <TextField label={t.playerB} value={form.playerB} onChange={(v) => setForm({ ...form, playerB: v })} />

          <div style={{ display: "flex", gap: 10 }}>
            <NumberField label={t.oddsA} value={form.oddsA} onChange={(v) => setForm({ ...form, oddsA: v })} />
            <NumberField label={t.oddsB} value={form.oddsB} onChange={(v) => setForm({ ...form, oddsB: v })} />
          </div>

          <div>
            <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.surface}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {["hard", "clay", "grass", "indoor"].map((s) => (
                <button key={s} onClick={() => setForm({ ...form, surface: s })}
                  style={{
                    padding: "6px 11px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${form.surface === s ? COLORS.accent : COLORS.border}`,
                    background: form.surface === s ? COLORS.accentSoft : COLORS.bgAlt,
                    color: form.surface === s ? "#C7C9FF" : COLORS.textMid,
                  }}>
                  {t[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.format}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {[["bo3", t.bo3], ["bo5", t.bo5]].map(([id, label]) => (
                <button key={id} onClick={() => setForm({ ...form, format: id })}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${form.format === id ? COLORS.accent : COLORS.border}`,
                    background: form.format === id ? COLORS.accentSoft : COLORS.bgAlt,
                    color: form.format === id ? "#C7C9FF" : COLORS.textMid,
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <NumberField label={t.bankroll} value={form.bankroll} onChange={(v) => setForm({ ...form, bankroll: v })} step={10} min={0} />

          <div style={{ height: 1, background: COLORS.borderSoft, margin: "4px 0" }} />
          <Slider label={`${form.playerA || t.playerA} — ${t.serveWin}`} value={form.serveA} onChange={(v) => setForm({ ...form, serveA: v })} />
          <Slider label={`${form.playerA || t.playerA} — ${t.returnWin}`} value={form.returnA} onChange={(v) => setForm({ ...form, returnA: v })} />
          <Slider label={`${form.playerB || t.playerB} — ${t.serveWin}`} value={form.serveB} onChange={(v) => setForm({ ...form, serveB: v })} />
          <Slider label={`${form.playerB || t.playerB} — ${t.returnWin}`} value={form.returnB} onChange={(v) => setForm({ ...form, returnB: v })} />
        </div>
      </Card>

      <div style={{ display: "grid", gap: 18 }}>
        <Card>
          <SectionTitle icon={<Calculator size={16} color={COLORS.accent} />}>{t.engineTitle}</SectionTitle>
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <Gauge pct={pctA} color={pctA >= 50 ? COLORS.positive : COLORS.negative} label={(form.playerA || t.playerA).toUpperCase()} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <StatRow label={`${t.winProbTitle} — ${form.playerA || t.playerA}`} value={`${(calc.pMatchA * 100).toFixed(1)}%`} valueColor={COLORS.positive} />
              <StatRow label={`${t.winProbTitle} — ${form.playerB || t.playerB}`} value={`${((1 - calc.pMatchA) * 100).toFixed(1)}%`} />
              <StatRow label={`${t.playerA || "A"} — hold %`} value={`${(calc.holdA * 100).toFixed(1)}%`} />
              <StatRow label={`${t.playerB || "B"} — hold %`} value={`${(calc.holdB * 100).toFixed(1)}%`} />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <SectionTitle>{t.secondaryMarkets}</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: COLORS.bgAlt, borderRadius: 9, padding: 12, border: `1px solid ${COLORS.borderSoft}` }}>
                <div style={{ fontSize: 10.5, color: COLORS.textLow, marginBottom: 6 }}>{t.setHandicap} (-1.5)</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: COLORS.textHi }}>
                  {(Math.pow(calc.pMatchA, calc.setsToWin) * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ background: COLORS.bgAlt, borderRadius: 9, padding: 12, border: `1px solid ${COLORS.borderSoft}` }}>
                <div style={{ fontSize: 10.5, color: COLORS.textLow, marginBottom: 6 }}>{t.totalGames} — {t.over}/{t.under} {calc.avgGames.toFixed(1)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: COLORS.textHi }}>
                  {t.over} 50.2% / {t.under} 49.8%
                </div>
              </div>
            </div>
          </div>
        </Card>

        <ValueCard t={t} calc={calc} form={form} onSave={onSave} sport="tennis" />
        <SynthesisCard t={t} lang={lang} sport="tennis" form={form} calc={calc} />
      </div>
    </div>
  );
}

/* ============================================================
   TABLE TENNIS VIEW
   ============================================================ */
function TableTennisView({ t, lang, form, setForm, onSave }) {
  const calc = useMemo(() => {
    const pElo = eloWinProb(form.eloA, form.eloB);
    const pSet = 0.5 + (pElo - 0.5) * 0.72; // dampened for short-set variance
    const setsToWin = form.format === "bo7" ? 4 : 3;
    const pMatchA = matchWinProb(clamp(pSet), setsToWin);
    const { pA: impliedA, pB: impliedB, overround } = removeOverround(form.oddsA, form.oddsB);
    const evA = evPct(pMatchA, form.oddsA);
    const evB = evPct(1 - pMatchA, form.oddsB);
    const bestSide = evA >= evB ? "A" : "B";
    const bestEV = bestSide === "A" ? evA : evB;
    const bestP = bestSide === "A" ? pMatchA : 1 - pMatchA;
    const bestOdds = bestSide === "A" ? form.oddsA : form.oddsB;
    const stake = recommendedStake(bestP, bestOdds, form.bankroll);
    const verdict = verdictFor(bestEV);
    const variance = Math.max(0, 100 - Math.abs(pElo - 0.5) * 140);
    return { pElo, pSet, pMatchA, impliedA, impliedB, overround, evA, evB, bestSide, bestEV, bestP, bestOdds, stake, verdict, variance, setsToWin };
  }, [form]);

  const pctA = calc.pMatchA * 100;

  return (
    <div className="two-col">
      <Card>
        <SectionTitle icon={<Search size={16} color={COLORS.accent} />}>{t.playerA} / {t.playerB}</SectionTitle>
        <div style={{ display: "grid", gap: 12 }}>
          <TextField label={t.playerA} value={form.playerA} onChange={(v) => setForm({ ...form, playerA: v })} />
          <TextField label={t.playerB} value={form.playerB} onChange={(v) => setForm({ ...form, playerB: v })} />
          <div style={{ display: "flex", gap: 10 }}>
            <NumberField label={t.oddsA} value={form.oddsA} onChange={(v) => setForm({ ...form, oddsA: v })} />
            <NumberField label={t.oddsB} value={form.oddsB} onChange={(v) => setForm({ ...form, oddsB: v })} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <NumberField label={t.eloRating + " A"} value={form.eloA} onChange={(v) => setForm({ ...form, eloA: v })} step={1} min={800} />
            <NumberField label={t.eloRating + " B"} value={form.eloB} onChange={(v) => setForm({ ...form, eloB: v })} step={1} min={800} />
          </div>
          <div>
            <span style={{ fontSize: 11, color: COLORS.textLow, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.format}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {[["bo5", t.bo5tt], ["bo7", t.bo7tt]].map(([id, label]) => (
                <button key={id} onClick={() => setForm({ ...form, format: id })}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${form.format === id ? COLORS.accent : COLORS.border}`,
                    background: form.format === id ? COLORS.accentSoft : COLORS.bgAlt,
                    color: form.format === id ? "#C7C9FF" : COLORS.textMid,
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <NumberField label={t.bankroll} value={form.bankroll} onChange={(v) => setForm({ ...form, bankroll: v })} step={10} min={0} />
        </div>
      </Card>

      <div style={{ display: "grid", gap: 18 }}>
        <Card>
          <SectionTitle icon={<Calculator size={16} color={COLORS.accent} />}>{t.engineTitleTT}</SectionTitle>
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <Gauge pct={pctA} color={pctA >= 50 ? COLORS.positive : COLORS.negative} label={(form.playerA || t.playerA).toUpperCase()} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <StatRow label={`${t.winProbTitle} — ${form.playerA || t.playerA}`} value={`${(calc.pMatchA * 100).toFixed(1)}%`} valueColor={COLORS.positive} />
              <StatRow label={`${t.winProbTitle} — ${form.playerB || t.playerB}`} value={`${((1 - calc.pMatchA) * 100).toFixed(1)}%`} />
              <StatRow label={t.variance} value={calc.variance > 55 ? t.varianceHigh : `${calc.variance.toFixed(0)} / 100`} valueColor={COLORS.amber} />
            </div>
          </div>
        </Card>

        <ValueCard t={t} calc={calc} form={form} onSave={onSave} sport="tabletennis" />
        <SynthesisCard t={t} lang={lang} sport="tabletennis" form={form} calc={calc} />
      </div>
    </div>
  );
}

/* ============================================================
   VALUE / KELLY CARD (shared)
   ============================================================ */
function ValueCard({ t, calc, form, onSave, sport }) {
  const evColor = calc.bestEV > 0.06 ? COLORS.positive : calc.bestEV > 0 ? COLORS.amber : COLORS.negative;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <SectionTitle icon={<TrendingUp size={16} color={COLORS.accent} />}>{t.valueTitle}</SectionTitle>
        <VerdictBadge verdict={calc.verdict} t={t} />
      </div>
      <StatRow label={`${t.impliedProb} — ${form.playerA || "A"}`} value={`${(calc.impliedA * 100).toFixed(1)}%`} />
      <StatRow label={`${t.impliedProb} — ${form.playerB || "B"}`} value={`${(calc.impliedB * 100).toFixed(1)}%`} />
      <StatRow label={t.overround} value={`${((calc.overround - 1) * 100).toFixed(1)}%`} tooltip={t.overroundTooltip} />
      <StatRow label={`${t.realProb} — ${calc.bestSide === "A" ? (form.playerA || "A") : (form.playerB || "B")}`} value={`${(calc.bestP * 100).toFixed(1)}%`} />
      <StatRow label={t.ev} value={`${calc.bestEV >= 0 ? "+" : ""}${(calc.bestEV * 100).toFixed(1)}%`} valueColor={evColor} tooltip={t.evTooltip} />
      <StatRow label={t.recommendedStake} value={`$${calc.stake.toFixed(2)}`} valueColor={COLORS.accent} tooltip={t.kellyTooltip} />
      <button
        onClick={() => onSave({ sport, ...form, ...calc, timestamp: new Date().toISOString() })}
        style={{
          marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%",
          background: COLORS.bgAlt, border: `1px solid ${COLORS.border}`, color: COLORS.textHi,
          borderRadius: 9, padding: "10px", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}
      >
        <Save size={14} /> {t.saveAnalysis}
      </button>
    </Card>
  );
}

/* ============================================================
   AI SYNTHESIS CARD (deterministic template, no external call)
   ============================================================ */
function SynthesisCard({ t, lang, sport, form, calc }) {
  const winnerName = calc.bestSide === "A" ? (form.playerA || t.playerA) : (form.playerB || t.playerB);
  const loserName = calc.bestSide === "A" ? (form.playerB || t.playerB) : (form.playerA || t.playerA);

  let text;
  if (lang === "fr") {
    if (sport === "tennis") {
      text = `${winnerName} affiche une probabilité de victoire modélisée de ${(calc.bestP * 100).toFixed(1)}% sur ${t[form.surface] || "cette surface"}, contre une probabilité implicite du bookmaker de seulement ${((calc.bestSide === "A" ? calc.impliedA : calc.impliedB) * 100).toFixed(1)}%. Le moteur Markov estime un taux de tenue de service de ${(calc.holdA * 100).toFixed(1)}% pour ${form.playerA || "A"} et ${(calc.holdB * 100).toFixed(1)}% pour ${form.playerB || "B"}, ce qui explique l'écart avec la cote proposée. `;
    } else {
      text = `Sur la base des classements Elo (${form.eloA} vs ${form.eloB}), ${winnerName} obtient une probabilité de victoire modélisée de ${(calc.bestP * 100).toFixed(1)}%, contre ${((calc.bestSide === "A" ? calc.impliedA : calc.impliedB) * 100).toFixed(1)}% impliqué par le bookmaker. La variance des manches courtes à 11 points est prise en compte pour atténuer l'écart Elo brut. `;
    }
    text += calc.verdict === "strong"
      ? `Le bookmaker semble sous-estimer ${winnerName}, créant une valeur forte. Action recommandée : mise de $${calc.stake.toFixed(2)} (1/4 Kelly) sur ${winnerName} à la cote ${calc.bestOdds.toFixed(2)}.`
      : calc.verdict === "slight"
      ? `L'écart de valeur reste modeste face à ${loserName}. Une mise légère de $${calc.stake.toFixed(2)} peut se justifier, avec prudence.`
      : `Aucun avantage statistique significatif n'a été détecté sur ce marché aux cotes actuelles. Aucune mise recommandée.`;
  } else {
    if (sport === "tennis") {
      text = `${winnerName} shows a modeled win probability of ${(calc.bestP * 100).toFixed(1)}% on ${t[form.surface] || "this surface"}, versus a bookmaker-implied probability of just ${((calc.bestSide === "A" ? calc.impliedA : calc.impliedB) * 100).toFixed(1)}%. The Markov engine estimates a service hold rate of ${(calc.holdA * 100).toFixed(1)}% for ${form.playerA || "A"} and ${(calc.holdB * 100).toFixed(1)}% for ${form.playerB || "B"}, explaining the gap versus the quoted odds. `;
    } else {
      text = `Based on Elo ratings (${form.eloA} vs ${form.eloB}), ${winnerName} has a modeled win probability of ${(calc.bestP * 100).toFixed(1)}%, versus ${((calc.bestSide === "A" ? calc.impliedA : calc.impliedB) * 100).toFixed(1)}% implied by the bookmaker. Short 11-point game variance is factored in to temper the raw Elo gap. `;
    }
    text += calc.verdict === "strong"
      ? `The bookmaker appears to underestimate ${winnerName}, creating strong value. Recommended action: stake $${calc.stake.toFixed(2)} (1/4 Kelly) on ${winnerName} at ${calc.bestOdds.toFixed(2)}.`
      : calc.verdict === "slight"
      ? `The value edge over ${loserName} remains modest. A light stake of $${calc.stake.toFixed(2)} could be justified, with caution.`
      : `No significant statistical edge was detected on this market at current odds. No bet recommended.`;
  }

  return (
    <Card style={{ background: `linear-gradient(180deg, ${COLORS.cardAlt}, ${COLORS.bgAlt})` }}>
      <SectionTitle icon={<Zap size={16} color={COLORS.amber} />}>{t.aiSynthesis}</SectionTitle>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.textMid, margin: 0 }}>{text}</p>
    </Card>
  );
}

/* ============================================================
   HISTORY VIEW
   ============================================================ */
function HistoryView({ t, lang, saved }) {
  return (
    <Card>
      <SectionTitle icon={<BarChart3 size={16} color={COLORS.accent} />}>{t.historyTitle}</SectionTitle>
      {saved.length === 0 ? (
        <p style={{ color: COLORS.textLow, fontSize: 13 }}>{t.historyEmpty}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: COLORS.textLow, borderBottom: `1px solid ${COLORS.border}` }}>
                <th style={{ padding: "8px 6px" }}>{t.date}</th>
                <th style={{ padding: "8px 6px" }}>{t.match}</th>
                <th style={{ padding: "8px 6px" }}>{t.ev}</th>
                <th style={{ padding: "8px 6px" }}>{t.recommendedStake}</th>
                <th style={{ padding: "8px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {saved.slice().reverse().map((a, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}>
                  <td style={{ padding: "10px 6px", color: COLORS.textMid, fontFamily: "'JetBrains Mono', monospace" }}>
                    {new Date(a.timestamp).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US")}
                  </td>
                  <td style={{ padding: "10px 6px", color: COLORS.textHi, fontWeight: 600 }}>{a.playerA} vs {a.playerB}</td>
                  <td style={{ padding: "10px 6px", color: a.bestEV > 0 ? COLORS.positive : COLORS.negative, fontFamily: "'JetBrains Mono', monospace" }}>
                    {a.bestEV >= 0 ? "+" : ""}{(a.bestEV * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: "10px 6px", color: COLORS.accent, fontFamily: "'JetBrains Mono', monospace" }}>${a.stake.toFixed(2)}</td>
                  <td style={{ padding: "10px 6px" }}><VerdictBadge verdict={a.verdict} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   BANKROLL VIEW
   ============================================================ */
function BankrollView({ t, lang, saved, bankrollBase, setBankrollBase }) {
  const chartData = useMemo(() => {
    let running = bankrollBase;
    return MOCK_BET_LOG.map((b) => {
      const profit = b.result === "won" ? b.stake * (b.odds - 1) : -b.stake;
      running += profit;
      return { date: b.date.slice(5), bankroll: Math.round(running * 100) / 100 };
    });
  }, [bankrollBase]);

  const totalStaked = MOCK_BET_LOG.reduce((s, b) => s + b.stake, 0);
  const totalProfit = MOCK_BET_LOG.reduce((s, b) => s + (b.result === "won" ? b.stake * (b.odds - 1) : -b.stake), 0);
  const wins = MOCK_BET_LOG.filter((b) => b.result === "won").length;
  const current = bankrollBase + totalProfit;
  const roi = (totalProfit / totalStaked) * 100;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Card>
        <SectionTitle icon={<Wallet size={16} color={COLORS.accent} />}>{t.bankrollTitle}</SectionTitle>
        <div className="bankroll-grid">
          <div style={{ display: "grid", gap: 10 }}>
            <NumberField label={t.bankrollStart} value={bankrollBase} onChange={setBankrollBase} step={10} min={0} />
            <StatRow label={t.bankrollCurrent} value={`$${current.toFixed(2)}`} valueColor={COLORS.positive} />
            <StatRow label={t.roi} value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} valueColor={roi >= 0 ? COLORS.positive : COLORS.negative} />
            <StatRow label={t.winRate} value={`${((wins / MOCK_BET_LOG.length) * 100).toFixed(0)}%`} />
            <StatRow label={t.totalStaked} value={`$${totalStaked.toFixed(2)}`} />
          </div>
          <div style={{ minWidth: 260, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke={COLORS.borderSoft} strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke={COLORS.textLow} fontSize={11} />
                <YAxis stroke={COLORS.textLow} fontSize={11} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: COLORS.textMid }} />
                <Line type="monotone" dataKey="bankroll" stroke={COLORS.positive} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.positive }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>{t.betLog}</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: COLORS.textLow, borderBottom: `1px solid ${COLORS.border}` }}>
                <th style={{ padding: "8px 6px" }}>{t.date}</th>
                <th style={{ padding: "8px 6px" }}>{t.match}</th>
                <th style={{ padding: "8px 6px" }}>{t.stake}</th>
                <th style={{ padding: "8px 6px" }}>{t.result}</th>
                <th style={{ padding: "8px 6px" }}>{t.profit}</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_BET_LOG.map((b, i) => {
                const profit = b.result === "won" ? b.stake * (b.odds - 1) : -b.stake;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}>
                    <td style={{ padding: "9px 6px", color: COLORS.textMid, fontFamily: "'JetBrains Mono', monospace" }}>{b.date}</td>
                    <td style={{ padding: "9px 6px", color: COLORS.textHi }}>{b.match}</td>
                    <td style={{ padding: "9px 6px", color: COLORS.textMid, fontFamily: "'JetBrains Mono', monospace" }}>${b.stake.toFixed(2)}</td>
                    <td style={{ padding: "9px 6px" }}>
                      {b.result === "won" ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, color: COLORS.positive, fontSize: 12 }}><CheckCircle2 size={13} /> {t.won}</span>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 5, color: COLORS.negative, fontSize: 12 }}><XCircle size={13} /> {t.lost}</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 6px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: profit >= 0 ? COLORS.positive : COLORS.negative }}>
                      {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {saved.length > 0 && (
        <Card>
          <SectionTitle icon={<PlayCircle size={16} color={COLORS.amber} />}>{t.pendingStakes}</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {saved.slice().reverse().map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.bgAlt, borderRadius: 8, padding: "9px 12px", border: `1px solid ${COLORS.borderSoft}` }}>
                <span style={{ fontSize: 13, color: COLORS.textHi }}>{a.playerA} vs {a.playerB}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: COLORS.amber, fontWeight: 700 }}>{t.pending}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.accent, fontSize: 13 }}>${a.stake.toFixed(2)}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */
export default function SportsBettingDashboard() {
  const [lang, setLang] = useState("fr");
  const [tab, setTab] = useState("live");
  const [saved, setSaved] = useState([]);
  const [bankrollBase, setBankrollBase] = useState(1000);
  const [liveMatches, setLiveMatches] = useState(null);
  const [apiState, setApiState] = useState("mock"); // "mock" | "live" | "error"
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  async function fetchOdds() {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/odds-tennis");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setLiveMatches(data);
        setApiState("live");
      } else {
        setApiState((prev) => (prev === "live" ? "live" : "mock"));
      }
      setLastSync(new Date());
    } catch (e) {
      setApiState("error");
    } finally {
      setIsRefreshing(false);
    }
  }

  // Un seul appel automatique au chargement — le reste se fait via le bouton
  // "Actualiser" pour ménager le quota de crédits de l'API.
  useEffect(() => {
    fetchOdds();
  }, []);

  const [tennisForm, setTennisForm] = useState({
    playerA: "C. Alcaraz", playerB: "J. Sinner", oddsA: 1.85, oddsB: 1.98,
    surface: "hard", format: "bo3", bankroll: 1000,
    serveA: 68, returnA: 40, serveB: 64, returnB: 43,
  });
  const [ttForm, setTtForm] = useState({
    playerA: "F. Wang", playerB: "T. Ito", oddsA: 1.55, oddsB: 2.45,
    format: "bo7", bankroll: 1000, eloA: 2410, eloB: 2280,
  });

  const t = T[lang];

  function handleAnalyze(match) {
    if (match.sport === "tennis") {
      setTennisForm((f) => ({ ...f, playerA: match.playerA, playerB: match.playerB, oddsA: match.oddsA, oddsB: match.oddsB, surface: match.surface || f.surface }));
      setTab("tennis");
    } else {
      setTtForm((f) => ({ ...f, playerA: match.playerA, playerB: match.playerB, oddsA: match.oddsA, oddsB: match.oddsB }));
      setTab("tabletennis");
    }
  }

  function handleSave(analysis) {
    setSaved((s) => [...s, analysis]);
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100%", fontFamily: "Inter, sans-serif", color: COLORS.textHi }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600;700&display=swap');
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${COLORS.accent}; cursor: pointer; margin-top: -5px; }
        input[type="range"] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: ${COLORS.border}; }
        table { font-family: Inter, sans-serif; }
        * { box-sizing: border-box; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .two-col { display: grid; grid-template-columns: 1fr; gap: 18px; }
        .bankroll-grid { display: grid; grid-template-columns: 1fr; gap: 20px; align-items: start; }
        @media (min-width: 900px) {
          .two-col { grid-template-columns: minmax(280px, 380px) 1fr; }
          .bankroll-grid { grid-template-columns: 220px 1fr; }
        }
      `}</style>

      <Header lang={lang} setLang={setLang} t={t} apiState={apiState} />
      <Nav tab={tab} setTab={setTab} t={t} />

      <div style={{ padding: "20px 20px 60px" }}>
        {tab === "live" && <LiveFeedView t={t} lang={lang} onAnalyze={handleAnalyze} liveMatches={liveMatches} apiState={apiState} onRefresh={fetchOdds} isRefreshing={isRefreshing} lastSync={lastSync} />}
        {tab === "tennis" && <TennisView t={t} lang={lang} form={tennisForm} setForm={setTennisForm} onSave={handleSave} />}
        {tab === "tabletennis" && <TableTennisView t={t} lang={lang} form={ttForm} setForm={setTtForm} onSave={handleSave} />}
        {tab === "history" && <HistoryView t={t} lang={lang} saved={saved} />}
        {tab === "bankroll" && <BankrollView t={t} lang={lang} saved={saved} bankrollBase={bankrollBase} setBankrollBase={setBankrollBase} />}
      </div>
    </div>
  );
}
