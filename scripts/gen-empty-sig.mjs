// Calcule la signature de référence du CRÂNE des cases vides (même pipeline que sigFromCanvas :
// crop → 16x16 → z-norm par canal, coins badges masqués) + stats de séparation vide/portrait.
import { default as Jimp } from "jimp";
const SIG_T = 16;
const SIG_IDX = (()=>{ const a=[]; for(let y=0;y<SIG_T;y++) for(let x=0;x<SIG_T;x++) if(!(y > SIG_T*0.62 && (x < SIG_T*0.40 || x > SIG_T*0.58))) a.push(y*SIG_T+x); return a; })();
const SIG_CROPS = [];
for(const top of [0.18, 0.22, 0.26]) for(const bot of [0.04, 0.08, 0.12]) for(const side of [0.08, 0.11, 0.14]) SIG_CROPS.push({top, bot, side});

const imgs = {};
async function get(src){ return imgs[src] ||= await Jimp.read("c:/Users/julie/Desktop/Smwanalysis/" + src); }

function sigOf(img, b, cv){
  const x = b[0] + b[2]*cv.side, w = b[2]*(1 - 2*cv.side);
  const y = b[1] + b[3]*cv.top,  h = b[3]*(1 - cv.top - cv.bot);
  const c = img.clone().crop(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).resize(SIG_T, SIG_T);
  const d = c.bitmap.data, n = SIG_IDX.length, v = new Float32Array(n*3);
  for(let ch=0; ch<3; ch++){
    let m=0; for(let i=0;i<n;i++) m += d[SIG_IDX[i]*4+ch]; m/=n;
    let s=0; for(let i=0;i<n;i++){ const dd=d[SIG_IDX[i]*4+ch]-m; s+=dd*dd; } s=Math.sqrt(s/n)||1;
    for(let i=0;i<n;i++) v[ch*n+i] = (d[SIG_IDX[i]*4+ch]-m)/s;
  }
  return v;
}
const dist = (a,b)=>{ let s=0; for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; } return s/a.length; };

// cases vides de draft-sample.png : 5 côté A (clair) + 4 côté B (assombri, symétrie) + 1 en surbrillance
const EMPTIES = [
  ["draft-sample.png", [143,166,113,113]], ["draft-sample.png", [274,167,113,112]],
  ["draft-sample.png", [404,228,112,112]], ["draft-sample.png", [143,291,113,113]],
  ["draft-sample.png", [275,291,112,113]],
  ["draft-sample.png", [984,166,113,113]], ["draft-sample.png", [853,167,113,112]],
  ["draft-sample.png", [984,291,113,113]], ["draft-sample.png", [853,291,112,113]],
  ["draft-sample.png", [723,228,112,112]], // surbrillance dorée
];
const PORTRAITS = [
  ["draft-sample2.png", [176,304,138,137]],  // dragon très sombre
  ["draft-sample2.png", [346,215,149,149]], ["draft-sample2.png", [518,215,149,149]],
  ["draft-sample2.png", [346,381,149,149]], ["draft-sample2.png", [525,387,137,137]],
  ["draft-sample2.png", [988,215,149,149]], ["draft-sample2.png", [1160,215,149,149]],
  ["draft-sample2.png", [1336,298,149,149]], ["draft-sample2.png", [988,381,149,149]],
  ["draft-sample2.png", [1160,381,149,149]],
];

// référence = moyenne des sigs des cases vides SOMBRES (droites + gauches), crop médian, puis re-z-norm
const mid = SIG_CROPS[13]; // top .22 bot .08 side .11
let acc = null, cnt = 0;
for(const [src, b] of EMPTIES.slice(0,9)){ // sans la surbrillance (gardée pour le test)
  const v = sigOf(await get(src), b, mid);
  if(!acc) acc = new Float32Array(v.length);
  for(let i=0;i<v.length;i++) acc[i] += v[i];
  cnt++;
}
const n = SIG_IDX.length;
for(let ch=0; ch<3; ch++){
  let m=0; for(let i=0;i<n;i++) m += acc[ch*n+i]/cnt; m/=n;
  let s=0; for(let i=0;i<n;i++){ const dd=acc[ch*n+i]/cnt-m; s+=dd*dd; } s=Math.sqrt(s/n)||1;
  for(let i=0;i<n;i++) acc[ch*n+i] = (acc[ch*n+i]/cnt-m)/s;
}

// distances min-sur-crops (comme au runtime)
async function minDist(src, b){
  const img = await get(src);
  let d = 1e9;
  for(const cv of SIG_CROPS) d = Math.min(d, dist(sigOf(img, b, cv), acc));
  return d;
}
console.log("--- cases VIDES (distance min sur les 27 crops, doit être PETITE) ---");
for(const [src,b] of EMPTIES) console.log(`  ${src} [${b}] : ${(await minDist(src,b)).toFixed(3)}`);
console.log("--- PORTRAITS (doit être GRANDE) ---");
for(const [src,b] of PORTRAITS) console.log(`  ${src} [${b}] : ${(await minDist(src,b)).toFixed(3)}`);

// export base64 int8 (échelle 40, comme icon-sigs)
let bin = "";
for(let i=0;i<acc.length;i++){ let q = Math.round(acc[i]*40); q = Math.max(-127, Math.min(127, q)); bin += String.fromCharCode(q < 0 ? q+256 : q); }
const b64 = Buffer.from(bin, "binary").toString("base64");
console.log("\nEMPTY_SIG length =", acc.length, " base64 (" + b64.length + " chars) :");
console.log(b64);
