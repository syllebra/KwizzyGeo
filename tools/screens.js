/* SCREENSHOTS FOR THE README - a dev tool, never shipped, never run by the tests.

   It drives the real page in a real Chromium (playwright-core, pointed at the system's
   chromium) at two viewports - a desktop and a phone - and takes the same five pictures
   in each, so the README can show the game as it actually looks rather than as a montage.

   WHY A SCRIPT AND NOT A HANDBAG OF SCREENSHOTS: every picture here is a STATE, and a
   state has to be reproduced the day the UI moves. The states are produced through the
   app's own entry points (`Quizzy.set/go/start`, the mouse, the keyboard), never by
   poking at the DOM or by CSS overrides - a screenshot that needs the app bent to look
   right is a screenshot of a different app.

   Run:  node tools/screens.js            (needs `npm i playwright-core` somewhere, and
                                          tools/ has no node_modules: install it beside
                                          this file or set NODE_PATH)
         node tools/screens.js --only title,reveal
   Out:  docs/screens/<name>-<viewport>.jpg, plus a .jpg of each at half size for the
         README's table (GitHub renders the folder, not a build step).

   THE SERVER: the page fetches its data with relative paths, so serve the repo root
   (`python3 -m http.server 8123`) and pass --url if the port differs. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const URL_ARG = process.argv.find(a => a.startsWith('--url='));
const URL_BASE = (URL_ARG && URL_ARG.slice(6)) || 'http://localhost:8123/index.html';
/* ?hud=0 is a documented flag of the app (see the comment on hudOn in app.js): the HUD
   and the hint line are build instrumentation, and a picture for the README is the game,
   not the frame-rate counter. */
const PAGE_URL = URL_BASE + (URL_BASE.indexOf('?') >= 0 ? '&' : '?') + 'hud=0';
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const OUT = path.join(__dirname, '..', 'docs', 'screens');

/* The two shapes worth showing. 1440x900 is the viewport every measurement in the README
   was taken at, so a desktop picture matches the numbers; 390x844 is an iPhone 14, which
   is the frame the phone layout was tuned on (`.qz-` breakpoints at 560 and 900). */
const VIEWPORTS = [
  /* THE HERO: a wide banner for the top of the README. 1600x680 is the 2.35:1 GitHub
     renders without cropping, and it is the same page at a third shape - not a montage. */
  { id: 'hero', width: 1600, height: 680, dsf: 1.5 },
  { id: 'desktop', width: 1440, height: 900, dsf: 2 },
  { id: 'phone', width: 390, height: 844, dsf: 2 }
];

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const want = only ? only.split(',') : null;
const pick = name => !want || want.indexOf(name) >= 0;

/* ---------- helpers that run IN the page ---------- */
/* Every one of these is a read of the app's public API, and each returns a value the
   script needs to aim a real mouse click. Nothing writes. */
const pageHelpers = () => {
  window.__shot = {
    ready: () => !!(window.MapApp && window.MapApp.ready() && window.MapApp.ready()),
    state: () => window.Quizzy.state(),
    /* the city of the current locate question, as {lat, lon} */
    city: () => {
      const st = window.Quizzy.state();
      if (!st.question) return null;
      const c = window.MapApp.cities().filter(x => x.id === st.question.answerId)[0];
      return c ? { name: c.name, lat: c.lat, lon: c.lon, country: c.country } : null;
    },
    /* where a geographic point sits on screen right now */
    px: (lon, lat) => {
      const p = window.ViewState.project(lon, lat);
      return p ? { x: p[0], y: p[1] } : null;
    },
    settle: () => new Promise(r => setTimeout(r, 1200))
  };
};

/* the mouse path a player takes to a locate answer: press, move a little, release, click.
   A bare click is enough for the app (it is the `click` handler that aims), but the press
   is what a real player does and it also proves the drag slop is not in the way. */
async function clickAt(page, pt) {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
}

/* start a locate round, and restart it until the asked city is one we want in a picture.
   Bounded, so a data change that removes all of them fails the run instead of looping. */
