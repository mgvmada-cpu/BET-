// api/tennis-analysis.js — Fonction serverless Vercel (Node.js)
//
// Récupère, pour deux joueurs nommés, les statistiques réelles service/retour
// issues de leur historique de confrontations (H2H), le classement ATP/WTA en
// direct, et les renvoie normalisées pour QuantCourt.
//
// Source : "Tennis API - ATP WTA ITF" sur RapidAPI (tennis-api-atp-wta-itf.p.rapidapi.com)
//
// IMPORTANT : les endpoints H2H de cette API attendent des IDENTIFIANTS NUMÉRIQUES,
// pas des noms en texte libre. On fait donc d'abord une recherche par nom pour
// résoudre chaque joueur vers son ID, puis on appelle le H2H avec ces IDs.
//
// SÉCURITÉ : la clé n'est jamais exposée au navigateur, elle reste côté serveur.

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
      return res.status(200).json({
        playerA, playerB, tour: tour.toUpperCase(),
        rankA: null, pointsA: null, rankB: null, pointsB: null,
        serveA: null, serveB: null, returnA: null, returnB: null,
        error: "player_not_found",
        detail: {
          playerAFound: !!resolvedA,
          playerBFound: !!resolvedB,
        },
      });
    }

    const tourForH2h = resolvedA.tour; // les deux joueurs sont normalement sur le même circuit

    // 2. Stats H2H (service/retour, points de break, etc.) avec les vrais IDs
    const h2hUrl = new URL(`https://${HOST}/tennis/v2/h2h/stats/${tourForH2h}/${resolvedA.id}/${resolvedB.id}`);
    if (surface) h2hUrl.searchParams.set("surface", surface);
    const h2hRes = await fetch(h2hUrl.toString(), { headers });
    const h2hData = h2hRes.ok ? await h2hRes.json() : { statusCode: h2hRes.status, message: await safeText(h2hRes) };

    // 3. Classement en direct pour situer les deux joueurs
    const rankRes = await fetch(`https://${HOST}/tennis/v2/ms-api/${tourForH2h}/player`, { headers });
    const rankData = rankRes.ok ? await rankRes.json() : null;
    const players = (rankData && (rankData.data || rankData.players || rankData)) || [];
    const rankA = findPlayerInList(players, resolvedA.id, resolvedA.name);
    const rankB = findPlayerInList(players, resolvedB.id, resolvedB.name);

    // 4. Extraction souple des % service/retour depuis la réponse H2H
    const raw = (h2hData && h2hData.data) || h2hData || {};
    const p1 = findObj(raw, "player1") || findObj(raw, "playerstats") || raw;
    const p2 = findObj(raw, "player2") || findObj(raw, "opponentstats") || raw;
    const serveA = findStat(p1, ["servewon", "servicewon", "firstservewon"]);
    const serveB = findStat(p2, ["servewon", "servicewon", "firstservewon"]);
    const returnA = findStat(p1, ["returnwon", "returnpointswon"]);
    const returnB = findStat(p2, ["returnwon", "returnpointswon"]);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      playerA: resolvedA.name, playerB: resolvedB.name, tour: tourForH2h.toUpperCase(),
      rankA: rankA ? rankA.rank : null,
      pointsA: rankA ? rankA.points : null,
      rankB: rankB ? rankB.rank : null,
      pointsB: rankB ? rankB.points : null,
      serveA: normalizePct(serveA),
      serveB: normalizePct(serveB),
      returnA: normalizePct(returnA),
      returnB: normalizePct(returnB),
      h2hRaw: raw, // données brutes, au cas où l'extraction automatique manque un champ
    });
  } catch (err) {
    res.status(502).json({ error: "Échec de récupération des données joueurs", detail: String(err.message || err) });
  }
}

async function safeText(r) {
  try { return await r.text(); } catch { return null; }
}

// Cherche un joueur par nom via l'endpoint de recherche global (ATP + WTA)
async function searchPlayer(name, headers) {
  const url = `https://${HOST}/tennis/v2/search?query=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const data = await r.json();
  const buckets = (data && (data.data || data)) || [];
  const bucketList = Array.isArray(buckets) ? buckets : Object.values(buckets);

  for (const bucket of bucketList) {
    const category = (bucket && bucket.category) || "";
    if (category !== "player_atp" && category !== "player_wta") continue;
    const results = bucket.results || bucket.items || bucket.players || bucket.data || [];
    if (!Array.isArray(results) || results.length === 0) continue;
    const lower = name.toLowerCase();
    const exact = results.find((p) => (p.name || "").toLowerCase() === lower);
    const pick = exact || results[0];
    if (pick && pick.id != null) {
      return { id: pick.id, name: pick.name || name, tour: category === "player_atp" ? "atp" : "wta" };
    }
  }
  return null;
}

// Trouve un joueur dans la liste de classement par ID (prioritaire) ou par nom
function findPlayerInList(players, id, name) {
  if (!Array.isArray(players)) return null;
  const byId = players.find((p) => p.id === id || p.playerId === id);
  if (byId) return normalizeRankEntry(byId);
  const lower = (name || "").toLowerCase();
  const byName = players.find((p) => (p.name || "").toLowerCase() === lower);
  return byName ? normalizeRankEntry(byName) : null;
}
function normalizeRankEntry(p) {
  return {
    rank: p.rank ?? p.ranking ?? p.currentRank ?? null,
    points: p.points ?? p.rankingPoints ?? null,
  };
}

// Trouve le premier sous-objet dont la clé contient `tag` (insensible à la casse)
function findObj(obj, tag) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes(tag) && v && typeof v === "object") return v;
  }
  return null;
}

// Recherche récursive (profondeur limitée) d'une valeur numérique dont le nom de
// la clé contient l'un des motifs demandés (insensible à la casse).
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

// Ramène une valeur (déjà en % ex. 64, ou en fraction ex. 0.64) sur une échelle 0-100
function normalizePct(v) {
  if (v === null || v === undefined || isNaN(v)) return null;
  const n = v <= 1 ? v * 100 : v;
  return Math.round(Math.max(1, Math.min(99, n)));
}
