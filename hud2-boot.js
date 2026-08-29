/**
 * hud2-boot.js — arranque de una línea para autoboardV2.
 *
 * En tu index.html, antes de </body>:
 *     <script type="module" src="./hud2-boot.js"></script>
 *
 * Crea el canvas, el botón "HUD 2" y expone window.hud2.
 * Desde tu código de mapa:
 *     window.hud2.setRoute(latlngs);   // al calcular o recalcular ruta
 *     window.hud2.setSpeed(mps);       // en cada posición
 *     window.hud2.syncPosition(lat,lng);
 *
 * Si no le pasas ruta, arranca con una de ejemplo para que veas que funciona.
 */
import { createHud2 } from './hud2.js';

const CSS = `
#hud2-wrap{position:fixed;inset:0;z-index:9000;display:none;background:#0a0d10}
#hud2-wrap.on{display:block}
#hud2-canvas{display:block;width:100%;height:100%}
#hud2-btn{position:fixed;right:14px;bottom:14px;z-index:9100;
  background:rgba(10,13,16,.82);border:1px solid #2c3942;color:#5fd0e0;
  font:600 12px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
  letter-spacing:.12em;text-transform:uppercase;padding:12px 16px;border-radius:6px;
  cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#hud2-btn.on{background:#5fd0e0;color:#06131a;border-color:#5fd0e0}
#hud2-err{position:fixed;left:14px;right:14px;top:14px;z-index:9200;display:none;
  background:rgba(255,90,77,.16);border:1px solid #ff5a4d;color:#ffd9d5;
  padding:10px 12px;border-radius:5px;font:12px/1.5 ui-monospace,monospace}
#hud2-fps{position:fixed;left:14px;top:14px;z-index:9100;display:none;
  color:#7b8b96;font:11px/1 ui-sans-serif,sans-serif;letter-spacing:.16em;text-transform:uppercase}
#hud2-wrap.on ~ #hud2-fps{display:block}
`;

