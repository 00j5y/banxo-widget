# Banxo Widget

Application personnelle en SwiftUI et WidgetKit pour consulter le solde d'un compte Caisse d'Épargne sur iPhone et Mac, indépendamment. API privée Fastify / Node.js 24 et Redis, conteneurisés pour un VPS avec HTTPS Caddy.

## Démarrage local

```sh
npm ci
node scripts/init-config.mjs
docker compose up -d --build --wait
```

Ouvrir <http://localhost:3000/admin>. Le mot de passe généré reste dans `secrets/admin-password.txt`, hors Git. Sans clés Enable Banking et autorisation bancaire, aucun solde réel n'est disponible et aucune valeur fictive n'est affichée.

Le projet Apple prêt à ouvrir est [apple/Banxo.xcodeproj](apple/Banxo.xcodeproj). Voir le [guide Apple](apple/README.md) pour la configuration de signature et l'installation. Xcode complet est nécessaire ; le compte Apple gratuit implique un renouvellement de l'installation iPhone tous les sept jours.

## Vérifications

```sh
npm run check
swift test --package-path apple/BanxoCore
node scripts/smoke.mjs
docker compose exec -T api node --input-type=module < scripts/check-redis.mjs
```

La CI vérifie le serveur, le conteneur et la compilation non signée des applications. La connexion bancaire réelle, la signature et l'exécution sur appareils doivent être validées séparément.

## Déploiement

Voir le [guide VPS](docs/deployment.md). Le domaine HTTPS n'est pas encore choisi. La production refuse HTTP ; les secrets bancaires restent uniquement sur le serveur. Les widgets utilisent un jeton de lecture révocable par appareil.

## Développement

Le projet suit [Gitflow](docs/gitflow.md) : `main` pour les versions publiées, `develop` pour l'intégration, `feature/*` pour le développement, `release/*` et `hotfix/*` pour les livraisons et corrections.

Tous les commits suivent `feat: description`, avec une description en français, sans scope. Activer le contrôle local avec `git config core.hooksPath .githooks`.

Les identifiants bancaires ne sont jamais demandés par cette application. La connexion passe par Enable Banking et le parcours de la banque.

Voir [le plan de réalisation](docs/plan.md).
