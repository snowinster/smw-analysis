// Construit l'API statique dans /api à partir des données swarena (+ données SWARFARM via swarena).
// Exécuté chaque nuit par GitHub Actions, ou à la main : node scripts/build-api.mjs
import fs from "node:fs/promises";

const API = "https://api.swarena.gg";
const OUT = "api";
const gen = new Date().toISOString();

async function j(path){
  const r = await fetch(API + path);
  if(!r.ok) throw new Error(`HTTP ${r.status} sur ${path}`);
  const x = await r.json();
  return x.error !== undefined ? { data: null } : x;
}
const write = async (name, obj) => {
  await fs.writeFile(`${OUT}/${name}`, JSON.stringify({ generated_at: gen, source: "api.swarena.gg", ...obj }));
  console.log("écrit", name);
};

await fs.mkdir(OUT, { recursive: true });

// ---- éléments de tous les monstres (bestiaire SWARFARM, com2us_id → element) ----
async function buildElements(){
  const map = {};
  let url = "https://swarfarm.com/api/v2/monsters/?limit=500";
  while(url){
    const r = await fetch(url);
    if(!r.ok) throw new Error("SWARFARM HTTP " + r.status);
    const page = await r.json();
    for(const m of page.results) if(m.com2us_id) map[m.com2us_id] = m.element;
    url = page.next;
  }
  return map;
}
const elements = await buildElements();
await write("elements.json", { source: "swarfarm.com", elements });
console.log("éléments SWARFARM :", Object.keys(elements).length, "monstres");

const seasonsR = await j("/general/seasons");
const seasons = (seasonsR.data || []).map(s => s.season).sort((a, b) => b - a);
const latest = seasons[0];
const stats = await j("/general/stats");
console.log("saison courante :", latest);

// ---- méta des monstres (toutes lignes, WR/pick/ban/lead) ----
async function buildMeta(season){
  const rows = [];
  for(let off = 0; off < 2000; off += 500){
    const r = await j(`/monsters?season=${season}&isG3=false&isSL=false&played=0&orderBy=played&orderDirection=DESC&limit=500&offset=${off}`);
    rows.push(...(r.data || []));
    if(!((r.count || 0) > off + 500)) break;
  }
  for(const m of rows) m.element = elements[m.monster_id] || null; // enrichissement SWARFARM
  return rows;
}

/* ---- vraies stats de first pick, VENTILÉES PAR RANG du first picker ----
   Chaque joueur d'un replay porte son rang dans `last_rating_id` : 35xx = Conquérant,
   40xx = Guardian, le dernier chiffre est le sous-rang (4004 = Légende). Vérifié sur
   197 000 lignes de replays S38, le score médian croît bien dans cet ordre.
   On ne garde donc PAS un seul seuil figé : chaque monstre est compté palier par palier et
   c'est l'app qui agrège les paliers >= au rang choisi dans son filtre. En dessous de
   Conquérant 1 il ne reste que des codes résiduels de placement (< 1 %), écartés.
   Deux partis pris de collecte : on balaie le HAUT du ladder (les rangs élevés n'existent
   nulle part ailleurs) et on prend TOUT l'historique de saison de chaque joueur, sans
   plafond par joueur — un plafond bas biaisait l'échantillon vers les gros grinders,
   seuls capables d'enchaîner 50 combats dans la journée. */
