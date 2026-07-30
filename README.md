# SWAnalysis

Outil personnel d'analyse RTA pour Summoners War : profils de joueurs, historique de combats, méta des monstres, tendances, comparateur et **simulateur de draft** avec recommandations statistiques (matchups, synergies, first picks, bans).

**Utilisation** : ouvrir `index.html` dans un navigateur — aucune installation, aucune clé. Les données proviennent en direct de l'API publique de [swarena.gg](https://swarena.gg).

## Capture en direct (compagnon Python)

Le simulateur peut lire l'écran du jeu en temps réel pour poser automatiquement les picks des deux joueurs :

```
cd companion
pip install -r requirements.txt
python watch.py --calibrate   # une seule fois : dessine les 4 zones (ton 1er/dernier slot, son 1er/dernier slot)
python watch.py               # pendant que tu joues
```

Puis active le toggle « 🎥 Capture en direct » dans le simulateur. Le compagnon reconnaît les monstres par empreinte visuelle (icônes officielles) et sert le résultat sur `http://localhost:8123/picks`. Il ne fait que lire l'écran : aucune interaction avec le jeu ni ses serveurs.

Projet personnel, non affilié à Swarena ni à Com2uS. Summoners War © Com2uS Corp.
