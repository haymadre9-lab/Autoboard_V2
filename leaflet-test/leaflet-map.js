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
let lastRadarPos=null, lastRadarAt=0, lastOcmPos=null, lastOcmAt=0;
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
// Triangulo pequeño en metros reales alrededor del radar (no en pixeles):
// sigue siendo una forma de lienzo, ligera, sin necesitar volver a
// dibujarla en cada cambio de zoom -- a cambio, crece o encoge un poco con
// el zoom, igual que cualquier otro elemento real del mapa.
function trianguloLL(centro, metros){
  const mx = 111320*Math.cos(centro[0]*Math.PI/180), my=110540;
  const dy = metros/my, dx = metros/mx;
  return [
    [centro[0]+dy, centro[1]],
    [centro[0]-dy*0.6, centro[1]-dx*0.9],
    [centro[0]-dy*0.6, centro[1]+dx*0.9]
  ];
}

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
  const edge=$('radaredge'); if (edge) edge.classList.toggle('show', over);
  const el=$('radarsign'); if(!best){el.classList.remove('show');return;}
  $('rsmax').textContent=best.max||'⚠'; $('rsdist').textContent=fmtDist(Math.max(0,best.dist));
  const rsc=el.querySelector('.rs-c'); if(rsc) rsc.style.borderColor=radarColor(best.t);
  el.classList.add('show');
}

fetch('../radares.json').then(r=>r.json()).then(d=>{ radarDB=d; console.log('[POIs] radares:', d.length); if(lastFix) refreshRadars([lastFix.lat,lastFix.lon]); }).catch(e=>console.warn('[radares]', e.message));


/* ==== cargadores: fetchPois() extraida literalmente de AutoBoard, con toda
   su logica de reintento y cache -- no es una version simplificada, es la
   misma que ya resolvio en produccion el problema real de OpenChargeMap
   (524 de Cloudflare, ~35 s de respuesta en esta zona). Dibujo en circulos
   ligeros desde el principio esta vez, no con imagenes PNG como el original,
   aprendiendo de lo que hicimos con radares.
   NO incluye mergeGoingElectric() (una segunda fuente opcional que necesita
   su propia clave aparte) -- se puede anadir despues si hace falta. */
const OCM_KEY = "b5874662-3951-4da6-90ba-ad65ed1c0156";
let pois = [], poisEnCurso = false;
const chargerGroup = L.layerGroup();

function isTesla(p){ return /tesla|supercharger/i.test((p.op||'')+' '+(p.name||'')); }

function drawChargers(){
  chargerGroup.clearLayers();
  for (const p of pois){ if (p.type!=='charge') continue;
    L.circleMarker([p.ll[0],p.ll[1]], {
      radius: 7, color:'#fff', weight:2,
      fillColor: isTesla(p) ? '#0d5c33' : '#22c55e', fillOpacity: 1   // Tesla en verde OSCURO, no rojo -- el rojo ya lo usan los radares fijos
    }).bindPopup((p.name||'Punto de carga')+(p.kw?' · '+p.kw+' kW':'')).addTo(chargerGroup);
  }
}

async function fetchPois(ll){
  if (poisEnCurso){ console.log('[POIs] ya hay una peticion en curso; se omite'); return; }
  poisEnCurso = true;
  try{
    const pedir = async (n,comp,ms) => {
      const u = 'https://api.openchargemap.io/v3/poi/?output=json&latitude='+ll[0]+'&longitude='+ll[1]
        +'&distance=6&distanceunit=KM&maxresults='+n+'&compact='+comp+'&verbose=false&key='+OCM_KEY;
      const ctl = new AbortController(), to = setTimeout(()=>ctl.abort(), ms);
      try{ const res = await fetch(u, {signal: ctl.signal}); clearTimeout(to); return res; }
      catch(e){ clearTimeout(to); return null; }
    };
    let r = await pedir(25,'true',45000);
    if (!r || !r.ok) r = await pedir(10,'true',30000);
    if (!r || !r.ok){
      const cod = r ? r.status : 'sin respuesta';
      console.warn('[POIs] OpenChargeMap no responde ('+cod+'); se mantienen los '+pois.length+' anteriores');
      if (!pois.length){
        try{
          const c = JSON.parse(localStorage.getItem('poisCacheLT')||'null');
          if (c && c.arr && c.arr.length && dist(ll,c.ll)<20000){
            pois = c.arr; drawChargers();
            console.log('[POIs] usando cache de hace', Math.round((Date.now()-c.t)/60000), 'min:', pois.length, 'cargadores');
          }
        }catch(e){}
      }
      return;
    }
    const j = await r.json(); const arr = [];
    for (const poi of (j||[])){ const ai = poi.AddressInfo; if (!ai) continue;
      const conns = poi.Connections||[]; let kw=0; const socks=[];
      for (const c of conns){ if (c.PowerKW && c.PowerKW>kw) kw=c.PowerKW;
        const tt = c.ConnectionType && c.ConnectionType.Title;
        if (tt){ let n=tt.replace('CCS (Type 2)','CCS').replace('Type 2','Tipo 2'); if (socks.indexOf(n)<0) socks.push(n); } }
      arr.push({ type:'charge', ll:[ai.Latitude, ai.Longitude], name: ai.Title||'Punto de carga',
        op: (poi.OperatorInfo && poi.OperatorInfo.Title) || '', kw: kw?Math.round(kw):0, socks });
    }
    if (!arr.length && pois.length){ console.warn('[POIs] OCM devolvio 0; se mantienen los anteriores'); return; }
    pois = arr; drawChargers();
    console.log('[POIs] cargadores:', arr.length);
    try{ localStorage.setItem('poisCacheLT', JSON.stringify({t:Date.now(), ll, arr})); }catch(e){}
  }catch(e){ console.warn('[POIs] fallo:', e.message); }
  finally{ poisEnCurso = false; }
}