const FP_MIN_RATING = 3501; // Conquérant 1
async function buildFirstPicks(season){
  const players = [];
  for(let off = 0; off < 600; off += 100){
    const r = await j(`/players?season=${season}&isSL=false&limit=100&offset=${off}`).catch(() => ({ data: [] }));
    const rows = r.data || [];
    if(!rows.length) break;
    players.push(...rows);
  }
  const results = [];
  for(let i = 0; i < players.length; i += 8){ // par lots : 600 historiques, rythme doux pour l'API
    results.push(...await Promise.all(players.slice(i, i + 8).map(p =>
      j(`/player/${p.wizard_id}/last-battles?season=${season}&limit=500`).catch(() => ({ data: [] })))));
    await new Promise(res => setTimeout(res, 100));
  }
  const seen = new Set(), agg = new Map(), byRank = new Map();
  let kept = 0;
  for(const lb of results) for(const b of (lb.data || [])){
    const k = b.replay_rid_ref;
    if(!k || seen.has(k)) continue;
    seen.add(k);
    if(b.special_league) continue;
    const fp = Object.values(b.user_list || {}).find(u => u.is_first_pick === 1);
    const rank = fp?.last_rating_id || 0;
    if(rank < FP_MIN_RATING) continue; // sous Conquérant 1 : code résiduel, écarté
    const u1 = fp.pick_info?.unit_list?.find(x => x.pick_slot_id === 1);
    if(!u1) continue;
    let by = agg.get(u1.unit_master_id);
    if(!by) agg.set(u1.unit_master_id, by = {});
    const c = by[rank] || (by[rank] = [0, 0]);
    c[0]++; if(fp.win_lose === 1) c[1]++;
    byRank.set(rank, (byRank.get(rank) || 0) + 1);
    kept++;
  }
  return {
    min_rating_id: FP_MIN_RATING,
    rank_buckets: [...byRank].sort((a, b) => a[0] - b[0]).map(([rating_id, openings]) => ({ rating_id, openings })),
    battles_scanned: seen.size,
    openings_kept: kept,
    sample_players: players.length,
    stats: [...agg.entries()]
      .map(([id, by]) => ({ monster_id: id, openings: Object.values(by).reduce((s, c) => s + c[0], 0), by }))
      .sort((a, b) => b.openings - a.openings)
  };
}

// ---- top 100 du ladder ----
async function buildLeaderboard(season){
  const r = await j(`/players?season=${season}&isSL=false&limit=100&offset=0`);
  return r.data || [];
}

const metaBySeason = {};
for(const s of [latest, latest - 1]){
  metaBySeason[s] = await buildMeta(s);
  await write(`meta-s${s}.json`, { season: s, monsters: metaBySeason[s] });
  await write(`firstpicks-s${s}.json`, { season: s, ...(await buildFirstPicks(s)) });
  await write(`leaderboard-s${s}.json`, { season: s, players: await buildLeaderboard(s) });
  // agrégats calculés depuis les REPLAYS bruts : stats solo sous Guardian, duos, trios,
  // oppositions — par palier (tout ladder / Guardian+ / G3). swarena ne publie rien de tout ça.
  try{
    const { writeReplayStats } = await import("./build-replay-stats.mjs");
    const r = await writeReplayStats(s, write);
    console.log(`  replays s${s} : ${r.battles_scanned} scannés, duos ${r.duos.length}, trios ${r.trios.length}, vs ${r.versus.length}`);
  }catch(e){
    console.log(`stats replays s${s} ignorées :`, e.message);
  }
}

// ---- lexique des pseudos du ladder (résolution OCR côté client, sans plafond de recherche) ----
// Endpoint sondé : tri par last_score décroissant, limit plafonné à 500 (1000 → vide),
// profondeur utile ~35k (score 0 ensuite). Noms expédiés BRUTS : le pliage (confusables,
// accents…) est fait côté client, source unique de vérité.
async function buildPlayerNames(season){
  const players = [], seen = new Set();
  const PAGE = 500, MAX = 35000;
  for(let off = 0; off < MAX; off += PAGE){
    let rows = null;
    for(let attempt = 0; attempt < 2 && !rows; attempt++){
      try{
        const r = await j(`/players?season=${season}&isSL=false&limit=${PAGE}&offset=${off}`);
        rows = r.data;
      }catch(e){
        console.log(`  page offset=${off} en échec (${e.message})${attempt ? " — abandonnée, on écrit ce qu'on a" : ", nouvel essai…"}`);
        await new Promise(res => setTimeout(res, 1500));
      }
    }
    if(!rows || !rows.length) break; // fin de pagination ou échec définitif : écriture partielle
    let zeros = 0;
    for(const p of rows){
      if(!p.wizard_name || seen.has(p.wizard_id)) continue;
      seen.add(p.wizard_id);
      players.push({ n: p.wizard_name, i: p.wizard_id });
      if(!p.last_score) zeros++;
    }
    if(zeros > rows.length * 0.8){ console.log(`  scores nuls majoritaires à offset=${off} : fin du ladder utile`); break; }
    await new Promise(res => setTimeout(res, 120)); // rythme doux pour l'API
  }
  return players;
}
try{
  const names = await buildPlayerNames(latest);
  if(names.length) await write("player-names.json", { season: latest, count: names.length, players: names });
  console.log("lexique pseudos :", names.length, "joueurs");
}catch(e){
  console.log("player-names.json ignoré :", e.message);
}

