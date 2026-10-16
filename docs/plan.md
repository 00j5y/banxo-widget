# Plan de réalisation

## Choix validés

- Applications et widgets natifs SwiftUI / WidgetKit, iOS 17+ et macOS 14+.
- Mac autonome, indépendant de l'iPhone.
- Installation personnelle Xcode sans abonnement Apple : renouvellement tous les sept jours sur iPhone.
- API TypeScript conteneurisée sur VPS, Redis local persistant, HTTPS via Caddy. Aucun service Vercel.
- Enable Banking en mode personnel restreint, compte Caisse d'Épargne Normandie à confirmer par une connexion réelle.
- Solde en lecture seule, au plus quatre tentatives de consultation sur 24 heures glissantes, espacées de six heures.

## Livraison

1. Initialiser Gitflow et une branche de fonctionnalité isolée.
2. Écrire les tests du contrat, des montants, du cache et de la limitation avant le code métier.
3. Développer l'API, l'administration protégée, la connexion bancaire et les jetons révocables par appareil.
4. Ajouter Docker Compose, Redis et le reverse proxy HTTPS, avec documentation de sauvegarde.
5. Développer le package Swift partagé, les apps conteneurs et les extensions WidgetKit.
6. Vérifier les tests, la compilation disponible et l'absence de secrets ; pousser les branches Gitflow sans créer de PR.

## Validation externe nécessaire

La validation du connecteur Normandie exige un compte Enable Banking, sa clé privée et une authentification faite par Jay. La signature et les tests sur appareils nécessitent Xcode complet et le compte Apple de Jay. Le déploiement réel exige le domaine et l'accès au VPS. Ne pas déclarer ces validations réalisées sans preuve.
