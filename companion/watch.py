"""SWAnalysis - compagnon de capture en direct.

Capture l'écran du jeu en continu, reconnaît les monstres pickés dans la draft RTA
(comparaison d'empreintes visuelles avec les ~900 icônes officielles), et expose le
résultat sur http://localhost:8123/picks pour le simulateur web.

Utilisation :
  1. pip install -r requirements.txt
  2. python watch.py --calibrate     (une seule fois : dessine les zones des picks)
  3. python watch.py                 (pendant que tu joues)
  4. Dans le simulateur SWAnalysis, active "Capture en direct".

Calibration : ouvre l'écran de draft du jeu, puis dessine 10 rectangles DANS CET ORDRE
(Entrée après chaque rectangle, Échap pour terminer) :
  1 à 5  : TES slots de pick, dans l'ordre où ils se remplissent
           (slot isolé, puis carré : haut-gauche, bas-gauche, haut-droite, bas-droite)
  6 à 10 : les slots ADVERSES, dans le même ordre.
Cadre bien l'intérieur de chaque case (le portrait), pas la bordure dorée.
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import requests
from mss import mss

BASE = os.path.dirname(os.path.abspath(__file__))
ICONS_DIR = os.path.join(BASE, "icons")
CFG_PATH = os.path.join(BASE, "config.json")
API = "https://snowinster.github.io/swanalysis/api"
ASSETS = "https://assets.swarena.gg/monster-pictures/"

state = {"a": [], "b": [], "ts": 0, "connected": True}
state_lock = threading.Lock()


# ---------- bibliothèque d'icônes ----------
def load_monster_list():
    """Récupère id/nom/icône depuis notre API (2 dernières saisons fusionnées)."""
    idx = requests.get(f"{API}/index.json", timeout=15).json()
    latest = idx["latest_season"]
    mons = {}
    for s in (latest, latest - 1):
        try:
            meta = requests.get(f"{API}/meta-s{s}.json", timeout=20).json()
            for m in meta.get("monsters", []):
                if m.get("image_filename"):
                    mons[m["monster_id"]] = (m["name"], m["image_filename"])
        except Exception as e:
            print(f"  (méta s{s} indisponible : {e})")
    return mons


def download_icons(mons):
    os.makedirs(ICONS_DIR, exist_ok=True)
    todo = [(mid, f) for mid, (_, f) in mons.items()
            if not os.path.exists(os.path.join(ICONS_DIR, f))]
    if todo:
        print(f"Téléchargement de {len(todo)} icônes (première fois uniquement)…")
        s = requests.Session()
        for i, (mid, fname) in enumerate(todo):
            try:
                r = s.get(ASSETS + fname, timeout=15)
                if r.ok:
                    with open(os.path.join(ICONS_DIR, fname), "wb") as f:
                        f.write(r.content)
            except Exception:
                pass
            if (i + 1) % 100 == 0:
                print(f"  {i+1}/{len(todo)}")


def dhash(img):
    """Empreinte visuelle 64 bits (difference hash) sur le centre de l'image."""
    h, w = img.shape[:2]
    # centre 76% : ignore les bordures/cadres d'étoiles qui diffèrent en jeu
    mh, mw = int(h * 0.12), int(w * 0.12)
    img = img[mh:h - mh, mw:w - mw]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (9, 8), interpolation=cv2.INTER_AREA)
    bits = g[:, 1:] > g[:, :-1]
    return int.from_bytes(np.packbits(bits).tobytes(), "big")


def build_hash_db(mons):
    db = []  # (hash, monster_id, name)
    for mid, (name, fname) in mons.items():
        p = os.path.join(ICONS_DIR, fname)
        img = cv2.imread(p)
        if img is None:
            continue
        db.append((dhash(img), mid, name))
    print(f"Base d'empreintes : {len(db)} monstres.")
    return db


