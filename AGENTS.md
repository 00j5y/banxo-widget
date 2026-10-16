# Règles du projet

- Communiquer avec Jay en français et le tutoyer.
- Écrire les commentaires de code en français.
- Tous les messages de commit doivent avoir exactement le format `feat: description`, avec la description en français et sans scope, y compris les corrections, la documentation, les tests et les fusions.
- Ne jamais ajouter d’assistant comme coauteur d’un commit.
- Suivre Gitflow : `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`. Voir `docs/gitflow.md`.
- Activer le hook avec `git config core.hooksPath .githooks`. Vérifier les messages avec `node scripts/check-commit-message.mjs --history HEAD`.
- Ne pas créer de Pull Request ni publier de version sans instruction explicite.
- Ne jamais versionner ni afficher les secrets bancaires, les jetons, `.env`, `secrets/` ou les sauvegardes.
- Le serveur est déployé dans Docker sur un VPS. Ne pas ajouter de dépendance Vercel ou Upstash.
- Ne pas prétendre qu’une connexion bancaire ou une installation sur appareil fonctionne sans validation réelle.
