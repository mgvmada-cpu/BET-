// api/tennis-analysis.js — Fonction serverless Vercel (Node.js)
//
// Récupère, pour deux joueurs nommés, les statistiques réelles service/retour
// issues de leur historique de confrontations (H2H) ou de leurs fiches individuelles,
// ainsi que le classement ATP/WTA en direct, et les renvoie normalisées pour QuantCourt.
//
// Source : "Tennis API - ATP WTA ITF" sur RapidAPI (tennis-api-atp-wta-itf.p.rapidapi.com)

const HOST = "tennis-api-atp-wta-itf.p.rapidapi.com";

export default async function handler(req, res) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RAPIDAPI_KEY manquante côté serveur" });
  }

  const { playerA, playerB, tour = "atp", surface } = req.query;
  if (!playerA || !playerB) {
    return res.status(400).json({ error: "Paramètres playerA et playerB requis" });
  }

  const headers = { "x-rapidapi-key": apiKey, "x-rapidapi-host": HOST };

  try {
    // 1. Résoudre chaque nom vers son ID numérique + tour (ATP/WTA) via la recherche
    const [resolvedA, resolvedB] = await Promise.all([
      searchPlayer(playerA, headers),
      searchPlayer(playerB, headers),
    ]);

    if (!resolvedA || !resolvedB) {
      const [rawA, rawB] = await Promise.all([
        debugSearch(playerA, headers),
        debugSearch(playerB, headers),
      ]);
      return res.status(200).json({
        playerA, playerB, tour: tour.toUpperCase(),
        rankA: null, pointsA: null, rankB: null, pointsB: null,
        serveA: null, serveB: null, returnA: null, returnB: null,
        error: "player_not_found",
        detail: {
          playerAFound: !!resolvedA,
          playerBFound: !!resolvedB,
          rawSearchA: rawA,
          rawSearchB: rawB,
        },
      });
    }

    const tourForH2h = resolvedA.tour || tour.toLowerCase();

    // 2. Récupération des statistiques (H2H prioritaire, sinon Stats individuelles)
    let serveA = null, serveB = null, returnA = null, returnB = null;
    let h2hRaw = null;

    try {
      const h2hUrl = new URL(`https://${HOST}/tennis/v2/h2h/stats/${tourForH2h}/${resolvedA.id}/${resolvedB.id}`);
      if (surface) h2hUrl.searchParams.set("surface", surface);
      const h2hRes = await fetch(h2hUrl.toString(), { headers });
      
      if (h2hRes.ok) {
        h2hRaw = await h2hRes.json();
        const raw = (h2hRaw && h2hRaw.data) || h2hRaw || {};
        const p1 = findObj(raw, "player1") || findObj(raw, "playerstats") || raw;
        const p2 = findObj(raw, "player2") || findObj(raw, "opponentstats") || raw;

        serveA = findStat(p1, ["servewon", "servicewon", "firstservewon"]);
        serveB = findStat(p2, ["servewon", "servicewon", "firstservewon"]);
        returnA = findStat(p1, ["returnwon", "returnpointswon"]);
        returnB = findStat(p2, ["returnwon", "returnpointswon"]);
      }
    } catch (e) {
      console.warn("Échec H2H, passage au fallback individuel", e);
    }

    // Fallback : Si les stats H2H sont incomplètes, charger les profils individuels
    if (serveA === null || returnA === null) {
      const statsA = await fetchPlayerStats(resolvedA.id, tourForH2h, headers);
      if (serveA === null) serveA = statsA.serve;
      if (returnA === null) returnA = statsA.return;
    }
    if (serveB === null || returnB === null) {
      const statsB = await fetchPlayerStats(resolvedB.id, tourForH2h, headers);
      if (serveB === null) serveB = statsB.serve;
      if (returnB === null) returnB = statsB.return;
    }

    // 3. Classement en direct
    const rankRes = await fetch(`https://${HOST}/tennis/v2/ms-api/${tourForH2h}/player`, { headers });
    const rankData = rankRes.ok ? await rankRes.json() : null;
    const players = (rankData && (rankData.data || rankData.players || rankData)) || [];
    const rankA = findPlayerInList(players, resolvedA.id, resolvedA.name);
    const rankB = findPlayerInList(players, resolvedB.id, resolvedB.name);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      playerA: resolvedA.name, 
      playerB: resolvedB.name, 
      tour: tourForH2h.toUpperCase(),
      rankA: rankA ? rankA.rank : null,
      pointsA: rankA ? rankA.points : null,
      rankB: rankB ? rankB.rank : null,
      pointsB: rankB ? rankB.points : null,
      serveA: normalizePct(serveA),
      serveB: normalizePct(serveB),
      returnA: normalizePct(returnA),
      returnB: normalizePct(returnB),
      h2hRaw: h2hRaw,
    });
  } catch (err) {
    res.status(502).json({ error: "Échec de récupération des données joueurs", detail: String(err.message || err) });
  }
}

