// Banc d'essai de reconnaissance : crops réels de draft-sample2.png vs vignettes couleur des icônes.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 12; // vignette T x T
// signature : vecteur RGB centré-réduit (robuste à l'assombrissement/teinte)
function sig(img){
  const v = new Float32Array(T*T*3);
  let k = 0;
  for(let y=0;y<T;y++) for(let x=0;x<T;x++){
    const c = Jimp.intToRGBA(img.getPixelColor(x, y));
    v[k++]=c.r; v[k++]=c.g; v[k++]=c.b;
  }
  let m=0; for(const x of v) m+=x; m/=v.length;
  let s=0; for(const x of v) s+=(x-m)*(x-m); s=Math.sqrt(s/v.length)||1;
  for(let i=0;i<v.length;i++) v[i]=(v[i]-m)/s;
  return v;
}
const dist = (a,b)=>{ let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return s/a.length; };

// ---- base d'icônes : intérieur (coupe 10% de chaque bord) → vignette
console.log("chargement des icônes…");
const metas = ["api/meta-s37.json","api/meta-s38.json"].map(f=>JSON.parse(fs.readFileSync(f)));
const iconOf = new Map();
for(const m of metas) for(const mm of m.monsters) if(mm.image_filename) iconOf.set(mm.monster_id, {name:mm.name, file:mm.image_filename});
const db = [];
for(const [id, {name, file}] of iconOf){
  const p = "companion/icons/" + file;
  if(!fs.existsSync(p)) continue;
  try{
    const ic = await Jimp.read(p);
    const w = ic.bitmap.width, h = ic.bitmap.height;
    const ins = Math.round(w*0.10);
    ic.crop(ins, ins, w-2*ins, h-2*ins).resize(T, T, Jimp.RESIZE_BILINEAR);
    db.push({id, name, v:sig(ic)});
  }catch(e){}
}
console.log("base :", db.length, "icônes");

// ---- crops réels : 5 slots adverses (anneaux 149x149 détectés) ----
const img = await Jimp.read("draft-sample2.png");
const slots = [
  {label:"B 2x2 haut-gauche", x:988, y:215},
  {label:"B 2x2 haut-droite", x:1160, y:215},
  {label:"B lone",            x:1336, y:298},
  {label:"B 2x2 bas-gauche",  x:988, y:381},
  {label:"B 2x2 bas-droite",  x:1160, y:381},
];
const S = 149;

// variantes de cadrage : insets (haut pour bandeau d'étoiles, bas pour badges) + marges latérales
const variants = [];
for(const top of [0.10, 0.16, 0.22, 0.28])
  for(const bot of [0.08, 0.14, 0.20])
    for(const side of [0.08, 0.12, 0.16])
      variants.push({top, bot, side});

for(const sl of slots){
  let best = null;
  for(const va of variants){
    const cx = sl.x + Math.round(S*va.side), cw = S - Math.round(S*va.side*2);
    const cy = sl.y + Math.round(S*va.top),  ch = S - Math.round(S*(va.top+va.bot));
    if(cw<20||ch<20) continue;
    const crop = img.clone().crop(cx, cy, cw, ch).resize(T, T, Jimp.RESIZE_BILINEAR);
    const v = sig(crop);
    const scored = db.map(e=>({e, d:dist(v, e.v)})).sort((a,b)=>a.d-b.d);
    const cand = {va, top1:scored[0], top2:scored[1], top3:scored[2], margin: scored[1].d - scored[0].d};
    if(!best || cand.margin > best.margin) best = cand;
  }
  console.log(`\n${sl.label} → ${best.top1.e.name} (d=${best.top1.d.toFixed(3)}, marge=${best.margin.toFixed(3)}) [insets t=${best.va.top} b=${best.va.bot} s=${best.va.side}]`);
  console.log(`   2e: ${best.top2.e.name} (${best.top2.d.toFixed(3)})  3e: ${best.top3.e.name} (${best.top3.d.toFixed(3)})`);
}