let mapNite = (()=>{ const h=new Date().getHours(); return (h>=21||h<7); })();   // mismo criterio horario que AutoBoard
let baseSat = false;
let capaBase = null, capaSat = null;

function aplicarBase(){
  if (capaBase) map.removeLayer(capaBase);
  capaBase = L.tileLayer(urlDia(mapNite), { maxZoom:19, keepBuffer:4, updateWhenZooming:false, attribution:TILE_ATTR }).addTo(map);
  if (baseSat){
    if (!capaSat) capaSat = L.tileLayer(URL_SAT, { maxZoom:19, attribution:SAT_ATTR });
    if (!map.hasLayer(capaSat)) capaSat.addTo(map);
    capaSat.bringToFront();
  } else if (capaSat && map.hasLayer(capaSat)) map.removeLayer(capaSat);
  $('map').style.background = baseSat ? '#0b0e12' : (mapNite ? '#141a22' : '#e9e6df');
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

// "rotate:true" se pide siempre -- si el complemento no cargo, Leaflet
// simplemente ignora una opcion que no reconoce, sin romper nada.
/* El coche debe verse por debajo del centro de la pantalla (mas carretera por
   delante). Antes se desplazaba el CENTRO del mapa 110 px al norte en
   coordenadas del mapa sin girar: con el mapa girado eso mandaba la flecha a
   cualquier parte (comprobado con la libreria real: a 90 grados quedaba 110 px
   a la izquierda, a 180 grados por ENCIMA del centro). Ahora el propio
   contenedor del mapa se extiende OFFSET_COCHE*2 px por debajo de la pantalla:
   su centro cae OFFSET_COCHE px mas abajo que el centro visible, el coche va
   siempre en el centro del contenedor -- sin ninguna cuenta de desplazamiento
   -- y el giro se hace alrededor del coche. */
const OFFSET_COCHE = 110;
$('map').style.bottom = (-2*OFFSET_COCHE) + 'px';

const map = L.map('map', {
  zoomControl: true, attributionControl: true,
  center: [43.30, -2.98], zoom: 14,
  fadeAnimation: false, zoomAnimation: true, preferCanvas: true,
  rotate: true, rotateControl: false, touchRotate: false
});
const girarMapaDisponible = typeof map.setBearing === 'function';
if (!girarMapaDisponible) console.warn('[girar mapa] leaflet-rotate no cargo o no expone setBearing(): el ajuste quedara sin efecto');
let girarMapaOn = false;

/* ==== suavizado de rumbo, inspirado en el follow-camera de femto-car-launcher
   (github.com/seijikohara/femto-car-launcher, verificado real) ==============
   Sin esto, girar el mapa en cada fix de GPS con el rumbo crudo tiembla: el
   propio GPS oscila unos grados aunque vayas en linea recta. La idea, tal
   como la tienen ellos:
     - cambios pequeños -> media movil exponencial al 50%
     - cambios de mas de 45 grados -> giro real, seguir de inmediato
     - zona muerta de 4 grados: un desvio menor no mueve el mapa
     - "settle": si un error pequeño (>=1.5 grados) persiste 3 segundos
       seguidos, se corrige con un solo giro, en vez de quedarse desviado
       para siempre.
   Es matematica pura, sin nada de Leaflet ni DOM -- se puede probar sola. */
let bearingMostrado = 0, bearingPendienteDesde = null, bearingPendienteT = 0;
function diffAngulo(a, b){ return ((b - a + 540) % 360) - 180; }   // diferencia mas corta, -180..180
function bearingSuavizado(mostrado, crudo){
  const delta = diffAngulo(mostrado, crudo);
  if (Math.abs(delta) > 45) return crudo;         // giro real: seguir de inmediato
  return mostrado + delta * 0.5;                   // cambio pequeño: EMA al 50%
}
function actualizarBearing(crudo, ahora){
  const suavizado = bearingSuavizado(bearingMostrado, crudo);
  const delta = diffAngulo(bearingMostrado, suavizado);
  if (Math.abs(delta) < 4){                          // zona muerta de 4 grados
    if (Math.abs(delta) >= 1.5){
      if (bearingPendienteDesde === null){ bearingPendienteDesde = suavizado; bearingPendienteT = ahora; }
      else if (ahora - bearingPendienteT >= 3000){ bearingPendienteDesde = null; bearingMostrado = suavizado; }
    } else bearingPendienteDesde = null;
    return bearingMostrado;
  }
  bearingPendienteDesde = null;
  bearingMostrado = suavizado;
  return bearingMostrado;
}

/* ==== seguimiento de camara suave (idea de femto-car-launcher: la duracion del
   movimiento sigue el intervalo REAL entre fixes de GPS, en tramos lineales
   encadenados, y un hueco de senal se salta en vez de animarse) ==============
   Antes: setView con duration fija de 0,3 s en cada fix (~1 Hz) -> la camara se
   movia 0,3 s y se paraba 0,7 s ("va a saltos"), y el marcador saltaba de golpe
   al fix nuevo mientras la camara le alcanzaba despues: la flecha daba un
   tiron cada segundo. Ahora camara Y marcador recorren el mismo tramo, a la
   misma velocidad lineal y durante el mismo tiempo: la flecha se queda quieta
   en pantalla y es el mapa el que se desliza debajo. */
let prevFixT = null, zoomPendiente = true, animMarcador = null;
function moverMarcador(destino, dt){
  const desde = carMk.getLatLng();
  if (animMarcador){ cancelAnimationFrame(animMarcador); animMarcador = null; }
  if (dt <= 0){ carMk.setLatLng(destino); return; }
  const t0 = performance.now(), dur = dt*1000;
  const paso = (ts) => {
    const k = Math.min(1, ((ts||performance.now()) - t0) / dur);
    carMk.setLatLng([desde.lat + (destino[0]-desde.lat)*k, desde.lng + (destino[1]-desde.lng)*k]);
    animMarcador = (k < 1) ? requestAnimationFrame(paso) : null;
  };
  animMarcador = requestAnimationFrame(paso);
}
function seguirCamara(ll, dt){
  // El coche va SIEMPRE en el centro del contenedor (que ya esta extendido para que
  // ese centro caiga por debajo del centro visible), asi que basta centrar en el coche.
  if (zoomPendiente || dt <= 0){
    map.setView(ll, zoomPendiente ? navZoom : map.getZoom(), { animate:false });
    zoomPendiente = false;
  } else {
    map.panTo(ll, { animate:true, duration:dt, easeLinearity:1 });   // easeLinearity 1 = lineal, sin acelerar ni frenar
  }
}

/* Giro interpolado entre fixes: setBearing() es solo una transformacion CSS, barata,
   pero llamarla una vez por segundo con el valor nuevo da un latigazo cada segundo.
   Se acerca al objetivo con un filtro exponencial en el tiempo (constante 250 ms) y
   el bucle se apaga solo al llegar: en recta no consume nada. */
let bearingCSSObjetivo = 0, bearingRaf = null, bearingTPrev = 0;
function pasoBearing(ts){
  const dtMs = Math.min(100, Math.max(1, ts - bearingTPrev)); bearingTPrev = ts;
  const cur = map.getBearing();
  const d = diffAngulo(cur, bearingCSSObjetivo);
  if (Math.abs(d) < 0.05){ try{ map.setBearing(bearingCSSObjetivo); }catch(e){} bearingRaf = null; return; }
  const k = 1 - Math.exp(-dtMs/250);
  try{ map.setBearing(cur + d*k); }catch(e){ bearingRaf = null; return; }
  bearingRaf = requestAnimationFrame(pasoBearing);
}
function apuntarBearing(cssGrados){
  bearingCSSObjetivo = ((cssGrados % 360) + 360) % 360;
  if (!bearingRaf){ bearingTPrev = performance.now(); bearingRaf = requestAnimationFrame(pasoBearing); }
}
radarGroup = L.layerGroup().addTo(map);
chargerGroup.addTo(map);
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
let trafficSegs = [];
let offAcc = 0, lastRecalc = 0;
let follow = true, lastFix = null, heading = 0, speedKmh = 0;
let hud2 = null, hudAbierto = false, hudCargando = false;   // HUD 2: no existe hasta que se abre por primera vez
let navZoom = 17;   // zoom real de conduccion; el encuadre inicial de la ruta se aleja a proposito, pero el seguimiento no debe heredar ese alejamiento

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
    // Intervalo real entre fixes; primer fix o senal perdida >10 s -> saltar (dt=0), no animar
    // desde la posicion vieja atravesando el mapa.
    const dtRaw = prevFixT ? (now.t - prevFixT)/1000 : null;
    prevFixT = now.t;
    const dt = (dtRaw === null || dtRaw > 10) ? 0 : Math.min(2, Math.max(0.1, dtRaw));
    moverMarcador([now.lat, now.lon], hudAbierto ? 0 : dt);   // con el HUD abierto no se anima el marcador oculto
    const el = carMk.getElement();
    if (girarMapaOn && girarMapaDisponible){
      // El mapa gira con el rumbo: la flecha se queda fija apuntando arriba.
      if (el){ const svg = el.querySelector('svg'); if (svg) svg.style.transform = ''; }
      apuntarBearing(-actualizarBearing(heading, now.t));   // rumbo suavizado, luego interpolado
    } else {
      // El mapa se queda fijo al norte: es la flecha la que gira.
      if (el){ const svg = el.querySelector('svg'); if (svg) svg.style.transform = 'rotate('+heading+'deg)'; }
    }
    if (follow && !hudAbierto) seguirCamara([now.lat, now.lon], dt);   // con el HUD abierto el mapa esta oculto: no se mueve
    if (hudAbierto && hud2){ try{ hud2.setSpeed(speedKmh/3.6); hud2.syncPosition(now.lat, now.lon); }catch(e){} }
    $('spd').textContent = Math.round(speedKmh)+' km/h';
    $('spd2').textContent = Math.round(speedKmh);
    $('acc').textContent = Math.round(c.accuracy||0)+' m';
    if (routeOn) trackRoute();
    // Los radares no se mueven: repasar la base entera cada segundo, aunque
    // apenas te hayas desplazado unos metros, es trabajo repetido para el
    // mismo resultado. Se repasa solo si te has movido de verdad.
    // Umbrales tal como los tiene AutoBoard real: radares 800 m/60 s (son
    // locales y baratos), cargadores 3 km/180 s (cada consulta a OpenChargeMap
    // tarda decenas de segundos, no tiene sentido pedirla mas a menudo).
    const ahora = Date.now();
    if (radarDB.length && (!lastRadarPos || dist([now.lat,now.lon], lastRadarPos) > 800 || ahora-lastRadarAt > 60000)){
      lastRadarAt = ahora; lastRadarPos = [now.lat, now.lon];
      refreshRadars([now.lat, now.lon]);
    }
    updateRadar();
    if (!lastOcmPos || dist([now.lat,now.lon], lastOcmPos) > 3000 || ahora-lastOcmAt > 180000){
      lastOcmAt = ahora; lastOcmPos = [now.lat, now.lon];
      fetchPois([now.lat, now.lon]);
    }
  }, e => setStatus('GPS: '+e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

map.on('dragstart', () => { follow = false; });
$('recenter').onclick = () => { follow = true; zoomPendiente = true; if (lastFix) seguirCamara([lastFix.lat, lastFix.lon], 0); };

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
  const recorrido = recorridoAhora();
  avanzarPaso(recorrido);
  renderStep();
  const dRem = Math.max(0, (routeCumDist[routeCumDist.length-1]||0) - recorrido);
  setStatus('Quedan ' + fmtDist(dRem));
}

