// Évalue le départage des variantes élémentaires : teinte moyenne globale (algo actuel)
// vs grille chromatique 4x4 (proposition). Simule des crops écran (échelles/assombrissement/décalage)
// pour chaque icône d'une famille multi-variantes et mesure la précision top-1.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const REPO = "c:/Users/julie/Desktop/Smwanalysis";
const T = 16;
const ICON_VAR = { top:0.16, bot:0, side:0.04 };
const cellOK = (x,y)=>!(y > T*0.62 && (x < T*0.40 || x > T*0.58));
const IDX = [];
for(let y=0;y<T;y++) for(let x=0;x<T;x++) if(cellOK(x,y)) IDX.push(y*T+x);

function features(img16){
  const px = new Array(T*T);
  for(let y=0;y<T;y++) for(let x=0;x<T;x++) px[y*T+x] = Jimp.intToRGBA(img16.getPixelColor(x,y));
  const n = IDX.length, v = new Float32Array(n*3);
  let mr=0, mg=0, mb=0;
  for(let ch=0; ch<3; ch++){
    const key = ["r","g","b"][ch];
    let m=0; for(let i=0;i<n;i++) m += px[IDX[i]][key]; m/=n;
    let s=0; for(let i=0;i<n;i++){ const d=px[IDX[i]][key]-m; s+=d*d; } s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i] = (px[IDX[i]][key]-m)/s;
  }
  for(const i of IDX){ mr+=px[i].r; mg+=px[i].g; mb+=px[i].b; }
  const tot = (mr+mg+mb)||1;
  const hue = [mr/tot, mg/tot, mb/tot];
  // grille 4x4 de proportions chromatiques
  const hue4 = [];
  for(let gy=0; gy<4; gy++) for(let gx=0; gx<4; gx++){
    let r=0,g=0,b=0,c=0;
    for(let y=gy*4; y<gy*4+4; y++) for(let x=gx*4; x<gx*4+4; x++){
      if(!cellOK(x,y)) continue;
      const p = px[y*T+x]; r+=p.r; g+=p.g; b+=p.b; c++;
    }
    const t = (r+g+b)||1;
    if(c) hue4.push(r/t, g/t, b/t); else hue4.push(1/3, 1/3, 1/3);
  }
  return {v, hue, hue4};
}
const dist = (a,b)=>{ let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return s/a.length; };
const hdG = (a,b)=> Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
const hd4 = (a,b)=>{ let s=0; for(let i=0;i<a.length;i++) s += Math.abs(a[i]-b[i]); return s/16; };

// ---- base : toutes les icônes, crop ICON_VAR (comme gen-sigs) ----
const meta = JSON.parse(fs.readFileSync(REPO + "/api/meta-s38.json"));
const meta37 = JSON.parse(fs.readFileSync(REPO + "/api/meta-s37.json"));
const mons = new Map();
for(const m of [...meta37.monsters, ...meta.monsters]) if(m.image_filename) mons.set(m.monster_id, m);
const db = [];
for(const m of mons.values()){
  const f = REPO + "/companion/icons/" + m.image_filename;
  if(!fs.existsSync(f)) continue;
  const img = await Jimp.read(f);
  const w = img.bitmap.width, h = img.bitmap.height;
  img.crop(Math.round(w*ICON_VAR.side), Math.round(h*ICON_VAR.top),
           w-2*Math.round(w*ICON_VAR.side), h-Math.round(h*(ICON_VAR.top+ICON_VAR.bot)))
     .resize(T, T, Jimp.RESIZE_BILINEAR);
  db.push({id:m.monster_id, name:m.name, element:m.element, ...features(img)});
}
console.log("base :", db.length, "icônes");
const famOf = new Map();
for(const e of db){ (famOf.get(e.name) || famOf.set(e.name, []).get(e.name)).push(e); }
const families = [...famOf.values()].filter(v=>v.length>1);
console.log("familles multi-variantes dans la base :", families.length);

