// TacLog — recording analysis (runs entirely in the browser; only small cropped images go to the AI)
(function(){
const {$,h}=TL;
const MAPS=window.TACLOG_MAPS;
const mapName=id=>(MAPS.find(m=>m[0]===id)||[id,id])[1];
const fmt=s=>{s=Math.max(0,Math.round(s));const hh=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return(hh?hh+":"+String(m).padStart(2,"0"):m)+":"+String(ss).padStart(2,"0")};
const mmss=s=>Math.floor(s/60)+":"+String(Math.round(s%60)).padStart(2,"0");
const sideJa=s=>s==="attack"?"アタック":s==="defense"?"ディフェンス":"?";
const LIM={images:{maxCount:6}};
const toB64=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(b)});
function parseJSON(t){t=String(t||"").trim();try{return JSON.parse(t)}catch(e){}const f=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1])}catch(e){}}const i=Math.min(...["{","["].map(c=>{const k=t.indexOf(c);return k<0?1e9:k})),j=Math.max(t.lastIndexOf("}"),t.lastIndexOf("]"));if(i<j){try{return JSON.parse(t.slice(i,j+1))}catch(e){}}throw{code:"invalid_json"}}
const SAMPLE={json:async(prompt,o)=>{if(o.signal&&o.signal.aborted)throw{code:"cancelled"};const images=await Promise.all((o.images||[]).map(toB64));
  try{const r=await TL.api("/api/vision",{prompt,images,teamId:APP.team.id,task:o.task||"",fast:o.modelTier==="fast"});return parseJSON(r.text)}catch(e){if(o.signal&&o.signal.aborted)throw{code:"cancelled"};throw{code:e.code||"upstream_error",message:e.message}}}};
/* ---------- video + crop ---------- */
const video=document.createElement("video");video.muted=true;video.playsInline=true;video.preload="auto";
let duration=0,fileName="";
function crop(){const W=video.videoWidth,H=video.videoHeight,w=W*$("cw").value/100,hgt=H*$("ch").value/100;return{sx:(W-w)/2,sy:H*$("ct").value/100,sw:w,sh:hgt}}
function seek(t){return new Promise((res,rej)=>{const on=()=>{video.removeEventListener("seeked",on);video.removeEventListener("error",er);if(video.requestVideoFrameCallback){let ok=false;const fin=()=>{if(!ok){ok=true;res()}};video.requestVideoFrameCallback(fin);setTimeout(fin,40)}else res()};const er=()=>{video.removeEventListener("seeked",on);rej(new Error("seek"))};video.addEventListener("seeked",on);video.addEventListener("error",er);video.currentTime=Math.min(Math.max(0,t),Math.max(0,duration-0.1))})}
async function drawPreview(){
  if(!duration)return;const t=duration*$("pv").value/100;await seek(t);
  const f=$("frameCv"),fx=f.getContext("2d");f.width=640;f.height=Math.round(640*video.videoHeight/video.videoWidth)||360;
  fx.drawImage(video,0,0,f.width,f.height);const c=crop(),k=f.width/video.videoWidth;
  fx.strokeStyle="#F2B33D";fx.lineWidth=3;fx.strokeRect(c.sx*k,c.sy*k,c.sw*k,c.sh*k);
  const tc=$("tileCv"),tx=tc.getContext("2d");tc.width=300;tc.height=Math.round(300*c.sh/c.sw);tx.drawImage(video,c.sx,c.sy,c.sw,c.sh,0,0,tc.width,tc.height);
  $("pvV").textContent=fmt(t);
}
function syncLabels(){$("cwV").textContent=$("cw").value+"%";$("chV").textContent=$("ch").value+"%";$("ctV").textContent=$("ct").value+"%";estimate()}
let pvTimer;["cw","ch","ct","pv"].forEach(id=>$(id).addEventListener("input",()=>{syncLabels();clearTimeout(pvTimer);pvTimer=setTimeout(drawPreview,120)}));
const TILE_W=300,LABEL_W=46,COLS=4,ROWS=13,PER_IMG=COLS*ROWS;
// Fixed: every 4 seconds. The PC checks every frame for free; the AI reads about the same few frames per round whatever the interval,
// so a short interval costs (almost) nothing extra and makes plant times and round starts more precise (about ±2 s).
const IV=4;
function plan(){const iv=IV;const n=duration?Math.floor((duration-3)/iv):0;const imgs=Math.ceil(n/PER_IMG);const per=LIM&&LIM.images?Math.min(LIM.images.maxCount,6):6;return{iv,n,imgs,calls:Math.ceil(imgs/per),per}}
function estimate(){if(!duration){$("estimate").textContent="";return}const p=plan();$("estimate").textContent="動画 "+fmt(duration)+" ・ "+p.n+"か所(4秒ごと)をこのパソコンで確認し、AIには要所だけ読ませます。";}
const BAD_FILE="この動画は読み込めませんでした。MP4形式で試してください(OBSの「録画の再多重化」でMP4にできます)。";
let curUrl=null,curFile=null;
function loadFile(f){return new Promise((resolve,reject)=>{
  fileName=f.name;curFile=f;$("fileInfo").textContent="読み込み中…";$("go").disabled=true;duration=0;
  if(curUrl)URL.revokeObjectURL(curUrl);curUrl=URL.createObjectURL(f);video.src=curUrl;
  video.onloadedmetadata=async()=>{duration=video.duration;if(!isFinite(duration)||!video.videoWidth){$("fileInfo").textContent=BAD_FILE;reject(new Error(BAD_FILE));return}
    $("fileInfo").textContent=f.name+" ・ "+fmt(duration)+" ・ "+video.videoWidth+"×"+video.videoHeight;syncLabels();await drawPreview();$("go").disabled=false;resolve()};
  video.onerror=()=>{$("fileInfo").textContent=BAD_FILE;reject(new Error(BAD_FILE))};
})}
$("file").addEventListener("change",()=>{const f=$("file").files[0];if(f)loadFile(f).catch(()=>{})});

/* ---------- analysis ---------- */
let ctl=null,lastResult=null;
function prog(p,text){$("progBox").hidden=false;$("progBar").style.width=Math.round(p*100)+"%";$("progText").textContent=text}
async function buildImage(times,startIdx){
  const c=crop(),th=Math.round(TILE_W*c.sh/c.sw),cellW=LABEL_W+TILE_W;
  const cv=document.createElement("canvas");cv.width=COLS*cellW;cv.height=Math.ceil(times.length/COLS)*th;const x=cv.getContext("2d");
  x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);x.font="bold 16px monospace";x.textBaseline="middle";
  for(let i=0;i<times.length;i++){
    if(ctl.signal.aborted)throw{code:"cancelled"};
    await seek(times[i]);const col=i%COLS,row=Math.floor(i/COLS),ox=col*cellW,oy=row*th;
    x.fillStyle="#F2B33D";x.fillRect(ox,oy,LABEL_W-4,th-2);x.fillStyle="#000";x.fillText(String(startIdx+i),ox+4,oy+th/2);
    x.drawImage(video,c.sx,c.sy,c.sw,c.sh,ox+LABEL_W,oy,TILE_W,th-2);
  }
  return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.88));
}
function parseTile(s){const m=String(s||"").trim().match(/^(\d{1,2}|\?)\s*-\s*(\d{1,2}|\?)\s*\|\s*(\d{1,2}:\d{2}|\d{1,2}\.\d{1,2}|S|E|-)$/i);if(!m)return{L:null,R:null,x:null};
  const L=m[1]==="?"?null:Number(m[1]),R=m[2]==="?"?null:Number(m[2]);let x=null;if(/^s$/i.test(m[3]))x="S";else if(/^e$/i.test(m[3])||m[3].includes("."))x="E";else if(m[3]!=="-"){const[a,b]=m[3].split(":");x=Number(a)*60+Number(b)}return{L,R,x}}
async function readTiles(blobs,from,to){
  const prompt="You are reading a VALORANT match video. The images contain tiles cut from the TOP-CENTER of the game screen (team scores and the round timer), sampled at regular intervals. Each tile has a yellow number label on its left. Go through tiles "+from+" to "+to+" in number order ("+(to-from+1)+" tiles total, left-to-right then top-to-bottom, across all images in order) and output one string per tile in this exact format:\n"
   +"'<left score>-<right score>|<state>'\n<state> = the remaining round time as m:ss if a timer is visible; S if the spike (bomb) icon is shown instead of the timer; E if the timer shows seconds with decimals such as 28.11 (the short phase right after a round ends); - if this is not the in-game HUD or it is unreadable. Use ? for a score you cannot read (e.g. '?-?|-').\n"
   +"Reply with only JSON: {\"tiles\":[\"3-2|1:24\",\"3-2|S\",\"?-?|-\"]} containing exactly "+(to-from+1)+" strings.";
  const r=await SAMPLE.json(prompt,{images:blobs,signal:ctl.signal,modelTier:"fast",task:"tiles"});
  const arr=r&&Array.isArray(r.tiles)?r.tiles:[];return arr;
}
async function readComps(){
  const W=video.videoWidth,H=video.videoHeight,strip=document.createElement("canvas");strip.width=1400;const sh=Math.round(1400*(H*0.11)/W);strip.height=sh*3;const x=strip.getContext("2d");
  const ts=[0.15,0.45,0.75];for(let i=0;i<3;i++){await seek(duration*ts[i]);x.drawImage(video,0,0,W,H*0.11,0,i*sh,1400,sh)}
  const blob=await new Promise(r=>strip.toBlob(r,"image/jpeg",0.9));
  try{const r=await SAMPLE.json("These are three strips from the top of a VALORANT match screen. The top bar shows agent portraits: the player's team on the LEFT of the score and the enemy team on the RIGHT. Identify the agents (English agent names). Reply only JSON: {\"left\":[\"Jett\"],\"right\":[\"Sova\"]} with up to 5 names each; leave a list empty if you are not sure.",{images:[blob],signal:ctl.signal,modelTier:"default",task:"comps"});
    return{left:(r.left||[]).map(String).slice(0,5),right:(r.right||[]).map(String).slice(0,5)}}catch(e){if(e&&e.code==="cancelled")throw e;return{left:[],right:[]}}
}

