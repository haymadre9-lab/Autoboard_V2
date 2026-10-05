/* Raiz del repositorio, sea cual sea la carpeta en la que viva esta app. Hoy vive en leaflet-test/ (RAIZ = '../'),
   el dia del cambio definitivo se copiara a la raiz (RAIZ = './') y NO habra que tocar ni una linea de codigo:
   los archivos compartidos (hud2.js, radares.json, coche.png) se piden siempre a traves de RAIZ.
   Va en la primera linea a proposito: algo tan arriba como el fetch de radares.json la usa
   inmediatamente al cargar el script, antes de que ninguna otra declaracion mas abajo exista
   todavia (el mismo tipo de fallo de orden que ya dio problemas con chargerGroup/radarGroup). */
const RAIZ = /\/(leaflet-test|maplibre-test|app)\/[^/]*$/.test(location.pathname) ? '../' : './';
const urlRepo = u => /^\.{1,2}\//.test(u) ? RAIZ + u.replace(/^(\.{1,2}\/)+/, '') : u;   // "../coche.png" o "./coche.png" -> la de esta instalacion

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
function urlEstilo(noche){
  const estilo = noche ? 'streets-v2-dark' : 'streets-v2';
  return 'https://api.maptiler.com/maps/'+estilo+'/style.json?key='+MAPTILER_KEY;   // VECTORIAL (antes: teselas raster 256 px)
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
/* (radarGroup de Leaflet eliminado: ahora es la fuente GeoJSON 'radares') */
let _radarGroupYa;   // se crea DESPUES de construir el mapa (ver mas abajo) -- usarlo antes reventaba el script entero, igual que ya paso en index.html

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

/* Fijo: rojo muy palido -- se sabe que esta, sin gritar. Movil: azul palido Y medio
   transparente -- doble atenuacion, color claro y opacidad reducida, porque se mueve
   y no conviene que se lea como algo tan fijo/seguro como un radar fijo. Tramo y
   semaforo se quedan igual que antes, no se pidio tocarlos. */
function radarColor(t){ return t==='fijo'?'#ff8a8a': t==='movil'?'#a9c8ff': t==='tramo'?'#ff9a1f': t==='semaforo'?'#f5c518':'#ff8a8a'; }
function radarOpacidad(t){ return t==='movil' ? 0.55 : 1; }
let radarTiposOn = { fijo:true, movil:true, tramo:true, semaforo:true };   // Ajustes: activar/desactivar cada tipo por separado

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
function diamanteLL(centro, metros){
  const mx = 111320*Math.cos(centro[0]*Math.PI/180), my=110540;
  const dy = metros/my, dx = metros/mx;
  return [
    [centro[0]+dy, centro[1]],
    [centro[0], centro[1]+dx],
    [centro[0]-dy, centro[1]],
    [centro[0], centro[1]-dx]
  ];
}

function drawRadars(){
  const feats = [];
  if (showRadars) for (const p of radars){
    if (radarTiposOn[p.t] === false) continue;   // tipo desactivado en Ajustes
    const props = { t:p.t, color:radarColor(p.t), op:radarOpacidad(p.t) };
    if (p.t === 'tramo'){
      // Diamante (no circulo): un tramo de velocidad media se distingue de un vistazo.
      const d = diamanteLL(p.ll, 11).map(q => [q[1], q[0]]); d.push(d[0]);
      feats.push({ type:'Feature', properties:props, geometry:{ type:'Polygon', coordinates:[d] } });
    } else {
      feats.push({ type:'Feature', properties:props, geometry:{ type:'Point', coordinates:[p.ll[1], p.ll[0]] } });
    }
  }
  fuenteSet('radares', { type:'FeatureCollection', features:feats });
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
  hudRadarEstado.active = over; hudRadarEstado.cerca = !!best; hudRadarEstado.type = best ? best.t : null;
  const edge=$('radaredge'); if (edge) edge.classList.toggle('show', over);
  const el=$('radarsign'); if(!best){el.classList.remove('show');return;}
  $('rsmax').textContent=best.max||'⚠'; $('rsdist').textContent=fmtDist(Math.max(0,best.dist));
  // Como una senal de carretera de verdad: gris/neutra mientras solo avisa de que
  // hay un radar delante, y roja de verdad SOLO cuando hay alerta real -vas por
  // encima del limite cerca de el-. Antes se coloreaba siempre segun el tipo de
  // radar, aunque fueras dentro del limite -- gritaba sin necesidad.
  const rsc=el.querySelector('.rs-c'); if(rsc) rsc.style.borderColor = over ? radarColor(best.t) : '#8a939c';
  el.classList.toggle('alerta', over);
  el.classList.add('show');
}
let hudRadarEstado = { active:false, cerca:false, type:null };

fetch(RAIZ + 'radares.json').then(r=>r.json()).then(d=>{ radarDB=d; console.log('[POIs] radares:', d.length); if(lastFix) refreshRadars([lastFix.lat,lastFix.lon]); }).catch(e=>console.warn('[radares]', e.message));


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
let listaCargOn = false, listaHuella = '', listaT = 0;   // lista de cargadores (Ajustes)

function isTesla(p){ return /tesla|supercharger/i.test((p.op||'')+' '+(p.name||'')); }
/* Franja de potencia: 11/22 kW amarillo, 50/72 kW azul, mas de 72 kW verde (como antes),
   Superchargers Tesla en granate SIEMPRE, por encima de lo que marque su potencia. */
function tierCargador(p){
  if (isTesla(p)) return 'tesla';
  const kw = p.kw||0;
  if (kw && kw<=22) return 'amarillo';
  if (kw && kw<=72) return 'azul';
  return 'verde';   // mas de 72 kW, o sin dato de potencia
}
const COLOR_TIER = { amarillo:'#f5c518', azul:'#2f6bff', verde:'#22c55e', tesla:'#7b1e3a' };
let cargadorTiposOn = { amarillo:true, azul:true, verde:true, tesla:true };   // Ajustes: activar/desactivar cada franja por separado

/* Icono con la potencia escrita encima. Ahora es una IMAGEN del estilo (canvas -> map.addImage)
   dibujada por la GPU en una capa 'symbol', no un elemento DOM por cargador. Misma apariencia que
   el antiguo .ic-carg: cuadrado redondeado de 26 px, borde blanco, texto oscuro en el amarillo. */
function imagenCargador(tier, txt){
  const clave = 'carg-' + tier + '-' + txt;
  if (!registroImagenes.has(clave)){
    const S = 26, R = 2, c = document.createElement('canvas'); c.width = c.height = S*R;
    const ctx = c.getContext('2d'); ctx.scale(R, R);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x+r, y); ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath(); };
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
    rr(1.25, 1.25, S-2.5, S-2.5, 7); ctx.fillStyle = COLOR_TIER[tier]; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.fillStyle = tier === 'amarillo' ? '#111111' : '#ffffff';
    const t = String(txt); ctx.font = '800 ' + (t.length > 2 ? 9 : 10) + 'px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, S/2, S/2 + 0.5);
    registroImagenes.set(clave, { data: ctx.getImageData(0, 0, S*R, S*R), pixelRatio: R });
  }
  if (estiloListo && !map.hasImage(clave)){ const im = registroImagenes.get(clave); map.addImage(clave, im.data, { pixelRatio: im.pixelRatio }); }
  return clave;
}
function drawChargers(){
  if (listaCargOn) renderLista();
  const feats = [];
  for (const p of pois){ if (p.type!=='charge') continue;
    const tier = tierCargador(p);
    if (cargadorTiposOn[tier] === false) continue;   // franja desactivada en Ajustes
    const txt = tier==='tesla' ? (p.kw ? Math.round(p.kw) : 'SC') : Math.round(p.kw||0);
    feats.push({ type:'Feature', properties:{ icono: imagenCargador(tier, txt) }, geometry:{ type:'Point', coordinates:[p.ll[1], p.ll[0]] } });
  }
  fuenteSet('cargadores', { type:'FeatureCollection', features:feats });
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
/* ==== estado del motor de mapa (MapLibre GL) ====================================================
   Al cambiar de estilo (dia/noche) MapLibre BORRA fuentes, capas e imagenes anadidas a mano: por eso
   todo lo nuestro vive en JS (datosFuente, registroImagenes) y montarCapas() lo vuelve a poner cada
   vez que carga un estilo ('style.load'). Las funciones de dibujo solo actualizan datosFuente. */
const VACIO = { type:'FeatureCollection', features:[] };
const datosFuente = { 'ruta':VACIO, 'ruta-tramos':VACIO, 'radares':VACIO, 'paradas':VACIO, 'cargadores':VACIO, 'pin':VACIO };
const registroImagenes = new Map();   // clave -> { data:ImageData, pixelRatio }
let estiloListo = false;
let estiloActual = mapNite;           // true = oscuro: el estilo con el que se construye el mapa
function fuenteSet(id, fc){
  datosFuente[id] = fc;
  try{ const s = map.getSource(id); if (s) s.setData(fc); }catch(e){}
}
function aplicarVisibilidadBase(){
  try{ if (map.getLayer('sat')) map.setLayoutProperty('sat', 'visibility', baseSat ? 'visible' : 'none'); }catch(e){}
}
function aplicarBase(){
  if (estiloActual !== mapNite){
    estiloActual = mapNite; estiloListo = false;
    map.setStyle(urlEstilo(mapNite), { diff:false });   // 'style.load' -> montarCapas()
  } else if (estiloListo){
    aplicarVisibilidadBase();
  }
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
  return '<div class="lane"><svg viewBox="0 0 48 52"><path d="'+turnArrowFill(dir,4.8,9.5,9)+'" fill="'+col+'"/></svg></div>'; }

function roundaboutSVG(exit,mod,col){
  // El tramo de rotonda que se recorre (entrada -> tu salida) se pinta como un
  // arco relleno grueso: se lee la forma de un vistazo, sin depender de un
  // numero pequeno.
  // Maximo 4 salidas dibujadas. En la mayoria de rotondas reales, la salida 4
  // es un cambio de sentido (vuelta casi completa) -- asi que cualquier salida
  // real 4 o mayor (4, 5, 6, 7...) se trata como esa misma maniobra: dar casi
  // toda la vuelta y salir por donde se entro, no "una salida mas" en el
  // reparto. Solo las salidas 1, 2 y 3 son huecos normales.
  const g='#6b7480', cx=26, cy=26, r=13, grosor=6.5, NEXITS=3, pasoDeg=240/NEXITS;
  const exitReal=Math.max(1,parseInt(exit,10)||1);
  const esVuelta=exitReal>=4;
  const n=esVuelta?4:exitReal;
  const a0=Math.PI/2;                        // entrada, siempre abajo
  const aDe=k=>a0-(k*pasoDeg)*Math.PI/180;    // angulo de la salida k (1..NEXITS)
  let s='<svg viewBox="0 0 52 52">';
  s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r-grosor/2-1)+'" fill="'+g+'" opacity=".18"/>';
  s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+g+'" stroke-width="3" opacity=".45"/>';
  // entrada, en gris: aun no estas circulando por la rotonda
  s+='<path d="M'+cx+' 52 L'+cx+' '+(cy+r)+'" stroke="'+g+'" stroke-width="'+grosor+'" stroke-linecap="round" opacity=".55"/>';
  // las demas salidas normales, apenas insinuadas (si esta maniobra es la vuelta, ninguna esta seleccionada: se insinuan las 3)
  for(let k=1;k<=NEXITS;k++){ if(k===n) continue; const a=aDe(k);
    const x1=cx+Math.cos(a)*r, y1=cy+Math.sin(a)*r, x2=cx+Math.cos(a)*(r+7), y2=cy+Math.sin(a)*(r+7);
    s+='<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+' L'+x2.toFixed(1)+' '+y2.toFixed(1)+'" stroke="'+g+'" stroke-width="2.4" stroke-linecap="round" opacity=".4"/>'; }
  // ARCO relleno (blanco, grueso) del tramo real, desde la entrada hasta tu salida.
  // El cambio de sentido barre CASI toda la circunferencia (350 grados) en vez de
  // parar en un hueco: se lee de un vistazo como "da la vuelta entera", no como
  // una salida normal mas.
  const aSel=esVuelta ? a0-350*Math.PI/180 : aDe(n);
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
  s+='<text x="'+cx+'" y="'+(cy+1)+'" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="800" font-family="system-ui,sans-serif" fill="'+col+'">'+exitReal+'</text>';
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
  // WAYPOINT_LEFT/RIGHT/REACHED es una PARADA intermedia: contiene 'LEFT'/'RIGHT' pero no es un giro; se muestra como llegada
  if(m.indexOf('ARRIVE')>=0||m.indexOf('WAYPOINT')>=0)return {type:'arrive'}; if(m.indexOf('DEPART')>=0)return {type:'depart'};
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
/* El coche debe verse por DEBAJO del centro de la pantalla (mas carretera por delante). En MapLibre
   basta un padding SUPERIOR de 2*OFFSET_COCHE: el centro efectivo del mapa baja OFFSET_COCHE px y
   el giro/inclinacion se hacen alrededor del coche. (Un padding inferior haria lo contrario.) */
const OFFSET_COCHE = 110;
const PAD_COCHE = { top: 2*OFFSET_COCHE, bottom: 0, left: 0, right: 0 };
const _qs = new URLSearchParams(location.search);
const PITCH_NAV = Number.isFinite(+_qs.get('pitch')) && _qs.get('pitch') !== null ? +_qs.get('pitch') : 60;   // ?pitch=0..75 para probar
const EDIFICIOS_3D = _qs.get('3d') !== '0';                                                                  // ?3d=0 apaga los edificios
const ANTIALIAS = _qs.get('aa') === '1';

const map = new maplibregl.Map({
  container: 'map',
  style: urlEstilo(mapNite),
  center: [-2.98, 43.30], zoom: 14, pitch: PITCH_NAV, maxPitch: 75,
  antialias: ANTIALIAS, attributionControl: false
});
map.addControl(new maplibregl.AttributionControl({ compact:true }));
map.addControl(new maplibregl.NavigationControl({ showCompass:false, visualizePitch:false }), 'top-left');
map.setPadding({ top: 2*OFFSET_COCHE, bottom: 0, left: 0, right: 0 });
// El usuario no gira ni inclina a mano (como en V2: touchRotate:false); la camara la manda el seguimiento.
try{ map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.touchPitch.disable(); }catch(e){}
const girarMapaDisponible = true;    // MapLibre gira de serie: ya no depende de leaflet-rotate
let girarMapaOn = girarMapaDisponible;   // por defecto el mapa gira con el rumbo (si el complemento cargo); en Ajustes: "Quitar giro de mapa"

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
let bearingSalto = null;   // candidato a giro brusco esperando confirmacion
function actualizarBearing(crudo, ahora){
  // Un dato suelto que salta mas de 45 grados casi siempre es un fallo del GPS, no un giro real
  // (un giro real de 90 grados dura varios segundos y lo confirma el fix siguiente): se espera
  // un segundo dato coherente antes de girar el mapa de golpe.
  if (Math.abs(diffAngulo(bearingMostrado, crudo)) > 45){
    if (bearingSalto !== null && Math.abs(diffAngulo(bearingSalto, crudo)) < 25){ bearingSalto = null; bearingPendienteDesde = null; bearingMostrado = crudo; return bearingMostrado; }
    bearingSalto = crudo; return bearingMostrado;
  }
  bearingSalto = null;
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

/* ==== seguimiento de camara: UN solo bucle requestAnimationFrame ==========================
   El GPS (1 Hz) solo fija OBJETIVOS (posicion del coche, rumbo, zoom). El bucle interpola:
     - posicion: lineal durante el intervalo real entre fixes (idea de femto-car-launcher, ya en V2);
       el coche y la camara recorren el mismo tramo, asi la flecha se queda quieta en pantalla;
     - rumbo: exponencial en el TIEMPO (constante 550 ms, la misma que usaba V2);
     - zoom: exponencial (350 ms) hacia el zoom pedido (ajuste Lejos/Cerca o zoom de maniobra).
   Se usa jumpTo (nada de easeTo/panTo apilados): es lo que hace fluida a la app nueva.
   El rumbo que se le da al bucle sigue pasando por actualizarBearing() de V2 (zona muerta, saltos
   confirmados, "settle"): es mejor que el filtro simple de la app nueva. */
let carPos = null, carDesde = null, carHasta = null, carT0 = 0, carDur = 0;      // [lng,lat]
let camBearing = 0, camBearingObj = 0, camZoom = null, camZoomObj = null, loopT = 0, rotMostrada = null;
let prevFixT = null, zoomPendiente = true;
let renders = 0;

const carSVG = `<svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#1e88e5" stroke="#ffffff" stroke-width="1.2"/></svg>`;
const elCoche = document.createElement('div'); elCoche.className = 'car'; elCoche.innerHTML = carSVG; elCoche.style.display = 'none';
// rotationAlignment/pitchAlignment 'map': la flecha "tumbada" sobre el asfalto, en perspectiva
const carMk = new maplibregl.Marker({ element: elCoche, rotationAlignment:'map', pitchAlignment:'map', anchor:'center' }).setLngLat([-2.98, 43.30]).addTo(map);

function marcarCoche(){
  carMk.setLngLat(carPos);
  if (elCoche.style.display === 'none') elCoche.style.display = '';
}
function nuevoTramoCoche(dest, dt){   // dest = [lng,lat]
  if (!carPos || dt <= 0){ carPos = dest.slice(); carHasta = null; marcarCoche(); return; }
  carDesde = carPos.slice(); carHasta = dest.slice(); carT0 = performance.now(); carDur = dt*1000;
}
function seguirCamara(ll, dt){   // ll = [lat,lon]
  // Salto inmediato (primer fix, senal recuperada, boton centrar, cambio de zoom, volver del HUD/Faro).
  if (zoomPendiente || dt <= 0){
    const z = zoomPendiente ? navZoom : map.getZoom();
    camZoom = camZoomObj = z;
    camBearing = camBearingObj;
    if (!carPos){ carPos = [ll[1], ll[0]]; marcarCoche(); }
    map.jumpTo({ center: [ll[1], ll[0]], zoom: z, bearing: camBearing, pitch: PITCH_NAV, padding: PAD_COCHE });
    zoomPendiente = false;
  }
  // con dt>0 y sin salto pendiente, el bucle de abajo hace todo el trabajo
}
function bucleCamara(ts){
  requestAnimationFrame(bucleCamara);
  const dtMs = Math.min(100, Math.max(1, ts - (loopT || ts))); loopT = ts;
  if (mapaOculto || !carPos) return;   // HUD/Faro abiertos: el mapa no se toca (como en V2)
  let mover = false;
  if (carHasta){
    const k = carDur > 0 ? Math.max(0, Math.min(1, (ts - carT0) / carDur)) : 1;
    carPos = [carDesde[0] + (carHasta[0]-carDesde[0])*k, carDesde[1] + (carHasta[1]-carDesde[1])*k];
    if (k >= 1) carHasta = null;
    marcarCoche(); mover = true;
  }
  const dB = diffAngulo(camBearing, camBearingObj);
  if (Math.abs(dB) > 0.05){ camBearing = (((camBearing + dB*(1 - Math.exp(-dtMs/550))) % 360) + 360) % 360; mover = true; }
  else if (Math.abs(dB) > 1e-6){ camBearing = ((camBearingObj % 360) + 360) % 360; mover = true; }   // ultimo ajuste, UNA vez
  if (camZoom === null){ camZoom = camZoomObj = navZoom; }
  let zoomCambia = false;
  const dz = camZoomObj - camZoom;
  if (Math.abs(dz) > 0.001){ camZoom += dz*(1 - Math.exp(-dtMs/350)); zoomCambia = true; }
  else if (Math.abs(dz) > 1e-6){ camZoom = camZoomObj; zoomCambia = true; }
  // flecha: con el mapa girando con el rumbo apunta siempre arriba (rotacion = bearing del mapa);
  // con el mapa fijo al norte, apunta al rumbo real
  const rot = girarMapaOn ? camBearing : heading;
  if (rotMostrada === null || Math.abs(diffAngulo(rotMostrada, rot)) > 0.1){ carMk.setRotation(rot); rotMostrada = rot; }
  if (!follow) camSucia = false;
  else if (mover || zoomCambia || camSucia){
    // jumpTo() empieza llamando a stop(), y stop() REINICIA los gestos tactiles de MapLibre: llamarlo en cada
    // fotograma mientras hay un dedo en el mapa lo deja sin zoom ni arrastre. Mientras dura el gesto la camara
    // se pausa (camSucia = pendiente de reencuadrar) y al soltar se reencuadra de una vez.
    if (mapaTocado()) camSucia = true;
    else {
      const o = { center: carPos, bearing: camBearing };
      if (zoomCambia) o.zoom = camZoom;
      map.jumpTo(o); camSucia = false;
    }
  }
}
requestAnimationFrame(bucleCamara);
let camSucia = false;
// Seguimiento de los dedos (o la rueda) sobre el mapa. Un puntero que no avisa de que se ha soltado caduca a los 8 s.
const _punteros = new Set(); let _tPtr = 0, _rueda = 0;
const _cm = map.getCanvasContainer();
_cm.addEventListener('pointerdown', e => { _punteros.add(e.pointerId); _tPtr = performance.now(); }, { passive:true });
addEventListener('pointermove', () => { if (_punteros.size) _tPtr = performance.now(); }, { passive:true, capture:true });
function _suelta(e){
  _punteros.delete(e.pointerId);
  if (!_punteros.size && camZoom !== null && Math.abs(map.getZoom() - camZoom) > 0.01){ camZoom = camZoomObj = map.getZoom(); }   // el zoom que dejo el usuario es el nuevo
}
addEventListener('pointerup', _suelta, true); addEventListener('pointercancel', _suelta, true);
_cm.addEventListener('wheel', () => { _rueda = performance.now() + 500; }, { passive:true });
/* Pausa de la camara: dedo puesto, rueda, o CUALQUIER movimiento en curso de MapLibre (gesto con inercia, botones +/-,
   la vista general de una ruta nueva): map.isMoving(). jumpTo() no lo deja activo, asi que no se bloquea a si mismo. */
function mapaTocado(){ const n = performance.now(); return (_punteros.size > 0 && n - _tPtr < 8000) || n < _rueda || map.isMoving(); }

// Si el usuario hace zoom con los dedos, el bucle no debe pelearse con el: se toma su zoom como nuevo objetivo.
map.on('zoomend', e => { if (e && e.originalEvent){ camZoom = camZoomObj = map.getZoom(); } });
map.on('render', () => { renders++; });

// Errores del MAPA (estilo que no carga, clave rechazada, teselas, WebGL...) a la franja roja de diagnostico del
// index.html, sin repetir y con la clave tapada. Cuando todo funcione, no sale nada.
const _errVistos = new Set();
map.on('error', e => {
  const er = e && e.error;
  let m = (er && (er.message || (er.status && ('HTTP ' + er.status)))) || (e && e.message) || 'desconocido';
  if (er && er.url) m += ' [' + String(er.url).replace(/key=[^&]+/, 'key=…') + ']';
  if (_errVistos.has(m) || _errVistos.size >= 6) return;
  _errVistos.add(m);
  if (window.__show) window.__show('MAPA: ' + m); else console.warn('[mapa]', m);
});
map.on('load', () => { try{ setStatus('Mapa cargado'); }catch(e){} });

/* ==== capas propias: se (re)montan en CADA carga de estilo ================================ */
function montarCapas(){
  estiloListo = true;
  try{
    registroImagenes.forEach((im, clave) => { if (!map.hasImage(clave)) map.addImage(clave, im.data, { pixelRatio: im.pixelRatio }); });
    const add = (def) => { if (!map.getLayer(def.id)) map.addLayer(def); };
    const src = (id, def) => { if (!map.getSource(id)) map.addSource(id, def); };

    // satelite (encima de la base, debajo de todo lo demas)
    src('sat', { type:'raster', tiles:[URL_SAT], tileSize:256, maxzoom:19, attribution:SAT_ATTR });
    add({ id:'sat', type:'raster', source:'sat', layout:{ visibility: baseSat ? 'visible' : 'none' } });

    // edificios 3D con la fuente vectorial del propio estilo; van PRIMERO para que ruta y marcadores queden por encima
    if (EDIFICIOS_3D && !map.getLayer('edificios3d')){
      const estilo = map.getStyle(); let cand = null;
      for (const l of estilo.layers){
        const s = estilo.sources[l.source];
        if (s && s.type === 'vector' && /building/i.test(l['source-layer'] || '')){ cand = { source:l.source, sl:l['source-layer'] }; break; }
      }
      if (cand) map.addLayer({ id:'edificios3d', source:cand.source, 'source-layer':cand.sl, type:'fill-extrusion', minzoom:14,
        paint:{ 'fill-extrusion-color': mapNite ? '#3b4654' : '#b8c0cc',
                'fill-extrusion-height': ['coalesce', ['get','render_height'], 8],
                'fill-extrusion-base': ['coalesce', ['get','render_min_height'], 0],
                'fill-extrusion-opacity': 0.5 } });
    }

    // flujo de trafico de TomTom (raster)
    src('flujo', { type:'raster', tiles:['https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key='+TT+'&tileSize=256'], tileSize:256 });
    add({ id:'flujo', type:'raster', source:'flujo', paint:{ 'raster-opacity':0.9 }, layout:{ visibility: trafficOn ? 'visible' : 'none' } });

    // ruta + tramos con congestion
    src('ruta', { type:'geojson', data: datosFuente['ruta'] });
    add({ id:'ruta', type:'line', source:'ruta', layout:{ 'line-cap':'round', 'line-join':'round' },
      paint:{ 'line-color':'#1e88e5', 'line-width':['interpolate',['linear'],['zoom'],14,5,16,9,17,15,18,22,19,28,20,34] } });
    src('ruta-tramos', { type:'geojson', data: datosFuente['ruta-tramos'] });
    add({ id:'ruta-tramos', type:'line', source:'ruta-tramos', layout:{ 'line-cap':'round', 'line-join':'round' },
      paint:{ 'line-color':['get','color'], 'line-width':['interpolate',['linear'],['zoom'],14,4,16,7,17,11,18,16,19,21,20,26] } });

    // radares: circulos (fijo/movil/semaforo) y diamantes (tramo)
    src('radares', { type:'geojson', data: datosFuente['radares'] });
    add({ id:'radares-tramo', type:'fill', source:'radares', filter:['==',['geometry-type'],'Polygon'],
      paint:{ 'fill-color':['get','color'], 'fill-opacity':['get','op'] } });
    add({ id:'radares-tramo-borde', type:'line', source:'radares', filter:['==',['geometry-type'],'Polygon'],
      paint:{ 'line-color':'#ffffff', 'line-width':2 } });
    add({ id:'radares-pt', type:'circle', source:'radares', filter:['==',['geometry-type'],'Point'],
      paint:{ 'circle-radius':8, 'circle-color':['get','color'], 'circle-opacity':['get','op'], 'circle-stroke-color':'#ffffff', 'circle-stroke-width':2 } });

    // paradas intermedias, cargadores y pin temporal
    src('paradas', { type:'geojson', data: datosFuente['paradas'] });
    add({ id:'paradas', type:'circle', source:'paradas', paint:{ 'circle-radius':12, 'circle-color':'#f5b301', 'circle-stroke-color':'#ffffff', 'circle-stroke-width':3 } });
    src('cargadores', { type:'geojson', data: datosFuente['cargadores'] });
    add({ id:'cargadores', type:'symbol', source:'cargadores',
      layout:{ 'icon-image':['get','icono'], 'icon-allow-overlap':true, 'icon-ignore-placement':true } });
    src('pin', { type:'geojson', data: datosFuente['pin'] });
    add({ id:'pin', type:'circle', source:'pin', paint:{ 'circle-radius':9, 'circle-color':'#2f6bff', 'circle-stroke-color':'#ffffff', 'circle-stroke-width':3 } });
  }catch(e){ console.warn('[capas] ', e.message); try{ setStatus('Capas: ' + e.message); }catch(er){} }
}
map.on('style.load', montarCapas);
/* Red de seguridad: al volver del HUD/Faro (o si el navegador suelta y recupera el contexto WebGL) se comprueba que las
   capas siguen en el mapa; si no, se montan otra vez, y si si estan, se reenvian los datos. Si hizo falta restaurarlas,
   avisa en la franja roja: asi sabremos que el fallo existe y cuando pasa. */
function restaurarCapas(motivo){
  try{
    if (!estiloListo) return;
    if (!map.getLayer('ruta')){
      montarCapas();
      console.warn('[capas] perdidas (' + motivo + '): restauradas');
      if (window.__show) window.__show('AVISO: capas del mapa perdidas (' + motivo + ') y restauradas');
      return;
    }
    for (const id in datosFuente){ const sr = map.getSource(id); if (sr) sr.setData(datosFuente[id]); }
  }catch(e){ console.warn('[capas]', e.message); }
}
map.on('webglcontextrestored', () => restaurarCapas('webgl'));
// Los iconos que faltan en el estilo (p. ej. si un cargador usa una clave nueva) no deben llenar la consola.
map.on('styleimagemissing', e => { if (registroImagenes.has(e.id)){ const im = registroImagenes.get(e.id); try{ map.addImage(e.id, im.data, { pixelRatio: im.pixelRatio }); }catch(er){} } });

aplicarBase();

$('sat').onclick = () => { baseSat = !baseSat; aplicarBase(); };
$('mapnight').onclick = () => { mapNite = !mapNite; aplicarBase(); };

// punto [lat,lon] o {lat,lng} -> pixeles de PANTALLA (cuenta bien con el mapa girado e inclinado)
function aXY(ll){
  const lat = Array.isArray(ll) ? ll[0] : ll.lat;
  const lng = Array.isArray(ll) ? ll[1] : (ll.lng !== undefined ? ll.lng : ll.lon);
  return map.project([lng, lat]);
}

// ---- estado de ruta: mismos nombres que AutoBoard, para que se note que es
//      la misma arquitectura conceptual, solo con Leaflet debajo -----------
let routeCoordsLL = [];   // TODOS los puntos de TomTom (navegacion), sin simplificar
let routeDraw = [];       // copia simplificada SOLO para dibujar (igual criterio que AutoBoard)
let routeDrawIdx = [];
let routeCumDist = [];    // distancia acumulada real hasta cada punto de routeCoordsLL, en metros
let steps = [], stepIdx = 0, destLL = null, routeOn = false, routeProgIdx = 0;
let trafficFeatures = [];   // tramos con congestion (GeoJSON)
let avisoFijoHasta = 0;        // un aviso importante (parada alcanzada) no se pisa con "Quedan X km" durante unos segundos
let rutaDistTotal = 0, rutaTiempoTotal = 0;   // de la ultima ruta calculada, para poder escalar el tiempo que queda
let wps = [], rutaVersion = 0;   // wps = paradas intermedias pendientes, ordenadas a lo largo de la ruta
let offAcc = 0, lastRecalc = 0;
let follow = true, lastFix = null, heading = 0, speedKmh = 0;
let hud2 = null, hudAbierto = false, hudCargando = false, hudDemo = false;
let hud3dActivo = false, hud3dFallo = false;   // HUD 3D (opcional): ver bloque "HUD 3D" mas abajo
let mapaOculto = false;   // HUD 2: no existe hasta que se abre por primera vez
/* Zoom real de conduccion (el encuadre inicial de la ruta se aleja a proposito, pero el seguimiento
   no debe heredar ese alejamiento). Leaflet pide las teselas del nivel ENTERO mas cercano al zoom:
   17,4 sigue usando las teselas del 17 (solo se ven mas grandes: mismo coste que antes), mientras
   que 17,5 o mas ya pide las del 18 (el doble de teselas por pantalla). Por eso "Cerca" es 17,4. */
/* MapLibre cuenta el zoom con teselas de 512 px y Leaflet con 256: el mismo encuadre es UN nivel menos.
   Con la camara inclinada se ve mas carretera, asi que "Cerca" (17,4 en V2) queda en 17,2: el zoom que ya
   funciona bien en la app nueva en el Tesla. El resto de ajustes mantiene la misma separacion. */
const ZOOM_AJUSTE = 0.2;
let navZoom = 17.4 - ZOOM_AJUSTE;
let zoomManiobraOn = false;
/* Zoom por maniobra: al circular sin nada cerca, el zoom que hayas elegido en Ajustes
   (Lejos/Cerca/Muy cerca). Al acercarte a un giro o rotonda de verdad -a menos de 180 m-
   se acerca un paso mas, para ver mejor por donde hay que ir; al pasarlo, vuelve solo.
   Un "arrive"/"depart" no cuenta -- no son giros que necesiten verse de cerca. */
function actualizarZoomManiobra(distSiguiente, tipoSiguiente){
  if (mapaOculto || !follow) return;
  const cerca = distSiguiente < 180 && tipoSiguiente && tipoSiguiente !== 'arrive' && tipoSiguiente !== 'depart';
  if (cerca === zoomManiobraOn) return;
  zoomManiobraOn = cerca;
  camZoomObj = cerca ? Math.min(19.5, navZoom + 1.4) : navZoom;   // el bucle de camara lo suaviza
}

const VERSION = '2026.10.05-ml-a';
// X dibujada: el caracter U+2715 no esta en la fuente del navegador y salia como un rectangulo
const X_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 5L19 19M19 5L5 19" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
try{ $('ver').textContent = 'v'+VERSION; }catch(e){}
/* ---- Rumbo del GPS ---------------------------------------------------------
   ANTES: bearing entre este fix y el anterior (1 s antes). Con 1-2 m de ruido de posicion y
   14 m recorridos, eso baila 5-10 grados cada segundo -- medido en simulacion: una sacudida
   de mas de 2 grados cada 2 s en recta, y a paso lento el mapa daba vueltas (error de hasta
   160 grados). El suavizado solo se tragaba una parte. Era el "pequeno giro continuo".
   AHORA:
     1) el rumbo del propio receptor (coords.heading, por efecto Doppler: 1-3 grados de error),
        a partir de 1,5 m/s;
     2) si el navegador no lo da: bearing sobre una BASE LARGA (20-35 m, segun la velocidad),
        no entre dos fixes seguidos, y solo a partir de 3 m/s;
     3) si no hay rumbo fiable (parado, muy despacio) devuelve null y se conserva el anterior. */
let histFixes = [];
function rumboDelGPS(c, now, v){
  histFixes.push(now); if (histFixes.length > 14) histFixes.shift();
  if (Number.isFinite(c.heading) && v >= 1.5) return ((c.heading % 360) + 360) % 360;
  if (v < 3) return null;
  const base = Math.min(35, Math.max(20, v*4));
  for (let i = histFixes.length-2; i >= 0; i--){
    const f = histFixes[i];
    if (now.t - f.t > 12000) break;
    if (dist([f.lat, f.lon], [now.lat, now.lon]) >= base) return bearing([f.lat, f.lon], [now.lat, now.lon]);
  }
  return null;
}
function fmtDist(m){ return m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km'; }
function setStatus(t){ $('status').textContent = t; }

/* ---- Posicion MOSTRADA ajustada a la ruta ----------------------------------------------------
   El GPS cae unos metros a un lado de la linea (vas por el carril derecho, la linea es el eje de la
   via, y el GPS tiene su propio ruido lateral); con la camara inclinada ese desfase se ve como una
   flecha que "se sale por la derecha y vuelve". Con ruta activa, la flecha y el arranque de la
   linea se dibujan sobre el punto mas cercano de la ruta si esta a menos de SNAP_M metros; si no,
   la posicion real. SOLO es para dibujar: velocidad, progreso, radares y HUD siguen usando el fix real. */
const SNAP_M = 25;
function ajustarARuta(lat, lon){
  if (!routeOn || routeCoordsLL.length < 2) return [lat, lon];
  const kx = 111320*Math.cos(lat*Math.PI/180), ky = 110540;
  let mejor = null, md = 1e9;
  const i0 = Math.max(1, routeProgIdx - 5), i1 = Math.min(routeCoordsLL.length, routeProgIdx + 160);
  for (let i = i0; i < i1; i++){
    const a = routeCoordsLL[i-1], b = routeCoordsLL[i];
    const ax = (a[1]-lon)*kx, ay = (a[0]-lat)*ky, bx = (b[1]-lon)*kx, by = (b[0]-lat)*ky;   // el coche es el origen
    const dx = bx-ax, dy = by-ay, L2 = dx*dx + dy*dy;
    const t = L2 ? Math.max(0, Math.min(1, (-ax*dx - ay*dy)/L2)) : 0;
    const px = ax + t*dx, py = ay + t*dy, d = Math.hypot(px, py);
    if (d < md){ md = d; mejor = [lat + py/ky, lon + px/kx]; }
  }
  return (mejor && md <= SNAP_M) ? mejor : [lat, lon];
}

/* ---- GPS: mismo patron que index.html --------------------------------- */
if (navigator.geolocation){
  navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    const now = { lat: c.latitude, lon: c.longitude, t: p.timestamp };
    let v = c.speed; if (v==null || isNaN(v)){ if (lastFix){ const dt=(now.t-lastFix.t)/1000; v = dt>0.2 ? dist([lastFix.lat,lastFix.lon],[now.lat,now.lon])/dt : speedKmh/3.6; } else v = 0; }
    const rumbo = rumboDelGPS(c, now, v);
    if (rumbo !== null) heading = rumbo;      // si no hay un rumbo fiable, se conserva el anterior (el mapa no se mueve)
    speedKmh = Math.max(0, v*3.6);
    lastFix = now;
    // Intervalo real entre fixes; primer fix o senal perdida >10 s -> saltar (dt=0), no animar
    // desde la posicion vieja atravesando el mapa.
    const dtRaw = prevFixT ? (now.t - prevFixT)/1000 : null;
    prevFixT = now.t;
    const dt = (dtRaw === null || dtRaw > 10) ? 0 : Math.min(2, Math.max(0.1, dtRaw));
    // Con el HUD o Faro abiertos el mapa esta oculto (visibility:hidden), pero Leaflet
    // sigue funcionando entero detras si se le sigue mandando ordenes: panoramizar,
    // reproyectar, y sobre todo GIRAR (leaflet-rotate vuelve a dibujar TODAS las teselas
    // en cada grado) son trabajo real de verdad, para una pantalla que nadie ve. Con
    // Faro dando problemas de estabilidad en el Tesla a partir de unos segundos, esto
    // es lo primero que hay que descartar: se deja el mapa quieto del todo mientras
    // cualquiera de los dos este abierto, no solo con el HUD como hasta ahora.
    mapaOculto = hudAbierto || faroOn;
    const vis = ajustarARuta(now.lat, now.lon);   // posicion para DIBUJAR (ajustada a la ruta si la hay)
    nuevoTramoCoche([vis[1], vis[0]], mapaOculto ? 0 : dt);
    if (!mapaOculto){
      // El mapa gira con el rumbo (suavizado por actualizarBearing) o se queda al norte.
      camBearingObj = girarMapaOn ? actualizarBearing(heading, now.t) : 0;
      if (follow) seguirCamara(vis, dt);
    }
    if (hudAbierto && hud2 && !hud3dActivo){ try{ hud2.setSpeed(hudDemo ? Math.max(speedKmh/3.6, 15) : speedKmh/3.6); if (!hudDemo) hud2.syncPosition(now.lat, now.lon); }catch(e){} }
    if (hudAbierto && hud3dActivo) alimentarHud3D();
    $('spd').textContent = Math.round(speedKmh)+' km/h';
    $('spd2').textContent = Math.round(speedKmh);
    // Discreta: solo aparece cuando la precision es mala de verdad -- por debajo de
    // eso, ese numero no aporta nada la mayor parte del tiempo y solo ensucia la
    // pantalla. GPS "recuperandose" (>50 m) se distingue de "debil" (25-50 m).
    const accM = c.accuracy||0;
    const acc = $('acc');
    if (accM > 50){ acc.hidden = false; acc.textContent = '● GPS recuperándose'; acc.classList.add('malo'); }
    else if (accM > 25){ acc.hidden = false; acc.textContent = '● GPS débil'; acc.classList.remove('malo'); }
    else acc.hidden = true;
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
    // La velocidad Y el anillo de radar de Faro se pintan juntos, AQUI, justo despues de
    // updateRadar(): antes se pintaba la velocidad mas arriba, once lineas antes de que
    // hudRadarEstado se recalculara para este mismo tick -- llegaba siempre con el dato
    // de la posicion anterior, un paso tarde.
    if (faroOn) pintarFaro();
    if (listaCargOn && now.t - listaT > 4000){ listaT = now.t; renderLista(); }   // la lista sigue al coche, sin repintar en cada fix
    if (!lastOcmPos || dist([now.lat,now.lon], lastOcmPos) > 3000 || ahora-lastOcmAt > 180000){
      lastOcmAt = ahora; lastOcmPos = [now.lat, now.lon];
      fetchPois([now.lat, now.lon]);
    }
  }, e => setStatus('GPS: '+e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

let _dragCont = 0;   // cuenta los arrastres del usuario (para respetar que ha tomado el mapa)
map.on('dragstart', () => { follow = false; _dragCont++; });
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
    irA(destLL, destNombre, { conservarParadas:true, sinEncuadre:true }); return;
  }
  // siguiente maniobra: avance de paso con la distancia RECORRIDA real,
  // no una aproximacion -- routeCumDist se calcula una vez al recibir la
  // ruta y aqui solo se consulta.
  const recorrido = recorridoAhora();
  // Parada alcanzada: a menos de 50 m de sus coordenadas, O has pasado por su posicion sobre la
  // ruta. Lo segundo es imprescindible: un cargador suele estar a 50-150 m de la carretera (en un
  // aparcamiento) y la ruta llega a el por la via mas cercana, asi que solo mirar la distancia a
  // sus coordenadas podia no cumplirse nunca y dejar la parada pendiente para siempre.
  if (wps.length && (dist(here, wps[0].ll) < 50 || (wps[0].pos != null && recorrido >= wps[0].pos - 15))){
    const w = wps.shift(); pintarParadas(); setStatus('Parada alcanzada: ' + (w.nombre||''));
    avisoFijoHasta = performance.now() + 4000;   // sin esto, el "Quedan X km" de abajo lo borraba en el mismo instante
    if (listaCargOn) renderLista();
  }
  avanzarPaso(recorrido);
  renderStep();
  const sigMan = steps[stepIdx];
  if (sigMan) actualizarZoomManiobra(Math.max(0, (sigMan.metro||0) - recorrido), sigMan.maneuver && sigMan.maneuver.type);
  const dRem = Math.max(0, (routeCumDist[routeCumDist.length-1]||0) - recorrido);
  actualizarEta(dRem, rutaTiempoTotal * (rutaDistTotal ? dRem/rutaDistTotal : 0));
}
/* Tarjeta de ETA: distancia y minutos que quedan, y hora real de llegada. El tiempo
   restante se escala proporcionalmente al que dio TomTom para la ruta entera -- no es
   una nueva consulta de trafico en vivo, es una estimacion a partir de lo que ya
   tenemos, igual de valida para lo que se necesita aqui. */
function actualizarEta(distM, tiempoSeg){
  if (!routeOn){ $('etaCard').classList.remove('on'); return; }
  $('etaCard').classList.add('on');
  $('etaKm').textContent = fmtDist(distM);
  const min = Math.round(tiempoSeg/60);
  $('etaMin').textContent = min + ' min';
  const llegada = new Date(Date.now() + tiempoSeg*1000);
  $('etaLlegada').textContent = 'Llegada ' + String(llegada.getHours()).padStart(2,'0') + ':' + String(llegada.getMinutes()).padStart(2,'0');
}

/* ---- panel de maniobra: mismas funciones que AutoBoard (arrowSVG,
   roundaboutSVG, maneuverSVG), sin ningun adaptador de por medio -- el SVG
   generado se inyecta tal cual en el DOM.                                  */
/* Distancia recorrida a lo largo de la ruta, con la posicion REAL del coche
   proyectada sobre el tramo actual. Usar solo el vertice mas cercano
   (routeCumDist[routeProgIdx]) da saltos del tamano de la separacion entre
   vertices: en autopista TomTom deja cientos de metros entre puntos. */
/* Proyecta un punto sobre la ruta que queda por delante: distancia perpendicular y
   posicion a lo largo de ella (m desde el inicio, misma geometria que routeCumDist).
   Sirve para ordenar paradas y para saber que cargadores estan "en la ruta". */
function proyectarEnRuta(ll, maxAdelanteM){
  const n = routeCoordsLL.length; if (n < 2) return { d:1e9, along:0 };
  const i0 = Math.max(0, routeProgIdx), lim = maxAdelanteM ? routeCumDist[i0] + maxAdelanteM : Infinity;
  const mx = 111320*Math.cos(ll[0]*Math.PI/180), my = 110540, px = ll[1]*mx, py = ll[0]*my;
  let bd = 1e9, ba = 0;
  for (let i = i0; i < n-1; i++){
    if (routeCumDist[i] > lim) break;
    const a = routeCoordsLL[i], b = routeCoordsLL[i+1];
    const ax = a[1]*mx, ay = a[0]*my, dx = b[1]*mx - ax, dy = b[0]*my - ay, L2 = dx*dx + dy*dy;
    const tt = L2 ? Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy)/L2)) : 0;
    const d = Math.hypot(px - (ax + tt*dx), py - (ay + tt*dy));
    if (d < bd){ bd = d; ba = routeCumDist[i] + tt*Math.sqrt(L2); }
  }
  return { d:bd, along:ba };
}
function pintarParadas(){
  fuenteSet('paradas', { type:'FeatureCollection', features: wps.map(w => ({ type:'Feature', properties:{}, geometry:{ type:'Point', coordinates:[w.ll[1], w.ll[0]] } })) });
}
// Linea de la ruta que queda por delante (puntos ya en [lng,lat]) y tramos con congestion.
function setRutaDraw(coords){
  fuenteSet('ruta', coords && coords.length >= 2
    ? { type:'FeatureCollection', features:[{ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:coords } }] }
    : VACIO);
}
function pintarTrafico(){ fuenteSet('ruta-tramos', { type:'FeatureCollection', features: trafficFeatures }); }
/* Anade una parada intermedia. Sin ruta activa, el punto pasa a ser el destino. Se coloca
   en el orden que le toca a lo largo de la ruta actual (no siempre la primera). Si TomTom
   no consigue calcularla, la ruta anterior queda intacta. */
