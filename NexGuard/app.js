/* NexGuard frontend prototype. Real detection requires backend integration. */
const MAX_FILE_BYTES = 700 * 1000 * 1000; // 700 MB decimal; server must enforce this too.
const ALLOWED_EXTENSIONS = new Set([
  'PDF','DOC','DOCX','XLS','XLSX','PPT','PPTX','TXT','CSV','RTF',
  'JPG','JPEG','PNG','GIF','WEBP','BMP','ZIP','7Z','RAR','TAR','GZ',
  'APK','EXE','MSI','DLL','MP3','MP4','HTML','JS','PY','JSON','XML','ISO','JAR','BAT','CMD','SCR','VBS','PS1','DOCM','XLSM','PPTM'
]);
const routes = ['home', 'file', 'url', 'apk', 'history', 'support'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { route: 'home', chosenFile: null, chosenApk: null, history: [], toastTimer: null, runId: 0 };

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}

function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 ** 2) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / (1000 ** 2)).toFixed(2)} MB`;
}

function getExtension(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : 'UNKNOWN';
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function readHashRoute() {
  const candidate = window.location.hash.replace(/^#\/?/, '').trim();
  return routes.includes(candidate) ? candidate : 'home';
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const pageEl = r => $(`.page[data-page="${r}"]`);
let shownPage = $('.page.active'), navToken = 0;

function navigate(route, push = true) {
  if (!routes.includes(route)) route = 'home';
  if (route === state.route) return;
  if (push && window.location.hash !== `#${route}`) history.pushState({ route }, '', `#${route}`);
  showRoute(route);
}

function updateNav(route) {
  $$('.nav-link').forEach(l => {
    const on = l.dataset.route === route;
    l.classList.toggle('active', on);
    on ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current');
  });
  $('#nav').classList.remove('open');
  const mb = $('#menuButton');
  mb.setAttribute('aria-expanded', 'false'); mb.setAttribute('aria-label', 'Open navigation'); mb.textContent = '☰';
}

