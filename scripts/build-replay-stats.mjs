// Agrégats calculés depuis les REPLAYS bruts (swarena ne publie que des stats solo Guardian+) :
//   - meta-sub-s{N}.json   : stats solo SOUS Guardian (compatible avec l'existant)
//   - duos-s{N}.json       : paires jouées ENSEMBLE (synergies), par palier
//   - trios-s{N}.json      : trios joués ensemble, par palier
//   - versus-s{N}.json     : monstre A CONTRE monstre B (matchups), par palier, directionnel
// Deux populations échantillonnées : le HAUT du ladder (600 joueurs, côtés Guardian+ et G3)
// et le ladder PROFOND (700 joueurs entre les rangs 6 000 et 32 000, côtés sous Guardian).
// Chaque ligne porte [n, w] tout ladder + [nt, wt] Guardian+ + [n3, w3] Guardian 3.
// Utilisé par build-api.mjs (nightly) ; seul : node scripts/build-replay-stats.mjs 38 [37…]
import fs from "node:fs/promises";

const API = "https://api.swarena.gg";
const MIN_DUO = 25, MIN_TRIO = 35, MIN_VS = 60; // seuils d'écriture (maîtrise de la taille des fichiers réécrits chaque nuit)

async function j(path){
  const r = await fetch(API + path);
  if(!r.ok) throw new Error(`HTTP ${r.status} sur ${path}`);
  const x = await r.json();
  return x.error !== undefined ? { data: null } : x;
}
async function samplePlayers(season, ranges){
  const out = [];
  for(const [from, to, step, limit] of ranges){
    for(let off = from; off <= to; off += step){
      const r = await j(`/players?season=${season}&isSL=false&limit=${limit}&offset=${off}`).catch(() => ({ data: [] }));
      const rows = (r.data || []).filter(p => p.last_score > 0);
      if(!rows.length) break;
      out.push(...rows);
      await new Promise(res => setTimeout(res, 120));
    }
  }
  return out;
}

