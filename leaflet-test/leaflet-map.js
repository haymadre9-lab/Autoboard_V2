/* ============================================================================
   FASE 2 — misma logica de ruta que AutoBoard, solo cambia el dibujo.
   No se recalcula nada aqui: dist(), segDistM(), isHighway() y
   simplificarDP() son EXACTAMENTE las mismas funciones de index.html,
   copiadas literalmente (no reescritas), para que esta sea una prueba de
   verdad y no una aproximacion. El endpoint de TomTom, sus parametros y el
   analisis de guidance.instructions tambien son los mismos que usa
   applyRoute() en AutoBoard.
   ========================================================================= */

const TT = "zMPqeYVXNoQw4rJ1ycr8QdywkDFNx0tF";
// Teselas RASTER de MapTiler -- el mismo proveedor de pago que ya usa
// AutoBoard para MapLibre, con la misma clave. Cambiado desde OpenStreetMap
// (servidor publico, pensado para uso ligero) tras pruebas intermitentes
// con AutoBoard integrado. Esta pagina usa Leaflet REAL, sin ningun
// adaptador de por medio: si aqui el mapa aguanta bien, el problema estaba
// en la integracion (LeafletMapWrap), no en Leaflet+MapTiler en si.
const MAPTILER_KEY = 'sG00UkBX9Ig2ifguvPgU';   // esta si es la clave de MapTiler; la anterior era la de TomTom, mismo error de copia
const TILE_ATTR = '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const SAT_ATTR = '&copy; Esri, Maxar, Earthstar Geographics';

/* Base MAPA (dia/noche) + capa SATELITE por encima -- misma filosofia ya
   probada en LeafletMapWrap/AutoBoard: cambiar de capa NUNCA destruye el
   mapa ni la ruta, solo se anade o se quita una TileLayer. Aqui es aun mas
   directo porque no hay ningun adaptador de por medio traduciendo nada. */
function urlDia(noche){
  const estilo = noche ? 'streets-v2-dark' : 'streets-v2';
  return 'https://api.maptiler.com/maps/'+estilo+'/256/{z}/{x}/{y}.png?key='+MAPTILER_KEY;
}
const URL_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';


/* ==== radares: mismo sistema que AutoBoard, funciones extraidas literalmente
   (bearing, ladoRuta, refreshRadars, drawRadars, updateRadar, radarBeep,
   beep), con radarGroup como L.layerGroup() nativo de Leaflet en vez del
   grupo de simbolos por GPU que usa MapLibre -- aqui clearLayers() ya
   existe de verdad en la libreria, no hay que emularlo.                   */
const RADAR_ICON='<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#e01d1d" stroke="#fff" stroke-width="1.6"/><rect x="6" y="9" width="8" height="6" rx="1" fill="#fff"/><circle cx="10" cy="12" r="1.7" fill="#e01d1d"/><path d="M14 10.3 L18 8.5 L18 15.5 L14 13.7 Z" fill="#fff"/></svg>';
let radarDB=[], radars=[], radarAlerted=false, showRadars=true;
let radarGroup;   // se crea DESPUES de construir el mapa (ver mas abajo) -- usarlo antes reventaba el script entero, igual que ya paso en index.html

