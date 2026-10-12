// Chrome: entry veil, a bottom control bar (weather, intensity, time, sound, more), a tape panel
// that follows the cassette deck, hover captions, toasts and the breathing guide.
const HINTS = {
  glass: 'drag to wipe the glass · hold to breathe on it · tap to knock',
  candle: 'tap to blow out — or light — the candle',
  lamp: 'tap to turn the oil lamp up or down',
  cup: 'a full cup of tea · tap it… carefully',
  pot: 'tap the teapot to pour another cup',
  tape: '',
  latch: 'tap the handle to open the window',
  clock: 'hold to let time pass · tap to come back',
  plant: 'a small plant, glad of the rain',
};
const NAMES = {
  rain: ['Drizzle', 'Light rain', 'Steady rain', 'Heavy rain', 'Downpour'],
  snow: ['Flurries', 'Light snow', 'Snowing', 'Heavy snow', 'Blizzard'],
};
const fmtHour = (h) => { const H = Math.floor(h), M = Math.floor((h - H) * 60); return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`; };
const lightName = (h) => h < 5 ? 'Night' : h < 7 ? 'Dawn' : h < 10 ? 'Morning' : h < 16 ? 'Day' : h < 19 ? 'Golden hour' : h < 21 ? 'Dusk' : 'Night';

export function initUI(actions) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const body = document.body;
  const { audio, tape } = actions;
  const S = actions.getState();
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('stillwater-audio') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('stillwater-audio', JSON.stringify(prefs)); } catch { } };
  Object.entries(prefs.vol || {}).forEach(([k, v]) => audio.setVolume(k, v));
  if (prefs.tape !== undefined) tape.setVolume(prefs.tape);

  // ---------------------------------------------------------------- entry
  const veil = $('#enter');
  let entered = false;
  function enter() {
    if (entered) return; entered = true;
    veil.classList.add('gone');
    if (!prefs.muted) audio.start();
    sync();
    setTimeout(() => toast('drag across the glass'), 2200);
  }
  $('#enterBtn').addEventListener('click', enter);
  if (new URLSearchParams(location.search).get('ui') === '0') { veil.remove(); body.classList.add('bare'); entered = true; }

  // ---------------------------------------------------------------- weather + intensity
  const intensityName = () => S.weather === 'clear' ? 'Clear' : NAMES[S.weather][Math.min(4, Math.floor(S.rain * 5))];
  $$('[data-weather]').forEach(b => b.addEventListener('click', () => {
    actions.setWeather(b.dataset.weather); sync();
    toast(b.dataset.weather === 'snow' ? 'Snow is coming' : b.dataset.weather === 'clear' ? 'Clearing up' : 'Rain');
  }));
  const inten = $('#intensity');
  inten.addEventListener('input', () => { actions.setIntensity(+inten.value); sync(); });

  // ---------------------------------------------------------------- popovers
  const bar = $('.bar');
  const barTop = () => bar.getBoundingClientRect().top;
  const placePops = () => Object.values(pops).forEach(p => { p.style.bottom = (innerHeight - barTop() + 10) + 'px'; });
  addEventListener('resize', () => placePops());
  const pops = { time: $('#popTime'), sound: $('#popSound'), more: $('#popMore') };
  const openPop = (k) => {
    placePops();
    if (k) { tapePinned = false; chip.setAttribute('aria-expanded', false); }
    for (const [n, p] of Object.entries(pops)) {
      const show = n === k && p.hidden;
      p.hidden = !show;
      $(`[data-pop="${n}"]`).setAttribute('aria-expanded', show);
    }
  };
  $$('[data-pop]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openPop(b.dataset.pop); }));
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.bar, .pop, .tape-panel')) openPop(null); });

  // time
  const live = $('#liveToggle'), hourIn = $('#hour');
  const currentHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  live.addEventListener('click', () => { actions.setHour(S.hour === null ? currentHour() : null); sync(); });
  hourIn.addEventListener('input', () => { actions.setHour(+hourIn.value); sync(); });
  $$('[data-hour]').forEach(b => b.addEventListener('click', () => { actions.setHour(+b.dataset.hour); sync(); }));

  // sound
  const vol = (k, v) => {
    if (k === 'tape') { tape.setVolume(v); prefs.tape = v; }
    else if (k === 'outside') ['water', 'wind', 'life'].forEach(n => audio.setVolume(n, v));
    else audio.setVolume(k, v);
    prefs.vol = { ...audio.vol }; savePrefs();
  };
  $$('#popSound [data-vol]').forEach(inp => inp.addEventListener('input', () => vol(inp.dataset.vol, +inp.value)));
  const muteBtn = $('#mute');
  muteBtn.addEventListener('click', () => { audio.on ? (audio.stop(), prefs.muted = true) : (audio.start(), prefs.muted = false); savePrefs(); sync(); });

  // more
  $('#breatheBtn').addEventListener('click', () => { openPop(null); startBreath(); });
  $('#hideBtn').addEventListener('click', () => { openPop(null); body.classList.add('bare'); toast('press H to bring the controls back'); });
  $('#helpBtn').addEventListener('click', () => { $('#help').hidden = !$('#help').hidden; });

  // ---------------------------------------------------------------- tape panel
  const tp = $('#tapePanel');
  let tapeHover = false, tapeT = 0, tapePinned = false;
  const chip = $('#tapeChip');
  chip.addEventListener('click', (e) => { e.stopPropagation(); tapePinned = !tapePinned; chip.setAttribute('aria-expanded', tapePinned); openPop(null); });
  tp.addEventListener('pointerenter', () => { tapeHover = true; });
  tp.addEventListener('pointerleave', () => { tapeHover = false; tapeT = performance.now() + 900; });
  $$('#tapePanel [data-key]').forEach(b => b.addEventListener('click', () => { actions.tapeKey(b.dataset.key === 'toggle' ? (tape.on ? 'stop' : 'play') : b.dataset.key); tapeT = performance.now() + 4000; }));
  const tvol = $('#tapeVol');
  tvol.addEventListener('input', () => { vol('tape', +tvol.value); sync(); });
  function placeTape(x, y) {
    const show = entered && !body.classList.contains('bare') && (tapePinned || tapeHover || performance.now() < tapeT);
    tp.classList.toggle('show', show);
    if (!show) return;
    const w = tp.offsetWidth || 300;
    const onScreen = x > 0 && x < innerWidth && y > 80 && y < innerHeight;
    if (tapePinned || !onScreen) { tp.style.left = innerWidth / 2 + 'px'; tp.style.top = (barTop() - 12) + 'px'; }
    else { tp.style.left = Math.max(w / 2 + 12, Math.min(innerWidth - w / 2 - 12, x)) + 'px'; tp.style.top = Math.max(64, y) + 'px'; }
    $('#tapeTitle').textContent = tape.titles[tape.song];
    $('#tapeSide').textContent = `Side A · ${tape.song + 1} of ${tape.titles.length}`;
    const pos = tape.position(), dur = tape.buffers[tape.song]?.duration || 0;
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    $('#tapeTime').textContent = tape.state === 'wind' ? 'winding…' : dur ? `${mmss(pos)} / ${mmss(dur)}` : '—';
    $('#tapeProg').style.width = (tape.progress() * 100).toFixed(1) + '%';
    tp.classList.toggle('playing', tape.on);
    if (document.activeElement !== tvol) tvol.value = tape.vol;
  }

  // ---------------------------------------------------------------- hover caption
  const cap = $('#caption');
  let capT;
  function hover(name) {
    if (name === 'tape') tapeT = performance.now() + 2500;
    const text = name ? HINTS[name] : '';
    if (cap.dataset.name === (name || '')) return;
    cap.dataset.name = name || '';
    clearTimeout(capT);
    if (text) { cap.textContent = text; cap.classList.add('show'); }
    else capT = setTimeout(() => cap.classList.remove('show'), 400);
  }

  // ---------------------------------------------------------------- toast
  const toastEl = $('#toast');
  let toastT;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1700); }

  // ---------------------------------------------------------------- breathing
  const breath = $('#breath'), core = breath.querySelector('.core'), word = $('#breathWord'), sub = $('#breathSub');
  let bT = [];
  const clear = () => { bT.forEach(clearTimeout); bT = []; };
  function startBreath() {
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
  $('#breathBack').addEventListener('click', endBreath);
  addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input')) return;
    if (e.key === 'Escape') { if (!breath.hidden) endBreath(); openPop(null); }
    if (e.key === 'h' || e.key === 'H') body.classList.toggle('bare');
    if (e.key === 'b' || e.key === 'B') breath.hidden ? startBreath() : endBreath();
  });

  // ---------------------------------------------------------------- idle: chrome fades away
  let idleT;
  const anyOpen = () => Object.values(pops).some(p => !p.hidden) || tapeHover;
  const poke = () => { body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!anyOpen()) body.classList.add('idle'); else poke(); }, 9000); };
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(ev => addEventListener(ev, poke, { passive: true }));
  poke();

  // ---------------------------------------------------------------- reflect state
  function sync() {
    $$('[data-weather]').forEach(b => b.classList.toggle('on', b.dataset.weather === S.weather));
    inten.disabled = S.weather === 'clear';
    inten.value = S.rain;
    $('#intenLabel').textContent = intensityName();
    $('#intenWrap').classList.toggle('off', S.weather === 'clear');
    const h = S.hour ?? currentHour();
    $('#timeLabel').textContent = S.hour === null ? `Live · ${fmtHour(h)}` : `${lightName(h)} · ${fmtHour(h)}`;
    live.classList.toggle('on', S.hour === null);
    live.querySelector('span').textContent = S.hour === null ? 'Following your clock' : 'Follow my clock';
    hourIn.value = h;
    $('#hourName').textContent = `${lightName(h)} · ${fmtHour(h)}`;
    muteBtn.classList.toggle('on', audio.on);
    muteBtn.querySelector('span').textContent = audio.on ? 'Sound on' : 'Sound off';
    $('#soundIcon').classList.toggle('muted', !audio.on);
    $$('#popSound [data-vol]').forEach(inp => {
      if (document.activeElement === inp) return;
      const k = inp.dataset.vol;
      inp.value = k === 'tape' ? tape.vol : k === 'outside' ? audio.vol.water : audio.vol[k];
    });
  }
  setInterval(() => { if (S.hour === null) $('#timeLabel').textContent = `Live · ${fmtHour(currentHour())}`; }, 20000);
  sync();

  return {
    hover, toast, placeTape, sync, intensityName,
    firstGesture() { if (!entered) enter(); else if (!audio.on && !prefs.muted) { audio.start(); sync(); } },
  };
}
