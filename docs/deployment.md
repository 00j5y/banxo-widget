# Déploiement sur VPS

## Architecture

Le VPS exécute Docker Compose : API Fastify TypeScript / Node.js 24, Redis 8 persistant, et Caddy 2 pour HTTPS. Les widgets Swift utilisent le même endpoint protégé. Aucun abonnement Vercel, Upstash ni service de cache distant.

L’API reste publiée sur `127.0.0.1:3000`. Redis n’expose aucun port hôte. En production seuls les ports 80 et 443 de Caddy sont publics. Prévoir Docker Engine et Compose v2, et les ports 80/443 disponibles. Si le VPS dispose déjà d’un reverse proxy, utiliser celui-ci vers le port local plutôt que démarrer un second Caddy.

## Essai local sans banque

```sh
npm ci
node scripts/init-config.mjs
docker compose up -d --build --wait
node scripts/smoke.mjs
docker compose exec -T api node --input-type=module < scripts/check-redis.mjs
```

Administration : <http://localhost:3000/admin>. Le mot de passe aléatoire est dans `secrets/admin-password.txt`. Le script d’initialisation n’affiche aucun secret et refuse d’écraser une configuration existante. Ne pas envoyer ce fichier dans une conversation ou un ticket.

Le dossier `secrets/` est privé (0700). Les deux clés montées par Docker ont des fichiers lisibles dans ce dossier pour permettre au processus non-root du conteneur de les lire. Ne pas déplacer ces clés dans un dossier publiquement accessible. `.env`, les clés et les données Redis sont exclus de Git et du contexte de construction de l’image.

Sans configuration Enable Banking, l’API fonctionne et affiche explicitement l’absence de connexion. Aucun solde fictif n’est injecté.

## Passage en production

1. Choisir un domaine ou sous-domaine et pointer ses DNS A/AAAA vers le VPS. Aucun domaine n’est encore configuré pour ce projet.
2. Cloner le dépôt sur le VPS, sélectionner la version à déployer et lancer `node scripts/init-config.mjs` avec Node.js 24 ou plus récent.
3. Dans `.env`, définir `NODE_ENV=production`, `DOMAIN` avec le domaine réel, et `PUBLIC_URL=https://` suivi exactement de ce domaine (sans chemin).
4. Exécuter :

```sh
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up -d --build --wait
```

Caddy obtient le certificat automatiquement. L’API refuse les origines HTTP en production. Pour consulter la santé locale : `curl --fail http://127.0.0.1:3000/ready`.

Le mode local autorise HTTP uniquement pour une origine loopback. Il ne convient pas à un VPS exposé ni à une utilisation distante par l’iPhone. Les clients Swift requièrent HTTPS, sauf localhost en compilation Debug.

## Brancher Enable Banking

1. Créer un compte personnel sur <https://enablebanking.com/sign-in/>.
2. Enregistrer une application en production restreinte. Enregistrer l’URL de retour publique `PUBLIC_URL` suivie de `/banking/callback`.
3. Activer l’application en rattachant explicitement le compte personnel Caisse d’Épargne Normandie dans la console Enable Banking. Cette étape d’activation ne remplace pas l’autorisation effectuée ensuite depuis notre administration.
4. Placer la clé privée exportée dans `secrets/enable-banking.pem`, sans la committer. Renseigner `ENABLE_BANKING_APP_ID` dans `.env`, puis recréer l’API avec la commande Compose de production ci-dessus.
5. Ouvrir `/admin` en HTTPS, choisir la caisse et suivre le parcours de consentement. L’identification et Sécur’Pass sont effectués par le propriétaire du compte.
6. Sélectionner le compte courant en EUR. Si aucun compte n’apparaît, vérifier le rattachement du compte à l’application restreinte et la disponibilité du connecteur ; ne pas substituer des données de démonstration.
7. Comparer la nature et le montant du solde avec Banxo. La compatibilité du vrai compte Normandie n’a pas encore été validée.
8. Créer un jeton par appareil depuis l’administration, puis le saisir dans l’application Swift. Un nouveau jeton remplace l’ancien pour cet appareil. Il ne permet pas d’administrer ni d’effectuer un virement.

## Exploitation

- Le cache et les sessions sont chiffrés AES-256-GCM ; conserver la clé `encryption.key`, nécessaire à toute restauration.
- Quatre tentatives bancaires au maximum sur 24 heures glissantes, espacées de six heures, y compris les échecs. Les consultations des widgets relisent le cache sans multiplier les appels bancaires.
- Redis utilise AOF avec synchronisation chaque seconde et refuse les nouvelles écritures plutôt que d’évincer les sessions ou les quotas.
- `/health` vérifie le processus ; `/ready` vérifie aussi Redis. Les contrôles Docker utilisent `/ready`.
- `docker compose logs --tail=50 api` montre uniquement les messages opérationnels, sans URL de retour ni contenu bancaire. Le journal d’accès Caddy est désactivé.
- En cas d’autorisation expirée ou révoquée, reconnecter depuis `/admin`. La banque peut demander une nouvelle authentification avant la date d’expiration théorique.
- La déconnexion bancaire révoque la session côté prestataire avant d’effacer les données du serveur. En cas de panne du prestataire, l’opération signale un échec ; la révocation peut aussi se faire depuis l’espace de consentement Enable Banking.

## Sauvegarde et mise à jour

Sauvegarder le volume Redis, `.env` et `secrets/` ensemble dans un emplacement chiffré et privé. Un export Redis sans clé de chiffrement ne permet pas de récupérer les données.

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb backups/redis.rdb
```

Pour restaurer, arrêter les services, restaurer le volume et les mêmes secrets, puis redémarrer. Une restauration ancienne peut perdre des réservations de quota récentes : attendre 24 heures avant de réactiver les appels bancaires.

Pour mettre à jour, récupérer une version Git validée et exécuter `docker compose -f compose.yaml -f compose.production.yaml up -d --build --wait`. Ne pas supprimer les volumes. Conserver la version précédente et les sauvegardes pour revenir en arrière.