function bearing(a,b){const y=Math.sin((b[1]-a[1])*Math.PI/180)*Math.cos(b[0]*Math.PI/180),x=Math.cos(a[0]*Math.PI/180)*Math.sin(b[0]*Math.PI/180)-Math.sin(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.cos((b[1]-a[1])*Math.PI/180);return (Math.atan2(y,x)*180/Math.PI+360)%360;}

function ladoRuta(ll){
  let best=1e9, bi=-1; const i0=Math.max(1,routeProgIdx-20), n=routeCoordsLL.length;
  for(let i=i0;i<n;i++){ const d=segDistM(ll,{lat:routeCoordsLL[i-1][0],lon:routeCoordsLL[i-1][1]},{lat:routeCoordsLL[i][0],lon:routeCoordsLL[i][1]}); if(d<best){best=d;bi=i;} }
  if(bi<0) return {d:1e9,der:false};
  const a=routeCoordsLL[bi-1], b=routeCoordsLL[bi], mx=Math.cos(a[0]*Math.PI/180);
  const cruz=(b[1]-a[1])*mx*(ll[0]-a[0]) - (b[0]-a[0])*(ll[1]-a[1])*mx;
  return {d:best, der:cruz<0};
}

let _radarsHuella = '';
function refreshRadars(here){ const out=[];
  for(const p of radarDB){ if(dist(here,[p.lat,p.lon])>5000)continue;
    if(routeOn && routeCoordsLL.length){
      const l=ladoRuta([p.lat,p.lon]);
      if(l.d>40) continue;
      if(!l.der && l.d>8) continue;
    }
    out.push({ll:[p.lat,p.lon],max:p.max,t:p.t}); }
  radars=out;
  // Solo se reconstruyen los marcadores si el conjunto realmente cambio --
  // si son los mismos radares que ya estaban dibujados, no hace falta
  // destruirlos y volver a crearlos.
  const huella = out.map(r=>r.ll[0]+','+r.ll[1]).join('|');
  if (huella !== _radarsHuella){ _radarsHuella = huella; drawRadars(); }
}

function radarColor(t){ return t==='fijo'?'#e01d1d': t==='movil'?'#2f6bff': t==='tramo'?'#ff9a1f': t==='semaforo'?'#f5c518':'#e01d1d'; }

// Circulos en vez de icono con divIcon: se dibujan sobre el <canvas> que ya
// activamos con preferCanvas, sin crear ni un <div> por radar. Se pierde la
// forma de camara -- queda un punto de color, mismo color que antes segun
// el tipo -- a cambio de que reposicionar cientos de radares en el mapa sea
// cosa del canvas, no de mover elementos del DOM uno a uno. Reversible en
// cualquier momento: basta con volver a esta funcion tal como estaba antes.
function drawRadars(){
  radarGroup.clearLayers(); if(!showRadars)return;
  for(const p of radars){
    L.circleMarker([p.ll[0],p.ll[1]], {
      radius: 8, color:'#fff', weight:2, fillColor: radarColor(p.t), fillOpacity: 1, interactive:false
    }).addTo(radarGroup);
  }
}

let AC=null;
function initAudio(){ try{ if(!AC) AC=new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==='suspended') AC.resume(); }catch(e){} }
function beep(freq,dur,vol){ try{ if(!AC) initAudio(); if(!AC)return; const o=AC.createOscillator(),g=AC.createGain(); o.type='sine'; o.frequency.value=freq||880; o.connect(g); g.connect(AC.destination); g.gain.setValueAtTime(vol||0.16,AC.currentTime); o.start(); g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+(dur||0.15)); o.stop(AC.currentTime+(dur||0.15)); }catch(e){} }
function radarBeep(){ beep(1100,0.14,0.2); setTimeout(()=>beep(1100,0.14,0.2),190); }

function updateRadar(){
  if(!lastFix||!showRadars){ $('radarsign').classList.remove('show'); return; }
  let best=null;
  for(const p of radars){ p.dist=dist([lastFix.lat,lastFix.lon],p.ll); const ah=Math.abs(((bearing([lastFix.lat,lastFix.lon],p.ll)-heading+540)%360)-180)<95; if(!ah)continue;
    if(p.dist<800&&(!best||p.dist<best.dist))best=p; }
  const over = !!(best && best.dist<500 && best.max && speedKmh > best.max+2);
  if(over){ if(!radarAlerted){ radarAlerted=true; radarBeep(); } }
  if(!best || best.dist>560) radarAlerted=false;
  const el=$('radarsign'); if(!best){el.classList.remove('show');return;}
  $('rsmax').textContent=best.max||'⚠'; $('rsdist').textContent=fmtDist(Math.max(0,best.dist));
  const rsc=el.querySelector('.rs-c'); if(rsc) rsc.style.borderColor=radarColor(best.t);
  el.classList.add('show');
}

fetch('../radares.json').then(r=>r.json()).then(d=>{ radarDB=d; console.log('[POIs] radares:', d.length); if(lastFix) refreshRadars([lastFix.lat,lastFix.lon]); }).catch(e=>console.warn('[radares]', e.message));

let mapNite = (()=>{ const h=new Date().getHours(); return (h>=21||h<7); })();   // mismo criterio horario que AutoBoard
let baseSat = false;
let capaBase = null, capaSat = null;

function aplicarBase(){
  if (capaBase) map.removeLayer(capaBase);
  capaBase = L.tileLayer(urlDia(mapNite), { maxZoom:19, keepBuffer:2, updateWhenZooming:false, attribution:TILE_ATTR }).addTo(map);
  if (baseSat){
    if (!capaSat) capaSat = L.tileLayer(URL_SAT, { maxZoom:19, attribution:SAT_ATTR });
    if (!map.hasLayer(capaSat)) capaSat.addTo(map);
    capaSat.bringToFront();
  } else if (capaSat && map.hasLayer(capaSat)) map.removeLayer(capaSat);
  $('sat').textContent = baseSat ? '🗺️' : '🛰️';
  $('mapnight').classList.toggle('on', mapNite);
}
const $ = id => document.getElementById(id);