// Transition = fade out old page, swap, fade in new page. Never two pages at once, and every
// step waits for the real animation to finish (no guessed timers). The newest click always wins.
async function showRoute(route, animate = true) {
  route = routes.includes(route) ? route : 'home';
  const next = pageEl(route), cur = shownPage;
  if (!next || (route === state.route && cur === next)) return;
  state.route = route;
  const token = ++navToken;
  document.body.classList.add('navigating');
  updateNav(route);
  const motion = animate && !reduceMotion();

  if (cur && cur !== next && motion && !cur.dataset.exiting) {
    cur.dataset.exiting = '1';
    try {
      await cur.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(.985)' }],
        { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished;
    } catch { /* cancelled */ }
    if (token !== navToken) return;
  }
  $$('.page').forEach(p => {
    p.getAnimations().forEach(a => a.cancel());
    delete p.dataset.exiting;
    const on = p === next;
    p.hidden = !on; p.classList.toggle('active', on); p.setAttribute('aria-hidden', String(!on));
  });
  shownPage = next;
  window.scrollTo({ top: 0, behavior: 'instant' });
  $$('.reveal', next).forEach(el => { el.classList.remove('in-view', 'settled'); el.style.transitionDelay = ''; });
  if (route !== 'home') heroVisual.stop();
  await nextFrame();
  if (token !== navToken) return;
  if (motion) {
    next.animate([{ opacity: 0, transform: 'translateY(22px) scale(.985)' }, { opacity: 1, transform: 'none' }],
      { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' }).finished
      .then(() => { if (token === navToken) document.body.classList.remove('navigating'); }).catch(() => {});
  } else document.body.classList.remove('navigating');
  if (route === 'home') heroVisual.start();
  runReveal(next);
}

function syncRouteFromLocation() {
  const route = readHashRoute();
  if (route !== state.route) showRoute(route);
}

/* ---- Home hero: live canvas (network + shield + radar). Replaces the 4K video. ---- */
const heroVisual = (() => {
  const cv = $('#heroCanvas'), ctx = cv.getContext('2d');
  let w = 0, h = 0, cx = 0, cy = 0, u = 1, nodes = [], pulses = [], edges = [], raf = 0, running = false, t0 = 0, introAt = 0;
  const shield = new Path2D('M0-60 45-42V5C45 35 22 52 0 62-22 52-45 35-45 5V-42Z');
  const tick = new Path2D('M-22 4-6 22 26-16');
  const rnd = (a, b) => a + Math.random() * (b - a);
  function size() {
    const r = cv.parentElement.getBoundingClientRect();
    if (!r.width) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = r.width; h = r.height; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mob = w < 760;
    u = mob ? Math.min(w * .3, 125) : Math.min(h * .6, w * .28, 330);
    cx = mob ? w * .5 : w * .72; cy = mob ? 150 : h * .5;
    nodes = Array.from({ length: mob ? 46 : 84 }, () => {
      const a = rnd(0, 6.283), d = Math.sqrt(Math.random());
      return { bx: cx + Math.cos(a) * d * (mob ? w * .56 : u * 1.75), by: cy + Math.sin(a) * d * (mob ? 138 : u * 1.2), p: rnd(0, 6.3), s: rnd(.25, .6), r: Math.random() < .14 };
    });
    pulses = Array.from({ length: mob ? 4 : 8 }, () => ({ e: null, p: Math.random() }));
    const v = $('.hero-visual');
    v.style.setProperty('--sx', cx + 'px'); v.style.setProperty('--sy', cy + 'px'); v.style.setProperty('--u', u + 'px');
    return true;
  }
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const link = u * .78, pos = nodes.map(n => [n.bx + Math.sin(t * n.s + n.p) * 14, n.by + Math.cos(t * n.s * .8 + n.p) * 12]);
    edges = [];
    const buckets = [[], [], []];
    for (let i = 0; i < pos.length; i++) for (let k = i + 1; k < pos.length; k++) {
      const dx = pos[i][0] - pos[k][0], dy = pos[i][1] - pos[k][1], d = Math.hypot(dx, dy);
      if (d < link) { edges.push([i, k]); buckets[Math.min(2, Math.floor((1 - d / link) * 3))].push([i, k]); }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = '#68e8c4';
    [.22, .45, .7].forEach((al, bi) => { ctx.globalAlpha = al; ctx.beginPath(); buckets[bi].forEach(([i, k]) => { ctx.moveTo(pos[i][0], pos[i][1]); ctx.lineTo(pos[k][0], pos[k][1]); }); ctx.stroke(); });
    ctx.fillStyle = '#7beed4';
    nodes.forEach((n, i) => { ctx.globalAlpha = n.r ? 1 : .8; ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], n.r ? 3 : 2, 0, 6.283); ctx.fill();
      if (n.r) { ctx.globalAlpha = .35 + .25 * Math.sin(t * 2 + n.p); ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], 6 + 2 * Math.sin(t * 2 + n.p), 0, 6.283); ctx.stroke(); } });
    // data packets travelling along links
    ctx.fillStyle = '#d8fff5';
    pulses.forEach(q => {
      q.p += .012;
      if (!q.e || q.p >= 1) { q.e = edges[(Math.random() * edges.length) | 0]; q.p = 0; }
      if (!q.e) return;
      const a = pos[q.e[0]], b = pos[q.e[1]];
      ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * q.p, a[1] + (b[1] - a[1]) * q.p, 2.2, 0, 6.283); ctx.fill();
    });
    // radar rings + sweep
    ctx.strokeStyle = '#68e8c4'; ctx.lineWidth = 1;
    ctx.globalAlpha = .1; [.95, 1.3].forEach(m => { ctx.beginPath(); ctx.arc(cx, cy, u * m, 0, 6.283); ctx.stroke(); });
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * .5); ctx.setLineDash([2, 12]); ctx.globalAlpha = .2; ctx.beginPath(); ctx.arc(0, 0, u * 1.45, 0, 6.283); ctx.stroke(); ctx.restore(); ctx.setLineDash([]);
    ctx.lineWidth = 2; ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(cx, cy, u * 1.1, t * .9, t * .9 + 1.1); ctx.stroke();
    ctx.globalAlpha = .22; ctx.beginPath(); ctx.arc(cx, cy, u * 1.1, t * .9 - .5, t * .9); ctx.stroke();
    // signal bars left of the shield
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 10; k++) { const y = cy - u * .45 + k * u * .1, l = u * (.1 + .16 * Math.abs(Math.sin(t * 1.6 + k * .9)));
      ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(cx - u * .62 - l, y); ctx.lineTo(cx - u * .62, y); ctx.stroke(); }
    // shield
    const s = u * .8 / 122, fy = Math.sin(t * 1.1) * 4, intro = Math.min(1, (performance.now() - introAt) / 1400);
    ctx.save(); ctx.translate(cx, cy + fy); ctx.scale(s, s); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(104,232,196,.07)'; ctx.fill(shield);
    ctx.save(); ctx.clip(shield); const sy = -66 + ((t % 3.2) / 3.2) * 136;
    const g = ctx.createLinearGradient(0, sy - 18, 0, sy + 18); g.addColorStop(0, 'rgba(104,232,196,0)'); g.addColorStop(.5, 'rgba(104,232,196,.38)'); g.addColorStop(1, 'rgba(104,232,196,0)');
    ctx.fillStyle = g; ctx.fillRect(-50, sy - 18, 100, 36); ctx.restore();
    ctx.strokeStyle = '#68e8c4'; ctx.lineWidth = 16 / s; ctx.globalAlpha = .08 + .05 * Math.sin(t * 2); ctx.stroke(shield);
    ctx.lineWidth = 6 / s; ctx.globalAlpha = .2; ctx.stroke(shield);
    ctx.lineWidth = 2.8 / s; ctx.globalAlpha = 1; ctx.strokeStyle = '#7ff3d6'; ctx.stroke(shield);
    ctx.lineWidth = 6 / s; ctx.setLineDash([90 * intro, 100]); ctx.strokeStyle = '#8af3d9'; ctx.stroke(tick); ctx.setLineDash([]);
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function frame(now) { if (!running) return; draw((now - t0) / 1000); raf = requestAnimationFrame(frame); }
  new ResizeObserver(() => { if (running && size()) { if (reduceMotion()) draw(2); } }).observe(cv.parentElement);
  return {
    start() {
      if (running || !size()) return;
      if (!introAt) introAt = performance.now();
      if (reduceMotion()) { introAt = 0; draw(2); return; }
      running = true; t0 = performance.now() - 2000; raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); }
  };
})();
document.addEventListener('visibilitychange', () => { if (document.hidden) heroVisual.stop(); else if (state.route === 'home') heroVisual.start(); });

