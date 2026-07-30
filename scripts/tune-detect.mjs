// Réplique le détecteur de cases du site sur une capture réelle + image annotée de debug.
import { default as Jimp } from "jimp";

const SRC = process.argv[2] || "draft-sample2.png";
const img = await Jimp.read(SRC);
const W = img.bitmap.width, H = img.bitmap.height, D = img.bitmap.data;

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

function detectPortraits(){
  const mask = new Uint8Array(W*H);
  const yMin = Math.floor(H*0.08), yMax = Math.floor(H*0.62);
  const xMin = Math.floor(W*0.08), xMax = Math.floor(W*0.92);
  for(let y=yMin;y<yMax;y++) for(let x=xMin;x<xMax;x++){
    const i = (y*W+x)*4, R=D[i], G=D[i+1], B=D[i+2];
    const mx = Math.max(R,G,B), mn = Math.min(R,G,B);
    if(mx-mn > 50 && mx > 70) mask[y*W+x] = 1;
  }
  const out = [];
  for(const c of maskComponents(mask)){
    if(c.w < W*0.05 || c.w > W*0.16) continue;
    const ratio = c.w/c.h;
    if(ratio < 0.8 || ratio > 1.25) continue;
    if(c.cnt < c.w*c.h*0.45) continue;
    if(Math.abs(c.x + c.w/2 - W/2) < W*0.07) continue;
    out.push(c);
  }
  return out;
}

const boxes = detectPortraits();
console.log("cases détectées :", boxes.length);
boxes.forEach((b,i)=>console.log(`  #${i} x=${b.x} y=${b.y} ${b.w}x${b.h} fill=${(b.cnt/(b.w*b.h)).toFixed(2)} côté=${b.x+b.w/2<W/2?"A":"B"}`));

// image annotée
const out = img.clone();
const col = (b, rgba) => {
  for(let x=b.x; x<b.x+b.w; x++){ for(const yy of [b.y, b.y+b.h-1, b.y+1, b.y+b.h-2]) out.setPixelColor(rgba, x, yy); }
  for(let y=b.y; y<b.y+b.h; y++){ for(const xx of [b.x, b.x+b.w-1, b.x+1, b.x+b.w-2]) out.setPixelColor(rgba, xx, y); }
};
boxes.forEach(b=>col(b, b.x+b.w/2<W/2 ? 0x00ff44ff : 0xff3344ff));
await out.writeAsync("draft-sample2-debug.png");
console.log("→ draft-sample2-debug.png écrit (cadres verts = ton côté, rouges = adversaire)");