function firstBuy(r,samples){const it=samples.filter(x=>x.t>=r.start&&typeof x.x==="number");return it.length?it[0].t:r.start+2}
async function gridOf(cells,cw,chh,cols,draw){const cv=document.createElement("canvas");const rows=Math.ceil(cells.length/cols);cv.width=cols*cw;cv.height=rows*chh;const x=cv.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);x.font="bold 18px monospace";x.textBaseline="top";
  for(let i=0;i<cells.length;i++){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(cells[i].t);const ox=(i%cols)*cw,oy=Math.floor(i/cols)*chh;draw(x,ox,oy);x.fillStyle="#F2B33D";x.fillRect(ox,oy,34,24);x.fillStyle="#000";x.fillText(String(i+1),ox+4,oy+3)}
  return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.88))}
async function readSides(cands){
  if(!cands.length)return[];const W=video.videoWidth,H=video.videoHeight;
  const blob=await gridOf(cands,700,60,2,(x,ox,oy)=>x.drawImage(video,0,0,W*0.3,H*0.05,ox+36,oy,664,58));
  try{const r=await SAMPLE.json("Each numbered strip is the top-left corner of a VALORANT screen, where the current location name is shown (e.g. 'Attacker Side Spawn', 'Defender Side Spawn', 'A Site', or Japanese equivalents like アタッカー側スポーン / ディフェンダー側スポーン). For strips 1 to "+cands.length+" in order, output 'attack' if it says attacker side spawn, 'defense' if defender side spawn, otherwise '-'. Reply only JSON: {\"sides\":[\"defense\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"fast",task:"sides"});return Array.isArray(r.sides)?r.sides:[]}catch(e){if(e&&e.code==="cancelled")throw e;return[]}
}
async function readSites(cells){
  const out=[];if(!cells.length)return out;const W=video.videoWidth,H=video.videoHeight;
  for(let i=0;i<cells.length;i+=20){const part=cells.slice(i,i+20);
    const blob=await gridOf(part,260,270,5,(x,ox,oy)=>x.drawImage(video,0,0,W*0.22,H*0.42,ox,oy,260,268));
    try{const r=await SAMPLE.json("Each numbered cell is the top-left of a VALORANT screen shortly after the spike was planted: the minimap (with site letters A, B, maybe C, and a spike/bomb marker) and the current location name above it (e.g. 'B Site'). For cells 1 to "+part.length+" in order, output the site letter where the spike was planted ('A','B' or 'C'), or '-' if you cannot tell. Reply only JSON: {\"sites\":[\"B\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"default",task:"sites"});
      const arr=Array.isArray(r.sites)?r.sites:[];part.forEach((c,k)=>out.push(/^[ABC]$/.test(String(arr[k]))?String(arr[k]):null))}catch(e){if(e&&e.code==="cancelled")throw e;part.forEach(()=>out.push(null))}}
  return out;
}

function roundStartOf(r,samples,next){const it=samples.filter(x=>x.t>=r.start&&(next==null||x.t<next)&&typeof x.x==="number"&&x.x>30&&x.x<=100);return it.length?it[0].t-(100-it[0].x):null}
// First kill without AI: each agent portrait in the top bar loses its detail when that player dies.
// Measure the texture of the 10 portrait boxes and find the first moment either side drops below 5 alive.
// The top bar (agent portraits) is read as one strip; each column gets a "detail" score. A dead player's portrait turns grey and flat.
// Portrait positions and the alive/dead line are calibrated per video (resolution, stretched 4:3, HUD differences), falling back to 1080p defaults.
const SX0=0.08,SX1=0.92,SY0=0.004,SY1=0.072,SW=700,SH=44;
const stripCv=document.createElement("canvas");stripCv.width=SW;stripCv.height=SH;const stripX=stripCv.getContext("2d",{willReadFrequently:true});
const DEF_L=[0.2427,0.277,0.310,0.3458,0.3797],DEF_R=[0.6208,0.6557,0.6896,0.7234,0.7573];
const toCol=f=>Math.round((f-SX0)/(SX1-SX0)*SW);
let SLOTS=null; // {cols:[10 column centers], hw, thr:[10]}
function profile(){
  const W=video.videoWidth,H=video.videoHeight;
  stripX.drawImage(video,W*SX0,H*SY0,W*(SX1-SX0),H*(SY1-SY0),0,0,SW,SH);
  const d=stripX.getImageData(0,0,SW,SH).data,lum=new Float32Array(SW*SH),out=new Float32Array(SW);
  for(let i=0;i<lum.length;i++)lum[i]=(d[i*4]+d[i*4+1]+d[i*4+2])/3;
  for(let y=0;y<SH-1;y++)for(let x=0;x<SW-1;x++){const i=y*SW+x;out[x]+=Math.abs(lum[i+1]-lum[i])+Math.abs(lum[i+SW]-lum[i])}
  for(let x=0;x<SW;x++)out[x]/=SH;return out;
}
const slotVal=(p,c,hw)=>{let s=0,n=0;for(let x=Math.max(0,c-hw);x<=Math.min(SW-1,c+hw);x++){s+=p[x];n++}return n?s/n:0};
function defaultSlots(){return{cols:DEF_L.concat(DEF_R).map(toCol),hw:7,thr:null}}
function withThr(sl,A,E){
  const all=A.concat(E);
  // alive/dead line per slot: halfway between "everyone alive" and the lowest values seen at round ends
  let thr=sl.cols.map(c=>{const av=A.map(p=>slotVal(p,c,sl.hw)).sort((a,b)=>a-b),ev=all.map(p=>slotVal(p,c,sl.hw)).sort((a,b)=>a-b);
    if(!av.length)return null;const hi=av[Math.floor(av.length/2)],lo=ev[Math.floor(ev.length*0.1)];return hi-lo>hi*0.18?(hi+lo)/2:null});
  const known=thr.filter(x=>x!=null);const fb=known.length?known.reduce((a,b)=>a+b)/known.length:null;
  return{...sl,thr:thr.map(x=>x!=null?x:fb)};
}
// how well a slot layout works: share of "everyone alive" frames read as 5v5, and of round-end frames with someone dead
function score(sl,A,E){if(!sl.thr||sl.thr[0]==null)return 0;const cnt=p=>{const r=[0,0];sl.cols.forEach((c,i)=>{if(slotVal(p,c,sl.hw)>sl.thr[i])r[i<5?0:1]++});return r};
  const a=A.filter(p=>{const r=cnt(p);return r[0]===5&&r[1]===5}).length/Math.max(1,A.length),e=E.filter(p=>{const r=cnt(p);return r[0]<5||r[1]<5}).length/Math.max(1,E.length);return a*0.7+e*0.3}
async function calibrate(aliveTimes,endTimes){
  const P=async ts=>{const out=[];for(const t of ts){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);out.push(profile())}return out};
  const A=await P(aliveTimes),E=await P(endTimes);
  let best=withThr(defaultSlots(),A,E),bs=score(best,A,E);
  if(bs<0.9&&A.length>=3&&E.length>=3){  // the usual 1080p layout does not fit well (other resolution / stretched 4:3 / HUD scale): try wider and narrower layouts
    for(let k=0.8;k<=1.6;k+=0.025){
      const fr=DEF_L.concat(DEF_R).map(f=>0.5+(f-0.5)*k);if(fr[0]<SX0+0.005||fr[9]>SX1-0.005)continue;
      const c=withThr({cols:fr.map(toCol),hw:Math.max(4,Math.round(7*k)),k,auto:true},A,E),cs=score(c,A,E);
      if(cs>bs+0.02){best=c;bs=cs}
    }
  }
  best.score=bs;SLOTS=best;return best;
}
function aliveNow(){
  const sl=SLOTS||defaultSlots(),p=profile(),r=[0,0];
  sl.cols.forEach((c,i)=>{const v=slotVal(p,c,sl.hw),thr=sl.thr&&sl.thr[i]!=null?sl.thr[i]:null;if(thr==null?false:v>thr)r[i<5?0:1]++});
  return r;
}
async function readFirstKills(segs,samples){
  const jobs=[];
  segs.forEach((rs,si)=>rs.forEach((r,ri)=>{const next=rs[ri+1]?rs[ri+1].start:null;const st=roundStartOf(r,samples,next);r._next=next;if(st==null)return;r._st=st;
    jobs.push({si,ri,st,end:Math.min(st+75,r.plantAt!=null?r.plantAt+40:Infinity,next??Infinity,duration-0.3)})}));
  if(!jobs.length)return;
  prog(0.95,"ファーストキルの読み取りを準備しています…");
  const aliveT=jobs.slice(0,14).map(j=>j.st+3),endT=samples.filter(x=>x.x==="E").map(x=>x.t).slice(0,14);
  if(endT.length<3)jobs.slice(0,14).forEach(j=>endT.push(Math.max(j.st+3,j.end-2)));
  await calibrate(aliveT,endT);
  let done=0;
  for(const j of jobs){
    prog(0.95,"ファーストキルを読み取っています… ("+(++done)+"/"+jobs.length+"ラウンド)");
    // Only a few frames per round: confirm everyone is alive at the start, then jump (binary search) to the moment the first player dies, then skip to the next round.
    let ok=null,fk=null,fkT=null;const memo={};
    const at=async(t)=>{if(memo[t])return memo[t];if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);return memo[t]=aliveNow()};
    const dead=async(t)=>{const a=await at(t);return a[0]<5||a[1]<5};
    for(const d of [2,5,0,8,11,14,17,20]){const t=Math.ceil(j.st+d);if(t>j.end||t<0)continue;const a=await at(t);if(a[0]===5&&a[1]===5){ok=t;break}} // round start can be a few seconds off
    if(ok!=null){
      // find any moment with someone dead (near the end of the round first; step back in case the next round already started)
      let hi=null;
      for(let t=Math.floor(j.end);t>ok;t-=8){if(await dead(t)&&await dead(t-1>ok?t-1:t)){hi=t;break}}
      if(hi!=null){
        let lo=ok;                                   // lo: everyone alive, hi: someone dead
        while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(await dead(mid))hi=mid;else lo=mid}
        if(hi+1<=j.end&&!(await dead(hi+1))){/* flicker: keep the result anyway, it is the best guess */}
        const a=await at(hi);fk=a[0]<5&&a[1]<5?"tie":a[1]<5?"us":"them";fkT=hi;
      }
    }
    const r=segs[j.si][j.ri];r.fk=fk;r.fkT=fkT;
  }
  await readFirstKillers(segs);
}

