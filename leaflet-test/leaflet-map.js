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
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const $ = id => document.getElementById(id);

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
L.tileLayer(TILE_URL, {
  attribution: TILE_ATTR, maxZoom: 19, keepBuffer: 2,
  updateWhenZooming: false, updateWhenIdle: true
}).addTo(map);

const carSVG = `<svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#1e88e5" stroke="#ffffff" stroke-width="1.2"/></svg>`;
const carIcon = L.divIcon({ className: 'car', html: carSVG, iconSize: [26,26], iconAnchor: [13,13] });
const carMk = L.marker(map.getCenter(), { icon: carIcon, zIndexOffset: 1000 }).addTo(map);

// ---- estado de ruta: mismos nombres que AutoBoard, para que se note que es
//      la misma arquitectura conceptual, solo con Leaflet debajo -----------
let routeLine = null;
let routeCoordsLL = [];   // TODOS los puntos de TomTom (navegacion), sin simplificar
let routeDraw = [];       // copia simplificada SOLO para dibujar (igual criterio que AutoBoard)
let routeDrawIdx = [];
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
  // siguiente maniobra / paso actual, basico (Fase 4 hara el panel real)
  while (stepIdx < steps.length-1 && (steps[stepIdx].metro||0) < (routeProgIdx*4) - 15) stepIdx++;
  const s = steps[stepIdx];
  if (s) $('nav').textContent = (isHighway(s)?'🛣️ ':'↱ ') + (s.msg||s.calle||'');
  const dRem = routeCoordsLL.slice(routeProgIdx).reduce((a,_,i,arr)=> i? a+dist(arr[i-1],arr[i]) : a, 0);
  setStatus('Quedan ' + fmtDist(dRem));
}

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

    const sim = simplificarDP(pts, 3);
    routeDraw = sim.p; routeDrawIdx = sim.i;
    console.log('[ruta] puntos TomTom:', pts.length, '→ dibujados:', routeDraw.length,
      '('+Math.round(100-routeDraw.length/Math.max(1,pts.length)*100)+'% menos)');

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(routeDraw.map(p=>[p[1],p[0]]), { color:'#1e88e5', weight:6 }).addTo(map);

    steps = (route.guidance && route.guidance.instructions || []).map(it => ({
      metro: it.routeOffsetInMeters||0, calle: it.street||'', msg: it.message||''
    }));
    stepIdx = 0;

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