window.addEventListener('hashchange', syncRouteFromLocation);
window.addEventListener('popstate', syncRouteFromLocation);

document.addEventListener('click', event => {
  const routeControl = event.target.closest('[data-route]');
  if (routeControl) {
    event.preventDefault();
    navigate(routeControl.dataset.route);
    return;
  }
  const button = event.target.closest('button');
  if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.35;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  button.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});

$('#menuButton').addEventListener('click', () => {
  const isOpen = $('#nav').classList.toggle('open');
  $('#menuButton').setAttribute('aria-expanded', String(isOpen));
  $('#menuButton').setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  $('#menuButton').textContent = isOpen ? '×' : '☰';
});

$('#themeButton').addEventListener('click', () => {
  document.body.classList.toggle('theme-light');
  const light = document.body.classList.contains('theme-light');
  $('#themeButton').textContent = light ? '☾' : '☼';
  $('#themeButton').setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  $('meta[name="theme-color"]').setAttribute('content', light ? '#f1f5f9' : '#080e1b');
  try { sessionStorage.setItem('nexguard-theme', light ? 'light' : 'dark'); } catch { /* storage is optional */ }
  toast(light ? 'Light theme enabled' : 'Dark theme enabled');
});

try {
  if (sessionStorage.getItem('nexguard-theme') === 'light') {
    document.body.classList.add('theme-light');
    $('#themeButton').textContent = '☾';
    $('#themeButton').setAttribute('aria-label', 'Switch to dark theme');
    $('meta[name="theme-color"]').setAttribute('content', '#f1f5f9');
  }
} catch { /* storage may be unavailable in private browsing */ }