async function drawUntil(page, zone, diff, prefer, tries, opts) {
  const max = tries || 40;
  const o = opts || {};
  for (let i = 0; i < max; i++) {
    const name = await page.evaluate(([z, d, mode, variant]) => {
      window.Quizzy.quit();
      window.Quizzy.set({ mode: mode, zone: z, difficulty: d, len: 5, variant: variant });
      window.Quizzy.go('mode'); window.Quizzy.go('zone'); window.Quizzy.go('diff');
      window.Quizzy.start();
      const st = window.Quizzy.state();
      return st.question ? st.question.answer : null;
    }, [zone, diff, o.mode || 'locate', o.variant]);
    if (name && prefer.indexOf(name) >= 0) return name;
  }
  throw new Error('no draw among ' + prefer.join('/') + ' in ' + max + ' rounds');
}

/* ---------- the five pictures ---------- */
/* Each entry: { name, ttl, prepare(page) }. `prepare` leaves the app in the state to
   photograph; the caller screenshots and never touches the page again. */
const SCENES = [
  {
    name: 'title',
    /* the hero is the POSTER: the wordmark over the drifting globe, which is what the
       game looks like before you touch it. The other scenes are the game itself, and
       they are shot at the two shapes a player holds it in. */
    viewports: ['hero', 'desktop', 'phone'],
    alt: 'The title screen: the wordmark over a slowly drifting globe, and Play',
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      /* the drift's zoom (x2) eases in at once; the longitude moves at 0.4 deg/s, so this
         lands Africa and Europe under the wordmark */
      await page.waitForTimeout(9000);
    }
  },
  {
    name: 'modes',
    viewports: ['desktop', 'phone'],
    alt: 'What do you want to find: four modes, including Locate the city',
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.Quizzy.go('mode'));
      await page.waitForTimeout(900);
    }
  },
  {
    name: 'locate',
    viewports: ['desktop', 'phone'],
    alt: 'A locate question: the city is named and the globe shows its continent',
    /* WHICH CITY IS IN THE PICTURE. The app draws it at random, and a random draw is a
       fine game but a poor advertisement: half the Easy cities of Europe are Russian
       (Natural Earth files Russia under Europe), so the round can perfectly well open on
       Novosibirsk over a map of Europe, which reads as a bug in a still. So the scene
       RESTARTS the round until the draw lands on one of these - the app is not bent, we
       only wait for a good draw, the same way a photographer waits for the light. */
    prefer: ['Paris', 'Rome', 'Lisbon', 'Vienna', 'Prague', 'Budapest', 'Barcelona',
             'Amsterdam', 'Copenhagen', 'Stockholm', 'Athens', 'Warsaw', 'Dublin',
             'Berlin', 'Madrid', 'Brussels', 'Marseille', 'Milan', 'Munich', 'Seville'],
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      await drawUntil(page, 'europe', 'easy', this.prefer);
      await page.waitForTimeout(1900);          /* the zone flight */
    }
  },
  {
    name: 'reveal',
    viewports: ['desktop', 'phone'],
    alt: 'The reveal: your marker, the city, and the distance written on the line',
    prefer: ['Paris', 'Rome', 'Lisbon', 'Vienna', 'Prague', 'Budapest', 'Barcelona',
             'Amsterdam', 'Copenhagen', 'Stockholm', 'Athens', 'Warsaw', 'Dublin',
             'Berlin', 'Madrid', 'Brussels', 'Marseille', 'Milan', 'Munich', 'Seville'],
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      await drawUntil(page, 'europe', 'easy', this.prefer);
      await page.waitForTimeout(1800);
      const city = await page.evaluate(() => window.__shot.city());
      /* A GOOD MISS: ~120 km to the south-east. A bullseye would put the two dots on top
         of each other and a huge miss would shrink both; 120 km is a line you can read
         and a mistake a player actually makes. */
      const guess = { lat: city.lat - 0.75, lon: city.lon + 0.75 };
      const pt = await page.evaluate(g => window.__shot.px(g.lon, g.lat), guess);
      if (!pt) throw new Error('the guess is not on screen: ' + JSON.stringify(guess));
      await clickAt(page, pt);
      await page.waitForTimeout(450);
      await page.keyboard.press('Enter');        /* Confirm, as the keyboard does */
      await page.waitForTimeout(2200);           /* the reveal's flight */
    }
  },
  {
    name: 'flag',
    viewports: ['desktop', 'phone'],
    /* THE OTHER HALF OF THE FLAG QUESTION, and the better picture: the country is named
       and the six options are FLAGS. The flag->country half was the first choice and it
       photographs badly - the answer's country is lit up at a fitted zoom, and a country
       filled with the pick colour at 3x the world fit is a white blob over the whole
       screen. Here the six flags are the subject. */
    alt: 'The flag question: the country is named, the six answers are flags',
    /* A SMALL COUNTRY. The lit country is the brightest thing on the map by design, and
       the flight fits it to the frame - so a big one turns most of the picture into one
       pale silhouette with its neighbours pushed off the edges (Togo, a sliver, filled
       the whole height in the first attempt). A small country keeps the surroundings that
       make "where is it" a question; the quiz's own 6-degree zoom floor is what makes
       those surroundings visible at all. */
    prefer: ['Malta', 'Luxembourg', 'Cyprus', 'Lebanon', 'Qatar', 'Jamaica', 'Fiji',
             'Bahrain', 'Djibouti', 'Montenegro', 'Slovenia', 'Brunei', 'Cape Verde',
             'Trinidad and Tobago', 'Comoros', 'Vanuatu', 'Samoa', 'Estonia', 'Latvia',
             'Slovakia', 'Croatia', 'Albania', 'Armenia', 'Israel', 'Uruguay', 'Panama',
             'Costa Rica', 'Belize', 'Haiti', 'Iceland', 'Ireland', 'Denmark', 'Kuwait'],
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      await drawUntil(page, 'world', 'medium', this.prefer, 80, { variant: 'flags', mode: 'flag' });
      await page.waitForTimeout(1900);
    }
  },
  {
    name: 'explore',
    viewports: ['desktop', 'phone'],
    alt: 'Explore the map: the grey chart, the country panel, the HUD',
    async prepare(page) {
      await page.waitForFunction(() => window.__shot && window.__shot.ready(), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      /* the title's own Explore button, then a country picked with a real click, so the
         panel is the one a player gets */
      await page.click('[data-act="explore"]');
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        /* the middle of the frame is inside a country at the fitted world view: use the
           map's own picker to find a pixel that IS a country, so the shot cannot land on
           the ocean and show an empty screen */
        const V = window.ViewState;              /* pickAt lives on the view, not the app */
        for (let y = 300; y < 620; y += 20) {
          for (let x = 200; x < 1240; x += 20) {
            if (V.pickAt(x, y) >= 0) return { x, y };
          }
        }
        return null;
      }).then(async pt => { if (pt) await clickAt(page, pt); });
      await page.waitForTimeout(900);
    }
  }
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const made = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dsf,
      isMobile: vp.id === 'phone',
      hasTouch: vp.id === 'phone',
      locale: 'en-GB',                 /* the screenshots are in English: the reference */
      colorScheme: 'dark',
      /* NO reducedMotion OVERRIDE. It was the first idea ("a still is a state"), and it
         made the title shot a small, dim globe: prefers-reduced-motion also switches OFF
         the drift's 2x zoom, and the title's whole look is a globe filling the frame
         behind the wordmark. So the app runs its normal title behaviour and the script
         WAITS for the drift to reach a good longitude - Africa and Europe under the logo,
         which is where the wordmark was designed to sit. The wait is a fixed number of
         seconds, so the picture is reproducible: the drift is 0.4 deg/s from a known
         start. */
      reducedMotion: 'no-preference'
    });
    const page = await ctx.newPage();
    /* the page surfaces its own errors in the HUD; a console error here is a broken
       capture, not a cosmetic detail, so fail loudly */
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    for (const scene of SCENES) {
      if (!pick(scene.name)) continue;
      if (scene.viewports && scene.viewports.indexOf(vp.id) < 0) continue;
      await page.goto(PAGE_URL, { waitUntil: 'load' });
      await page.evaluate(pageHelpers);
      await scene.prepare(page);
      /* one more frame, so nothing is mid-transition */
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const file = path.join(OUT, scene.name + '-' + vp.id + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      made.push({ file, scene: scene.name, vp: vp.id, errors: errors.splice(0) });
      console.log('shot ' + path.basename(file));
    }
    await ctx.close();
  }
  await browser.close();
  const bad = made.filter(m => m.errors.length);
  if (bad.length) {
    console.log('\nPAGE ERRORS (the capture is not trustworthy):');
    bad.forEach(m => console.log('  ' + path.basename(m.file) + ': ' + m.errors.join(' | ')));
    process.exit(1);
  }
  console.log('\n' + made.length + ' screenshots in docs/screens/');
})();