async function anadirParada(ll, nombre){
  if (!routeOn || !destLL) return irA(ll, nombre);
  if (wps.some(w => dist(w.ll, ll) < 60) || dist(destLL, ll) < 60){ setStatus('Ya es una parada de la ruta'); return; }
  const previas = wps.slice(), v0 = rutaVersion;
  wps.forEach(w => { w.pos = proyectarEnRuta(w.ll).along; });
  wps.push({ ll, nombre: nombre || 'Parada', pos: proyectarEnRuta(ll).along });
  wps.sort((a, b) => a.pos - b.pos);
  setStatus('Añadiendo parada: ' + (nombre || ''));
  await irA(destLL, destNombre, { conservarParadas:true, sinEncuadre:true });
  if (rutaVersion === v0){ wps = previas; pintarParadas(); setStatus('No se pudo añadir la parada'); }
}

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


/* ==== carriles: extraido literal de AutoBoard. Fuente APARTE de TomTom: una consulta
   de solo lectura al router publico de OSRM, pidiendo unicamente los cruces con
   informacion de carril (valido/no valido por carril, direccion de cada uno). No pide
   ruta -sigue siendo TomTom quien decide por donde ir-, solo la geometria de carriles
   en los cruces. Sin clave, gratuito, mismo servicio que ya usaba AutoBoard. */
