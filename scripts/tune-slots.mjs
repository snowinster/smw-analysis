// Réplique le pipeline d'ACQUISITION des 10 cases du site (machine à états ACTIVE) sur une capture :
// porte de page → cases vides + portraits + surbrillance → complétion miroir/carré → 10 cases.
// Usage : node tune-slots.mjs [capture.png]   (produit une image annotée slots-<capture>.png)
import { default as Jimp } from "jimp";
import path from "path";

const SRC = process.argv[2] || "../draft-sample.png";
const img = await Jimp.read(SRC);
const W = img.bitmap.width, H = img.bitmap.height, d = img.bitmap.data;

function maskComponents(mask){
  const seen = new Uint8Array(W*H), comps = [];
  const qx = new Int32Array(W*H), qy = new Int32Array(W*H);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const idx = y*W+x;
    if(!mask[idx] || seen[idx]) continue;
    let head=0, tail=0; qx[tail]=x; qy[tail]=y; tail++; seen[idx]=1;
    let mnx=x, mxx=x, mny=y, mxy=y, cnt=0;
    while(head<tail){
      const cx=qx[head], cy=qy[head]; head++; cnt++;
      if(cx<mnx)mnx=cx; if(cx>mxx)mxx=cx; if(cy<mny)mny=cy; if(cy>mxy)mxy=cy;
      if(cx+1<W){const n=cy*W+cx+1; if(mask[n]&&!seen[n]){seen[n]=1;qx[tail]=cx+1;qy[tail]=cy;tail++;}}
      if(cx>0){const n=cy*W+cx-1; if(mask[n]&&!seen[n]){seen[n]=1;qx[tail]=cx-1;qy[tail]=cy;tail++;}}
      if(cy+1<H){const n=(cy+1)*W+cx; if(mask[n]&&!seen[n]){seen[n]=1;qx[tail]=cx;qy[tail]=cy+1;tail++;}}
      if(cy>0){const n=(cy-1)*W+cx; if(mask[n]&&!seen[n]){seen[n]=1;qx[tail]=cx;qy[tail]=cy-1;tail++;}}
    }
    comps.push({x:mnx, y:mny, w:mxx-mnx+1, h:mxy-mny+1, cnt});
  }
  return comps;
}

// ---- porte de page + centre du plateau (copie de onDraftScreen) ----
let midX = W/2;
function onDraftScreen(){
  let gold = 0, n = 0, sx = 0;
  for(let y = Math.floor(H*0.15); y < H*0.55; y += 2) for(let x = Math.floor(W*0.42); x < W*0.58; x += 2){
    const i = (y*W+x)*4, R = d[i], G = d[i+1], B = d[i+2];
    if(R>110 && G>75 && B<110 && R>G && G>B && (R-B)>40){ gold++; sx += x; }
    n++;
  }
  if(gold/n < 0.008) return false;
  let stripFound = false;
  for(let y = Math.floor(H*0.45); y < H*0.72 && !stripFound; y += 3){
    let lum = 0, m2 = 0;
    for(let x = Math.floor(W*0.12); x < W*0.88; x += 9){
      const i = (y*W+x)*4;
      lum += 0.3*d[i] + 0.6*d[i+1] + 0.1*d[i+2]; m2++;
    }
    if(lum/m2 < 38) stripFound = true;
  }
  if(!stripFound) return false;
  midX = sx/gold;
  let lum = 0, m = 0;
  for(let y = Math.floor(H*0.2); y < H*0.5; y += 5) for(let x = Math.floor(W*0.15); x < W*0.35; x += 5){
    const i = (y*W+x)*4;
    lum += 0.3*d[i] + 0.6*d[i+1] + 0.1*d[i+2]; m++;
  }
  return lum/m < 110;
}

