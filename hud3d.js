/* hud3d.js — HUD 3D de carretera para AutoBoard (Three.js). Carga perezosa: nada se descarga hasta HUD3D.init().
   Uso:  HUD3D.init({base:'hud3d/', host:document.getElementById('hud2wrap'), onSlow:function(fps){...}}).then(function(){ HUD3D.show(); });
         cada frame o cada GPS:  HUD3D.update({speed:km/h, head:grados, limit:90, road:'road'|'motorway', brake:bool, rain:bool, night:bool});
   Si init() falla (sin WebGL, sin red) o salta onSlow (FPS bajos sostenidos), la app debe volver a su HUD 2D. */
(function(){
'use strict';
var API={}, REAL={}, DUMMY={}, noop=function(){}, running=false, runT=0, slowN=0, slowCb=null, MINFPS=18, LOADCAR=null, inited=false;
function dummy(id){ if(!DUMMY[id]) DUMMY[id]={style:{},disabled:false,value:'#7d838c',textContent:'',innerHTML:'',onclick:null,classList:{toggle:noop,add:noop,remove:noop,contains:function(){return false;}},addEventListener:noop,click:noop}; return DUMMY[id]; }
function loadScript(url){ return new Promise(function(res,rej){ var s=document.createElement('script'); s.src=url; s.onload=res; s.onerror=function(){ rej(new Error('no se pudo cargar '+url)); }; document.head.appendChild(s); }); }
function boot(opts){
'use strict';

function $(id){ return REAL[id]||dummy(id); }
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

/* ---------- renderer / escena ---------- */
var canvas=$('gl'), stage=$('stage');
var renderer;
try{ renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true,powerPreference:'high-performance'}); }
catch(e){ throw new Error('WebGL no disponible: '+e.message); }
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.setClearColor(0x000000,0);
renderer.localClippingEnabled=true;                 // para la transición carretera -> autopista
var scene=new THREE.Scene();
var FOG_DAY=0x0c1a2e, FOG_NIGHT=0x04070d;
scene.fog=new THREE.Fog(FOG_DAY,30,92);
var camera=new THREE.PerspectiveCamera(48,1,0.1,200);
camera.position.set(0,2.1,7.6);

var hemi=new THREE.HemisphereLight(0xcfdcff,0x1b2434,1.05); scene.add(hemi);
var sun=new THREE.DirectionalLight(0xffffff,0.95); sun.position.set(-4,9,6); scene.add(sun);

/* ---------- parámetros ---------- */
var S0=-14, S1=96, STEP=1.4, COLS=8, PAT=12, GPAT=8;
var state={speed:80, k:0, kT:0, brake:false, rain:false, night:false, demo:false, D:0, quality:0, H:0, road:'road', limit:90};
var rows=Math.floor((S1-S0)/STEP)+1;
var tmp={x:0,z:0,th:0};
var lanes=[1.65], laneIdx=0, laneC=1.65, laneT=1.65, laneVel=0, OUTER=6.3;   // laneC: centro del carril del coche, en coordenadas de la vía

// punto de la carretera a distancia s (a lo largo) y u (lateral respecto al coche)
function roadPoint(s,u,out){
  var k=state.k, th=k*s, xc, zf;
  if(Math.abs(k)<1e-5){ xc=0; zf=s; } else { xc=(1-Math.cos(th))/k; zf=Math.sin(th)/k; }
  out.x=xc+u*Math.cos(th); out.z=-zf+u*Math.sin(th); out.th=th; return out;
}
function rnd(a,b){return a+Math.random()*(b-a);}

/* ---------- texturas ---------- */
function makeAsphaltTexture(sp){
  var CW=sp.CW, CH=1024, c=document.createElement('canvas'); c.width=CW; c.height=CH; var g=c.getContext('2d'), ppm=CW/sp.W, ppl=CH/PAT, i, x, y;
  g.fillStyle=sp.verge||sp.base; g.fillRect(0,0,CW,CH);
  if(sp.verge){ for(i=0;i<5000;i++){ g.fillStyle=Math.random()<0.5?'rgba(0,0,0,0.18)':'rgba(190,190,160,0.07)'; g.fillRect(rnd(0,CW),rnd(0,CH),rnd(1,3),rnd(1,3)); } }
  var ax0=sp.a0*ppm, ax1=sp.a1*ppm, area=(ax1-ax0)*CH;
  g.fillStyle=sp.base; g.fillRect(ax0,0,ax1-ax0,CH);
  for(i=0;i<Math.round(area/42);i++){ x=rnd(ax0,ax1); y=rnd(0,CH); g.fillStyle=Math.random()<0.55?'rgba(0,0,0,'+rnd(0.10,0.30)+')':'rgba(255,255,255,'+rnd(0.04,0.10)+')'; var sz=rnd(0.8,2.6); g.fillRect(x,y,sz,sz); }
  for(i=0;i<Math.round(area/9000);i++){ x=rnd(ax0,ax1); y=rnd(0,CH); var r=rnd(18,70), gr=g.createRadialGradient(x,y,0,x,y,r); gr.addColorStop(0,'rgba(0,0,0,0.12)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(x-r,y-r,r*2,r*2); }
  sp.tracks.forEach(function(m){ var cx=m*ppm, w=0.5*ppm, gr=g.createLinearGradient(cx-w,0,cx+w,0); gr.addColorStop(0,'rgba(0,0,0,0)'); gr.addColorStop(0.5,'rgba(0,0,0,0.20)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(cx-w,0,w*2,CH); });
  for(i=0;i<4;i++){ g.fillStyle='rgba(0,0,0,0.12)'; g.fillRect(rnd(ax0+10,ax1-80),rnd(0,CH-120),rnd(30,80),rnd(60,150)); }
  g.strokeStyle='rgba(0,0,0,0.38)'; g.lineWidth=1.2;
  for(i=0;i<5;i++){ x=rnd(ax0+10,ax1-10); y=rnd(0,CH); g.beginPath(); g.moveTo(x,y); for(var j=0;j<7;j++){ x+=rnd(-12,12); y+=rnd(8,26); g.lineTo(x,y); } g.stroke(); }
  sp.lines.forEach(function(L){ var cx=L.m*ppm, lw=L.w*ppm; g.fillStyle='#eef1f4';
    if(L.per){ var n=Math.round(PAT/L.per); for(var d=0;d<n;d++) g.fillRect(cx-lw/2, d*L.per*ppl, lw, L.on*ppl); } else g.fillRect(cx-lw/2,0,lw,CH);
    for(var q=0;q<110;q++){ g.fillStyle='rgba(30,34,42,'+rnd(0.25,0.6)+')'; g.fillRect(cx-lw/2+rnd(-1,lw),rnd(0,CH),rnd(1,lw*0.7),rnd(2,9)); } });   // desgaste de la pintura
  var t=new THREE.CanvasTexture(c); t.wrapS=THREE.ClampToEdgeWrapping; t.wrapT=THREE.RepeatWrapping; t.encoding=THREE.sRGBEncoding;
  t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy()); t.needsUpdate=true; return t;
}
function makeGrassTexture(){
  var c=document.createElement('canvas'); c.width=c.height=256; var g=c.getContext('2d'), i;
  g.fillStyle='#16241a'; g.fillRect(0,0,256,256);
  for(i=0;i<3500;i++){ g.fillStyle=Math.random()<0.5?'rgba(40,78,44,'+rnd(0.15,0.4)+')':'rgba(0,0,0,'+rnd(0.15,0.35)+')'; g.fillRect(rnd(0,256),rnd(0,256),rnd(1,3),rnd(1,4)); }
  g.fillStyle='rgba(0,0,0,0.10)'; g.fillRect(0,0,256,64); g.fillRect(0,128,256,64);
  var t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.needsUpdate=true; return t;
}
function makeRailTexture(){
  var c=document.createElement('canvas'); c.width=512; c.height=128; var g=c.getContext('2d');
  g.fillStyle='#3a4048'; [0,170.6,341.3].forEach(function(px){ g.fillRect(px+4,0,12,128); });
  g.fillStyle='#b9c0c8'; g.fillRect(0,10,512,52);
  g.fillStyle='rgba(0,0,0,0.28)'; g.fillRect(0,26,512,5); g.fillRect(0,44,512,5);
  g.fillStyle='rgba(255,255,255,0.35)'; g.fillRect(0,12,512,3);
  var t=new THREE.CanvasTexture(c); t.wrapS=THREE.RepeatWrapping; t.wrapT=THREE.ClampToEdgeWrapping; t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.needsUpdate=true; return t;
}
function makeConcreteTexture(){
  var c=document.createElement('canvas'); c.width=512; c.height=128; var g=c.getContext('2d'), i;
  g.fillStyle='#9a9ea5'; g.fillRect(0,0,512,128);
  for(i=0;i<1400;i++){ g.fillStyle=Math.random()<0.5?'rgba(0,0,0,0.10)':'rgba(255,255,255,0.08)'; g.fillRect(rnd(0,512),rnd(0,128),rnd(1,3),rnd(1,3)); }
  g.fillStyle='rgba(0,0,0,0.35)'; [0,170.6,341.3].forEach(function(px){ g.fillRect(px,0,3,128); });
  g.fillStyle='rgba(0,0,0,0.22)'; g.fillRect(0,96,512,32); g.fillStyle='rgba(255,255,255,0.14)'; g.fillRect(0,0,512,10);
  var t=new THREE.CanvasTexture(c); t.wrapS=THREE.RepeatWrapping; t.wrapT=THREE.ClampToEdgeWrapping; t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.needsUpdate=true; return t;
}
// carretera convencional: 1 carril por sentido, eje central discontinuo, líneas de borde continuas
var texRoad=makeAsphaltTexture({CW:1024,W:11.6,a0:1.5,a1:10.1,base:'#2a303b',verge:'#2e3529',tracks:[3.37,4.93,6.67,8.23],lines:[]});
// autopista: cada calzada con 2 carriles + arcén; asfalto MÁS OSCURO
var texMw=makeAsphaltTexture({CW:512,W:10.5,a0:0,a1:10.5,base:'#171b22',verge:null,tracks:[1.97,3.53,5.47,7.03],lines:[]});
var grassTex=makeGrassTexture(), railTex=makeRailTexture(), concTex=makeConcreteTexture();

/* ---------- cintas que se curvan con la carretera ---------- */
var ribbons=[], walls=[];
function makeRibbon(u0,u1,cols,repU,pat,mat,opt){
  opt=opt||{}; var geo=new THREE.BufferGeometry(), n=rows*(cols+1), pos=new Float32Array(n*3), uv=new Float32Array(n*2), nor=new Float32Array(n*3), idx=[], r, c, vi=0;
  for(r=0;r<rows;r++){ for(c=0;c<=cols;c++){ var s=S0+r*STEP; uv[vi*2]=(opt.flip?(1-c/cols):c/cols)*repU; uv[vi*2+1]=s/pat; nor[vi*3+1]=1; vi++; } }
  for(r=0;r<rows-1;r++){ for(c=0;c<cols;c++){ var a=r*(cols+1)+c, b=a+1, d=a+(cols+1), e=d+1; idx.push(a,d,b,b,d,e); } }
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv',new THREE.BufferAttribute(uv,2)); geo.setAttribute('normal',new THREE.BufferAttribute(nor,3)); geo.setIndex(idx);
  var m=new THREE.Mesh(geo,mat); m.frustumCulled=false; scene.add(m); var o={geo:geo,pos:pos,u0:u0,u1:u1,cols:cols,mesh:m,y:opt.y||0,lc:null,cloned:false}; ribbons.push(o); return o;
}
function makeWall(u,y0,y1,pat,mat){
  var geo=new THREE.BufferGeometry(), n=rows*2, pos=new Float32Array(n*3), uv=new Float32Array(n*2), nor=new Float32Array(n*3), idx=[], r;
  for(r=0;r<rows;r++){ var s=S0+r*STEP; uv[(r*2)*2]=s/pat; uv[(r*2)*2+1]=0; uv[(r*2+1)*2]=s/pat; uv[(r*2+1)*2+1]=1; nor[(r*2)*3]=nor[(r*2+1)*3]=(u<0?1:-1); }
  for(r=0;r<rows-1;r++){ var a=r*2, b=a+1, d=a+2, e=a+3; idx.push(a,d,b,b,d,e); }
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv',new THREE.BufferAttribute(uv,2)); geo.setAttribute('normal',new THREE.BufferAttribute(nor,3)); geo.setIndex(idx);
  var m=new THREE.Mesh(geo,mat); m.frustumCulled=false; scene.add(m); var o={geo:geo,pos:pos,u:u,y0:y0,y1:y1,mesh:m,lc:null,cloned:false}; walls.push(o); return o;
}
var matRoad=new THREE.MeshStandardMaterial({map:texRoad,roughness:0.92,metalness:0.0});
var matMw=new THREE.MeshStandardMaterial({map:texMw,roughness:0.92,metalness:0.0});
var grassMat=new THREE.MeshStandardMaterial({map:grassTex,roughness:1,metalness:0});
var railMat=new THREE.MeshStandardMaterial({map:railTex,alphaTest:0.5,side:THREE.DoubleSide,roughness:0.5,metalness:0.4});
var concMat=new THREE.MeshStandardMaterial({map:concTex,side:THREE.DoubleSide,roughness:0.9,metalness:0});
var capMat=new THREE.MeshStandardMaterial({color:0x8a8f96,roughness:0.9,metalness:0});

/* líneas pintadas: cintas de 20 cm de ancho (no dependen de la textura, que a ras de suelo se emborrona) */
var lineMat=new THREE.MeshBasicMaterial({color:0xf2f4f6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
var dashCache={}, dashTexList=[];
function dashMat(per,on){
  var key=per+'_'+on; if(dashCache[key]) return dashCache[key];
  var c=document.createElement('canvas'); c.width=8; c.height=1024; var g=c.getContext('2d'), ppl=1024/PAT; g.fillStyle='#ffffff';
  for(var d=0;d<Math.round(PAT/per);d++) g.fillRect(0,d*per*ppl,8,on*ppl);
  var t=new THREE.CanvasTexture(c); t.wrapS=THREE.ClampToEdgeWrapping; t.wrapT=THREE.RepeatWrapping; t.needsUpdate=true; dashTexList.push(t);
  var m=new THREE.MeshBasicMaterial({map:t,transparent:true,alphaTest:0.3,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}); dashCache[key]=m; return m;
}
function addLine(u,w,per,on){ return makeRibbon(u-w/2,u+w/2,1,1,PAT,per?dashMat(per,on):lineMat,{y:0.012}); }

var LAYINFO={road:{outer:6.3,lc:1.65},motorway:{outer:13.0,lc:8.25}};
var trans=null, planeNear=new THREE.Plane(new THREE.Vector3(0,0,1),0), planeFar=new THREE.Plane(new THREE.Vector3(0,0,-1),0);
function envAt(s){   // qué tipo de vía hay a s metros (durante la transición, delante del límite ya es la nueva)
  var tp=(trans&&s<trans.s)?trans.oldType:state.road, li=LAYINFO[tp];
  return {type:tp,outer:li.outer,lc:(tp===state.road)?laneC:(trans?trans.oldLc:li.lc)};
}
function disposeSet(rs,ws){
  var i; for(i=0;i<rs.length;i++){ scene.remove(rs[i].mesh); rs[i].geo.dispose(); if(rs[i].cloned) rs[i].mesh.material.dispose(); }
  for(i=0;i<ws.length;i++){ scene.remove(ws[i].mesh); ws[i].geo.dispose(); if(ws[i].cloned) ws[i].mesh.material.dispose(); }
}
function clearLayout(){ disposeSet(ribbons,walls); ribbons.length=0; walls.length=0; }
function finishTrans(){
  if(!trans) return; disposeSet(trans.oldR,trans.oldW);
  var all=ribbons.concat(walls), i; for(i=0;i<all.length;i++){ if(all[i].cloned){ all[i].mesh.material.clippingPlanes=null; all[i].mesh.material.needsUpdate=true; } }
  trans=null;
}
function applyPlanes(){ if(trans){ planeNear.constant=trans.s; planeFar.constant=-trans.s; } }
function buildLayout(type,smooth){
  finishTrans();
  var oldR=null, oldW=null, oldType=state.road, lc0=laneC, i, all;
  if(smooth){
    oldR=ribbons.slice(); oldW=walls.slice(); ribbons.length=0; walls.length=0; all=oldR.concat(oldW);
    for(i=0;i<all.length;i++){ all[i].lc=lc0; all[i].cloned=true; all[i].mesh.material=all[i].mesh.material.clone(); all[i].mesh.material.clippingPlanes=[planeNear]; }   // lo viejo: solo lo que queda detrás del límite
  } else clearLayout();
  state.road=type;
  if(type==='motorway'){
    OUTER=13.0; lanes=[4.75,8.25];
    makeRibbon(2.0,12.5,COLS,1,PAT,matMw);                       // nuestra calzada: arcén izq. 1 m + 2 carriles + arcén dcho. 2,5 m
    makeRibbon(-12.5,-2.0,COLS,1,PAT,matMw,{flip:true});         // calzada contraria (espejo)
    addLine(3.0,0.2); addLine(10.0,0.2); addLine(6.5,0.18,6,2.5);      // nuestra: borde izq., borde dcho., divisoria discontinua
    addLine(-3.0,0.2); addLine(-10.0,0.2); addLine(-6.5,0.18,6,2.5);   // la contraria
    makeRibbon(-2.0,2.0,2,1,GPAT,grassMat);                       // mediana
    makeWall(-0.35,0,0.85,12,concMat); makeWall(0.35,0,0.85,12,concMat);   // barrera de hormigón central
    makeRibbon(-0.35,0.35,1,1,GPAT,capMat,{y:0.85});
    makeRibbon(12.5,46.5,4,34/GPAT,GPAT,grassMat,{y:-0.01}); makeRibbon(-46.5,-12.5,4,34/GPAT,GPAT,grassMat,{y:-0.01});
    makeWall(13.0,0,0.8,12,railMat); makeWall(-13.0,0,0.8,12,railMat);
  } else {
    OUTER=6.3; lanes=[1.65];
    makeRibbon(-5.8,5.8,COLS,1,PAT,matRoad);                      // 2 carriles: el nuestro a la derecha, el contrario a la izquierda
    addLine(-3.3,0.2); addLine(3.3,0.2); addLine(0,0.18,12,3.5);  // bordes continuos + eje central discontinuo
    makeRibbon(5.8,39.8,4,34/GPAT,GPAT,grassMat,{y:-0.01}); makeRibbon(-39.8,-5.8,4,34/GPAT,GPAT,grassMat,{y:-0.01});
    makeWall(6.3,0,0.8,12,railMat); makeWall(-6.3,0,0.8,12,railMat);
  }
  laneIdx=lanes.length-1; laneT=lanes[laneIdx]; laneC=laneT;
  if(smooth){
    all=ribbons.concat(walls);
    for(i=0;i<all.length;i++){ all[i].cloned=true; all[i].mesh.material=all[i].mesh.material.clone(); all[i].mesh.material.clippingPlanes=[planeFar]; }   // lo nuevo: solo lo que queda delante
    trans={s:88,oldR:oldR,oldW:oldW,oldType:oldType,oldLc:lc0,to:type}; applyPlanes();
  }
}
function updRibbon(o){
  var lc=(o.lc!==null?o.lc:laneC), r, c, vi=0;
  for(r=0;r<rows;r++){ var s=S0+r*STEP; for(c=0;c<=o.cols;c++){ var u=o.u0+(o.u1-o.u0)*c/o.cols-lc; roadPoint(s,u,tmp); o.pos[vi*3]=tmp.x; o.pos[vi*3+1]=o.y; o.pos[vi*3+2]=tmp.z; vi++; } }
  o.geo.attributes.position.needsUpdate=true;
}
function updWall(o){
  var lc=(o.lc!==null?o.lc:laneC), r;
  for(r=0;r<rows;r++){ var s2=S0+r*STEP; roadPoint(s2,o.u-lc,tmp); o.pos[(r*2)*3]=tmp.x; o.pos[(r*2)*3+1]=o.y0; o.pos[(r*2)*3+2]=tmp.z; o.pos[(r*2+1)*3]=tmp.x; o.pos[(r*2+1)*3+1]=o.y1; o.pos[(r*2+1)*3+2]=tmp.z; }
  o.geo.attributes.position.needsUpdate=true;
}
function updateRoad(){
  var i;
  for(i=0;i<ribbons.length;i++) updRibbon(ribbons[i]); for(i=0;i<walls.length;i++) updWall(walls[i]);
  if(trans){ for(i=0;i<trans.oldR.length;i++) updRibbon(trans.oldR[i]); for(i=0;i<trans.oldW.length;i++) updWall(trans.oldW[i]); }
  texRoad.offset.y=(state.D/PAT)%1; texMw.offset.y=(state.D/PAT)%1; grassTex.offset.y=(state.D/GPAT)%1; railTex.offset.x=(state.D/12)%1; concTex.offset.x=(state.D/12)%1;
  for(i=0;i<dashTexList.length;i++) dashTexList[i].offset.y=(state.D/PAT)%1;
}

/* ---------- entorno: terreno, árboles, farolas y montañas ---------- */
var FOGC_DAY=new THREE.Color(FOG_DAY), FOGC_NIGHT=new THREE.Color(FOG_NIGHT);
var ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshStandardMaterial({color:0x0b141a,roughness:1,metalness:0}));
ground.rotation.x=-Math.PI/2; ground.position.y=-0.05; scene.add(ground);

// árboles: SOLO en autopista y pocos (14)
var NTREE=14, LTREE=S1-S0-10, trees=[], treeLow, treeUp, treeDummy=new THREE.Object3D();
(function(){ var lowG=new THREE.ConeGeometry(1.5,3.4,6), upG=new THREE.ConeGeometry(1.05,2.8,6);
  treeLow=new THREE.InstancedMesh(lowG,new THREE.MeshStandardMaterial({color:0x173522,roughness:1}),NTREE);
  treeUp=new THREE.InstancedMesh(upG,new THREE.MeshStandardMaterial({color:0x1d4129,roughness:1}),NTREE);
  treeLow.frustumCulled=false; treeUp.frustumCulled=false; scene.add(treeLow); scene.add(treeUp);
  for(var i=0;i<NTREE;i++){ trees.push({b:(i/NTREE)*LTREE+rnd(0,3), side:(i%2?1:-1), off:rnd(8,30), sc:rnd(0.8,1.6), rot:rnd(0,6.28)}); } })();
function updateTrees(){
  var vis=state.quality<2; treeLow.visible=vis; treeUp.visible=vis; if(!vis)return;
  for(var i=0;i<NTREE;i++){ var t=trees[i], s=S0+5+(((t.b-state.D)%LTREE)+LTREE)%LTREE, env=envAt(s), k=(env.type==='motorway')?t.sc:0.0001;
    roadPoint(s,t.side*(env.outer+t.off)-env.lc,tmp);
    treeDummy.position.set(tmp.x,1.7*k,tmp.z); treeDummy.rotation.set(0,t.rot,0); treeDummy.scale.setScalar(k); treeDummy.updateMatrix(); treeLow.setMatrixAt(i,treeDummy.matrix);
    treeDummy.position.y=(1.7+2.3)*k; treeDummy.updateMatrix(); treeUp.setMatrixAt(i,treeDummy.matrix); }
  treeLow.instanceMatrix.needsUpdate=true; treeUp.instanceMatrix.needsUpdate=true;
}

// edificios: SOLO en carretera de 2 carriles y pocos (7): casas, un bloque y una nave
var BT=[{n:4,w:9,d:8,h:5.2,rh:2.6,pyr:true,wall:'#e4d6bb',roof:0x9a4a32,cols:3,rows:2},
        {n:2,w:12,d:10,h:14,rh:0,pyr:false,wall:'#c3c7cd',roof:0x6c7076,cols:4,rows:5},
        {n:1,w:22,d:13,h:6.5,rh:0,pyr:false,wall:'#adb3b9',roof:0x5b6168,cols:6,rows:2}];
function winTexture(cols,rws,wall,lit){
  var c=document.createElement('canvas'); c.width=c.height=256; var g=c.getContext('2d'); g.fillStyle=lit?'#000000':wall; g.fillRect(0,0,256,256);
  var cw=256/cols, rh=256/rws, i, j;
  for(i=0;i<cols;i++) for(j=0;j<rws;j++){ var x=i*cw+cw*0.22, y=j*rh+rh*0.2, w=cw*0.56, h=rh*0.55;
    if(lit){ if(Math.random()<0.45){ g.fillStyle='#ffd58a'; g.fillRect(x,y,w,h); } } else { g.fillStyle='#2b3a52'; g.fillRect(x,y,w,h); g.fillStyle='rgba(255,255,255,0.18)'; g.fillRect(x,y,w,h*0.3); } }
  var t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.needsUpdate=true; return t;
}
var bGroups=[], bAll=[], bDummy=new THREE.Object3D(), bMats=[];
(function(){
  BT.forEach(function(T,ti){
    var geo=new THREE.BoxGeometry(T.d,T.h,T.w), mat=new THREE.MeshStandardMaterial({map:winTexture(T.cols,T.rows,T.wall,false),emissiveMap:winTexture(T.cols,T.rows,T.wall,true),emissive:0xffffff,emissiveIntensity:0,roughness:0.9,metalness:0});
    bMats.push(mat);
    var body=new THREE.InstancedMesh(geo,mat,T.n), rgeo, rmat=new THREE.MeshStandardMaterial({color:T.roof,roughness:0.95});
    if(T.pyr){ rgeo=new THREE.ConeGeometry(0.7071,1,4); rgeo.rotateY(Math.PI/4); } else { rgeo=new THREE.BoxGeometry(1,0.3,1); }
    var roof=new THREE.InstancedMesh(rgeo,rmat,T.n); body.frustumCulled=false; roof.frustumCulled=false; scene.add(body); scene.add(roof);
    for(var k=0;k<T.n;k++) bAll.push({T:T,k:k,body:body,roof:roof}); bGroups.push({body:body,roof:roof});
  });
  var order=bAll.slice(), i, j, t0; for(i=order.length-1;i>0;i--){ j=Math.floor(Math.random()*(i+1)); t0=order[i]; order[i]=order[j]; order[j]=t0; }
  order.forEach(function(B,n){ B.b=(n/order.length)*LTREE+rnd(0,6); B.side=(n%2?1:-1); B.off=rnd(6,20); });
})();
function updateBuildings(){
  var vis=state.quality<2, q;
  for(q=0;q<bGroups.length;q++){ bGroups[q].body.visible=vis; bGroups[q].roof.visible=vis; } if(!vis) return;
  for(var n=0;n<bAll.length;n++){ var B=bAll[n], T=B.T, s=S0+5+(((B.b-state.D)%LTREE)+LTREE)%LTREE, env=envAt(s), sc=(env.type==='road')?1:0.0001;
    roadPoint(s,B.side*(env.outer+B.off+T.d/2)-env.lc,tmp);
    bDummy.position.set(tmp.x,T.h/2*sc,tmp.z); bDummy.rotation.set(0,-tmp.th,0); bDummy.scale.set(sc,sc,sc); bDummy.updateMatrix(); B.body.setMatrixAt(B.k,bDummy.matrix);
    if(T.pyr){ bDummy.position.set(tmp.x,(T.h+T.rh/2)*sc,tmp.z); bDummy.scale.set(sc*T.d*1.08,sc*T.rh,sc*T.w*1.08); }
    else { bDummy.position.set(tmp.x,(T.h+0.15)*sc,tmp.z); bDummy.scale.set(sc*(T.d+0.5),sc,sc*(T.w+0.5)); }
    bDummy.updateMatrix(); B.roof.setMatrixAt(B.k,bDummy.matrix); }
  for(q=0;q<bGroups.length;q++){ bGroups[q].body.instanceMatrix.needsUpdate=true; bGroups[q].roof.instanceMatrix.needsUpdate=true; }
}

// farolas (lado derecho): luz cálida y mancha de luz en el asfalto solo de noche
var NLAMP=4, LAMPGAP=36, lamps=[];
(function(){ var poleG=new THREE.CylinderGeometry(0.07,0.1,7.2,6), armG=new THREE.BoxGeometry(2.3,0.08,0.08), headG=new THREE.BoxGeometry(0.62,0.12,0.26),
    poleM=new THREE.MeshStandardMaterial({color:0x5b636d,roughness:0.7,metalness:0.4}), headM=new THREE.MeshStandardMaterial({color:0x22262b,emissive:0xffd9a0,emissiveIntensity:0,roughness:0.5});
  var gc=document.createElement('canvas'); gc.width=gc.height=128; var gx=gc.getContext('2d'), gr=gx.createRadialGradient(64,64,0,64,64,64); gr.addColorStop(0,'rgba(255,214,150,0.9)'); gr.addColorStop(1,'rgba(255,214,150,0)'); gx.fillStyle=gr; gx.fillRect(0,0,128,128);
  var glowM=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(gc),transparent:true,opacity:0.5,depthWrite:false,blending:THREE.AdditiveBlending,fog:true});
  for(var i=0;i<NLAMP;i++){ var g=new THREE.Group(), pole=new THREE.Mesh(poleG,poleM), arm=new THREE.Mesh(armG,poleM), head=new THREE.Mesh(headG,headM), glow=new THREE.Mesh(new THREE.PlaneGeometry(11,11),glowM);
    pole.position.y=3.6; arm.position.set(-1.1,7.1,0); head.position.set(-2.2,7.05,0); glow.rotation.x=-Math.PI/2; glow.position.set(-7.9,0.03,0);
    g.add(pole); g.add(arm); g.add(head); g.add(glow); scene.add(g); lamps.push({g:g,head:head,glow:glow,m:headM}); } })();
function updateLamps(){
  var off=state.D%LAMPGAP;
  for(var n=0;n<lamps.length;n++){ var L=lamps[n], s=n*LAMPGAP-off-LAMPGAP*0.5; if(s<S0+4||s>S1-10){ L.g.visible=false; continue; } L.g.visible=true; var env=envAt(s), mw=(env.type==='motorway'); roadPoint(s,(mw?0:env.outer+1.3)-env.lc,tmp); L.g.position.set(tmp.x,0,tmp.z); L.g.rotation.y=-tmp.th; L.g.scale.x=mw?-1:1; L.glow.visible=state.night&&state.quality<2; }
}

// panorama de montañas (gira con el rumbo acumulado: la sensación de que el mapa gira)
var mountains=(function(){
  var W=2048,H=256,c=document.createElement('canvas'); c.width=W; c.height=H; var g=c.getContext('2d'), i, x;
  function ridge(base,amp,col,seed){ g.fillStyle=col; g.beginPath(); g.moveTo(0,H); for(x=0;x<=W;x+=8){ var a=x/W*Math.PI*2, y=base-amp*(0.55*Math.sin(a*3+seed)+0.3*Math.sin(a*7+seed*2.1)+0.18*Math.sin(a*13+seed*0.7)+0.1*Math.sin(a*29+seed*1.3)); g.lineTo(x,y); } g.lineTo(W,H); g.closePath(); g.fill(); }
  ridge(150,40,'#13233a',1.0); ridge(176,30,'#0f1b2e',3.7);
  var hz=g.createLinearGradient(0,150,0,H); hz.addColorStop(0,'rgba(12,26,46,0)'); hz.addColorStop(0.85,'rgba(12,26,46,1)'); g.fillStyle=hz; g.fillRect(0,150,W,H-150);
  var t=new THREE.CanvasTexture(c); t.wrapS=THREE.RepeatWrapping; t.encoding=THREE.sRGBEncoding; t.needsUpdate=true;
  var m=new THREE.Mesh(new THREE.CylinderGeometry(160,160,60,48,1,true),new THREE.MeshBasicMaterial({map:t,side:THREE.BackSide,transparent:true,fog:false,depthWrite:false}));
  m.position.y=26; m.renderOrder=-1; m.frustumCulled=false; scene.add(m); return m; })();

/* ---------- señales verticales ---------- */
var signs=[], signTex={}, signTint=1;
var poleMat=new THREE.MeshStandardMaterial({color:0x7b838c,roughness:0.6,metalness:0.5});
function signTexture(kind,val){
  var key=kind+'_'+val; if(signTex[key]) return signTex[key];
  var c=document.createElement('canvas'); c.width=c.height=256; var g=c.getContext('2d');
  function tri(){ g.lineJoin='round'; g.fillStyle='#d4141c'; g.strokeStyle='#d4141c'; g.lineWidth=14; g.beginPath(); g.moveTo(128,16); g.lineTo(240,214); g.lineTo(16,214); g.closePath(); g.fill(); g.stroke();
    g.fillStyle='#ffffff'; g.beginPath(); g.moveTo(128,62); g.lineTo(206,196); g.lineTo(50,196); g.closePath(); g.fill(); }
  if(kind==='speed'){
    g.fillStyle='#d4141c'; g.beginPath(); g.arc(128,128,122,0,6.2832); g.fill(); g.fillStyle='#ffffff'; g.beginPath(); g.arc(128,128,92,0,6.2832); g.fill();
    g.fillStyle='#111111'; g.textAlign='center'; g.textBaseline='middle'; g.font='bold '+(String(val).length>2?'88':'108')+'px Arial, Helvetica, sans-serif'; g.fillText(String(val),128,138);
  } else if(kind==='curve'){
    tri(); g.save(); if(val==='L'){ g.translate(256,0); g.scale(-1,1); }
    g.strokeStyle='#111'; g.fillStyle='#111'; g.lineWidth=15; g.lineCap='round'; g.beginPath(); g.moveTo(104,188); g.lineTo(104,140); g.quadraticCurveTo(104,100,146,96); g.stroke();
    g.beginPath(); g.moveTo(166,96); g.lineTo(138,76); g.lineTo(138,116); g.closePath(); g.fill(); g.restore();
  } else if(kind==='round'){
    tri(); g.strokeStyle='#111'; g.fillStyle='#111'; g.lineWidth=11; g.lineCap='round';
    for(var a=0;a<3;a++){ var a0=a*2.0944+0.35, a1=a0+1.35; g.beginPath(); g.arc(128,138,36,a0,a1); g.stroke(); var ex=128+36*Math.cos(a1), ey=138+36*Math.sin(a1), tx=-Math.sin(a1), ty=Math.cos(a1);
      g.beginPath(); g.moveTo(ex+tx*16,ey+ty*16); g.lineTo(ex-ty*13-tx*3,ey+tx*13-ty*3); g.lineTo(ex+ty*13-tx*3,ey-tx*13-ty*3); g.closePath(); g.fill(); }
  } else if(kind==='blue'){
    g.fillStyle='#ffffff'; g.fillRect(6,6,244,244); g.fillStyle='#0a4aa8'; g.fillRect(16,16,224,224);
    g.strokeStyle='#ffffff'; g.lineWidth=10; g.lineCap='round'; g.beginPath(); g.moveTo(84,176); g.lineTo(116,70); g.moveTo(172,176); g.lineTo(140,70); g.stroke();
    g.lineWidth=7; g.beginPath(); g.moveTo(128,172); g.lineTo(128,150); g.moveTo(128,128); g.lineTo(128,106); g.stroke();
    g.fillStyle='#ffffff'; g.textAlign='center'; g.textBaseline='middle'; g.font='bold 33px Arial, Helvetica, sans-serif'; g.fillText(String(val||'AUTOPISTA'),128,208);
  }
  var t=new THREE.CanvasTexture(c); t.encoding=THREE.sRGBEncoding; t.anisotropy=4; t.needsUpdate=true; signTex[key]=t; return t;
}
function spawnSign(kind,val,ahead){
  ahead=ahead||85; var i, sg;
  for(i=0;i<signs.length;i++){ sg=signs[i]; if(sg.kind===kind&&sg.val===val&&Math.abs((sg.s0-(state.D-sg.D0))-ahead)<45) return; }   // sin duplicados
  var mw=state.road==='motorway', size=(kind==='blue'?1.55:(mw?1.3:1.0)), h=2.2+size*0.4;
  var g=new THREE.Group(), pole=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,h,6),poleMat); pole.position.y=h/2;
  var pm=new THREE.MeshBasicMaterial({map:signTexture(kind,val),transparent:true,alphaTest:0.08,fog:true}); pm.color.setRGB(signTint,signTint,signTint);
  var plate=new THREE.Mesh(new THREE.PlaneGeometry(size,size),pm); plate.position.set(0,h-size*0.25+0.12,0.06);
  g.add(pole); g.add(plate); scene.add(g); signs.push({g:g,kind:kind,val:val,D0:state.D,s0:ahead,u:OUTER+0.9,mat:pm,layout:state.road,lc0:laneC});
}
function clearSigns(){ for(var i=0;i<signs.length;i++){ scene.remove(signs[i].g); } signs.length=0; }
function updateSigns(){
  for(var i=signs.length-1;i>=0;i--){ var sg=signs[i], s=sg.s0-(state.D-sg.D0);
    if(s<S0+0.5){ scene.remove(sg.g); signs.splice(i,1); continue; }
    roadPoint(s,sg.u-(sg.layout===state.road?laneC:sg.lc0),tmp); sg.g.position.set(tmp.x,0,tmp.z); sg.g.rotation.y=-tmp.th; }
}

/* ---------- coche ---------- */
var onCarReady=function(){}, onCarFail=function(){};
var yawG=new THREE.Group(); scene.add(yawG);
var rollG=new THREE.Group(); rollG.rotation.order='ZXY'; yawG.add(rollG);
var carHolder=new THREE.Group(); carHolder.rotation.y=Math.PI; rollG.add(carHolder); // el modelo mira a +z; la cámara mira a -z
var wheels=[], bodyMats=[], tailMat=null, carReady=false, wheelMarkers=[], interiorMeshes=[], triCount=0;
function countTris(){ var n=0; carHolder.traverse(function(o){ if(o.isMesh&&o.visible&&o.geometry){ n+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3; } }); triCount=n; }

// sombra "blob" bajo el coche
(function(){ var c=document.createElement('canvas'); c.width=c.height=128; var g=c.getContext('2d'); var gr=g.createRadialGradient(64,64,6,64,64,62); gr.addColorStop(0,'rgba(0,0,0,0.65)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(0,0,128,128);
  var t=new THREE.CanvasTexture(c); var m=new THREE.Mesh(new THREE.PlaneGeometry(2.9,5.6),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}));
  m.rotation.x=-Math.PI/2; m.position.y=0.015; yawG.add(m); })();

function b64ToBuf(b64){ var bin=atob(b64), n=bin.length, u=new Uint8Array(n); for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i); return u.buffer; }
/*LOAD_START*/
function loadCar(buf){ new THREE.GLTFLoader().parse(buf,'',function(gltf){
  var model=gltf.scene; model.updateMatrixWorld(true);
  var byMat={}; model.traverse(function(o){ if(o.isMesh){ (byMat[o.material.name]=byMat[o.material.name]||[]).push(o); } });
  function first(n){ return byMat[n]&&byMat[n][0]; }
  // materiales: sin mapa de entorno los metales salen negros -> bajamos la metalicidad
  Object.keys(byMat).forEach(function(n){ var m=byMat[n][0].material; if(m.metalness>0.35) m.metalness=0.35; });
  if(first('carpaint')){ var cp=first('carpaint').material; cp.metalness=0.15; cp.roughness=0.28; bodyMats.push(cp); }
  if(first('RedLight')){ tailMat=first('RedLight').material; tailMat.emissive=new THREE.Color(0xff0000); tailMat.emissiveIntensity=0.35; }
  ['glass','glassDark'].forEach(function(n){ var o=first(n); if(o){ var m=o.material; m.transparent=true; m.opacity=(n==='glass'?0.38:0.6); m.depthWrite=false; m.roughness=0.05; } });
  ['GlossyInterior','LightGrayInterior','interiorGray','BlackSuade','Wood'].forEach(function(n){ (byMat[n]||[]).forEach(function(o){ interiorMeshes.push(o); }); });

  // las 4 ruedas vienen fundidas en una sola malla (neumáticos) y otra (llantas): las separamos por cuadrante
  var tireM=first('TireRubber'), rimM=first('Tire_Rims');
  var wheelData=null;
  if(tireM&&rimM){
    var tg=tireM.geometry.clone(); tg.applyMatrix4(tireM.matrixWorld); var rg=rimM.geometry.clone(); rg.applyMatrix4(rimM.matrixWorld);
    tg.computeBoundingBox(); var tb=tg.boundingBox, zMid=(tb.min.z+tb.max.z)/2;
    var split=function(g){ var pos=g.attributes.position, nor=g.attributes.normal, idx=g.index, nt=(idx?idx.count:pos.count)/3, bk=[[],[],[],[]], t, i0, i1, i2, q;
      for(t=0;t<nt;t++){ i0=idx?idx.getX(t*3):t*3; i1=idx?idx.getX(t*3+1):t*3+1; i2=idx?idx.getX(t*3+2):t*3+2;
        var cx=(pos.getX(i0)+pos.getX(i1)+pos.getX(i2))/3, cz=(pos.getZ(i0)+pos.getZ(i1)+pos.getZ(i2))/3; q=(cx<0?0:1)+(cz<zMid?0:2); bk[q].push(i0,i1,i2); }
      return bk.map(function(list){ var n=list.length, P=new Float32Array(n*3), N=new Float32Array(n*3), k; for(k=0;k<n;k++){ P[k*3]=pos.getX(list[k]); P[k*3+1]=pos.getY(list[k]); P[k*3+2]=pos.getZ(list[k]); if(nor){ N[k*3]=nor.getX(list[k]); N[k*3+1]=nor.getY(list[k]); N[k*3+2]=nor.getZ(list[k]); } }
        var bg=new THREE.BufferGeometry(); bg.setAttribute('position',new THREE.BufferAttribute(P,3)); if(nor) bg.setAttribute('normal',new THREE.BufferAttribute(N,3)); return bg; }); };
    var tq=split(tg), rq=split(rg); wheelData=[];
    for(var q=0;q<4;q++){ tq[q].computeBoundingBox(); var b=tq[q].boundingBox; var cx=(b.min.x+b.max.x)/2, cy=(b.min.y+b.max.y)/2, cz=(b.min.z+b.max.z)/2, gy=b.min.y, rad=(b.max.y-b.min.y)/2;
      tq[q].translate(-cx,-cy,-cz); rq[q].translate(-cx,-cy,-cz);
      var wg=new THREE.Group(); wg.position.set(cx,cy,cz); wg.add(new THREE.Mesh(tq[q],tireM.material)); wg.add(new THREE.Mesh(rq[q],rimM.material)); model.add(wg);
      wheelData.push({g:wg,rad:rad,cx:cx,cz:cz,ground:gy,rear:cz<zMid}); }
    [tireM,rimM].forEach(function(o){ o.parent.remove(o); o.geometry.dispose(); });
  }
  model.updateMatrixWorld(true);
  // normalizar: ancho 1,95 m, apoyado en el suelo, centrado
  var box=new THREE.Box3().setFromObject(model,true), sc=1.95/(box.max.x-box.min.x);
  var ground=wheelData?wheelData[0].ground:box.min.y;
  var norm=new THREE.Group(); norm.scale.setScalar(sc); norm.position.set(-sc*(box.min.x+box.max.x)/2,-sc*ground,-sc*(box.min.z+box.max.z)/2);
  norm.add(model); carHolder.add(norm);
  if(wheelData){ wheelData.forEach(function(w){ wheels.push({o:w.g,r:w.rad*sc,axis:'x'});
      if(w.rear){ var mk=new THREE.Object3D(); mk.position.set(w.cx,w.ground,w.cz); mk.userData.side=w.cx<0?-1:1; model.add(mk); wheelMarkers.push(mk); } }); }
  setBodyColor($('col').value); countTris();
  var bi=$('bInt'); bi.style.display=''; bi.onclick=function(){ var on=interiorMeshes[0]?!interiorMeshes[0].visible:true; interiorMeshes.forEach(function(o){ o.visible=on; }); bi.textContent='Interior: '+(on?'sí':'no'); bi.classList.toggle('on',!on); countTris(); };
  window.__sim={model:model,norm:norm,wheels:wheels,markers:wheelMarkers,interior:interiorMeshes};
  carReady=true; $('msg').style.display='none'; onCarReady();
},function(err){ $('msg').textContent='Error al leer el modelo 3D: '+(err&&err.message||err); onCarFail(err); }); }
LOADCAR=loadCar;
/*LOAD_END*/

