// Planche : pour chaque case, [crop réel | top1 | top2 | top3] avec le cadrage actuel.
import { default as Jimp } from "jimp";
import fs from "node:fs";

const T = 12;
function sigOf(img){
  const n=T*T, v=new Float32Array(n*3);
  for(let y=0;y<T;y++)for(let x=0;x<T;x++){
    const c=Jimp.intToRGBA(img.getPixelColor(x,y)); const k=y*T+x;
    v[k]=c.r; v[n+k]=c.g; v[2*n+k]=c.b;
  }
  for(let ch=0;ch<3;ch++){
    let m=0;for(let i=0;i<n;i++)m+=v[ch*n+i];m/=n;
    let s=0;for(let i=0;i<n;i++){const d=v[ch*n+i]-m;s+=d*d;}s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++)v[ch*n+i]=(v[ch*n+i]-m)/s;
  }
  return v;
}
const dist=(a,b)=>{let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}return s/a.length;};

const metas=["api/meta-s37.json","api/meta-s38.json"].map(f=>JSON.parse(fs.readFileSync(f)));
const iconOf=new Map();
for(const m of metas)for(const mm of m.monsters)if(mm.image_filename)iconOf.set(mm.monster_id,{name:mm.name,file:mm.image_filename});
const IV={top:0.16,bot:0,side:0.08};
const db=[];
for(const [id,{name,file}] of iconOf){
  const p="companion/icons/"+file;
  if(!fs.existsSync(p))continue;
  const raw=await Jimp.read(p);
  const w=raw.bitmap.width,h=raw.bitmap.height;
  const proc=raw.clone().crop(Math.round(w*IV.side),Math.round(h*IV.top),w-2*Math.round(w*IV.side),h-Math.round(h*(IV.top+IV.bot)));
  db.push({id,name,raw,v:sigOf(proc.clone().resize(T,T,Jimp.RESIZE_BILINEAR))});
}
const img=await Jimp.read("draft-sample2.png");
const S=149,W=1653;
const right=[[988,215],[1160,215],[1336,298],[988,381],[1160,381]];
const slots=[
  ...right.map(([x,y],i)=>({label:"B"+(i+1),x,y})),
  ...right.map(([x,y],i)=>({label:"A"+(i+1),x:W-x-S,y}))
];
const cropVars=[];
for(const top of [0.16,0.20,0.24,0.28])for(const bot of [0.06,0.12,0.18])for(const side of [0.08,0.12,0.16])cropVars.push({top,bot,side});

const CELL=100, sheet=await new Jimp(CELL*5+40, CELL*slots.length+10, 0x101820ff);
let names=[];
for(let si=0;si<slots.length;si++){
  const sl=slots[si];
  let best=null;
  for(const cv of cropVars){
    const cx=sl.x+Math.round(S*cv.side),cw=S-2*Math.round(S*cv.side);
    const cy=sl.y+Math.round(S*cv.top),ch=S-Math.round(S*(cv.top+cv.bot));
    const crop=img.clone().crop(cx,cy,cw,ch);
    const v=sigOf(crop.clone().resize(T,T,Jimp.RESIZE_BILINEAR));
    const scored=db.map(e=>({e,d:dist(v,e.v)})).sort((a,b)=>a.d-b.d);
    const sc=(scored[1].d-scored[0].d)/(scored[0].d+1e-6);
    if(!best||sc>best.sc)best={sc,crop,scored};
  }
  const row=si*CELL+5;
  sheet.composite(img.clone().crop(sl.x,sl.y,S,S).resize(CELL-4,CELL-4), 2, row);           // case brute
  sheet.composite(best.crop.clone().resize(CELL-4,CELL-4), CELL+2, row);                     // crop utilisé
  for(let k=0;k<3;k++) sheet.composite(best.scored[k].e.raw.clone().resize(CELL-4,CELL-4), CELL*(2+k)+2, row);
  names.push(`${sl.label}: ${best.scored.slice(0,3).map(s=>`${s.e.name}(${s.d.toFixed(2)})`).join(" | ")} rel=${best.sc.toFixed(2)}`);
}
await sheet.writeAsync("contact-sheet.png");
console.log(names.join("\n"));
console.log("→ contact-sheet.png (colonnes : case | crop | top1 | top2 | top3)");