// ---- copies des détecteurs du site (garder en phase avec index.html) ----
function detectEmptySlots(){
  const yMin = Math.floor(H*0.12), yMax = Math.floor(H*0.60);
  const xMin = Math.floor(W*0.06), xMax = Math.floor(W*0.94);
  const lumAt = i => 0.3*d[i] + 0.6*d[i+1] + 0.1*d[i+2];
  const ref = {};
  for(const side of [0,1]){
    const a = [];
    const x0 = side===0 ? xMin : Math.ceil(midX + W*0.07);
    const x1 = side===0 ? Math.floor(midX - W*0.07) : xMax;
    for(let y=yMin; y<yMax; y+=4) for(let x=x0; x<x1; x+=4) a.push(lumAt((y*W+x)*4));
    a.sort((p,q)=>p-q);
    ref[side] = a[Math.floor(a.length*0.8)] || 1;
  }
  const mask = new Uint8Array(W*H);
  for(let y=yMin;y<yMax;y++) for(let x=xMin;x<xMax;x++){
    if(Math.abs(x-midX) < W*0.07) continue;
    const i = (y*W+x)*4, R=d[i], G=d[i+1], B=d[i+2];
    if(Math.max(R,G,B)-Math.min(R,G,B) > 60) continue;
    if(lumAt(i) < ref[x < midX ? 0 : 1]*0.72) mask[y*W+x] = 1;
  }
  const out = [];
  for(const c of maskComponents(mask)){
    if(c.w < W*0.05 || c.w > W*0.16 || c.w < 36) continue;
    const ratio = c.w/c.h;
    if(ratio < 0.8 || ratio > 1.25) continue;
    if(c.cnt < c.w*c.h*0.45) continue;
    out.push([c.x, c.y, c.w, c.h]);
  }
  return out;
}
function detectPortraits(){
  const mask = new Uint8Array(W*H);
  const yMin = Math.floor(H*0.10), yMax = Math.floor(H*0.58);
  const xMin = Math.floor(W*0.08), xMax = Math.floor(W*0.92);
  for(let y=yMin;y<yMax;y++) for(let x=xMin;x<xMax;x++){
    const i = (y*W+x)*4, R=d[i], G=d[i+1], B=d[i+2];
    const mx = Math.max(R,G,B), mn = Math.min(R,G,B);
    if(mx-mn > 50 && mx > 70) mask[y*W+x] = 1;
  }
  const out = [];
  for(const c of maskComponents(mask)){
    if(c.w < W*0.05 || c.w > W*0.16) continue;
    const ratio = c.w/c.h;
    if(ratio < 0.8 || ratio > 1.25) continue;
    if(c.cnt/(c.w*c.h) < 0.10) continue;
    if(Math.abs(c.x + c.w/2 - W/2) < W*0.07) continue;
    out.push([c.x, c.y, c.w, c.h]);
  }
  return out;
}
function detectHighlight(){
  const mask = new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    const R=d[i*4], G=d[i*4+1], B=d[i*4+2];
    if(R>110 && G>75 && B<110 && R>G && G>B && (R-B)>40) mask[i]=1;
  }
  let best = null;
  for(const c of maskComponents(mask)){
    if(c.w < W*0.05 || c.w > W*0.16 || c.w < 36) continue;
    const ratio = c.w/c.h;
    if(ratio < 0.86 || ratio > 1.16) continue;
    const fill = c.cnt/(c.w*c.h);
    if(fill < 0.05 || fill > 0.34) continue;
    if(Math.abs(c.x + c.w/2 - midX) < W*0.09) continue;
    if(!best || c.cnt > best.cnt) best = c;
  }
  return best ? [best.x, best.y, best.w, best.h] : null;
}

// ---- addSlot + completeSlots (mêmes règles que le site) ----
const slots = [];
function addSlot(box){
  if(slots.length >= 10) return;
  if(slots.some(s=>Math.abs(s.box[0]-box[0]) < box[2]*0.5 && Math.abs(s.box[1]-box[1]) < box[3]*0.5)) return;
  const side = (box[0]+box[2]/2) < midX ? "A" : "B";
  if(slots.filter(s=>s.side===side).length >= 5) return;
  slots.push({box, side});
}
function completeSlots(){
  if(slots.length < 1 || slots.length >= 10) return;
  for(const s of [...slots]){
    const mx = Math.round(2*midX - (s.box[0]+s.box[2]));
    addSlot([mx, s.box[1], s.box[2], s.box[3]]);
  }
  for(const side of ["A","B"]){
    const ss = slots.filter(s=>s.side===side);
    if(ss.length < 3) continue;
    const tol = ss[0].box[2]*0.4;
    for(const a of ss) for(const b of ss) for(const c of ss){
      if(a===b || a===c || b===c) continue;
      if(Math.abs(a.box[0]-b.box[0]) < tol && Math.abs(a.box[1]-c.box[1]) < tol
         && Math.abs(a.box[1]-b.box[1]) > tol && Math.abs(a.box[0]-c.box[0]) > tol){
        addSlot([c.box[0], b.box[1], a.box[2], a.box[3]]);
      }
    }
  }
}

const onPage = onDraftScreen();
console.log(`${path.basename(SRC)} : ${W}x${H} · page VS = ${onPage} · midX = ${midX.toFixed(0)}`);
if(onPage){
  const empty = detectEmptySlots(), ports = detectPortraits(), hl = detectHighlight();
  console.log(`vides=${empty.length} portraits=${ports.length} surbrillance=${hl?"oui":"non"}`);
  for(const b of empty) addSlot(b);
  for(const b of ports) addSlot(b);
  if(hl) addSlot(hl);
  completeSlots(); completeSlots();
  console.log(`→ ${slots.length}/10 cases (A=${slots.filter(s=>s.side==="A").length}, B=${slots.filter(s=>s.side==="B").length})`);
  slots.forEach((s,i)=>console.log(`  #${i} [${s.side}] x=${s.box[0]} y=${s.box[1]} ${s.box[2]}x${s.box[3]}`));
  const out = img.clone();
  const col = (b, rgba) => {
    for(let x=b[0]; x<b[0]+b[2]; x++){ for(const yy of [b[1], b[1]+b[3]-1, b[1]+1, b[1]+b[3]-2]) out.setPixelColor(rgba, Math.min(W-1,Math.max(0,x)), Math.min(H-1,Math.max(0,yy))); }
    for(let y=b[1]; y<b[1]+b[3]; y++){ for(const xx of [b[0], b[0]+b[2]-1, b[0]+1, b[0]+b[2]-2]) out.setPixelColor(rgba, Math.min(W-1,Math.max(0,xx)), Math.min(H-1,Math.max(0,y))); }
  };
  slots.forEach(s=>col(s.box, s.side==="A" ? 0x00ff44ff : 0xff3344ff));
  const dst = path.join(path.dirname(SRC), "slots-" + path.basename(SRC));
  await out.writeAsync(dst);
  console.log("image annotée →", dst);
}
