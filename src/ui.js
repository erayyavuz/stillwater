// DOM controls: season / weather / light dial, sound + mixer, breathing, idle fade.
export function initUI(state, actions, names) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const body = document.body;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('stillwater-audio') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('stillwater-audio', JSON.stringify(prefs)); } catch { } };

  // --- season / weather
  const syncSeg = () => {
    $$('[data-season]').forEach(b => b.classList.toggle('on', b.dataset.season === state.season));
    $$('[data-weather]').forEach(b => b.classList.toggle('on', b.dataset.weather === state.weather));
  };
  $$('[data-season]').forEach(b => b.addEventListener('click', () => { actions.setSeason(b.dataset.season); syncSeg(); }));
  $$('[data-weather]').forEach(b => b.addEventListener('click', () => { actions.setWeather(b.dataset.weather); syncSeg(); }));
  syncSeg();

  // --- light dial (quadratic arc, x is monotonic in t)
  const A = [14, 16], C = [120, 22], B = [226, 64];
  const at = (t) => { const u = 1 - t; return [u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], u * u * A[1] + 2 * u * t * C[1] + t * t * B[1]]; };
  const dial = $('#dial'), knob = $('#knob'), glow = $('#knobGlow'), lname = $('#lightName');
  function syncLight(tod) {
    const [x, y] = at(tod / 3);
    knob.setAttribute('cx', x); knob.setAttribute('cy', y);
    glow.setAttribute('cx', x); glow.setAttribute('cy', y);
    const i = Math.round(tod);
    lname.textContent = names[i];
    dial.setAttribute('aria-valuenow', tod.toFixed(2));
    dial.setAttribute('aria-valuetext', names[i]);
    $$('[data-tod]').forEach(b => b.classList.toggle('on', +b.dataset.tod === i));
  }
  const fromX = (clientX) => {
    const r = dial.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * 240;
    let lo = 0, hi = 1;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (at(m)[0] < sx) lo = m; else hi = m; }
    return Math.min(3, Math.max(0, lo * 3));
  };
  let dragging = false;
  dial.addEventListener('pointerdown', (e) => { dragging = true; dial.setPointerCapture(e.pointerId); actions.setTod(fromX(e.clientX)); });
  dial.addEventListener('pointermove', (e) => { if (dragging) actions.setTod(fromX(e.clientX)); });
  dial.addEventListener('pointerup', () => { dragging = false; });
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { actions.setTod(state.tod + 0.1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { actions.setTod(state.tod - 0.1); e.preventDefault(); }
  });
  $$('[data-tod]').forEach(b => b.addEventListener('click', () => actions.setTod(+b.dataset.tod)));
  syncLight(state.tod);

  // --- sound
  const audio = actions.audio;
  Object.entries(prefs.vol || {}).forEach(([k, v]) => audio.setVolume(k, v));
  $$('[data-vol]').forEach(inp => {
    inp.value = audio.vol[inp.dataset.vol];
    inp.addEventListener('input', () => { audio.setVolume(inp.dataset.vol, +inp.value); prefs.vol = { ...audio.vol }; savePrefs(); });
  });
  const soundBtn = $('#soundBtn'), soundLabel = $('#soundLabel');
  const syncSound = () => {
    soundBtn.classList.toggle('sound-on', audio.on);
    soundBtn.setAttribute('aria-pressed', audio.on);
    soundLabel.textContent = audio.on ? 'Sound on' : 'Sound off';
  };
  soundBtn.addEventListener('click', () => {
    if (audio.on) { audio.stop(); prefs.muted = true; } else { audio.start(); prefs.muted = false; }
    savePrefs(); syncSound();
  });
  const mixer = $('#mixer'), mixBtn = $('#mixBtn');
  mixBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mixer.hidden = !mixer.hidden;
    mixBtn.setAttribute('aria-expanded', !mixer.hidden);
  });
  document.addEventListener('pointerdown', (e) => { if (!mixer.hidden && !e.target.closest('.sound-wrap')) { mixer.hidden = true; mixBtn.setAttribute('aria-expanded', false); } });
  // first deliberate interaction turns sound on unless the visitor muted it before
  function maybeAutoSound() { if (!prefs.muted && !audio.on) { audio.start(); syncSound(); } }

  // --- customize (mobile)
  $('#customizeBtn').addEventListener('click', () => body.classList.toggle('panel-open'));

  // --- skip
  $('#skipBtn').addEventListener('click', () => actions.skip());

  // --- just the lake
  const showUi = $('#showUi');
  const setBare = (on) => { body.classList.toggle('bare', on); showUi.hidden = !on; };
  $('#hideBtn').addEventListener('click', () => setBare(true));
  showUi.addEventListener('click', () => setBare(false));

  // --- breathing
  const breath = $('#breath'), core = breath.querySelector('.core'), word = $('#breathWord'), sub = $('#breathSub');
  let bTimers = [];
  const clearB = () => { bTimers.forEach(clearTimeout); bTimers = []; };
  function startBreath() {
    maybeAutoSound();
    body.classList.add('breathing');
    breath.hidden = false;
    actions.breathe(true);
    clearB();
    const cycles = 6, inS = 4, outS = 6;
    let t = 1200;
    word.textContent = 'Settle in'; sub.textContent = 'six slow breaths';
    core.style.transitionDuration = '1.2s'; core.style.transform = 'scale(.42)';
    for (let i = 0; i < cycles; i++) {
      bTimers.push(setTimeout(() => {
        word.textContent = 'Breathe in'; sub.textContent = `${cycles - i} of ${cycles}`;
        core.style.transitionDuration = inS + 's'; core.style.transform = 'scale(1)';
      }, t));
      t += inS * 1000;
      bTimers.push(setTimeout(() => {
        word.textContent = 'Let it go';
        core.style.transitionDuration = outS + 's'; core.style.transform = 'scale(.42)';
      }, t));
      t += outS * 1000;
    }
    bTimers.push(setTimeout(() => { word.textContent = 'Welcome back'; sub.textContent = 'stay as long as you like'; }, t));
    bTimers.push(setTimeout(endBreath, t + 3500));
  }
  function endBreath() {
    clearB();
    body.classList.remove('breathing');
    breath.hidden = true;
    actions.breathe(false);
    poke();
  }
  $('#breatheBtn').addEventListener('click', startBreath);
  $('#breathBack').addEventListener('click', endBreath);

  // --- keyboard
  addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input')) return;
    if (e.key === 'Escape') { if (!breath.hidden) endBreath(); else setBare(false); }
    if (e.key === 'h' || e.key === 'H') setBare(!body.classList.contains('bare'));
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); actions.skip(); }
  });

  // --- idle fade: after a while only the lake remains
  let idleT;
  function poke() {
    body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (mixer.hidden) body.classList.add('idle'); }, 14000);
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, poke, { passive: true }));
  poke();

  if (new URLSearchParams(location.search).get('ui') === '0') { setBare(true); showUi.hidden = true; }
  syncSound();
  return { syncLight, maybeAutoSound };
}