// Scroll reveal: only elements entering the viewport animate; the first group staggers.
let revealObserver;
function runReveal(page) {
  if (revealObserver) revealObserver.disconnect();
  const items = $$('.reveal', page);
  if (reduceMotion()) { items.forEach(el => el.classList.add('in-view')); return; }
  revealObserver = new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).forEach((e, i) => {
      e.target.style.transitionDelay = `${Math.min(i, 5) * 80}ms`;
      const t = e.target;
      t.addEventListener('transitionend', ev => { if (ev.propertyName === 'transform') { t.style.transitionDelay = ''; t.classList.add('settled'); } });
      t.classList.add('in-view'); revealObserver.unobserve(t);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
  items.forEach(el => revealObserver.observe(el));
}

// File selection reads metadata only. It does not read file contents or upload the file.
function validateSelectedFile(file, expectedKind = 'general') {
  if (!file) return false;
  const extension = getExtension(file.name);
  if (file.size > MAX_FILE_BYTES) {
    toast(`This file is larger than the 700 MB prototype limit (${formatSize(file.size)}).`);
    return false;
  }
  if (expectedKind === 'apk' && extension !== 'APK') {
    toast('Please choose a file with an .apk extension.');
    return false;
  }
  if (expectedKind === 'general' && !ALLOWED_EXTENSIONS.has(extension)) {
    toast('This file extension is not in the prototype supported list.');
    return false;
  }
  return true;
}

function handleGeneralFile(file) {
  if (!file) return;
  if (!validateSelectedFile(file, 'general')) {
    state.chosenFile = null;
    $('#fileInput').value = '';
    $('#fileSummary').hidden = true;
    $('#fileExtension').textContent = 'Not selected';
    $('#fileSize').textContent = '—';
    return;
  }
  state.chosenFile = file;
  const extension = getExtension(file.name);
  $('#fileSummary').hidden = false;
  $('#selectedName').textContent = file.name;
  $('#selectedDetails').textContent = `${extension} file · ${formatSize(file.size)}`;
  $('#fileIcon').textContent = extension.slice(0, 5);
  $('#fileExtension').textContent = extension;
  $('#fileSize').textContent = formatSize(file.size);
  $('#fileResult').hidden = true;
  toast('File selected. It has not been uploaded or scanned.');
}

$('#fileInput').addEventListener('change', event => handleGeneralFile(event.target.files[0]));
$('#removeFile').addEventListener('click', () => {
  state.chosenFile = null;
  $('#fileInput').value = '';
  $('#fileSummary').hidden = true;
  $('#fileExtension').textContent = 'Not selected';
  $('#fileSize').textContent = '—';
  $('#fileResult').hidden = true;
  toast('Selected file removed.');
});

const fileDropZone = $('#fileDropZone');
['dragenter', 'dragover'].forEach(name => fileDropZone.addEventListener(name, event => {
  event.preventDefault(); fileDropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(name => fileDropZone.addEventListener(name, event => {
  event.preventDefault(); fileDropZone.classList.remove('dragover');
}));
fileDropZone.addEventListener('drop', event => handleGeneralFile(event.dataTransfer.files[0]));

$('#apkInput').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  if (!validateSelectedFile(file, 'apk')) {
    $('#apkInput').value = '';
    state.chosenApk = null;
    return;
  }
  state.chosenApk = file;
  $('#apkSelectedName').textContent = file.name;
  $('#apkFileName').textContent = file.name;
  $('#apkSize').textContent = formatSize(file.size);
  $('#apkResult').hidden = true;
  toast('APK selected. It has not been uploaded, installed or executed.');
});
const apkDropZone = $('#apkDropZone');
['dragenter', 'dragover'].forEach(name => apkDropZone.addEventListener(name, event => {
  event.preventDefault(); apkDropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(name => apkDropZone.addEventListener(name, event => {
  event.preventDefault(); apkDropZone.classList.remove('dragover');
}));
apkDropZone.addEventListener('drop', event => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!validateSelectedFile(file, 'apk')) { state.chosenApk = null; return; }
  state.chosenApk = file;
  $('#apkInput').value = '';
  $('#apkSelectedName').textContent = file.name;
  $('#apkFileName').textContent = file.name;
  $('#apkSize').textContent = formatSize(file.size);
  $('#apkResult').hidden = true;
  toast('APK selected. It will never be executed by this frontend.');
});

function addHistory(name, type) {
  state.history.unshift({
    name: String(name), type, status: 'Basic checks only',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  renderHistory();
}
function renderHistory() {
  const rows = state.history;
  const bodies = [$('#historyTable'), $('#recentTable')];
  $('#historyCount').textContent = String(rows.length);
  bodies.forEach(body => {
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td');
      td.colSpan = 4; td.className = 'empty-state';
      td.textContent = body.id === 'recentTable' ? 'No activity yet. Start with a file or URL.' : 'No submissions yet. Use a scanner to add a demo entry.';
      tr.appendChild(td); body.appendChild(tr); return;
    }
    rows.slice(0, body.id === 'recentTable' ? 4 : 100).forEach(item => {
      const tr = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = item.name;
      const type = document.createElement('td'); const typePill = document.createElement('span');
      typePill.className = 'type-pill'; typePill.textContent = item.type; type.appendChild(typePill);
      const status = document.createElement('td'); const statusPill = document.createElement('span');
      statusPill.className = 'state-pill'; statusPill.textContent = item.status; status.appendChild(statusPill);
      const time = document.createElement('td'); time.textContent = item.time;
      tr.append(name, type, status, time); body.appendChild(tr);
    });
  });
}

function addDemoProgress(resultEl, reportKind, detail = {}) {
  const run = ++state.runId;
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <div class="panel-heading"><div><p class="eyebrow">WORKFLOW PREVIEW</p><h2>Checking your item</h2></div><span class="step-chip">DEMO</span></div>
    <p class="muted-copy">Quick checks run on your device. Nothing is uploaded.</p>
    <div class="scan-progress"><div class="scan-progress-top"><span id="progressLabel">Checking selected-item metadata…</span><strong id="progressPercent">0%</strong></div><div class="progress-track"><span id="progressBar"></span></div><div class="scan-steps"><span id="scanStep1">01 · Metadata</span><span id="scanStep2">02 · Scanner link</span><span id="scanStep3">03 · Report</span></div></div>
  `;
  const labels = ['Reading file details…', 'Checking type and name…', 'Writing your result…', 'Done.'];
  let progress = 0;
  const timer = setInterval(() => {
    if (run !== state.runId) { clearInterval(timer); return; }
    progress = Math.min(100, progress + 8 + Math.random() * 9);
    const percent = Math.round(progress);
    const bar = $('#progressBar', resultEl); const pct = $('#progressPercent', resultEl); const label = $('#progressLabel', resultEl);
    if (!bar || !pct || !label) { clearInterval(timer); return; }
    bar.style.width = `${percent}%`; pct.textContent = `${percent}%`;
    label.textContent = labels[percent < 32 ? 0 : percent < 62 ? 1 : percent < 96 ? 2 : 3];
    [$('#scanStep1', resultEl), $('#scanStep2', resultEl), $('#scanStep3', resultEl)].forEach((el, i) => {
      if (el) el.classList.toggle('done', percent >= (i + 1) * 30);
    });
    if (percent >= 100) {
      clearInterval(timer);
      setTimeout(() => { if (run === state.runId) renderDemoReport(resultEl, reportKind, detail); }, 230);
    }
  }, 115);
}


/* ---- Real checks that run on the user's device (no upload, nothing is executed) ---- */
const MAGIC = { PDF: [[0x25,0x50,0x44,0x46]], ZIP: [[0x50,0x4B,3,4]], EXE: [[0x4D,0x5A]], PNG: [[0x89,0x50,0x4E,0x47]], JPG: [[0xFF,0xD8,0xFF]], GIF: [[0x47,0x49,0x46,0x38]], RAR: [[0x52,0x61,0x72,0x21]], '7Z': [[0x37,0x7A,0xBC,0xAF]], GZ: [[0x1F,0x8B]], OLE: [[0xD0,0xCF,0x11,0xE0]], ELF: [[0x7F,0x45,0x4C,0x46]] };
const EXPECT = { PDF:'PDF', DOCX:'ZIP', XLSX:'ZIP', PPTX:'ZIP', DOCM:'ZIP', XLSM:'ZIP', PPTM:'ZIP', ZIP:'ZIP', APK:'ZIP', JAR:'ZIP', EXE:'EXE', DLL:'EXE', SCR:'EXE', PNG:'PNG', JPG:'JPG', JPEG:'JPG', GIF:'GIF', RAR:'RAR', '7Z':'7Z', GZ:'GZ', DOC:'OLE', XLS:'OLE', PPT:'OLE', MSI:'OLE' };
const RUNNABLE = new Set(['EXE','MSI','DLL','SCR','BAT','CMD','VBS','PS1','JAR','JS','APK']);
const chk = (level, title, text) => ({ level, title, text });

async function localFileChecks(file) {
  const out = [], ext = getExtension(file.name), name = file.name;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const kind = Object.keys(MAGIC).find(k => MAGIC[k].some(m => m.every((b, i) => head[i] === b)));
    const want = EXPECT[ext];
    if (kind === 'EXE' && want !== 'EXE') out.push(chk('bad', 'Disguised program', `The name says .${ext.toLowerCase()}, but the inside looks like a Windows program. This is a common trick. Do not open it.`));
    else if (kind === 'ELF' && ext !== 'APK') out.push(chk('warn', 'Linux program inside', 'The contents look like a Linux executable, not a normal document.'));
    else if (want && kind && kind !== want && !(want === 'ZIP' && kind === 'ZIP')) out.push(chk('bad', 'File type does not match its name', `The name says .${ext.toLowerCase()}, but the contents look like ${kind}. Treat it as untrusted.`));
    else if (want && kind === want) out.push(chk('ok', 'File type matches its name', `The contents really look like a ${ext} file.`));
    else if (want && !kind) out.push(chk('warn', 'File type could not be confirmed', 'The first bytes did not match the expected format. The file may be damaged or disguised.'));
  } catch { out.push(chk('warn', 'Could not read the file', 'Your browser could not read this file, so the type check was skipped.')); }
  if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|mp3|mp4)\.(exe|scr|bat|cmd|js|vbs|jar|msi|ps1|apk)$/i.test(name)) out.push(chk('bad', 'Double extension', 'The name ends with two extensions (like invoice.pdf.exe). Attackers use this to hide a program as a document.'));
  if (RUNNABLE.has(ext)) out.push(chk('warn', 'This file can run code', 'Programs and scripts can change your device. Open only if you fully trust where it came from.'));
  else if (/^(DOCM|XLSM|PPTM)$/.test(ext)) out.push(chk('warn', 'Contains macros', 'Macro files can run hidden commands. Do not click “Enable content” unless you trust the sender.'));
  else if (/^(ZIP|RAR|7Z|GZ|TAR|ISO)$/.test(ext)) out.push(chk('warn', 'Archive: contents are hidden', 'Archives can hide other files inside. Scan what is inside before opening anything.'));
  else if (!out.some(c => c.level === 'bad')) out.push(chk('ok', 'Not a program or script type', 'This extension is not one that normally runs code by itself.'));
  if (file.size <= 200 * 1000 * 1000 && window.crypto?.subtle) {
    try {
      const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      out.push(chk('info', 'SHA-256 fingerprint', [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')));
    } catch { /* too large for this browser */ }
  } else out.push(chk('info', 'SHA-256 fingerprint', 'Skipped: the file is too large to hash in the browser.'));
  return out;
}

function urlChecks(u, raw) {
  const out = [], h = u.hostname.toLowerCase(), authority = raw.split('//')[1]?.split('/')[0] || '';
  out.push(u.protocol === 'https:' ? chk('ok', 'Encrypted connection (HTTPS)', 'Good sign, but scam sites can use HTTPS too.') : chk('warn', 'Not encrypted (HTTP)', 'Anything you type here can be seen by others. Never enter passwords.'));
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.startsWith('[')) out.push(chk('bad', 'Numbers instead of a name', 'Real websites rarely use a raw IP address. This is often used for scams.'));
  if (authority.includes('@')) out.push(chk('bad', 'Contains “@” before the site name', 'The real destination is hidden after the @. Treat the link as deceptive.'));
  if (h.includes('xn--')) out.push(chk('bad', 'Look-alike characters', 'The name uses special characters that can imitate a trusted brand.'));
  if (/^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at)$/.test(h)) out.push(chk('warn', 'Shortened link', 'You cannot see where it really leads. Expand it before opening.'));
  if (/\.(zip|mov|tk|ml|ga|cf|gq|xyz|top|click|work|rest)$/.test(h)) out.push(chk('warn', 'Risky domain ending', 'This ending is often used by short-lived scam sites.'));
  if (/(login|verify|secure|account|update|wallet|paypal|bank|gift|prize|free)/.test(h)) out.push(chk('warn', 'Alarming words in the site name', 'Words like “login” or “verify” are often used to look official.'));
  if (h.split('.').length > 4) out.push(chk('warn', 'Too many sub-parts', 'Long chains of dots are used to hide the real site name.'));
  if (raw.length > 100) out.push(chk('warn', 'Very long link', 'Long links can hide the real destination.'));
  if (u.port && !['80', '443'].includes(u.port)) out.push(chk('warn', 'Unusual port number', 'Normal websites rarely need a custom port.'));
  if (!out.some(c => c.level === 'bad' || c.level === 'warn')) out.push(chk('ok', 'No warning signs in the link', 'These checks only look at the address, not the live website.'));
  return out;
}

function checksHTML(list) {
  const ico = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
  return `<div class="check-list">${list.map(c => `<div class="check check-${c.level}"><span class="check-icon">${ico[c.level]}</span><div><strong>${escapeHTML(c.title)}</strong><p class="${c.title.startsWith('SHA') ? 'mono' : ''}">${escapeHTML(c.text)}</p></div></div>`).join('')}</div>`;
}

async function renderDemoReport(resultEl, kind, detail = {}) {
  const checks = (await detail.checks) || [];
  const bad = checks.filter(c => c.level === 'bad').length, warn = checks.filter(c => c.level === 'warn').length;
  const verdict = bad ? 'Danger signs found' : warn ? 'Some warning signs found' : 'No warning signs in basic checks';
  const tone = bad ? 'var(--red)' : warn ? 'var(--amber)' : 'var(--accent)';
  const isUrl = kind === 'URL';
  const isApk = kind === 'APK';
  const item = detail.name || 'Selected item';
  const size = detail.size !== undefined ? formatSize(detail.size) : (isUrl ? 'Not applicable' : 'Not recorded');
  resultEl.innerHTML = `
    <div class="panel-heading"><div><p class="eyebrow">REPORT PREVIEW</p><h2>Your result</h2></div><span class="step-chip">BASIC CHECKS</span></div>
    <div class="result-heading"><div class="result-status-icon" style="color:${tone};border-color:${tone}" aria-hidden="true">${bad ? "✕" : warn ? "!" : "✓"}</div><div><h2>${verdict}</h2><p>${escapeHTML(item)} · ${escapeHTML(kind)} · ${escapeHTML(size)}</p></div><span class="result-not-real">FULL MALWARE SCAN: NOT CONNECTED</span></div>
    ${checksHTML(checks)}
    <div class="result-fields">
      <div class="result-field"><span>Scan state</span><strong>Not scanned</strong></div>
      <div class="result-field"><span>Risk level</span><strong>Not determined</strong></div>
      <div class="result-field"><span>Malware family</span><strong>Not available</strong></div>
      <div class="result-field"><span>Detection engine</span><strong>Not connected</strong></div>
      <div class="result-field"><span>Evidence / signature</span><strong>Not available</strong></div>
      <div class="result-field"><span>${isUrl ? 'URL validation' : 'Selected file size'}</span><strong>${isUrl ? 'Format accepted only' : escapeHTML(size)}</strong></div>
    </div>
    <div class="result-explanation">
      <article class="explain-card"><h3>Why is it flagged?</h3><p>No detection finding was generated. The browser only demonstrated the report workflow; it did not scan the item.</p></article>
      <article class="explain-card"><h3>What could be harmful?</h3><p>Unknown until a real engine returns evidence. A malware family or harm must never be guessed from a filename or extension.</p></article>
      <article class="explain-card"><h3>What should I do?</h3><p>Do not open or install an untrusted item. Connect the backend to calculate hashes, run approved checks and return evidence-based advice.</p></article>
    </div>
    <p class="result-disclaimer"><strong>Important:</strong> These are quick checks on your device, not a full antivirus scan. “No detection found” is not the same as “safe.” ${isApk ? 'The APK was not installed, opened or executed.' : ''}</p>
  `;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

$('#scanFileButton').addEventListener('click', () => {
  const file = state.chosenFile;
  if (!file) { toast('Choose a supported file first.'); return; }
  addHistory(file.name, getExtension(file.name));
  addDemoProgress($('#fileResult'), 'FILE', { name: file.name, size: file.size, checks: localFileChecks(file) });
  toast('Demo workflow started. No real file scan is being performed.');
});

$('#checkUrlButton').addEventListener('click', () => {
  const input = $('#urlInput'); const value = input.value.trim();
  if (!value) { toast('Enter a URL first.'); input.focus(); return; }
  let parsed;
  try { parsed = new URL(value); } catch { toast('Enter a complete URL, for example https://example.com'); input.focus(); return; }
  if (!['http:', 'https:'].includes(parsed.protocol)) { toast('Only HTTP and HTTPS URLs are accepted.'); return; }
  addHistory(parsed.hostname, 'URL');
  addDemoProgress($('#urlResult'), 'URL', { name: parsed.hostname, checks: urlChecks(parsed, value) });
  // Do not fetch or visit this URL from the frontend.
  toast('URL format accepted only. Reputation has not been checked.');
});

$('#analyzeApkButton').addEventListener('click', () => {
  const file = state.chosenApk;
  if (!file) { toast('Choose an APK file first.'); return; }
  addHistory(file.name, 'APK');
  addDemoProgress($('#apkResult'), 'APK', { name: file.name, size: file.size, checks: localFileChecks(file) });
  toast('Static-analysis workflow preview started. APK not executed.');
});

$('#clearHistoryButton').addEventListener('click', () => {
  state.history.length = 0;
  renderHistory();
  toast('This-tab demo history cleared.');
});

$('#supportForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  toast('Demo only: your support request was not sent. Connect an official email or support API.');
  event.currentTarget.reset();
});

// When reduced motion is requested, keep poster images and do not autoplay background videos.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');


// Keep the opening animation visible for at least 3 seconds.
// The fallback prevents the loader getting stuck if a resource never finishes.
const preloaderStartedAt = window.__NEXGUARD_PAGE_START__ ?? performance.now();
const minimumPreloaderMs = 1600;

function hidePreloaderAfterMinimum() {
  const elapsed = performance.now() - preloaderStartedAt;
  const remaining = Math.max(0, minimumPreloaderMs - elapsed);
  window.setTimeout(() => $('#preloader')?.classList.add('done'), remaining);
}

window.addEventListener('load', hidePreloaderAfterMinimum, { once: true });
window.setTimeout(() => $('#preloader')?.classList.add('done'), 6500);

renderHistory();
showRoute(readHashRoute(), false).then(() => { if (state.route === 'home') heroVisual.start(); runReveal(shownPage); });

/* ---- Spatial depth: pointer parallax on the hero, tilt + light on glass cards ---- */
(() => {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const hero = $('.home-hero'); let tx = 0, ty = 0, cx = 0, cy = 0, loop = 0, hot = null, last = null, sched = false;
  const tick = () => {
    cx += (tx - cx) * .08; cy += (ty - cy) * .08;
    hero.style.setProperty('--px', cx.toFixed(3)); hero.style.setProperty('--py', cy.toFixed(3));
    loop = (Math.abs(tx - cx) > .002 || Math.abs(ty - cy) > .002) ? requestAnimationFrame(tick) : 0;
  };
  const leave = el => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  const apply = () => {
    sched = false; const e = last; if (!e || reduceMotion()) return;
    if (state.route === 'home') {
      const r = hero.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - .5) * 2)); ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - .5) * 2));
      if (!loop) loop = requestAnimationFrame(tick);
    }
    const el = e.target.closest?.('.tool-card, .panel, .summary-tile, .result-panel');
    if (hot && hot !== el) leave(hot);
    hot = el; if (!el) return;
    const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    if (el.classList.contains('tool-card')) { el.style.setProperty('--rx', ((.5 - y) * 9).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - .5) * 11).toFixed(2) + 'deg'); }
  };
  document.addEventListener('pointermove', e => { last = e; if (!sched) { sched = true; requestAnimationFrame(apply); } }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { if (hot) leave(hot); hot = null; tx = ty = 0; if (!loop) loop = requestAnimationFrame(tick); });
})();
