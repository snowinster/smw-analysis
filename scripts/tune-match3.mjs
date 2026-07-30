// Signature v2 : coupe étoiles/badges, masque les coins bas (badge skill + niveau),
// z-norm par canal, 16x16. Test sur les 5 cases lumineuses de draft-sample2.png.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 16;
// masque : ignore le bas-gauche (badge skill) et le bas-droite (niveau)
const cellOK = (x,y)=>!(y > T*0.62 && (x < T*0.40 || x > T*0.58));
const IDX = [];
for(let y=0;y<T;y++) for(let x=0;x<T;x++) if(cellOK(x,y)) IDX.push(y*T+x);

function sigOf(img){
  const n = IDX.length, v = new Float32Array(n*3);
  const px = new Array(T*T);
  for(let y=0;y<T;y++) for(let x=0;x<T;x++) px[y*T+x] = Jimp.intToRGBA(img.getPixelColor(x,y));
  for(let ch=0; ch<3; ch++){
    const key = ["r","g","b"][ch];
    let m=0; for(let i=0;i<n;i++) m += px[IDX[i]][key]; m/=n;
    let s=0; for(let i=0;i<n;i++){ const d=px[IDX[i]][key]-m; s+=d*d; } s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i] = (px[IDX[i]][key]-m)/s;
  }
  return v;
}
const dist=(a,b)=>{let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}return s/a.length;};
const lumOf=(img)=>{let s=0,n=0;for(let y=0;y<T;y++)for(let x=0;x<T;x++){const c=Jimp.intToRGBA(img.getPixelColor(x,y));s+=0.3*c.r+0.6*c.g+0.1*c.b;n++;}return s/n;};

const metas=["api/meta-s37.json","api/meta-s38.json"].map(f=>JSON.parse(fs.readFileSync(f)));
const iconOf=new Map();
for(const m of metas)for(const mm of m.monsters)if(mm.image_filename)iconOf.set(mm.monster_id,{name:mm.name,file:mm.image_filename});

// cadrage icône candidat (à balayer) et cadrage carte candidat
const iconVars=[];
for(const top of [0.05,0.10,0.16]) for(const bot of [0,0.06,0.12]) for(const side of [0.04,0.08,0.12]) iconVars.push({top,bot,side});
const cropVars=[];
for(const top of [0.18,0.22,0.26]) for(const bot of [0.04,0.08,0.12]) for(const side of [0.08,0.11,0.14]) cropVars.push({top,bot,side});

const img=await Jimp.read("draft-sample2.png");
const S=149;
const slots=[
  {label:"B1 (mâle feu)",      x:988,  y:215},
  {label:"B2 (fille brune)",   x:1160, y:215},
  {label:"B3 (bleu armuré)",   x:1336, y:298},
  {label:"B4 (elfe blonde)",   x:988,  y:381},
  {label:"B5 (fille bleue)",   x:1160, y:381},
];
for(const sl of slots){
  sl.crops = cropVars.map(cv=>{
    const cx=sl.x+Math.round(S*cv.side),cw=S-2*Math.round(S*cv.side);
    const cy=sl.y+Math.round(S*cv.top),ch=S-Math.round(S*(cv.top+cv.bot));
    const c=img.clone().crop(cx,cy,cw,ch).resize(T,T,Jimp.RESIZE_BILINEAR);
    return {v:sigOf(c), lum:lumOf(c)};
  });
}
const icons=[];
for(const [id,{name,file}] of iconOf){
  const p="companion/icons/"+file;
  if(fs.existsSync(p)) icons.push({id,name,img:await Jimp.read(p)});
}
console.log("icônes:",icons.length,"| dims des signatures:",IDX.length*3);

let best=null;
for(const iv of iconVars){
  const db=icons.map(ic=>{
    const w=ic.img.bitmap.width,h=ic.img.bitmap.height;
    const x=Math.round(w*iv.side),cw=w-2*x;
    const y=Math.round(h*iv.top),ch=h-Math.round(h*(iv.top+iv.bot));
    return {id:ic.id,name:ic.name,v:sigOf(ic.img.clone().crop(x,y,cw,ch).resize(T,T,Jimp.RESIZE_BILINEAR))};
  });
  let total=0; const picks=[];
  for(const sl of slots){
    let bs=null;
    for(const cr of sl.crops){
      const scored=db.map(e=>({e,d:dist(cr.v,e.v)})).sort((a,b)=>a.d-b.d);
      // marge vs premier nom DIFFÉRENT (les variantes d'un même monstre ne comptent pas)
      let j=1; while(j<scored.length && scored[j].e.name.split(" (")[0]===scored[0].e.name.split(" (")[0]) j++;
      const rel=(scored[j].d-scored[0].d)/(scored[0].d+1e-6);
      if(!bs||rel>bs.rel) bs={rel,d1:scored[0].d,top:scored.slice(0,4)};
    }
    picks.push(bs); total+=bs.rel;
  }
  if(!best||total>best.total) best={iv,total,picks};
}
console.log("\ncadrage icône retenu:",JSON.stringify(best.iv),"score:",best.total.toFixed(2));
slots.forEach((sl,i)=>{
  const p=best.picks[i];
  console.log(`${sl.label} → ${p.top[0].e.name} (d=${p.d1.toFixed(2)}, rel=${p.rel.toFixed(2)}) | 2e: ${p.top[1].e.name} 3e: ${p.top[2].e.name}`);
});