// ---- match façon camMatchSig, avec départage paramétrable ----
function match(feat, mode){
  let d1 = 1e9, e1 = null;
  for(const e of db){
    const s = dist(feat.v, e.v);
    if(s < d1){ d1 = s; e1 = e; }
  }
  if(!e1) return null;
  const fam = db.filter(e => e !== e1 && e.name === e1.name);
  if(fam.length && mode !== "none"){
    const gate = mode.endsWith("135") ? 1.35 : mode.endsWith("160") ? 1.6 : 1.18;
    const use4 = mode.startsWith("hue4");
    let bestE = e1, bestH = use4 ? hd4(feat.hue4, e1.hue4) : hdG(feat.hue, e1.hue);
    for(const e of fam){
      const d = dist(feat.v, e.v);
      if(d <= d1*gate){
        const h = use4 ? hd4(feat.hue4, e.hue4) : hdG(feat.hue, e.hue);
        if(h < bestH){ bestH = h; bestE = e; }
      }
    }
    e1 = bestE;
  }
  return e1;
}
const MODES = ["none", "hue", "hue4"];

// ---- crops écran simulés : échelle, assombrissement, décalage, marges façon SIG_CROPS ----
const SIG_CROPS = [{top:.22,bot:.08,side:.11},{top:.18,bot:.04,side:.08},{top:.26,bot:.12,side:.14}];
async function screenFeats(file, scale, dim, shift){
  const img = await Jimp.read(REPO + "/companion/icons/" + file);
  img.resize(scale, scale, Jimp.RESIZE_BILINEAR);
  if(dim !== 1) img.color([{apply:"darken", params:[Math.round((1-dim)*100)]}]);
  const out = [];
  for(const cv of SIG_CROPS){
    const x = Math.max(0, Math.round(scale*cv.side) + shift[0]), y = Math.max(0, Math.round(scale*cv.top) + shift[1]);
    const w = Math.min(scale-x, Math.round(scale*(1-2*cv.side))), h = Math.min(scale-y, Math.round(scale*(1-cv.top-cv.bot)));
    out.push(features(img.clone().crop(x, y, w, h).resize(T, T, Jimp.RESIZE_BILINEAR)));
  }
  return out;
}
const PERTS = [];
for(const scale of [96, 52]) for(const dim of [1, 0.72]) for(const shift of [[0,0],[2,1]]) PERTS.push({scale, dim, shift});

const stats = Object.fromEntries(MODES.map(m=>[m,{ok:0,tot:0}]));
const famErr = Object.fromEntries(MODES.map(m=>[m,new Map()]));
for(const fam of families){
  for(const target of fam){
    const file = mons.get(target.id).image_filename;
    for(const p of PERTS){
      const feats = await screenFeats(file, p.scale, p.dim, p.shift);
      for(const mode of MODES){
        // comme au runtime : meilleur crop = celui qui matche le mieux ; ici on valide si UN crop trouve la bonne variante
        let got = null, bd = 1e9;
        for(const ft of feats){
          const e = match(ft, mode);
          const d = e ? dist(ft.v, e.v) : 1e9;
          if(e && d < bd){ bd = d; got = e; }
        }
        stats[mode].tot++;
        if(got && got.id === target.id) stats[mode].ok++;
        else if(mode !== "none" && got && got.name === target.name){
          const k = target.name;
          famErr[mode].set(k, (famErr[mode].get(k)||0) + 1);
        }
      }
    }
  }
}
for(const mode of MODES)
  console.log(`${mode.padEnd(5)} : ${stats[mode].ok}/${stats[mode].tot} corrects (${(100*stats[mode].ok/stats[mode].tot).toFixed(1)}%)`);
console.log("\nconfusions INTRA-famille restantes (bonne famille, mauvais élément) :");
for(const mode of MODES){
  const top = [...famErr[mode].entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`  ${mode} : ${[...famErr[mode].values()].reduce((a,x)=>a+x,0)} au total · ${top.map(([k,v])=>k+"×"+v).join(", ")}`);
}