// ---- empreintes visuelles des icônes (dHash 64 bits) pour la reconnaissance dans le navigateur ----
// (le navigateur ne peut pas lire les pixels des icônes swarena : pas de CORS sur assets.swarena.gg)
try{
  const { default: Jimp } = await import("jimp");
  const icons = new Map();
  for(const s of Object.keys(metaBySeason))
    for(const m of metaBySeason[s])
      if(m.image_filename && !icons.has(m.monster_id)) icons.set(m.monster_id, m.image_filename);
  console.log("calcul des empreintes de", icons.size, "icônes…");
  const hashes = {};
  const entries = [...icons.entries()];
  for(let i = 0; i < entries.length; i += 25){
    await Promise.all(entries.slice(i, i + 25).map(async ([id, fname]) => {
      try{
        const img = await Jimp.read("https://assets.swarena.gg/monster-pictures/" + fname);
        const w = img.bitmap.width, h = img.bitmap.height;
        const mx = Math.round(w * 0.12), my = Math.round(h * 0.12);
        img.crop(mx, my, w - 2 * mx, h - 2 * my).resize(9, 8, Jimp.RESIZE_BILINEAR).grayscale();
        const px = (x, y) => img.bitmap.data[(y * 9 + x) * 4];
        let bits = 0n;
        for(let r = 0; r < 8; r++) for(let c = 0; c < 8; c++){
          bits <<= 1n;
          if(px(c + 1, r) > px(c, r)) bits |= 1n;
        }
        hashes[id] = bits.toString(16).padStart(16, "0");
      }catch(e){ /* icône illisible : ignorée */ }
    }));
    if((i + 25) % 200 < 25) console.log(`  ${Math.min(i + 25, entries.length)}/${entries.length}`);
  }
  await write("icon-hashes.json", { algo: "dhash64-center76", count: Object.keys(hashes).length, hashes });
}catch(e){
  console.log("icon-hashes.json ignoré (jimp non installé ?) :", e.message);
}

// ---- signatures couleur v2 (reconnaissance de la capture en direct) ----
try{
  const { default: genSigs } = await import("./gen-sigs.mjs");
  await genSigs();
}catch(e){
  console.log("icon-sigs.json ignoré :", e.message);
}

// index de l'API : saisons archivées = tous les fichiers meta-s*.json présents (jamais supprimés)
const files = await fs.readdir(OUT);
const archived = files.filter(f => /^meta-s\d+\.json$/.test(f)).map(f => +f.match(/\d+/)[0]).sort((a, b) => b - a);
await write("index.json", {
  latest_season: latest,
  archived_seasons: archived,
  global_stats: stats,
  endpoints: {
    "meta": "api/meta-s{season}.json - stats méta de tous les monstres (WR, pick, ban, lead)",
    "firstpicks": "api/firstpicks-s{season}.json - vraies stats de first pick ventilées par rang du first picker (stats[].by = {last_rating_id: [ouvertures, victoires]}, Conquérant 1 et au-dessus)",
    "leaderboard": "api/leaderboard-s{season}.json - top 100 du ladder RTA",
    "meta-sub": "api/meta-sub-s{season}.json - stats de monstres SOUS Guardian (Conquérant et moins), agrégées par nous depuis un échantillon de replays du ladder profond (swarena ne publie que du Guardian+)"
  },
  note: "Données agrégées depuis api.swarena.gg (elles-mêmes issues des replays RTA de Com2uS ; données statiques des monstres via SWARFARM). Mise à jour quotidienne. Les saisons archivées sont conservées même après leur purge chez swarena."
});
console.log("terminé -", archived.length, "saisons archivées");
