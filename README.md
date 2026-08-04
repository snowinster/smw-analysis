# SWAnalysis

Outil personnel d'analyse RTA pour Summoners War : profils de joueurs, historique de combats, méta des monstres, tendances, comparateur et **simulateur de draft** avec recommandations statistiques (matchups, synergies, first picks, bans).

**Utilisation** : ouvrir `index.html` dans un navigateur — aucune installation, aucune clé. Les données proviennent en direct de l'API publique de [swarena.gg](https://swarena.gg).

## Capture en direct (dans le navigateur)

Dans le simulateur, active « 🎥 Capture en direct » et partage la fenêtre du jeu : les cases de la draft sont détectées automatiquement à l'écran et les picks reconnus se posent tout seuls (empreintes visuelles des icônes officielles, calculées chaque nuit dans `api/icon-hashes.json`). Un aperçu en bas à droite montre ce que la capture voit ; un mode calibration manuelle (⚙) est disponible en secours. Lecture d'écran uniquement — aucune interaction avec le jeu ni ses serveurs.

Alternative hors navigateur : le compagnon Python `companion/watch.py` fait la même chose en local (voir l'en-tête du fichier).

## Comptes (connexion en haut à droite)

Le bouton « 👤 Connexion » permet de créer un compte (pseudo + mot de passe) et de lui **lier un joueur Summoners War** : ce joueur devient automatiquement le joueur A du simulateur de draft à chaque connexion. Les favoris (« Mes comptes ») restent modifiables librement.

Le site étant 100 % statique (GitHub Pages, aucun serveur), il existe deux modes :

- **Par défaut (aucune configuration)** : les comptes sont stockés **dans le navigateur** (mot de passe haché PBKDF2, jamais en clair). Tout fonctionne, mais un compte créé sur un PC n'existe pas sur un autre, et la connexion Google est inactive.
- **Mode cloud (Google + multi-appareils)** : nécessite un projet **Firebase** gratuit (~5 minutes) :
  1. Aller sur [console.firebase.google.com](https://console.firebase.google.com) → « Ajouter un projet » (nom libre, Analytics inutile).
  2. Dans le projet : **Authentication → Get started → Sign-in method** → activer **E-mail/Mot de passe** et **Google**.
  3. **Authentication → Settings → Authorized domains** → ajouter le domaine GitHub Pages du site (ex. `snowinster.github.io`).
  4. **Firestore Database → Créer une base** (mode production), puis dans **Règles** coller :
     ```
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{uid} {
           allow read, write: if request.auth != null && request.auth.uid == uid;
         }
       }
     }
     ```
  5. **Paramètres du projet → Vos applications → Web (`</>`)** → enregistrer l'app et copier l'objet `firebaseConfig`.
  6. Dans `index.html`, remplacer `const FIREBASE_CONFIG = null;` par `const FIREBASE_CONFIG = { …la config copiée… };` et pousser.

Une fois la config collée, le même bouton propose « Continuer avec Google » et les comptes pseudo + mot de passe deviennent des comptes cloud partagés entre navigateurs.

**Comptes administrateur** : l'infrastructure existe (`auth.user.admin`, helper `isAdmin()`, badge 🛡 dans le menu) mais aucune fonction admin n'est branchée pour l'instant. Pour nommer un admin : ajouter son pseudo (en minuscules) dans la constante `ADMIN_ACCOUNTS` d'`index.html` — ou, en mode Firebase, poser `admin: true` sur son document `users/{uid}` depuis la console Firestore.

Projet personnel, non affilié à Swarena ni à Com2uS. Summoners War © Com2uS Corp.
