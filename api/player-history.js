// api/player-history.js — Fonction serverless Vercel (Node.js)
//
// Récupère l'historique des matchs joués par UN joueur (nom en clair, pas besoin
// d'ID) via l'API "Tennis API - ATP WTA ITF" sur RapidAPI, et met en avant son
// match le plus récent.
//
// SÉCURITÉ : la clé n'est jamais exposée au navigateur, elle reste côté serveur.

const HOST = "tennis-api-atp-wta-itf.p.rapidapi.com";

export default async function handler(req, res) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RAPIDAPI_KEY manquante côté serveur" });
  }

  const { player } = req.query;
  if (!player) {
    return res.status(400).json({ error: "Paramètre player requis" });
  }

  const headers = { "x-rapidapi-key": apiKey, "x-rapidapi-host": HOST };

  try {
    const url = `https://${HOST}/tennis/v2/ms-api/profile/${encodeURIComponent(player)}/matches-played`;
    const r = await fetch(url, { headers });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!r.ok || !json) {
      return res.status(200).json({
        player, matches: [], mostRecent: null,
        error: "fetch_failed", detail: { status: r.status, body: json || text },
      });
    }

    // La liste peut être directement un tableau, ou nichée sous data/matches/result
    const list = Array.isArray(json) ? json
      : Array.isArray(json.data) ? json.data
      : Array.isArray(json.matches) ? json.matches
      : Array.isArray(json.result) ? json.result
      : [];

    const matches = list.map(normalizeMatch).filter(Boolean);
    // Tri du plus récent au plus ancien si une date est disponible
    matches.sort((a, b) => (b.dateSort || 0) - (a.dateSort || 0));

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    res.status(200).json({
      player,
      matches: matches.slice(0, 10),
      mostRecent: matches[0] || null,
      rawSample: list.slice(0, 1), // pour diagnostic si l'extraction rate un champ
    });
  } catch (err) {
    res.status(502).json({ error: "Échec de récupération de l'historique", detail: String(err.message || err) });
  }
}

function normalizeMatch(m) {
  if (!m || typeof m !== "object") return null;
  const opponent = m.opponent || m.opponentName || (m.player2 && m.player2.name) || (m.player1 && m.player1.name) || null;
  const score = m.score || m.result || null;
  const tournament = (m.tournament && m.tournament.name) || m.tournamentName || m.league || null;
  const round = (m.round && m.round.name) || m.roundName || null;
  const dateRaw = m.date || m.startTimestamp || m.timestamp || null;
  let dateSort = 0, dateDisplay = null;
  if (dateRaw) {
    const d = typeof dateRaw === "number" ? new Date(dateRaw * (dateRaw < 2e10 ? 1000 : 1)) : new Date(dateRaw);
    if (!isNaN(d.getTime())) { dateSort = d.getTime(); dateDisplay = d.toISOString().slice(0, 10); }
  }
  if (!opponent && !score) return null;
  return { opponent, score, tournament, round, date: dateDisplay, dateSort };
}
