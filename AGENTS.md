# Consignes du projet Banxo Widget

## Communication et périmètre

- Communiquer avec Jay en français et le tutoyer. Écrire les commentaires de code en français.
- Ne pas utiliser le caractère U+2014 dans les rédactions.
- Construire deux applications natives SwiftUI et leurs extensions WidgetKit, pour iPhone et Mac. Le serveur privé tourne dans Docker sur un VPS.
- Afficher le solde du compte courant Caisse d'Épargne Normandie, connecté via Enable Banking et l'autorisation bancaire de Jay. Ne jamais collecter son mot de passe bancaire.
- Aucun hébergement Vercel, aucune dépendance Upstash. Docker concerne le serveur ; les applications Apple se compilent sur macOS avec Xcode.
- Ne jamais inventer de solde, de connexion bancaire validée, d'installation sur appareil ni de déploiement VPS réussi.

## Gitflow et commits

- Dépôt distant : `https://github.com/00j5y/banxo-widget`.
- `main` contient les versions publiées ; `develop` sert à intégrer les fonctionnalités vérifiées.
- Créer les branches `feature/<sujet>` depuis `develop`, les branches `release/<version>` depuis `develop`, et les branches `hotfix/<sujet>` depuis `main`.
- Fusionner avec `--no-ff` et donner explicitement un message conforme. Voir `docs/gitflow.md` pour le cycle complet.
- **Tous les commits doivent avoir exactement le format `feat: description`, avec la description en français et sans scope**, y compris les corrections, la documentation, les tests et les fusions.
- Exemples : `feat: ajouter les widgets natifs`, `feat: corriger la reprise du serveur`, `feat: intégrer les widgets dans develop`.
- Ne pas employer `fix:`, `docs:` ou `feat(api):`. Ne jamais ajouter d'assistant comme coauteur.
- Activer le hook après clonage : `git config core.hooksPath .githooks`.
- Vérifier les messages : `node scripts/check-commit-message.mjs --history HEAD`. Le script et la CI contrôlent la syntaxe ; vérifier le français à la relecture.
- Le versionnage et les pushes de ce projet ont été demandés par Jay. Ne pas ouvrir de Pull Request, publier de release, créer de tag de publication ou déployer sur le VPS sans instruction explicite correspondante.
- Ne pas réécrire un historique partagé ni forcer un push sans instruction explicite. Préserver les modifications et références étrangères au travail en cours.

## Worktrees

Le dossier réservé est **`.worktree/`**, au singulier. Il est ignoré par Git. L'ancien `.worktrees/` reste ignoré pour compatibilité. Un worktree est un checkout lié au même dépôt Git, pas une copie à versionner.

- Checkout principal : racine du dépôt, utilisée pour l'intégration dans `develop`.
- Développement natif actuel : `.worktree/native-mvp`, branche `feature/native-mvp`.
- Toujours vérifier `git status --short --branch` et `git worktree list` avant d'éditer, fusionner ou changer de branche.
- Une branche ne peut être ouverte que dans un seul worktree. Ne pas changer la branche du checkout d'un autre intervenant.
- Créer les futurs worktrees depuis la racine, après vérification que `.worktree/` est ignoré et que `develop` est à jour :

```sh
git check-ignore .worktree/
git worktree add .worktree/mon-sujet -b feature/mon-sujet develop
cd .worktree/mon-sujet
npm ci
git config core.hooksPath .githooks
```

- Les références, objets Git et réglages locaux du dépôt sont partagés. Les fichiers de travail, dépendances installées, `.env` et secrets locaux appartiennent à chaque checkout.
- Pour déplacer un checkout, utiliser `git worktree move <ancien-chemin> <nouveau-chemin>` depuis la racine. Arrêter d'abord les conteneurs qui montent ses fichiers, puis les recréer au nouveau chemin.
- Pour supprimer un worktree terminé : vérifier ses modifications, son intégration et ses fichiers ignorés avant `git worktree remove <chemin>`. Ne pas utiliser `--force` pour contourner des données locales à préserver.
- Ne pas copier de secrets vers Git. Ne pas supprimer un volume Redis pour nettoyer un worktree.
- Avec plusieurs intervenants, attribuer des fichiers distincts, communiquer les changements de chemin et ne pas annuler les modifications d'autrui.

## Organisation du code

| Chemin | Responsabilité |
| --- | --- |
| `apple/App/` | Configuration et affichage SwiftUI iPhone/Mac |
| `apple/Widget/` | Extension WidgetKit, petits et moyens formats |
| `apple/Shared/` | Carte de solde et trousseau partagé avec le widget |
| `apple/BanxoCore/` | Contrat JSON, client HTTP, cache, concurrence et tests Swift |
| `apple/project.yml` | Source XcodeGen du projet Xcode versionné |
| `apple/Configuration/` | Entitlements, Info.plist et réglages de signature |
| `server/src/` | API Fastify TypeScript, connexion Enable Banking et stockage Redis |
| `server/test/` | Tests serveur et doubles de test |
| `scripts/` | Configuration locale, vérifications HTTP/Redis et contrôle des commits |
| `Dockerfile`, `compose*.yaml` | Construction et exécution Docker, production avec Caddy |
| `docs/api.md` | Contrat HTTP des clients |
| `docs/deployment.md` | Installation VPS, HTTPS, secrets et sauvegardes |
| `.github/workflows/check.yml` | Vérifications serveur, Docker et compilation Apple |

## Règles fonctionnelles et sécurité

