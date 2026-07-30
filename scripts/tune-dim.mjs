// Test : signature par RANGS (robuste à l'assombrissement) sur les cases SOMBRES (côté A)
// et vérification de non-régression sur les cases lumineuses (côté B) de draft-sample2.png.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 16;
const IDX = [];
for(let y=0;y<T;y++) for(let x=0;x<T;x++) if(!(y>T*0.62 && (x<T*0.40 || x>T*0.58))) IDX.push(y*T+x);

function pixels(img){
  const px=[];
  for(let y=0;y<T;y++) for(let x=0;x<T;x++) px.push(Jimp.intToRGBA(img.getPixelColor(x,y)));
  return px;
}
function sigZ(px){ // z-norm par canal (actuelle)
  const n=IDX.length, v=new Float32Array(n*3);
  for(let ch=0;ch<3;ch++){
    const k=["r","g","b"][ch];
    let m=0; for(let i=0;i<n;i++) m+=px[IDX[i]][k]; m/=n;
    let s=0; for(let i=0;i<n;i++){const d=px[IDX[i]][k]-m; s+=d*d;} s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i]=(px[IDX[i]][k]-m)/s;
  }
  return v;
}
function sigR(px){ // rangs par canal (candidate)
  const n=IDX.length, v=new Float32Array(n*3);
  for(let ch=0;ch<3;ch++){
    const k=["r","g","b"][ch];
    const vals=IDX.map((idx,i)=>({i, x:px[idx][k]})).sort((a,b)=>a.x-b.x);
    vals.forEach((e,rank)=>{ v[ch*n+e.i] = rank/(n-1) - 0.5; });
  }
  return v;
}
const dist=(a,b)=>{let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}return s/a.length;};

const metas=["api/meta-s37.json","api/meta-s38.json"].map(f=>JSON.parse(fs.readFileSync(f)));
const iconOf=new Map();
for(const m of metas)for(const mm of m.monsters)if(mm.image_filename)iconOf.set(mm.monster_id,{name:mm.name,file:mm.image_filename});
const IV={top:0.16,bot:0,side:0.04};
const dbZ=[], dbR=[];
for(const [id,{name,file}] of iconOf){
  const p="companion/icons/"+file;
  if(!fs.existsSync(p))continue;
  const img=await Jimp.read(p);
  const w=img.bitmap.width,h=img.bitmap.height;
  img.crop(Math.round(w*IV.side),Math.round(h*IV.top),w-2*Math.round(w*IV.side),h-Math.round(h*(IV.top+IV.bot))).resize(T,T,Jimp.RESIZE_BILINEAR);
  const px=pixels(img);
  dbZ.push({id,name,v:sigZ(px)});
  dbR.push({id,name,v:sigR(px)});
}
const base=n=>(n||"").split(" (")[0];
function match(v,db){
  let d1=1e9,d2=1e9,e1=null;
  for(const e of db){
    const d=dist(v,e.v);
    if(d<d1){ if(!e1||base(e1.name)!==base(e.name)) d2=d1; d1=d; e1=e; }
    else if(d<d2 && base(e.name)!==base(e1.name)) d2=d;
  }
  return {name:e1.name, d1, rel:(d2-d1)/(d1+1e-6)};
}

const img=await Jimp.read("draft-sample2.png");
const S=149;
const CROPS=[];
for(const top of [0.18,0.22,0.26]) for(const bot of [0.04,0.08,0.12]) for(const side of [0.08,0.11,0.14]) CROPS.push({top,bot,side});
const slots=[
  ["A lone (sombre)",170,298],["A hg (sombre)",346,215],["A hd (sombre)",518,215],["A bg (sombre)",346,381],["A bd (sombre)",518,381],
  ["B hg (clair)",988,215],["B hd (clair)",1160,215],["B lone (clair)",1336,298],["B bg (clair)",988,381],["B bd (clair)",1160,381],
];
for(const [label,sx,sy] of slots){
  let bz=null, br=null;
  for(const cv of CROPS){
    const x=sx+S*cv.side,w=S*(1-2*cv.side),y=sy+S*cv.top,h=S*(1-cv.top-cv.bot);
    const c=img.clone().crop(Math.round(x),Math.round(y),Math.round(w),Math.round(h)).resize(T,T,Jimp.RESIZE_BILINEAR);
    const px=pixels(c);
    const mz=match(sigZ(px),dbZ); if(!bz||mz.rel>bz.rel)bz=mz;
    const mr=match(sigR(px),dbR); if(!br||mr.rel>br.rel)br=mr;
  }
  console.log(label.padEnd(16),"| Z:",bz.name.padEnd(18),(100*bz.rel).toFixed(0)+"%","| RANGS:",br.name.padEnd(18),(100*br.rel).toFixed(0)+"%");
}
