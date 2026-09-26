/* ============================================================================
   FASE 1 — prototipo Leaflet AISLADO. No toca AutoBoard ni comparte estado
   con index.html. Solo lo que pide la fase 1:

     mapa · GPS · TomTom · ruta azul · posicion del coche · zoom · seguimiento

   Nada de radar, lluvia, trafico, cargadores, HUD ni satelite: eso es Fase 4.

   La pregunta que este archivo intenta responder es una sola:
   ¿este mapa (Leaflet, raster, sin WebGL) va mas fluido en el Tesla que
   MapLibre?
   ========================================================================= */

// Misma clave TomTom que ya usa AutoBoard (mismo proyecto, misma cuota).
const TT = "zMPqeYVXNoQw4rJ1ycr8QdywkDFNx0tF";

/* Teselas RASTER estandar de OpenStreetMap: sin clave, sin cuenta, el caso
   mas simple y mas representativo de "Leaflet clasico" para la prueba. Si el
   resultado es bueno, luego se puede cambiar el proveedor sin tocar nada
   mas (es una sola linea). */
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const $ = id => document.getElementById(id);

const map = L.map('map', {
  zoomControl: true,
  attributionControl: true,
  center: [43.30, -2.98],   // Bizkaia, mismo punto de partida razonable que AutoBoard
  zoom: 14,
  fadeAnimation: true,       // en Leaflet esto es barato: es CSS, no WebGL
  zoomAnimation: true,
  preferCanvas: true          // la ruta y el marker se pintan en <canvas>, no en SVG/DOM
});

L.tileLayer(TILE_URL, {
  attribution: TILE_ATTR,
  maxZoom: 19,
  // keepBuffer bajo: menos teselas retenidas fuera de pantalla = menos memoria.
  // Es el mismo tipo de ajuste que ya hicimos en AutoBoard (maxTileCacheSize),
  // aqui con el nombre que usa Leaflet.
  keepBuffer: 2,
  updateWhenZooming: false,   // no pide teselas nuevas a mitad de una animacion de zoom
  updateWhenIdle: true        // solo pide teselas cuando el mapa se ha quedado quieto
}).addTo(map);

/* ---- coche: DivIcon + SVG + rotacion CSS (igual que hace AutoBoard con el
   marcador, pero sin nada de HUD 3D detras) --------------------------------- */
const carSVG = `<svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#1e88e5" stroke="#ffffff" stroke-width="1.2"/></svg>`;
const carIcon = L.divIcon({ className: 'car', html: carSVG, iconSize: [26,26], iconAnchor: [13,13] });
const carMk = L.marker(map.getCenter(), { icon: carIcon, zIndexOffset: 1000 }).addTo(map);

let routeLine = null, routeCoordsLL = [], destLL = null, follow = true;
let lastFix = null, heading = 0, speedKmh = 0;

