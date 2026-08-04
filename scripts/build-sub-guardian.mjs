// Stats de monstres SOUS Guardian (Conquérant et en dessous) — swarena ne publie que du
// Guardian+, on les calcule donc NOUS-MÊMES depuis les replays bruts : chaque joueur d'un
// replay porte son last_rating_id (1xxx Challenger, 2xxx Fighter, 3xxx Conquérant, 4xxx
// Guardian), on ne compte que les ÉQUIPES dont le joueur est sous Guardian.
// Échantillon : ~650 joueurs répartis entre les rangs 6 000 et 32 000 du ladder (la zone
// sous Guardian), tout leur historique de saison, replays dédupliqués, combats classés
// uniquement (un joueur à score 0 = combat normal, écarté).
// Utilisé par build-api.mjs (nightly) ; exécutable seul : node scripts/build-sub-guardian.mjs 38
import fs from "node:fs/promises";

const API = "https://api.swarena.gg";
const SUB_MAX_RATING = 4000; // tout ce qui est strictement sous Guardian 1

async function j(path){
  const r = await fetch(API + path);
  if(!r.ok) throw new Error(`HTTP ${r.status} sur ${path}`);
  const x = await r.json();
  return x.error !== undefined ? { data: null } : x;
}

export default async function buildSubGuardian(season){
  // 1) échantillon stratifié du ladder profond
  const players = [];
  for(let off = 6000; off <= 32000; off += 2000){
    const r = await j(`/players?season=${season}&isSL=false&limit=50&offset=${off}`).catch(() => ({ data: [] }));
    const rows = (r.data || []).filter(p => p.last_score > 0);
    if(!rows.length) break; // fin du ladder utile
    players.push(...rows);
    await new Promise(res => setTimeout(res, 120));
  }
  // 2) tout leur historique de saison, par lots doux
  const results = [];
  for(let i = 0; i < players.length; i += 8){
    results.push(...await Promise.all(players.slice(i, i + 8).map(p =>
      j(`/player/${p.wizard_id}/last-battles?season=${season}&limit=500`).catch(() => ({ data: [] })))));
    await new Promise(res => setTimeout(res, 100));
  }
  // 3) agrégation par monstre, côté par côté (un combat vs un Guardian ne compte que le côté sous Guardian)
  const seen = new Set(), agg = new Map(), byRank = new Map();
  let sides = 0;
  for(const lb of results) for(const b of (lb.data || [])){
    const k = b.replay_rid_ref;
    if(!k || seen.has(k)) continue;
    seen.add(k);
    if(b.special_league) continue;
    const users = Object.values(b.user_list || {});
    if(!users.every(u => (u.score || 0) > 0 || (u.rank || 0) > 0)) continue; // combat normal : écarté
    for(const u of users){
      const rating = u.last_rating_id || 0;
      if(!rating || rating >= SUB_MAX_RATING) continue;
      const picks = u.pick_info?.unit_list || [];
      if(!picks.length) continue;
      const banned = new Set(u.pick_info?.banned_slot_ids || []);
      const leader = u.pick_info?.leader_slot_id;
      sides++;
      byRank.set(rating, (byRank.get(rating) || 0) + 1);
      for(const p of picks){
        let m = agg.get(p.unit_master_id);
        if(!m) agg.set(p.unit_master_id, m = { picks:0, wins:0, bans:0, leads:0 });
        m.picks++;
        if(u.win_lose === 1) m.wins++;
        if(banned.has(p.pick_slot_id)) m.bans++;
        if(p.pick_slot_id === leader) m.leads++;
      }
    }
  }
  return {
    max_rating_id: SUB_MAX_RATING,
    sample_players: players.length,
    battles_scanned: seen.size,
    sides, // nombre d'équipes sous Guardian comptées (dénominateur du pick rate)
    rank_buckets: [...byRank].sort((a, b) => a[0] - b[0]).map(([rating_id, n]) => ({ rating_id, sides: n })),
    monsters: [...agg.entries()].map(([id, m]) => ({
      monster_id: id, picks: m.picks, wins: m.wins, bans: m.bans, leads: m.leads,
      win_rate: m.picks ? +(m.wins / m.picks).toFixed(4) : 0,
      pick_rate: sides ? +(m.picks / sides).toFixed(4) : 0,
      ban_rate: m.picks ? +(m.bans / m.picks).toFixed(4) : 0,
      lead_rate: m.picks ? +(m.leads / m.picks).toFixed(4) : 0
    })).sort((a, b) => b.picks - a.picks)
  };
}

if(process.argv[1] && process.argv[1].endsWith("build-sub-guardian.mjs")){
  const seasons = process.argv.slice(2).map(Number).filter(Boolean);
  if(!seasons.length){ console.log("usage : node scripts/build-sub-guardian.mjs <saison> [saison…]"); process.exit(1); }
  for(const s of seasons){
    console.log(`saison ${s} : collecte…`);
    const out = await buildSubGuardian(s);
    await fs.writeFile(`api/meta-sub-s${s}.json`, JSON.stringify({ generated_at: new Date().toISOString(), source: "replays api.swarena.gg, agrégation locale", season: s, ...out }));
    console.log(`  écrit api/meta-sub-s${s}.json — ${out.sample_players} joueurs, ${out.battles_scanned} replays, ${out.sides} équipes sous Guardian, ${out.monsters.length} monstres`);
  }
}
