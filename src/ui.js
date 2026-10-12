// Minimal chrome: an entry veil, a corner menu, hover captions, toasts and the breathing guide.
const HINTS = {
  glass: 'drag to wipe the glass · hold to breathe on it · tap to knock',
  candle: 'tap to blow out — or light — the candle',
  lamp: 'tap to turn the oil lamp up or down',
  cup: 'tap for a sip of tea · move through the steam',
  tape: 'tap to play the tape',
  latch: 'tap to open the window',
  clock: 'hold to let time pass · tap to come back to now',
  plant: 'a small plant, glad of the rain',
};

export function initUI(actions) {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const audio = actions.audio;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('stillwater-audio') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('stillwater-audio', JSON.stringify(prefs)); } catch { } };
  Object.entries(prefs.vol || {}).forEach(([k, v]) => audio.setVolume(k, v));

  const soundBtn = $('#soundBtn');
  const syncSound = () => { soundBtn.classList.toggle('on', audio.on); soundBtn.querySelector('span').textContent = audio.on ? 'Sound on' : 'Sound off'; };
  soundBtn.addEventListener('click', () => { audio.on ? (audio.stop(), prefs.muted = true) : (audio.start(), prefs.muted = false); savePrefs(); syncSound(); });

  // entry veil (also the audio-unlocking gesture)
  const veil = $('#enter');
  let entered = false;
  function enter() {
    if (entered) return; entered = true;
    veil.classList.add('gone');
    if (!prefs.muted) audio.start();
    syncSound();
    setTimeout(() => toast('drag across the glass'), 2200);
  }
  $('#enterBtn').addEventListener('click', enter);
  if (new URLSearchParams(location.search).get('ui') === '0') { veil.remove(); body.classList.add('bare'); entered = true; }

  // menu
  const menu = $('#menu'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', !menu.hidden); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true; });
  menu.querySelectorAll('[data-vol]').forEach(inp => {
    const k = inp.dataset.vol;
    inp.value = k === 'tape' ? (actions.tape.vol ?? 0.55) : audio.vol[k];
    inp.addEventListener('input', () => {
      if (k === 'tape') actions.tape.setVolume(+inp.value); else audio.setVolume(k, +inp.value);
      prefs.vol = { ...audio.vol }; savePrefs();
    });
  });

  // hover caption
  const cap = $('#caption');
  let capT;
  function hover(name) {
    const text = name ? HINTS[name] : '';
    if (cap.dataset.name === (name || '')) return;
    cap.dataset.name = name || '';
    clearTimeout(capT);
    if (text) { cap.textContent = text; cap.classList.add('show'); }
    else capT = setTimeout(() => cap.classList.remove('show'), 400);
  }

  // toast
  const toastEl = $('#toast');
  let toastT;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1600); }

  // breathing
  const breath = $('#breath'), core = breath.querySelector('.core'), word = $('#breathWord'), sub = $('#breathSub');
  let bT = [];
  const clear = () => { bT.forEach(clearTimeout); bT = []; };
  function startBreath() {
    menu.hidden = true;
    body.classList.add('breathing'); breath.hidden = false; actions.breathe(true); clear();
    const cycles = 6, inS = 4, outS = 6; let t = 1200;
    word.textContent = 'Settle in'; sub.textContent = 'six slow breaths';
    core.style.transitionDuration = '1.2s'; core.style.transform = 'scale(.42)';
    for (let i = 0; i < cycles; i++) {
      bT.push(setTimeout(() => { word.textContent = 'Breathe in'; sub.textContent = `${cycles - i} of ${cycles}`; core.style.transitionDuration = inS + 's'; core.style.transform = 'scale(1)'; }, t)); t += inS * 1000;
      bT.push(setTimeout(() => { word.textContent = 'Let it go'; core.style.transitionDuration = outS + 's'; core.style.transform = 'scale(.42)'; }, t)); t += outS * 1000;
    }
    bT.push(setTimeout(() => { word.textContent = 'Welcome back'; sub.textContent = 'stay as long as you like'; }, t));
    bT.push(setTimeout(endBreath, t + 3500));
  }
  function endBreath() { clear(); body.classList.remove('breathing'); breath.hidden = true; actions.breathe(false); }
  $('#breatheBtn').addEventListener('click', startBreath);
  $('#breathBack').addEventListener('click', endBreath);
  $('#bareBtn').addEventListener('click', () => { menu.hidden = true; body.classList.add('bare'); toast('press H to bring the menu back'); });
  addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input')) return;
    if (e.key === 'Escape' && !breath.hidden) endBreath();
    if (e.key === 'h' || e.key === 'H') body.classList.toggle('bare');
    if (e.key === 'b' || e.key === 'B') breath.hidden ? startBreath() : endBreath();
  });

  // idle: chrome fades away
  let idleT;
  const poke = () => { body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (menu.hidden) body.classList.add('idle'); }, 9000); };
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev => addEventListener(ev, poke, { passive: true }));
  poke();

  syncSound();
  return {
    hover, toast,
    firstGesture() { if (!entered) enter(); else if (!audio.on && !prefs.muted) { audio.start(); syncSound(); } },
  };
}