/* ==== funciones de icono de maniobra, extraidas literalmente de AutoBoard (index.html) ==== */

const TURN_GEOM = {
  'straight':     {turn:0,   R:0},
  'slight right': {turn:35,  R:26},
  'right':        {turn:90,  R:15},
  'sharp right':  {turn:150, R:10},
  'uturn':        {turn:178, R:9},
  'sharp left':   {turn:-150,R:10},
  'left':         {turn:-90, R:15},
  'slight left':  {turn:-35, R:26},
};
function triHead(x,y,t,c,len,hw){
  len=len||9; hw=hw||5.5;
  const tan={x:Math.sin(t),y:-Math.cos(t)}, lat={x:Math.cos(t),y:Math.sin(t)};
  const bx=x-tan.x*len, by=y-tan.y*len;
  const l={x:bx+lat.x*hw, y:by+lat.y*hw}, r={x:bx-lat.x*hw, y:by-lat.y*hw};
  return '<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+' L'+l.x.toFixed(1)+' '+l.y.toFixed(1)
    +' L'+r.x.toFixed(1)+' '+r.y.toFixed(1)+' Z" fill="'+c+'"/>';
}

function turnPath(mod, n){
  n=n||14;
  const g=TURN_GEOM[mod]||TURN_GEOM.straight, P0={x:24,y:46};
  if(!g.turn){ const pts=[]; for(let i=0;i<=n;i++) pts.push({x:24, y:P0.y-(P0.y-10)*i/n}); return { pts, brg:0 }; }
  const right=g.turn>0, R=g.R, Cx=right?24+R:24-R, C={x:Cx,y:46};
  const a0=right?180:0, a1=right?a0+g.turn:a0-Math.abs(g.turn);
  const pts=[];
  for(let i=0;i<=n;i++){ const a=(a0+(a1-a0)*i/n)*Math.PI/180;
    pts.push({x:C.x+R*Math.cos(a), y:C.y+R*Math.sin(a)}); }
  return { pts, brg: g.turn };
}

function turnArrowFill(mod, shaftHW, headHW, headLen){
  shaftHW=shaftHW||4.2; headHW=headHW||8.5; headLen=headLen||13;
  const {pts}=turnPath(mod,28);
  const N=pts.length, distDesdePunta=new Array(N); distDesdePunta[N-1]=0;
  for(let i=N-2;i>=0;i--){ const dx=pts[i+1].x-pts[i].x, dy=pts[i+1].y-pts[i].y;
    distDesdePunta[i]=distDesdePunta[i+1]+Math.hypot(dx,dy); }
  const tang=i=>{ const a=pts[Math.max(0,i-1)], b=pts[Math.min(N-1,i+1)];
    const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy)||1; return {x:dx/L,y:dy/L}; };
  const left=[], right=[]; let tip=null;
  for(let i=0;i<N;i++){
    const t=tang(i), lat={x:-t.y,y:t.x}, d=distDesdePunta[i];
    if(d<=0){ tip={x:pts[i].x,y:pts[i].y}; continue; }
    const hw = d<headLen ? headHW*(d/headLen) : shaftHW;
    left.push({x:pts[i].x+lat.x*hw, y:pts[i].y+lat.y*hw});
    right.push({x:pts[i].x-lat.x*hw, y:pts[i].y-lat.y*hw});
  }
  const poly=[...left, tip, ...right.reverse()];
  return 'M'+poly.map(p=>p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' L')+' Z';
}

function arrowSVG(mod,col,w){col=col||'#0a8a34';
  return '<svg viewBox="0 0 48 52"><path d="'+turnArrowFill(mod,4.6,9.5,9)+'" fill="'+col+'"/></svg>';}

function laneArrow(dir,valid,hw){ const col=valid?(hw?'#ffffff':'#0a8a34'):(hw?'#000000':'#9aa3b2');
  return '<div class="lane"><svg viewBox="0 0 48 52"><path d="'+turnArrowFill(dir,4.0,8.2,8)+'" fill="'+col+'"/></svg></div>'; }

