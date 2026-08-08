// api/odds-tennis.js — Fonction serverless Vercel (Node.js)
//
// Récupère les cotes tennis en direct depuis The Odds API (the-odds-api.com)
// et les renvoie normalisées dans le format attendu par le dashboard QuantCourt.
//
// SÉCURITÉ : la clé API ne doit JAMAIS être exposée au navigateur. Elle est lue ici
// côté serveur depuis la variable d'environnement ODDS_API_KEY (à définir dans les
// réglages du projet Vercel, jamais commitée dans le code).
//
// Coût en crédits : chaque tournoi actif interrogé consomme 1 crédit par appel.
// Le plan gratuit de The Odds API offre 500 crédits/mois — évite de rafraîchir
// plus souvent que toutes les 3-5 minutes en développement.

export default async function handler(req, res) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ODDS_API_KEY manquante côté serveur" });
  }

  try {
    // 1. Découvrir les tournois de tennis actuellement actifs (le sport key est
    //    spécifique à chaque tournoi, ex: tennis_atp_us_open, tennis_wta_wuhan)
    const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`);
    if (!sportsRes.ok) {
      throw new Error(`Échec /sports (${sportsRes.status})`);
    }
    const sports = await sportsRes.json();
    const tennisKeys = sports
      .filter((s) => s.key.startsWith("tennis_") && s.active)
      .map((s) => s.key);

    if (tennisKeys.length === 0) {
      res.status(200).json([]);
      return;
    }

    // 2. Récupérer les cotes h2h (vainqueur du match) pour chaque tournoi actif
    const results = await Promise.all(
      tennisKeys.map(async (key) => {
        const url = `https://api.the-odds-api.com/v4/sports/${key}/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const data = await r.json();
        return data.map((ev) => normalize(ev, key));
      })
    );

    // Cache léger côté CDN Vercel pour économiser les crédits sur les rafraîchissements rapprochés
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(results.flat());
  } catch (err) {
    res.status(502).json({ error: "Échec de récupération des cotes", detail: String(err.message || err) });
  }
}

function normalize(ev, sportKey) {
  const book = ev.bookmakers && ev.bookmakers[0];
  const market = book && book.markets && book.markets.find((m) => m.key === "h2h");
  const outcomes = (market && market.outcomes) || [];
  const oddsA = outcomes.find((o) => o.name === ev.home_team);
  const oddsB = outcomes.find((o) => o.name === ev.away_team);

  return {
    id: ev.id,
    sport: "tennis",
    tour: sportKey.includes("wta") ? "WTA" : "ATP",
    tournament: ev.sport_title || sportKey.replace(/_/g, " "),
    playerA: ev.home_team,
    playerB: ev.away_team,
    startTimeUTC: ev.commence_time,
    // The Odds API ne fournit pas la surface — à enrichir manuellement ou via une
    // seconde source (ex: RapidAPI Tennis Live Data) si tu veux l'ajustement automatique.
    surface: null,
    oddsA: oddsA ? oddsA.price : null,
    oddsB: oddsB ? oddsB.price : null,
    status: new Date(ev.commence_time) < new Date() ? "live" : "upcoming",
  };
}