function boot(){
  if (document.getElementById('hud2-btn')) return;         // no duplicar

  const st = document.createElement('style'); st.textContent = CSS;
  document.head.appendChild(st);

  const wrap = document.createElement('div'); wrap.id = 'hud2-wrap';
  const cv = document.createElement('canvas'); cv.id = 'hud2-canvas';
  wrap.appendChild(cv);
  // Se intenta colocar el botón junto al de faro, clonando sus clases para que
  // herede tu CSS. Si no se encuentra, cae al botón flotante de siempre.
  function buscarFaro(){
    const cands = document.querySelectorAll('button,a,div[role="button"],[onclick],[id],[class]');
    for (const e of cands){
      if (e.id === 'hud2-btn') continue;
      const txt = (e.textContent || '').trim().toLowerCase();
      const sig = ((e.id||'') + ' ' + (e.className||'') + ' ' + (e.title||'') + ' '
                 + (e.getAttribute && (e.getAttribute('aria-label')||''))).toLowerCase();
      const pinta = /faro|luces|light|headlight/.test(sig)
                 || (txt.length <= 12 && /^faros?$|^luces$/.test(txt));
      if (!pinta) continue;
      // debe ser un control visible, no un contenedor enorme
      const r = e.getBoundingClientRect ? e.getBoundingClientRect() : null;
      if (r && r.width > 4 && r.width < 260 && r.height > 4 && r.height < 140) return e;
    }
    return null;
  }

  const btn = document.createElement('button');
  btn.textContent = 'HUD 2';
  const faro = buscarFaro();
  if (faro && faro.parentNode){
    btn.className = faro.className;          // mismo aspecto que el resto de la barra
    btn.id = 'hud2-btn-inline';
    faro.parentNode.insertBefore(btn, faro.nextSibling);
    console.log('[hud2] botón colocado junto a:', faro.id || faro.className || faro.textContent.trim());
  } else {
    btn.id = 'hud2-btn';                     // flotante de reserva
    console.log('[hud2] no encuentro el botón de faro; se usa el flotante');
  }
  const err = document.createElement('div'); err.id = 'hud2-err';
  const fps = document.createElement('div'); fps.id = 'hud2-fps';
  document.body.append(wrap, err, fps);
  if (btn.id === 'hud2-btn') document.body.append(btn);

  // MISMA clave que hud2.html: los ajustes que afinaste en el coche se heredan aquí.
  const HUD2_KEY = 'hud2.cfg';
  const HUD2_DEF = { theme:'auto', maxFps:0, beamReach:34, fogEnd:260,
                     lookAhead:55, camHeight:2.6, camBack:7.5, posts:true,
                     rain:false, spray:true, traffic:'off',
                     rbRadius:45, rbArc:18, rbSmooth:1, hud:true };
  let cfg;
  try { cfg = Object.assign({}, HUD2_DEF, JSON.parse(localStorage.getItem(HUD2_KEY) || '{}')); }
  catch(e){ cfg = Object.assign({}, HUD2_DEF); }

  const hud = createHud2(cv, cfg);
  console.log('[hud2] módulo versión', hud.version);
  // foto del coche guardada desde hud2.html (mismo origen, mismo almacen)
  try { const f = localStorage.getItem('hud2.foto'); if (f) hud.setCarPhoto(f); } catch(e){}
  hud.onError = e => { err.style.display = 'block'; err.textContent = 'hud2: ' + e.message; };

  // ruta de ejemplo, solo hasta que tu app llame a setRoute
  let rutaPropia = false;
  // Ruta de prueba incorporada: 3,4 km con DOS rotondas (16 m y 22 m de radio),
  // curvas suaves, dos cerradas y rectas. No hay que pegar nada para usarla.
  const R = 6378137, LAT0 = 43.3320, LNG0 = -3.1090, c0 = Math.cos(LAT0*Math.PI/180);
  const toLL = (x,z) => [LAT0 + z/R*180/Math.PI, LNG0 + x/(R*c0)*180/Math.PI];
  const demo = []; let _x = 0, _z = 0, _h = 0;
  const tramo = (dist, k) => { const n = Math.round(dist/4);
    for (let i = 0; i < n; i++){ _h += k*4; _x += Math.sin(_h)*4; _z += Math.cos(_h)*4; demo.push(toLL(_x,_z)); } };
  demo.push(toLL(0,0));
  tramo(320, 0);        tramo(180,  0.0035);  tramo(260, 0);
  tramo(140,-0.0045);   tramo(200,  0);
  tramo(16*4.0, -1/16); tramo(240,  0);          // rotonda 1: R=16 m, ~230 grados
  tramo(300, 0.0018);   tramo(420,  0);
  tramo(120,-0.0060);   tramo(260,  0);
  tramo(22*3.14,-1/22); tramo(380,  0);          // rotonda 2: R=22 m, 180 grados
  tramo(200, 0.0026);   tramo(300,  0);
  // Si ya cargaste un trazado en hud2.html, se reutiliza: mismo origen, mismo
  // localStorage. Así el botón HUD 2 muestra tu ruta y no la de ejemplo.
  let inicial = demo;
  try {
    const g = JSON.parse(localStorage.getItem('hud2.ruta') || 'null');
    if (g && g.length > 3) inicial = g;
  } catch(e){}
  try { hud.setRoute(inicial); } catch(e){ hud.onError(e); }

  /* ------------------------------------------------------------------
     GPS. La velocidad mueve la cinta a 60 fps entre posiciones; syncPosition
     corrige la deriva con cada fix. Si el receptor no da coords.speed, se
     calcula por diferencia de posiciones, que es lo normal en muchos equipos.
     ------------------------------------------------------------------ */
  let watch = null, ultPos = null, vCalc = 0;
  function gpsOn(){
    if (watch !== null || !navigator.geolocation) return;
    watch = navigator.geolocation.watchPosition(p => {
      const c = p.coords, t = p.timestamp || Date.now();
      let v = (c.speed !== null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;
      if (v === null && ultPos){
        const dt = (t - ultPos.t)/1000;
        if (dt > 0.2 && dt < 10){
          const RT = 6378137, la = c.latitude*Math.PI/180;
          const dx = RT*(c.longitude-ultPos.lng)*Math.PI/180*Math.cos(la);
          const dz = RT*(c.latitude-ultPos.lat)*Math.PI/180;
          const raw = Math.hypot(dx,dz)/dt;
          if (raw < 70) vCalc += (raw - vCalc)*0.5;      // suavizado: el GPS salta
          v = vCalc;
        }
      }
      ultPos = { lat:c.latitude, lng:c.longitude, t };
      if (v !== null) hud.setSpeed(v);
      hud.syncPosition(c.latitude, c.longitude);
    }, e => console.warn('[hud2] GPS:', e.message),
       { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
  }
  function gpsOff(){ if (watch !== null){ navigator.geolocation.clearWatch(watch); watch = null; } }

  // API pública, envolviendo setRoute para saber si ya hay ruta real
  window.hud2 = Object.assign(Object.create(hud), {
    setRoute(ll, o){ rutaPropia = true;
      try { localStorage.setItem('hud2.ruta', JSON.stringify(ll)); } catch(e){}
      return hud.setRoute(ll, o); },
    abrir(){ activar(true); }, cerrar(){ activar(false); },
    get demoActiva(){ return !rutaPropia; },
    // ajustes persistentes, compartidos con hud2.html
    ajustes(){ return Object.assign({}, cfg); },
    gps(v){ if (v === false) gpsOff(); else gpsOn(); return watch !== null; },
    auto(v){ autoOn = v !== false; return autoOn; },
    // coloca el botón junto al elemento que le pases: window.hud2.junto('#miBotonFaro')
    junto(sel){
      const ref = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!ref || !ref.parentNode) return false;
      btn.className = ref.className; btn.id = 'hud2-btn-inline'; btn.style.cssText = '';
      ref.parentNode.insertBefore(btn, ref.nextSibling);
      return true;
    },
    ruta(){ return { propia: rutaPropia, metros: Math.round(hud.state().routeLen),
                     rotondas: hud.state().rotondas }; },
    ajustar(o){ Object.assign(cfg, o); hud.set(cfg);
      try { localStorage.setItem(HUD2_KEY, JSON.stringify(cfg)); } catch(e){} }
  });

  /* ------------------------------------------------------------------
     Detección automática de la ruta. En vez de buscar dónde la calculas,
     se escucha por los dos sitios por los que pasa siempre:
       1) la respuesta del router (OSRM, Valhalla, MapTiler Directions)
       2) el setData de la fuente GeoJSON con la que MapLibre pinta la línea
     Si ninguno dispara, queda la llamada explícita window.hud2.setRoute().
     ------------------------------------------------------------------ */
  let autoOn = true;
  function aceptar(ll, origen){
    if (!autoOn || !ll || ll.length < 8) return false;
    try {
      const r = hud.setRoute(ll);
      rutaPropia = true;
      try { localStorage.setItem('hud2.ruta', JSON.stringify(ll)); } catch(e){}
      console.log('[hud2] ruta detectada por ' + origen + ':', r);
      return true;
    } catch(e){ console.warn('[hud2] ruta descartada (' + origen + '):', e.message); return false; }
  }

  function decodePoly(str, prec){
    const f = Math.pow(10, prec); let i = 0, lat = 0, lng = 0; const out = [];
    while (i < str.length){
      let b, sh = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lat += (res & 1) ? ~(res >> 1) : (res >> 1);
      sh = 0; res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lng += (res & 1) ? ~(res >> 1) : (res >> 1);
      out.push([lat/f, lng/f]);
    }
    return out;
  }

  // saca [[lat,lng],...] de casi cualquier forma en que venga una ruta
  function extraer(obj){
    if (!obj) return null;
    const g = obj.routes && obj.routes[0] && obj.routes[0].geometry;
    if (typeof g === 'string'){
      let ll = decodePoly(g, 5);
      if (!ll.length || Math.abs(ll[0][0]) > 90) ll = decodePoly(g, 6);
      return ll;
    }
    const coords = (g && g.coordinates)
      || (obj.geometry && obj.geometry.coordinates)
      || obj.coordinates
      || (obj.features && obj.features[0] && obj.features[0].geometry
          && obj.features[0].geometry.coordinates)
      || (obj.trip && obj.trip.legs && obj.trip.legs[0] && obj.trip.legs[0].shape);
    if (typeof coords === 'string'){                       // Valhalla: precisión 6
      const ll = decodePoly(coords, 6);
      return (ll.length && Math.abs(ll[0][0]) <= 90) ? ll : null;
    }
    if (!Array.isArray(coords) || coords.length < 8) return null;
    let c = coords;
    if (Array.isArray(c[0][0])) c = c.flat(1);             // MultiLineString
    if (typeof c[0][0] !== 'number') return null;
    // GeoJSON viene [lng,lat]; se comprueba que los rangos cuadren
    const ok = c.every(p => Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180);
    return ok ? c.map(p => [p[1], p[0]]) : null;
  }

  // 1) respuestas del router
  if (window.fetch){
    const f0 = window.fetch;
    window.fetch = function(...a){
      return f0.apply(this, a).then(res => {
        try {
          const u = String((a[0] && a[0].url) || a[0] || '');
          if (/route|directions|navigation|valhalla|osrm/i.test(u) && res.ok){
            res.clone().json().then(j => { const ll = extraer(j); if (ll) aceptar(ll, 'red'); }).catch(()=>{});
          }
        } catch(e){}
        return res;
      });
    };
  }

  // 2) la fuente GeoJSON con la que MapLibre pinta la línea
  function engancharMapLibre(){
    const ml = window.maplibregl || window.mapboxgl;
    if (!ml || !ml.Map || ml.__hud2) return false;
    ml.__hud2 = true;
    const proto = ml.Map.prototype;
    const addS = proto.addSource;
    proto.addSource = function(id, src){
      try { if (src && src.type === 'geojson'){ const ll = extraer(src.data); if (ll) aceptar(ll, 'addSource:'+id); } } catch(e){}
      return addS.apply(this, arguments);
    };
    const getS = proto.getSource;
    proto.getSource = function(id){
      const src = getS.apply(this, arguments);
      if (src && src.setData && !src.__hud2){
        src.__hud2 = true;
        const sd = src.setData.bind(src);
        src.setData = d => { try { const ll = extraer(d); if (ll) aceptar(ll, 'setData:'+id); } catch(e){} return sd(d); };
      }
      return src;
    };
    return true;
  }
  if (!engancharMapLibre()){
    let intentos = 0;
    const t = setInterval(() => { if (engancharMapLibre() || ++intentos > 40) clearInterval(t); }, 500);
  }

  // contador de fps: la cifra que decide si esto aguanta en la pantalla del coche
  let n = 0, t0 = performance.now();
  (function tick(){
    requestAnimationFrame(tick);
    n++;
    const now = performance.now();
    if (now - t0 > 500){ fps.textContent = 'HUD 2 · ' + Math.round(n/(now-t0)*1000) + ' fps'; n = 0; t0 = now; }
  })();

  function activar(on){
    wrap.classList.toggle('on', on);
    if (btn.id === 'hud2-btn') btn.classList.toggle('on', on);
    else btn.style.opacity = on ? '1' : '';
    // El mapa sigue renderizando aunque esté tapado y se come GPU.
    try {
      const m = window.map || window.mapa || window.mapaTesla;
      if (m && m.stop && m.resize){ if (on) m.stop(); else setTimeout(() => m.resize(), 50); }
    } catch(e){}
    fps.style.display = on ? 'block' : 'none';
    if (on){ hud.resize(); hud.start(); gpsOn(); } else { hud.stop(); gpsOff(); }
  }
  btn.onclick = () => activar(!wrap.classList.contains('on'));
  window.addEventListener('orientationchange', () => setTimeout(hud.resize, 250));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