function roundaboutSVG(exit,mod,col){
  // El tramo de rotonda que se recorre (entrada -> tu salida) se pinta como un
  // arco blanco grueso: se lee la forma de un vistazo, sin depender de un
  // numero pequeno.
  // Angulos de salida FIJOS (no dependen de cual sea tu salida): 6 huecos
  // repartidos en 300 grados, dejando 60 grados libres junto a la entrada. El
  // esquema anterior calculaba el reparto a partir de tu propia salida y eso
  // hacia que la salida 2 diera SIEMPRE un arco de longitud cero (justo la
  // maniobra mas habitual, "sigue recto en la rotonda"): un fallo real, no solo
  // de estetica.
  const g='#6b7480', cx=26, cy=26, r=13, grosor=6.5, NMAX=6, pasoDeg=300/NMAX;
  const n=Math.max(1,Math.min(NMAX,parseInt(exit,10)||1));
  const a0=Math.PI/2;                        // entrada, siempre abajo
  const aDe=k=>a0-(k*pasoDeg)*Math.PI/180;    // angulo de la salida k (1..NMAX)
  let s='<svg viewBox="0 0 52 52">';
  s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r-grosor/2-1)+'" fill="'+g+'" opacity=".18"/>';
  s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+g+'" stroke-width="3" opacity=".45"/>';
  // entrada, en gris: aun no estas circulando por la rotonda
  s+='<path d="M'+cx+' 52 L'+cx+' '+(cy+r)+'" stroke="'+g+'" stroke-width="'+grosor+'" stroke-linecap="round" opacity=".55"/>';
  // las demas salidas, apenas insinuadas
  for(let k=1;k<=NMAX;k++){ if(k===n) continue; const a=aDe(k);
    const x1=cx+Math.cos(a)*r, y1=cy+Math.sin(a)*r, x2=cx+Math.cos(a)*(r+7), y2=cy+Math.sin(a)*(r+7);
    s+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+' L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" stroke="'+g+'" stroke-width="2.4" stroke-linecap="round" opacity=".4"/>'; }
  // ARCO relleno (blanco, grueso) del tramo real, desde la entrada hasta tu salida
  const aSel=aDe(n);
  // El arco NO se dibuja con el comando "A" de SVG: sus banderas large/sweep
  // eligen entre dos centros posibles, y si no coinciden EXACTAMENTE con mi
  // centro real (cx,cy) el arco se hincha hacia fuera en vez de seguir la
  // circunferencia (era justo el fallo: salidas 5 y 6 desplazadas hacia fuera).
  // En vez de adivinar las banderas, se muestrean puntos directamente sobre MI
  // circulo -mismo criterio ya usado y probado en las flechas de giro-, lo que
  // garantiza que el arco se ciñe siempre al aro real.
  const xs=cx+Math.cos(aSel)*r, ys=cy+Math.sin(aSel)*r;
  let dArco='M'+cx+' '+(cy+r);
  for(let i=1;i<=24;i++){ const a=a0-(a0-aSel)*i/24;
    dArco+=' L'+(cx+Math.cos(a)*r).toFixed(1)+' '+(cy+Math.sin(a)*r).toFixed(1); }
  const col2='#ffb020';   // ambar: se diferencia bien tanto del aro gris-azulado como de un panel azul de autopista, cosa que el blanco no hacia
  s+='<path d="'+dArco+'" fill="none" stroke="'+col2+'" stroke-width="'+grosor+'" stroke-linecap="round" stroke-linejoin="round"/>';
  // Salida: MISMA TECNICA que las flechas de giro (forma rellena, sin trazo
  // pegado). Un trazo + un triangulo suelto encima siempre se leia como "un
  // pegote puesto"; una unica forma que nace del propio grosor del arco,
  // se ensancha y cierra en punta, se lee como una flecha de verdad.
  const largo=11;
  const xo=cx+Math.cos(aSel)*(r+largo), yo=cy+Math.sin(aSel)*(r+largo);
  const brg=Math.atan2(xo-cx,-(yo-cy));
  const tan={x:Math.sin(brg),y:-Math.cos(brg)}, lat={x:Math.cos(brg),y:Math.sin(brg)};
  const shaftHW=grosor/2, headHW=7.5, hombro=0.5;   // 0..1: donde esta el ensanche maximo
  const hx=xs+(xo-xs)*hombro, hy=ys+(yo-ys)*hombro;
  const poly=[
    {x:xs+lat.x*shaftHW, y:ys+lat.y*shaftHW},
    {x:hx+lat.x*headHW,  y:hy+lat.y*headHW},
    {x:xo, y:yo},
    {x:hx-lat.x*headHW,  y:hy-lat.y*headHW},
    {x:xs-lat.x*shaftHW, y:ys-lat.y*shaftHW},
  ];
  s+='<path d="M'+poly.map(p=>p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' L')+' Z" fill="'+col2+'"/>';
  return s+'</svg>';
}