function setBodyColor(hex){ for(var i=0;i<bodyMats.length;i++) bodyMats[i].color.set(hex); }
$('col').addEventListener('input',function(e){ setBodyColor(e.target.value); });

/* ---------- faros (noche) ---------- */
var heads=[];
[-0.68,0.68].forEach(function(x){ var sp=new THREE.SpotLight(0xfff3d6,0,48,0.55,0.7,1.2); sp.position.set(x,0.75,-2.0); var tg=new THREE.Object3D(); tg.position.set(x*1.1,0,-22); rollG.add(sp); rollG.add(tg); sp.target=tg; heads.push(sp); });

/* ---------- lluvia 2D + salpicadura (proyectada sobre las ruedas) ---------- */
var rainC=$('rain'), rainX=rainC.getContext('2d'), drops=null, splash=[];
function resizeAll(){
  var w=stage.clientWidth, h=stage.clientHeight, pr=[Math.min(2,window.devicePixelRatio||1),1,0.75][state.quality];
  if(!w||!h) return;                                  // contenedor aún oculto o sin tamaño: no tocar (aspect sería NaN)
  renderer.setPixelRatio(pr); renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
  rainC.width=w; rainC.height=h;
}
window.addEventListener('resize',resizeAll);
function drawRain(dt){
  var W=rainC.width,H=rainC.height; rainX.clearRect(0,0,W,H); if(!state.rain)return;
  if(!drops){ drops=[]; for(var i=0;i<110;i++) drops.push({x:Math.random(),y:Math.random(),l:0.02+Math.random()*0.05,s:0.7+Math.random()*0.9}); }
  rainX.strokeStyle='rgba(180,200,230,.45)'; rainX.lineWidth=1.5; var slant=0.16;
  for(var n=0;n<drops.length;n++){ var d=drops[n]; d.y+=d.s*dt*1.7; d.x+=slant*d.s*dt*0.3; if(d.y>1.05){d.y=-0.05;d.x=Math.random();} var x=d.x*W,y=d.y*H,len=d.l*H; rainX.beginPath(); rainX.moveTo(x,y); rainX.lineTo(x-slant*len,y+len); rainX.stroke(); }
  // salpicadura desde las ruedas traseras reales (proyección 3D -> pantalla)
  if(carReady && wheelMarkers.length && state.speed>15 && splash.length<180){
    var cnt=Math.min(5,1+Math.round(state.speed/28)), v=new THREE.Vector3();
    for(var w=0;w<wheelMarkers.length;w++){ wheelMarkers[w].getWorldPosition(v); v.project(camera); var sx=(v.x*0.5+0.5)*W, sy=(-v.y*0.5+0.5)*H, side=wheelMarkers[w].userData.side;
      for(var k=0;k<cnt;k++) splash.push({x:sx,y:sy,vx:side*(8+Math.random()*28),vy:-(16+Math.random()*42),life:0.38+Math.random()*0.32,t:0,sz:1+Math.random()*1.8}); } }
  for(var i2=splash.length-1;i2>=0;i2--){ var p=splash[i2]; p.t+=dt; if(p.t>=p.life){splash.splice(i2,1);continue;} p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=280*dt; var a=(1-p.t/p.life)*0.5; rainX.fillStyle='rgba(205,218,238,'+a.toFixed(3)+')'; rainX.beginPath(); rainX.arc(p.x,p.y,p.sz,0,Math.PI*2); rainX.fill(); }
}