/* ---- panel de maniobra: mismas funciones que AutoBoard (arrowSVG,
   roundaboutSVG, maneuverSVG), sin ningun adaptador de por medio -- el SVG
   generado se inyecta tal cual en el DOM.                                  */
/* Distancia recorrida a lo largo de la ruta, con la posicion REAL del coche
   proyectada sobre el tramo actual. Usar solo el vertice mas cercano
   (routeCumDist[routeProgIdx]) da saltos del tamano de la separacion entre
   vertices: en autopista TomTom deja cientos de metros entre puntos. */
function recorridoAhora(){
  const i = routeProgIdx;
  const base = routeCumDist[i] || 0;
  if (!lastFix || i < 0 || i >= routeCoordsLL.length-1) return base;
  const a = routeCoordsLL[i], b = routeCoordsLL[i+1];
  const mx = 111320*Math.cos(a[0]*Math.PI/180), my = 110540;
  const ax=a[1]*mx, ay=a[0]*my, bx=b[1]*mx, by=b[0]*my, px=lastFix.lon*mx, py=lastFix.lat*my;
  const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
  const tt = L2 ? Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/L2)) : 0;
  return base + tt*Math.sqrt(L2);
}
/* Avanza a la PROXIMA maniobra: la primera cuyo punto aun no has alcanzado
   (se da por alcanzada a menos de 15 m). Antes se quedaba en la ULTIMA ya
   alcanzada, cuyo punto esta a 0 m por definicion: por eso la distancia
   salia siempre "0 m". */