function maneuverSVG(st,hw){const m=st.maneuver||{};const col=hw?'#ffffff':'#0a8a34';
  if(m.type==='roundabout'||m.type==='rotary')return roundaboutSVG(m.exit,m.modifier,col);
  if(m.type==='arrive')return '<svg viewBox="0 0 48 52"><path d="M24 6c-7 0-12 5-12 12 0 9 12 26 12 26s12-17 12-26c0-7-5-12-12-12z" fill="'+col+'"/><circle cx="24" cy="18" r="4.5" fill="#fff"/></svg>';
  if(m.type==='fork'||m.type==='off ramp'){ // bifurcacion / salida: tronco + dos ramas, la tuya marcada
    const izq=(m.modifier||'').indexOf('left')>=0, g='#9aa3b2';
    return '<svg viewBox="0 0 48 52"><path d="M24 48 L24 28" stroke="'+col+'" stroke-width="7" stroke-linecap="round"/>'
      +'<path d="M24 28 L'+(izq?36:12)+' 10" stroke="'+g+'" stroke-width="5" stroke-linecap="round"/>'
      +'<path d="M24 28 L'+(izq?12:36)+' 10" stroke="'+col+'" stroke-width="7" stroke-linecap="round"/>'
      +arrowHead(izq?12:36,10,izq?-0.6:0.6,col)+'</svg>'; }
  if(m.type==='merge'||m.type==='on ramp'){ const izq=(m.modifier||'').indexOf('left')>=0;
    return '<svg viewBox="0 0 48 52"><path d="M'+(izq?34:14)+' 48 L'+(izq?34:14)+' 6" stroke="#9aa3b2" stroke-width="5" stroke-linecap="round"/>'
      +'<path d="M'+(izq?12:36)+' 48 Q'+(izq?14:34)+' 26 '+(izq?30:18)+' 14" fill="none" stroke="'+col+'" stroke-width="7" stroke-linecap="round"/></svg>'; }
  return arrowSVG(m.modifier,col,7.5);}

function ttMan(it){ const m=(it.maneuver||it.instructionType||'').toString().toUpperCase(); const rb=it.roundaboutExitNumber;
  if(m.indexOf('ROUNDABOUT')>=0||m.indexOf('ROTARY')>=0) return {type:'roundabout',exit:rb,modifier:(m.indexOf('LEFT')>=0?'left':(m.indexOf('RIGHT')>=0?'right':'straight'))};
  if(m.indexOf('ARRIVE')>=0)return {type:'arrive'}; if(m.indexOf('DEPART')>=0)return {type:'depart'};
  if(m.indexOf('EXIT')>=0||m.indexOf('RAMP')>=0)return {type:'off ramp',modifier:(m.indexOf('LEFT')>=0?'left':'right')};
  if(m.indexOf('MERGE')>=0)return {type:'merge'};
  let mod='straight';
  if(m.indexOf('SHARP_LEFT')>=0)mod='sharp left'; else if(m.indexOf('SHARP_RIGHT')>=0)mod='sharp right';
  else if(m.indexOf('BEAR_LEFT')>=0||m.indexOf('KEEP_LEFT')>=0||m.indexOf('SLIGHT_LEFT')>=0)mod='slight left';
  else if(m.indexOf('BEAR_RIGHT')>=0||m.indexOf('KEEP_RIGHT')>=0||m.indexOf('SLIGHT_RIGHT')>=0)mod='slight right';
  else if(m.indexOf('LEFT')>=0)mod='left'; else if(m.indexOf('RIGHT')>=0)mod='right'; else if(m.indexOf('UTURN')>=0||m.indexOf('U_TURN')>=0)mod='uturn';
  return {type:'turn',modifier:mod};
}

/* ================================================================== */

// ---- funciones identicas a index.html, copiadas literalmente -------------
function dist(a,b){const R=6371000,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180,la1=a[0]*Math.PI/180,la2=b[0]*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}

