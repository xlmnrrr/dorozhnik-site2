/* ==========================================================================
   Эффекты сайта ДОРОЖНИК: прогресс прокрутки, параллакс, магнитные кнопки,
   подсветка карточек, наклон фото и отложенная загрузка 3D-сцены.
   При prefers-reduced-motion движение выключено; на сенсорных экранах
   остаются только лёгкие эффекты.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var fine = mq('(hover: hover) and (pointer: fine)');
  var motion = fine && !reduce;

  /* ------------------------------------------------------------------
     Прокрутка: полоса прогресса, параллакс текста и фото (один кадр — одно чтение)
     ------------------------------------------------------------------ */
  var bar = doc.getElementById('progressBar');
  var heroCopy = doc.getElementById('heroCopy');
  var hero = heroCopy ? heroCopy.closest('.hero') : null;
  var layers = []; // { img, box, on }
  var ticking = false;

  function frame() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight;
    var max = Math.max(1, root.scrollHeight - vh);
    var heroH = hero ? hero.offsetHeight : 0;
    var rects = motion ? layers.filter(function (l) { return l.on; }).map(function (l) { return [l, l.box.getBoundingClientRect()]; }) : [];

    if (bar) bar.style.transform = 'translateX(' + (Math.min(1, y / max) * 100 - 100).toFixed(2) + '%)';
    if (!motion) return;
    if (heroCopy && y <= heroH) heroCopy.style.translate = '0 ' + (y * 0.12).toFixed(1) + 'px';
    rects.forEach(function (pair) {
      var r = pair[1];
      var k = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      k = Math.max(-1, Math.min(1, k));
      pair[0].img.style.transform = 'translate3d(0,' + (k * r.height * 0.055).toFixed(1) + 'px,0) scale(1.13)';
    });
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(frame);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  // Фото в карточках строятся из content.json — подключаем параллакс после отрисовки
  function initParallax() {
    if (!motion || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        layers.forEach(function (l) { if (l.box === en.target) l.on = en.isIntersecting; });
      });
      onScroll();
    }, { rootMargin: '10% 0px' });
    Array.prototype.forEach.call(doc.querySelectorAll('.card-media img, .adv-plant figure img'), function (img) {
      var box = img.parentElement;
      img.style.willChange = 'transform';
      img.style.transform = 'scale(1.13)';
      layers.push({ img: img, box: box, on: false });
      io.observe(box);
    });
  }
  if (window.DZ) window.DZ.onContent(initParallax);

  /* ------------------------------------------------------------------
     Магнитные кнопки и подсветка карточек за курсором
     ------------------------------------------------------------------ */
  if (fine) {
    var magnet = null;
    var magnetRect = null;
    var spot = null;
    var px = 0;
    var py = 0;
    var spotFrame = 0;

    var releaseMagnet = function () {
      if (magnet) magnet.style.translate = '';
      magnet = null;
      magnetRect = null;
    };
    var paintSpot = function () {
      spotFrame = 0;
      if (!spot) return;
      var r = spot.getBoundingClientRect();
      spot.style.setProperty('--sx', Math.round(px - r.left) + 'px');
      spot.style.setProperty('--sy', Math.round(py - r.top) + 'px');
    };

    doc.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      px = e.clientX;
      py = e.clientY;

      if (motion) {
        var m = t.closest('.magnetic');
        if (m !== magnet) {
          releaseMagnet();
          if (m && !m.disabled) { magnet = m; magnetRect = m.getBoundingClientRect(); }
        }
        if (magnet && magnetRect) {
          var dx = (px - (magnetRect.left + magnetRect.width / 2)) / (magnetRect.width / 2);
          var dy = (py - (magnetRect.top + magnetRect.height / 2)) / (magnetRect.height / 2);
          magnet.style.translate = (dx * 7).toFixed(1) + 'px ' + (dy * 6).toFixed(1) + 'px';
        }
      }

      spot = t.closest('.spot');
      if (spot && !spotFrame) spotFrame = window.requestAnimationFrame(paintSpot);
    }, { passive: true });
    doc.addEventListener('pointerout', function (e) { if (!e.relatedTarget) releaseMagnet(); });
    window.addEventListener('scroll', releaseMagnet, { passive: true });
  }

  /* ------------------------------------------------------------------
     Наклон фото на главном экране с бликом
     ------------------------------------------------------------------ */
  var tiltBox = doc.getElementById('heroVisual');
  var tilt = doc.getElementById('heroTilt');
  if (motion && tiltBox && tilt) {
    var tf = 0;
    var tx = 0.5;
    var ty = 0.5;
    var paintTilt = function () {
      tf = 0;
      tilt.style.transform = 'rotateX(' + ((0.5 - ty) * 9).toFixed(2) + 'deg) rotateY(' + ((tx - 0.5) * 11).toFixed(2) + 'deg)';
      tilt.style.setProperty('--gx', (tx * 100).toFixed(1) + '%');
      tilt.style.setProperty('--gy', (ty * 100).toFixed(1) + '%');
    };
    tiltBox.addEventListener('pointerenter', function () { tilt.style.transition = 'transform .18s ease-out'; });
    tiltBox.addEventListener('pointermove', function (e) {
      var r = tiltBox.getBoundingClientRect();
      tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      if (!tf) tf = window.requestAnimationFrame(paintTilt);
    });
    tiltBox.addEventListener('pointerleave', function () {
      window.cancelAnimationFrame(tf);
      tf = 0;
      tilt.style.transition = '';
      tilt.style.transform = '';
    });
  }

  /* ------------------------------------------------------------------
     3D: грузится после полной загрузки страницы, когда браузер свободен.
     Класс fx3d выставляет ранний скрипт в <head> по мощности устройства.
     ------------------------------------------------------------------ */
  function remember3dOff() {
    try { window.sessionStorage.setItem('dz_fx3d', 'off'); } catch (err) { /* хранилище недоступно */ }
  }
  function start3d() {
    var host = doc.getElementById('heroCanvas');
    if (!root.classList.contains('fx3d') || !host) return;
    // WebGL без программной эмуляции? Проверяем до загрузки библиотеки (~120 КБ)
    var ok = false;
    try {
      var probe = doc.createElement('canvas');
      var attrs = { failIfMajorPerformanceCaveat: true };
      var gl = probe.getContext('webgl2', attrs) || probe.getContext('webgl', attrs);
      ok = !!gl;
      var lose = gl && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (err) { ok = false; }
    if (!ok) { remember3dOff(); return; }

    window.DZFX = {
      hero: {
        host: host,
        hero: host.closest('.hero'),
        stage: doc.getElementById('heroStage'),
        lite: root.classList.contains('fx-lite'),
        onReady: function () { root.classList.add('fx-ready'); },
        onFail: function (reason) {
          remember3dOff();
          // «slow» — последний кадр остаётся на холсте как статичная картинка; иначе — постер
          if (reason !== 'slow') root.classList.remove('fx-ready');
        }
      }
    };
    var s = doc.createElement('script');
    s.type = 'module';
    s.src = 'assets/js/hero3d.js';
    doc.head.appendChild(s);
  }
  function schedule3d() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(start3d, { timeout: 2500 });
    else window.setTimeout(start3d, 600);
  }
  if (root.classList.contains('fx3d')) {
    if (doc.readyState === 'complete') schedule3d();
    else window.addEventListener('load', schedule3d, { once: true });
  }
})();
