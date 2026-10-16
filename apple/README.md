# Clients Apple Banxo

Deux apps SwiftUI (iOS 17+, macOS 14+) et deux extensions WidgetKit partagent BanxoCore, la carte de solde et le stockage sécurisé. Le widget appelle directement `GET /api/v1/balance`, y compris lorsque l'app est fermée. Aucun solde de démonstration n'est injecté dans l'application.

## Vérification sans compte Apple ni banque

Depuis la racine du dépôt :

```sh
swift test --package-path apple/BanxoCore
```

Swift 6 est requis. Les tests utilisent Swift Testing et des transports de test seulement. Le manifest charge le plugin Swift Testing des Command Line Tools s'il existe. Avec les CLT Swift 6.4 de cette machine, 17 tests passent ; l'éditeur de liens émet des avertissements sur des répertoires développeur absents. Le code partagé, l'app macOS et le widget macOS passent `swiftc -typecheck -swift-version 6` avec le module BanxoCore compilé. Cela ne remplace pas une compilation des quatre cibles avec Xcode.

## Ouvrir et installer

1. Installer Xcode complet compatible avec Swift 6 et les SDK iOS 17+/macOS 14+. Les Command Line Tools suffisent aux tests du cœur, pas à signer et installer ces apps.
2. Copier `Configuration/Local.xcconfig.example` vers `Configuration/Local.xcconfig`. Renseigner `DEVELOPMENT_TEAM` et un `BANXO_BUNDLE_PREFIX` unique. Ce fichier local est ignoré par Git.
3. Ouvrir `Banxo.xcodeproj`. Pour le régénérer après modification du YAML : `xcodegen generate --spec apple/project.yml` depuis la racine (XcodeGen 2.42+).
4. Dans Signing & Capabilities, vérifier les quatre Bundle IDs et les groupes de partage. L'app et son widget doivent avoir exactement le même App Group et le même groupe de trousseau sur chaque plateforme. Le groupe par défaut est `group.<préfixe>`, le trousseau utilise `$(AppIdentifierPrefix)<préfixe>.shared`. Le groupe doit être enregistré et autorisé dans les profils. Sur Mac, un groupe au format `<TeamID>.<nom>` peut être choisi dans `BANXO_APP_GROUP` selon le provisionnement de l'équipe.
5. Choisir le scheme `BanxoIOS` et l'iPhone, activer son mode développeur si demandé, puis Run. Pour le Mac : scheme `BanxoMac`, My Mac, Run. Ajouter ensuite le widget Banxo depuis la galerie du système.
6. Entrer l'URL HTTPS de base du serveur et le jeton de l'appareil dans Banxo, puis « Enregistrer et actualiser ». Configurer le Mac indépendamment avec son propre jeton serveur. Aucun jeton ni identifiant bancaire n'est inclus dans le projet.

Un Apple ID gratuit permet les essais de base via une Personal Team, dont les profils expirent après **7 jours** et nécessitent une nouvelle compilation/installation. Le tableau Apple des capacités iOS indique App Groups et Keychain Sharing disponibles pour Apple Developer gratuit. Leur provisionnement effectif doit néanmoins être validé dans Xcode pour les quatre cibles ; cette validation sur appareil reste à faire. Voir [compte développeur](https://developer.apple.com/help/account/basics/about-your-developer-account), [capacités iOS](https://developer.apple.com/help/account/reference/supported-capabilities-ios), [App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups) et [partage du trousseau](https://developer.apple.com/documentation/xcode/configuring-keychain-sharing).

## Données et confidentialité

Le jeton et l'URL sont conservés ensemble dans le trousseau partagé, avec `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, sans synchronisation iCloud. Le cache JSON ne contient aucun jeton. Il se trouve dans l'App Group, exclu des sauvegardes, dans un dossier privé 0700 et un fichier 0600 ; sur iOS, protection jusqu'au premier déverrouillage. Les remplacements de fichiers sont atomiques. Chaque configuration enregistrée possède une révision UUID conservée dans le trousseau ; les instantanés occupent un sous-dossier distinct par révision. Un verrou fichier interprocessus coordonne les lectures, écritures et changements/suppressions de configuration. Après une déconnexion, une réponse réseau déjà en cours est rejetée avant toute nouvelle écriture. Sans configuration active dans le trousseau, le widget ne lit aucun cache. Une bascule de serveur ou de jeton efface immédiatement l'ancien solde de l'app et ne peut reprendre le cache d'un autre compte sur erreur réseau.

Le montant est un `Decimal` décodé depuis une chaîne stricte, jamais depuis un `Double`. Une absence est affichée `--`, jamais 0. Le cache est conservé hors ligne avec sa date d'origine. Après huit heures, un état `ready` devient `stale` ; un état de reconnexion reste prioritaire. Un refus 401/403 affiche la reconnexion et conserve le dernier montant. Le bouton de déconnexion masque immédiatement le solde, invalide les requêtes en cours et efface la configuration locale et tous les caches ; il ne révoque pas le consentement bancaire sur le serveur.

Les redirections HTTP sont refusées avant tout nouvel envoi du Bearer, y compris vers le même hôte. Les URL contenant identifiants, query ou fragment sont refusées. HTTPS est obligatoire en Release. Debug autorise explicitement HTTP uniquement sur localhost/127.0.0.1/::1 dans la validation applicative ; les restrictions ATS du système restent actives. Préférer aussi HTTPS pendant le développement sur appareil. Aucun token ni payload bancaire n'est journalisé.

Le widget propose `.systemSmall` et `.systemMedium`, marque le montant `.privacySensitive()` et ouvre `banxo://setup` au toucher. Le système décide de la rédaction/confidentialité effective de l'affichage. La demande de rafraîchissement toutes les 30 minutes n'est pas une garantie : WidgetKit applique ses budgets et ses politiques. Les aperçus sans cache affichent une absence honnête de données.

## Validation restant à faire avec Xcode et appareils

Aucune signature, installation sur iPhone/Mac, exécution d'extension réelle ou connexion bancaire réelle n'a été validée ici. Vérifier les quatre cibles signées, le partage du trousseau et du cache, la requête widget avec l'app fermée, l'affichage hors ligne, le seuil de 8 h, les états de consentement/reconnexion et la suppression locale. La configuration Apple et l'autorisation bancaire sont des étapes externes à la création du code.