async function readFirstKillers(segs){
  // Only the name of whoever got the first kill. Which team got it is already known from the portraits (free), so the AI is told which colour to look for
  // and answers with just a name per cell (short answers = cheaper).
  const W=video.videoWidth,H=video.videoHeight,cells=[];
  segs.forEach((rs,si)=>rs.forEach((r,ri)=>{if(r.fkT!=null)cells.push({si,ri,t:Math.min(duration-0.2,r.fkT)})}));
  const BAD=/^(unknown|unk|\?+|-+|不明|none|n\/a)$/i;
  for(let i=0;i<cells.length;i+=16){
    const part=cells.slice(i,i+16);
    const blob=await gridOf(part,440,176,2,(x,ox,oy)=>x.drawImage(video,W*0.66,H*0.035,W*0.34,H*0.17,ox+36,oy,404,174));
    const want=part.map((c,k)=>{const f=segs[c.si][c.ri].fk;return (k+1)+":"+(f==="us"?"green":f==="them"?"red":"any")}).join(", ");
    try{const r=await SAMPLE.json("Each numbered cell is the kill feed (top-right of a VALORANT screen) at the moment of the first kill of a round. An entry is: killer agent portrait (and name), weapon, victim agent portrait (and name). Green/teal entries = killer on the player's team, red = enemy team. For each cell take the entry of the given colour (if several, the oldest one; 'any' = whichever entry is there): "+want+". Identify both AGENTS from the portraits (names may be hidden or blurred). Reply only JSON with one string per cell in order: {\"k\":[\"Jett>Sova|g\",\"-\"]} = killer agent > victim agent, then |g for green or |r for red. Use \"-\" if unreadable, and ? for one unreadable side.",{images:[blob],signal:ctl.signal,modelTier:"default",task:"killers"});
      const arr=Array.isArray(r.k)?r.k:[];
      part.forEach((c,k)=>{const r0=segs[c.si][c.ri],raw=String(arr[k]||"").trim(),m=raw.match(/^(.*?)\|\s*([gr])\s*$/i),body=(m?m[1]:raw).trim();
        const [kn,vn]=body.split(">").map(x=>String(x||"").trim().slice(0,30));
        if(kn&&!BAD.test(kn))r0.fkBy=kn;
        if(vn&&!BAD.test(vn))r0.fkVictim=vn;
        if(r0.fk==="tie"&&m)r0.fk=m[2].toLowerCase()==="g"?"us":"them"});
    }catch(e){if(e&&e.code==="cancelled")throw e}
  }
  segs.forEach(rs=>rs.forEach(r=>{delete r.fkT}));
}

