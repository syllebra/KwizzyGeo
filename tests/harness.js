/* headless run of app.js: fake DOM + canvas recorder, then simulate pointer events */
const fs = require('fs');
global.Path2D = function () { return { moveTo: function(){}, lineTo: function(){}, closePath: function(){} }; };

const canvasCalls = { fill: 0, stroke: 0, fillText: 0, strokeText: 0, setTransform: 0 };
const errors = [];

function makeCtx() {
  const c = canvasCalls;
  return {
    setTransform: function () { c.setTransform++; },
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    fillRect: function () { c.fill++; },
    fill: function (p) { c.fill++; },
    stroke: function (p) { c.stroke++; },
    beginPath: function () {}, rect: function () {}, closePath: function () {},
    moveTo: function () {}, lineTo: function () {},
    fillText: function () { c.fillText++; },
    strokeText: function () { c.strokeText++; },
    measureText: function (t) { return { width: String(t).length * 6.2 }; },
    save: function () {}, restore: function () {}, clip: function () {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1
  };
}

function listeners() { return {}; }
const L = listeners();

const canvasEl = {
  width: 0, height: 0, style: {},
  getContext: function () { return makeCtx(); },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1440, height: 900 }; },
  addEventListener: function (type, fn) { L[type] = fn; }
};
/* the stage div carries the pointer listeners in app.js; labels is the 2D
   overlay canvas that stays transparent in headless mode */
const stageEl = {
  appendChild: function () {}, replaceChild: function () {},
  addEventListener: function (type, fn) { L['stage:' + type] = fn; },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1440, height: 900 }; }
};
const labelsEl = {
  width: 0, height: 0, style: {},
  getContext: function () { return makeCtx(); },
  addEventListener: function () {}
};
const stageCalls = { fill: 0, stroke: 0, fillText: 0, strokeText: 0, setTransform: 0, clearRect: 0 };
labelsEl.getContext = function () {
  const c = stageCalls;
  return { setTransform: function () { c.setTransform++; }, clearRect: function () { c.clearRect++; },
           fillText: function () { c.fillText++; }, strokeText: function () { c.strokeText++; },
           measureText: function (t) { return { width: String(t).length * 6.2 }; },
           fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '' };
};
function DivEl(name) {
  const el = { innerHTML: '', textContent: '', className: '', dataset: {}, children: [],
               style: {},
               
               addEventListener: function (t, f) { L[name + ':' + t] = f; },
               getBoundingClientRect: function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
               removeChild: function () {} };
  /* a faithful classList: it must read and write className, because the app
     queries rows with getElementsByClassName and marks them with classList.add */
  el.classList = {
    add: function (c) { var a = el.className ? el.className.split(' ') : []; if (a.indexOf(c) < 0) a.push(c); el.className = a.filter(Boolean).join(' '); },
    remove: function (c) { var a = el.className ? el.className.split(' ') : []; el.className = a.filter(function (x) { return x && x !== c; }).join(' '); },
    contains: function (c) { return (el.className ? el.className.split(' ') : []).indexOf(c) >= 0; }
  };
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.setAttribute = function (k, v) { el['attr:' + k] = v; };
  el.getElementsByClassName = function (cn) {
    const out = [];
    const walk = function (n) {
      for (const c of n.children || []) {
        if (c.className && (' ' + c.className + ' ').indexOf(' ' + cn + ' ') >= 0) out.push(c);
        walk(c);
      }
    };
    walk(el);
    return out;
  };
  return el;
}
const panelEl = DivEl('panel'), hudEl = DivEl('hud'), helpEl = DivEl('help');
const menuEl = DivEl('menu'), burgerEl = DivEl('burger'), itemsEl = DivEl('items'), scrimEl = DivEl('scrim');