let osrmLanes = [];
function pickDir(inds){ if(!inds||!inds.length)return 'straight'; let d=inds[inds.length-1]; if(d==='none')d=inds[0]; if(!d||d==='none')return 'straight'; d=d.replace('merge to left','slight left').replace('merge to right','slight right'); return d; }
async function fetchLanes(pts){
  osrmLanes = [];
  try{
    const coords = pts.map(p=>p[1]+','+p[0]).join(';');
    const r = await fetch('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=false&steps=true');
    const j = await r.json();
    if (!j.routes || !j.routes.length) return;
    const out = [];
    const avisos = [];   // fork / end of road / continue: cruces reales donde OSRM SI marca una decision, aunque sea "seguir recto"
    j.routes[0].legs.forEach(l => l.steps.forEach(st => {
      (st.intersections||[]).forEach(it => {
        if (it.lanes && it.lanes.length) out.push({ ll:[it.location[1],it.location[0]], lanes: it.lanes.map(la=>({valid:!!la.valid, dir:pickDir(la.indications)})) });
      });
      const m = st.maneuver||{}, mod = m.modifier||'';
      if (['fork','end of road','continue'].indexOf(m.type)>=0 && ['straight','slight left','slight right'].indexOf(mod)>=0 && m.location){
        avisos.push({ ll:[m.location[1],m.location[0]], modifier: mod });
      }
    }));
    osrmLanes = out;
    console.log('[carriles] cruces con datos de carril:', out.length, '| avisos de OSRM (fork/end of road/continue):', avisos.length);
    fusionarAvisosOSRM(avisos);
  }catch(e){ console.warn('[carriles]', e.message); }
}
/* Avisos de "sigue recto" en cruces reales que OSRM detecta y TomTom, a veces, no marca.
   Motor DISTINTO al de TomTom: su ruta puede no coincidir exactamente con la nuestra en
   algun tramo. Por eso cada aviso solo se acepta si cae de verdad ENCIMA de la ruta real
   (a menos de 30 m, perpendicular) -- si las rutas discrepan ahi, se descarta en vez de
   arriesgarse a avisar de un cruce por el que no se pasa. Tampoco se duplica un aviso
   pegado a una maniobra que TomTom ya iba a mostrar por su cuenta. */