def best_match(crop, db):
    """Retourne (monster_id, name, distance) du monstre le plus proche."""
    h = dhash(crop)
    best = (None, None, 99)
    second = 99
    for hh, mid, name in db:
        d = bin(h ^ hh).count("1")
        if d < best[2]:
            second = best[2]
            best = (mid, name, d)
        elif d < second:
            second = d
    # accepté si proche ET nettement meilleur que le 2e candidat
    if best[2] <= 14 and (second - best[2]) >= 3:
        return best
    return (None, None, best[2])


# ---------- capture ----------
def grab(sct, monitor_idx):
    mon = sct.monitors[monitor_idx]
    raw = np.array(sct.grab(mon))
    return cv2.cvtColor(raw, cv2.COLOR_BGRA2BGR)


def calibrate(monitor_idx):
    with mss() as sct:
        img = grab(sct, monitor_idx)
    print("Calibration :" + __doc__.split("Calibration :")[1])
    rois = cv2.selectROIs("SWAnalysis - calibration (Entree apres chaque zone, Echap pour finir)",
                          img, showCrosshair=True)
    cv2.destroyAllWindows()
    if len(rois) != 10:
        print(f"Il faut exactement 10 rectangles - tes 5 slots puis les 5 adverses (reçu : {len(rois)}). Recommence.")
        return
    boxes = [[int(v) for v in r] for r in rois]
    cfg = {"monitor": monitor_idx, "a": boxes[:5], "b": boxes[5:]}
    with open(CFG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"Calibration enregistrée dans {CFG_PATH}.")


def is_empty(crop):
    """Slot vide = zone quasi uniforme (pas encore de pick)."""
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(g.std()) < 9.0


def watch_loop(cfg, db, interval, debug):
    print("Capture en cours - Ctrl+C pour arrêter. Le simulateur peut se connecter.")
    with mss() as sct:
        while True:
            img = grab(sct, cfg["monitor"])
            result = {}
            for side in ("a", "b"):
                ids = []
                for (x, y, w, h) in cfg[side]:
                    crop = img[y:y + h, x:x + w]
                    if crop.size == 0 or is_empty(crop):
                        continue
                    mid, name, dist = best_match(crop, db)
                    if mid and mid not in ids:
                        ids.append(mid)
                        if debug:
                            print(f"  [{side}] {name} (distance {dist})")
                result[side] = ids
            with state_lock:
                if result != {"a": state["a"], "b": state["b"]}:
                    print(f"Picks détectés - toi : {len(result['a'])}, adversaire : {len(result['b'])}")
                state["a"], state["b"] = result["a"], result["b"]
                state["ts"] = time.time()
            time.sleep(interval)


# ---------- serveur local pour le simulateur ----------
class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        # requis par Chrome pour qu'un site https (GitHub Pages) parle à localhost
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/picks"):
            with state_lock:
                self._send(200, dict(state))
        else:
            self._send(200, {"app": "swanalysis-companion", "ok": True})

    def log_message(self, *args):
        pass  # silencieux


def main():
    ap = argparse.ArgumentParser(description="SWAnalysis - compagnon de capture en direct")
    ap.add_argument("--calibrate", action="store_true", help="(re)définir les zones des picks")
    ap.add_argument("--monitor", type=int, default=1, help="écran à capturer (1 = principal)")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--interval", type=float, default=1.0, help="secondes entre deux analyses")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    if args.calibrate:
        calibrate(args.monitor)
        return

    if not os.path.exists(CFG_PATH):
        print("Pas de calibration : lance d'abord  python watch.py --calibrate")
        return
    with open(CFG_PATH) as f:
        cfg = json.load(f)

    mons = load_monster_list()
    print(f"{len(mons)} monstres connus.")
    download_icons(mons)
    db = build_hash_db(mons)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Serveur local : http://localhost:{args.port}/picks")

    try:
        watch_loop(cfg, db, args.interval, args.debug)
    except KeyboardInterrupt:
        print("\nArrêt.")


if __name__ == "__main__":
    main()
