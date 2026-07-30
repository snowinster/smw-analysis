// Validation offline du matcher runtime (mêmes crops, mêmes seuils) sur les 5 cases lumineuses.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 16;
const IDX = [];
for(let y=0;y<T;y++) for(let x=0;x<T;x++) if(!(y>T*0.62 && (x<T*0.40 || x>T*0.58))) IDX.push(y*T+x);
const j = JSON.parse(fs.readFileSync("api/icon-sigs.json"));
const names = {};
for(const f of ["api/meta-s37.json","api/meta-s38.json"])
  for(const m of JSON.parse(fs.readFileSync(f)).monsters) names[m.monster_id] = m.name;
const db = Object.entries(j.sigs).map(([id,b64])=>{
  const bin = Buffer.from(b64, "base64"), v = new Float32Array(bin.length);
  for(let i=0;i<bin.length;i++){ let x = bin[i]; if(x>127) x -= 256; v[i] = x/j.scale; }
  return {id:+id, name:names[id]||String(id), v};
});
const base = n => (n||"").split(" (")[0];
const img = await Jimp.read("draft-sample2.png");
const S = 149;
const slots = [[988,215],[1160,215],[1336,298],[988,381],[1160,381]];
const CROPS = [];
for(const top of [0.18,0.22,0.26]) for(const bot of [0.04,0.08,0.12]) for(const side of [0.08,0.11,0.14]) CROPS.push({top,bot,side});
for(const [sx,sy] of slots){
  let bestAll = null;
  for(const cv of CROPS){
    const x = sx+S*cv.side, w = S*(1-2*cv.side), y = sy+S*cv.top, h = S*(1-cv.top-cv.bot);
    const c = img.clone().crop(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).resize(T,T,Jimp.RESIZE_BILINEAR);
    const px = [];
    for(let yy=0;yy<T;yy++) for(let xx=0;xx<T;xx++) px.push(Jimp.intToRGBA(c.getPixelColor(xx,yy)));
    const n = IDX.length, v = new Float32Array(n*3);
    for(let ch=0; ch<3; ch++){
      const k = ["r","g","b"][ch];
      let m=0; for(let i=0;i<n;i++) m += px[IDX[i]][k]; m/=n;
      let s2=0; for(let i=0;i<n;i++){ const d=px[IDX[i]][k]-m; s2+=d*d; } s2=Math.sqrt(s2/n)||1;
      for(let i=0;i<n;i++) v[ch*n+i]=(px[IDX[i]][k]-m)/s2;
    }
    let d1=1e9, d2=1e9, e1=null;
    for(const e of db){
      let s3=0; for(let i=0;i<v.length;i++){ const dd=v[i]-e.v[i]; s3+=dd*dd; } s3/=v.length;
      if(s3<d1){ if(!e1 || base(e1.name)!==base(e.name)) d2=d1; d1=s3; e1=e; }
      else if(s3<d2 && base(e.name)!==base(e1.name)) d2=s3;
    }
    const rel=(d2-d1)/(d1+1e-6);
    if(!bestAll || rel>bestAll.rel) bestAll={name:e1.name, d1, rel};
  }
  const ok = bestAll.d1<=1.0 && bestAll.rel>=0.25;
  console.log((ok?"ACCEPTÉ ":"rejeté  "), bestAll.name, "d="+bestAll.d1.toFixed(2), "marge="+Math.round(bestAll.rel*100)+"%");
}
