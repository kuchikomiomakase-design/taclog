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
  try{const r=await TL.api("/api/vision",{prompt,images,teamId:APP.team.id});return parseJSON(r.text)}catch(e){if(o.signal&&o.signal.aborted)throw{code:"cancelled"};throw{code:e.code||"upstream_error",message:e.message}}}};
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
$("iv").addEventListener("change",estimate);
const TILE_W=300,LABEL_W=46,COLS=4,ROWS=13,PER_IMG=COLS*ROWS;
function plan(){const iv=Number($("iv").value);const n=duration?Math.floor((duration-3)/iv):0;const imgs=Math.ceil(n/PER_IMG);const per=LIM&&LIM.images?Math.min(LIM.images.maxCount,6):6;return{iv,n,imgs,calls:Math.ceil(imgs/per),per}}
function estimate(){if(!duration){$("estimate").textContent="";return}const p=plan();$("estimate").textContent="動画 "+fmt(duration)+" ・ "+p.n+"か所を読み取ります(AIへの問い合わせ 約"+(p.calls+1)+"回)。";}
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
  const r=await SAMPLE.json(prompt,{images:blobs,signal:ctl.signal,modelTier:"default"});
  const arr=r&&Array.isArray(r.tiles)?r.tiles:[];return arr;
}
async function readComps(){
  const W=video.videoWidth,H=video.videoHeight,strip=document.createElement("canvas");strip.width=1400;const sh=Math.round(1400*(H*0.11)/W);strip.height=sh*3;const x=strip.getContext("2d");
  const ts=[0.15,0.45,0.75];for(let i=0;i<3;i++){await seek(duration*ts[i]);x.drawImage(video,0,0,W,H*0.11,0,i*sh,1400,sh)}
  const blob=await new Promise(r=>strip.toBlob(r,"image/jpeg",0.9));
  try{const r=await SAMPLE.json("These are three strips from the top of a VALORANT match screen. The top bar shows agent portraits: the player's team on the LEFT of the score and the enemy team on the RIGHT. Identify the agents (English agent names). Reply only JSON: {\"left\":[\"Jett\"],\"right\":[\"Sova\"]} with up to 5 names each; leave a list empty if you are not sure.",{images:[blob],signal:ctl.signal,modelTier:"default"});
    return{left:(r.left||[]).map(String).slice(0,5),right:(r.right||[]).map(String).slice(0,5)}}catch(e){if(e&&e.code==="cancelled")throw e;return{left:[],right:[]}}
}

function firstBuy(r,samples){const it=samples.filter(x=>x.t>=r.start&&typeof x.x==="number");return it.length?it[0].t:r.start+2}
async function gridOf(cells,cw,chh,cols,draw){const cv=document.createElement("canvas");const rows=Math.ceil(cells.length/cols);cv.width=cols*cw;cv.height=rows*chh;const x=cv.getContext("2d");x.fillStyle="#000";x.fillRect(0,0,cv.width,cv.height);x.font="bold 18px monospace";x.textBaseline="top";
  for(let i=0;i<cells.length;i++){if(ctl.signal.aborted)throw{code:"cancelled"};await seek(cells[i].t);const ox=(i%cols)*cw,oy=Math.floor(i/cols)*chh;draw(x,ox,oy);x.fillStyle="#F2B33D";x.fillRect(ox,oy,34,24);x.fillStyle="#000";x.fillText(String(i+1),ox+4,oy+3)}
  return await new Promise(r=>cv.toBlob(r,"image/jpeg",0.88))}