export default async function buildReplayStats(season){
  const players = await samplePlayers(season, [
    [0, 500, 100, 100],      // haut du ladder : 600 joueurs (Guardian+ / G3)
    [6000, 32000, 2000, 50]  // ladder profond : 700 joueurs (sous Guardian)
  ]);
  const results = [];
  for(let i = 0; i < players.length; i += 8){
    results.push(...await Promise.all(players.slice(i, i + 8).map(p =>
      j(`/player/${p.wizard_id}/last-battles?season=${season}&limit=500`).catch(() => ({ data: [] })))));
    await new Promise(res => setTimeout(res, 100));
  }
  const seen = new Set();
  const solo = new Map(), byRank = new Map();
  const duos = new Map(), trios = new Map(), versus = new Map();
  const sides = { all: 0, gplus: 0, g3: 0, sub: 0 };
  const upd = (map, key, win, pop) => {
    let e = map.get(key);
    if(!e) map.set(key, e = [0, 0, 0, 0, 0, 0]); // n w nt wt n3 w3
    e[0]++; if(win) e[1]++;
    if(pop !== "sub"){ e[2]++; if(win) e[3]++; }
    if(pop === "g3"){ e[4]++; if(win) e[5]++; }
  };
  for(const lb of results) for(const b of (lb.data || [])){
    const k = b.replay_rid_ref;
    if(!k || seen.has(k)) continue;
    seen.add(k);
    if(b.special_league) continue;
    const users = Object.values(b.user_list || {});
    if(!users.every(u => (u.score || 0) > 0 || (u.rank || 0) > 0)) continue; // combat normal : écarté
    const sidesInfo = users.map(u => {
      const rating = u.last_rating_id || 0;
      if(!rating) return null;
      const picks = (u.pick_info?.unit_list || []).map(x => x.unit_master_id);
      if(picks.length < 5) return null;
      return { u, picks, win: u.win_lose === 1, pop: rating >= 4003 ? "g3" : rating >= 4001 ? "gplus" : "sub" };
    });
    for(let si = 0; si < sidesInfo.length; si++){
      const S = sidesInfo[si];
      if(!S) continue;
      sides.all++; sides[S.pop === "g3" ? "g3" : S.pop]++; if(S.pop === "g3") sides.gplus++;
      // stats solo sous Guardian (compatibilité meta-sub)
      if(S.pop === "sub"){
        const rating = S.u.last_rating_id;
        byRank.set(rating, (byRank.get(rating) || 0) + 1);
        const banned = new Set(S.u.pick_info?.banned_slot_ids || []);
        const leader = S.u.pick_info?.leader_slot_id;
        for(const p of (S.u.pick_info?.unit_list || [])){
          let m = solo.get(p.unit_master_id);
          if(!m) solo.set(p.unit_master_id, m = { picks:0, wins:0, bans:0, leads:0 });
          m.picks++; if(S.win) m.wins++;
          if(banned.has(p.pick_slot_id)) m.bans++;
          if(p.pick_slot_id === leader) m.leads++;
        }
      }
      // duos et trios du côté
      const P = [...new Set(S.picks)].sort((a, b) => a - b);
      for(let a = 0; a < P.length; a++)
        for(let b2 = a + 1; b2 < P.length; b2++){
          upd(duos, P[a] + "|" + P[b2], S.win, S.pop);
          for(let c = b2 + 1; c < P.length; c++)
            upd(trios, P[a] + "|" + P[b2] + "|" + P[c], S.win, S.pop);
        }
      // oppositions : chaque monstre de CE côté contre chaque monstre d'en face (directionnel)
      const O = sidesInfo[1 - si];
      if(O) for(const a of P) for(const b2 of new Set(O.picks)) upd(versus, a + "|" + b2, S.win, S.pop);
    }
  }
  const pack = (map, min) => [...map.entries()]
    .filter(([, e]) => e[0] >= min)
    .map(([key, e]) => [...key.split("|").map(Number), ...e]);
  return {
    battles_scanned: seen.size,
    sample_players: players.length,
    sides,
    metaSub: {
      max_rating_id: 4000, sample_players: players.length, battles_scanned: seen.size, sides: sides.sub,
      rank_buckets: [...byRank].sort((a, b) => a[0] - b[0]).map(([rating_id, n]) => ({ rating_id, sides: n })),
      monsters: [...solo.entries()].map(([id, m]) => ({
        monster_id: id, picks: m.picks, wins: m.wins, bans: m.bans, leads: m.leads,
        win_rate: m.picks ? +(m.wins / m.picks).toFixed(4) : 0,
        pick_rate: sides.sub ? +(m.picks / sides.sub).toFixed(4) : 0,
        ban_rate: m.picks ? +(m.bans / m.picks).toFixed(4) : 0,
        lead_rate: m.picks ? +(m.leads / m.picks).toFixed(4) : 0
      })).sort((a, b) => b.picks - a.picks)
    },
    duos: pack(duos, MIN_DUO),     // [a, b, n, w, nt, wt, n3, w3] — n=tout ladder, t=Guardian+, 3=G3
    trios: pack(trios, MIN_TRIO),  // [a, b, c, n, w, nt, wt, n3, w3]
    versus: pack(versus, MIN_VS)   // [a, contre_b, n, w, nt, wt, n3, w3] — w = victoires du côté de a
  };
}

export async function writeReplayStats(season, write){
  const r = await buildReplayStats(season);
  const head = { season, source: "replays api.swarena.gg, agrégation locale", battles_scanned: r.battles_scanned, sample_players: r.sample_players, sides: r.sides };
  await write(`meta-sub-s${season}.json`, { season, source: head.source, ...r.metaSub });
  await write(`duos-s${season}.json`,   { ...head, format: "[a,b,n,w,nt,wt,n3,w3] — n tout ladder, t Guardian+, 3 G3", rows: r.duos });
  await write(`trios-s${season}.json`,  { ...head, format: "[a,b,c,n,w,nt,wt,n3,w3]", rows: r.trios });
  await write(`versus-s${season}.json`, { ...head, format: "[a,b,n,w,…] : a CONTRE b, w = victoires du côté de a", rows: r.versus });
  return r;
}

if(process.argv[1] && process.argv[1].endsWith("build-replay-stats.mjs")){
  const seasons = process.argv.slice(2).map(Number).filter(Boolean);
  if(!seasons.length){ console.log("usage : node scripts/build-replay-stats.mjs <saison> [saison…]"); process.exit(1); }
  const write = async (name, obj) => {
    await fs.writeFile(`api/${name}`, JSON.stringify({ generated_at: new Date().toISOString(), ...obj }));
    console.log("  écrit api/" + name);
  };
  for(const s of seasons){
    console.log(`saison ${s} : collecte…`);
    const r = await writeReplayStats(s, write);
    console.log(`  ${r.sample_players} joueurs, ${r.battles_scanned} replays — côtés : ${r.sides.all} (G+ ${r.sides.gplus}, G3 ${r.sides.g3}, sous-G ${r.sides.sub}) — duos ${r.duos.length}, trios ${r.trios.length}, vs ${r.versus.length}`);
  }
}