function flip(s){return s==="attack"?"defense":"attack"}
function startFrom(n,side){return n<=12?side:n<=24?flip(side):((n-25)%2===0?side:flip(side))}
function sideOf(n,start){const sw=start==="attack"?"defense":"attack";return n<=12?start:n<=24?sw:((n-25)%2===0?start:sw)}
function buildRounds(samples,start){
  // stabilise scores
  let cur=null;const valid=i=>samples[i].L!=null&&samples[i].R!=null;
  const sparse=samples.some(x=>x.ai!=null);   // scores already cleaned up from a few AI readings: no need to wait for a second look
  const confirm=i=>{if(sparse)return true;for(let j=i+1;j<Math.min(samples.length,i+4);j++){if(valid(j))return samples[j].L===samples[i].L&&samples[j].R===samples[i].R}return true};
  const steady=i=>{let n=0;for(let j=i;j<samples.length&&n<4;j++){if(!valid(j))continue;if(samples[j].L!==samples[i].L||samples[j].R!==samples[i].R)return false;n++}return n>=3};
  let seg=0;
  samples.forEach((s,i)=>{
    if(valid(i)){
      if(!cur){if(confirm(i))cur={L:s.L,R:s.R,seg}}
      else{const d=(s.L+s.R)-(cur.L+cur.R);
        if(d===1&&((s.L===cur.L+1&&s.R===cur.R)||(s.R===cur.R+1&&s.L===cur.L))&&confirm(i))cur={L:s.L,R:s.R,seg};
        else if(s.L+s.R===0&&cur.L+cur.R>=3&&confirm(i)){seg++;cur={L:0,R:0,seg}}
        else if(d>1&&d<=4&&s.L>=cur.L&&s.R>=cur.R&&steady(i))cur={L:s.L,R:s.R,seg};}  // a round or two were not seen: carry on instead of getting stuck
    }
    s.score=cur;
  });
  // group
  const groups=[];let g=null;
  samples.forEach(s=>{if(!s.score)return;if(!g||g.score!==s.score){g={score:s.score,items:[]};groups.push(g)}g.items.push(s)});
  const segs={};
  groups.forEach((gr,i)=>{
    const n=gr.score.L+gr.score.R+1,next=groups[i+1]&&groups[i+1].score.seg===gr.score.seg?groups[i+1].score:null;
    let win=null;if(next)win=next.L>gr.score.L;
    let plant=null,plantAt=null;
    for(let k=0;k<gr.items.length;k++){if(gr.items[k].x==="S"){let p=null;for(let j=k-1;j>=0;j--){if(typeof gr.items[j].x==="number"){p=gr.items[j];break}}
      if(p){plant=Math.max(0,Math.round(p.x-(gr.items[k].t-p.t)/2));plantAt=Math.round((p.t+gr.items[k].t)/2)}else plantAt=gr.items[k].t;break}}
    const r={n,side:sideOf(n,start),win,score:gr.score.L+"-"+gr.score.R,planted:plantAt!=null,plant,start:Math.round(gr.items[0].t),plantAt};
    (segs[gr.score.seg]=segs[gr.score.seg]||[]).push(r);
  });
  return Object.values(segs).map(rs=>{const m=new Map();rs.forEach(r=>{if(!m.has(r.n)||m.get(r.n).win==null)m.set(r.n,r)});return[...m.values()].sort((a,b)=>a.n-b.n)});
}
// Cheap check before the real analysis. Streams often start with ~10 minutes of lobby or switch to other screens (desktop, Discord, BRB),
// so look at 16 frames spread over the whole video and call it VALORANT if ANY of them is VALORANT. Only when a second, different set of
// 16 frames also has no VALORANT at all is the video skipped. Each check is one small image (well under 1 yen).
async function sheetAt(ts){
  const cv=document.createElement("canvas");cv.width=960;cv.height=540;const x=cv.getContext("2d");x.font="bold 16px monospace";x.textBaseline="top";
  for(let i=0;i<ts.length;i++){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(duration*ts[i]);const ox=(i%4)*240,oy=Math.floor(i/4)*135;x.drawImage(video,ox,oy,240,135);x.fillStyle="#F2B33D";x.fillRect(ox,oy,24,20);x.fillStyle="#000";x.fillText(String(i+1),ox+3,oy+2)}
  return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.72));
}
async function askValorant(blob){
  const r=await SAMPLE.json("These are 16 numbered frames taken at different times from ONE stream recording. Streamers often show the lobby for a long time, or switch to other screens (desktop, Discord, a 'be right back' screen, another app) for a while. Question: does ANY of the 16 frames show VALORANT (the Riot Games tactical shooter)? Count all of these as VALORANT: in-match gameplay (score and round timer at top center, minimap at top left), the VALORANT lobby/main menu, agent select, loading screen, the scoreboard or end-of-match screen. If even one frame is VALORANT, or you are not sure, answer true. Answer false only if you are confident that none of the frames is VALORANT. Reply only JSON: {\"valorant\":true,\"frames\":[numbers of VALORANT frames]} or {\"valorant\":false,\"what\":\"what the video shows, short, in Japanese\"}",{images:[blob],signal:ctl.signal,modelTier:"default",task:"check"});
  return r&&r.valorant===false?{ok:false,what:String(r.what||"").slice(0,40)}:{ok:true};
}
async function isValorant(){
  try{
    const A=[],B=[];for(let i=0;i<16;i++){A.push(0.03+i*0.06);B.push(0.06+i*0.06)}   // 3%..93% and 6%..96%
    const first=await askValorant(await sheetAt(A));if(first.ok)return first;
    prog(0,"念のため、ほかの場面ももう一度確認しています…");
    const second=await askValorant(await sheetAt(B.map(t=>Math.min(t,0.98))));return second.ok?second:{ok:false,what:second.what||first.what};
  }catch(e){if(e&&e.code==="cancelled")throw e;if(e&&["not_granted","sampling_disabled","rate_limited","images_unavailable"].includes(e.code))throw e;return{ok:true}}
}
// Which map: a few minimap + location-name crops per map segment, one small AI call per segment.
// Which map, and which agent the streamer (the player whose screen this is) plays: one small AI call per map segment.
// The map comes from minimap crops; the agent from the bottom-centre HUD (ability icons), which is visible even when names are hidden.
async function readMaps(segs){
  const keys=(window.TACLOG_MAPS||[]).map(m=>m[0]);const W=video.videoWidth,H=video.videoHeight,maps=[],me=[];
  for(const rs of segs){
    if(!rs.length){maps.push(null);me.push(null);continue}
    const pick=[Math.floor(rs.length*0.25),Math.floor(rs.length*0.5),Math.floor(rs.length*0.75)].map(i=>rs[Math.min(i,rs.length-1)]);
    const cells=pick.map(r=>({t:Math.min(duration-0.2,r._st!=null?r._st+4:r.start+35)}));   // right after the round starts: the streamer is alive, so the HUD is their own
    try{
      const mapBlob=await gridOf(cells,260,270,3,(x,ox,oy)=>x.drawImage(video,0,0,W*0.22,H*0.42,ox,oy,260,268));
      const hudBlob=await gridOf(cells,560,120,1,(x,ox,oy)=>x.drawImage(video,W*0.28,H*0.86,W*0.44,H*0.14,ox+36,oy,524,118));
      const r=await SAMPLE.json("Image 1: numbered cells showing the top-left of a VALORANT screen during a round (minimap and location name such as 'A Site'). Image 2: the bottom-centre HUD of the same moments (health and the player's ability icons). All cells are from the SAME map and the SAME player. 1) Which map? Choose one of: "+keys.join(", ")+" (or \"-\"). 2) Which agent is this player playing, judging from the ability icons? English agent name (or \"-\"). Reply only JSON: {\"map\":\"ascent\",\"me\":\"Jett\"}",{images:[mapBlob,hudBlob],signal:ctl.signal,modelTier:"default",task:"map"});
      const m=String(r&&r.map||"").toLowerCase().trim();maps.push(keys.includes(m)?m:null);
      const a=String(r&&r.me||"").trim().slice(0,20);me.push(a&&a!=="-"&&!/unknown/i.test(a)?a:null);
    }catch(e){if(e&&e.code==="cancelled")throw e;maps.push(null);me.push(null)}
  }
  return{maps,me};
}
const agentKey=s=>String(s||"").toLowerCase().replace(/[^a-z]/g,"");
// Personal first kill / first death of the streamer, from the kill feed agents and the streamer's agent
// When did the streamer die in each round? (for survival rate / time alive)
// 1) one frame just before each round ends: own view or spectating a teammate (dead)?  2) for rounds where they died, narrow it down with
// 2 more looks (all rounds of a level in one AI call), 3) snap to the moment a portrait of the streamer's team turned grey (free, on this PC).
async function readMyDeaths(segs,me){
  const W=video.videoWidth,H=video.videoHeight,jobs=[];
  segs.forEach((rs,si)=>{if(!me[si])return;rs.forEach((r,ri)=>{if(r._st==null)return;
    const end=Math.min(r._next!=null?r._next-1:(r.plantAt!=null?r.plantAt+44:r._st+99),r._st+145,duration-0.3);
    if(end>r._st+6)jobs.push({si,ri,r,lo:r._st+2,hi:end,agent:me[si]})})});
  if(!jobs.length)return;
  const ask=async(list)=>{   // list of {t,agent} -> "A" alive / "D" spectating or dead / null
    const out=[];
    for(let i=0;i<list.length;i+=16){
      const part=list.slice(i,i+16);
      const blob=await gridOf(part,300,180,4,(x,ox,oy)=>x.drawImage(video,W*0.2,H*0.5,W*0.6,H*0.5,ox+34,oy,266,178));
      try{const r=await SAMPLE.json("Each numbered cell is the lower half of a VALORANT screen. For each cell, is this the player's OWN first-person view while alive, or is the player DEAD (spectating a teammate: a 'Spectating'/観戦中 label or another player's name at the bottom, a different agent's abilities, a death recap or kill cam)? The player's own agent for each cell: "+part.map((c,k)=>(k+1)+":"+c.agent).join(", ")+". Reply only JSON with one letter per cell in order: {\"s\":[\"A\",\"D\",\"?\"]} (A = alive own view, D = dead/spectating, ? = cannot tell or not in a round).",{images:[blob],signal:ctl.signal,modelTier:"fast",task:"deaths"});
        const arr=Array.isArray(r.s)?r.s:[];part.forEach((_,k)=>{const v=String(arr[k]||"").toUpperCase();out.push(v==="A"||v==="D"?v:null)})}
      catch(e){if(e&&e.code==="cancelled")throw e;part.forEach(()=>out.push(null))}
    }
    return out;
  };
  prog(0.985,"配信者の生存を確認しています…");
  const endS=await ask(jobs.map(j=>({t:j.hi,agent:j.agent})));
  const died=[];
  jobs.forEach((j,k)=>{if(endS[k]==="A"){j.r.myDead=false;j.r.myDeathT=null}else if(endS[k]==="D")died.push(j)});
  for(let level=0;level<2&&died.length;level++){
    const mids=died.map(j=>Math.round((j.lo+j.hi)/2));
    const s=await ask(died.map((j,k)=>({t:mids[k],agent:j.agent})));
    died.forEach((j,k)=>{if(s[k]==="A")j.lo=mids[k];else if(s[k]==="D")j.hi=mids[k]});
  }
  for(const j of died){   // the death itself is when one of the streamer's team portraits turns grey, a little before the spectating view starts
    let prev=null,best=null;
    for(let t=Math.max(j.r._st+1,Math.floor(j.lo)-2);t<=Math.ceil(j.hi);t++){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);const a=aliveNow()[0];if(prev!=null&&a<prev)best=t;prev=a}
    const at=best!=null?best:j.hi-2;
    j.r.myDead=true;j.r.myDeathT=Math.max(0,Math.round(at-j.r._st));
  }
}
// Abilities and ult from the player's OWN HUD (bottom centre), free on this PC. Only from the barrier drop (combat phase) until the player
// dies or the round ends: the buy phase is never counted.
//  - charge bar under each slot: teal = still has it, grey = used up. The X (ult) bar is teal while the ult is ready.
//  - an ability taken out (held, not the gun) shows a small framed mouse hint above its slot, and the ammo counter disappears.
// Positions are measured on 1080p and scale with the height (x from the screen centre; stretched 4:3 is found automatically).
const KIT_DX=[-170,-58,55,168],KIT_MID=[-226,-114,0,112,224],KX0=-260,KX1=400,KY0=860,KY1=1060,KSTEP=2;
const kitCv=document.createElement("canvas");kitCv.width=KX1-KX0;kitCv.height=KY1-KY0;const kitX=kitCv.getContext("2d",{willReadFrequently:true});
let KIT_KX=1;
function kitNow(kx){
  const W=video.videoWidth,H=video.videoHeight,s=H/1080,cw=KX1-KX0,chh=KY1-KY0;
  kitX.drawImage(video,W/2+KX0*s*kx,KY0*s,cw*s*kx,chh*s,0,0,cw,chh);
  const d=kitX.getImageData(0,0,cw,chh).data;
  const frac=(x0,x1,y0,y1,f)=>{let n=0,k=0;for(let y=y0-KY0;y<y1-KY0;y++)for(let x=x0-KX0;x<x1-KX0;x++){const i=(y*cw+x)*4;n++;if(f(d[i],d[i+1],d[i+2]))k++}return n?k/n:0};
  const white=(r,g,b)=>{const mn=Math.min(r,g,b),mx=Math.max(r,g,b);return mn>200&&mx-mn<40};
  const teal=(r,g,b)=>g>150&&b>120&&r<140&&g-r>60;
  const grey=(r,g,b)=>{const mn=Math.min(r,g,b),mx=Math.max(r,g,b);return mn>110&&mx-mn<30};
  const bars=KIT_DX.map(dx=>{const t=frac(dx-30,dx+30,1043,1049,teal);if(t>0.4)return 1;return frac(dx-30,dx+30,1043,1049,grey)>0.4?0:null});
  const bg=Math.max(...KIT_MID.map(dx=>frac(dx-15,dx+15,872,946,white)));
  const ok=bars.every(b=>b!=null)&&bg<0.5;     // menus, the map, the desktop: no HUD
  let held=null;
  if(ok&&bg<0.01&&frac(310,385,1008,1046,white)<0.1){
    const hint=KIT_DX.map(dx=>frac(dx-22,dx+22,872,946,white)),o=hint.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]);
    if(o[0][0]>0.025&&o[0][0]<0.3&&o[1][0]<0.6*o[0][0])held=o[0][1];
  }
  return{ok,bars,held};
}
// One pass over every round from the barrier drop to the round end (free, on this PC), every 2 seconds:
//  - how many players are alive on each side (portraits) -> man-advantage situations, clutches, small fights (r.alv)
//  - while the recording player is alive: their own ability HUD -> hold time, skills left, ult (r.kit)
// Then, for every death in the round (any player, either team), the AI looks at the minimap just before/after (a new X marker appears
// where the player died) and at the kill feed: who killed whom, and where. So one recording gives every fight of the team (r.fights).
// To name the place, a reference sheet is built from this same video: the minimap with the recording player's own icon, labelled with the
// location name the game shows above the minimap at that moment (read as text). Same map, same minimap orientation as the fights.
const MM={x:0.008,y:0.035,w:0.205,h:0.345};   // minimap area (top-left), fraction of the screen
const drawMM=(x,ox,oy,s)=>{const W=video.videoWidth,H=video.videoHeight;x.drawImage(video,W*MM.x,H*MM.y,W*MM.w,H*MM.h,ox,oy,s,Math.round(s*H*MM.h/(W*MM.w)))};
const mmCv=document.createElement("canvas"),mmX=mmCv.getContext("2d",{willReadFrequently:true});
function mmPixels(s,mh){mmCv.width=s;mmCv.height=mh;drawMM(mmX,0,0,s);return mmX.getImageData(0,0,s,mh).data}
// new death markers: pixels with the X colours (blue = our team, red = enemy) that were not there 2 seconds ago -> up to 2 spots
function newMarks(A,B,s,mh,C){   // A: 2 s before, B: now, C: 2 s later (a death marker stays where it is; moving player icons do not)
  const isX=(d,i)=>{const r=d[i],g=d[i+1],b=d[i+2];return(b>170&&r<80&&b-r>110)||(r>165&&r-g>60&&r-b>60)};
  const bins=new Map(),B8=10;
  for(let y=2;y<mh-2;y++)for(let x=2;x<s-2;x++){const i=(y*s+x)*4;if(!isX(B,i))continue;let old=false;
    for(let dy=-2;dy<=2&&!old;dy++)for(let dx=-2;dx<=2;dx++){if(isX(A,((y+dy)*s+x+dx)*4)){old=true;break}}
    if(old)continue;if(C){let stay=false;for(let dy=-1;dy<=1&&!stay;dy++)for(let dx=-1;dx<=1;dx++){if(isX(C,((y+dy)*s+x+dx)*4)){stay=true;break}}if(!stay)continue}
    const k=Math.floor(x/B8)+","+Math.floor(y/B8),v=bins.get(k)||{n:0,x:0,y:0};v.n++;v.x+=x;v.y+=y;bins.set(k,v)}
  const top=[...bins.values()].filter(v=>v.n>=4).sort((a,b)=>b.n-a.n),out=[];
  for(const v of top){const c=[v.x/v.n,v.y/v.n];if(out.every(o=>Math.hypot(o[0]-c[0],o[1]-c[1])>18))out.push(c);if(out.length>=2)break}
  return out;
}
// Is the minimap fixed? With "rotate" or "keep player centred" the map turns and moves all the time, so a death marker cannot be placed
// on it reliably. The grey floor of a fixed minimap stays in the same pixels; compare it between moments.
async function mmFixed(times){
  const s=120,mh=Math.round(s*video.videoHeight*MM.h/(video.videoWidth*MM.w)),masks=[];
  for(const t of times.slice(0,10)){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);const d=mmPixels(s,mh),m=new Uint8Array(s*mh);
    for(let i=0;i<m.length;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);m[i]=mx-mn<18&&mx>100&&mx<215?1:0}masks.push(m)}
  if(masks.length<3)return true;
  const iou=[];for(let k=1;k<masks.length;k++){let a=0,u=0;for(let i=0;i<masks[k].length;i++){const x=masks[k][i],y=masks[k-1][i];if(x&&y)a++;if(x||y)u++}iou.push(u?a/u:1)}
  iou.sort((a,b)=>a-b);return iou[Math.floor(iou.length/2)]>=0.55;
}
// Small pictures of every round kept on this PC (so the recording itself can be deleted): every 2 seconds from the barrier drop,
// the whole screen (small) + minimap + kill feed, 8 moments per image. Used later when a question needs to look at a round.
let SNAPS={};
const SN={cw:860,ch:216,cols:2,rows:4};
function snapStart(){return{cvs:[],n:0}}
function snapAdd(sn,round,sec){
  try{
    const per=SN.cols*SN.rows,k=sn.n%per;
    if(k===0){const c=document.createElement("canvas");c.width=SN.cols*SN.cw;c.height=SN.rows*SN.ch;const x=c.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,c.width,c.height);sn.cvs.push(c)}
    const c=sn.cvs[sn.cvs.length-1],x=c.getContext("2d"),ox=(k%SN.cols)*SN.cw,oy=Math.floor(k/SN.cols)*SN.ch,W=video.videoWidth,H=video.videoHeight;
    x.drawImage(video,0,0,W,H,ox,oy,384,216);
    const mw=Math.round(216*W*MM.w/(H*MM.h));x.drawImage(video,W*MM.x,H*MM.y,W*MM.w,H*MM.h,ox+384,oy,Math.min(mw,216),216);
    x.drawImage(video,W*0.68,H*0.05,W*0.32,H*0.2,ox+600,oy,260,Math.round(260*H*0.2/(W*0.32)));
    x.fillStyle="#F2B33D";x.fillRect(ox,oy,118,22);x.fillStyle="#000";x.font="bold 15px monospace";x.textBaseline="top";x.fillText("R"+round+" "+Math.floor(sec/60)+":"+String(Math.round(sec%60)).padStart(2,"0"),ox+4,oy+3);
    sn.n++;
  }catch(e){}
}
async function snapEnd(sn){const out=[];for(const c of sn.cvs)out.push(await new Promise(r=>c.toBlob(r,"image/jpeg",0.72)));return out.filter(Boolean)}
async function readKit(segs,me,maps,known){
  const jobs=[];
  segs.forEach((rs,si)=>rs.forEach(r=>{
    if(r._st==null)return;
    const end=Math.min(r._next!=null?r._next-1:(r.plantAt!=null?r.plantAt+44:r._st+99),r._st+145,duration-0.3);
    // the player's own HUD only while we know they are alive (after death the HUD is a teammate's)
    const stop=r.myDead==null?null:r.myDead?Math.min(end,r._st+(r.myDeathT||0)-1):end;
    if(end>r._st+3)jobs.push({si,r,a:r._st+1,end,b:stop!=null&&stop>r._st+3?stop:null,died:!!r.myDead,me:me[si]});
  }));
  if(!jobs.length)return;
  // which horizontal scale fits the HUD (normal 16:9 or stretched 4:3)
  const probe=jobs.filter(j=>j.b!=null).slice(0,12).map(j=>j.a+4);let best=[-1,1];
  for(const kx of [1,4/3]){let n=0;for(const t of probe){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);if(kitNow(kx).ok)n++}if(n>best[0])best=[n,kx]}
  const hud=best[0]>=Math.max(2,probe.length*0.3);KIT_KX=best[1];
  const events=[],refs=[];let done=0;
  for(const j of jobs){
    prog(0.99,"ラウンドの流れとスキルを確認しています… ("+(++done)+"/"+jobs.length+"ラウンド)");
    const S=[];
    const snap=snapStart();
    for(let t=j.a;t<=j.end;t+=KSTEP){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(t);const al=aliveNow();S.push({t,us:al[0],en:al[1],...(hud&&j.b!=null&&t<=j.b?kitNow(KIT_KX):{ok:false,bars:[],held:null})});snapAdd(snap,j.r.n,t-j.r._st)}
    try{const blobs=await snapEnd(snap);if(blobs.length)((SNAPS[j.si]=SNAPS[j.si]||{})[j.r.n]=blobs)}catch(e){}
    j.S=S;
    // alive counts only go down in a round: accept a drop once it is seen twice in a row (or at the last look)
    const alv=[[0,5,5]];let cu=5,ce=5;
    for(let i=0;i<S.length;i++){const nx=S[i+1];
      const u=nx?Math.max(S[i].us,nx.us):S[i].us,e=nx?Math.max(S[i].en,nx.en):S[i].en;
      if(u<cu||e<ce){events.push({j,t:S[i].t,n:(cu-Math.min(cu,u))+(ce-Math.min(ce,e))});cu=Math.min(cu,u);ce=Math.min(ce,e);alv.push([Math.round(S[i].t-j.r._st),cu,ce])}}
    j.r.alv=alv;j.r.fights=[];
    const kr=known&&known[j.si]?(known[j.si].rounds||[]).find(x=>x.n===j.r.n):null;
    if(kr&&Array.isArray(kr.fights)){j.r.fights=kr.fights.map(f=>({...f}));events.splice(events.length-(alv.length-1),alv.length-1)}   // already read from a teammate's recording of the same match
    // a couple of moments per round where the player is alive in their own view: minimap + location name, for the reference sheet
    if(j.b!=null&&!(known&&known[j.si]))[8,24,40].forEach(d=>{if(j.a+d<=j.b)refs.push({si:j.si,t:j.a+d})});
    if(j.b==null||!hud)continue;
    const A=S.filter(x=>x.t<=j.b);
    for(let i=1;i<A.length-1;i++)if(A[i].ok&&A[i].held==null&&A[i-1].held!=null&&A[i-1].held===A[i+1].held)A[i].held=A[i-1].held;   // one missed look in the middle of a hold
    const V=A.filter(x=>x.ok);if(V.length<2)continue;
    const h=[0,0,0,0];let hn=0;V.forEach((x,i)=>{if(x.held!=null){h[x.held]+=KSTEP;if(i===0||V[i-1].held!==x.held)hn++}});
    const maj=(arr,f)=>arr.filter(f).length*2>arr.length;
    const head=V.slice(0,3),tail=V.slice(-2),last=V[V.length-1];
    const us=maj(head,x=>x.bars[3]===1);
    let uu=false;if(us)for(let i=1;i<V.length;i++){if(V[i].bars[3]===0&&(V[i+1]?V[i+1].bars[3]===0:true)){uu=true;break}}
    j.r.kit={al:Math.round(j.b-j.a+1),h,hn,lf:last.bars.slice(0,3),dead:j.died,us,uu,ud:j.died&&maj(tail,x=>x.bars[3]===1),k:null,ku:null};
  }
  const W=video.videoWidth,H=video.videoHeight;
  // 1) location names of the reference moments (cheap text reading), per map
  const refBy={};
  for(let i=0;i<refs.length;i+=30){
    const part=refs.slice(i,i+30);prog(0.993,"マップの場所の名前を読み取っています…");
    const blob=await gridOf(part,330,52,3,(x,ox,oy)=>x.drawImage(video,W*0.03,H*0.004,W*0.16,H*0.036,ox+34,oy+2,296,48));
    try{
      const r=await SAMPLE.json("Each numbered cell is the top-left corner of a VALORANT screen, where the game shows the name of the player's current location (e.g. 'A Main', 'Mid Courtyard', 'Defender Side Spawn'). Ignore any 'Client FPS' text. Copy the location name exactly as written for each cell (English or Japanese as shown), or \"-\" if there is none. Reply only JSON: {\"p\":[\"A Main\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"fast",task:"places"});
      const arr=Array.isArray(r.p)?r.p:[];
      part.forEach((c,k)=>{const v=String(arr[k]||"").trim().slice(0,40);if(!v||v==="-")return;const L=(refBy[c.si]=refBy[c.si]||new Map());const key=v.toLowerCase().replace(/\s+/g,"");if(!L.has(key))L.set(key,{t:c.t,name:v})});
    }catch(e){if(e&&e.code==="cancelled")throw e}
  }
  // 2) reference sheet per map: minimap with the player's own icon, labelled with the place name (drawn here, no AI)
  const sheetOf=async(si)=>{
    const L=[...((refBy[si]||new Map()).values())].slice(0,24);if(!L.length)return null;
    const s=170,ch=Math.round(s*H*MM.h/(W*MM.w))+22,cols=6,cv=document.createElement("canvas");cv.width=cols*s;cv.height=Math.ceil(L.length/cols)*ch;
    const x=cv.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);x.font="bold 14px sans-serif";x.textBaseline="top";
    for(let i=0;i<L.length;i++){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(L[i].t);const ox=(i%cols)*s,oy=Math.floor(i/cols)*ch;drawMM(x,ox,oy+22,s);x.fillStyle="#F2B33D";x.fillText(L[i].name.slice(0,22),ox+4,oy+4)}
    return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.85));
  };
  // 3) every death: minimap 2 s before / at the moment + kill feed -> who killed whom, and where (new X marker on the minimap)
  const bySeg={};events.forEach(e=>{(bySeg[e.j.si]=bySeg[e.j.si]||[]).push(e)});
  for(const si of Object.keys(bySeg)){
    const evs=bySeg[si],fixed=await mmFixed(evs.filter((_,k)=>k%Math.max(1,Math.floor(evs.length/10))===0).map(e=>e.t));
    const sheet=fixed?await sheetOf(+si):null;
    const names=sheet?[...refBy[si].values()].map(x=>x.name):[];
    const dict=window.TLKit&&maps&&maps[si]&&TLKit.CALLOUTS[maps[si]]?TLKit.CALLOUTS[maps[si]]:"";
    for(let i=0;i<evs.length;i+=36){
      const part=evs.slice(i,i+36),blobs=[];prog(0.996,"撃ち合いの場所と相手を読み取っています…("+Math.min(evs.length,i+36)+"/"+evs.length+")");
      const s=fixed?200:0,mh=fixed?Math.round(s*H*MM.h/(W*MM.w)):0;
      for(let g=0;g<part.length;g+=12){
        const cells=part.slice(g,g+12),cw=34+s+260,chh=Math.max(mh,120),cols=fixed?2:3,cv=document.createElement("canvas");cv.width=cols*cw;cv.height=Math.ceil(cells.length/cols)*chh;
        const x=cv.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);x.font="bold 18px monospace";x.textBaseline="top";
        for(let k=0;k<cells.length;k++){const c=cells[k],ox=(k%cols)*cw,oy=Math.floor(k/cols)*chh;
          if(fixed){
            await seek(Math.max(c.j.a,c.t-KSTEP));const before=mmPixels(s,mh);
            await seek(Math.min(c.j.end,c.t+KSTEP));const later=mmPixels(s,mh);
            await seek(c.t);const after=mmPixels(s,mh);drawMM(x,ox+34,oy,s);
            newMarks(before,after,s,mh,later).forEach(([px,py])=>{x.strokeStyle="#FF00FF";x.lineWidth=3;x.beginPath();x.arc(ox+34+px,oy+py,13,0,Math.PI*2);x.stroke()});
          }else await seek(c.t);
          x.drawImage(video,W*0.68,H*0.05,W*0.32,H*0.2,ox+34+s,oy,260,Math.round(260*H*0.2/(W*0.32)));
          x.fillStyle="#F2B33D";x.fillRect(ox,oy,34,24);x.fillStyle="#000";x.fillText(String(i+g+k+1),ox+4,oy+3)}
        blobs.push(await new Promise(r=>cv.toBlob(r,"image/jpeg",0.85)));
      }
      try{
        const r=await SAMPLE.json(!fixed?"Each numbered cell is the kill feed (top-right of a VALORANT screen) right after someone died. For each cell give the newest death(s): killer agent > victim agent (identify AGENTS from the portraits; names may be player names or hidden; green/teal entry = killer on the recording team, red = enemy). Reply only JSON, one list per cell in order (usually 1 death, sometimes 2): {\"f\":[[{\"k\":\"Jett\",\"v\":\"Sova\",\"g\":true}],[]]} (g = true if the killer is on the recording team; use \"?\" for anything you cannot tell).":(sheet?"Image 1 is a reference sheet from the SAME match: each tile is the minimap with the recording player's own icon, labelled with the name of the place where that player stood at that moment. ":"")+
          "The other images have numbered cells. Each cell shows the minimap and the kill feed (top-right of the screen) right after someone died. Each death leaves an X marker on the minimap (blue/teal X = a player of the recording team, red X = an enemy); a magenta circle marks where a NEW X appeared in the last 2 seconds (found automatically, it can be missing or slightly off: then use the newest kill feed entry and the X closest to it). "+
          "For each cell give the newest death(s): killer agent > victim agent (identify AGENTS from the kill feed portraits; green/teal entry = killer on the recording team, red = enemy), and the place of the NEW X marker (the circled one)"+(sheet?", named by comparing its position with the reference tiles (use those names; for a spot between tiles pick the nearest)":"")+(dict?". Known place names on this map: "+dict:"")+
          ". Reply only JSON, one list per cell in order (usually 1 death, sometimes 2): {\"f\":[[{\"k\":\"Jett\",\"v\":\"Sova\",\"g\":true,\"p\":\"A Main\"}],[]]} (g = true if the killer is on the recording team; use \"?\" for anything you cannot tell).",
          {images:(sheet?[sheet]:[]).concat(blobs),signal:ctl.signal,modelTier:"fast",task:"fights"});
        const arr=Array.isArray(r.f)?r.f:[];
        part.forEach((c,k)=>{const list=Array.isArray(arr[k])?arr[k]:[];list.slice(0,Math.max(1,c.n)+1).forEach(e=>{if(!e||typeof e!=="object")return;
          const f={t:Math.round(c.t-c.j.r._st),k:String(e.k||"?").slice(0,20),v:String(e.v||"?").slice(0,20),g:e.g===true?true:e.g===false?false:null,p:String(e.p||"?").slice(0,40)};
          if(!fixed)f.p="?";f._t=c.t;
          if(!c.j.r.fights.some(x=>agentKey(x.v)===agentKey(f.v)&&agentKey(f.v)))c.j.r.fights.push(f)})});
      }catch(e){if(e&&e.code==="cancelled")throw e}
    }
  }
  // the recording player's own fights: the place is the location name the game shows for them (exact, even with a rotating minimap)
  const own=[];
  for(const j of jobs){if(!j.me||j.b==null)continue;const mine=agentKey(j.me);(j.r.fights||[]).forEach(f=>{if(f._t==null)return;
    if(f.g!==false&&agentKey(f.k)===mine&&f._t<=j.b+KSTEP)own.push({f,t:Math.min(f._t,j.b)});
    else if(agentKey(f.v)===mine)own.push({f,t:Math.max(j.a,j.b)})})}
  for(let i=0;i<own.length;i+=30){
    const part=own.slice(i,i+30);prog(0.998,"撃ち合いの場所を確認しています…");
    const blob=await gridOf(part,330,52,3,(x,ox,oy)=>x.drawImage(video,W*0.03,H*0.004,W*0.16,H*0.036,ox+34,oy+2,296,48));
    try{const r=await SAMPLE.json("Each numbered cell is the top-left corner of a VALORANT screen, where the game shows the name of the player's current location (e.g. 'A Main', 'Mid Courtyard'). Ignore any 'Client FPS' or 'Packet Loss' text. Copy the location name exactly as written for each cell, or \"-\" if there is none. Reply only JSON: {\"p\":[\"A Main\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"fast",task:"places"});
      const arr=Array.isArray(r.p)?r.p:[];part.forEach((c,k)=>{const v=String(arr[k]||"").trim().slice(0,40);if(v&&v!=="-")c.f.p=v});
    }catch(e){if(e&&e.code==="cancelled")throw e}
  }
  jobs.forEach(j=>(j.r.fights||[]).forEach(f=>{delete f._t}));
  // the recording player's kills (and kills while their ult was ready) from the fights
  for(const j of jobs){const kt=j.r.kit;if(!kt||!j.me)continue;const mine=agentKey(j.me);
    const ultAt=t=>{let v=null;for(const x of j.S)if(x.ok&&x.t<=j.r._st+t)v=x.bars[3]===1;return v};
    const ks=(j.r.fights||[]).filter(f=>f.g!==false&&agentKey(f.k)===mine);kt.k=ks.length;kt.ku=ks.filter(f=>ultAt(f.t)).length;
    const d=(j.r.fights||[]).find(f=>agentKey(f.v)===mine);if(d)kt.dp=d.p;kt.kp=ks.map(f=>f.p);
    delete j.S}
  jobs.forEach(j=>{delete j.S});
}
function markMine(segs,me){
  segs.forEach((rs,si)=>{const mine=agentKey(me[si]);rs.forEach(r=>{
    if(!mine||!r.fk||r.fk==="tie"){r.myFk=null;r.myFd=null;return}
    const k=agentKey(r.fkBy),v=agentKey(r.fkVictim);
    r.myFk=r.fk==="us"?(k?k===mine:null):false;
    r.myFd=r.fk==="them"?(v?v===mine:null):false;
  })});
}
let lastErr=null;
// Free check on this PC for one frame: white digits of both scores (to notice a change) and the red spike icon.
const locCv=document.createElement("canvas");locCv.width=200;locCv.height=24;const locX=locCv.getContext("2d",{willReadFrequently:true});
function localSig(){
  const c=crop();locX.drawImage(video,c.sx,c.sy,c.sw,c.sh,0,0,200,24);const d=locX.getImageData(0,0,200,24).data;
  const reg=(x0,x1)=>{const v=[];for(let y=3;y<21;y++)for(let x=Math.round(x0*200);x<Math.round(x1*200);x++){const i=(y*200+x)*4,mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);v.push(mn>205&&mx-mn<35?100:0)}return v};
  let red=0,n=0;for(let y=0;y<24;y++)for(let x=76;x<124;x++){const i=(y*200+x)*4;n++;if(d[i]>160&&d[i+1]<80&&d[i+2]<90)red++}
  return{mL:reg(0.13,0.33),mR:reg(0.67,0.87),spike:red/n>0.06};
}
function sigDist(a,b){const f=(x,y)=>{let s=0;for(let i=0;i<x.length;i++)s+=Math.abs(x[i]-y[i]);return s/x.length};return Math.max(f(a.mL,b.mL),f(a.mR,b.mR))}
let lastReads=0;
// Read the score/timer tiles at the given times with the AI (52 tiles per image, up to 6 images per request, 3 requests at once)
async function readTimes(ts){
  const p=plan(),out=new Array(ts.length).fill(null),jobs=[];
  for(let c=0;c<ts.length;c+=PER_IMG*p.per){
    const part=ts.slice(c,c+PER_IMG*p.per),blobs=[];
    for(let i=0;i<part.length;i+=PER_IMG)blobs.push(await buildImage(part.slice(i,i+PER_IMG),i+1));
    const job=readTiles(blobs,1,part.length).catch(e=>{if(e&&e.code==="cancelled")throw e;if(e&&["not_granted","sampling_disabled","rate_limited","images_unavailable"].includes(e.code))throw e;return[]})
      .then(arr=>{part.forEach((_,k)=>out[c+k]=arr[k])});
    job.catch(()=>{});jobs.push(job);
    while(jobs.length-jobs.filter(j=>j.done).length>=3){await Promise.race(jobs.filter(j=>!j.done).map(j=>j.then(()=>{j.done=true},()=>{j.done=true})))}
  }
  await Promise.all(jobs);return out;
}
async function sparseScores(loc,readFn,onProg){
  const samples=[];
  // 2) Split into stretches where the score stays the same
  const segOf=new Array(loc.length).fill(0);let seg=0;
  for(let i=1;i<loc.length;i++){
    const d=sigDist(loc[i],loc[i-1]),nx=loc[i+1]?sigDist(loc[i+1],loc[i]):0;
    if(d>12&&nx<=8)seg++;            // changed, and stays like that
    segOf[i]=seg;
  }
  // 3) Ask the AI only about a few moments
  const reads=new Map();             // index -> parsed tile
  const want=new Set();
  const segIdx={};loc.forEach((x,i)=>{(segIdx[segOf[i]]=segIdx[segOf[i]]||[]).push(i)});
  Object.values(segIdx).forEach(ix=>{
    if(loc[ix[ix.length-1]].t-loc[ix[0]].t<16)return;   // too short to be a round (flicker, other screens)
    const t0=loc[ix[0]].t,t1=loc[ix[ix.length-1]].t;
    for(let t=t0+44;t<=t1;t+=100){let k=ix.find(i=>loc[i].t>=t&&!loc[i].spike);if(k==null)k=ix[Math.floor(ix.length/2)];want.add(k)}
    if(t1-t0<44)want.add(ix[Math.floor(ix.length/2)]);
  });
  for(let i=1;i<loc.length;i++)if(loc[i].spike&&!loc[i-1].spike)want.add(i-1);   // just before the plant: the timer tells when it was planted
  // never leave more than ~90 seconds without any reading (in case the PC check is confused, e.g. bright backgrounds)
  {const all=[...want].sort((x,y)=>x-y);let last=-1e9;for(let i=0;i<loc.length;i++){if(all.includes(i)){last=loc[i].t;continue}if(loc[i].t-last>=90&&!loc[i].spike){want.add(i);last=loc[i].t}}}
  const readNow=async(label)=>{
    const ix=[...want].filter(i=>!reads.has(i)).sort((x,y)=>x-y);want.clear();if(!ix.length)return 0;
    onProg(label+"("+ix.length+"コマ)");
    const res=await readFn(ix.map(i=>loc[i].t));ix.forEach((i,k)=>reads.set(i,parseTile(res[k])));return ix.length;
  };
  await readNow("AIが要所の画面を読み取っています…");
  // 4) Check: a round can only add 1 point. If two readings jump more, or a round has no usable timer, read a little more.
  for(let pass=0;pass<8;pass++){
    const ok=[...reads.entries()].filter(([i,r])=>r.L!=null&&r.R!=null).sort((x,y)=>x[0]-y[0]);
    for(let k=1;k<ok.length;k++){
      const [ia,a]=ok[k-1],[ib,b]=ok[k];if(ib-ia<2)continue;
      const ta=a.L+a.R,tb=b.L+b.R,reset=tb===0&&ta>=3;
      const unfinished=reset&&Math.max(a.L,a.R)<13;                    // new map, but the last one did not reach 13 yet: maybe its last rounds were not read
      const jump=unfinished||(!reset&&(tb-ta>1||b.L<a.L||b.R<a.R));  // rounds skipped (or a new map whose 0-0 was not read yet)
      const missed=!reset&&tb-ta===1&&segOf[ia]===segOf[ib]&&loc[ib].t-loc[ia].t>24;   // a change the PC check did not see: find roughly where
      if(jump||missed){   // read the middle of the widest stretch between ia and ib that has no reading yet (closest to ib first)
        const rr=[];for(let i=ia;i<=ib;i++)if(reads.has(i))rr.push(i);let g=null;
        for(let q=rr.length-1;q>0;q--){if(rr[q]-rr[q-1]>1&&(!g||rr[q]-rr[q-1]>g[1]-g[0]))g=[rr[q-1],rr[q]]}
        if(g){let m=Math.floor((g[0]+g[1])/2);if(loc[m].spike){for(let i=g[0]+1;i<g[1];i++)if(!loc[i].spike){m=i;break}}want.add(m)}
      }
    }
    Object.values(segIdx).forEach(ix=>{
      if(loc[ix[ix.length-1]].t-loc[ix[0]].t<60)return;
      const rs=ix.filter(i=>reads.has(i)),good=rs.some(i=>{const x=reads.get(i).x;return typeof x==="number"&&x>30&&x<=100});
      if(good||!rs.some(i=>reads.get(i).L!=null))return;
      const last=Math.max(...rs),nt=loc[last].t+30,k=ix.find(i=>loc[i].t>=nt&&!loc[i].spike&&!reads.has(i));if(k!=null)want.add(k);
    });
    if(!(await readNow("念のため、もう少し読み取っています…")))break;
  }
  // 5) Give every sample a score. Between two readings with different scores, put the change where it most likely happened:
  //    the timer of the later reading tells when its round started (more reliable), otherwise the biggest change of the score digits on screen.
  const okR=[...reads.entries()].filter(([i,r])=>r.L!=null&&r.R!=null).sort((x,y)=>x[0]-y[0]);
  const sc=new Array(loc.length).fill(null);
  if(okR.length){
    for(let i=okR[0][0];i<loc.length;i++)sc[i]=okR[okR.length-1][1];
    for(let k=0;k<okR.length;k++){
      const [ia,a]=okR[k],nx=okR[k+1];
      if(!nx){for(let i=ia;i<loc.length;i++)sc[i]=a;break}
      const [ib,b]=nx;let cut=ib;                                  // first index that gets the score of b
      if(a.L!==b.L||a.R!==b.R){
        let byTimer=null;
        if(typeof b.x==="number"&&b.x>30&&b.x<=100){const change=loc[ib].t-(100-b.x)-30-5;for(let i=ia+1;i<=ib;i++)if(loc[i].t>=change){byTimer=i;break}}
        if(byTimer!=null)cut=byTimer;
        else{let best=-1;for(let i=ia+1;i<=ib;i++){const d=sigDist(loc[i],loc[i-1]);if(d>best){best=d;cut=i}}}
      }
      for(let i=ia;i<ib;i++)sc[i]=i<cut?a:b;
    }
  }
  loc.forEach((l,i)=>{
    const own=reads.get(i),x=own&&own.x!=null?own.x:(l.spike?"S":null);
    samples.push({t:l.t,L:sc[i]?sc[i].L:null,R:sc[i]?sc[i].R:null,x,ai:!!own});
  });
  return{samples,reads:reads.size};
}
async function firstError(list){for(const x of list){if(!x.fin)continue;try{await x.job}catch(e){return e}}return null}
async function runAnalysis(){
  if(!duration)return false;
  ctl=new AbortController();$("go").disabled=true;$("stop").hidden=false;$("result").hidden=true;
  const p=plan(),times=[];for(let i=0;i<p.n;i++)times.push(3+i*p.iv);
  const samples=[];lastErr=null;SNAPS={};
  try{
    prog(0,"VALORANTの動画か確認しています…");
    const g=await isValorant();
    if(!g.ok){lastErr={code:"not_valorant",message:"VALORANTの動画ではないため、読み込みませんでした"+(g.what?"("+g.what+")":"")+"。"};prog(0,lastErr.message);return false}
    // 1) Look at every sample on this PC (free): has the score changed? is the spike icon (red) shown instead of the timer?
    const loc=[];
    for(let i=0;i<times.length;i++){
      if(ctl.signal.aborted)throw{code:"cancelled"};
      if(i%10===0)prog(i/times.length*0.75,"録画を確認しています… "+fmt(times[i])+" / "+fmt(duration));
      await seek(times[i]);loc.push({t:times[i],...localSig()});
    }
    const sp=await sparseScores(loc,readTimes,(m)=>prog(0.8,m));sp.samples.forEach(x=>samples.push(x));
    lastReads=sp.reads;
    if(!buildRounds(samples,"attack").some(rs=>rs.length)){lastErr={code:"no_rounds",message:"ラウンドを見つけられませんでした(試合の画面が映っていない録画かもしれません)。"};prog(0,lastErr.message);return false}
    prog(0.93,"エージェント構成を読み取っています…");
    const comps=await readComps();
    let segs=buildRounds(samples,"attack");
    prog(0.95,"攻守を判定しています…");
    const cands=[];segs.forEach((rs,si)=>rs.filter(r=>r.n<=3||(r.n>=13&&r.n<=15)).forEach(r=>cands.push({si,n:r.n,t:firstBuy(r,samples)})));
    const sides=await readSides(cands.slice(0,12));const votes={};
    cands.slice(0,12).forEach((c,k)=>{const v=sides[k];if(v==="attack"||v==="defense"){const st=startFrom(c.n,v);(votes[c.si]=votes[c.si]||{attack:0,defense:0})[st]++}});
    const starts=segs.map((rs,si)=>{const v=votes[si];if(v&&v.attack!==v.defense)return{side:v.attack>v.defense?"attack":"defense",auto:true};return{side:$("mSide").value,auto:false}});
    segs=buildRounds(samples,"attack").map((rs,si)=>rs.map(r=>({...r,side:sideOf(r.n,starts[si].side)})));
    prog(0.96,"ファーストキルを読み取っています…");
    await readFirstKills(segs,samples);
    prog(0.97,"設置したサイトを読み取っています…");
    const pc=[];segs.forEach((rs,si)=>rs.forEach((r,ri)=>{if(r.plantAt!=null)pc.push({si,ri,t:Math.min(duration-0.2,r.plantAt+4)})}));
    const sites=await readSites(pc);pc.forEach((c,k)=>{segs[c.si][c.ri].site=sites[k]||null});
    prog(0.99,"マップと、配信者のエージェントを確認しています…");
    const mm=await readMaps(segs),maps=mm.maps,me=mm.me;markMine(segs,me);
    await readMyDeaths(segs,me);
    let known=[];try{known=await knownMatches(segs,maps)}catch(e){known=[]}
    await readKit(segs,me,maps,known);
    segs.forEach(rs=>rs.forEach(r=>{delete r._st;delete r._next}));
    prog(1,"完了しました");
    lastResult={snaps:SNAPS,segs,comps,starts,maps,me,samples:samples.length,read:samples.filter(s=>s.L!=null).length};
    showResult();
    return true;
  }catch(e){
    const msg=e&&e.code==="cancelled"?"止めました。":e&&e.code==="not_granted"?"AIの利用が許可されなかったため、分析できません。":e&&e.code==="rate_limited"?"AIの利用回数の上限に達しました。しばらく待ってからもう一度試してください。":e&&e.code==="images_unavailable"?"この環境では画像をAIに送れないため、分析できません。":"分析中に問題が起きました。もう一度試してください。";
    prog(0,msg);lastErr={code:e&&e.code||"error",message:msg};
    return false;
  }finally{$("go").disabled=false;$("stop").hidden=true}
}
$("go").onclick=()=>runAnalysis();
$("stop").onclick=()=>ctl&&ctl.abort();