// Fonction de recherche de joueur tolérante et robuste
async function searchPlayer(name, headers) {
  const url = `https://${HOST}/tennis/v2/search?query=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return null;

  const data = await r.json();
  const buckets = (data && (data.data || data)) || [];
  const bucketList = Array.isArray(buckets) ? buckets : Object.values(buckets);

  const unwrap = (item) => (item ? (item.entity || item.player || item.item || item) : null);

  for (const bucket of bucketList) {
    const category = (bucket && bucket.category) || "";
    if (category !== "player_atp" && category !== "player_wta") continue;

    const rawResults = bucket.results || bucket.items || bucket.players || bucket.data || [];
    if (!Array.isArray(rawResults) || rawResults.length === 0) continue;

    const results = rawResults.map(unwrap).filter(Boolean);
    const lower = name.toLowerCase().trim();

    // 1. Recherche par correspondance exacte
    let pick = results.find((p) => {
      const pName = (p.name || p.fullName || "").toLowerCase();
      return pName === lower;
    });

    // 2. Recherche par sous-chaîne ou mots clés (ex: prénom + nom inversés)
    if (!pick) {
      const parts = lower.split(" ");
      pick = results.find((p) => {
        const pName = (p.name || p.fullName || "").toLowerCase();
        return parts.every((part) => pName.includes(part));
      });
    }

    // 3. Premier résultat par défaut du bucket ATP/WTA
    if (!pick) pick = results[0];

    if (pick && (pick.id != null || pick.playerId != null)) {
      return {
        id: pick.id ?? pick.playerId,
        name: pick.name || pick.fullName || name,
        tour: category === "player_atp" ? "atp" : "wta",
      };
    }
  }
  return null;
}

// Récupération des statistiques individuelles d'un joueur en cas de H2H vide
async function fetchPlayerStats(playerId, tour, headers) {
  try {
    const url = `https://${HOST}/tennis/v2/player/${tour}/${playerId}/stats`;
    const r = await fetch(url, { headers });
    if (!r.ok) return { serve: null, return: null };
    const data = await r.json();
    const raw = (data && data.data) || data || {};

    return {
      serve: findStat(raw, ["servewon", "servicewon", "firstservewon"]),
      return: findStat(raw, ["returnwon", "returnpointswon"]),
    };
  } catch {
    return { serve: null, return: null };
  }
}

async function debugSearch(name, headers) {
  try {
    const url = `https://${HOST}/tennis/v2/search?query=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json || text };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function findPlayerInList(players, id, name) {
  if (!Array.isArray(players)) return null;
  const byId = players.find((p) => p.id === id || p.playerId === id);
  if (byId) return normalizeRankEntry(byId);
  const lower = (name || "").toLowerCase();
  const byName = players.find((p) => (p.name || p.fullName || "").toLowerCase().includes(lower));
  return byName ? normalizeRankEntry(byName) : null;
}

function normalizeRankEntry(p) {
  return {
    rank: p.rank ?? p.ranking ?? p.currentRank ?? null,
    points: p.points ?? p.rankingPoints ?? null,
  };
}

function findObj(obj, tag) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes(tag) && v && typeof v === "object") return v;
  }
  return null;
}

function findStat(obj, patterns, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (typeof v === "number" && patterns.some((p) => key.includes(p))) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = findStat(v, patterns, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function normalizePct(v) {
  if (v === null || v === undefined || isNaN(v)) return null;
  const n = v <= 1 ? v * 100 : v;
  return Math.round(Math.max(1, Math.min(99, n)));
      }