function segDistM(p,a,b){const mx=111320*Math.cos(p[0]*Math.PI/180),my=110540;const px=p[1]*mx,py=p[0]*my,ax=a.lon*mx,ay=a.lat*my,bx=b.lon*mx,by=b.lat*my;const dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy;let t=L2?((px-ax)*dx+(py-ay)*dy)/L2:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));}

function isHighway(st){ const n=((st&&st.name)||'').toLowerCase();
  return /autopista|autov[ií]a|\b(a|ap)-?\d/.test(n); }

function simplificarDP(pts, tolM){
  const n=pts.length; if(n<3) return {p:pts.map(q=>[q[1],q[0]]), i:pts.map((_,k)=>k)};
  const lat0=pts[0][0]*Math.PI/180, mx=111320*Math.cos(lat0), my=110540;
  const X=new Float64Array(n), Y=new Float64Array(n);
  for(let k=0;k<n;k++){ X[k]=pts[k][1]*mx; Y[k]=pts[k][0]*my; }
  const keep=new Uint8Array(n); keep[0]=keep[n-1]=1;
  const pila=[0,n-1], t2=tolM*tolM;
  while(pila.length){
    const b=pila.pop(), a=pila.pop();
    const dx=X[b]-X[a], dy=Y[b]-Y[a], L2=dx*dx+dy*dy;
    let dm=0, im=-1;
    for(let k=a+1;k<b;k++){
      let d;
      if(L2===0){ const ex=X[k]-X[a], ey=Y[k]-Y[a]; d=ex*ex+ey*ey; }
      else { const c=((X[k]-X[a])*dy-(Y[k]-Y[a])*dx); d=c*c/L2; }
      if(d>dm){ dm=d; im=k; }
    }
    if(im>=0 && dm>t2){ keep[im]=1; pila.push(a,im,im,b); }
  }
  const p=[], i=[];
  for(let k=0;k<n;k++) if(keep[k]){ p.push([pts[k][1],pts[k][0]]); i.push(k); }   // ya en [lng,lat]
  return {p, i};
}
// ---------------------------------------------------------------------------

const map = L.map('map', {
  zoomControl: true, attributionControl: true,
  center: [43.30, -2.98], zoom: 14,
  fadeAnimation: true, zoomAnimation: true, preferCanvas: true
});
radarGroup = L.layerGroup().addTo(map);
aplicarBase();

$('sat').onclick = () => { baseSat = !baseSat; aplicarBase(); };
$('mapnight').onclick = () => { mapNite = !mapNite; aplicarBase(); };

const carSVG = `<svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#1e88e5" stroke="#ffffff" stroke-width="1.2"/></svg>`;
const carIcon = L.divIcon({ className: 'car', html: carSVG, iconSize: [26,26], iconAnchor: [13,13] });
const carMk = L.marker(map.getCenter(), { icon: carIcon, zIndexOffset: 1000 }).addTo(map);

// ---- estado de ruta: mismos nombres que AutoBoard, para que se note que es
//      la misma arquitectura conceptual, solo con Leaflet debajo -----------
let routeLine = null;
let routeCoordsLL = [];   // TODOS los puntos de TomTom (navegacion), sin simplificar
let routeDraw = [];       // copia simplificada SOLO para dibujar (igual criterio que AutoBoard)
let routeDrawIdx = [];
let routeCumDist = [];    // distancia acumulada real hasta cada punto de routeCoordsLL, en metros
let steps = [], stepIdx = 0, destLL = null, routeOn = false, routeProgIdx = 0;
let offAcc = 0, lastRecalc = 0;
let follow = true, lastFix = null, heading = 0, speedKmh = 0;

