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
  return rows;
}

// ---- vraies stats de first pick : replays d'un échantillon de joueurs à tous les niveaux ----
async function buildFirstPicks(season){
  const OFFSETS = [0, 500, 1500, 3000, 6000, 10000, 15000, 25000];
  const pages = await Promise.all(OFFSETS.map(o =>
    j(`/players?season=${season}&isSL=false&limit=10&offset=${o}`).catch(() => ({ data: [] }))));
  const players = pages.flatMap(p => p.data || []);
  const results = await Promise.all(players.map(p =>
    j(`/player/${p.wizard_id}/last-battles?season=${season}&limit=50`).catch(() => ({ data: [] }))));
  const seen = new Set(), agg = new Map();
  for(const lb of results) for(const b of (lb.data || [])){
    const k = b.replay_rid_ref;
    if(!k || seen.has(k)) continue;
    seen.add(k);
    if(b.special_league) continue;
    const fp = Object.values(b.user_list || {}).find(u => u.is_first_pick === 1);
    const u1 = fp?.pick_info?.unit_list?.find(x => x.pick_slot_id === 1);
    if(!u1) continue;
    const e = agg.get(u1.unit_master_id) || { n: 0, w: 0 };
    e.n++; if(fp.win_lose === 1) e.w++;
    agg.set(u1.unit_master_id, e);
  }
  return {
    battles_analyzed: seen.size,
    sample_players: players.length,
    stats: [...agg.entries()].map(([id, e]) => ({ monster_id: id, openings: e.n, wins: e.w }))
      .sort((a, b) => b.openings - a.openings)
  };
}

// ---- top 100 du ladder ----
async function buildLeaderboard(season){
  const r = await j(`/players?season=${season}&isSL=false&limit=100&offset=0`);
  return r.data || [];
}

for(const s of [latest, latest - 1]){
  await write(`meta-s${s}.json`, { season: s, monsters: await buildMeta(s) });
  await write(`firstpicks-s${s}.json`, { season: s, ...(await buildFirstPicks(s)) });
  await write(`leaderboard-s${s}.json`, { season: s, players: await buildLeaderboard(s) });
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
    "firstpicks": "api/firstpicks-s{season}.json - vraies stats de first pick calculées sur ~4000 replays",
    "leaderboard": "api/leaderboard-s{season}.json - top 100 du ladder RTA"
  },
  note: "Données agrégées depuis api.swarena.gg (elles-mêmes issues des replays RTA de Com2uS ; données statiques des monstres via SWARFARM). Mise à jour quotidienne. Les saisons archivées sont conservées même après leur purge chez swarena."
});
console.log("terminé -", archived.length, "saisons archivées");