function showResult(){
  const R=lastResult,box=$("result");box.hidden=false;box.replaceChildren();
  const rate=R.samples?Math.round(R.read/R.samples*100):0;
  if(!R.segs.length||!R.segs[0].length){box.append(h("div",{class:"status"},"ラウンドを見つけられませんでした(読み取れた画面 "+rate+"%)。手順3の切り抜きにスコアと残り時間が入っているか確認して、もう一度試してください。"));return}
  box.append(h("div",{class:"row"},h("span",{class:"pill win"},"読み取れた画面 "+rate+"%"),h("span",{class:"pill"},R.segs.length>1?R.segs.length+"マップ分":"1マップ"),
    R.comps.left.length?h("span",{class:"pill mute"},"自チーム:"+R.comps.left.join(" / ")):null,R.comps.right.length?h("span",{class:"pill mute"},"相手:"+R.comps.right.join(" / ")):null));
  R.segs.forEach((rs,si)=>{
    const w=rs.filter(r=>r.win===true).length,l=rs.filter(r=>r.win===false).length;
    box.append(h("h3",{style:"margin:6px 0 0;font:700 16px var(--f-display)"},(R.segs.length>1?"マップ"+(si+1)+" ・ ":"")+(R.maps&&R.maps[si]?(((window.TACLOG_MAPS||[]).find(m=>m[0]===R.maps[si])||[0,R.maps[si]])[1])+" ・ ":"")+rs.length+"ラウンド ・ "+w+"勝 "+l+"敗"+(rs.some(r=>r.win==null)?"(最後のラウンドは判定なし)":"")));
    box.append(h("div",{class:"tblbox"},h("table",{class:"tbl"},h("thead",{},h("tr",{},["R","攻守","結果","ファーストキル","設置","サイト","設置時の残り","動画の位置"].map(x=>h("th",{},x)))),
      h("tbody",{},rs.map(r=>h("tr",{},h("td",{class:"num"},r.n),h("td",{},sideJa(r.side)),h("td",{},r.win==null?h("span",{class:"pill mute"},"?"):r.win?h("span",{class:"pill win"},"勝ち"):h("span",{class:"pill loss"},"負け")),
        h("td",{},(r.fk==="us"?"自チーム":r.fk==="them"?"相手":r.fk==="tie"?"同時":"—")+(r.fkBy?":"+r.fkBy+(r.fkVictim?"→"+r.fkVictim:""):"")+(r.myFk?" ★配信者":"")+(r.myFd?" ✕配信者":"")+(r.myDead===false?" ・配信者生存":r.myDead===true?" ・配信者"+r.myDeathT+"秒で死亡":"")),h("td",{},r.planted?(r.side==="attack"?"自チームが設置":"相手が設置"):"—"),h("td",{},r.site||"—"),h("td",{class:"num"},r.plant!=null?mmss(r.plant):"—"),h("td",{class:"num"},fmt(r.plantAt??r.start))))))));
  });
  if(R.segs.every(rs=>rs.every(r=>!r.fk)))box.append(h("div",{class:"notice"},"この録画ではファーストキルを読み取れませんでした。画面上の顔アイコン(生存状況)の位置がいつもと違う可能性があります。試合中の画面のスクリーンショットを1枚お問い合わせから送ってください。"));
  if(R.segs.length>1)box.append(h("p",{class:"small muted",style:"margin:0"},"途中でスコアが0-0に戻ったので、別のマップとして分けました。"));
  box.append(h("p",{class:"small muted",style:"margin:0"},"マップは録画のミニマップから自動で判定しました。違っていたら、保存後に試合チャンネルで直せます。設置時の残り時間は、読み取り間隔の半分くらいの誤差があります。ファーストキルは生存人数の変化から1秒単位で判定し、その瞬間のキルログから取った人を読んでいます。"+(R.starts&&R.starts.every(x=>x.auto)?" 攻守は画面の表示から自動で判定しました。":" 攻守を自動で判定できなかったマップは、手順2で選んだ「最初の攻守」を使っています。")));
  const save=h("button",{type:"button",class:"btn primary"},"この結果を保存する");
  save.onclick=async()=>{save.disabled=true;try{
    const sv=await saveLast({date:$("mDate").value,opp:$("mOpp").value.trim(),map:$("mMap").value,yt:$("mYt").value.trim()});
    save.textContent=sv&&sv.merged&&!sv.created?"同じ試合にまとめました(別の視点)":"保存しました";APP.reloadMatches();box.append(h("div",{class:"row"},h("a",{class:"btn",href:"#ask"},"AIに質問する →")))}catch(e){box.append(h("div",{class:"notice"},TL.errText(e)));save.disabled=false}};
  box.append(h("div",{class:"row"},save));
}


