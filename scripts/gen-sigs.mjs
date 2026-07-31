// Génère api/icon-sigs.json : signatures couleur v2 des icônes (16x16, coins badges masqués,
// z-norm par canal, quantifiées int8). DOIT rester identique à l'implémentation du site.
import { default as Jimp } from "jimp";
import fs from "node:fs";

export const T = 16;
export const ICON_VAR = { top:0.16, bot:0, side:0.04 };
const cellOK = (x,y)=>!(y > T*0.62 && (x < T*0.40 || x > T*0.58));
export const IDX = [];
for(let y=0;y<T;y++) for(let x=0;x<T;x++) if(cellOK(x,y)) IDX.push(y*T+x);

export function sigOf(getPx){ // getPx(x,y) -> {r,g,b}
  const n = IDX.length, v = new Float32Array(n*3);
  for(let ch=0; ch<3; ch++){
    const key = ["r","g","b"][ch];
    let m=0; for(let i=0;i<n;i++) m += getPx(IDX[i]%T, (IDX[i]/T)|0)[key]; m/=n;
    let s=0; for(let i=0;i<n;i++){ const d=getPx(IDX[i]%T, (IDX[i]/T)|0)[key]-m; s+=d*d; } s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i] = (getPx(IDX[i]%T, (IDX[i]/T)|0)[key]-m)/s;
  }
  return v;
}
export const quant = v => Buffer.from(Array.from(v, x=>Math.max(-127, Math.min(127, Math.round(x*40))) & 0xff)).toString("base64");

export default async function genSigs(){
  const metas = ["api/meta-s37.json","api/meta-s38.json"].filter(fs.existsSync).map(f=>JSON.parse(fs.readFileSync(f)));
  const iconOf = new Map();
  for(const m of metas) for(const mm of m.monsters) if(mm.image_filename) iconOf.set(mm.monster_id, mm.image_filename);
  const sigs = {}, means = {}, hues4 = {};
  const entries = [...iconOf.entries()];
  for(let i=0; i<entries.length; i+=25){
    await Promise.all(entries.slice(i, i+25).map(async ([id, file])=>{
      try{
        const local = "companion/icons/" + file;
        const img = await Jimp.read(fs.existsSync(local) ? local : "https://assets.swarena.gg/monster-pictures/" + file);
        const w = img.bitmap.width, h = img.bitmap.height;
        img.crop(Math.round(w*ICON_VAR.side), Math.round(h*ICON_VAR.top),
                 w-2*Math.round(w*ICON_VAR.side), h-Math.round(h*(ICON_VAR.top+ICON_VAR.bot)))
           .resize(T, T, Jimp.RESIZE_BILINEAR);
        sigs[id] = quant(sigOf((x,y)=>Jimp.intToRGBA(img.getPixelColor(x,y))));
        // teinte moyenne brute (repli du départage des variantes élémentaires)
        let mr=0, mg=0, mb=0, n=0;
        for(const idx of IDX){ const c = Jimp.intToRGBA(img.getPixelColor(idx%T, (idx/T)|0)); mr+=c.r; mg+=c.g; mb+=c.b; n++; }
        means[id] = [Math.round(mr/n), Math.round(mg/n), Math.round(mb/n)];
        // grille chromatique 4x4 (départage SPATIAL des variantes élémentaires : mesuré
        // 93,1% vs 87,3% pour la teinte globale sur les familles — scripts/tune-family.mjs)
        const cells = [];
        for(let gy=0; gy<4; gy++) for(let gx=0; gx<4; gx++){
          let r=0, g=0, b=0, cn=0;
          for(let y=gy*4; y<gy*4+4; y++) for(let x=gx*4; x<gx*4+4; x++){
            if(!cellOK(x,y)) continue;
            const c = Jimp.intToRGBA(img.getPixelColor(x,y)); r+=c.r; g+=c.g; b+=c.b; cn++;
          }
          const t = (r+g+b)||1;
          if(cn) cells.push(Math.round(255*r/t), Math.round(255*g/t), Math.round(255*b/t));
          else cells.push(85, 85, 85);
        }
        hues4[id] = Buffer.from(cells).toString("base64");
      }catch(e){}
    }));
  }
  fs.writeFileSync("api/icon-sigs.json", JSON.stringify({
    generated_at: new Date().toISOString(),
    algo: "colorsig-v2.2", T, icon_var: ICON_VAR, dims: IDX.length*3, scale: 40,
    sigs, means, hues4
  }));
  console.log("icon-sigs.json :", Object.keys(sigs).length, "signatures");
}
if(process.argv[1] && process.argv[1].endsWith("gen-sigs.mjs")) await genSigs();