function avanzarPaso(recorrido){
  while (stepIdx < steps.length-1 && (steps[stepIdx].metro||0) <= recorrido + 15) stepIdx++;
}

function renderStep(){
  const s = steps[stepIdx]; if (!s) return;
  const hw = !!s.hw || isHighway(s);
  const nb = $('navbanner');
  nb.style.display = 'flex';
  nb.classList.toggle('hw', hw);
  $('navarrow').innerHTML = maneuverSVG(s, hw);
  const distAquiA = Math.max(0, (s.metro||0) - recorridoAhora());
  $('navd').textContent = fmtDist(distAquiA);
  $('navsub').textContent = s.calle || s.msg || '';
}
function endRoute(){
  if (hudAbierto) cerrarHud();
  routeOn = false; steps = []; stepIdx = 0;
  if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
  $('navbanner').style.display = 'none';
  cerrarBuscador();
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
let destNombre = '';
async function irA(destino, nombre){
  destNombre = nombre || '';
  if (!lastFix){ setStatus('Sin GPS todavia'); return; }
  setStatus('Calculando ruta…');
  const t0 = performance.now();
  try{
    const locs = lastFix.lat+','+lastFix.lon+':'+destino[0]+','+destino[1];
    const url = 'https://api.tomtom.com/routing/1/calculateRoute/'+locs+'/json?key='+TT
      +'&traffic=true&travelMode=car&instructionsType=text&language=es-ES&sectionType=traffic';
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

    // Tramos de congestion sobre la propia ruta, extraido literal de AutoBoard.
    trafficSegs.forEach(s => map.removeLayer(s)); trafficSegs = [];
    (route.sections||[]).forEach(sec => { if (sec.sectionType!=='TRAFFIC') return;
      const a=sec.startPointIndex, b=sec.endPointIndex; if (a==null||b==null||b<=a) return;
      const seg = pts.slice(a,b+1); if (seg.length<2) return;
      const mag = sec.magnitudeOfDelay||0; let col=null;
      if (sec.simpleCategory==='ROAD_CLOSURE'||sec.effectiveSpeedInKmh===0) col='#ff2d2d';
      else if (mag>=3) col='#ff2d2d'; else if (mag>=1) col='#ff9a1f';
      if (col) trafficSegs.push(L.polyline(seg.map(p=>[p[0],p[1]]), {color:col, weight:6}).addTo(map));
    });
    if (trafficSegs.length) console.log('[ruta] tramos de trafico:', trafficSegs.length);

    steps = (route.guidance && route.guidance.instructions || []).map(it => {
      const refs = (it.roadNumbers||[]).join(' ');
      return {
        metro: it.routeOffsetInMeters||0, calle: it.street||'', name: it.street||'', msg: it.message||'',
        maneuver: ttMan(it),
        // igual que AutoBoard real: hay que mirar el nombre Y las referencias (A-8, AP-8...)
        hw: isHighway({name: it.street||''}) || isHighway({name: refs}) || /\b(A|AP|E)-?\d/i.test(refs)
      };
    });
    stepIdx = 0; avanzarPaso(0);   // se salta la instruccion de salida (punto a 0 m): se empieza en la primera maniobra real

    cerrarBuscador();
    renderStep();

    map.fitBounds(L.latLngBounds(pts.map(p=>[p[0],p[1]])), { paddingTopLeft:[60,60], paddingBottomRight:[60,60+2*OFFSET_COCHE], maxZoom:15 });
    setTimeout(() => { follow = true; zoomPendiente = true; }, 2000);

    const ms = Math.round(performance.now()-t0);
    setStatus('Ruta: '+fmtDist(route.summary.lengthInMeters)+' · '+Math.round(route.summary.travelTimeInSeconds/60)+' min · ('+ms+' ms)');
    if (destNombre) guardarReciente(destNombre, destino);
    if (hud2) ponerRutaEnHud();   // el HUD ya cargado recibe la ruta nueva (o el recalculo)
  }catch(e){ setStatus('Error de ruta: '+e.message); }
}


/* ==== ajustes, favoritos y ultimas direcciones =============================
   Los AJUSTES (dia/noche, satelite) NO se guardan de sesion a sesion, tal
   como se pidio -- cada carga empieza de cero. Favoritos y ultimas
   direcciones SI usan localStorage: es lo unico que de verdad ahorra tiempo
   de una sesion a otra (si no persistieran, guardar un favorito no serviria
   para nada la proxima vez que abras la app).                             */
$('gear').onclick = () => { $('settings').classList.add('open'); renderFavs(); renderRecientes(); };
$('closeSettings').onclick = () => { $('settings').classList.remove('open'); };

function cargarFavs(){ try{ return JSON.parse(localStorage.getItem('favoritosLT')||'[]'); }catch(e){ return []; } }
function guardarFavs(f){ try{ localStorage.setItem('favoritosLT', JSON.stringify(f)); }catch(e){} }
function renderFavs(){
  const favs = cargarFavs();
  $('favList').innerHTML = favs.map((f,i) =>
    '<div class="favrow" data-i="'+i+'">⭐ '+(f.nombre||'Favorito')+'<span style="margin-left:auto;color:#9aa7b2" data-del="'+i+'">✕</span></div>'
  ).join('') || '<div style="color:#9aa7b2;font-size:12px;padding:6px">Sin favoritos todavia</div>';
  $('favList').querySelectorAll('[data-i]').forEach(el => el.onclick = (e) => {
    if (e.target.dataset.del !== undefined && e.target.dataset.del !== ''){
      const favs2 = cargarFavs(); favs2.splice(+e.target.dataset.del, 1); guardarFavs(favs2); renderFavs(); return;
    }
    const f = favs[+el.dataset.i]; $('settings').classList.remove('open'); irA(f.ll, f.nombre);
  });
}
$('addFavBtn').onclick = () => {
  if (!destLL){ setStatus('Primero calcula una ruta'); return; }
  const nombre = destNombre || prompt('Nombre para este favorito:', '') || 'Favorito';
  const favs = cargarFavs(); favs.push({nombre, ll: destLL}); guardarFavs(favs); renderFavs();
};

function cargarRecientes(){ try{ return JSON.parse(localStorage.getItem('recientesLT')||'[]'); }catch(e){ return []; } }
function guardarReciente(nombre, ll){
  let r = cargarRecientes().filter(x => x.nombre !== nombre);
  r.unshift({nombre, ll}); r = r.slice(0, 5);
  try{ localStorage.setItem('recientesLT', JSON.stringify(r)); }catch(e){}
}
function renderRecientes(){
  const r = cargarRecientes();
  $('recentList').innerHTML = r.map((f,i) =>
    '<div class="favrow" data-i="'+i+'">🕓 '+f.nombre+'</div>'
  ).join('') || '<div style="color:#9aa7b2;font-size:12px;padding:6px">Sin busquedas todavia</div>';
  $('recentList').querySelectorAll('[data-i]').forEach(el => el.onclick = () => {
    const f = r[+el.dataset.i]; $('settings').classList.remove('open'); irA(f.ll, f.nombre);
  });
}


/* ==== capa general de flujo de trafico: mismo mecanismo que satelite --
   un TileLayer que se añade o se quita, nada mas. Dentro de ajustes, no
   como cuarto icono suelto, para respetar los "solo 3" en la pantalla
   principal. Usa la misma clave de TomTom que ya tiene la app. */
let trafficLayer = null, trafficOn = false;
function setTraffic(on){
  if (on){
    if (!trafficLayer) trafficLayer = L.tileLayer(
      'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key='+TT+'&tileSize=256',
      { opacity:0.9 });
    trafficLayer.addTo(map);
    trafficOn = true;
  } else {
    if (trafficLayer && map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer);
    trafficOn = false;
  }
  $('trafficBtn').classList.toggle('on', trafficOn);
}
$('trafficBtn').onclick = () => setTraffic(!trafficOn);

$('rotateBtn').onclick = () => {
  if (!girarMapaDisponible){ setStatus('Girar mapa: el complemento no cargó, sigue en modo fijo'); return; }
  girarMapaOn = !girarMapaOn;
  $('rotateBtn').classList.toggle('on', girarMapaOn);
  if (!girarMapaOn){ if (bearingRaf){ cancelAnimationFrame(bearingRaf); bearingRaf=null; } bearingCSSObjetivo=0; try{ map.setBearing(0); }catch(e){} bearingMostrado=0; bearingPendienteDesde=null; const el=carMk.getElement(); if(el){ const svg=el.querySelector('svg'); if(svg) svg.style.transform='rotate('+heading+'deg)'; } }
};


/* ==== HUD 2: motor aparte, cargado SOLO al abrirlo ===========================
   Diseno: hud2.js es un dibujante puro (createHud2(canvas) + ~10 funciones); no
   tiene GPS ni calcula rutas, se las damos nosotros. Por eso NO va como pagina
   independiente (tendria que duplicar todo el navegador para tener ruta y
   posicion), sino como modulo que se descarga con import() la primera vez que se
   abre. Mientras no se abra: no se descarga, no hay canvas dibujando, no hay
   bucle de requestAnimationFrame, y el seguimiento del mapa va exactamente igual.
   Abierto: el mapa se pausa. No se usa hud2-boot.js: esta pegado al AutoBoard
   antiguo (#hudroad, su barra de modos, y engancha el constructor de MapLibre). */
function ponerRutaEnHud(){
  if (!hud2 || !routeOn || routeCoordsLL.length < 8) return;
  try{
    // tramos de autovia en metros desde el inicio, igual que AutoBoard
    const autov = []; let ini = null, off = 0;
    steps.forEach((s, i) => {
      const m0 = s.metro||0, m1 = steps[i+1] ? (steps[i+1].metro||m0) : m0;
      if (s.hw && ini === null) ini = m0;
      if (!s.hw && ini !== null){ if (m0-ini > 150) autov.push([ini, m0]); ini = null; }
      off = m1;
    });
    if (ini !== null && off-ini > 150) autov.push([ini, off]);
    hud2.setRoute(routeCoordsLL, { motorway: autov });      // lanza si hay <3 puntos: por eso el try
    // giros y rotondas, con su distancia desde el inicio (el HUD hace la cuenta atras solo)
    const pasos = [];
    for (const s of steps){
      const mv = s.maneuver||{}, tp = mv.type||'', mo = mv.modifier||'';
      const tipo = /roundabout|rotary/.test(tp) ? 'roundabout' : mo.indexOf('left')>=0 ? 'left' : mo.indexOf('right')>=0 ? 'right' : null;
      if (tipo && (s.metro||0) > 5) pasos.push({ metro:s.metro, tipo, calle:s.calle||'', salida:mv.exit });
    }
    hud2.setManeuvers(pasos);
    if (radarDB.length) hud2.setRadars(radarDB);
  }catch(e){ console.warn('[hud2] ruta:', e.message); }
}
async function abrirHud(){
  if (hudAbierto || hudCargando) return;
  if (!routeOn || routeCoordsLL.length < 8){ setStatus('HUD 2: primero calcula una ruta'); return; }   // sin ruta no hay nada que pintar
  hudCargando = true; setStatus('Cargando HUD 2…');
  try{
    if (!hud2){
      const mod = await import('../hud2.js');
      hud2 = mod.createHud2($('hud2canvas'), { escala: 0.6 });   // 0,6 = el 36 % de los pixeles, como en AutoBoard
    }
    $('hud2wrap').classList.add('on'); $('hud2back').style.display = 'block';
    hudAbierto = true;
    $('map').style.visibility = 'hidden';                        // mapa fuera de juego mientras el HUD esta abierto
    hud2.resize(); ponerRutaEnHud(); hud2.start();
    if (lastFix){ hud2.setSpeed(speedKmh/3.6); hud2.syncPosition(lastFix.lat, lastFix.lon); }
    $('hudBtn').classList.add('on'); $('settings').classList.remove('open');
    setStatus('HUD 2 activo');
  }catch(e){
    console.warn('[hud2]', e);
    hudAbierto = false; $('hud2wrap').classList.remove('on'); $('hud2back').style.display = 'none'; $('map').style.visibility = '';
    setStatus('HUD 2 no disponible: '+e.message);
  }finally{ hudCargando = false; }
}
function cerrarHud(){
  if (!hudAbierto) return;
  try{ hud2.stop(); }catch(e){}
  $('hud2wrap').classList.remove('on'); $('hud2back').style.display = 'none'; $('map').style.visibility = '';
  hudAbierto = false; $('hudBtn').classList.remove('on');
  follow = true; zoomPendiente = true; if (lastFix) seguirCamara([lastFix.lat, lastFix.lon], 0);   // el mapa vuelve donde esta el coche
}
$('hudBtn').onclick = () => { if (hudAbierto) cerrarHud(); else abrirHud(); };
$('hud2back').onclick = cerrarHud;

/* ==== buscador plegable, extraido literal de AutoBoard =====================
   Lupa arriba a la derecha que abre/cierra la barra; al abrir, si el campo
   esta vacio, se listan recientes y favoritos; al escribir 3+ letras, se
   piden sugerencias en vivo a Nominatim -- misma funcion renderSuggest()
   que ya tiene AutoBoard, solo adaptada a los nombres de esta version. */
function cerrarBuscador(){ $('bar').style.display='none'; $('searchToggle').textContent='🔍'; $('suggest').style.display='none'; }
function abrirBuscador(){ $('bar').style.display='flex'; $('searchToggle').textContent='✕'; $('q').focus(); renderSuggest(''); }
$('searchToggle').onclick = () => { if ($('bar').style.display==='flex') cerrarBuscador(); else abrirBuscador(); };

async function renderSuggest(q){
  const box = $('suggest');
  if (!q){
    const favs = cargarFavs(), rec = cargarRecientes();
    if (!favs.length && !rec.length){ box.innerHTML = '<div class="sug"><span>Sin destinos recientes ni favoritos</span></div>'; box.style.display='block'; return; }
    let html = '';
    if (rec.length) html += rec.map((r,i) => '<div class="sug" data-rec="'+i+'"><span>🕘 '+r.nombre+'</span></div>').join('');
    if (favs.length) html += favs.map((f,i) => '<div class="sug" data-fav="'+i+'"><span>⭐ '+f.nombre+'</span></div>').join('');
    box.innerHTML = html; box.style.display = 'block';
    box.querySelectorAll('.sug').forEach(el => { el.onclick = () => {
      if (el.dataset.rec != null){ const r = cargarRecientes()[+el.dataset.rec]; cerrarBuscador(); irA(r.ll, r.nombre); return; }
      const f = cargarFavs()[+el.dataset.fav]; cerrarBuscador(); irA(f.ll, f.nombre);
    }; });
    return;
  }
  if (q.length < 3){ box.style.display='none'; return; }
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&format=json&limit=6&countrycodes=es&accept-language=es');
    const j = await r.json();
    if (!j || !j.length){ box.style.display='none'; return; }
    box.innerHTML = j.map(it => '<div class="sug" data-lat="'+it.lat+'" data-lon="'+it.lon+'"><span>📍 '+it.display_name.split(',').slice(0,3).join(',')+'</span></div>').join('');
    box.style.display = 'block';
    box.querySelectorAll('.sug').forEach(el => { el.onclick = () => {
      const nombre = el.textContent.replace('📍','').trim();
      cerrarBuscador(); irA([parseFloat(el.dataset.lat), parseFloat(el.dataset.lon)], nombre);
    }; });
  }catch(e){ box.style.display='none'; }
}
$('q').addEventListener('input', () => renderSuggest($('q').value.trim()));
$('q').addEventListener('focus', () => { if (!$('q').value.trim()) renderSuggest(''); });