function fmtDist(m){ return m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km'; }
function setStatus(t){ $('status').textContent = t; }

/* ---- GPS: mismo patron que index.html --------------------------------- */
if (navigator.geolocation){
  navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    const now = { lat: c.latitude, lon: c.longitude, t: p.timestamp };
    let v = c.speed; if (v==null || isNaN(v)){ if (lastFix){ const dt=(now.t-lastFix.t)/1000; v = dt>0.2 ? dist([lastFix.lat,lastFix.lon],[now.lat,now.lon])/dt : speedKmh/3.6; } else v = 0; }
    if (lastFix){
      const la1=lastFix.lat*Math.PI/180, la2=now.lat*Math.PI/180, dLon=(now.lon-lastFix.lon)*Math.PI/180;
      const y=Math.sin(dLon)*Math.cos(la2), x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
      const brg=(Math.atan2(y,x)*180/Math.PI+360)%360;
      if (v>1) heading = brg;
    }
    speedKmh = Math.max(0, v*3.6);
    lastFix = now;
    carMk.setLatLng([now.lat, now.lon]);
    const el = carMk.getElement();
    if (el){ const svg = el.querySelector('svg'); if (svg) svg.style.transform = 'rotate('+heading+'deg)'; }
    if (follow) map.setView([now.lat, now.lon], map.getZoom(), { animate: true, duration: 0.3 });
    $('spd').textContent = Math.round(speedKmh)+' km/h';
    $('acc').textContent = Math.round(c.accuracy||0)+' m';
    if (routeOn) trackRoute();
    // Los radares no se mueven: repasar la base entera cada segundo, aunque
    // apenas te hayas desplazado unos metros, es trabajo repetido para el
    // mismo resultado. Se repasa solo si te has movido de verdad.
    if (radarDB.length && (!window.__radarRefAt || dist([now.lat,now.lon], window.__radarRefAt) > 150)){
      window.__radarRefAt = [now.lat, now.lon];
      refreshRadars([now.lat, now.lon]);
    }
    updateRadar();
  }, e => setStatus('GPS: '+e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

map.on('dragstart', () => { follow = false; });
$('recenter').onclick = () => { follow = true; if (lastFix) map.setView([lastFix.lat, lastFix.lon], 16, {animate:true}); };

/* ---- trackRoute(): MISMA estrategia que AutoBoard -- ventana local
   alrededor de routeProgIdx, nunca recorre toda la ruta, y solo recalcula
   tras varias detecciones seguidas fuera de umbral + un tiempo minimo desde
   el ultimo recalculo. Los umbrales (70 m, offAcc>3, 8000 ms) son los
   mismos valores que en index.html.                                        */
function trackRoute(){
  if (!routeOn || !lastFix || !steps.length) return;
  trimRoute();
  const here = [lastFix.lat, lastFix.lon];
  const seg = i => segDistM(here, {lat:routeCoordsLL[i-1][0],lon:routeCoordsLL[i-1][1]}, {lat:routeCoordsLL[i][0],lon:routeCoordsLL[i][1]});
  let dr = 1e9;
  const i0=Math.max(1,routeProgIdx-40), i1=Math.min(routeCoordsLL.length,routeProgIdx+400);
  for (let i=i0;i<i1;i++){ const dd=seg(i); if(dd<dr) dr=dd; }
  if (dr>70 && offAcc>=3){ for(let i=1;i<routeCoordsLL.length;i++){ const dd=seg(i); if(dd<dr) dr=dd; if(dr<=70) break; } }
  if (dr>70) offAcc++; else offAcc=0;
  if (offAcc>3 && performance.now()-lastRecalc>8000){
    lastRecalc=performance.now(); offAcc=0;
    console.log('[ruta] recalculo: a', Math.round(dr), 'm de la ruta');
    irA(destLL); return;
  }
  // siguiente maniobra: avance de paso con la distancia RECORRIDA real,
  // no una aproximacion -- routeCumDist se calcula una vez al recibir la
  // ruta y aqui solo se consulta.
  const recorrido = routeCumDist[routeProgIdx] || 0;
  while (stepIdx < steps.length-1 && (steps[stepIdx+1].metro||0) <= recorrido) stepIdx++;
  renderStep();
  const dRem = Math.max(0, (routeCumDist[routeCumDist.length-1]||0) - recorrido);
  setStatus('Quedan ' + fmtDist(dRem));
}

/* ---- panel de maniobra: mismas funciones que AutoBoard (arrowSVG,
   roundaboutSVG, maneuverSVG), sin ningun adaptador de por medio -- el SVG
   generado se inyecta tal cual en el DOM.                                  */
function renderStep(){
  const s = steps[stepIdx]; if (!s) return;
  const hw = isHighway(s);
  const nb = $('navbanner');
  nb.style.display = 'flex';
  nb.classList.toggle('hw', hw);
  $('navarrow').innerHTML = maneuverSVG(s, hw);
  const distAquiA = Math.max(0, (s.metro||0) - (routeCumDist[routeProgIdx]||0));
  $('navd').textContent = fmtDist(distAquiA);
  $('navsub').textContent = s.calle || s.msg || '';
}
function endRoute(){
  routeOn = false; steps = []; stepIdx = 0;
  if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
  $('navbanner').style.display = 'none';
  $('bar').style.display = 'flex';
  setStatus('Ruta cancelada');
}
$('cancelRuta').onclick = endRoute;

/* recorta la geometria de DIBUJO (pocos puntos), nunca la de navegacion
   (routeCoordsLL, que se queda intacta) -- mismo criterio que index.html   */
function trimRoute(){
  if (!lastFix || !routeCoordsLL.length) return;
  const here=[lastFix.lat,lastFix.lon];
  let bi=routeProgIdx, bd=1e9; const end=Math.min(routeCoordsLL.length, routeProgIdx+160);
  for (let i=Math.max(1,routeProgIdx); i<end; i++){
    const dd=segDistM(here, {lat:routeCoordsLL[i-1][0],lon:routeCoordsLL[i-1][1]}, {lat:routeCoordsLL[i][0],lon:routeCoordsLL[i][1]});
    if (dd<bd){ bd=dd; bi=i-1; }
  }
  if (bi!==routeProgIdx){
    routeProgIdx=bi;
    if (routeLine && routeDraw.length){
      let lo=0, hi=routeDrawIdx.length-1;
      while (lo<hi){ const mid=(lo+hi)>>1; if (routeDrawIdx[mid]<routeProgIdx) lo=mid+1; else hi=mid; }
      const ahead = routeDraw.slice(lo); ahead.unshift([here[1], here[0]]);
      if (ahead.length>=2) routeLine.setLatLngs(ahead.map(p=>[p[1],p[0]]));
    }
  }
}

/* ---- ruta: mismo endpoint y parametros que AutoBoard, con guidance ------ */
async function irA(destino){
  if (!lastFix){ setStatus('Sin GPS todavia'); return; }
  setStatus('Calculando ruta…');
  const t0 = performance.now();
  try{
    const locs = lastFix.lat+','+lastFix.lon+':'+destino[0]+','+destino[1];
    const url = 'https://api.tomtom.com/routing/1/calculateRoute/'+locs+'/json?key='+TT
      +'&traffic=true&travelMode=car&instructionsType=text&language=es-ES';
    const r = await fetch(url);
    const j = await r.json();
    if (!j.routes || !j.routes.length){ setStatus('Sin ruta'); return; }
    const route = j.routes[0];
    const pts = [];
    route.legs.forEach(leg => leg.points.forEach(p => pts.push([p.latitude, p.longitude])));
    routeCoordsLL = pts; routeProgIdx = 0; destLL = destino; routeOn = true;

    routeCumDist = [0];
    for (let i=1;i<pts.length;i++) routeCumDist.push(routeCumDist[i-1] + dist(pts[i-1], pts[i]));

    const sim = simplificarDP(pts, 3);
    routeDraw = sim.p; routeDrawIdx = sim.i;
    console.log('[ruta] puntos TomTom:', pts.length, '→ dibujados:', routeDraw.length,
      '('+Math.round(100-routeDraw.length/Math.max(1,pts.length)*100)+'% menos)');

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(routeDraw.map(p=>[p[1],p[0]]), { color:'#1e88e5', weight:6 }).addTo(map);

    steps = (route.guidance && route.guidance.instructions || []).map(it => ({
      metro: it.routeOffsetInMeters||0, calle: it.street||'', msg: it.message||'',
      maneuver: ttMan(it)
    }));
    stepIdx = 0;

    $('bar').style.display = 'none';
    renderStep();

    map.fitBounds(L.latLngBounds(pts.map(p=>[p[0],p[1]])), { padding:[60,60], maxZoom:15 });
    setTimeout(() => { follow = true; }, 2000);

    const ms = Math.round(performance.now()-t0);
    setStatus('Ruta: '+fmtDist(route.summary.lengthInMeters)+' · '+Math.round(route.summary.travelTimeInSeconds/60)+' min · ('+ms+' ms)');
  }catch(e){ setStatus('Error de ruta: '+e.message); }
}

$('go').onclick = async () => {
  const q = $('q').value.trim(); if (!q) return;
  setStatus('Buscando "'+q+'"…');
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q));
    const j = await r.json();
    if (!j.length){ setStatus('No se ha encontrado "'+q+'"'); return; }
    irA([parseFloat(j[0].lat), parseFloat(j[0].lon)]);
  }catch(e){ setStatus('Error de busqueda: '+e.message); }
};
$('q').addEventListener('keydown', e => { if (e.key==='Enter') $('go').click(); });

(function(){
  let n=0, t=performance.now();
  function tick(){ n++; const now=performance.now(); if (now-t>=1000){ $('fps').textContent=n+' fps'; n=0; t=now; } requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();
