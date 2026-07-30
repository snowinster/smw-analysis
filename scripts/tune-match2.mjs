// Recherche AUTO de l'alignement icône↔carte : on cherche le cadrage (commun à toutes les cases)
// qui maximise la netteté des correspondances sur les 5 slots adverses de draft-sample2.png.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 12;
function sigOf(img){
  // normalisation PAR CANAL (robuste assombrissement + teinte du cadre)
  const n = T*T, v = new Float32Array(n*3);
  for(let y=0;y<T;y++) for(let x=0;x<T;x++){
    const c = Jimp.intToRGBA(img.getPixelColor(x,y));
    const k = y*T+x;
    v[k]=c.r; v[n+k]=c.g; v[2*n+k]=c.b;
  }
  for(let ch=0; ch<3; ch++){
    let m=0; for(let i=0;i<n;i++) m+=v[ch*n+i]; m/=n;
    let s=0; for(let i=0;i<n;i++){ const d=v[ch*n+i]-m; s+=d*d; } s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i]=(v[ch*n+i]-m)/s;
  }
  return v;
}
const dist=(a,b)=>{let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}return s/a.length;};

// icônes brutes en mémoire
const metas = ["api/meta-s37.json","api/meta-s38.json"].map(f=>JSON.parse(fs.readFileSync(f)));
const iconOf = new Map();
for(const m of metas) for(const mm of m.monsters) if(mm.image_filename) iconOf.set(mm.monster_id, {name:mm.name, file:mm.image_filename});
const icons = [];
for(const [id,{name,file}] of iconOf){
  const p = "companion/icons/"+file;
  if(fs.existsSync(p)) icons.push({id, name, img: await Jimp.read(p)});
}
console.log("icônes:", icons.length);

const img = await Jimp.read("draft-sample2.png");
const S = 149;
const slots = [
  {label:"B haut-gauche", x:988,  y:215},
  {label:"B haut-droite", x:1160, y:215},
  {label:"B lone",        x:1336, y:298},
  {label:"B bas-gauche",  x:988,  y:381},
  {label:"B bas-droite",  x:1160, y:381},
];
// variantes CROP (carte) : coupe étoiles en haut, badges en bas, cadre sur les côtés
const cropVars = [];
for(const top of [0.16,0.20,0.24,0.28]) for(const bot of [0.06,0.12,0.18]) for(const side of [0.08,0.12,0.16])
  cropVars.push({top,bot,side});
// pré-calcule les signatures des crops
for(const sl of slots){
  sl.sigs = cropVars.map(cv=>{
    const cx=sl.x+Math.round(S*cv.side), cw=S-2*Math.round(S*cv.side);
    const cy=sl.y+Math.round(S*cv.top),  ch=S-Math.round(S*(cv.top+cv.bot));
    return sigOf(img.clone().crop(cx,cy,cw,ch).resize(T,T,Jimp.RESIZE_BILINEAR));
  });
}
// variantes ICÔNE : zoom/cadrage appliqué à l'icône source
const iconVars = [];
for(const top of [0, 0.08, 0.16]) for(const bot of [0, 0.10, 0.20, 0.30]) for(const side of [0, 0.08, 0.15])
  iconVars.push({top,bot,side});

let best = null;
for(const iv of iconVars){
  const db = icons.map(ic=>{
    const w=ic.img.bitmap.width, h=ic.img.bitmap.height;
    const x=Math.round(w*iv.side), cw=w-2*x;
    const y=Math.round(h*iv.top),  ch=h-Math.round(h*(iv.top+iv.bot));
    return {id:ic.id, name:ic.name, v:sigOf(ic.img.clone().crop(x,y,cw,ch).resize(T,T,Jimp.RESIZE_BILINEAR))};
  });
  let total=0; const picks=[];
  for(const sl of slots){
    let bestSlot=null;
    for(const v of sl.sigs){
      let d1=1e9,d2=1e9,id1=null,n1=null;
      for(const e of db){
        const d=dist(v,e.v);
        if(d<d1){d2=d1;d1=d;id1=e.id;n1=e.name;} else if(d<d2)d2=d;
      }
      const sc=(d2-d1)/(d1+1e-6);
      if(!bestSlot||sc>bestSlot.sc) bestSlot={sc,d1,d2,id:id1,name:n1};
    }
    picks.push(bestSlot); total+=bestSlot.sc;
  }
  const distinct = new Set(picks.map(p=>p.id)).size===5;
  if(!best || (total>best.total && distinct) || (distinct&&!best.distinct)) best={iv,total,picks,distinct};
}
console.log("\nMEILLEUR cadrage icône:", JSON.stringify(best.iv), "score total:", best.total.toFixed(2), "5 distincts:", best.distinct);
slots.forEach((sl,i)=>{
  const p=best.picks[i];
  console.log(`  ${sl.label} → ${p.name} (d1=${p.d1.toFixed(3)}, d2=${p.d2.toFixed(3)}, rel=${p.sc.toFixed(2)})`);
});