function fusionarAvisosOSRM(avisos){
  if (!avisos.length || !routeCoordsLL.length) return;
  let anadidos = 0;
  for (const a of avisos){
    const pr = proyectarEnRuta(a.ll, 1e9);
    if (pr.d > 30) continue;                                              // no es un cruce de NUESTRA ruta
    if (steps.some(s => Math.abs((s.metro||0) - pr.along) < 60)) continue; // ya hay un aviso de TomTom ahi mismo
    steps.push({ metro: pr.along, calle:'', name:'', msg:'', ll:a.ll, hw:false,
      maneuver: { type:'turn', modifier: a.modifier }, deOSRM:true });
    anadidos++;
  }
  if (anadidos){
    steps.sort((x,y) => (x.metro||0) - (y.metro||0));
    ultimoStepPintado = '';                       // el indice de cada paso ha podido cambiar al reordenar: forzar redibujo
    avanzarPaso(recorridoAhora());                // recolocar stepIdx sobre la lista ya fusionada
    console.log('[carriles] avisos de OSRM añadidos a la ruta:', anadidos);
  }
}
function laneFor(ll){ if (!ll) return null; let best=null, bd=170; for (const e of osrmLanes){ const dd=dist(ll,e.ll); if(dd<bd){bd=dd;best=e;} } return best?best.lanes:null; }
function lanesHTML(lanes,hw){ return '<div class="lanerow">'+lanes.map(l=>laneArrow(l.dir,l.valid,hw)).join('')+'</div>'; }

let ultimoStepPintado = '';   // cadena vacia fuerza el primer dibujo; se resetea al calcular ruta nueva
function renderStep(){
  const s = steps[stepIdx]; if (!s) return;
  const nb = $('navbanner');
  nb.style.display = 'flex';
  const hw = !!s.hw || isHighway(s);
  const distAquiA = Math.max(0, (s.metro||0) - recorridoAhora());
  const lanes = (distAquiA < 600) ? laneFor(s.ll) : null;   // solo cerca de la maniobra: mas lejos no aporta y tapa la calle
  // El SVG (flecha/rotonda o carriles) y el nombre de la calle estan atados al PASO
  // y a si hay carriles o no -- mientras esa combinacion no cambie, siguen siendo
  // exactamente los mismos. Antes se regeneraba el SVG entero en cada posicion para
  // pintar, la mayoria de las veces, el mismo dibujo que ya habia.
  const clave = stepIdx + '|' + (lanes ? 'L' : 'M') + '|' + hw;
  if (clave !== ultimoStepPintado){
    ultimoStepPintado = clave;
    nb.classList.toggle('hw', hw);
    $('navarrow').innerHTML = lanes ? lanesHTML(lanes, hw) : maneuverSVG(s, hw);
    $('navsub').textContent = s.calle || s.msg || '';
  }
  $('navd').textContent = fmtDist(distAquiA);
}
function endRoute(){
  if (hudAbierto) cerrarHud();
  wps = []; pintarParadas(); zoomManiobraOn = false;
  routeOn = false; $('etaCard').classList.remove('on'); if (listaCargOn) setTimeout(renderLista, 0); steps = []; stepIdx = 0;
  setRutaDraw([]); trafficFeatures = []; pintarTrafico();
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
    if (routeOn && routeDraw.length){
      let lo=0, hi=routeDrawIdx.length-1;
      while (lo<hi){ const mid=(lo+hi)>>1; if (routeDrawIdx[mid]<routeProgIdx) lo=mid+1; else hi=mid; }
      const ahead = routeDraw.slice(lo); const vis = ajustarARuta(here[0], here[1]); ahead.unshift([vis[1], vis[0]]);
      if (ahead.length>=2) setRutaDraw(ahead);
    }
  }
}

/* ---- Trafico sobre la ruta ----------------------------------------------------------------
   TomTom devuelve, junto con la ruta, los tramos con retenciones (sectionType TRAFFIC) y su magnitud:
   1 leve -> AMARILLO, 2 moderada -> NARANJA, 3 grave / 4 cortada / velocidad 0 -> ROJO. Se pintan
   encima de la linea azul. Salen del trafico en tiempo real de TomTom: no es el color de CADA calle
   por su velocidad, sino los tramos en los que TomTom ha registrado retencion. */
function colorTramoTrafico(sec){
  const mag = sec.magnitudeOfDelay || 0;
  if (sec.simpleCategory === 'ROAD_CLOSURE' || sec.effectiveSpeedInKmh === 0 || mag >= 3) return '#ff2d2d';
  if (mag === 2) return '#ff9a1f';
  if (mag === 1) return '#ffd000';
  return null;
}
function tramosDeTrafico(route, pts){
  const out = [];
  (route.sections || []).forEach(sec => {
    if (sec.sectionType !== 'TRAFFIC') return;
    const a = sec.startPointIndex, b = sec.endPointIndex; if (a == null || b == null || b <= a) return;
    const seg = pts.slice(a, b+1); if (seg.length < 2) return;
    const col = colorTramoTrafico(sec); if (!col) return;
    out.push({ type:'Feature', properties:{ color:col }, geometry:{ type:'LineString', coordinates: seg.map(q => [q[1], q[0]]) } });
  });
  return out;
}
/* Actualizacion del trafico mientras conduces: cada 3 min se pide la ruta otra vez a TomTom SOLO para
   leer el trafico. Si la ruta nueva coincide con la que llevas (misma longitud restante y 12 puntos
   repartidos a menos de 25 m), se actualizan los colores y el tiempo restante; si es distinta, se IGNORA
   y se sigue con la tuya (nada de cambiar de ruta por sorpresa; para eso esta el recalculo por desvio). */
