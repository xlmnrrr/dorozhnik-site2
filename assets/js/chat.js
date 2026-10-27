/* ==========================================================================
   Чат-помощник ООО «ДОРОЖНИК»
   Сценарии на кнопках, калькулятор стоимости по площади и поиск по разделу «Вопросы и ответы».
   Работает целиком в браузере: без сервера, без ИИ, введённый текст никуда не отправляется.
   DOM собирается только через createElement / textContent.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  // Базовые цены калькулятора, ₽ за единицу. Основные значения — в content.json
  // (chat.prices и chat.units, правятся в админке).
  var PRICES = { build: 1000, repair: 500, landscaping: 300, concrete: 200 };
  var UNITS = { build: 'кв.м.', repair: 'кв.м.', landscaping: 'кв.м.', concrete: 'куб.м.' };
  var SERVICES = [
    { key: 'build', label: 'Строительство', re: /(строит|постро|нов\S* дорог|проезд|площадк)/ },
    { key: 'repair', label: 'Ремонт', re: /(ремонт|ямочн|фрез|яму|ямы)/ },
    { key: 'landscaping', label: 'Благоустройство', re: /(благоустр|тротуар|парков|двор|плитк|дорожк)/ },
    { key: 'concrete', label: 'Бетон', re: /(бетон)/ }
  ];
  var PRESETS = [100, 500, 1000];
  var AREA_MAX = 1000000;
  var DEFAULTS = {
    greeting: 'Здравствуйте! Я помощник компании «ДОРОЖНИК». Расскажу об услугах, примерно посчитаю стоимость работ и помогу оставить заявку.',
    priceNote: 'Это ориентир по базовым ставкам, а не публичная оферта. Точную стоимость назовём после оценки объекта.',
    phone: '+7 (347) 246-52-26',
    phoneHref: 'tel:+73472465226',
    address: '450112, г. Уфа, ул. Кольцевая, д. 51'
  };
  var MENU = [
    { label: 'Услуги', act: 'services' },
    { label: 'Рассчитать стоимость', act: 'calc', accent: true },
    { label: 'Контакты', act: 'contacts' },
    { label: 'Оставить заявку', act: 'lead' }
  ];
  var BACK = { label: 'В начало', act: 'menu' };

  var fab = doc.getElementById('chatFab');
  var panel = doc.getElementById('chatPanel');
  var log = doc.getElementById('chatLog');
  var quick = doc.getElementById('chatQuick');
  var form = doc.getElementById('chatForm');
  var input = doc.getElementById('chatInput');
  if (!fab || !panel || !log || !quick || !form || !input) return;

  var DZ = window.DZ || null;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var smallMq = window.matchMedia('(max-width: 40em)');
  var content = null;
  var isOpen = false;
  var started = false;
  var queue = Promise.resolve();
  var token = 0;       // «Начать заново» увеличивает — отложенные ответы старого диалога отбрасываются
  var hideTimer = 0;
  var lastCalc = null; // последний расчёт { key, area, total } — подставляется в форму заявки
  var awaitArea = '';  // услуга, для которой ждём площадь в поле ввода
  var areaUid = 0;
  var placeholder = input.getAttribute('placeholder') || '';

  if (DZ) DZ.onContent(function (data) { content = data; });

  /* ------------------------------------------------------------------
     Утилиты
     ------------------------------------------------------------------ */
  function str(v) { return typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function get(obj, path) {
    return path.split('.').reduce(function (acc, key) {
      return acc !== null && acc !== undefined && typeof acc === 'object' ? acc[key] : undefined;
    }, obj);
  }
  function cfg(path, fallback) { return str(get(content, path)).trim() || fallback; }
  function wait(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }

  // Неразрывный пробел перед тире и после коротких слов — без «висячих» предлогов в пузырях
  var RE_SHORT = /(^|[\s(«„"])([а-яёА-ЯЁ]{1,2}) (?=\S)/g;
  function typo(s) {
    return String(s).replace(/ ([—–])/g, '\u00a0$1').replace(RE_SHORT, '$1$2\u00a0').replace(RE_SHORT, '$1$2\u00a0');
  }
  function el(tag, attrs, kids) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = typo(v);
      else node.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === '') return;
      node.appendChild(typeof kid === 'string' ? doc.createTextNode(typo(kid)) : kid);
    });
    return node;
  }
  function p(kids) { return el('p', null, typeof kids === 'string' ? [kids] : kids); }

  var nf = window.Intl && window.Intl.NumberFormat ? new window.Intl.NumberFormat('ru-RU') : null;
  function money(n) { return nf ? nf.format(n) : String(n); }
  function prices() {
    var src = get(content, 'chat.prices');
    var out = {};
    SERVICES.forEach(function (s) {
      var v = src && typeof src === 'object' ? Number(src[s.key]) : NaN;
      out[s.key] = isFinite(v) && v >= 0 ? Math.round(v) : PRICES[s.key];
    });
    return out;
  }
  function unitOf(key) { return cfg('chat.units.' + key, UNITS[key] || 'кв.м.'); }
  function labelOf(key) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].key === key) return SERVICES[i].label;
    return key;
  }
  // «500», «1 500», «1500,5 м2» → число; вне диапазона или не число — NaN
  function parseArea(v) {
    var m = /(\d[\d\s\u00a0]*(?:[.,]\d+)?)/.exec(str(v));
    if (!m) return NaN;
    var n = parseFloat(m[1].replace(/[\s\u00a0]/g, '').replace(',', '.'));
    return n >= 1 && n <= AREA_MAX ? Math.round(n * 10) / 10 : NaN;
  }
  function calcComment(c) {
    return 'Расчёт в чате: ' + labelOf(c.key) + ', ' + money(c.area) + ' ' + unitOf(c.key) + ', от ' + money(c.total) + ' ₽';
  }

  // Синяя ссылка, плавно прокручивающая к секции сайта (обрабатывается ниже, в log click)
  function link(text, target, task, comment) {
    return el('a', {
      'class': 'chat-link', href: '#' + target, 'data-target': target,
      'data-task': task || null, 'data-comment': comment || null, text: text
    });
  }
  function telLink() {
    var href = cfg('contacts.phoneHref', DEFAULTS.phoneHref);
    if (!/^tel:\+?[\d-]+$/.test(href)) href = DEFAULTS.phoneHref;
    return el('a', { 'class': 'chat-link', href: href, text: cfg('contacts.phone', DEFAULTS.phone) });
  }

  /* ------------------------------------------------------------------
     Сообщения
     ------------------------------------------------------------------ */
  function scrollLog() { log.scrollTop = log.scrollHeight; }
  function addMsg(who, kids) {
    var m = el('div', { 'class': 'msg msg-' + who }, kids);
    log.appendChild(m);
    scrollLog();
    return m;
  }
  function userSay(text) { addMsg('user', [p(text)]); }

  // Ответ бота: «печатает…», затем сообщение и (опционально) быстрые ответы
  function reply(build, quickItems, pause) {
    var my = token;
    queue = queue.then(function () {
      if (my !== token) return null;
      var typing = el('div', { 'class': 'msg msg-bot typing', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]);
      log.appendChild(typing);
      scrollLog();
      return wait(reduceMotion ? 120 : (pause || 650)).then(function () {
        typing.remove();
        if (my !== token) return;
        var kids;
        try {
          kids = build();
        } catch (err) {
          // ответ не собрался (например, неожиданные данные) — диалог не должен «зависнуть»
          kids = [p(['Не получилось ответить. Позвоните нам: ', telLink(), '.'])];
          quickItems = MENU;
        }
        addMsg('bot', kids);
        if (quickItems) setQuick(quickItems);
      });
    });
    return queue;
  }

  function setQuick(items) {
    quick.textContent = '';
    (items || []).forEach(function (it, i) {
      var b = el('button', {
        type: 'button',
        'class': 'qr' + (it.accent ? ' qr-accent' : ''),
        style: 'animation-delay:' + (i * 0.05).toFixed(2) + 's',
        text: it.label
      });
      b.addEventListener('click', function () { act(it.act, it.label); });
      quick.appendChild(b);
    });
  }

  function act(name, echo) {
    if (echo) userSay(echo);
    setQuick([]);
    if (name !== 'area') waitArea('');
    (ACTIONS[name] || ACTIONS.menu)();
  }

  /* ------------------------------------------------------------------
     Сценарии
     ------------------------------------------------------------------ */
  // «Новые автомобильные дороги, проезды и площадки: земляные…» → «новые автомобильные дороги, проезды и площадки»
  function shortText(t) {
    var s = str(t).split(/[:.]/)[0].trim();
    if (s.length > 70) {
      var cut = s.lastIndexOf(',', 70);
      s = (cut > 20 ? s.slice(0, cut) : s.slice(0, 70)).trim();
    }
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
  }

  var ACTIONS = {
    greet: function () {
      reply(function () {
        return [p(cfg('chat.greeting', DEFAULTS.greeting)), p('С чего начнём?')];
      }, MENU, 450);
    },

    menu: function () {
      reply(function () { return [p('Что подсказать ещё?')]; }, MENU, 400);
    },

    services: function () {
      reply(function () {
        var items = list(get(content, 'services.items'));
        var lis = items.length
          ? items.map(function (it) {
            var tail = shortText(it.text);
            return el('li', null, [el('strong', { text: str(it.title) }), tail ? ' — ' + tail : '']);
          })
          : SERVICES.map(function (s) { return el('li', { text: s.label }); });
        return [
          p('Выполняем полный цикл дорожных работ:'),
          el('ul', null, lis),
          p(['Подробнее — в разделе ', link('«Услуги»', 'services'), '. А стоимость могу прикинуть прямо здесь.'])
        ];
      }, [{ label: 'Рассчитать стоимость', act: 'calc', accent: true }, { label: 'Оставить заявку', act: 'lead' }, BACK]);
    },

    calc: function () {
      reply(function () {
        return [p('Выберите услугу — посчитаю ориентировочную стоимость по площади:'), buildPicker()];
      }, [BACK]);
    },

    // повторный ввод площади для последней выбранной услуги
    area: function () {
      var key = (lastCalc && lastCalc.key) || awaitArea;
      if (!key) { ACTIONS.calc(); return; }
      askArea(key);
    },

    contacts: function () {
      reply(function () {
        var lis = [el('li', null, ['Телефон: ', telLink()])];
        var email = cfg('contacts.email', '');
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          lis.push(el('li', null, ['Email: ', el('a', { 'class': 'chat-link', href: 'mailto:' + email, text: email })]));
        }
        var locs = list(get(content, 'map.locations')).filter(function (l) { return l && str(l.address); });
        if (locs.length) {
          locs.forEach(function (l) { lis.push(el('li', { text: (str(l.label) || str(l.title)) + ': ' + str(l.address) })); });
        } else {
          lis.push(el('li', { text: 'Адрес: ' + cfg('contacts.address', DEFAULTS.address) }));
        }
        return [
          p('Наши контакты:'),
          el('ul', null, lis),
          p([link('Показать на карте', 'map'), ' · ', link('Все контакты', 'contacts')])
        ];
      }, [{ label: 'Оставить заявку', act: 'lead', accent: true }, { label: 'Рассчитать стоимость', act: 'calc' }, BACK]);
    },

    lead: function () {
      reply(function () {
        var task = lastCalc ? lastCalc.key : '';
        var note = lastCalc ? calcComment(lastCalc) : '';
        return [
          p(lastCalc
            ? 'Оставьте имя и телефон в форме заявки — ваш расчёт уже будет в комментарии. Перезвоним в рабочее время.'
            : 'Оставьте имя и телефон в форме заявки — перезвоним в рабочее время и уточним задачу.'),
          p([link('Перейти к форме заявки', 'request', task, note)]),
          p(['Срочно? Позвоните: ', telLink(), '.'])
        ];
      }, [{ label: 'Рассчитать стоимость', act: 'calc' }, BACK]);
    },

    hello: function () {
      reply(function () { return [p('Здравствуйте! Чем помочь?')]; }, MENU, 400);
    },

    thanks: function () {
      reply(function () { return [p('Пожалуйста! Если появятся вопросы — пишите.')]; }, MENU, 400);
    },

    unknown: function () {
      reply(function () {
        return [
          p(['Не уверен, что правильно понял вопрос. Точно ответит специалист — позвоните ', telLink(), ' или оставьте заявку.']),
          p('Или выберите тему:')
        ];
      }, MENU);
    }
  };

  /* ------------------------------------------------------------------
     Калькулятор: услуга → площадь → цена за единицу × площадь
     ------------------------------------------------------------------ */
  function freezeCalcs() {
    Array.prototype.forEach.call(log.querySelectorAll('.calc button, .calc input'), function (b) { b.disabled = true; });
  }
  function waitArea(key) {
    awaitArea = key;
    input.setAttribute('placeholder', key ? 'Площадь, ' + unitOf(key) + ' — например, 500' : placeholder);
    input.setAttribute('inputmode', key ? 'decimal' : 'text');
  }

  // Шаг 1: выбор услуги
  function buildPicker() {
    freezeCalcs(); // старые карточки расчёта в истории — только для чтения
    var pr = prices();
    var box = el('div', { 'class': 'calc', role: 'group', 'aria-label': 'Услуга для расчёта' });
    SERVICES.forEach(function (s) {
      var b = el('button', { type: 'button', 'class': 'calc-opt', 'data-key': s.key }, [
        el('span', { 'class': 'calc-label', text: s.label }),
        el('small', { text: 'от ' + money(pr[s.key]) + ' ₽ за ' + unitOf(s.key) })
      ]);
      b.addEventListener('click', function () {
        freezeCalcs();
        b.setAttribute('aria-pressed', 'true');
        userSay(s.label);
        setQuick([]);
        askArea(s.key);
      });
      box.appendChild(b);
    });
    return box;
  }

  // Шаг 2: площадь — поле в карточке, быстрые варианты или обычное поле чата
  function askArea(key) {
    waitArea(key);
    reply(function () {
      return [p('Какой объём работ? Укажите в ' + unitOf(key) + ' — можно ввести и в поле внизу.'), buildArea(key)];
    }, [{ label: 'Другая услуга', act: 'calc' }, BACK]);
  }
  function buildArea(key) {
    freezeCalcs();
    var id = 'calcArea' + (++areaUid);
    var field = el('input', {
      'class': 'calc-input', id: id, type: 'number', inputmode: 'decimal', min: '1', max: String(AREA_MAX),
      step: 'any', placeholder: 'Например, 500', 'aria-describedby': id + '-hint'
    });
    var hint = el('p', { 'class': 'calc-hint', id: id + '-hint', 'aria-live': 'polite', text: 'Единица: ' + unitOf(key) });
    var go = el('button', { type: 'button', 'class': 'btn btn-primary calc-go', text: 'Рассчитать' });
    var presets = el('div', { 'class': 'calc-presets' }, PRESETS.map(function (n) {
      var b = el('button', { type: 'button', 'class': 'calc-chip', 'aria-label': money(n) + ' ' + unitOf(key), text: money(n) });
      b.addEventListener('click', function () { field.value = String(n); submit(); });
      return b;
    }));
    function submit() {
      var area = parseArea(field.value);
      if (isNaN(area)) {
        hint.textContent = typo('Введите число от 1 до ' + money(AREA_MAX) + ' ' + unitOf(key) + '.');
        hint.classList.add('is-err');
        field.focus();
        return;
      }
      showResult(key, area, true);
    }
    go.addEventListener('click', submit);
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    return el('div', { 'class': 'calc', role: 'group', 'aria-label': 'Объём работ: ' + labelOf(key) }, [
      el('label', { 'class': 'calc-field', 'for': id }, [
        el('span', { 'class': 'sr', text: 'Объём, ' + unitOf(key) }),
        field,
        el('span', { 'class': 'calc-unit', 'aria-hidden': 'true', text: unitOf(key) })
      ]),
      hint, presets, go
    ]);
  }

  // Шаг 3: итог и переход к заявке с подставленным расчётом
  function showResult(key, area, echo) {
    freezeCalcs();
    waitArea('');
    var price = prices()[key];
    var total = Math.round(price * area);
    lastCalc = { key: key, area: area, total: total };
    var note = calcComment(lastCalc);
    if (echo) userSay(money(area) + ' ' + unitOf(key));
    setQuick([]);
    reply(function () {
      return [
        p(['Примерная стоимость для ' + money(area) + ' ' + unitOf(key) + ': ', el('strong', { text: 'от ' + money(total) + ' ₽' })]),
        p(labelOf(key) + ': базовая ставка от ' + money(price) + ' ₽ за ' + unitOf(key).replace(/\.?$/, '.')),
        p(cfg('chat.priceNote', DEFAULTS.priceNote)),
        p([link('Оставить заявку с этим расчётом', 'request', key, note)])
      ];
    }, [{ label: 'Оставить заявку', act: 'lead', accent: true }, { label: 'Другая площадь', act: 'area' }, { label: 'Другая услуга', act: 'calc' }, BACK]);
  }

  /* ------------------------------------------------------------------
     Свободный текст: калькулятор → FAQ из content.json → темы → «не понял»
     ------------------------------------------------------------------ */
  var STOP = ' как что чем для при так там тут есть ваш ваша ваше ваши наш наша вас нас мне меня это эти или где когда какие какой какая каких можно нужно надо будет быть если уже еще только просто пожалуйста подскажите скажите хочу хотим вопрос ';
  var KEEP = { 'фз': 1, 'сро': 1 };
  // термины, по которым можно отвечать, даже если они встретились только в тексте ответа
  var STRONG = { 'фз': 1, 'сро': 1, '44': 1, '223': 1, 'лице': 1, 'допу': 1, 'гара': 1, 'бето': 1, 'срок': 1 };
  // \b в JS не работает с кириллицей — границы слова задаём через (?=\s|$)
  var PRE = [
    { re: /(цен[аыуео]?(?=\s|$)|стоим|сколько (стоит|будет|обойд)|расч[её]т|смет|калькул|прайс|руб|тариф|бюджет|дорого|дешев)/, act: 'calc' },
    { re: /^(привет\S*|здравств\S*|добр(ый|ое|ого)|hello|hi)(?=\s|$)/, act: 'hello' },
    { re: /(спасиб|благодар)/, act: 'thanks' }
  ];
  var POST = [
    { re: /(телефон|позвон|звон|адрес|где вы|где наход|контакт|почт|email|e mail|офис|баз[аеуы](?=\s|$)|карт[аеуы](?=\s|$)|проезд|добрать|маршрут)/, act: 'contacts' },
    { re: /(заявк|заказ|оставить|связат|перезвон|менеджер|оформ)/, act: 'lead' },
    { re: /(услуг|чем занима|что дела|что уме|виды работ)/, act: 'services' }
  ];

  function norm(s) {
    return str(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
  function stem(w) { return /^\d+$/.test(w) || w.length <= 4 ? w : w.slice(0, 4); }
  function stems(s) {
    var out = {};
    norm(s).split(' ').forEach(function (w) {
      if (!w || STOP.indexOf(' ' + w + ' ') !== -1) return;
      if (/^\d{2,}$/.test(w) || KEEP[w] || w.length >= 4) out[stem(w)] = 1;
    });
    return out;
  }
  // Лучший вопрос из FAQ: совпадение в формулировке вопроса весит 2, в ответе — 1
  function findFaq(text) {
    var q = Object.keys(stems(text));
    if (!q.length) return null;
    var best = null;
    var bestScore = 0;
    list(get(content, 'faq.items')).forEach(function (it) {
      var sq = stems(it.q);
      var sa = stems(it.a);
      var inQ = 0;
      var strong = 0;
      var score = 0;
      q.forEach(function (w) {
        if (sq[w]) { inQ++; score += 2; } else if (sa[w]) score += 1;
        if ((sq[w] || sa[w]) && STRONG[w]) strong++;
      });
      if ((inQ || strong) && score > bestScore) { bestScore = score; best = it; }
    });
    return best;
  }
  function matchIntent(rules, n) {
    for (var i = 0; i < rules.length; i++) if (rules[i].re.test(n)) return rules[i].act;
    return '';
  }

  function serviceIn(n) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].re.test(n)) return SERVICES[i].key;
    return '';
  }
  function answer(text) {
    var n = norm(text);
    // ждём площадь: «500», «1 500 м2», «около 300 квадратов»
    if (awaitArea && !isNaN(parseArea(text))) { showResult(awaitArea, parseArea(text), false); return; }
    // после расчёта просто число — пересчитать для той же услуги
    if (lastCalc && /^[\d\s.,]+(м2|м 2|м3|м 3|кв м|куб м|кв|м)?$/.test(n) && !isNaN(parseArea(text))) { showResult(lastCalc.key, parseArea(text), false); return; }
    var pre = matchIntent(PRE, n);
    if (pre === 'calc') {
      // «сколько стоит ремонт 300 м2» — сразу считаем; без площади — спрашиваем её
      var key = serviceIn(n);
      var area = /(м2|м 2|кв|квадрат|метр|м3|куб|площад|\d м(?=\s|$))/.test(n) ? parseArea(text) : NaN;
      if (key && !isNaN(area)) { showResult(key, area, false); return; }
      if (key) { askArea(key); return; }
    }
    if (pre) { ACTIONS[pre](); return; }
    var faq = findFaq(text);
    if (faq) {
      reply(function () {
        return [p(str(faq.a)), p(['Другие вопросы — в разделе ', link('«Вопросы и ответы»', 'faq'), '.'])];
      }, [{ label: 'Оставить заявку', act: 'lead', accent: true }, { label: 'Рассчитать стоимость', act: 'calc' }, BACK]);
      return;
    }
    ACTIONS[matchIntent(POST, n) || 'unknown']();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) { input.focus(); return; }
    input.value = '';
    userSay(text);
    setQuick([]);
    answer(text);
  });

  // Ссылки на секции сайта: подставить услугу в форму, на телефоне свернуть чат, плавно прокрутить
  log.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a.chat-link[data-target]') : null;
    if (!a) return;
    e.preventDefault();
    var target = a.getAttribute('data-target');
    var task = a.getAttribute('data-task');
    var comment = a.getAttribute('data-comment');
    if (task && DZ) DZ.prefillTask(task);
    if (comment && DZ && DZ.prefillComment) DZ.prefillComment(comment);
    if (smallMq.matches) close(false);
    if (DZ) DZ.scrollToId(target);
    else {
      var node = doc.getElementById(target);
      if (node) node.scrollIntoView();
    }
  });

  /* ------------------------------------------------------------------
     Открытие и закрытие окна
     ------------------------------------------------------------------ */
  function syncLock() {
    root.classList.toggle('chat-locked', isOpen && smallMq.matches);
    root.classList.toggle('chat-open', isOpen); // прячет мобильную панель «Позвонить / Заявка»
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    window.clearTimeout(hideTimer);
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('seen');
    void panel.offsetWidth; // запуск CSS-перехода из начального состояния
    panel.classList.add('is-open');
    syncLock();
    if (!started) { started = true; act('greet'); }
    // на телефоне фокус на переписку (без всплывающей клавиатуры), на компьютере — в поле ввода
    var target = smallMq.matches ? log : input;
    window.setTimeout(function () {
      try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
    }, reduceMotion ? 0 : 80);
  }
  function close(returnFocus) {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    syncLock();
    hideTimer = window.setTimeout(function () { panel.hidden = true; }, reduceMotion ? 0 : 450);
    if (returnFocus !== false) {
      try { fab.focus({ preventScroll: true }); } catch (err) { fab.focus(); }
    }
  }
  function restart() {
    token++;
    queue = Promise.resolve();
    log.textContent = '';
    setQuick([]);
    lastCalc = null;
    waitArea('');
    act('greet');
    input.focus();
  }

  fab.addEventListener('click', function () { if (isOpen) close(); else open(); });
  doc.getElementById('chatClose').addEventListener('click', function () { close(); });
  doc.getElementById('chatRestart').addEventListener('click', restart);
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  if (smallMq.addEventListener) smallMq.addEventListener('change', syncLock);
  else if (smallMq.addListener) smallMq.addListener(syncLock);
})();
