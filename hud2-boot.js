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
#hud2-back{position:fixed;left:14px;top:14px;z-index:9150;display:none;
  background:rgba(10,13,16,.82);border:1px solid #2c3942;color:#e8eef2;border-radius:6px;
  font:600 12px/1 ui-sans-serif,sans-serif;letter-spacing:.1em;text-transform:uppercase;
  padding:13px 18px;cursor:pointer;backdrop-filter:blur(6px)}
#hud2-wrap.on ~ #hud2-back{display:block}
#hud2-gear{position:fixed;left:10px;top:10px;z-index:9150;display:none;width:32px;height:32px;
  background:rgba(10,13,16,.72);border:1px solid #2c3942;color:#8fd8e4;border-radius:8px;
  font:15px/1 ui-sans-serif,sans-serif;padding:0;cursor:pointer;opacity:.75}
#hud2-wrap.on ~ #hud2-gear{display:block}
#hud2-set{position:fixed;inset:0;z-index:9300;display:none;flex-direction:column;
  background:rgba(6,9,12,.96);padding:18px 16px;gap:8px;overflow-y:auto;
  font:12px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8eef2}
#hud2-set.on{display:flex}
#hud2-set h2{margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7b8b96}
#hud2-set h3{margin:14px 0 6px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#ffab3d}
#hud2-set label{display:block;margin:0 0 13px}
#hud2-set .r{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
#hud2-set .r em{font-style:normal;color:#5fd0e0;font-size:11px}
#hud2-set input[type=range]{width:100%;accent-color:#5fd0e0;height:22px}
#hud2-set .ck{display:flex;align-items:center;gap:10px;margin-bottom:11px}
#hud2-set input[type=checkbox]{accent-color:#5fd0e0;width:18px;height:18px}
#hud2-set .sg{display:flex;border:1px solid #232c33;border-radius:5px;overflow:hidden;margin-bottom:8px}
#hud2-set .sg button{flex:1;background:transparent;border:0;color:#7b8b96;font:11px/1 inherit;
  padding:11px 0;cursor:pointer}
#hud2-set .sg button.on{background:#5fd0e0;color:#06131a;font-weight:600}
#hud2-set .done{background:#5fd0e0;color:#06131a;border:0;border-radius:6px;padding:14px;
  font:600 12px/1 inherit;cursor:pointer;margin-top:8px}
#hud2-set .drop{border:1px dashed #232c33;border-radius:5px;padding:14px;text-align:center;
  color:#5fd0e0;font-weight:600;cursor:pointer}
