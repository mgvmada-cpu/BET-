// api/tennis-analysis.js — Fonction serverless Vercel (Node.js)
//
// Récupère, pour deux joueurs nommés, les statistiques réelles service/retour
// issues de leur historique de confrontations (H2H), le classement ATP/WTA en
// direct, et les renvoie normalisées pour QuantCourt.
//
// Source : "Tennis API - ATP WTA ITF" sur RapidAPI (tennis-api-atp-wta-itf.p.rapidapi.com)
// Abonne-toi à ce produit sur RapidAPI (vérifie le palier gratuit sur leur page
// tarifs) et copie ta clé dans la variable d'environnement RAPIDAPI_KEY.
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

  const headers = { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": HOST };
  const tourLower = tour.toLowerCase() === "wta" ? "wta" : "atp";
  const tourUpper = tourLower.toUpperCase();

  try {
    // 1. Stats H2H (service/retour, points de break, etc.) pour cette confrontation précise
    const h2hUrl = new URL(`https://${HOST}/tennis/v2/h2h/stats/${tourLower}/${encodeURIComponent(playerA)}/${encodeURIComponent(playerB)}`);
    if (surface) h2hUrl.searchParams.set("surface", surface);
    const h2hRes = await fetch(h2hUrl.toString(), { headers });
    const h2hData = h2hRes.ok ? await h2hRes.json() : null;

    // 2. Classement en direct pour situer les deux joueurs
    const rankRes = await fetch(`https://${HOST}/tennis/v2/ranking/live?tour=${tourUpper}`, { headers });
    const rankData = rankRes.ok ? await rankRes.json() : null;
    const rankings = (rankData && rankData.rankings) || [];

    function findRanking(name) {
      const needle = name.toLowerCase().split(" ").pop(); // nom de famille
      return rankings.find((r) => (r.player || "").toLowerCase().includes(needle)) || null;
    }
    const rankA = findRanking(playerA);
    const rankB = findRanking(playerB);

    // 3. Extraction souple des % service/retour depuis la réponse H2H — le schéma
    //    exact du champ "data" peut varier ; on isole d'abord le sous-objet de
    //    chaque joueur (player1Stats / player2Stats ou équivalent), puis on y
    //    cherche les clés de service/retour les plus probables.
    const raw = (h2hData && h2hData.data) || h2hData || {};
    const p1 = findObj(raw, "player1") || findObj(raw, "playerstats") || raw;
    const p2 = findObj(raw, "player2") || findObj(raw, "opponentstats") || raw;
    const serveA = findStat(p1, ["servewon", "servicewon", "firstservewon"]);
    const serveB = findStat(p2, ["servewon", "servicewon", "firstservewon"]);
    const returnA = findStat(p1, ["returnwon", "returnpointswon"]);
    const returnB = findStat(p2, ["returnwon", "returnpointswon"]);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      playerA, playerB, tour: tourUpper,
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