// Several players may record the same scrim from their own view. A recording whose rounds match a match already saved
// (same day ±1, same map or unknown, same round results) is attached to it as another point of view instead of a new match,
// so team numbers are counted once and each player's own numbers are kept per view (match_povs).
// A teammate may have analysed the same match already (date of the recording ±1 day, same map, same round results): its fights can be reused.
async function knownMatches(segs,maps){
  if(!curFile||!curFile.lastModified)return[];
  const d=new Date(curFile.lastModified),iso=x=>new Date(d.getTime()+x*864e5).toISOString().slice(0,10);
  const {data}=await TL.sb.from("matches").select("id,map,rounds").eq("team_id",APP.team.id).eq("game",APP.game||"valorant").gte("date",iso(-1)).lte("date",iso(1));
  return segs.map((rs,si)=>(data||[]).find(m=>(!maps[si]||!m.map||m.map===maps[si])&&sameMatch(m.rounds||[],rs)&&(m.rounds||[]).some(r=>Array.isArray(r.fights)&&r.fights.length))||null);
}
const resStr=rs=>rs.map(r=>r.win===true?"W":r.win===false?"L":"?").join("");
function sameMatch(a,b){ // a, b: round lists
  const A=resStr(a),B=resStr(b);if(Math.min(A.length,B.length)<6||Math.abs(A.length-B.length)>2)return false;
  let same=0,cmp=0;for(let i=0;i<Math.min(A.length,B.length);i++){if(A[i]==="?"||B[i]==="?")continue;cmp++;if(A[i]===B[i])same++}
  return cmp>=6&&same/cmp>=0.9;
}
const povRounds=rs=>rs.map(r=>({n:r.n,side:r.side,win:r.win,fk:r.fk??null,fkBy:r.fkBy??null,fkVictim:r.fkVictim??null,myFk:r.myFk??null,myFd:r.myFd??null,myDead:r.myDead??null,myDeathT:r.myDeathT??null,kit:r.kit??null,alv:r.alv??null,fights:r.fights??null}));
async function findSame(date,map,rs,part){
  if(!date)return null;
  const d=new Date(date+"T00:00:00"),iso=x=>new Date(d.getTime()+x*864e5).toISOString().slice(0,10);
  const {data}=await TL.sb.from("matches").select("id,map,rounds,part").eq("team_id",APP.team.id).eq("game",APP.game||"valorant").gte("date",iso(-1)).lte("date",iso(1));
  return (data||[]).find(m=>(!map||!m.map||m.map===map)&&sameMatch(m.rounds||[],rs))||null;
}
async function savePov(matchId,si,R){
  const {error}=await TL.sb.from("match_povs").insert({match_id:matchId,team_id:APP.team.id,agent:(R.me&&R.me[si])||"",file:fileName,rounds:povRounds(R.segs[si])});
  if(error&&!/match_povs/.test(error.message||""))throw error;   // before 007_match_povs.sql is run, just skip the per-view data
}
async function keepSnaps(matchId,si,R){try{if(window.TLSnaps&&R.snaps&&R.snaps[si])await TLSnaps.save(matchId,R.snaps[si])}catch(e){}}
async function saveLast(meta){
  const R=lastResult;if(!R||!R.segs.length||!R.segs[0].length)throw new Error("ラウンドを見つけられませんでした。");
  const out={created:0,merged:0};
  for(let si=0;si<R.segs.length;si++){
    const map=(si===0&&meta.map)?meta.map:((R.maps&&R.maps[si])||"");
    let same=null;try{same=await findSame(meta.date,map,R.segs[si],si+1)}catch(e){same=null}
    if(same){await savePov(same.id,si,R);await keepSnaps(same.id,si,R);out.merged++;continue}
    const{data,error}=await TL.sb.rpc("save_match",{t:APP.team.id,m:{date:meta.date||"",opp:meta.opp||"",map,start_side:(R.starts&&R.starts[si]?R.starts[si].side:$("mSide").value),yt:meta.yt||"",file:fileName,part:si+1,comps:{...R.comps,me:(R.me&&R.me[si])||null},rounds:R.segs[si]}});
    if(error)throw error;
    if(data){await savePov(data,si,R);await keepSnaps(data,si,R)}
    out.created++;
  }
  return out;
}
window.ANALYZER={loadFile,runAnalysis,saveLast,result:()=>lastResult,error:()=>lastErr,stop:()=>ctl&&ctl.abort()};

})();