$('go').onclick = async () => {
  const q = $('q').value.trim(); if (!q) return;
  setStatus('Buscando "'+q+'"…');
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q));
    const j = await r.json();
    if (!j.length){ setStatus('No se ha encontrado "'+q+'"'); return; }
    cerrarBuscador(); irA([parseFloat(j[0].lat), parseFloat(j[0].lon)], q);
  }catch(e){ setStatus('Error de busqueda: '+e.message); }
};
$('q').addEventListener('keydown', e => { if (e.key==='Enter') $('go').click(); });

/* Casa: pulsacion larga para fijarla, toque normal para ir directo -- mismo
   patron que AutoBoard (600 ms de umbral entre "toque" y "mantener"). */
function getHome(){ try{ return JSON.parse(localStorage.getItem('homeLT')||'null'); }catch(e){ return null; } }
(function(){
  const b = $('homeBtn'); let tmr=null, longed=false;
  const doHome = () => { const h=getHome(); if (h){ cerrarBuscador(); irA([h.lat,h.lon], 'Casa'); } else setStatus('Mantén pulsado 🏠 para fijar tu casa'); };
  const start = () => { longed=false; tmr=setTimeout(async () => {
    longed=true;
    const q = prompt('Fijar CASA — dirección (vacío = ubicación actual):','');
    if (q===null) return;
    let ll=null;
    if (q.trim()){
      try{ const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q.trim())); const j=await r.json(); if (j.length) ll=[parseFloat(j[0].lat),parseFloat(j[0].lon)]; }catch(e){}
    } else if (lastFix){ ll=[lastFix.lat,lastFix.lon]; }
    if (ll){ localStorage.setItem('homeLT', JSON.stringify({lat:ll[0],lon:ll[1]})); setStatus('🏠 Casa fijada'); }
    else setStatus('No se pudo fijar la casa');
  }, 600); };
  const cancel = () => { if (tmr){ clearTimeout(tmr); tmr=null; } };
  b.addEventListener('touchstart', start, {passive:true}); b.addEventListener('touchmove', cancel, {passive:true});
  b.addEventListener('touchend', () => { cancel(); if (!longed) doHome(); });
  b.addEventListener('mousedown', start); b.addEventListener('mouseup', () => { cancel(); if (!longed) doHome(); }); b.addEventListener('mouseleave', cancel);
})();

(function(){
  let n=0, t=performance.now();
  function tick(){ n++; const now=performance.now(); if (now-t>=1000){ $('fps').textContent=n+' fps'; n=0; t=now; } requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
})();