async function readSides(cands){
  if(!cands.length)return[];const W=video.videoWidth,H=video.videoHeight;
  const blob=await gridOf(cands,700,60,2,(x,ox,oy)=>x.drawImage(video,0,0,W*0.3,H*0.05,ox+36,oy,664,58));
  try{const r=await SAMPLE.json("Each numbered strip is the top-left corner of a VALORANT screen, where the current location name is shown (e.g. 'Attacker Side Spawn', 'Defender Side Spawn', 'A Site', or Japanese equivalents like アタッカー側スポーン / ディフェンダー側スポーン). For strips 1 to "+cands.length+" in order, output 'attack' if it says attacker side spawn, 'defense' if defender side spawn, otherwise '-'. Reply only JSON: {\"sides\":[\"defense\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"default"});return Array.isArray(r.sides)?r.sides:[]}catch(e){if(e&&e.code==="cancelled")throw e;return[]}
}
async function readSites(cells){
  const out=[];if(!cells.length)return out;const W=video.videoWidth,H=video.videoHeight;
  for(let i=0;i<cells.length;i+=20){const part=cells.slice(i,i+20);
    const blob=await gridOf(part,260,270,5,(x,ox,oy)=>x.drawImage(video,0,0,W*0.22,H*0.42,ox,oy,260,268));
    try{const r=await SAMPLE.json("Each numbered cell is the top-left of a VALORANT screen shortly after the spike was planted: the minimap (with site letters A, B, maybe C, and a spike/bomb marker) and the current location name above it (e.g. 'B Site'). For cells 1 to "+part.length+" in order, output the site letter where the spike was planted ('A','B' or 'C'), or '-' if you cannot tell. Reply only JSON: {\"sites\":[\"B\",\"-\"]}",{images:[blob],signal:ctl.signal,modelTier:"default"});
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
  segs.forEach((rs,si)=>rs.forEach((r,ri)=>{const next=rs[ri+1]?rs[ri+1].start:null;const st=roundStartOf(r,samples,next);if(st==null)return;
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
  const W=video.videoWidth,H=video.videoHeight,cells=[];
  segs.forEach((rs,si)=>rs.forEach((r,ri)=>{if(r.fkT!=null)cells.push({si,ri,t:Math.min(duration-0.2,r.fkT)})}));
  for(let i=0;i<cells.length;i+=16){
    const part=cells.slice(i,i+16);
    const blob=await gridOf(part,440,176,2,(x,ox,oy)=>x.drawImage(video,W*0.66,H*0.035,W*0.34,H*0.17,ox+36,oy,404,174));
    try{const r=await SAMPLE.json("Each numbered cell is the kill feed from the top-right of a VALORANT screen. In each entry the LEFT name/portrait is the killer and the RIGHT is the victim. A teal/green entry means the killer is on the player's team; a red entry means the killer is on the enemy team. For cells 1 to "+part.length+" in order, list every entry you can read. Reply only JSON: {\"cells\":[[{\"killer\":\"name\",\"victim\":\"name\",\"team\":\"us\"}],[]]} where team is \"us\" or \"them\". Use an empty list for a cell with no readable entry.",{images:[blob],signal:ctl.signal,modelTier:"default"});
      const arr=Array.isArray(r.cells)?r.cells:[];
      part.forEach((c,k)=>{const r0=segs[c.si][c.ri],list=Array.isArray(arr[k])?arr[k]:[];
        const want=r0.fk==="us"?"us":r0.fk==="them"?"them":null;
        const pick=list.filter(e=>e&&e.killer&&(!want||e.team===want));
        if(pick.length){const nm=String(pick[0].killer).slice(0,30);r0.fkBy=/^me$/i.test(nm.trim())?"Me(配信者)":nm;r0.fkVictim=String(pick[0].victim||"").slice(0,30);if(r0.fk==="tie")r0.fk=pick[0].team==="us"?"us":"them"}});
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
  const confirm=i=>{for(let j=i+1;j<Math.min(samples.length,i+4);j++){if(valid(j))return samples[j].L===samples[i].L&&samples[j].R===samples[i].R}return true};
  let seg=0;
  samples.forEach((s,i)=>{
    if(valid(i)){
      if(!cur){if(confirm(i))cur={L:s.L,R:s.R,seg}}
      else{const d=(s.L+s.R)-(cur.L+cur.R);
        if(d===1&&((s.L===cur.L+1&&s.R===cur.R)||(s.R===cur.R+1&&s.L===cur.L))&&confirm(i))cur={L:s.L,R:s.R,seg};
        else if(s.L+s.R===0&&cur.L+cur.R>=3&&confirm(i)){seg++;cur={L:0,R:0,seg}}}
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
  const r=await SAMPLE.json("These are 16 numbered frames taken at different times from ONE stream recording. Streamers often show the lobby for a long time, or switch to other screens (desktop, Discord, a 'be right back' screen, another app) for a while. Question: does ANY of the 16 frames show VALORANT (the Riot Games tactical shooter)? Count all of these as VALORANT: in-match gameplay (score and round timer at top center, minimap at top left), the VALORANT lobby/main menu, agent select, loading screen, the scoreboard or end-of-match screen. If even one frame is VALORANT, or you are not sure, answer true. Answer false only if you are confident that none of the frames is VALORANT. Reply only JSON: {\"valorant\":true,\"frames\":[numbers of VALORANT frames]} or {\"valorant\":false,\"what\":\"what the video shows, short, in Japanese\"}",{images:[blob],signal:ctl.signal,modelTier:"default"});
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
async function readMaps(segs){
  const keys=(window.TACLOG_MAPS||[]).map(m=>m[0]);if(!keys.length)return segs.map(()=>null);
  const W=video.videoWidth,H=video.videoHeight,out=[];
  for(const rs of segs){
    if(!rs.length){out.push(null);continue}
    const pick=[Math.floor(rs.length*0.25),Math.floor(rs.length*0.5),Math.floor(rs.length*0.75)].map(i=>rs[Math.min(i,rs.length-1)]);
    const cells=pick.map(r=>({t:Math.min(duration-0.2,r.start+35)}));
    try{const blob=await gridOf(cells,260,270,3,(x,ox,oy)=>x.drawImage(video,0,0,W*0.22,H*0.42,ox,oy,260,268));
      const r=await SAMPLE.json("Each numbered cell is the top-left of a VALORANT screen during a round: the minimap and the current location name (e.g. 'A Site', 'Mid Courtyard', or Japanese names). All cells are from the SAME map. Which VALORANT map is it? Choose one of: "+keys.join(", ")+". If you cannot tell, use \"-\". Reply only JSON: {\"map\":\"ascent\"}",{images:[blob],signal:ctl.signal,modelTier:"default"});
      const m=String(r&&r.map||"").toLowerCase().trim();out.push(keys.includes(m)?m:null)}catch(e){if(e&&e.code==="cancelled")throw e;out.push(null)}
  }
  return out;
}
let lastErr=null;
async function firstError(list){for(const x of list){if(!x.fin)continue;try{await x.job}catch(e){return e}}return null}
async function runAnalysis(){
  if(!duration)return false;
  ctl=new AbortController();$("go").disabled=true;$("stop").hidden=false;$("result").hidden=true;
  const p=plan(),times=[];for(let i=0;i<p.n;i++)times.push(3+i*p.iv);
  const samples=[];lastErr=null;
  try{
    prog(0,"VALORANTの動画か確認しています…");
    const g=await isValorant();
    if(!g.ok){lastErr={code:"not_valorant",message:"VALORANTの動画ではないため、読み込みませんでした"+(g.what?"("+g.what+")":"")+"。"};prog(0,lastErr.message);return false}
    const chunks=[];for(let i=0;i<times.length;i+=PER_IMG)chunks.push(times.slice(i,i+PER_IMG));
    let done=0;const pending=[];
    for(let c=0;c<chunks.length;c+=p.per){
      const group=chunks.slice(c,c+p.per),blobs=[];const from=c*PER_IMG+1;
      for(let gi=0;gi<group.length;gi++){prog((done)/times.length*0.9,"動画から画面を切り出しています… "+fmt(group[gi][0])+" / "+fmt(duration));blobs.push(await buildImage(group[gi],from+gi*PER_IMG));}
      const count=group.reduce((a,x)=>a+x.length,0),to=from+count-1;
      // send to AI in the background and keep cutting out the next frames (up to 3 requests at once)
      const job=readTiles(blobs,from,to).catch(e=>{if(e&&e.code==="cancelled")throw e;if(e&&["not_granted","sampling_disabled","rate_limited","images_unavailable"].includes(e.code))throw e;return[]});
      job.catch(()=>{});pending.push({job,from,count});
      done+=count;
      while(pending.filter(x=>!x.fin).length>=3){await Promise.race(pending.filter(x=>!x.fin).map(x=>x.job.then(()=>{x.fin=true},()=>{x.fin=true})))}
      if(pending.some(x=>x.fin)){const bad=await firstError(pending);if(bad)throw bad}
    }
    prog(0.9,"AIが画面を読み取っています…");
    for(const pj of pending){const tiles=await pj.job;for(let k=0;k<pj.count;k++){const t=times[pj.from-1+k];samples.push({t,...parseTile(tiles[k])})}}
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
    prog(1,"完了しました");
    prog(0.99,"マップを確認しています…");
    const maps=await readMaps(segs);
    lastResult={segs,comps,starts,maps,samples:samples.length,read:samples.filter(s=>s.L!=null).length};
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
        h("td",{},(r.fk==="us"?"自チーム":r.fk==="them"?"相手":r.fk==="tie"?"同時":"—")+(r.fkBy?":"+r.fkBy:"")),h("td",{},r.planted?(r.side==="attack"?"自チームが設置":"相手が設置"):"—"),h("td",{},r.site||"—"),h("td",{class:"num"},r.plant!=null?mmss(r.plant):"—"),h("td",{class:"num"},fmt(r.plantAt??r.start))))))));
  });
  if(R.segs.every(rs=>rs.every(r=>!r.fk)))box.append(h("div",{class:"notice"},"この録画ではファーストキルを読み取れませんでした。画面上の顔アイコン(生存状況)の位置がいつもと違う可能性があります。試合中の画面のスクリーンショットを1枚お問い合わせから送ってください。"));
  if(R.segs.length>1)box.append(h("p",{class:"small muted",style:"margin:0"},"途中でスコアが0-0に戻ったので、別のマップとして分けました。"));
  box.append(h("p",{class:"small muted",style:"margin:0"},"マップは録画のミニマップから自動で判定しました。違っていたら、保存後に試合チャンネルで直せます。設置時の残り時間は、読み取り間隔の半分くらいの誤差があります。ファーストキルは生存人数の変化から1秒単位で判定し、その瞬間のキルログから取った人を読んでいます。"+(R.starts&&R.starts.every(x=>x.auto)?" 攻守は画面の表示から自動で判定しました。":" 攻守を自動で判定できなかったマップは、手順2で選んだ「最初の攻守」を使っています。")));
  const save=h("button",{type:"button",class:"btn primary"},"この結果を保存する");
  save.onclick=async()=>{save.disabled=true;try{
    await saveLast({date:$("mDate").value,opp:$("mOpp").value.trim(),map:$("mMap").value,yt:$("mYt").value.trim()});
    save.textContent="保存しました";APP.reloadMatches();box.append(h("div",{class:"row"},h("a",{class:"btn",href:"#ask"},"AIに質問する →")))}catch(e){box.append(h("div",{class:"notice"},TL.errText(e)));save.disabled=false}};
  box.append(h("div",{class:"row"},save));
}


async function saveLast(meta){
  const R=lastResult;if(!R||!R.segs.length||!R.segs[0].length)throw new Error("ラウンドを見つけられませんでした。");
  for(let si=0;si<R.segs.length;si++){const{error}=await TL.sb.rpc("save_match",{t:APP.team.id,m:{date:meta.date||"",opp:meta.opp||"",map:(si===0&&meta.map)?meta.map:((R.maps&&R.maps[si])||""),start_side:(R.starts&&R.starts[si]?R.starts[si].side:$("mSide").value),yt:meta.yt||"",file:fileName,part:si+1,comps:R.comps,rounds:R.segs[si]}});if(error)throw error}
}
window.ANALYZER={loadFile,runAnalysis,saveLast,result:()=>lastResult,error:()=>lastErr,stop:()=>ctl&&ctl.abort()};

})();