global.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener: function (t, f) { L['win:' + t] = f; },
  requestAnimationFrame: function (f) { return 1; },
  document: {
    getElementById: function (id) {
      if (id === 'map') return canvasEl;
      if (id === 'stage') return stageEl;
      if (id === 'labels') return labelsEl;
      if (id === 'panel') return panelEl;
      if (id === 'hud') return hudEl;
      if (id === 'menu') return menuEl;
      if (id === 'scrim') return scrimEl;
      if (id === 'burger') return burgerEl;
      if (id === 'items') return itemsEl;
      return helpEl;
    },
    addEventListener: function () {},
    createElement: function (tag) { return DivEl('el' + (Math.random() * 1e9 | 0)); }
  }
};
global.document = global.window.document;
global.requestAnimationFrame = function (f) { return 1; };
global.Promise = Promise;
global.fetch = function (u) {
  const p = (u === 'so50.geojson') ? __dirname + '/../so50.geojson' : __dirname + '/../countries.geojson';
  return Promise.resolve({ json: function () { return JSON.parse(fs.readFileSync(p, 'utf8')); } });
};

const coreSrc = fs.readFileSync(__dirname + '/../core.js', 'utf8');
new Function(coreSrc).call();
const appSrc = fs.readFileSync(__dirname + '/../app.js', 'utf8');
try { new Function(appSrc).call(); } catch (e) { errors.push('load: ' + e); }

const stage2d = stageCalls;
function dispatch(type, ev) {
  if (ev && !ev.preventDefault) ev.preventDefault = function () {};
  var fn = L[type] || L['stage:' + type];
  if (!fn) return;
  try { fn(ev); } catch (e) { errors.push(type + ': ' + e.message); }
}
function mouse(x, y) { return { offsetX: x, offsetY: y, deltaX: 0, deltaY: 0 }; }

setTimeout(function () {
  dispatch('mousemove', mouse(800, 420));
  dispatch('mousedown', mouse(800, 420));
  dispatch('mousemove', mouse(860, 440));
  dispatch('mouseup', mouse(860, 440));
  dispatch('wheel', { offsetX: 860, offsetY: 440, deltaY: -320 });
  dispatch('mousemove', mouse(860, 440));
  dispatch('click', mouse(860, 440));
  setTimeout(function () {
    dispatch('wheel', { offsetX: 860, offsetY: 440, deltaY: 700 });
    dispatch('mousemove', mouse(1000, 620));
    dispatch('click', mouse(1000, 620));
    dispatch('touchstart', { touches: [{ clientX: 700, clientY: 400 }] });
    dispatch('touchmove', { touches: [{ clientX: 760, clientY: 430 }] });
    dispatch('touchstart', { touches: [{ clientX: 600, clientY: 400 }, { clientX: 800, clientY: 400 }] });
    dispatch('touchmove', { touches: [{ clientX: 520, clientY: 400 }, { clientX: 900, clientY: 400 }] });
    dispatch('keydown', { key: 'ArrowRight' });
    dispatch('keydown', { key: 'a' });
    dispatch('keydown', { key: 'Enter' });
    dispatch('keydown', { key: 'Escape' });
    setTimeout(function () {
      console.log('canvas ops:  ' + JSON.stringify(canvasCalls));
      console.log('label ops:   ' + JSON.stringify(stage2d));
      console.log('panel:  ' + panelEl.innerHTML.replace(/<\/?(div|span)[^>]*>/g, ' | ')
        .replace(/\s+/g, ' ').trim());
      console.log('hud:  ' + hudEl.textContent);
      console.log('help:  ' + helpEl.textContent);
      /* layer switch: press t, then report the 110m layer */
      try { L['win:keydown']({ key: 't' }); } catch (e) { errors.push('t: ' + e.message); }
      dispatch('mousemove', mouse(720, 380));
      console.log('after t -> hud:  ' + hudEl.textContent);
      console.log('panel after t:  ' + panelEl.innerHTML.replace(/<\/?(div|span)[^>]*>/g, ' | ').replace(/\s+/g, ' ').trim());
      /* switch to the globe and back: the 3D path reads rg.pts/rg.levels, which
         the recentering must never have overwritten */
      try { L['win:keydown']({ key: 'm' }); } catch (e) { errors.push('m(3d): ' + e.message); }
      console.log('after m -> hud:  ' + hudEl.textContent.split('\n')[0]);
      try { L['win:keydown']({ key: 'm' }); } catch (e) { errors.push('m(2d): ' + e.message); }
      dispatch('mousemove', mouse(700, 400));
      console.log('back in 2d -> hud:  ' + hudEl.textContent.split('\n')[0]);
      console.log('errors:  ' + (errors.length ? errors : 'none'));
      process.exit(0);
    }, 400);
  }, 60);
}, 400);
