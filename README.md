# HUD 2 — cinta de carretera 3D para autoboardV2

Canvas 2D, sin dependencias, un solo módulo ES.
Es **decorativo**: la fuente de verdad sigue siendo el mapa.

## Archivos

- `hud2.js` — el módulo. Es lo único que necesita autoboardV2.
- `demo.html` — página de prueba con una ruta sintética (recta, rotonda, curvas).
- `hud-sim.html` — banco de pruebas completo con todos los controles
  (lluvia, agua de ruedas, tráfico, tipo de vía, límite de fps, depuración).
  No forma parte del módulo; sirve para afinar valores.

## Uso

```js
import { createHud2 } from './hud2.js';

const hud = createHud2(document.getElementById('hud2-canvas'), { theme: 'auto' });
hud.onError = e => console.error(e);

hud.setRoute(latlngs);                    // [[lat,lng], ...] al calcular ruta
hud.setSpeed(mps);                        // en cada posición del GPS
hud.syncPosition(lat, lng);               // corrige la deriva, opcional
hud.start();                              // hud.stop() al volver al mapa
```

## Opciones

| Opción | Por defecto | Qué hace |
|---|---|---|
| `theme` | `'auto'` | `day`, `dusk`, `night` o por hora del reloj |
| `beamReach` | `34` | alcance del haz de faros, en metros |
| `fogEnd` | `260` | distancia de niebla |
| `lookAhead` | `55` | a cuánto mira la cámara a velocidad máxima |
| `camHeight` | `2.6` | altura de la cámara |
| `camBack` | `7.5` | distancia por detrás del coche |
| `posts` | `true` | farolas y quitamiedos |
| `carColor` | `'#cdd3d9'` | color de la carrocería |
| `maxFps` | `0` | 0 = libre. Pon `20` para simular el peor caso |

Se pueden cambiar en caliente: `hud.set({ lookAhead: 70 })`.

## Notas

- **Módulos ES**: `demo.html` no funciona abriéndolo con `file://`.
  Súbelo a Pages, o sirve la carpeta con `python3 -m http.server`.
- Las rotondas se detectan por curvatura sostenida (radio < 30 m durante
  más de 25 m). Da algún falso positivo en horquillas cerradas. Si tienes
  los `steps` de OSRM, pásalas exactas con `hud.setRoundabouts([[s0,s1], ...])`.
- El perfil de la carrocería está en la constante `PROF` de `hud2.js`:
  diez estaciones con semiancho y alturas en metros. Editable.