- Le serveur réserve chaque tentative bancaire atomiquement dans Redis avant l'appel : au moins six heures entre tentatives et au maximum quatre sur vingt-quatre heures glissantes. Les échecs comptent aussi.
- Les rafraîchissements des appareils partagent ce quota et le cache serveur. Ne pas ajouter de bouton qui contourne ces limites.
- WidgetKit reçoit une demande de rafraîchissement à trente minutes ; le système décide du moment effectif. Ne pas promettre un affichage en temps réel.
- Les montants sont des chaînes décimales côté serveur et des `Decimal` côté Swift, jamais des nombres flottants pour les calculs monétaires. Une valeur absente affiche `--`, jamais un faux zéro.
- Conserver la date d'origine du dernier solde hors ligne. Après huit heures, signaler les données anciennes. L'expiration du consentement ou la reconnexion requise restent prioritaires.
- Stocker les données bancaires chiffrées côté Redis. Les quotas doivent rester persistants après redémarrage.
- Les écritures liées au compte sont conditionnées à la connexion encore active : une réponse réseau en vol ne doit pas ressusciter une connexion supprimée.
- Chaque appareil a son propre jeton révocable. Il est stocké dans le trousseau partagé Apple ; aucun jeton ne doit apparaître dans les logs ou le cache JSON.
- Conserver le partitionnement du cache par révision de configuration, le verrou interprocessus et l'invalidation des réponses après déconnexion ou changement de configuration.
- HTTPS est obligatoire en production. Le client refuse les redirections avant de transmettre un jeton à une autre requête.
- Protéger l'administration par session, contrôle d'origine et CSRF. Le retour bancaire doit conserver l'état OAuth à usage unique lié au navigateur.
- Les faux transports et réponses bancaires sont réservés aux tests. Ne pas introduire de données bancaires fictives dans l'application réelle.

## Développement et contrôles serveur

Depuis la racine du **worktree actif**, avec Node.js 24+ et Docker Compose :

```sh
npm ci
npm run check
npm audit --omit=dev --audit-level=high
node scripts/init-config.mjs
docker compose up -d --build --wait
node scripts/smoke.mjs
docker compose exec -T api node --input-type=module < scripts/check-redis.mjs
```

`init-config.mjs` crée uniquement les fichiers locaux manquants et refuse d'écraser les secrets existants. Consulter `docs/deployment.md` pour leur configuration. L'administration locale est disponible sur `http://localhost:3000/admin` ; `/health` vérifie le processus et `/ready` la disponibilité de Redis.

Pour vérifier la récupération après redémarrage de Redis :

```sh
docker compose restart redis
node scripts/wait-ready.mjs
node scripts/smoke.mjs
```

- Ne lancer qu'une stack sur le port local 3000. Les commandes Compose doivent partir du checkout dont les fichiers de configuration sont utilisés.
- Le worktree `native-mvp` utilise le projet Compose `native-mvp` et le volume `native-mvp_redis_data`. Le déplacement du dossier conserve ce nom ; recréer les conteneurs pour actualiser les montages.
- Ne pas exécuter `docker compose down --volumes` sur des données à conserver. Une restauration trop ancienne des quotas peut provoquer de nouveaux appels : suivre la procédure de sauvegarde/restauration documentée.

## Développement et contrôles Apple

```sh
swift test --package-path apple/BanxoCore
xcodegen generate --spec apple/project.yml
xcodebuild -project apple/Banxo.xcodeproj -scheme BanxoIOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apple/Banxo.xcodeproj -scheme BanxoMac -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

- Swift 6 est requis ; iOS 17+ et macOS 14+ sont les cibles minimales.
- Les Command Line Tools permettent les tests du cœur ; Xcode complet est nécessaire pour compiler les quatre cibles et installer les apps.
- Après modification de `apple/project.yml`, régénérer et versionner les modifications du projet Xcode et des Info.plist. XcodeGen 2.42+ est requis.
- La configuration locale de signature est `apple/Configuration/Local.xcconfig`, ignorée par Git, créée depuis son exemple. Renseigner l'équipe et un préfixe de Bundle ID unique ; vérifier App Groups et Keychain Sharing pour les apps et extensions.
- Consulter `apple/README.md` pour l'installation et la validation du partage des données sur appareils. Le compte Apple gratuit nécessite de renouveler le provisionnement iPhone tous les sept jours ; les capacités doivent être vérifiées dans Xcode.
- La CI compile sans signature. Cela ne valide ni le provisionnement réel ni le comportement de WidgetKit sur appareil.

## Secrets, mise en production et limites

- Ne jamais versionner ou afficher `.env`, `secrets/`, les clés privées, mots de passe, jetons, réponses bancaires ou sauvegardes. Ne pas les mettre dans un message de commit ou une sortie de diagnostic.
- Utiliser `.env.example` et les exemples de configuration sans données réelles. Préserver les permissions des fichiers locaux.
- Aucun nom de domaine n'a encore été choisi par Jay. Aucun déploiement VPS ni retour HTTPS bancaire réel n'est validé à ce stade.
- L'activation réelle nécessite un domaine HTTPS, la configuration Enable Banking et l'autorisation bancaire de Jay. Ne pas demander de mot de passe ou clé privée dans le chat.
- Laisser la connexion bancaire désactivée tant que la configuration requise manque. Tester le serveur et les contrats sans prétendre avoir connecté le compte réel.
- Avant intégration dans `develop`, vérifier les messages, le diff, les tests concernés et la CI. Signaler séparément les tests réellement exécutés, la compilation sans signature, et les validations externes encore à faire.