#hud2-fps{position:fixed;left:50%;transform:translateX(-50%);top:20px;z-index:9100;display:none;
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
  // En modo incrustado manda la barra de modos de la app: nada de botón propio.
  let incrustadoPrev = false;
  try { incrustadoPrev = !!(JSON.parse(localStorage.getItem('hud2.cfg') || '{}').incrustado); } catch(e){}
  const faro = incrustadoPrev ? null : buscarFaro();
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
  const gear = document.createElement('button'); gear.id = 'hud2-gear'; gear.textContent = '⚙'; gear.title = 'Ajustes del HUD 2';
  // Salida siempre visible: el botón que abre el HUD puede quedar tapado por la
  // propia capa si está integrado en la barra de la app.
  const back = document.createElement('button'); back.id = 'hud2-back'; back.textContent = '← Mapa';
  const sheet = document.createElement('div'); sheet.id = 'hud2-set';
  document.body.append(wrap, err, fps, gear, back, sheet);
  if (btn.id === 'hud2-btn' && !incrustadoPrev) document.body.append(btn);

  // MISMA clave que hud2.html: los ajustes que afinaste en el coche se heredan aquí.
  const HUD2_KEY = 'hud2.cfg';
  const HUD2_DEF = { theme:'auto', maxFps:0, beamReach:34, fogEnd:260,
                     lookAhead:55, camHeight:2.6, camBack:7.5, posts:true,
                     rain:false, spray:true, traffic:'off',
                     rbRadius:45, rbArc:18, rbSmooth:1, hud:true, horizon:0.50, carScale:1,
                     perfil:'auto', detalleCoche:true, carPhotoUrl:'', frenarCamara:false, hudScale:1,
                     abrirAlNavegar:false, incrustado:false, destino:'#hudroad', carteles:true };
  let cfg;
  try { cfg = Object.assign({}, HUD2_DEF, JSON.parse(localStorage.getItem(HUD2_KEY) || '{}')); }
  catch(e){ cfg = Object.assign({}, HUD2_DEF); }

  /* ------------------------------------------------------------------
     Modo incrustado: el HUD 2 ocupa el hueco del canvas del HUD actual
     (#hudroad por defecto) en vez de tapar la pantalla entera. Tu interfaz
     y tus controles siguen visibles alrededor.
     ------------------------------------------------------------------ */
  let destinoEl = null, cvIn = null, dimOrig = null;
  let rutaActual = null, opcRuta = null;
  function recordarRuta(ll, o){ rutaActual = ll; opcRuta = o || null; }
  function montarIncrustado(){
    destinoEl = document.querySelector(cfg.destino || '#hudroad');
    if (!destinoEl || !destinoEl.parentNode) return false;

    // Si el destino YA es un canvas, se pinta directamente en él: un solo
    // lienzo, un solo bucle. Es la opción más fluida.
    if (destinoEl.tagName === 'CANVAS'){
      cvIn = destinoEl;
      ocultarViejos(true);
      return true;
    }
    if (!cvIn){
      cvIn = document.createElement('canvas');
      cvIn.id = 'hud2-inline';
      destinoEl.parentNode.insertBefore(cvIn, destinoEl.nextSibling);
    }
    // copiar tamaño y estilo del original para no descuadrar tu maquetación
    const r = destinoEl.getBoundingClientRect();
    cvIn.style.cssText = destinoEl.style.cssText;
    cvIn.className = destinoEl.className;
    cvIn.style.display = 'block';
    if (!cvIn.style.width)  cvIn.style.width  = (r.width  || destinoEl.width)  + 'px';
    if (!cvIn.style.height) cvIn.style.height = (r.height || destinoEl.height) + 'px';
    destinoEl.style.display = 'none';

    // Ocultar no basta: tu bucle sigue dibujando contra un lienzo invisible y
    // eso cuesta GPU. Encogerlo a 1x1 deja el contexto válido (tu código no
    // falla) pero el coste de rasterizado se vuelve cero.
    if (dimOrig === null){
      dimOrig = { w: destinoEl.width, h: destinoEl.height };
      try { destinoEl.width = 1; destinoEl.height = 1; } catch(e){}
      console.log('[hud2] lienzo del HUD anterior reducido a 1x1 (era '
                  + dimOrig.w + 'x' + dimOrig.h + ')');
    }
    return true;
  }
  // Los adornos del HUD antiguo (coche en img, haces en div, lluvia en canvas)
  // sobran: el HUD 2 los dibuja dentro del lienzo.
  const VIEJOS = ['hudcar', 'beams', 'hudrain'];
  function ocultarViejos(on){
    for (const id of VIEJOS){
      const e = document.getElementById(id);
      if (!e) continue;
      if (on){ if (e.dataset.hud2disp === undefined) e.dataset.hud2disp = e.style.display || ''; e.style.display = 'none'; }
      else e.style.display = e.dataset.hud2disp || '';
    }
  }

  function desmontarIncrustado(){
    ocultarViejos(false);
    if (cvIn && cvIn !== destinoEl) cvIn.style.display = 'none';
    if (destinoEl && cvIn !== destinoEl){
      if (dimOrig){ try { destinoEl.width = dimOrig.w; destinoEl.height = dimOrig.h; } catch(e){} dimOrig = null; }
      destinoEl.style.display = '';
    }
  }

  const hud = createHud2(cv, cfg);
  let hudIn = null;                     // instancia para el canvas incrustado
  console.log('[hud2] módulo versión', hud.version);
  // foto del coche guardada desde hud2.html (mismo origen, mismo almacen)
  try {
    if (cfg.carPhotoUrl) hud.setCarPhotoUrl(cfg.carPhotoUrl);
    else { const f = localStorage.getItem('hud2.foto'); if (f) hud.setCarPhoto(f); }
  } catch(e){}
  // rescate: si la foto guardada resultara invisible, se descarta sola
  window.hud2SinFoto = () => { try { localStorage.removeItem('hud2.foto'); } catch(e){}
    fotoOrig = null; hud.setCarPhoto(null); console.log('[hud2] foto descartada'); };
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
  // Arranque en recta larga: sin ruta y parado, el HUD enseña carretera y coche
  // en vez de quedarse en negro. Luego llegan curvas suaves para que el paisaje
  // cambie en cuanto empieces a moverte.
  tramo(700, 0);        tramo(400,  0.0011);  tramo(500, -0.0008);
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
  recordarRuta(inicial, {});
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
      hud.setLatLng(c.latitude, c.longitude);     // para el tema por altura solar
      if (v !== null) hud.setSpeed(v);
      hud.syncPosition(c.latitude, c.longitude);
    }, e => console.warn('[hud2] GPS:', e.message),
       { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
  }
  function gpsOff(){ if (watch !== null){ navigator.geolocation.clearWatch(watch); watch = null; } }

  // API pública, envolviendo setRoute para saber si ya hay ruta real
  window.hud2 = Object.assign(Object.create(hud), {
    setRoute(ll, o){ rutaPropia = true; recordarRuta(ll, o);
      try { localStorage.setItem('hud2.ruta', JSON.stringify(ll)); } catch(e){}
      return hud.setRoute(ll, o); },
    abrir(){ activar(true); }, cerrar(){ activar(false); },
    get demoActiva(){ return !rutaPropia; },
    // ajustes persistentes, compartidos con hud2.html
    ajustes(){ return Object.assign({}, cfg); },
    gps(v){ if (v === false) gpsOff(); else gpsOn(); return watch !== null; },
    // Si algún día localizas el rAF de tu HUD: window.hud2.pararBucle(id)
    pararBucle(id){ try { cancelAnimationFrame(id); return true; } catch(e){ return false; } },
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
                     rotondas: hud.state().rotondas,
                     radares: radaresRaw ? radaresRaw.length : 0 }; },
    // por si prefieres pasárselos tú: window.hud2.radares(miLista)
    radares(lista){ if (lista){ radaresRaw = lista;
      try { localStorage.setItem('hud2.radares', JSON.stringify(lista)); } catch(e){} }
      aplicarRadares(); return radaresRaw ? radaresRaw.length : 0; },
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
  let firmaRuta = null, mapaInst = null, incrustadoActivo = false;
  // Reenvía a la instancia incrustada todo lo que se le da a la principal.
  function espejo(){
    if (!hudIn) return;
    for (const m of ['setRoute','setManeuvers','setRadars','setLimits','setSpeed',
                     'syncPosition','setCarPhoto','setCarPhotoUrl','setLatLng','set']){
      const orig = hud[m];
      if (typeof orig !== 'function' || orig.__esp) continue;
      const env = function(){ try { hudIn[m].apply(hudIn, arguments); } catch(e){}
                              return orig.apply(hud, arguments); };
      env.__esp = true; hud[m] = env;
    }
  }
  const firmar = ll => ll.length + ':' + ll[0][0].toFixed(5) + ',' + ll[0][1].toFixed(5)
                     + ':' + ll[ll.length-1][0].toFixed(5) + ',' + ll[ll.length-1][1].toFixed(5);

  function aceptar(ll, origen, json){
    if (!autoOn || !ll || ll.length < 8) return false;
    // MapLibre llama a setData muchas veces por segundo para repintar la línea.
    // Sin esta comprobación se recargaba la ruta entera en cada llamada y la
    // posición volvía al principio: de ahí los tirones y los saltos.
    const f = firmar(ll);
    if (f === firmaRuta) return false;
    firmaRuta = f;
    try {
      const extra = json ? extraerPasos(json) : null;
      const opc = extra ? { motorway: extra.autovias } : {};
      recordarRuta(ll, opc);
      const r = hud.setRoute(ll, opc);
      rutaPropia = true;
      if (extra && extra.pasos.length) hud.setManeuvers(extra.pasos);
      rutaPropia = true;
      aplicarRadares();                       // los metros cambian con cada ruta
      if (cfg.abrirAlNavegar && !wrap.classList.contains('on')) activar(true);
      try { localStorage.setItem('hud2.ruta', JSON.stringify(ll)); } catch(e){}
      console.log('[hud2] ruta detectada por ' + origen + ':', r,
        extra ? ('| ' + extra.pasos.length + ' maniobras, ' + extra.autovias.length + ' tramos de autovía') : '');
      return true;
    } catch(e){ console.warn('[hud2] ruta descartada (' + origen + '):', e.message); return false; }
  }

  /**
   * Saca maniobras y tramos de autovía de los steps del router. OSRM y MapTiler
   * dan legs[].steps[] con maneuver.type / .modifier / .exit, name, ref y
   * intersections[].classes. Con eso se rellena todo sin tocar tu código.
   */
  function extraerPasos(j){
    const legs = (j.routes && j.routes[0] && j.routes[0].legs) || j.legs;
    if (!Array.isArray(legs)) return null;
    const MOD = { left:'left', 'slight left':'left', 'sharp left':'left',
                  right:'right', 'slight right':'right', 'sharp right':'right',
                  straight:'straight', uturn:'left' };
    const pasos = [], autovias = [];
    let metro = 0, mwIni = null;
    for (const leg of legs){
      for (const st of (leg.steps || [])){
        const mv = st.maneuver || {};
        const tipo = /roundabout|rotary/i.test(mv.type || '') ? 'roundabout'
                   : (MOD[(mv.modifier || '').toLowerCase()] || null);
        if (tipo && metro > 5 && !/^depart$/i.test(mv.type || ''))
          pasos.push({ metro, tipo, calle: st.name || st.ref || '', salida: mv.exit });

        // ¿este tramo es autovía?
        let esMW = false;
        const cls = (st.intersections || []).reduce((a,i) => a.concat(i.classes || []), []);
        if (cls.indexOf('motorway') >= 0) esMW = true;
        if (!esMW && /^(A|AP)-?\d/i.test(st.ref || '')) esMW = true;
        const largo = st.distance || 0;
        if (esMW && mwIni === null) mwIni = metro;
        if (!esMW && mwIni !== null){ if (metro - mwIni > 300) autovias.push([mwIni, metro]); mwIni = null; }
        metro += largo;
      }
    }
    if (mwIni !== null && metro - mwIni > 300) autovias.push([mwIni, metro]);
    return { pasos, autovias };
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

  /* ---- radares: se interceptan igual que la ruta ---- */
  let radaresRaw = null;
  try { const g = JSON.parse(localStorage.getItem('hud2.radares') || 'null');
        if (g && g.length) radaresRaw = g; } catch(e){}

  function extraerRadares(j){
    let arr = null;
    if (Array.isArray(j)) arr = j;
    else if (j && Array.isArray(j.radares)) arr = j.radares;
    else if (j && Array.isArray(j.features))                     // GeoJSON
      arr = j.features.map(f => {
        const c = f.geometry && f.geometry.coordinates;
        return c ? Object.assign({ lat:c[1], lng:c[0] }, f.properties || {}) : null;
      }).filter(Boolean);
    else if (j && typeof j === 'object'){
      for (const k in j) if (Array.isArray(j[k]) && j[k].length > 3){ arr = j[k]; break; }
    }
    if (!arr || arr.length < 1) return null;
    const p0 = arr[0];
    const tiene = o => o && (o.lat !== undefined || o.latitude !== undefined
                             || o.lon !== undefined || Array.isArray(o));
    return tiene(p0) ? arr : null;
  }

  function aplicarRadares(){
    if (!radaresRaw || !rutaPropia) return;
    try {
      const n = hud.setRadars(radaresRaw);
      console.log('[hud2] radares sobre la ruta:', n, 'de', radaresRaw.length);
    } catch(e){ console.warn('[hud2] radares:', e.message); }
  }

  // 1) respuestas del router
  if (window.fetch){
    const f0 = window.fetch;
    window.fetch = function(...a){
      return f0.apply(this, a).then(res => {
        try {
          const u = String((a[0] && a[0].url) || a[0] || '');
          if (/route|directions|navigation|valhalla|osrm/i.test(u) && res.ok){
            res.clone().json().then(j => { const ll = extraer(j); if (ll) aceptar(ll, 'red', j); }).catch(()=>{});
          } else if (/radar|camera|speedcam/i.test(u) && res.ok){
            res.clone().json().then(j => {
              const r = extraerRadares(j);
              if (r){ radaresRaw = r;
                try { localStorage.setItem('hud2.radares', JSON.stringify(r)); } catch(e){}
                console.log('[hud2] lista de radares capturada:', r.length);
                aplicarRadares(); }
            }).catch(()=>{});
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
      mapaInst = this;                       // así podemos pararlo al abrir el HUD
      try { if (src && src.type === 'geojson'){ const ll = extraer(src.data); if (ll) aceptar(ll, 'addSource:'+id); } } catch(e){}
      return addS.apply(this, arguments);
    };
    const getS = proto.getSource;
    proto.getSource = function(id){
      mapaInst = this;
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

  /* ---- panel de ajustes, mismos valores persistentes que hud2.html ---- */
  const SLD = [
    ['beamReach','Alcance de faros',16,70,1,'m',1],
    ['lookAhead','Look-ahead cámara',10,120,1,'m',1],
    ['camHeight','Altura de cámara',10,90,1,'m',10],
    ['camBack','Distancia detrás',20,200,1,'m',10],
    ['fogEnd','Niebla',60,500,10,'m',1],
    ['horizon','Encuadre vertical',30,70,1,'%',100],
    ['carScale','Tamaño del coche',60,160,1,'%',100],
    ['hudScale','Tamaño de los textos',70,180,1,'%',100]
  ];
  const guardar = () => { hud.set(cfg); try { localStorage.setItem(HUD2_KEY, JSON.stringify(cfg)); } catch(e){} };
  const seg = (id, opts, val) => '<div class="sg" id="'+id+'">' + opts.map(o =>
    '<button data-v="'+o[0]+'" class="'+(String(val)===String(o[0])?'on':'')+'">'+o[1]+'</button>').join('') + '</div>';

  function pintarAjustes(){
    let html = '<h2>Ajustes HUD 2</h2><h3>Tema</h3>'
      + seg('h2_tema', [['auto', 'Auto' + (cfg.theme==='auto' && hud.temaActual ? ' ('
          + ({day:'día',dusk:'tarde',night:'noche'})[hud.temaActual()] + ')' : '')],
          ['day','Día'],['dusk','Tarde'],['night','Noche']], cfg.theme)
      + '<h3>Límite de frames</h3>'
      + seg('h2_fps', [[0,'Libre'],[30,'30'],[24,'24'],[20,'20']], cfg.maxFps);
    for (const [k,lab,mn,mx,st,u,dv] of SLD)
      html += '<label><span class="r"><span>'+lab+'</span><em id="h2o_'+k+'">'+cfg[k]+u+'</em></span>'
            + '<input type="range" id="h2r_'+k+'" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+(cfg[k]*dv)+'"></label>';
    html += '<label class="ck"><input type="checkbox" id="h2_posts"'+(cfg.posts?' checked':'')+'> Farolas y quitamiedos</label>'
          + '<label class="ck"><input type="checkbox" id="h2_hud"'+(cfg.hud?' checked':'')+'> Maniobra, velocidad y límite</label>'
          + '<h3>Efectos</h3>'
          + '<label class="ck"><input type="checkbox" id="h2_rain"'+(cfg.rain?' checked':'')+'> Lluvia</label>'
          + '<label class="ck"><input type="checkbox" id="h2_spray"'+(cfg.spray?' checked':'')+'> Agua de las ruedas</label>'
          + '<h3>Integración</h3>'
          + '<label class="ck"><input type="checkbox" id="h2_incrustado"'+(cfg.incrustado?' checked':'')+'> Sustituir el HUD actual (' + (cfg.destino||'#hudroad') + ')</label>'
          + '<label class="ck"><input type="checkbox" id="h2_abrirAlNavegar"'+(cfg.abrirAlNavegar?' checked':'')+'> Abrir solo al iniciar navegación</label>'
          + '<h3>Rendimiento</h3>'
          + seg('h2_perf', [['auto','Auto'],['ligero','Ligero'],['completo','Completo']], cfg.perfil)
          + '<label class="ck"><input type="checkbox" id="h2_detalleCoche"'+(cfg.detalleCoche?' checked':'')+'> Detalles del coche</label>'
          + '<label class="ck"><input type="checkbox" id="h2_carteles"'+(cfg.carteles?' checked':'')+'> Carteles de dirección</label>'
          + '<label class="ck"><input type="checkbox" id="h2_frenarCamara"'+(cfg.frenarCamara?' checked':'')+'> Sujetar cámara en curva cerrada</label>'
          + '<h3>Tráfico</h3>'
          + seg('h2_traf', [['off','Ninguno'],['poca','Poco'],['normal','Normal'],['mucha','Denso']], cfg.traffic)
          + '<h3>Tu coche</h3>'
          + '<label><span class="r"><span>Foto por URL (súbela al repo)</span></span>'
          + '<input type="text" id="h2_url" value="' + (cfg.carPhotoUrl||'') + '" placeholder="./coche.png" '
          + 'style="width:100%;background:#0d1216;border:1px solid #232c33;border-radius:5px;color:#e8eef2;'
          + 'font:11px ui-monospace,monospace;padding:9px"></label>'
          + '<input type="file" id="h2_file" accept="image/*" style="display:none">'
          + '<div class="drop" id="h2_drop">' + (hayFoto() ? 'Cambiar foto' : 'Cargar foto de tu coche') + '</div>'
          + '<div id="h2_stat" style="color:#7b8b96;margin:8px 0 10px">'
          + (hayFoto() ? 'Foto en uso.' : 'Sin foto · se usa el coche dibujado') + '</div>';
    if (fotoOrig)
      html += '<label><span class="r"><span>Tolerancia del recorte</span><em id="h2o_tol">28</em></span>'
            + '<input type="range" id="h2r_tol" min="6" max="90" value="28"></label>'
            + '<button class="done" id="h2_cut" style="margin:0 0 8px">Quitar fondo</button>';
    if (hayFoto()) html += '<button class="done" id="h2_nofoto" style="background:transparent;border:1px solid #232c33;color:#7b8b96;margin:0 0 8px">Sin foto</button>';
    html += '<button class="done" id="h2_done">Hecho</button>'
          + '<button class="done" id="h2_reset" style="background:transparent;border:1px solid #232c33;color:#7b8b96">Valores por defecto</button>';
    sheet.innerHTML = html;

    // Si algún control no existiera, se devuelve un objeto vacío: un panel
    // incompleto no debe tirar abajo el HUD entero.
    const g = id => document.getElementById(id) || {};
    g('h2_tema').onclick = e => { if(!e.target.dataset.v) return; cfg.theme = e.target.dataset.v; guardar(); pintarAjustes(); };
    g('h2_fps').onclick  = e => { if(!e.target.dataset.v) return; cfg.maxFps = +e.target.dataset.v; guardar(); pintarAjustes(); };
    g('h2_traf').onclick = e => { if(!e.target.dataset.v) return; cfg.traffic = e.target.dataset.v; guardar(); pintarAjustes(); };
    for (const [k,,,,,u,dv] of SLD)
      g('h2r_'+k).oninput = e => { cfg[k] = +e.target.value/dv; g('h2o_'+k).textContent = cfg[k]+u; guardar(); };
    g('h2_perf').onclick = e => { if(!e.target.dataset.v) return; cfg.perfil = e.target.dataset.v; guardar(); pintarAjustes(); };
    for (const k of ['posts','hud','rain','spray','detalleCoche','frenarCamara','abrirAlNavegar','incrustado','carteles'])
      g('h2_'+k).onchange = e => {
        cfg[k] = e.target.checked; guardar();
        if (k === 'incrustado'){ activar(false); sheet.classList.remove('on'); }
      };
    if (g('h2_url').addEventListener) g('h2_url').onchange = e => {
      cfg.carPhotoUrl = e.target.value.trim(); guardar();
      if (cfg.carPhotoUrl) hud.setCarPhotoUrl(cfg.carPhotoUrl); else hud.setCarPhoto(null);
    };
    g('h2_drop').onclick = () => g('h2_file').click();
    g('h2_file').onchange = e => { if (e.target.files[0]) cargarFoto(e.target.files[0]); };
    if (g('h2_cut')){ g('h2r_tol').oninput = e => g('h2o_tol').textContent = e.target.value;
      g('h2_cut').onclick = () => recortarFondo(+g('h2r_tol').value); }
    if (g('h2_nofoto')) g('h2_nofoto').onclick = () => { fotoOrig = null;
      try { localStorage.removeItem('hud2.foto'); } catch(e){} hud.setCarPhoto(null); pintarAjustes(); };
    g('h2_done').onclick = () => sheet.classList.remove('on');
    g('h2_reset').onclick = () => { Object.assign(cfg, HUD2_DEF); guardar(); pintarAjustes(); };
  }
  gear.onclick = () => { pintarAjustes(); sheet.classList.add('on'); };

  /* ---- foto del coche ---- */
  let fotoOrig = null;
  const hayFoto = () => { try { return !!localStorage.getItem('hud2.foto'); } catch(e){ return false; } };
  async function cargarFoto(f){
    const st = document.getElementById('h2_stat');
    const adopta = (bmp, w, h) => {
      const sc = Math.min(1, 560/w), cn = document.createElement('canvas');
      cn.width = Math.round(w*sc); cn.height = Math.round(h*sc);
      cn.getContext('2d').drawImage(bmp, 0, 0, cn.width, cn.height);
      fotoOrig = cn; aplicarFoto(cn); pintarAjustes();
    };
    try { const b = await createImageBitmap(f); adopta(b, b.width, b.height); }
    catch(e){
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => { adopta(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(u); };
      im.onerror = () => { URL.revokeObjectURL(u); if (st) st.innerHTML =
        '<b style="color:#ff5a4d">Formato no soportado.</b> Usa PNG o JPG (el HEIC del iPhone no vale).'; };
      im.src = u;
    }
  }
  function aplicarFoto(cn){
    let url; try { url = cn.toDataURL('image/png'); } catch(e){ return; }
    hud.setCarPhoto(url);
    try { localStorage.setItem('hud2.foto', url); }
    catch(e){ const st = document.getElementById('h2_stat');
      if (st) st.innerHTML = '<b style="color:#ff5a4d">Aplicada pero no guardada:</b> ocupa demasiado.'; }
  }
  function recortarFondo(tol){
    if (!fotoOrig) return;
    const w = fotoOrig.width, h = fotoOrig.height;
    const cn = document.createElement('canvas'); cn.width = w; cn.height = h;
    const c2 = cn.getContext('2d', {willReadFrequently:true});
    c2.drawImage(fotoOrig, 0, 0);
    const img = c2.getImageData(0,0,w,h), D = img.data;
    let sr=0,sg=0,sb=0,cn2=0;
    const smp=(x,y)=>{const i=(y*w+x)*4; sr+=D[i]; sg+=D[i+1]; sb+=D[i+2]; cn2++;};
    for (let x=0;x<w;x+=3){ smp(x,0); smp(x,h-1); }
    for (let y=0;y<h;y+=3){ smp(0,y); smp(w-1,y); }
    sr/=cn2; sg/=cn2; sb/=cn2;
    const seen = new Uint8Array(w*h), q = new Int32Array(w*h);
    let hd=0, tl=0; const push2 = p => { if (!seen[p]){ seen[p]=1; q[tl++]=p; } };
    for (let x=0;x<w;x++){ push2(x); push2((h-1)*w+x); }
    for (let y=0;y<h;y++){ push2(y*w); push2(y*w+w-1); }
    while (hd < tl){
      const p = q[hd++], i = p*4, r=D[i], g=D[i+1], b=D[i+2];
      if (Math.abs(r-sr)+Math.abs(g-sg)+Math.abs(b-sb) > tol*7.8) continue;
      D[i+3] = 0;
      const x = p % w, y = (p/w)|0;
      const nb = (nx,ny) => { if (nx<0||ny<0||nx>=w||ny>=h) return;
        const np = ny*w+nx; if (seen[np]) return; const j = np*4;
        if (Math.abs(D[j]-r)+Math.abs(D[j+1]-g)+Math.abs(D[j+2]-b) <= tol*3) push2(np); };
      nb(x+1,y); nb(x-1,y); nb(x,y+1); nb(x,y-1);
    }
    const A = new Uint8ClampedArray(w*h);
    for (let p=0;p<w*h;p++) A[p] = D[p*4+3];
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++){
      const p=y*w+x; if (!A[p]) continue;
      const s4 = A[p-1]+A[p+1]+A[p-w]+A[p+w];
      if (s4 < 1020) D[p*4+3] = Math.round((A[p]*2 + s4/2)/4);
    }
    // Salvaguarda: si el recorte deja menos del 8% de píxeles opacos, se ha
    // comido el coche. Se descarta y se avisa, en vez de dejar un sprite invisible.
    let opacos = 0;
    for (let p = 0; p < w*h; p++) if (D[p*4+3] > 40) opacos++;
    const pct = opacos/(w*h);
    const st = document.getElementById('h2_stat');
    if (pct < 0.08){
      if (st) st.innerHTML = '<b style="color:#ff5a4d">Tolerancia demasiado alta:</b> el recorte se ha '
        + 'comido el coche (' + Math.round(pct*100) + '% visible). Bájala y vuelve a probar.';
      return;
    }
    c2.putImageData(img,0,0); aplicarFoto(cn);
    if (st) st.textContent = 'Fondo recortado · ' + Math.round(pct*100) + '% del cuadro visible.';
  }
  try { const f = localStorage.getItem('hud2.foto'); if (f) hud.setCarPhoto(f); } catch(e){}

  // contador de fps: la cifra que decide si esto aguanta en la pantalla del coche
  let n = 0, t0 = performance.now();
  (function tick(){
    requestAnimationFrame(tick);
    n++;
    const now = performance.now();
    if (now - t0 > 500){ fps.textContent = 'HUD 2 · ' + Math.round(n/(now-t0)*1000) + ' fps'; n = 0; t0 = now; }
  })();

  function activar(on){
    // modo incrustado: ni capa, ni botón de salida, ni parar el mapa
    if (cfg.incrustado){
      if (on){
        if (!montarIncrustado()){ console.warn('[hud2] no encuentro', cfg.destino); return; }
        if (!hudIn){
          hudIn = createHud2(cvIn, cfg);
          hudIn.onError = hud.onError;
          espejo();
          // La instancia incrustada nace vacía: si no se le pasa la ruta que ya
          // está cargada, el HUD sale en negro hasta que se calcule otra.
          if (rutaActual){ try { hudIn.setRoute(rutaActual, opcRuta || {}); } catch(e){} }
        }
        hudIn.set(cfg); hudIn.resize(); hudIn.start(); gpsOn();
      } else { if (hudIn) hudIn.stop(); desmontarIncrustado(); gpsOff(); }
      btn.classList.toggle('on', on);
      gear.style.display = on ? 'block' : 'none';
      if (!on) sheet.classList.remove('on');
      incrustadoActivo = on;
      return;
    }
    wrap.classList.toggle('on', on);
    if (btn.id === 'hud2-btn') btn.classList.toggle('on', on);
    else btn.style.opacity = on ? '1' : '';
    // El mapa sigue renderizando aunque esté tapado y se come GPU.
    // Parar el mapa de verdad: tapado con CSS sigue renderizando y se come la GPU.
    try {
      const m = mapaInst || window.map || window.mapa || window.mapaTesla;
      if (m){
        if (on){ if (m.stop) m.stop(); if (m.getCanvas) m.getCanvas().style.visibility = 'hidden'; }
        else { if (m.getCanvas) m.getCanvas().style.visibility = ''; if (m.resize) setTimeout(() => m.resize(), 60); }
      }
    } catch(e){}
    fps.style.display = on ? 'block' : 'none';
    gear.style.display = on ? 'block' : 'none';
    back.style.display = on ? 'block' : 'none';
    if (!on) sheet.classList.remove('on');
    if (on){ hud.resize(); hud.start(); gpsOn(); } else { hud.stop(); gpsOff(); }
  }
  btn.onclick = () => activar(!wrap.classList.contains('on'));
  back.onclick = () => activar(false);
  // Escape y el botón atrás del navegador también cierran
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && wrap.classList.contains('on')) activar(false);
  });
  window.addEventListener('orientationchange', () => setTimeout(hud.resize, 250));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
