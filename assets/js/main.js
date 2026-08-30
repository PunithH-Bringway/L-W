/* ============================================================
   L&W Construction — main.js
   Scroll journey engine + page systems, per the scrub-pipeline
   standard (adapted: the camera scrubs a still, not a video).
   ============================================================ */
(function () {
  'use strict';

  var docEl = document.documentElement;
  var reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- utilities ---------- */
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function smoothstep(p, e0, e1) {
    var t = clamp((p - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ============================================================
     Split text: sr-only original + aria-hidden spans with seeded
     jitter custom properties. Runs once at load.
     ============================================================ */
  var ENTRANCE_CLASS = { rise: 'e-rise', scatter: 'e-scatter', grid: 'e-grid', blur: 'e-blur', settle: 'e-settle' };

  function splitBand(band, index) {
    var el = band.querySelector('[data-split]');
    if (!el) return;
    var mode = band.getAttribute('data-entrance') || 'rise';
    var text = el.textContent.trim();
    var r = rng(97 + index * 131);
    el.textContent = '';
    el.classList.add(ENTRANCE_CLASS[mode] || 'e-rise');

    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.appendChild(sr);

    var vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    el.appendChild(vis);

    if (mode === 'blur') {
      var soft = document.createElement('span');
      soft.className = 'soft';
      soft.setAttribute('aria-hidden', 'true');
      soft.textContent = text;
      var sharp = document.createElement('span');
      sharp.className = 'sharp';
      sharp.textContent = text;
      vis.appendChild(sharp);
      el.appendChild(soft);
      return;
    }

    var words = text.split(' ');
    var totalChars = text.replace(/ /g, '').length;
    var ci = 0;
    words.forEach(function (word, wi) {
      var w = document.createElement('span');
      w.className = 'w';
      if (mode === 'rise' || mode === 'settle') {
        w.style.setProperty('--th', (wi / Math.max(1, words.length) * 0.5 + r() * 0.05).toFixed(3));
      }
      for (var i = 0; i < word.length; i++) {
        var c = document.createElement('span');
        c.className = 'c';
        c.textContent = word.charAt(i);
        if (mode === 'scatter') {
          c.style.setProperty('--th', (r() * 0.55).toFixed(3));
          c.style.setProperty('--jx', ((r() - 0.5) * 90).toFixed(1) + 'px');
          c.style.setProperty('--jy', ((r() - 0.5) * 70).toFixed(1) + 'px');
          c.style.setProperty('--jr', ((r() - 0.5) * 24).toFixed(1) + 'deg');
        } else if (mode === 'grid') {
          c.style.setProperty('--th', (ci / Math.max(1, totalChars) * 0.5 + r() * 0.06).toFixed(3));
          c.style.setProperty('--jx', ((r() - 0.5) * 120).toFixed(1) + 'px');
        }
        w.appendChild(c);
        ci++;
      }
      vis.appendChild(w);
      if (wi < words.length - 1) vis.appendChild(document.createTextNode(' '));
    });
  }

  /* ============================================================
     HERO scrub engine
     ============================================================ */
  var hero = document.querySelector('.hero');
  var stage = document.querySelector('.stage');
  var cam = document.querySelector('.cam');
  var cue = document.querySelector('.cue');
  var stepsEls = Array.prototype.slice.call(document.querySelectorAll('.hero-steps span'));
  var bands = Array.prototype.slice.call(document.querySelectorAll('.band')).map(function (el, i) {
    splitBand(el, i);
    return {
      el: el,
      a: parseFloat(el.getAttribute('data-a')),
      b: parseFloat(el.getAttribute('data-b')),
      op: -1, k: -1, ks: -1, kb: -1,
      first: i === 0,
      last: el.classList.contains('band-5')
    };
  });

  var target = 0, shown = 0, rafId = null, lastTick = 0;
  var heroOnScreen = true, scrubOn = false;
  var heroRange = 1;
  var loadK = 0, loadStart = 0;
  var camScale = -1, litSteps = -1, cueHidden = false, navSolid = false;
  var nav = document.getElementById('nav');
  if (nav.hasAttribute('data-solid')) nav.classList.add('solid');

  function measure() {
    if (!hero) return;
    heroRange = Math.max(1, hero.offsetHeight - window.innerHeight);
  }

  function heroProgress() {
    return clamp(window.scrollY / heroRange, 0, 1);
  }

  function updateCaptions(p, now) {
    /* band 1 load ramp: hands over to scroll */
    if (loadStart && loadK < 1) {
      loadK = clamp((now - loadStart) / 1400, 0, 1);
      loadK = loadK * loadK * (3 - 2 * loadK);
    }
    for (var i = 0; i < bands.length; i++) {
      var bd = bands[i];
      var f = Math.min(0.02, (bd.b - bd.a) / 3);
      var op = (bd.first ? 1 : smoothstep(p, bd.a, bd.a + f)) *
               (bd.last ? 1 : (1 - smoothstep(p, bd.b - f, bd.b)));
      if (bd.first) op = 1 - smoothstep(p, bd.b - f, bd.b);
      if (bd.last) op = smoothstep(p, bd.a, bd.a + f);
      var ramp = Math.min(0.025, (bd.b - bd.a) * 0.35);
      var k = clamp((p - bd.a) / ramp, 0, 1);
      if (bd.first) k = Math.max(k, loadK);
      if (Math.abs(op - bd.op) > 0.015 || (op > 0) !== (bd.op > 0)) {
        bd.op = op;
        bd.el.style.opacity = op.toFixed(3);
      }
      var on = op > 0.04;
      if (on !== bd.on) { bd.on = on; bd.el.classList.toggle('on', on); }
      if (Math.abs(k - bd.k) > 0.008 || (k === 1) !== (bd.k === 1) || (k === 0) !== (bd.k === 0)) {
        bd.k = k;
        bd.el.style.setProperty('--k', k.toFixed(3));
        if (bd.last) {
          var ks = clamp((k - 0.55) * 3.2, 0, 1);
          var kb = clamp((k - 0.72) * 4, 0, 1);
          if (Math.abs(ks - bd.ks) > 0.008) { bd.ks = ks; bd.el.style.setProperty('--ks', ks.toFixed(3)); }
          if (Math.abs(kb - bd.kb) > 0.008) { bd.kb = kb; bd.el.style.setProperty('--kb', kb.toFixed(3)); }
        }
      }
    }
    /* camera */
    var s = 1.06 + p * 0.20;
    if (Math.abs(s - camScale) > 0.0008) {
      camScale = s;
      cam.style.transform = 'translate3d(0,' + (p * -3.5).toFixed(2) + '%,0) scale(' + s.toFixed(4) + ')';
    }
    /* progress steps */
    var lit = Math.min(5, Math.floor(p * 5.999));
    if (lit !== litSteps) {
      litSteps = lit;
      for (var j = 0; j < stepsEls.length; j++) stepsEls[j].classList.toggle('lit', j < lit);
    }
    /* cue */
    var hide = p > 0.03;
    if (hide !== cueHidden) {
      cueHidden = hide;
      if (cue) cue.style.opacity = hide ? '0' : '';
    }
    /* nav state */
    var solid = p > 0.9 || window.scrollY > hero.offsetHeight - window.innerHeight * 1.2;
    if (solid !== navSolid) { navSolid = solid; nav.classList.toggle('solid', solid); }
  }

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    var k = 0.16;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));
    var converged = Math.abs(target - shown) < 0.0005 && loadK >= 1;
    if (converged) {
      shown = target;
      rafId = null;
      lastTick = 0;
    } else {
      rafId = requestAnimationFrame(tick);
    }
    updateCaptions(shown, now);
  }

  function kick() {
    if (rafId === null && heroOnScreen && scrubOn) rafId = requestAnimationFrame(tick);
  }
  function onScroll() {
    target = heroProgress();
    kick();
  }

  /* nav solid fallback while scrub is off (phones, reduced motion) */
  function onScrollStatic() {
    if (nav.hasAttribute('data-solid')) return;
    var solid = window.scrollY > window.innerHeight * 0.6;
    if (solid !== navSolid) { navSolid = solid; nav.classList.toggle('solid', solid); }
  }

  var heroIO = new IntersectionObserver(function (entries) {
    heroOnScreen = entries[entries.length - 1].isIntersecting;
    if (heroOnScreen) kick();
  });
  if (hero) heroIO.observe(hero);

  /* ---------- The five static-hero gates (identical to CSS) ---------- */
  var GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  var MQLS = GATES.map(function (q) { return window.matchMedia(q); });

  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    window.removeEventListener('scroll', onScrollStatic);
    window.addEventListener('scroll', onScroll, { passive: true });
    measure();
    bands.forEach(function (bd) { bd.op = -1; bd.k = -1; bd.ks = -1; bd.kb = -1; bd.on = null; });
    camScale = -1; litSteps = -1; cueHidden = false;
    if (!loadStart) loadStart = performance.now();
    target = heroProgress();
    shown = target;
    updateCaptions(shown, performance.now());
    kick();
  }
  function disableScrub() {
    if (!scrubOn) { window.addEventListener('scroll', onScrollStatic, { passive: true }); onScrollStatic(); return; }
    scrubOn = false;
    window.removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; lastTick = 0; }
    window.addEventListener('scroll', onScrollStatic, { passive: true });
    onScrollStatic();
  }
  function applyHeroMode() {
    if (!hero) { window.addEventListener('scroll', onScrollStatic, { passive: true }); onScrollStatic(); return; }
    var gated = MQLS.some(function (m) { return m.matches; });
    if (gated) disableScrub(); else enableScrub();
  }
  MQLS.forEach(function (m) {
    if (m.addEventListener) m.addEventListener('change', applyHeroMode);
    else m.addListener(applyHeroMode);
  });

  window.addEventListener('resize', function () { measure(); if (scrubOn) onScroll(); });

  /* ============================================================
     Reveal system with stagger retirement
     ============================================================ */
  var revealIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add('in');
      revealIO.unobserve(el);
      if (el.classList.contains('stagger')) {
        var n = el.children.length;
        setTimeout(function () { el.classList.add('done'); }, n * 100 + 900);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  Array.prototype.forEach.call(document.querySelectorAll('.reveal,.stagger'), function (el) {
    revealIO.observe(el);
  });

  /* ============================================================
     Counters
     ============================================================ */
  function animateCounter(el) {
    var end = parseInt(el.getAttribute('data-count'), 10);
    var suffix = el.getAttribute('data-suffix') || '';
    var plain = el.hasAttribute('data-plain');
    function final() { el.textContent = (plain ? String(end) : end.toLocaleString('en-IN')) + suffix; }
    if (plain || reducedMQ.matches) { final(); return; }
    var t0 = performance.now(), dur = 1400, lastText = '';
    function step(now) {
      var t = clamp((now - t0) / dur, 0, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      var val = Math.round(end * eased);
      var text = val.toLocaleString('en-IN') + suffix;
      if (text !== lastText) { lastText = text; el.textContent = text; }
      if (t < 1) requestAnimationFrame(step); else final();
    }
    requestAnimationFrame(step);
  }
  var statsBox = document.getElementById('stats');
  var countersRun = false;
  function runCounters() {
    if (countersRun) return;
    countersRun = true;
    Array.prototype.forEach.call(statsBox.querySelectorAll('[data-count]'), animateCounter);
  }
  if (statsBox) {
    var statIO = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { runCounters(); statIO.disconnect(); }
    }, { threshold: 0.3 });
    statIO.observe(statsBox);
  }

  /* ============================================================
     Portfolio tabs
     ============================================================ */
  var tabOngoing = document.getElementById('tab-ongoing');
  var tabCompleted = document.getElementById('tab-completed');
  var panelOngoing = document.getElementById('panel-ongoing');
  var panelCompleted = document.getElementById('panel-completed');
  function setTab(which) {
    var on = which === 'ongoing';
    tabOngoing.classList.toggle('is-on', on);
    tabCompleted.classList.toggle('is-on', !on);
    tabOngoing.setAttribute('aria-selected', on ? 'true' : 'false');
    tabCompleted.setAttribute('aria-selected', !on ? 'true' : 'false');
    panelOngoing.hidden = !on;
    panelCompleted.hidden = on;
    var shownPanel = on ? panelOngoing : panelCompleted;
    Array.prototype.forEach.call(shownPanel.querySelectorAll('.reveal,.stagger'), function (el) {
      el.classList.add('in', 'done');
    });
  }
  if (tabOngoing) {
    tabOngoing.addEventListener('click', function () { setTab('ongoing'); });
    tabCompleted.addEventListener('click', function () { setTab('completed'); });
    [tabOngoing, tabCompleted].forEach(function (t) {
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var other = t === tabOngoing ? tabCompleted : tabOngoing;
        setTab(other === tabOngoing ? 'ongoing' : 'completed');
        other.focus();
      });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('a[data-tab]'), function (a) {
    a.addEventListener('click', function () { setTab(a.getAttribute('data-tab')); });
  });

  /* ============================================================
     Timeline arrows
     ============================================================ */
  var tlScroll = document.getElementById('tl-scroll');
  var tlPrev = document.getElementById('tl-prev');
  var tlNext = document.getElementById('tl-next');
  if (tlScroll) {
    var tlStep = function () { return Math.min(tlScroll.clientWidth * 0.8, 560); };
    tlPrev.addEventListener('click', function () { tlScroll.scrollBy({ left: -tlStep(), behavior: reducedMQ.matches ? 'auto' : 'smooth' }); });
    tlNext.addEventListener('click', function () { tlScroll.scrollBy({ left: tlStep(), behavior: reducedMQ.matches ? 'auto' : 'smooth' }); });
  }

  /* ============================================================
     Nav: dropdowns, burger, mobile menu
     ============================================================ */
  Array.prototype.forEach.call(document.querySelectorAll('.has-drop'), function (li) {
    var btn = li.querySelector('.menu-top');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = li.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      Array.prototype.forEach.call(document.querySelectorAll('.has-drop.open'), function (other) {
        if (other !== li) { other.classList.remove('open'); other.querySelector('.menu-top').setAttribute('aria-expanded', 'false'); }
      });
    });
    li.addEventListener('mouseenter', function () {
      btn.setAttribute('aria-expanded', 'true');
    });
    li.addEventListener('mouseleave', function () {
      li.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.has-drop.open'), function (li) {
      li.classList.remove('open');
      li.querySelector('.menu-top').setAttribute('aria-expanded', 'false');
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.drop a'), function (a) {
    a.addEventListener('click', function () {
      var li = a.closest('.has-drop');
      if (li) { li.classList.remove('open'); li.querySelector('.menu-top').setAttribute('aria-expanded', 'false'); }
      a.blur();
    });
  });

  var burger = document.getElementById('burger');
  var mobileMenu = document.getElementById('mobile-menu');
  function closeMobile() {
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
    mobileMenu.hidden = true;
    document.body.style.overflow = '';
  }
  burger.addEventListener('click', function () {
    var open = burger.getAttribute('aria-expanded') === 'true';
    if (open) { closeMobile(); burger.focus(); return; }
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Close menu');
    mobileMenu.hidden = false;
    document.body.style.overflow = 'hidden';
    var first = mobileMenu.querySelector('summary, a');
    if (first) first.focus();
  });
  var desktopMQ = window.matchMedia('(min-width: 1081px)');
  function onDesktopChange(e) { if (e.matches) closeMobile(); }
  if (desktopMQ.addEventListener) desktopMQ.addEventListener('change', onDesktopChange);
  else desktopMQ.addListener(onDesktopChange);
  Array.prototype.forEach.call(mobileMenu.querySelectorAll('a'), function (a) {
    a.addEventListener('click', closeMobile);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMobile();
      Array.prototype.forEach.call(document.querySelectorAll('.has-drop.open'), function (li) {
        li.classList.remove('open');
        li.querySelector('.menu-top').setAttribute('aria-expanded', 'false');
      });
    }
  });

  /* ============================================================
     The interactive moment: hold to raise the tower
     ============================================================ */
  var holdBtn = document.getElementById('hold-btn');
  var towerEl = document.getElementById('tower');
  var floors = towerEl ? Array.prototype.slice.call(towerEl.querySelectorAll('.floor')).reverse() : []; /* f1 first */
  var commits = Array.prototype.slice.call(document.querySelectorAll('#commit-list li'));
  var holding = false, holdP = 0, holdRaf = null, holdLast = 0, holdDone = false;
  var floorsUp = -1, ringShown = -1;

  function towerComplete() {
    holdDone = true;
    holdBtn.classList.add('done');
    holdBtn.querySelector('.hold-label').textContent = 'Raised. No exceptions.';
    holdBtn.style.setProperty('--hd', 0);
    floors.forEach(function (f) { f.classList.add('up'); });
    towerEl.classList.add('done');
    commits.forEach(function (li, i) {
      setTimeout(function () { li.classList.add('lit'); }, reducedMQ.matches ? 0 : i * 140);
    });
  }

  function holdFrame(now) {
    if (holdDone) { holdRaf = null; holdLast = 0; return; }
    var dt = Math.min(80, now - (holdLast || now));
    holdLast = now;
    holdP = clamp(holdP + (holding ? dt / 2400 : -dt / 900), 0, 1);
    var up = Math.floor(holdP * 5.4);
    if (up !== floorsUp) {
      floorsUp = up;
      floors.forEach(function (f, i) { f.classList.toggle('up', i < up); });
    }
    var hd = Math.round(126 * (1 - holdP));
    if (hd !== ringShown) { ringShown = hd; holdBtn.style.setProperty('--hd', hd); }
    if (holdP >= 1) { towerComplete(); holdRaf = null; holdLast = 0; return; }
    if (holdP <= 0 && !holding) { holdRaf = null; holdLast = 0; return; }
    holdRaf = requestAnimationFrame(holdFrame);
  }
  function holdStart(e) {
    if (holdDone) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'keydown' && e.repeat) return;
    if (e.type === 'keydown' || e.type === 'pointerdown') e.preventDefault();
    holding = true;
    if (holdRaf === null) holdRaf = requestAnimationFrame(holdFrame);
  }
  function holdEnd(e) {
    if (e && e.type === 'keyup' && e.key !== 'Enter' && e.key !== ' ') return;
    holding = false;
  }
  if (holdBtn) {
    if (reducedMQ.matches) { towerComplete(); }
    holdBtn.addEventListener('pointerdown', holdStart);
    window.addEventListener('pointerup', holdEnd);
    holdBtn.addEventListener('pointerleave', holdEnd);
    holdBtn.addEventListener('keydown', holdStart);
    holdBtn.addEventListener('keyup', holdEnd);
    holdBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ============================================================
     Gold motes canvas
     ============================================================ */
  var canvas = document.getElementById('motes');
  var motesOn = false, motesRaf = null, motes = [];
  var ctx = canvas ? canvas.getContext('2d') : null;

  function sizeCanvas() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function initMotes() {
    var r = rng(7);
    motes = [];
    var n = Math.round(Math.min(44, window.innerWidth / 34));
    for (var i = 0; i < n; i++) {
      motes.push({
        x: r() * 100, y: r() * 100,
        vx: (r() - 0.5) * 0.014, vy: -(0.006 + r() * 0.02),
        s: 0.7 + r() * 1.7, a: 0.06 + r() * 0.2, ph: r() * Math.PI * 2
      });
    }
  }
  var moteLast = 0;
  function moteFrame(now) {
    if (!motesOn) { motesRaf = null; return; }
    var dt = Math.min(80, now - (moteLast || now));
    moteLast = now;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y < -2) { m.y = 102; m.x = (m.x + 37) % 100; }
      if (m.x < -2) m.x = 102; if (m.x > 102) m.x = -2;
      var tw = 0.62 + 0.38 * Math.sin(now / 1600 + m.ph);
      ctx.beginPath();
      ctx.arc(m.x / 100 * w, m.y / 100 * h, m.s, 0, 6.2832);
      ctx.fillStyle = 'rgba(201,154,60,' + (m.a * tw).toFixed(3) + ')';
      ctx.fill();
    }
    motesRaf = requestAnimationFrame(moteFrame);
  }
  function startMotes() {
    if (!ctx || reducedMQ.matches || document.hidden) return;
    if (motesOn) return;
    motesOn = true;
    sizeCanvas();
    if (!motes.length) initMotes();
    if (motesRaf === null) motesRaf = requestAnimationFrame(moteFrame);
  }
  function stopMotes() {
    motesOn = false;
    moteLast = 0;
    if (motesRaf !== null) { cancelAnimationFrame(motesRaf); motesRaf = null; }
    if (ctx) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }
  if (canvas) {
    window.addEventListener('resize', function () { if (motesOn) { sizeCanvas(); } });
  }

  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
    if (document.hidden) stopMotes(); else startMotes();
  });

  /* ============================================================
     Reduced motion, honored live in both directions
     ============================================================ */
  function pinToFinalStates() {
    stopMotes();
    Array.prototype.forEach.call(document.querySelectorAll('.reveal,.stagger'), function (el) {
      el.classList.add('in', 'done');
    });
    if (statsBox) runCounters();
    if (holdBtn && !holdDone) towerComplete();
  }
  function onReducedChange(e) {
    if (e.matches) { pinToFinalStates(); applyHeroMode(); }
    else { applyHeroMode(); startMotes(); }
  }
  if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', onReducedChange);
  else reducedMQ.addListener(onReducedChange);

  /* ============================================================
     Enquiry form: honest mailto composer
     ============================================================ */
  var form = document.getElementById('enquiry');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('#f-name').value.trim();
      var org = form.querySelector('#f-org').value.trim();
      var msg = form.querySelector('#f-msg').value.trim();
      var note = document.getElementById('form-note');
      if (!name || !msg) {
        note.textContent = 'Add your name and a line about the project, then press send.';
        (!name ? form.querySelector('#f-name') : form.querySelector('#f-msg')).focus();
        return;
      }
      var subject = 'Project enquiry from ' + name + (org ? ' (' + org + ')' : '');
      var body = msg + '\n\n' + name + (org ? '\n' + org : '');
      window.location.href = 'mailto:headoffice@landwindia.com?subject=' +
        encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      note.textContent = 'Your email app should now be open with the drafted enquiry. Press send there and it reaches headoffice@landwindia.com.';
      note.classList.add('sent');
    });
  }

  /* ============================================================
     Boot
     ============================================================ */
  document.getElementById('year').textContent = String(new Date().getFullYear());

  function boot() {
    document.body.classList.add('ready');
    applyHeroMode();
    startMotes();
    if (reducedMQ.matches) pinToFinalStates();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
