# SWAnalysis

Outil personnel d'analyse RTA pour Summoners War : profils de joueurs, historique de combats, méta des monstres, tendances, comparateur et **simulateur de draft** avec recommandations statistiques (matchups, synergies, first picks, bans).

**Utilisation** : ouvrir `index.html` dans un navigateur — aucune installation, aucune clé. Les données proviennent en direct de l'API publique de [swarena.gg](https://swarena.gg).

## Capture en direct (dans le navigateur)

Dans le simulateur, active « 🎥 Capture en direct » et partage la fenêtre du jeu : les cases de la draft sont détectées automatiquement à l'écran et les picks reconnus se posent tout seuls (empreintes visuelles des icônes officielles, calculées chaque nuit dans `api/icon-hashes.json`). Un aperçu en bas à droite montre ce que la capture voit ; un mode calibration manuelle (⚙) est disponible en secours. Lecture d'écran uniquement — aucune interaction avec le jeu ni ses serveurs.

Alternative hors navigateur : le compagnon Python `companion/watch.py` fait la même chose en local (voir l'en-tête du fichier).

Projet personnel, non affilié à Swarena ni à Com2uS. Summoners War © Com2uS Corp.