/* ---------- día / noche ---------- */
function setNight(n){
  state.night=n; $('bDay').classList.toggle('on',!n); $('bNight').classList.toggle('on',n);
  hemi.intensity=n?0.28:1.05; sun.intensity=n?0.10:0.95; scene.fog.color.setHex(n?FOG_NIGHT:FOG_DAY);
  stage.style.filter=n?'brightness(.85)':'none';
  mountains.material.color.setRGB(n?0.33:1,n?0.27:1,n?0.28:1);
  for(var li=0;li<lamps.length;li++) lamps[li].m.emissiveIntensity=n?2.2:0;
  for(var bi=0;bi<bMats.length;bi++) bMats[bi].emissiveIntensity=n?1.0:0;
  signTint=n?0.62:1; for(var si=0;si<signs.length;si++) signs[si].mat.color.setRGB(signTint,signTint,signTint);
  for(var i=0;i<heads.length;i++) heads[i].intensity=n?2.4:0;
}
function setWet(){ [matRoad,matMw].forEach(function(m){ m.roughness=state.rain?0.38:0.92; m.metalness=state.rain?0.22:0; m.color.setRGB(state.rain?0.72:1,state.rain?0.76:1,state.rain?0.82:1); }); }

/* ---------- giro del coche a partir del rumbo (GPS / mapa) ---------- */
// El mapa del Tesla gira (rumbo arriba). Aquí convertimos la velocidad de cambio de rumbo en una curvatura MUY suave
// que dobla la carretera y hace que el coche entre en curva: k = (°/s del rumbo) / velocidad, con zona muerta, tope y ganancia baja.
var GPS_GAIN=0.55, GPS_KMAX=0.018, GPS_DEAD=0.012;      // ganancia, tope (1/m) y zona muerta (rad/s ≈ 0,7°/s)
var gps={head:null,t:0,rate:0,age:99}, mode='manual', simT=0, simAcc=0, watchId=null, lastFix=null;
function feedHeading(headDeg,tSec){
  if(gps.head===null){ gps.head=headDeg; gps.t=tSec; gps.age=0; return; }
  var dt=tSec-gps.t;
  if(dt>=0.3){                                   // el giro se mide cada ≥0,3 s: vale tanto 1 Hz (GPS) como cada frame (rumbo del mapa)
    if(dt<6){ var d=((headDeg-gps.head+540)%360)-180, r=d*Math.PI/180/dt; gps.rate+=(r-gps.rate)*0.5; }
    gps.head=headDeg; gps.t=tSec;
  }
  gps.age=0;
}
var KEYS=[[0,0],[4,0],[10,75],[16,75],[19,75],[24,25],[30,25],[34,25],[40,-20],[46,-20],[52,40],[58,40],[64,0],[70,0]];   // rumbo simulado del mapa
function simHeading(t){ t=t%70; for(var i=0;i<KEYS.length-1;i++){ var a=KEYS[i], b=KEYS[i+1]; if(t>=a[0]&&t<b[0]){ var f=(t-a[0])/(b[0]-a[0]); f=f*f*(3-2*f); return a[1]+(b[1]-a[1])*f; } } return 0; }
function bearingDeg(a,b){ var r=Math.PI/180, y=Math.sin((b.longitude-a.longitude)*r)*Math.cos(b.latitude*r), x=Math.cos(a.latitude*r)*Math.sin(b.latitude*r)-Math.sin(a.latitude*r)*Math.cos(b.latitude*r)*Math.cos((b.longitude-a.longitude)*r); return (Math.atan2(y,x)/r+360)%360; }
function distMeters(a,b){ var r=Math.PI/180, dx=(b.longitude-a.longitude)*r*Math.cos(a.latitude*r)*6371000, dy=(b.latitude-a.latitude)*r*6371000; return Math.sqrt(dx*dx+dy*dy); }
function gpsInfo(t){ $('gpsInfo').textContent=t; }
function onFix(p){
  var c=p.coords, t=p.timestamp/1000, hd=c.heading, sp=c.speed;
  if((hd===null||isNaN(hd)) && lastFix && distMeters(lastFix,c)>4){ hd=bearingDeg(lastFix,c); }
  if(!lastFix || distMeters(lastFix,c)>4) lastFix={latitude:c.latitude,longitude:c.longitude};
  if(sp!==null&&!isNaN(sp)){ setSpeed(Math.min(200,sp*3.6)); }
  if(hd!==null&&!isNaN(hd)&&(sp===null||isNaN(sp)||sp>1.5)) feedHeading(hd,t);
}
function stopWatch(){ if(watchId!==null&&navigator.geolocation){ navigator.geolocation.clearWatch(watchId); } watchId=null; $('spdS').disabled=false; }
function setMode(m){
  mode=m; ['mM','mS','mR'].forEach(function(id){ $(id).classList.remove('on'); }); var mb={manual:'mM',sim:'mS',real:'mR'}[m]; if(mb)$(mb).classList.add('on');
  stopWatch(); gps.head=null; gps.rate=0; gps.age=99; simT=0; simAcc=0; lastFix=null; gpsInfo('');
  if(m==='manual'){ state.kT=0; }
  if(m==='sim'){ gpsInfo('rumbo del mapa simulado'); }
  if(m==='real'){
    if(!navigator.geolocation){ gpsInfo('este navegador no tiene GPS'); setMode('manual'); return; }
    if(state.demo){ state.demo=false; $('bDemo').textContent='▶ Demo'; $('bDemo').classList.remove('on'); }
    $('spdS').disabled=true; gpsInfo('esperando GPS… (necesita https y moverte)');
    watchId=navigator.geolocation.watchPosition(onFix,function(e){ gpsInfo('GPS: '+(e&&e.message||'error')); },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }
}
function gpsStep(dt){
  if(mode==='manual') return;
  var v=state.speed/3.6;
  if(mode==='sim'){ simT+=dt; simAcc+=dt; if(simAcc>=1){ simAcc-=1; feedHeading((simHeading(simT)+(Math.random()-0.5)*2.4+360)%360,simT); } }
  gps.age+=dt; if(gps.age>2.5) gps.rate*=Math.max(0,1-dt*1.5);               // sin rumbos nuevos, el giro se relaja solo
  var rate=Math.abs(gps.rate)<GPS_DEAD?0:gps.rate;
  state.kT=(v>2.5)?clamp(rate/v*GPS_GAIN,-GPS_KMAX,GPS_KMAX):0;
  updCurLabel(); $('curS').value=Math.round(state.kT/0.0002);
  if(gps.head!==null) gpsInfo('rumbo '+Math.round(gps.head)+'° · giro '+(gps.rate*180/Math.PI).toFixed(1)+'°/s');
}

/* ---------- vía y límite de velocidad ---------- */
function setLimit(n,announce){
  state.limit=n; $('limN').textContent=n; $('limN').style.fontSize=String(n).length>2?'19px':'24px'; $('limS').value=String(n);
  if(announce!==false) spawnSign('speed',n,85);
}
function setRoadType(t,announce,smooth){
  if(t===state.road) return;
  var sm=(smooth!==undefined)?!!smooth:(carReady&&announce!==false);
  buildLayout(t,sm); if(!sm) clearSigns(); updateRoad();
  $('rRoad').classList.toggle('on',t==='road'); $('rMw').classList.toggle('on',t==='motorway'); $('bLane').style.display=(t==='motorway')?'':'none';
  if(announce!==false){ if(t==='motorway'){ spawnSign('blue','AUTOPISTA',55); setLimit(120); } else setLimit(90); }
}
function laneChange(){ if(lanes.length<2) return; laneIdx=1-laneIdx; laneT=lanes[laneIdx]; }

/* ---------- controles ---------- */
function setSpeed(v){ state.speed=v; $('spdS').value=v; $('spdV').textContent=Math.round(v)+' km/h'; }
function setK(k){ if(mode!=='manual')setMode('manual'); state.kT=k; $('curS').value=Math.round(k/0.0002); updCurLabel(); }
function updCurLabel(){ var k=state.kT; $('curV').textContent=Math.abs(k)<0.0005?'recta':((k<0?'izq ':'dcha ')+Math.round(1/Math.abs(k))+' m'); }
$('spdS').addEventListener('input',function(e){ setSpeed(+e.target.value); });
$('curS').addEventListener('input',function(e){ if(mode!=='manual')setMode('manual'); state.kT=(+e.target.value)*0.0002; updCurLabel(); });
$('bL').onclick=function(){ setK(-0.016); }; $('bR').onclick=function(){ setK(0.016); }; $('bS').onclick=function(){ setK(0); };
$('mM').onclick=function(){ setMode('manual'); }; $('mS').onclick=function(){ if(state.demo){ $('bDemo').onclick(); } setMode('sim'); }; $('mR').onclick=function(){ setMode('real'); };
$('bBrake').onclick=function(){ state.brake=!state.brake; $('bBrake').classList.toggle('on',state.brake); };
$('bRain').onclick=function(){ state.rain=!state.rain; $('bRain').classList.toggle('on',state.rain); setWet(); };
$('bDay').onclick=function(){ setNight(false); }; $('bNight').onclick=function(){ setNight(true); };
$('rRoad').onclick=function(){ setRoadType('road'); }; $('rMw').onclick=function(){ setRoadType('motorway'); }; $('bLane').onclick=laneChange;
$('limS').addEventListener('change',function(e){ setLimit(+e.target.value); });
$('hide').onclick=function(){ var p=$('panel'); p.style.display=(p.style.display==='none')?'':'none'; };
$('bQ').onclick=function(){ state.quality=(state.quality+1)%3; $('bQ').textContent='Calidad: '+['alta','media','baja'][state.quality]; resizeAll(); };
var demoT=0;
$('bDemo').onclick=function(){ state.demo=!state.demo; demoT=0; $('bDemo').textContent=state.demo?'⏸ Parar':'▶ Demo'; $('bDemo').classList.toggle('on',state.demo); if(state.demo){ if(mode!=='manual')setMode('manual'); setSpeed(90); } };
function demoStep(dt){ if(!state.demo)return; var t0=demoT; demoT+=dt; function at(x){return t0<x&&demoT>=x;}
  if(at(0.1)){ setRoadType('road'); setLimit(90); setSpeed(85); }
  if(at(2)) setK(0.016); if(at(8)) setK(0); if(at(11)) setK(-0.016); if(at(17)) setK(0);
  if(at(20)){ setRoadType('motorway'); setSpeed(110); }
  if(at(27)) laneChange(); if(at(34)) laneChange();
  if(at(36)){ state.rain=true; $('bRain').classList.add('on'); setWet(); } if(at(39)) setK(0.010); if(at(45)) setK(0);
  if(at(47)) setNight(true); if(at(52)) setK(-0.012); if(at(58)) setK(0);
  if(at(60)){ state.brake=true; $('bBrake').classList.add('on'); } if(at(62)){ state.brake=false; $('bBrake').classList.remove('on'); }
  if(at(64)){ setRoadType('road'); setLimit(70); setSpeed(70); }
  if(at(72)){ state.rain=false; $('bRain').classList.remove('on'); setWet(); setNight(false); demoT=0; } }

/* ---------- bucle ---------- */
var curveArm=true, last=performance.now(), fpsN=0, fpsT=0, fps=0, bob=0, roll=0, yaw=0, pitch=0, look=0;
var szW=0, szH=0, firstRender=true;
function frame(now){
  if(!running) return;
  var dt=Math.min(0.1,(now-last)/1000); last=now;
  var cw=stage.clientWidth, ch=stage.clientHeight;
  if(cw!==szW||ch!==szH){ szW=cw; szH=ch; resizeAll(); }       // el contenedor puede aparecer o cambiar de tamaño DESPUÉS de show()
  if(!cw||!ch){ requestAnimationFrame(frame); return; }         // todavía invisible: esperar sin dibujar
  if(firstRender){ firstRender=false; console.info('[hud3d] primer render', cw+'x'+ch); }
  demoStep(dt); gpsStep(dt);
  var v=state.speed/3.6; state.D+=v*dt;
  var lc0=laneC; laneC+=(laneT-laneC)*Math.min(1,dt*1.8); laneVel=dt>0?(laneC-lc0)/dt:0;     // cambio de carril suave
  if(Math.abs(state.kT)>0.009 && curveArm){ spawnSign('curve',state.kT>0?'R':'L',75); curveArm=false; } if(Math.abs(state.kT)<0.004) curveArm=true;
  state.k+=(state.kT-state.k)*Math.min(1,dt*(mode==='manual'?2.2:1.3));   // la curva entra y sale suave (más aún con GPS)
  var k=state.k;
  state.H+=v*k*dt;                                                         // rumbo acumulado: mueve las montañas
  if(trans){ trans.s-=v*dt; applyPlanes(); if(trans.s<S0+2) finishTrans(); }
  updateRoad(); updateTrees(); updateBuildings(); updateLamps(); updateSigns();
  mountains.rotation.y=state.H; mountains.position.x=camera.position.x; mountains.position.z=camera.position.z;
  // dinámica del coche: guiñada hacia la curva + alabeo por aceleración lateral + cabeceo al frenar
  var ay=v*v*k;                                           // aceleración lateral (m/s²)
  var tYaw=clamp(k*15+laneVel*0.05,-0.34,0.34), tRoll=clamp(ay*0.011,-0.15,0.15), tPitch=((state.nose!==undefined)?state.nose:state.brake)?-0.035:0;
  yaw+=(tYaw-yaw)*Math.min(1,dt*4); roll+=(tRoll-roll)*Math.min(1,dt*5); pitch+=(tPitch-pitch)*Math.min(1,dt*6);
  bob+=dt*(6+v*0.35);
  yawG.rotation.y=-yaw; rollG.rotation.z=roll; rollG.rotation.x=pitch; rollG.position.y=(v>1?Math.sin(bob)*0.004*Math.min(1,v/15):0);
  // ruedas
  if(carReady){ var da=v*dt; for(var i=0;i<wheels.length;i++){ wheels[i].o.rotation[wheels[i].axis]+=da/wheels[i].r; }
    if(tailMat) tailMat.emissiveIntensity=state.brake?3.2:(state.night?1.0:0.35); }
  // cámara: mira algo hacia la curva para que se vea, sin perder el coche
  look+=((clamp(k*320,-7,7))*0.35-look)*Math.min(1,dt*3);
  camera.lookAt(look,-2.32,-22);
  renderer.render(scene,camera);
  drawRain(dt);
  $('spd').textContent=Math.round(state.speed); $('lim').classList.toggle('over',state.speed>state.limit+3);
  fpsN++; fpsT+=dt; runT+=dt; if(fpsT>=0.5){ fps=Math.round(fpsN/fpsT); fpsN=0; fpsT=0;
    if(runT>4){ if(fps<MINFPS) slowN++; else slowN=0; if(slowN>=10){ slowN=0; if(slowCb) slowCb(fps); } }
    $('info').innerHTML=fps+' FPS<br>'+Math.round(triCount+3000).toLocaleString('es-ES')+' triángulos (coche + entorno)<br>'+renderer.info.render.calls+' draw calls'; }
  requestAnimationFrame(frame);
}
buildLayout('road',false); resizeAll(); setNight(false); setWet(); setLimit(90,false); updateRoad(); updateTrees(); updateBuildings(); updateLamps();
setMode('feed');
var spPrev=null, tPrev=0, dec=0, brakeUntil=0, hiT=null, loT=null;
function autoBrakeStep(sp,t,d){
  if(d.brake!==undefined){ state.brake=!!d.brake; state.nose=undefined; return; }      // si la app lo manda, manda ella
  if(spPrev===null){ spPrev=sp; tPrev=t; }
  else if(t-tPrev>=0.4){ var a=((sp-spPrev)/3.6)/(t-tPrev); dec+=(a-dec)*0.5; spPrev=sp; tPrev=t; }   // deceleración suavizada (m/s²)
  if(dec<-1.3 || sp<3) brakeUntil=t+0.8;                                                 // frenada fuerte o parado -> luces de freno
  state.brake=(t<brakeUntil); state.nose=(dec<-2.2 && sp>8);                              // el morro solo baja con frenadas de verdad
}
function autoRoadStep(sp,t,d){
  var want=null;
  if(d.hw===true){ hiT=null; loT=null; want='motorway'; }                                 // la ruta dice autovía
  else if(sp>=100){ loT=null; if(hiT===null) hiT=t; if(t-hiT>=6) want='motorway'; }       // >=100 km/h sostenidos 6 s
  else if(sp<85){ hiT=null; if(loT===null) loT=t; if(t-loT>=12) want='road'; }            // <85 km/h sostenidos 12 s vuelve a carretera
  else { hiT=null; loT=null; }
  if(want && want!==state.road){ setRoadType(want,false,true); if(want==='motorway') spawnSign('blue','AUTOPISTA',55); }
}
API._hooks=function(ok,fail){ onCarReady=ok; onCarFail=fail; };
API.update=function(d){
  if(!d) return;
  var t=(d.t!=null?d.t:performance.now()/1000);
  if(d.speed!=null){ setSpeed(d.speed); autoBrakeStep(d.speed,t,d); if(d.road===undefined) autoRoadStep(d.speed,t,d); }
  if(d.head!=null) feedHeading(d.head,t);
  if(d.road && d.road!==state.road){ setRoadType(d.road,false,true); if(d.road==='motorway') spawnSign('blue','AUTOPISTA',55); }
  if(d.limit && d.limit!==state.limit) setLimit(d.limit);                                 // sin dato de límite no se inventa ninguno
  if('rain' in d && !!d.rain!==state.rain){ state.rain=!!d.rain; setWet(); }
  if('night' in d && !!d.night!==state.night) setNight(!!d.night);
};
API.show=function(){ if(!REAL.stage) return; REAL.stage.style.display=''; if(!running){ running=true; runT=0; slowN=0; last=performance.now(); resizeAll(); requestAnimationFrame(frame); } };
API.hide=function(){ running=false; if(REAL.stage) REAL.stage.style.display='none'; };
API.setQuality=function(q){ state.quality=q; resizeAll(); };
API.setBodyColor=setBodyColor; API.setInterior=function(on){ interiorMeshes.forEach(function(o){ o.visible=!!on; }); countTris(); };
API._dbg=function(){ return {trans:trans,ribbons:ribbons,walls:walls,bAll:bAll,treeLow:treeLow,bodyMats:bodyMats,envAt:envAt}; };
API.laneChange=laneChange; API.spawnSign=spawnSign; API.state=state;
API.stats=function(){ return {fps:fps,tris:Math.round(triCount),calls:renderer.info.render.calls,running:running}; };

}
API.init=function(opts){
  opts=opts||{}; if(inited) return Promise.resolve(API);
  var base=opts.base||'hud3d/', glb=opts.glb||(base+'car.glb'); slowCb=opts.onSlow||null; MINFPS=opts.minFps||18;
  return (window.THREE?Promise.resolve():loadScript(base+'three.min.js')).then(function(){
    return (window.THREE.GLTFLoader?null:loadScript(base+'GLTFLoader.js'));
  }).then(function(){
    var host=opts.host||document.body, wrap=document.createElement('div'), gl=document.createElement('canvas'), rain=document.createElement('canvas');
    wrap.id='hud3dwrap'; wrap.style.display='none'; wrap.style.cssText='position:absolute;inset:0;z-index:'+(opts.z||5)+';display:none;overflow:hidden;pointer-events:none;'+(opts.sky===false?'':'background:linear-gradient(#0a1526 0%,#0e2038 30%,#0b1322 46%,#070b13 100%);');
    gl.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;'; rain.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    wrap.appendChild(gl); wrap.appendChild(rain); host.appendChild(wrap); REAL.gl=gl; REAL.rain=rain; REAL.stage=wrap;
    return new Promise(function(resolve,reject){
      try{ boot(opts); }catch(e){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); return reject(e); }
      API._hooks(function(){ inited=true; resolve(API); }, function(e){ reject(e||new Error('modelo no válido')); });
      fetch(glb).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status+' en '+glb); return r.arrayBuffer(); }).then(function(buf){ LOADCAR(buf); }).catch(reject);
    });
  });
};
window.HUD3D=API;
})();