function setStatus(t){ $('status').textContent = t; }
function fmtDist(m){ return m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km'; }

/* ---- GPS: igual patron que AutoBoard (watchPosition), sin ningun anadido -- */
if (navigator.geolocation){
  navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    const now = { lat: c.latitude, lon: c.longitude, t: p.timestamp };
    if (lastFix){
      const dt = (now.t - lastFix.t) / 1000;
      if (dt > 0.2){
        // bearing entre dos fijas consecutivas, igual formula que index.html
        const la1 = lastFix.lat*Math.PI/180, la2 = now.lat*Math.PI/180;
        const dLon = (now.lon-lastFix.lon)*Math.PI/180;
        const y = Math.sin(dLon)*Math.cos(la2);
        const x = Math.cos(la1)*Math.sin(la2) - Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
        const brg = (Math.atan2(y,x)*180/Math.PI + 360) % 360;
        if (typeof c.speed === 'number' && c.speed > 1) heading = brg;   // solo si te mueves de verdad
        if (typeof c.speed === 'number') speedKmh = Math.max(0, c.speed*3.6);
      }
    }
    lastFix = now;
    carMk.setLatLng([now.lat, now.lon]);
    const el = carMk.getElement();
    if (el){ const svg = el.querySelector('svg'); if (svg) svg.style.transform = 'rotate('+heading+'deg)'; }

    if (follow) map.setView([now.lat, now.lon], map.getZoom(), { animate: true, duration: 0.3 });

    $('spd').textContent = Math.round(speedKmh)+' km/h';
    $('acc').textContent = Math.round(c.accuracy||0)+' m';
    if (destLL){
      const dRem = map.distance([now.lat, now.lon], destLL);
      setStatus('Quedan ' + fmtDist(dRem));
    }
  }, e => setStatus('GPS: '+e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
} else {
  setStatus('Sin geolocalizacion en este navegador');
}

// el usuario mueve el mapa a mano -> se pausa el seguimiento, como en AutoBoard
map.on('dragstart', () => { follow = false; });
$('recenter').onclick = () => { follow = true; if (lastFix) map.setView([lastFix.lat, lastFix.lon], 16, {animate:true}); };

/* ---- ruta: misma llamada TomTom que usa AutoBoard, sin guidance (fase 1 no
   necesita maniobras, solo la geometria) ------------------------------------ */
async function irA(destino){
  if (!lastFix){ setStatus('Sin GPS todavia'); return; }
  setStatus('Calculando ruta…');
  const t0 = performance.now();
  try{
    const locs = lastFix.lat+','+lastFix.lon+':'+destino[0]+','+destino[1];
    const url = 'https://api.tomtom.com/routing/1/calculateRoute/'+locs+'/json?key='+TT+'&traffic=true&travelMode=car';
    const r = await fetch(url);
    const j = await r.json();
    if (!j.routes || !j.routes.length){ setStatus('Sin ruta'); return; }
    const route = j.routes[0];
    const pts = [];
    route.legs.forEach(leg => leg.points.forEach(p => pts.push([p.latitude, p.longitude])));
    routeCoordsLL = pts;
    destLL = destino;

    if (routeLine) map.removeLayer(routeLine);
    // Igual que en AutoBoard: borde oscuro + linea azul encima. En Leaflet no
    // hace falta gestionar fuentes/capas de estilo, son dos objetos normales.
    routeLine = L.layerGroup([
      L.polyline(pts, { color:'#0b3d91', weight:9, opacity:.85 }),
      L.polyline(pts, { color:'#1e88e5', weight:5 })
    ]).addTo(map);

    map.fitBounds(L.latLngBounds(pts), { padding: [60,60], maxZoom: 15 });
    setTimeout(() => { follow = true; }, 2000);   // vuelve al seguimiento normal, como en AutoBoard

    const ms = Math.round(performance.now()-t0);
    setStatus('Ruta: '+fmtDist(route.summary.lengthInMeters)+' · '+Math.round(route.summary.travelTimeInSeconds/60)+' min · ('+ms+' ms)');
  }catch(e){ setStatus('Error de ruta: '+e.message); }
}

/* ---- buscador: geocodificacion con Nominatim (OSM), sin clave ------------ */
$('go').onclick = async () => {
  const q = $('q').value.trim();
  if (!q) return;
  setStatus('Buscando "'+q+'"…');
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q));
    const j = await r.json();
    if (!j.length){ setStatus('No se ha encontrado "'+q+'"'); return; }
    irA([parseFloat(j[0].lat), parseFloat(j[0].lon)]);
  }catch(e){ setStatus('Error de busqueda: '+e.message); }
};
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });

/* ---- medidor de fps simple, para poder comparar a ojo con AutoBoard ------ */
(function(){
  let n = 0, t = performance.now();
  function tick(){
    n++;
    const now = performance.now();
    if (now - t >= 1000){ $('fps').textContent = n + ' fps'; n = 0; t = now; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
