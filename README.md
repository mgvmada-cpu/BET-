# QuantCourt

Dashboard d'analyse quantitative pour paris sportifs (tennis ATP/WTA & tennis de table),
avec moteur analytique Markov, moteur Elo, calcul de valeur (EV) et critère de Kelly.

## Déploiement rapide (sans terminal, depuis GitHub + Vercel)

1. Crée un dépôt GitHub et mets-y tous ces fichiers en respectant exactement l'arborescence
   (voir ci-dessous).
2. Va sur [vercel.com](https://vercel.com), connecte-toi avec GitHub, importe le dépôt.
3. Avant de déployer, ajoute la variable d'environnement `ODDS_API_KEY`
   (obtenue gratuitement sur [the-odds-api.com](https://the-odds-api.com)) dans
   **Project Settings → Environment Variables**.
4. Clique **Deploy**. Vercel détecte automatiquement Vite pour le front et le dossier
   `api/` pour la fonction serverless.

## Arborescence attendue

```
quantcourt/
├── api/
│   └── odds-tennis.js
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   └── sports-betting-dashboard.jsx
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── .env.example
```

## Développement local (si tu as un ordinateur avec Node.js)

```bash
npm install
cp .env.example .env.local   # puis colle ta clé ODDS_API_KEY
npx vercel dev                # pour tester aussi la fonction /api en local
```

`npm run dev` seul lance uniquement le front (Vite) — la route `/api/odds-tennis`
ne répondra pas dans ce mode, seulement avec `vercel dev` ou une fois déployé.
