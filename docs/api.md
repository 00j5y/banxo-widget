# Contrat API v1

## Lecture du solde

`GET /api/v1/balance`, avec `Authorization: Bearer <jeton de l'appareil>`. L’adresse serveur configurée dans les apps est l’origine HTTPS, sans `/api`.

Une réponse 200 sans compte connecté est :

```json
{
  "amount": null,
  "currency": "EUR",
  "accountLabel": "Compte courant",
  "balanceKind": null,
  "fetchedAt": null,
  "sourceDate": null,
  "consentExpiresAt": null,
  "status": "not_connected"
}
```

`amount` est une chaîne décimale exacte ou `null`, jamais un flottant JSON. `balanceKind` vaut `booked`, `available` ou `null`. `fetchedAt` est une date ISO 8601 de récupération par le serveur, distincte de la date bancaire `sourceDate`. L’expiration théorique du consentement est `consentExpiresAt`.

États :

| Valeur | Signification |
| --- | --- |
| `ready` | Solde récupéré et récent |
| `stale` | Dernier solde conservé après erreur ou âgé d’au moins huit heures |
| `reconnect_required` | Autorisation expirée, fermée ou révoquée |
| `not_connected` | Pas de connexion bancaire ou compte courant pas encore sélectionné |
| `error` | Échec avant toute récupération exploitable |

Le dernier montant connu peut être présent dans les états `stale` ou `reconnect_required`. Le client conserve son propre cache si le réseau est indisponible, mais affiche alors l’avertissement et l’horodatage d’origine.

Codes HTTP : 401 pour un jeton absent, invalide ou révoqué ; 429 pour une limitation des requêtes HTTP ; 503 pour une indisponibilité serveur/Redis. Les erreurs du prestataire bancaire sont représentées dans le snapshot quand un état exploitable peut être renvoyé.

Les réponses ne doivent pas être mises en cache publiquement. Une lecture peut déclencher une récupération bancaire si le quota le permet ; sinon elle retourne le cache. Le quota global est conservateur : quatre tentatives par 24 heures glissantes, avec six heures entre tentatives, même si le prestataire permet davantage.

## Administration et santé

`/admin` est une interface HTML pour un seul propriétaire. Ses mutations nécessitent une session, une origine identique et le jeton CSRF du formulaire. Les jetons d’appareils ne donnent jamais accès à l’administration.

`/banking/callback` est l’URL de retour à enregistrer dans Enable Banking. L’état temporaire est lié au navigateur administrateur et consommé une seule fois.

`/health` confirme que le processus répond. `/ready` vérifie aussi Redis. Ces endpoints ne révèlent ni clés ni données bancaires.