const TRAFICO_CADA_MS = 180000;
let trafUlt = 0, trafOcupado = false;
function mismaRuta(nuevos){
  if (nuevos.length < 2 || routeCoordsLL.length < 2) return false;
  const resto = (routeCumDist[routeCumDist.length-1] || 0) - recorridoAhora();
  let nl = 0; for (let i = 1; i < nuevos.length; i++) nl += dist(nuevos[i-1], nuevos[i]);
  if (Math.abs(nl - resto) > Math.max(200, resto*0.03)) return false;
  const n = 12;
  for (let k = 1; k <= n; k++){
    const q = nuevos[Math.min(nuevos.length-1, Math.round(k*(nuevos.length-1)/n))];
    let md = 1e9;
    for (let i = Math.max(1, routeProgIdx-5); i < routeCoordsLL.length; i++){
      const dd = segDistM(q, {lat:routeCoordsLL[i-1][0], lon:routeCoordsLL[i-1][1]}, {lat:routeCoordsLL[i][0], lon:routeCoordsLL[i][1]});
      if (dd < md) md = dd; if (md < 25) break;
    }
    if (md >= 25) return false;
  }
  return true;
}
async function refrescarTrafico(forzar){
  if (!routeOn || !lastFix || !destLL || trafOcupado) return;
  if (!forzar && performance.now() - trafUlt < TRAFICO_CADA_MS) return;
  trafOcupado = true;
  const ver0 = rutaVersion;
  try{
    const locs = lastFix.lat+','+lastFix.lon + wps.map(w => ':'+w.ll[0]+','+w.ll[1]).join('') + ':'+destLL[0]+','+destLL[1];
    const r = await fetch('https://api.tomtom.com/routing/1/calculateRoute/'+locs+'/json?key='+TT
      +'&traffic=true&travelMode=car&instructionsType=text&language=es-ES&sectionType=traffic');
    const j = await r.json();
    const route = j.routes && j.routes[0];
    if (!route || !routeOn || ver0 !== rutaVersion) return;   // ruta cancelada o cambiada mientras tanto
    const pts = []; route.legs.forEach(leg => leg.points.forEach(q => pts.push([q.latitude, q.longitude])));
    trafUlt = performance.now();
    if (!mismaRuta(pts)){ console.log('[trafico] TomTom propone otra ruta: se conserva la actual'); return; }
    trafficFeatures = tramosDeTrafico(route, pts); pintarTrafico();
    if (route.summary){ rutaTiempoTotal = route.summary.travelTimeInSeconds; rutaDistTotal = route.summary.lengthInMeters; }
    console.log('[trafico] actualizado:', trafficFeatures.length, 'tramos con retencion');
  }catch(e){ console.warn('[trafico]', e.message); }
  finally{ trafOcupado = false; }
}
setInterval(() => { if (!document.hidden) refrescarTrafico(false); }, 30000);

/* ---- ruta: mismo endpoint y parametros que AutoBoard, con guidance ------ */
let destNombre = '';
/* opc.conservarParadas: recalculo o parada nueva -> se mantienen las paradas pendientes.
   Un destino NUEVO (buscador, favorito, "Ir") empieza un viaje nuevo y las borra.
   opc.sinEncuadre: no alejar el mapa a ver la ruta entera (2 s de zoom fuera) -- para los
   recalculos y las paradas que se anaden CONDUCIENDO, donde eso solo molesta. */
