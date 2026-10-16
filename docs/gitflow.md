# Versionnage Gitflow

- `main` : versions publiées et taguées uniquement.
- `develop` : intégration des fonctionnalités testées.
- `feature/<sujet>` : branches issues de `develop`, fusionnées avec `--no-ff` après vérification.
- `release/<version>` : préparation d’une version depuis `develop`, fusion vers `main` et `develop`, tag `v<version>`.
- `hotfix/<sujet>` : correction d’une version publiée depuis `main`, réintégrée dans `develop`.

Tous les commits doivent respecter exactement le format `feat: description`, avec une description en français et sans scope. Cette règle s’applique aussi au code, aux corrections, à la documentation, aux tests et aux commits de fusion.

Exemples : `feat: ajouter les widgets natifs`, `feat: corriger la reprise après une panne Redis`, `feat: documenter le déploiement sur VPS`.

Ne pas utiliser `feat(api):`, `fix:`, `docs:` ni de description en anglais. Ne pas ajouter d’assistant comme coauteur. Ne jamais versionner les secrets. Une fonctionnalité intégrée dans `develop` ne constitue pas une validation bancaire réelle ni une publication App Store.

## Contrôle des messages

Activer le hook local après clonage :

```sh
git config core.hooksPath .githooks
```

Le hook et la CI vérifient le préfixe exact `feat: ` et la présence d’une description. La rédaction en français est obligatoire et doit être vérifiée à la relecture : le contrôle syntaxique ne détecte pas automatiquement la langue.

Pour une fusion Gitflow, donner explicitement le message, par exemple : `git merge --no-ff feature/mon-sujet -m "feat: intégrer les widgets natifs dans develop"`.

## Vérification avant intégration

```sh
npm ci
npm run check
swift test --package-path apple/BanxoCore
docker compose up -d --build --wait
node scripts/smoke.mjs
docker compose exec -T api node --input-type=module < scripts/check-redis.mjs
```

La CI compile aussi les applications et extensions iOS/macOS sans signature. Les tests sur appareils et la signature personnelle se font avec Xcode et le compte Apple de Jay.

Les déploiements VPS, publications et créations de PR sont manuels. Le versionnage sur le dépôt GitHub a été explicitement demandé ; aucune PR n’est ouverte automatiquement.