async function irA(destino, nombre, opc){
  opc = opc || {};
  if (!opc.conservarParadas) wps = [];
  destNombre = nombre || '';
  if (!lastFix){ setStatus('Sin GPS todavia'); return; }
  setStatus('Calculando ruta…');
  const t0 = performance.now();
  try{
    const locs = lastFix.lat+','+lastFix.lon + wps.map(w => ':'+w.ll[0]+','+w.ll[1]).join('') + ':'+destino[0]+','+destino[1];
    const url = 'https://api.tomtom.com/routing/1/calculateRoute/'+locs+'/json?key='+TT
      +'&traffic=true&travelMode=car&instructionsType=text&language=es-ES&sectionType=traffic';
    const r = await fetch(url);
    const j = await r.json();
    if (!j.routes || !j.routes.length){ setStatus('Sin ruta'); return; }
    const route = j.routes[0];
    const pts = [];
    route.legs.forEach(leg => leg.points.forEach(p => pts.push([p.latitude, p.longitude])));
    routeCoordsLL = pts; routeProgIdx = 0; destLL = destino; routeOn = true; rutaVersion++;

    routeCumDist = [0];
    for (let i=1;i<pts.length;i++) routeCumDist.push(routeCumDist[i-1] + dist(pts[i-1], pts[i]));

    const sim = simplificarDP(pts, 3);
    routeDraw = sim.p; routeDrawIdx = sim.i;
    console.log('[ruta] puntos TomTom:', pts.length, '→ dibujados:', routeDraw.length,
      '('+Math.round(100-routeDraw.length/Math.max(1,pts.length)*100)+'% menos)');

    setRutaDraw(routeDraw);

    // Tramos de congestion sobre la propia ruta, extraido literal de AutoBoard.
    trafficFeatures = tramosDeTrafico(route, pts); trafUlt = performance.now();
    pintarTrafico();
    if (trafficFeatures.length) console.log('[ruta] tramos de trafico:', trafficFeatures.length);

    steps = (route.guidance && route.guidance.instructions || []).map(it => {
      const refs = (it.roadNumbers||[]).join(' ');
      // La posicion de la maniobra se mide sobre la MISMA geometria con la que se mide la
      // distancia recorrida (routeCumDist), usando pointIndex. routeOffsetInMeters lo mide
      // TomTom con su propia regla: si difiere aunque sea un 1 %, el error crece con los
      // km recorridos y acaba recortando la distancia a "0 m" durante todo el tramo previo
      // a cada maniobra. Solo se usa el desplazamiento de TomTom si pointIndex falta o no
      // cuadra con el (por si en alguna ruta viniera relativo a otra cosa).
      const off = it.routeOffsetInMeters, pi = it.pointIndex;
      const porIndice = (Number.isInteger(pi) && pi >= 0 && pi < routeCumDist.length) ? routeCumDist[pi] : null;
      const metroFinal = (porIndice !== null && (off == null || Math.abs(porIndice - off) <= Math.max(300, off*0.1))) ? porIndice : (off||0);
      return {
        metro: metroFinal, calle: it.street||'', name: it.street||'', msg: it.message||'',
        maneuver: ttMan(it), ll: it.point ? [it.point.latitude, it.point.longitude] : null,
        // igual que AutoBoard real: hay que mirar el nombre Y las referencias (A-8, AP-8...)
        hw: isHighway({name: it.street||''}) || isHighway({name: refs}) || /\b(A|AP|E)-?\d/i.test(refs)
      };
    });
    console.log('[ruta] maniobras (m desde el inicio):', steps.map(s=>Math.round(s.metro)).join(' · '),
      '| geometria:', Math.round(routeCumDist[routeCumDist.length-1]), 'm | TomTom dice:', route.summary.lengthInMeters, 'm');
    stepIdx = 0; ultimoStepPintado = ''; avanzarPaso(0);   // se salta la instruccion de salida (punto a 0 m): se empieza en la primera maniobra real -- ultimoStepPintado se resetea para que un recalculo SIEMPRE redibuje, aunque stepIdx vuelva a coincidir con el mismo numero de antes

    cerrarBuscador();
    renderStep();

    if (!opc.sinEncuadre){
      // Vista general PLANA de la ruta entera (sin el desplazamiento del coche) y, a los 2 s, de vuelta al seguimiento.
      follow = false; const dc0 = _dragCont;
      map.setPadding({ top:0, bottom:0, left:0, right:0 });
      const b = new maplibregl.LngLatBounds(); pts.forEach(p => b.extend([p[1], p[0]]));
      map.fitBounds(b, { padding:{ top:110, bottom:110, left:60, right:60 }, maxZoom:15, pitch:0, bearing:0, duration:800 });
      setTimeout(() => {
        if (_dragCont !== dc0) return;   // el usuario esta moviendo el mapa: no se le quita; el boton de centrar lo devuelve al coche
        follow = true; zoomPendiente = true; if (lastFix) seguirCamara([lastFix.lat, lastFix.lon], 0);   // (el salto trae el padding del coche)
      }, 2000);
    }

    const ms = Math.round(performance.now()-t0);
    rutaDistTotal = route.summary.lengthInMeters || 1; rutaTiempoTotal = route.summary.travelTimeInSeconds || 0;
    try{ fetchLanes(pts); }catch(e){ console.warn('[carriles]', e.message); }
    setStatus('Ruta calculada en '+ms+' ms'+(wps.length ? ' · '+wps.length+(wps.length>1?' paradas':' parada') : ''));
    actualizarEta(rutaDistTotal, rutaTiempoTotal);
    wps.forEach(w => { w.pos = proyectarEnRuta(w.ll).along; });   // donde cae cada parada sobre esta ruta
    pintarParadas(); if (listaCargOn) renderLista();
    if (destNombre && !opc.conservarParadas) guardarReciente(destNombre, destino);
    if (hud2){ if (hudAbierto) hudDemo = false; ponerRutaEnHud(); }   // el HUD ya cargado recibe la ruta nueva (o el recalculo); deja el trazado de ejemplo
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
    '<div class="favrow" data-i="'+i+'">⭐ '+(f.nombre||'Favorito')+'<span style="margin-left:auto;color:#9aa7b2;display:flex;padding:6px" data-del="'+i+'">'+X_SVG+'</span></div>'
  ).join('') || '<div style="color:#9aa7b2;font-size:12px;padding:6px">Sin favoritos todavia</div>';
  $('favList').querySelectorAll('[data-i]').forEach(el => el.onclick = (e) => {
    const del = e.target.closest ? e.target.closest('[data-del]') : null;   // el toque cae en el svg, no en el span
    if (del){
      const favs2 = cargarFavs(); favs2.splice(+del.dataset.del, 1); guardarFavs(favs2); renderFavs(); return;
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
let trafficOn = false;
function setTraffic(on){
  trafficOn = on;
  try{ if (estiloListo && map.getLayer('flujo')) map.setLayoutProperty('flujo', 'visibility', on ? 'visible' : 'none'); }catch(e){}
  $('trafficBtn').classList.toggle('on', trafficOn);
}
$('trafficBtn').onclick = () => setTraffic(!trafficOn);

/* Radares y cargadores por tipo/franja: cada casilla se activa o desactiva por su
   cuenta -- se puede dejar solo un tipo, dos, o todos a la vez. */
['fijo','movil','tramo','semaforo'].forEach(t => {
  $('rt_'+t).onchange = e => { radarTiposOn[t] = e.target.checked; drawRadars(); };
});
['amarillo','azul','verde','tesla'].forEach(t => {
  $('ct_'+t).onchange = e => { cargadorTiposOn[t] = e.target.checked; drawChargers(); };
});

function pintarBotonGiro(){
  const b = $('rotateBtn');
  if (!girarMapaDisponible){ b.textContent = '🧭 Girar mapa (no disponible)'; b.classList.remove('on'); return; }
  b.textContent = girarMapaOn ? '🧭 Quitar giro de mapa' : '🧭 Girar mapa';
  b.classList.toggle('on', girarMapaOn);
}
pintarBotonGiro();
$('zoomSeg').onclick = e => {
  const b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
  navZoom = +b.dataset.z - ZOOM_AJUSTE;
  $('zoomSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  zoomPendiente = true;                                            // el siguiente seguimiento fuerza el zoom nuevo
  if (follow && lastFix && !hudAbierto) seguirCamara([lastFix.lat, lastFix.lon], 0);   // y si estas siguiendo, se aplica ya
};
$('rotateBtn').onclick = () => {
  girarMapaOn = !girarMapaOn;
  pintarBotonGiro();
  if (!girarMapaOn){ bearingMostrado = 0; bearingPendienteDesde = null; bearingSalto = null; }
  camBearingObj = girarMapaOn ? bearingMostrado : 0;   // el bucle de camara lo suaviza
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
/* Trazado de ejemplo (el mismo de hud2-boot.js): recta larga y curvas amplias, sin
   rotondas. Asi el HUD SIEMPRE dibuja algo al abrirlo, con o sin ruta activa, y se puede
   comprobar el dibujo sin tener que calcular una ruta antes. */
function rutaDemo(){
  const R = 6378137, LAT0 = 43.3320, LNG0 = -3.1090, c0 = Math.cos(LAT0*Math.PI/180);
  const toLL = (x,z) => [LAT0 + z/R*180/Math.PI, LNG0 + x/(R*c0)*180/Math.PI];
  const d = []; let x = 0, z = 0, h = 0;
  const tramo = (dist, k) => { const n = Math.round(dist/4); for (let i=0;i<n;i++){ h += k*4; x += Math.sin(h)*4; z += Math.cos(h)*4; d.push(toLL(x,z)); } };
  d.push(toLL(0,0));
  tramo(800,0); tramo(460,0.0011); tramo(340,0); tramo(420,-0.0013); tramo(300,0);
  tramo(520,0.0008); tramo(360,-0.0009); tramo(400,0); tramo(440,0.0015); tramo(320,-0.0006); tramo(380,0.0010); tramo(300,-0.0012); tramo(700,0);
  return d;
}
/* Cartel rojo con el error REAL. hud2.js avisa de sus fallos por api.onError; si nadie
   escucha, solo van a la consola y el HUD se queda en una pantalla oscura sin explicacion
   -- que es lo que pasaba. hud2-boot.js si lo escuchaba; el puente no. */
function avisoHud(msg){ const e = $('hud2err'); if (e.textContent !== msg) e.textContent = msg; e.style.display = msg ? 'block' : 'none'; }
function marcarPestana(cual){ ['tabMapa','tabHud','tabFaro'].forEach(id => $(id).classList.toggle('on', id === cual)); }

/* ==== HUD 3D (opcional) =======================================================
   Coche en 3D (Three.js + hud3d/car.glb) que sigue el rumbo del mapa: cuando el mapa gira, la
   carretera se curva y el coche se inclina un poco, solo para dar sensacion realista (no es la
   geometria exacta). Vive en hud3d/ y se descarga SOLO al abrir el HUD con el ajuste activado.
   Seguridad: si falla WebGL, si falta algo, o si los FPS bajan de 18 durante unos segundos, se
   vuelve solo al HUD 2 de siempre (hud3dFallo=true hasta recargar). Mapa y navegacion no cambian. */
const HUD3D_BASE = RAIZ + 'hud3d/';
function h3dPreferido(){ try{ return localStorage.getItem('hud3dOn') !== '0'; }catch(e){ return true; } }
function noche3D(){ const t = h3dCfg.theme; if (t === 'night') return true; if (t === 'auto'){ const h = new Date().getHours(); return h >= 21 || h < 7; } return false; }
function cargarScript3D(u){ return new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = u; sc.onload = ok; sc.onerror = () => ko(new Error('no se pudo cargar ' + u)); document.head.appendChild(sc); }); }
function alimentarHud3D(){
  if (!hud3dActivo || !window.HUD3D) return;
  let hw = false; try{ const st = routeOn ? steps[stepIdx] : null; hw = !!(st && (st.hw || isHighway(st))); }catch(e){}
  // road: no se manda; el modulo decide solo (autovia de la ruta, o >=100 km/h sostenidos). brake: tampoco, lo deduce de la deceleracion y de estar parado.
  try{ HUD3D.update({ speed: speedKmh, head: heading, t: performance.now()/1000, hw: (routeOn && hw) ? true : undefined, rain: !!h3dCfg.rain, night: noche3D() }); }catch(e){}
}
async function intentar3D(){
  if (hud3dFallo || !h3dPreferido()) return false;
  try{
    if (!window.HUD3D) await cargarScript3D(HUD3D_BASE + 'hud3d.js?v=' + VERSION);   // la version en la URL evita que el navegador sirva un hud3d.js viejo
    await HUD3D.init({ base: HUD3D_BASE, host: $('hud2wrap'), z: 1,
      onSlow: fps => { hud3dFallo = true; console.warn('[hud3d] FPS bajos:', fps); setStatus('HUD 3D lento (' + fps + ' fps): vuelvo al HUD 2'); if (hudAbierto){ cerrarHud(); abrirHud(); } } });
    aplicarCfg3D();
    $('hud2canvas').style.visibility = 'hidden';
    hud3dActivo = true;      // se muestra en abrirHud(), cuando #hud2wrap ya es visible (si no, mide 0x0 y no dibuja nada)
    return true;
  }catch(e){
    console.warn('[hud3d] no disponible, uso el HUD 2:', e.message); hud3dFallo = true; hud3dActivo = false;
    try{ if (window.HUD3D && HUD3D.hide) HUD3D.hide(); }catch(er){}
    return false;
  }
}

async function abrirHud(){
  if (hudAbierto || hudCargando) return;
  if (faroOn) cerrarFaro();
  hudCargando = true; setStatus('Cargando HUD 2…'); avisoHud('');
  try{
    hud3dActivo = await intentar3D();
    if (!hud3dActivo && !hud2){
      const mod = await import(RAIZ + 'hud2.js');
      hud2 = mod.createHud2($('hud2canvas'), Object.assign({}, hudCfg));   // escala 0,6 = el 36 % de los pixeles, como en AutoBoard
      aplicarFotoAlMotor();                                                   // tu coche, si lo elegiste
      hud2.onError = err => { console.error('[hud2]', err); avisoHud('HUD 2: ' + (err && err.message ? err.message : err)); };
      console.log('[hud2] motor version', hud2.version);
    }
    $('hud2wrap').classList.add('on');
    if (hud3dActivo){ try{ HUD3D.show(); alimentarHud3D(); }catch(e){ console.warn('[hud3d] show:', e.message); } }
    hudAbierto = true;
    $('map').style.visibility = 'hidden';                        // mapa fuera de juego mientras el HUD esta abierto
    // Si al cerrar la ultima vez se encogio el lienzo a 1x1 para liberar memoria de
    // video (ver cerrarHud), hay que devolverle su tamano real ANTES de resize(), o
    // reconstruiria el buffer con un lienzo practicamente vacio.
    if (!hud3dActivo){
    const cv = $('hud2canvas');
    if (cv && cv.width <= 2 && cv.__w){ try{ cv.width = cv.__w; cv.height = cv.__h; }catch(e){} }
    hud2.resize();
    hudDemo = !(routeOn && routeCoordsLL.length >= 8);
    if (hudDemo){ try{ hud2.setRoute(rutaDemo()); hud2.setManeuvers([]); }catch(e){ hud2.onError(e); } }
    else ponerRutaEnHud();
    hud2.start();
    if (lastFix && !hudDemo){ hud2.setSpeed(speedKmh/3.6); hud2.syncPosition(lastFix.lat, lastFix.lon); }
    }
    marcarPestana('tabHud'); $('settings').classList.remove('open');
    setStatus(hud3dActivo ? 'HUD 3D activo' : hudDemo ? 'HUD 2: sin ruta activa, trazado de ejemplo' : 'HUD 2 activo');
  }catch(e){
    console.warn('[hud2]', e);
    hudAbierto = false; hudDemo = false; $('hud2wrap').classList.remove('on'); $('map').style.visibility = '';
    if (hud3dActivo){ try{ HUD3D.hide(); }catch(er){} hud3dActivo = false; } $('hud2canvas').style.visibility = '';
    marcarPestana('tabMapa');
    avisoHud('No se pudo abrir el HUD 2: ' + e.message + '. Comprueba que hud2.js esta en la raiz del repositorio.');
    setStatus('HUD 2 no disponible');
  }finally{ hudCargando = false; }
}
function cerrarHud(){
  if (!hudAbierto) return;
  if (hud3dActivo){ try{ HUD3D.hide(); }catch(e){} hud3dActivo = false; $('hud2canvas').style.visibility = ''; }   // el 3D deja de renderizar
  try{ hud2.stop(); }catch(e){}
  // LIBERAR MEMORIA DE VIDEO: parar el bucle no basta, el lienzo sigue reservando su
  // buffer entero aunque este oculto. Encogerlo a 1x1 devuelve esa memoria al
  // navegador -- esto es lo que hacia el hud2-boot.js original y a mi puente se le
  // habia quedado fuera. Sin esto, cada apertura/cierre del HUD dejaba el buffer
  // completo reservado, sin liberar nunca nada.
  const cv = $('hud2canvas');
  if (cv){ try{ cv.__w = cv.width; cv.__h = cv.height; cv.width = 1; cv.height = 1; }catch(e){} }
  $('hud2wrap').classList.remove('on'); $('map').style.visibility = ''; avisoHud('');
  hudAbierto = false; hudDemo = false; marcarPestana('tabMapa');
  follow = true; zoomPendiente = true; if (lastFix) seguirCamara([lastFix.lat, lastFix.lon], 0);   // el mapa vuelve donde esta el coche
  restaurarCapas('hud');
  fpsArrancar();
}

/* ==== Faro: pantalla limpia, extraida de la version YA INTEGRADA de AutoBoard (el
   body.faro/#hudclean real, no el archivo faro/index.html suelto, que es un secundario
   mas simple). No navega a ningun sitio: alterna un estado dentro de la misma app, la
   ruta sigue activa debajo. El numero se convierte en la propia senal de radar -- mismo
   color por tipo, mismo parpadeo -- cuando vas por encima del limite cerca de uno, asi
   que no hace falta el aviso aparte encima de una pantalla que ya deberia estar limpia. */
let faroOn = false, faroBlinkT = 0;
function pintarFaro(){
  const spd = Math.round(speedKmh);
  const wrap = $('fSpeed');
  $('fNum').textContent = spd;
  wrap.classList.toggle('sign', hudRadarEstado.cerca);              // radar cerca: se convierte en senal (con o sin exceso)
  wrap.classList.toggle('alerta', hudRadarEstado.active);           // exceso real: parpadea en rojo
  wrap.style.borderColor = hudRadarEstado.active ? radarColor(hudRadarEstado.type) : (hudRadarEstado.cerca ? '#8a939c' : '');
}
function abrirFaro(){
  if (faroOn) return;
  if (hudAbierto) cerrarHud();
  faroOn = true;
  document.documentElement.classList.add('faromode');   // esconde todo lo demas por CSS: solo velocidad, radares y borde rojo
  $('faroWrap').classList.add('on');
  $('map').style.visibility = 'hidden';
  pintarFaro();
  marcarPestana('tabFaro');
}
function cerrarFaro(){
  if (!faroOn) return;
  faroOn = false;
  document.documentElement.classList.remove('faromode');
  $('faroWrap').classList.remove('on'); $('map').style.visibility = '';
  marcarPestana('tabMapa');
  fpsArrancar();
  follow = true; zoomPendiente = true; if (lastFix) seguirCamara([lastFix.lat, lastFix.lon], 0);
  restaurarCapas('faro');
}
setInterval(() => { if (!faroOn) return; faroBlinkT = !faroBlinkT; $('fSpeed').classList.toggle('blink', faroBlinkT && $('fSpeed').classList.contains('alerta')); }, 450);

/* Pestañas de modo, arriba a la izquierda: Mapa / HUD arriba, Faro debajo. Faro es una
   pagina independiente que aun no se ha migrado, asi que por ahora se abre tal cual. */
$('tabMapa').onclick = () => { if (hudAbierto) cerrarHud(); if (faroOn) cerrarFaro(); };
$('tabHud').onclick  = () => { if (faroOn) cerrarFaro(); if (hudAbierto) return; abrirHud(); };
$('tabFaro').onclick = () => { if (faroOn){ cerrarFaro(); return; } abrirFaro(); };
$('hud2err').onclick = () => avisoHud('');


/* ==== mantener pulsado el mapa / tocar un cargador -> hoja con "Ir" ==========
   Como en AutoBoard: pulsacion larga de 550 ms (se cancela si mueves el dedo mas de
   10 px o si son dos dedos) y tocar un cargador. En vez de un popup de Leaflet, una
   hoja inferior propia: queda siempre recta aunque el mapa gire, con botones grandes. */
let pinTemp = null, tHoja = 0, tokenHoja = 0;
function ponerPin(ll){
  fuenteSet('pin', { type:'FeatureCollection', features:[{ type:'Feature', properties:{}, geometry:{ type:'Point', coordinates:[ll[1], ll[0]] } }] });
}
function quitarPin(){ fuenteSet('pin', VACIO); }
function abrirHoja(titulo, info, botones, ll){
  tHoja = Date.now();
  $('hojaTitulo').textContent = titulo;
  $('hojaInfo').textContent = info || ''; $('hojaInfo').style.display = info ? 'block' : 'none';
  const cont = $('hojaBtns'); cont.innerHTML = '';
  botones.forEach(b => {
    const el = document.createElement('button'); el.textContent = b.txt; el.className = 'hb ' + (b.clase||'');
    el.onclick = () => { cerrarHoja(); b.fn(); }; cont.appendChild(el);
  });
  $('hoja').classList.add('on'); if (ll) ponerPin(ll);
}
function cerrarHoja(){ tokenHoja++; $('hoja').classList.remove('on'); quitarPin(); }
$('hojaCerrar').onclick = cerrarHoja;
function guardarFavDirecto(nombre, ll){
  const f = cargarFavs(); if (!f.some(x => x.nombre === nombre)) { f.push({nombre, ll}); guardarFavs(f); }
  setStatus('⭐ Guardado: ' + nombre);
}
// cargador mas cercano al punto tocado, a menos de px pixeles de PANTALLA (cuenta bien aunque el mapa este girado)
function cargadorCerca(ll, px){
  const c0 = aXY(ll); let best = null, bd = px;
  for (const p of pois){ if (p.type !== 'charge') continue;
    const c = aXY(p.ll); const d = Math.hypot(c.x-c0.x, c.y-c0.y);
    if (d < bd){ bd = d; best = p; } }
  return best;
}
function hojaCargador(p){
  const partes = []; if (p.op) partes.push(p.op); if (p.kw) partes.push(p.kw+' kW'); if (p.socks && p.socks.length) partes.push(p.socks.slice(0,3).join(', '));
  const nombre = p.name || 'Punto de carga';
  abrirHoja(nombre, partes.join(' · ') || 'Sin datos de potencia ni compañía', [
    { txt:'Ir', fn:() => irA(p.ll, nombre) },
    ...(routeOn ? [{ txt:'+ Parada', clase:'sec', fn:() => anadirParada(p.ll, nombre) }] : []),
    { txt:'⭐ Guardar', clase:'sec', fn:() => guardarFavDirecto(nombre, p.ll) }
  ], p.ll);
}
function hojaPunto(lat, lon){
  let nombre = 'Punto del mapa'; const tk = ++tokenHoja;
  abrirHoja('Este punto', '', [
    { txt:'Ir aquí', fn:() => irA([lat,lon], nombre) },
    ...(routeOn ? [{ txt:'+ Parada', clase:'sec', fn:() => anadirParada([lat,lon], nombre) }] : []),
    { txt:'⭐ Guardar', clase:'sec', fn:() => guardarFavDirecto(nombre, [lat,lon]) }
  ], [lat,lon]);
  tokenHoja = tk;   // abrirHoja no debe invalidar la busqueda de nombre que acabamos de lanzar
  // nombre real de la calle, en segundo plano: la hoja ya esta abierta y usable
  fetch('https://api.tomtom.com/search/2/reverseGeocode/'+lat+','+lon+'.json?key='+TT+'&language=es-ES&radius=60')
    .then(r => r.json()).then(j => {
      const a = j && j.addresses && j.addresses[0] && j.addresses[0].address;
      const txt = a && (a.freeformAddress || a.streetName);
      if (tk !== tokenHoja || !txt) return;
      nombre = txt.split(',').slice(0,3).join(',').trim(); $('hojaTitulo').textContent = nombre;
    }).catch(() => {});
}
function pulsacionLarga(ll){
  if (Date.now() - tHoja < 800) return;                 // touch + contextmenu disparan los dos: solo uno
  const p = cargadorCerca(ll, 38);
  if (p) hojaCargador(p); else hojaPunto(ll.lat, ll.lng);
}
map.on('click', e => {
  if (Date.now() - tHoja < 700) return;                 // el "click" que algunos navegadores sueltan al levantar el dedo tras una pulsacion larga
  const p = cargadorCerca(e.lngLat, 36);
  if (p) hojaCargador(p); else if ($('hoja').classList.contains('on')) cerrarHoja();
});
map.on('contextmenu', e => pulsacionLarga(e.lngLat));   // raton (escritorio)
(function(){                                            // tactil, igual que AutoBoard
  const cont = map.getContainer(); let tmr = null, movido = false, sx = 0, sy = 0;
  const limpiar = () => { if (tmr){ clearTimeout(tmr); tmr = null; } };
  cont.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1){ limpiar(); return; }
    movido = false; const t0 = e.touches[0]; sx = t0.clientX; sy = t0.clientY; limpiar();
    tmr = setTimeout(() => { if (movido) return; const r = cont.getBoundingClientRect(); pulsacionLarga(map.unproject([sx - r.left, sy - r.top])); }, 550);
  }, {passive:true});
  cont.addEventListener('touchmove', e => { const t1 = e.touches && e.touches[0]; if (t1 && (Math.abs(t1.clientX-sx) > 10 || Math.abs(t1.clientY-sy) > 10)){ movido = true; limpiar(); } }, {passive:true});
  cont.addEventListener('touchend', limpiar, {passive:true}); cont.addEventListener('touchcancel', limpiar, {passive:true});
})();

/* ==== ajustes del HUD 2 (engranaje bajo "Mapa") ==============================
   Solo los controles que se notan de verdad conduciendo, del panel original de
   hud2-boot.js. Como el resto de ajustes de la app: valen para esta sesion, no se
   guardan de un dia para otro. Se aplican en caliente con hud2.set(). */
/* El mapa de Leaflet ya se para del todo con el HUD abierto (verificado). Si el HUD sigue
   dando problemas de estabilidad en el Tesla, lo que queda trabajando de mas es el propio
   motor de dibujo -- su escena en marcha sin parar. Por defecto mas ligero: fps limitados
   a 30 en vez de sin tope, perfil "ligero" en vez de "auto" (el auto-detectado del motor
   puede no identificar bien el Tesla como un equipo modesto), y resolucion al 45% en vez
   del 60%. Se puede subir a mano en Ajustes si el Tesla lo aguanta de sobra. */
const HUD_DEF = { theme:'auto', maxFps:30, escala:0.45, perfil:'ligero', estilo:'suave', radioMin:130,
  carScale:1, hudScale:1, vista:1, hud:false, carteles:true, carColor:'#eef1f4', ambiente:true, detalleCoche:true,
  rain:false, spray:true, rotondaInvertida:false, frenarCamara:false, traffic:'off' };
const HUD_NUM = ['maxFps','escala'];
function cargarHudCfg(){
  try{ const g = JSON.parse(localStorage.getItem('hudCfgLT')||'null'); return g ? Object.assign({}, HUD_DEF, g) : Object.assign({}, HUD_DEF); }
  catch(e){ return Object.assign({}, HUD_DEF); }
}
let hudCfg = cargarHudCfg();   // la configuracion del HUD se guarda de una sesion a otra -- tamano, coche, todo
/* ==== Ajustes del HUD 3D ======================================================
   Sustituyen a los del HUD 2 (que queda solo como respaldo si el 3D no puede arrancar).
   Se guardan aparte ('hud3dCfg') y se aplican al modulo con HUD3D.configure(). */
const H3D_DEF = { theme:'auto', carColor: hudCfg.carColor || '#8f979e', road:'auto', env:'auto', dens:2, lane:'right',
  quality:0, vista:1, carScale:1, curva:2, interior:true, signs:true, rain:false, spray:true };
const H3D_NUM = ['dens','quality','curva','vista','carScale'];
function cargarH3dCfg(){
  try{ const g = JSON.parse(localStorage.getItem('hud3dCfg')||'null'); return g ? Object.assign({}, H3D_DEF, g) : Object.assign({}, H3D_DEF); }
  catch(e){ return Object.assign({}, H3D_DEF); }
}
let h3dCfg = cargarH3dCfg();
function aplicarCfg3D(){
  if (!window.HUD3D) return;
  try{
    HUD3D.setBodyColor(h3dCfg.carColor);
    HUD3D.configure({ road:h3dCfg.road, env:h3dCfg.env, dens:h3dCfg.dens, lane:h3dCfg.lane, quality:h3dCfg.quality, vista:h3dCfg.vista,
      carScale:h3dCfg.carScale, curva:h3dCfg.curva, interior:h3dCfg.interior, signs:h3dCfg.signs, spray:h3dCfg.spray });
  }catch(e){ console.warn('[hud3d] ajustes:', e.message); }
}
function h3dSet(k, v){
  h3dCfg[k] = v;
  try{ localStorage.setItem('hud3dCfg', JSON.stringify(h3dCfg)); }catch(e){}
  if (!hud3dActivo || !window.HUD3D) return;     // si el HUD no esta abierto, se aplican al abrirlo
  try{ if (k === 'carColor') HUD3D.setBodyColor(v); else if (k !== 'theme' && k !== 'rain') HUD3D.configure({[k]: v}); alimentarHud3D(); }catch(e){}
}
/* Foto del coche, como en AutoBoard. Lo unico que se recuerda de un dia para otro es la URL
   de la foto del repositorio (una cadena corta): repetir la eleccion cada vez seria un
   fastidio, y es una preferencia de identidad mas que un ajuste. Una foto cargada desde el
   telefono se aplica solo en esta sesion: como PNG en base64 no cabe en localStorage
   (AutoBoard tampoco podia guardarla). */
let hudFotoUrl = ''; try{ hudFotoUrl = urlRepo(localStorage.getItem('carFotoLT') || ''); }catch(e){}
let hudFotoSesion = null, hudFotoOrig = null, hudFotoEstado = '';
const HUD_COLORES = [['#eef1f4','Blanco'],['#c3c9ce','Aluminio'],['#8f979e','Gris'],['#5a6169','Grafito'],['#1d2126','Negro'],
                     ['#8d2b2b','Rojo'],['#22406e','Azul'],['#1f5b4a','Verde'],['#6d5a3c','Arena']];
const escAttr = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function aplicarFotoAlMotor(){
  if (!hud2) return;
  try{
    if (hudFotoSesion) hud2.setCarPhoto(hudFotoSesion);
    else if (hudFotoUrl) hud2.setCarPhotoUrl(hudFotoUrl);
    else hud2.setCarPhoto(null);
  }catch(e){ if (hud2.onError) hud2.onError(e); }
}
function ponerFotoUrl(url){
  hudFotoUrl = urlRepo((url || '').trim()); hudFotoSesion = null; hudFotoOrig = null;
  try{ if (hudFotoUrl) localStorage.setItem('carFotoLT', hudFotoUrl); else localStorage.removeItem('carFotoLT'); }catch(e){}
  hudFotoEstado = hudFotoUrl ? 'Foto en uso: ' + hudFotoUrl : 'Sin foto · se usa el coche dibujado';
  aplicarFotoAlMotor(); pintarAjustesHud();
}
/* Recorte de fondo, tal cual el de AutoBoard, pero como funcion PURA sobre los pixeles (D = RGBA,
   se modifica el alfa): se parte de los bordes de la imagen, se toma su color medio como "fondo" y se
   inunda hacia dentro mientras el color se parezca (tol). Devuelve la fraccion de pixeles opacos. */
function recortarFondoPx(D, w, h, tol){
  let sr = 0, sg = 0, sb = 0, n = 0;
  const smp = (x, y) => { const i = (y*w+x)*4; sr += D[i]; sg += D[i+1]; sb += D[i+2]; n++; };
  for (let x = 0; x < w; x += 3){ smp(x, 0); smp(x, h-1); }
  for (let y = 0; y < h; y += 3){ smp(0, y); smp(w-1, y); }
  sr /= n; sg /= n; sb /= n;
  const seen = new Uint8Array(w*h), q = new Int32Array(w*h); let hd = 0, tl = 0;
  const push2 = p => { if (!seen[p]){ seen[p] = 1; q[tl++] = p; } };
  for (let x = 0; x < w; x++){ push2(x); push2((h-1)*w+x); }
  for (let y = 0; y < h; y++){ push2(y*w); push2(y*w+w-1); }
  while (hd < tl){
    const p = q[hd++], i = p*4, r = D[i], g = D[i+1], b = D[i+2];
    if (Math.abs(r-sr) + Math.abs(g-sg) + Math.abs(b-sb) > tol*7.8) continue;
    D[i+3] = 0;
    const x = p % w, y = (p/w)|0;
    const nb = (nx, ny) => { if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const np = ny*w+nx; if (seen[np]) return; const j = np*4;
      if (Math.abs(D[j]-r) + Math.abs(D[j+1]-g) + Math.abs(D[j+2]-b) <= tol*3) push2(np); };
    nb(x+1, y); nb(x-1, y); nb(x, y+1); nb(x, y-1);
  }
  const A = new Uint8ClampedArray(w*h);
  for (let p = 0; p < w*h; p++) A[p] = D[p*4+3];
  for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++){        // borde suavizado
    const p = y*w+x; if (!A[p]) continue;
    const s4 = A[p-1] + A[p+1] + A[p-w] + A[p+w];
    if (s4 < 1020) D[p*4+3] = Math.round((A[p]*2 + s4/2)/4);
  }
  let opacos = 0; for (let p = 0; p < w*h; p++) if (D[p*4+3] > 40) opacos++;
  return opacos/(w*h);
}
function recortarFondo(tol){
  if (!hudFotoOrig) return;
  const w = hudFotoOrig.width, h = hudFotoOrig.height;
  const cn = document.createElement('canvas'); cn.width = w; cn.height = h;
  const c2 = cn.getContext('2d', { willReadFrequently:true }); c2.drawImage(hudFotoOrig, 0, 0);
  const img = c2.getImageData(0, 0, w, h);
  const pct = recortarFondoPx(img.data, w, h, tol);
  if (pct < 0.08){    // salvaguarda: si se ha comido el coche, se descarta en vez de dejar un sprite invisible
    hudFotoEstado = 'Tolerancia demasiado alta: el recorte se ha comido el coche (' + Math.round(pct*100) + ' % visible). Bájala y vuelve a probar.';
    pintarAjustesHud(); return;
  }
  c2.putImageData(img, 0, 0);
  hudFotoSesion = cn.toDataURL('image/png');
  hudFotoEstado = 'Fondo recortado · ' + Math.round(pct*100) + ' % del cuadro visible · solo para esta sesión';
  aplicarFotoAlMotor(); pintarAjustesHud();
}
async function cargarFotoArchivo(f){
  const adopta = (bmp, w, h) => {
    const sc = Math.min(1, 560/w), cn = document.createElement('canvas');
    cn.width = Math.round(w*sc); cn.height = Math.round(h*sc);
    cn.getContext('2d').drawImage(bmp, 0, 0, cn.width, cn.height);
    hudFotoOrig = cn; hudFotoSesion = cn.toDataURL('image/png');
    hudFotoEstado = 'Foto cargada (solo esta sesión). Si tiene fondo, usa "Quitar fondo".';
    aplicarFotoAlMotor(); pintarAjustesHud();
  };
  try{ const b = await createImageBitmap(f); adopta(b, b.width, b.height); }
  catch(e){
    const u = URL.createObjectURL(f), im = new Image();
    im.onload = () => { adopta(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(u); };
    im.onerror = () => { URL.revokeObjectURL(u); hudFotoEstado = 'Formato no soportado. Usa PNG o JPG (el HEIC del iPhone no vale).'; pintarAjustesHud(); };
    im.src = u;
  }
}
function hudSet(k, v){
  hudCfg[k] = v;
  try{ localStorage.setItem('hudCfgLT', JSON.stringify(hudCfg)); }catch(e){}
  if (hud2){ try{ hud2.set({[k]: v}); }catch(e){ if (hud2.onError) hud2.onError(e); } }
  if (hud3dActivo){ try{ if (k === 'carColor') HUD3D.setBodyColor(v); alimentarHud3D(); }catch(e){} }
}
const H3D_COLORES = HUD_COLORES.concat([['#c9a227','Amarillo'],['#c2571a','Naranja'],['#4b3a7a','Morado']]);
function pintarAjustesHud(){
  const seg = (k, ops) => '<div class="seg" data-h3d="'+k+'">' + ops.map(o => '<button data-v="'+o[0]+'"'+(String(h3dCfg[k])===String(o[0])?' class="on"':'')+'>'+o[1]+'</button>').join('') + '</div>';
  const rng = (k, tx, mn, mx, st) => '<label class="hs-r"><span>'+tx+'</span><em id="hv3_'+k+'">'+h3dCfg[k]+'</em><input type="range" data-h3d="'+k+'" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+h3dCfg[k]+'"></label>';
  const chk = (k, tx) => '<label class="hs-c"><input type="checkbox" data-h3d="'+k+'"'+(h3dCfg[k]?' checked':'')+'> '+tx+'</label>';
  const nota = t => '<div class="hs-nota">'+t+'</div>';
  const claro = c => ['#eef1f4','#c3c9ce','#8f979e','#c9a227'].indexOf(c) >= 0;
  $('hudsetBody').innerHTML =
      '<h4>Color del coche</h4><div class="sws">'
    + H3D_COLORES.map(c => '<button class="sw'+(h3dCfg.carColor===c[0]?' on':'')+'" data-v="'+c[0]+'" style="background:'+c[0]+';color:'+(claro(c[0])?'#111':'#fff')+'">'+c[1]+'</button>').join('')
    + '</div><label class="hs-r"><span>Otro color</span><input type="color" id="h3dColor" value="'+escAttr(/^#[0-9a-f]{6}$/i.test(h3dCfg.carColor)?h3dCfg.carColor:'#8f979e')+'" style="width:64px;height:38px;border:0;background:none"></label>'
    + '<h4>Carretera</h4>' + seg('road', [['auto','Auto'],['road','2 carriles'],['motorway','Autopista 2+2']])
    + nota('Auto: autopista si la ruta pasa por una autovía o si vas a 100 km/h o más; vuelve a la carretera de 2 carriles al bajar de 85 km/h.')
    + '<h4>Carril del coche</h4>' + seg('lane', [['right','Derecha'],['left','Izquierda']])
    + nota('En la carretera de 2 carriles el coche va siempre por el carril derecho. El carril izquierdo solo existe en autopista.')
    + '<h4>Entorno</h4>' + seg('env', [['auto','Auto'],['buildings','Edificios'],['trees','Árboles'],['none','Nada']])
    + '<div style="height:6px"></div>' + seg('dens', [[1,'Muy pocos'],[2,'Pocos'],[3,'Más']])
    + nota('Auto: edificios en la carretera de 2 carriles y árboles en la autopista.')
    + '<h4>Tema</h4>' + seg('theme', [['auto','Auto'],['day','Día'],['night','Noche']])
    + '<h4>Vista</h4>'
    + rng('vista', 'Distancia de cámara', 0.8, 1.5, 0.1)
    + rng('carScale', 'Tamaño del coche', 0.8, 1.3, 0.1)
    + seg('curva', [[1,'Curva suave'],[2,'Normal'],[3,'Marcada']])
    + nota('Cuánto gira el coche y se curva la carretera cuando gira el mapa. Es solo sensación: no sigue la geometría exacta.')
    + '<h4>Rendimiento</h4>' + seg('quality', [[0,'Alta'],[1,'Media'],[2,'Baja']])
    + nota('Baja quita edificios, árboles y manchas de luz. Si el HUD cae por debajo de 18 FPS vuelve solo al HUD 2.')
    + '<h4>Elementos</h4>'
    + chk('signs', 'Señales de la vía (cartel de autopista, curvas)') + chk('interior', 'Interior del coche (más detalle, más carga)')
    + chk('rain', 'Lluvia') + chk('spray', 'Agua de las ruedas')
    + '<h4>HUD</h4><label class="hs-c"><input type="checkbox" id="h3dChk"'+(h3dPreferido()?' checked':'')+'> Usar el HUD 3D (si lo desmarcas se usa el HUD 2 de respaldo)</label>'
    + '<button class="reset" id="hudReset">Restablecer valores</button>';
}
$('hudsetBody').addEventListener('click', e => {
  if (e.target.id === 'hudReset'){
    h3dCfg = Object.assign({}, H3D_DEF); try{ localStorage.removeItem('hud3dCfg'); }catch(er){}
    if (hud3dActivo) aplicarCfg3D(); pintarAjustesHud(); return;
  }
  const sw = e.target.closest ? e.target.closest('.sw') : null;
  if (sw){ h3dSet('carColor', sw.dataset.v); $('hudsetBody').querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === sw)); const ci = $('h3dColor'); if (ci && /^#[0-9a-f]{6}$/i.test(sw.dataset.v)) ci.value = sw.dataset.v; return; }
  const b = e.target.closest ? e.target.closest('.seg button') : null; if (!b) return;
  const g = b.parentNode, k = g.dataset.h3d; if (!k) return;
  h3dSet(k, H3D_NUM.indexOf(k) >= 0 ? +b.dataset.v : b.dataset.v);
  g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
});
$('hudsetBody').addEventListener('input', e => {
  const r = e.target;
  if (r.id === 'h3dColor'){ h3dSet('carColor', r.value); $('hudsetBody').querySelectorAll('.sw').forEach(x => x.classList.remove('on')); return; }
  if (r.type !== 'range' || !r.dataset.h3d) return;
  h3dSet(r.dataset.h3d, +r.value); const hv = $('hv3_'+r.dataset.h3d); if (hv) hv.textContent = r.value;
});
$('hudsetBody').addEventListener('change', e => {
  const c = e.target;
  if (c.id === 'h3dChk'){ try{ localStorage.setItem('hud3dOn', c.checked ? '1' : '0'); }catch(er){} if (c.checked) hud3dFallo = false; setStatus(c.checked ? 'HUD 3D activado: se usa la proxima vez que abras el HUD' : 'HUD 3D desactivado: se usa el HUD 2'); return; }
  if (c.type === 'checkbox' && c.dataset.h3d) h3dSet(c.dataset.h3d, c.checked);
});
$('tabAjHud').onclick = () => { pintarAjustesHud(); $('hudset').classList.add('open'); };
$('closeHudset').onclick = () => $('hudset').classList.remove('open');


/* ==== lista de cargadores (Ajustes -> "Lista de cargadores") ================
   5 como maximo. Con ruta: los que estan a menos de 1 km de la ruta que queda por
   delante, por orden de recorrido. Sin ruta: los mas cercanos. Muestra compañia y
   potencia si las hay (o solo una, o solo el nombre) y al tocar uno: parada intermedia
   si hay ruta, destino si no. Fondo transparente para no tapar el mapa. */
function cargadoresCandidatos(){
  const cargs = pois.filter(p => p.type === 'charge');
  if (!lastFix) return { modo:'cerca', items:[] };
  if (routeOn && routeCoordsLL.length > 8){
    const rec = recorridoAhora(), items = [];
    for (const p of cargs){
      const pr = proyectarEnRuta(p.ll, 40000);
      if (pr.d <= 1000 && pr.along - rec > -30) items.push({ p, dist: Math.max(0, pr.along - rec) });
    }
    items.sort((a, b) => a.dist - b.dist);
    return { modo:'ruta', items: items.slice(0, 5) };
  }
  const here = [lastFix.lat, lastFix.lon];
  return { modo:'cerca', items: cargs.map(p => ({ p, dist: dist(here, p.ll) })).sort((a, b) => a.dist - b.dist).slice(0, 5) };
}
function textoCargador(p){          // compañia y potencia si hay; si falta una, la otra; si faltan las dos, el nombre
  const partes = []; if (p.op) partes.push(p.op); if (p.kw) partes.push(p.kw + ' kW');
  return partes.join(' · ') || p.name || 'Cargador';
}
function renderLista(){
  const box = $('cargList');
  if (!listaCargOn){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  const { modo, items } = cargadoresCandidatos();
  const huella = modo + '|' + pois.length + '|' + wps.length + '|' + items.map(i => i.p.ll.join(',') + ':' + Math.round(i.dist/100)).join(';');
  if (huella === listaHuella) return; listaHuella = huella;
  let html = '<div class="cgh">⚡ ' + (modo === 'ruta' ? 'En la ruta' : 'Cerca') + '</div>';
  if (!items.length) html += '<div class="cg vacio">' + (pois.length ? (modo === 'ruta' ? 'Sin cargadores en tu ruta cercana' : 'Sin cargadores cerca') : 'Buscando cargadores…') + '</div>';
  items.forEach((it, i) => {
    const ya = wps.some(w => dist(w.ll, it.p.ll) < 60);
    html += '<div class="cg' + (ya ? ' ya' : '') + '" data-i="' + i + '"><i style="background:' + (isTesla(it.p) ? '#0d5c33' : '#22c55e') + '"></i>'
          + '<div><b>' + textoCargador(it.p).replace(/</g, '&lt;') + '</b><span>' + (ya ? '✓ parada · ' : '') + fmtDist(it.dist) + '</span></div></div>';
  });
  box.innerHTML = html;
  box._items = items;
}
$('cargList').addEventListener('click', e => {
  const row = e.target.closest ? e.target.closest('.cg[data-i]') : null; if (!row) return;
  const it = $('cargList')._items && $('cargList')._items[+row.dataset.i]; if (!it) return;
  const nombre = it.p.name || it.p.op || 'Cargador';
  if (routeOn) anadirParada(it.p.ll, nombre); else irA(it.p.ll, nombre);
});
$('cargBtn').onclick = () => {
  listaCargOn = !listaCargOn; listaHuella = ''; $('cargBtn').classList.toggle('on', listaCargOn);
  renderLista(); if (listaCargOn && lastFix && (!pois.length)) setStatus('Buscando cargadores…');
};

/* ==== buscador plegable, extraido literal de AutoBoard =====================
   Lupa arriba a la derecha que abre/cierra la barra; al abrir, si el campo
   esta vacio, se listan recientes y favoritos; al escribir 3+ letras, se
   piden sugerencias en vivo a Nominatim -- misma funcion renderSuggest()
   que ya tiene AutoBoard, solo adaptada a los nombres de esta version. */
function cerrarBuscador(){ $('bar').style.display='none'; $('searchToggle').textContent='🔍'; $('suggest').style.display='none'; }
function abrirBuscador(){ $('bar').style.display='flex'; $('searchToggle').innerHTML=X_SVG; $('q').focus(); renderSuggest(''); }
$('searchToggle').onclick = () => { if ($('bar').style.display==='flex') cerrarBuscador(); else abrirBuscador(); };

/* Buscador de direcciones: TomTom Search (el mismo que la app nueva, encuentra bastantes mas direcciones
   y numeros de portal que Nominatim). Sesgo hacia la posicion actual SIN restringir el resultado. */
let sugTok = 0;
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
async function ttBuscar(q, limite, typeahead){
  let u = 'https://api.tomtom.com/search/2/search/'+encodeURIComponent(q)+'.json?key='+TT+'&language=es-ES&countrySet=ES&limit='+limite+(typeahead ? '&typeahead=true' : '');
  if (lastFix) u += '&lat='+lastFix.lat.toFixed(5)+'&lon='+lastFix.lon.toFixed(5);
  const r = await fetch(u); if (!r.ok) throw new Error('TomTom '+r.status);
  const j = await r.json();
  return (j.results || []).filter(s => s.position).map(s => {
    const dir = (s.address && s.address.freeformAddress) || '', poi = (s.poi && s.poi.name) || '';
    return { lat: s.position.lat, lon: s.position.lon, nombre: (poi && dir) ? poi+' · '+dir : (poi || dir || q) };
  });
}
async function renderSuggest(q){
  const tok = ++sugTok;
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
    const res = await ttBuscar(q, 8, true);
    if (tok !== sugTok) return;   // llego tarde: ya hay una busqueda mas reciente
    if (!res.length){ box.style.display='none'; return; }
    box.innerHTML = res.map(it => '<div class="sug" data-lat="'+it.lat+'" data-lon="'+it.lon+'"><span>📍 '+escHTML(it.nombre)+'</span></div>').join('');
    box.style.display = 'block';
    box.querySelectorAll('.sug').forEach(el => { el.onclick = () => {
      const nombre = el.textContent.replace('📍','').trim();
      cerrarBuscador(); irA([parseFloat(el.dataset.lat), parseFloat(el.dataset.lon)], nombre);
    }; });
  }catch(e){ if (tok === sugTok) box.style.display='none'; }
}
let _sugTimer = null;
$('q').addEventListener('input', () => { clearTimeout(_sugTimer); const v = $('q').value.trim(); _sugTimer = setTimeout(() => renderSuggest(v), 250); });
$('q').addEventListener('focus', () => { if (!$('q').value.trim()) renderSuggest(''); });

$('go').onclick = async () => {
  const q = $('q').value.trim(); if (!q) return;
  setStatus('Buscando "'+q+'"…');
  try{
    const res = await ttBuscar(q, 1, false);
    if (!res.length){ setStatus('No se ha encontrado "'+q+'"'); return; }
    cerrarBuscador(); irA([res[0].lat, res[0].lon], q);
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
      try{ const res = await ttBuscar(q.trim(), 1, false); if (res.length) ll=[res[0].lat, res[0].lon]; }catch(e){}
    } else if (lastFix){ ll=[lastFix.lat,lastFix.lon]; }
    if (ll){ localStorage.setItem('homeLT', JSON.stringify({lat:ll[0],lon:ll[1]})); setStatus('🏠 Casa fijada'); }
    else setStatus('No se pudo fijar la casa');
  }, 600); };
  const cancel = () => { if (tmr){ clearTimeout(tmr); tmr=null; } };
  b.addEventListener('touchstart', start, {passive:true}); b.addEventListener('touchmove', cancel, {passive:true});
  b.addEventListener('touchend', () => { cancel(); if (!longed) doHome(); });
  b.addEventListener('mousedown', start); b.addEventListener('mouseup', () => { cancel(); if (!longed) doHome(); }); b.addEventListener('mouseleave', cancel);
})();

/* El contador cuenta fotogramas de verdad -- solo un requestAnimationFrame puede
   hacer eso, un setInterval no mide nada real, solo dispara un temporizador aparte.
   Lo que si se puede evitar es que siga sonando mientras no aporta nada: con el HUD
   o Faro abiertos el mapa esta oculto y en pausa (ver mapaOculto), asi que el bucle
   se para del todo y se reengancha solo al volver al Mapa. */
let fpsRaf = null;
function fpsTick(t0, n){
  return function tick(){
    if (mapaOculto){ fpsRaf = null; return; }
    n++; const now = performance.now();
    if (now - t0 >= 1000){ $('fps').textContent = n + ' fps · mapa ' + renders; n = 0; renders = 0; t0 = now; }
    fpsRaf = requestAnimationFrame(tick);
  };
}
function fpsArrancar(){ if (!fpsRaf && !mapaOculto) fpsRaf = requestAnimationFrame(fpsTick(performance.now(), 0)); }
fpsArrancar();
