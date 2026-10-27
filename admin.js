/* Админка ДОРОЖНИК: правка content.json и фото через GitHub API.
   Без библиотек. Весь пользовательский текст попадает в DOM только через textContent / value. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Настройки
     ------------------------------------------------------------------ */
  // Клиентский пароль — только защита от случайного входа: он виден в исходном коде.
  // Реальная защита записи — токен GitHub.
  var ADMIN_PASSWORD = 'admin123';
  var SESSION_KEY = 'dz_admin_ok';
  var STORE = { owner: 'GITHUB_OWNER', repo: 'GITHUB_REPO', token: 'GITHUB_TOKEN', branch: 'GITHUB_BRANCH' };
  var CONTENT_PATH = 'content.json';
  var IMAGE_DIR = 'assets/images/';
  var MAX_IMAGE_W = 1600;
  var WEBP_QUALITY = 0.82;

  var LABELS = {
    hero: 'Главный экран', services: 'Услуги', advantages: 'Преимущества', stats: 'Цифры',
    request: 'Заявка (текст рядом с формой)', faq: 'Вопросы и ответы', contacts: 'Контакты', footer: 'Подвал сайта',
    eyebrow: 'Надзаголовок', title: 'Заголовок', lead: 'Вводный текст', text: 'Текст',
    titleBefore: 'Заголовок: начало фразы', titleAccent: 'Заголовок: акцент (жёлтым)',
    ctaPrimary: 'Текст главной кнопки', proof: 'Тезисы под кнопками', badge: 'Бейдж на фото',
    num: 'Число', label: 'Подпись', image: 'Фото', alt: 'Описание фото (alt)', credit: 'Автор / источник фото',
    items: 'Элементы', layout: 'Вид карточки', task: 'Задача в форме', icon: 'Иконка', tags: 'Теги',
    linkText: 'Текст ссылки', cta: 'Блок «Есть тендер?»', button: 'Текст кнопки', note: 'Блок с примечанием',
    mode: 'Режим числа', prefix: 'Приставка', value: 'Значение', suffix: 'Окончание',
    steps: 'Шаги', q: 'Вопрос', a: 'Ответ',
    phone: 'Телефон', phoneHref: 'Ссылка для звонка', email: 'Email', address: 'Адрес', director: 'Директор',
    org: 'Организация', inn: 'ИНН', ogrn: 'ОГРН', photoCredit: 'Строка об источнике фото',
    map: 'Карта «Как нас найти»', locations: 'Локации (вкладки карты)', details: 'Пояснение', coords: 'Координаты',
    chat: 'Чат-помощник', greeting: 'Приветствие', prices: 'Базовые цены калькулятора, ₽ за единицу', priceNote: 'Пояснение под расчётом',
    units: 'Единицы измерения в калькуляторе',
    build: 'Строительство', repair: 'Ремонт', landscaping: 'Благоустройство', concrete: 'Бетон',
    portfolio: 'Наши объекты (до / после)', hint: 'Подсказка на слайдере', before: 'Фото «до»', after: 'Фото «после»',
    fleet: 'Парк техники', kind: 'Силуэт техники', specs: 'Характеристики',
    licenses: 'Лицензии и СРО', link: 'Ссылка (необязательно)'
  };
  var HELP = {
    phoneHref: 'Формат: tel:+73472465226 (без пробелов и скобок).',
    coords: 'Необязательно. Формат «широта, долгота», например 54.735152, 55.958736 (в Яндекс Картах: правый клик по точке → «Что здесь?»). Пусто — точку найдёт поиск по адресу.',
    build: 'Целое число, рублей за единицу (кв.м., для бетона — куб.м.). Чат умножает ставку на площадь: «Примерная стоимость для 500 кв.м.: от 500 000 ₽».',
    units: 'Как подписывать объём в чате, например «кв.м.» или «куб.м.».',
    kind: 'truck — самосвал, roller — каток, paver — асфальтоукладчик. Если добавить фото, оно заменит силуэт.',
    link: 'Полный адрес, начинается с https://. Пусто — карточка без ссылки.',
    before: 'Фото «до» и «после» лучше снимать с одной точки и в одном кадре — так слайдер показывает разницу нагляднее.',
    value: 'Для режима «лет опыта» укажите год основания (например, 1999).',
    mode: 'static — как написано; count — анимированный счётчик; since — сколько лет прошло с указанного года.',
    layout: 'big — крупная карточка с фото, wide — широкая, normal — обычная, dark — тёмная.',
    task: 'Какую задачу подставить в форму при клике на ссылку карточки.',
    photoCredit: 'Текст «Фотографии: Unsplash» — требование лицензии Unsplash; не удаляйте, пока используете эти фото.'
  };
  // Подсказки для конкретного места в content.json (номера элементов опущены); важнее HELP по имени поля
  var HELP_PATH = {
    'chat.units.build': 'Подпись единицы в чате, например «кв.м.».',
    'chat.units.repair': '', 'chat.units.landscaping': '',
    'chat.units.concrete': 'Для бетона обычно «куб.м.».',
    'fleet.items.specs.value': 'Например: «до 25 т», «6×4».',
    'fleet.items.specs.label': ''
  };
  var ENUMS = {
    layout: [['big', 'Крупная (big)'], ['wide', 'Широкая (wide)'], ['normal', 'Обычная (normal)'], ['dark', 'Тёмная (dark)']],
    task: [['build', 'Строительство дороги'], ['repair', 'Ремонт дороги'], ['landscaping', 'Благоустройство'], ['concrete', 'Поставка бетона'], ['other', 'Другое']],
    mode: [['static', 'static — как написано'], ['count', 'count — счётчик'], ['since', 'since — лет с года']],
    icon: ['road', 'wrench', 'landscape', 'cube', 'plant', 'shield', 'doc', 'scales', 'layers', 'clock', 'search', 'check'].map(function (n) { return [n, n]; }),
    kind: [['truck', 'Самосвал (truck)'], ['roller', 'Каток (roller)'], ['paver', 'Асфальтоукладчик (paver)']]
  };
  var LONG_KEYS = { lead: 1, text: 1, a: 1, greeting: 1, priceNote: 1 };

  /* ------------------------------------------------------------------
     Утилиты
     ------------------------------------------------------------------ */
  var doc = document;
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function el(tag, attrs, kids) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined) return;
      node.appendChild(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
    });
    return node;
  }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } }

  function b64ToUtf8(b64) {
    var bin = window.atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return window.btoa(bin);
  }
  function utf8ToB64(str) { return bytesToB64(new TextEncoder().encode(str)); }
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(bytesToB64(new Uint8Array(fr.result))); };
      fr.onerror = function () { reject(new Error('Не удалось прочитать файл')); };
      fr.readAsArrayBuffer(blob);
    });
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isImage(v) { return isObj(v) && typeof v.src === 'string' && 'alt' in v; }
  function label(key) { return LABELS[key] || String(key); }
  function slug(name) {
    var s = String(name).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!/[a-z]/.test(s)) s = s ? 'photo-' + s : 'photo'; // кириллица в имени файла -> нейтральное имя
    return s.slice(0, 40);
  }

  /* ------------------------------------------------------------------
     Состояние
     ------------------------------------------------------------------ */
  var state = { data: null, baseText: '', pending: {}, dirty: false, busy: false };
  var uid = 0;

  var gate = $('#gate');
  var app = $('#app');
  var statusEl = $('#status');
  var editor = $('#editor');
  var saveBar = $('#saveBar');
  var dirtyNote = $('#dirtyNote');
  var saveBtn = $('#saveBtn');
  var loadBtn = $('#loadBtn');
  var checkBtn = $('#checkBtn');
  var inOwner = $('#ghOwner');
  var inRepo = $('#ghRepo');
  var inBranch = $('#ghBranch');
  var inToken = $('#ghToken');

  function setStatus(msg, kind, link) {
    statusEl.textContent = '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    statusEl.appendChild(doc.createTextNode(msg));
    if (link && /^https:\/\/github\.com\//.test(link.href)) {
      statusEl.appendChild(doc.createTextNode(' '));
      statusEl.appendChild(el('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer', text: link.text }));
    }
    statusEl.hidden = false;
  }
  function setBusy(on, msg) {
    state.busy = on;
    [saveBtn, loadBtn, checkBtn].forEach(function (b) { b.disabled = on; });
    if (on && msg) setStatus(msg, 'info');
  }
  function markDirty() {
    state.dirty = true;
    saveBar.classList.add('dirty');
    dirtyNote.textContent = 'Есть несохранённые изменения';
  }
  function markClean() {
    state.dirty = false;
    saveBar.classList.remove('dirty');
    dirtyNote.textContent = 'Нет несохранённых изменений';
  }
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------------------------------------------
     Вход по паролю
     ------------------------------------------------------------------ */
  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    inOwner.value = lsGet(STORE.owner);
    inRepo.value = lsGet(STORE.repo);
    inBranch.value = lsGet(STORE.branch) || 'main';
    inToken.value = lsGet(STORE.token);
    if (inOwner.value && inRepo.value && inToken.value) loadContent();
    else setStatus('Укажите GITHUB_OWNER, GITHUB_REPO и GITHUB_TOKEN, затем нажмите «Загрузить content.json».', 'info');
  }
  $('#gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = $('#gatePass');
    var err = $('#gateErr');
    if (pass.value === ADMIN_PASSWORD) {
      ssSet(SESSION_KEY, '1');
      err.hidden = true;
      pass.value = '';
      showApp();
    } else {
      err.textContent = 'Неверный пароль.';
      err.hidden = false;
      pass.focus();
    }
  });
  $('#logoutBtn').addEventListener('click', function () {
    if (state.dirty && !window.confirm('Есть несохранённые изменения. Выйти?')) return;
    state.dirty = false;
    ssDel(SESSION_KEY);
    window.location.reload();
  });
  if (ssGet(SESSION_KEY) === '1') showApp();
  else $('#gatePass').focus();

  /* ------------------------------------------------------------------
     Настройки GitHub
     ------------------------------------------------------------------ */
  function readSettings() {
    return {
      owner: inOwner.value.trim(),
      repo: inRepo.value.trim(),
      branch: inBranch.value.trim() || 'main',
      token: inToken.value.trim()
    };
  }
  function checkSettings(s, needToken) {
    if (!/^[A-Za-z0-9_.-]+$/.test(s.owner)) return 'Укажите GITHUB_OWNER (логин или организация, только латиница, цифры, - _ .).';
    if (!/^[A-Za-z0-9_.-]+$/.test(s.repo)) return 'Укажите GITHUB_REPO (имя репозитория).';
    if (!/^[A-Za-z0-9_.\/-]+$/.test(s.branch)) return 'Некорректное имя ветки.';
    if (needToken !== false && !/^[A-Za-z0-9_\-.]{20,}$/.test(s.token)) return 'Укажите GITHUB_TOKEN (fine-grained токен с правом Contents: Read and write).';
    return '';
  }
  [[inOwner, STORE.owner], [inRepo, STORE.repo], [inBranch, STORE.branch], [inToken, STORE.token]].forEach(function (p) {
    p[0].addEventListener('change', function () { lsSet(p[1], p[0].value.trim()); });
  });
  $('#forgetBtn').addEventListener('click', function () {
    lsDel(STORE.token);
    inToken.value = '';
    setStatus('Токен удалён из этого браузера.', 'ok');
  });

  function repoApi(s) {
    return 'https://api.github.com/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo);
  }
  function contentsUrl(s, path) {
    return repoApi(s) + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function ghFetch(url, opts, token) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = {}; }
        if (!res.ok) {
          var err = new Error(j.message || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return j;
      });
    }, function () {
      var err = new Error('Нет соединения с GitHub. Проверьте интернет и повторите.');
      err.network = true;
      throw err;
    });
  }
  function errText(err) {
    if (err.network) return err.message;
    switch (err.status) {
      case 401: return 'Токен недействителен или истёк (401). Создайте новый токен и вставьте его в поле GITHUB_TOKEN.';
      case 403: return 'Нет прав (403): у токена должно быть право «Contents: Read and write» на этот репозиторий. Возможен также лимит запросов — повторите позже.';
      case 404: return 'Не найден репозиторий, ветка или файл (404). Проверьте GITHUB_OWNER, GITHUB_REPO и ветку; токен должен иметь доступ к репозиторию.';
      case 409:
      case 422: return 'Конфликт версий (' + err.status + '): файл на GitHub изменился. Нажмите «Загрузить content.json», чтобы получить свежую версию. Детали: ' + err.message;
      default: return 'Ошибка GitHub: ' + err.message;
    }
  }

  checkBtn.addEventListener('click', function () {
    var s = readSettings();
    var bad = checkSettings(s);
    if (bad) { setStatus(bad, 'err'); return; }
    setBusy(true, 'Проверяю доступ…');
    ghFetch(repoApi(s), {}, s.token).then(function (repo) {
      var p = repo.permissions || {};
      if (p.push) setStatus('Доступ есть: ' + repo.full_name + ', запись разрешена. Ветка по умолчанию — ' + repo.default_branch + '.', 'ok');
      else setStatus('Репозиторий найден, но запись запрещена: у токена нет права «Contents: Read and write».', 'err');
    }).catch(function (err) {
      setStatus(errText(err), 'err');
    }).then(function () { setBusy(false); });
  });

  /* ------------------------------------------------------------------
     Загрузка content.json
     ------------------------------------------------------------------ */
  function loadContent() {
    if (state.busy) return;
    if (state.dirty && !window.confirm('Несохранённые изменения будут потеряны. Загрузить заново?')) return;
    var s = readSettings();
    var bad = checkSettings(s);
    if (bad) { setStatus(bad, 'err'); return; }
    lsSet(STORE.owner, s.owner); lsSet(STORE.repo, s.repo); lsSet(STORE.branch, s.branch); lsSet(STORE.token, s.token);
    setBusy(true, 'Загружаю content.json…');
    ghFetch(contentsUrl(s, CONTENT_PATH) + '?ref=' + encodeURIComponent(s.branch), {}, s.token).then(function (file) {
      if (!file.content) throw new Error('GitHub не вернул содержимое файла (файл слишком большой или это не файл).');
      var text = b64ToUtf8(file.content);
      var data = JSON.parse(text);
      if (!isObj(data)) throw new Error('content.json должен быть объектом.');
      state.data = data;
      state.baseText = text;
      state.pending = {};
      buildEditor();
      markClean();
      setStatus('Загружено: ' + s.owner + '/' + s.repo + ', ветка ' + s.branch + '. Правьте поля и нажмите «Сохранить на GitHub».', 'ok');
    }).catch(function (err) {
      setStatus(err instanceof SyntaxError ? 'content.json повреждён и не читается как JSON.' : errText(err), 'err');
    }).then(function () { setBusy(false); });
  }
  loadBtn.addEventListener('click', loadContent);

  /* ------------------------------------------------------------------
     Генерация формы по структуре JSON
     ------------------------------------------------------------------ */
  function buildEditor() {
    editor.textContent = '';
    Object.keys(state.data).forEach(function (key, i) {
      var body = el('div', { 'class': 'section-body' });
      body.appendChild(renderValue(state.data[key], state.data, key, key, true));
      editor.appendChild(el('details', { 'class': 'section', open: i === 0 }, [
        el('summary', { text: label(key) }),
        body
      ]));
    });
    saveBar.hidden = false;
  }
  editor.addEventListener('submit', function (e) { e.preventDefault(); });

  function renderValue(value, parent, key, path, bare) {
    if (Array.isArray(value)) return renderArray(value, key, path, bare);
    if (isImage(value)) return renderImage(value, parent, key, path);
    if (isObj(value)) return renderObject(value, key, path, bare);
    return renderPrimitive(value, parent, key, path);
  }

  function renderObject(obj, key, path, bare) {
    var box = bare
      ? el('div', { 'class': 'section-body-inner' })
      : el('fieldset', { 'class': 'group' }, [el('legend', { text: label(key) })]);
    if (bare) box.className = 'group-bare';
    Object.keys(obj).forEach(function (k) {
      box.appendChild(renderValue(obj[k], obj, k, path + '.' + k, false));
    });
    if (/^(services|advantages|fleet)\.items\.\d+$/.test(path) && !obj.image) {
      var add = el('button', { 'class': 'btn btn-ghost btn-sm', type: 'button', text: '+ Добавить фото' });
      add.addEventListener('click', function () {
        obj.image = { src: '', alt: '', width: 0, height: 0, credit: '' };
        markDirty();
        redrawItem(box, obj, path);
      });
      box.appendChild(add);
    }
    return box;
  }
  function redrawItem(box, obj, path) {
    var fresh = renderObject(obj, '', path, true);
    box.replaceWith(fresh);
  }

  function renderPrimitive(value, parent, key, path) {
    var id = 'f' + (++uid);
    var wrap = el('div', { 'class': 'field' });
    var input;
    var cur = value === null || value === undefined ? '' : value;

    if (typeof cur === 'boolean') {
      input = el('input', { id: id, type: 'checkbox', checked: cur });
      input.addEventListener('change', function () { parent[key] = input.checked; markDirty(); });
      wrap.appendChild(el('div', { 'class': 'check-row' }, [input, el('label', { 'for': id, text: label(key) })]));
    } else {
      wrap.appendChild(el('label', { 'for': id, text: label(key) }));
      if (ENUMS[key]) {
        input = el('select', { id: id, 'class': 'input' });
        var known = ENUMS[key].some(function (o) { return o[0] === cur; });
        if (!known) input.appendChild(el('option', { value: cur, text: String(cur) || '(не выбрано)' }));
        ENUMS[key].forEach(function (o) { input.appendChild(el('option', { value: o[0], text: o[1] })); });
        input.value = String(cur);
        input.addEventListener('change', function () { parent[key] = input.value; markDirty(); });
      } else if (typeof cur === 'number') {
        input = el('input', { id: id, 'class': 'input', type: 'number', value: cur });
        input.addEventListener('input', function () { parent[key] = input.value === '' ? 0 : Number(input.value); markDirty(); });
      } else {
        var multiline = LONG_KEYS[key] || String(cur).length > 70 || String(cur).indexOf('\n') !== -1;
        input = multiline
          ? el('textarea', { id: id, 'class': 'input', rows: 3 })
          : el('input', { id: id, 'class': 'input', type: 'text' });
        input.value = String(cur);
        input.addEventListener('input', function () { parent[key] = input.value; markDirty(); });
      }
      wrap.appendChild(input);
    }
    var where = String(path || '').replace(/\.\d+/g, '');
    var help = HELP_PATH.hasOwnProperty(where) ? HELP_PATH[where] : HELP[key];
    if (help) wrap.appendChild(el('p', { 'class': 'help', text: help }));
    return wrap;
  }

  function itemTitle(item) {
    if (typeof item === 'string') return item;
    if (!isObj(item)) return '';
    return String(item.title || item.q || item.label || item.value || item.task || '');
  }
  function blankOf(tpl) {
    if (Array.isArray(tpl)) return [];
    if (isObj(tpl)) {
      var out = {};
      Object.keys(tpl).forEach(function (k) {
        if (k === 'image' && isImage(tpl[k])) return; // фото добавляется отдельной кнопкой
        out[k] = ENUMS[k] && typeof tpl[k] === 'string' ? ENUMS[k][0][0] : blankOf(tpl[k]);
      });
      return out;
    }
    if (typeof tpl === 'number') return 0;
    if (typeof tpl === 'boolean') return false;
    return '';
  }

  function renderArray(arr, key, path, bare) {
    var box = bare
      ? el('div', { 'class': 'group-bare' })
      : el('fieldset', { 'class': 'group' }, [el('legend', { text: label(key) })]);
    var body = el('div', { 'class': 'array-body' });
    box.appendChild(body);
    var primitive = arr.length === 0 ? true : !(isObj(arr[0]) || Array.isArray(arr[0]));
    var template = arr.length ? JSON.parse(JSON.stringify(arr[0])) : null;

    function swap(i, j) {
      if (j < 0 || j >= arr.length) return;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      markDirty();
      draw();
    }
    function ctl(text, aria, cls, fn) {
      var b = el('button', { 'class': 'btn btn-sm icon-btn ' + cls, type: 'button', 'aria-label': aria, text: text });
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
      return b;
    }
    function draw() {
      body.textContent = '';
      arr.forEach(function (item, i) {
        var controls = [
          ctl('↑', 'Поднять выше', 'btn-ghost', function () { swap(i, i - 1); }),
          ctl('↓', 'Опустить ниже', 'btn-ghost', function () { swap(i, i + 1); }),
          ctl('✕', 'Удалить', 'btn-danger', function () {
            if (!window.confirm('Удалить этот элемент?')) return;
            arr.splice(i, 1);
            markDirty();
            draw();
          })
        ];
        if (primitive) {
          var input = el('input', { 'class': 'input', type: 'text', 'aria-label': label(key) + ' ' + (i + 1) });
          input.value = String(item);
          input.addEventListener('input', function () { arr[i] = input.value; markDirty(); });
          body.appendChild(el('div', { 'class': 'prim-row' }, [input].concat(controls)));
        } else {
          var inner = renderObject(item, '', path + '.' + i, true);
          var title = el('span', { 'class': 'item-title', text: (i + 1) + '. ' + itemTitle(item) });
          var det = el('details', { 'class': 'item' }, [
            el('summary', null, [title].concat(controls)),
            el('div', { 'class': 'item-body' }, [inner])
          ]);
          body.appendChild(det);
        }
      });
      var add = el('button', { 'class': 'btn btn-ghost btn-sm', type: 'button', text: '+ Добавить' });
      add.addEventListener('click', function () {
        arr.push(primitive ? '' : blankOf(template || {}));
        markDirty();
        draw();
      });
      body.appendChild(add);
    }
    draw();
    return box;
  }

  /* ------------------------------------------------------------------
     Фото: выбор файла -> WebP в браузере -> загрузка при сохранении
     ------------------------------------------------------------------ */
  function loadBitmap(file) {
    if (window.createImageBitmap) return window.createImageBitmap(file);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть изображение')); };
      img.src = url;
    });
  }
  function canvasBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, q); });
  }
  function toWebp(file) {
    return loadBitmap(file).then(function (bmp) {
      var sw = bmp.width || bmp.naturalWidth;
      var sh = bmp.height || bmp.naturalHeight;
      var scale = Math.min(1, MAX_IMAGE_W / sw);
      var w = Math.max(1, Math.round(sw * scale));
      var h = Math.max(1, Math.round(sh * scale));
      var canvas = doc.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return canvasBlob(canvas, 'image/webp', WEBP_QUALITY).then(function (blob) {
        if (blob && blob.type === 'image/webp') return { blob: blob, width: w, height: h, ext: 'webp' };
        // браузер не умеет WebP — запасной вариант JPEG
        return canvasBlob(canvas, 'image/jpeg', 0.85).then(function (jpg) {
          if (!jpg) throw new Error('Не удалось сжать изображение');
          return { blob: jpg, width: w, height: h, ext: 'jpg' };
        });
      });
    });
  }

  function renderImage(obj, parent, key, path) {
    var removable = /\.items\.\d+\.image$/.test(path);
    var box = el('fieldset', { 'class': 'group image-widget' }, [el('legend', { text: label(key) })]);
    var preview = el('img', { 'class': 'preview', alt: 'Предпросмотр фото' });
    var meta = el('p', { 'class': 'meta' });

    function previewSrc() {
      var p = state.pending[obj.src];
      return p ? p.url : obj.src;
    }
    function refresh() {
      if (obj.src) {
        preview.setAttribute('src', previewSrc());
        preview.hidden = false;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
      }
      var pend = state.pending[obj.src];
      meta.textContent = obj.src
        ? 'Файл: ' + obj.src + (obj.width ? ' · ' + obj.width + '×' + obj.height + ' px' : '') + (pend && !pend.uploaded ? ' · будет загружен при сохранении' : '')
        : 'Фото не выбрано.';
    }

    var fileId = 'f' + (++uid);
    var file = el('input', { id: fileId, 'class': 'input', type: 'file', accept: 'image/*' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { setStatus('Выберите файл изображения (JPG, PNG, WebP).', 'err'); return; }
      setStatus('Обрабатываю фото…', 'info');
      toWebp(f).then(function (r) {
        var old = state.pending[obj.src];
        if (old && !old.uploaded) { URL.revokeObjectURL(old.url); delete state.pending[obj.src]; }
        var newPath = IMAGE_DIR + slug(f.name) + '-' + Date.now().toString(36) + '.' + r.ext;
        state.pending[newPath] = { blob: r.blob, url: URL.createObjectURL(r.blob), uploaded: false };
        obj.src = newPath;
        obj.width = r.width;
        obj.height = r.height;
        markDirty();
        refresh();
        setStatus('Фото подготовлено (' + r.width + '×' + r.height + ', ' + Math.round(r.blob.size / 1024) + ' КБ). Нажмите «Сохранить на GitHub», чтобы опубликовать.', 'ok');
      }).catch(function (err) {
        setStatus('Не удалось обработать фото: ' + err.message, 'err');
      });
    });

    box.appendChild(preview);
    box.appendChild(meta);
    box.appendChild(el('div', { 'class': 'field' }, [el('label', { 'for': fileId, text: 'Заменить фото (файл с вашего компьютера)' }), file]));
    Object.keys(obj).forEach(function (k) {
      if (k === 'src' || k === 'width' || k === 'height') return;
      box.appendChild(renderPrimitive(obj[k], obj, k));
    });
    if (removable) {
      var rm = el('button', { 'class': 'btn btn-danger btn-sm', type: 'button', text: 'Убрать фото из карточки' });
      rm.addEventListener('click', function () {
        if (!window.confirm('Убрать фото из этой карточки?')) return;
        delete parent[key];
        markDirty();
        var holder = box.closest('.group-bare');
        var itemPath = path.replace(/\.image$/, '');
        if (holder) redrawItem(holder, parent, itemPath);
      });
      box.appendChild(rm);
    }
    refresh();
    return box;
  }

  /* ------------------------------------------------------------------
     Сохранение: фото -> свежий sha -> PUT content.json
     ------------------------------------------------------------------ */
  function cleanData(node) {
    if (Array.isArray(node)) return node.map(cleanData);
    if (isObj(node)) {
      var out = {};
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (isImage(v) && !v.src) return; // пустое «добавленное» фото не сохраняем
        out[k] = cleanData(v);
      });
      return out;
    }
    return node;
  }
  function collectSrcs(node, set) {
    if (Array.isArray(node)) node.forEach(function (n) { collectSrcs(n, set); });
    else if (isObj(node)) {
      if (typeof node.src === 'string') set[node.src] = true;
      Object.keys(node).forEach(function (k) { collectSrcs(node[k], set); });
    }
  }

  function uploadImages(s, used) {
    var paths = Object.keys(state.pending).filter(function (p) { return used[p] && !state.pending[p].uploaded; });
    return paths.reduce(function (chain, p, i) {
      return chain.then(function () {
        setStatus('Загружаю фото ' + (i + 1) + ' из ' + paths.length + '…', 'info');
        return blobToB64(state.pending[p].blob).then(function (b64) {
          return ghFetch(contentsUrl(s, p), {
            method: 'PUT',
            body: { message: 'Добавлено фото через админку: ' + p, content: b64, branch: s.branch }
          }, s.token);
        }).then(function () { state.pending[p].uploaded = true; });
      });
    }, Promise.resolve());
  }

  function save() {
    if (state.busy || !state.data) return;
    var s = readSettings();
    var bad = checkSettings(s);
    if (bad) { setStatus(bad, 'err'); return; }
    var clean = cleanData(state.data);
    var text = JSON.stringify(clean, null, 2) + '\n';
    var used = {};
    collectSrcs(clean, used);
    var cancelled = false;

    setBusy(true, 'Сохраняю…');
    uploadImages(s, used).then(function () {
      setStatus('Проверяю актуальную версию файла…', 'info');
      return ghFetch(contentsUrl(s, CONTENT_PATH) + '?ref=' + encodeURIComponent(s.branch), {}, s.token);
    }).then(function (file) {
      var remote = file.content ? b64ToUtf8(file.content) : '';
      if (remote !== state.baseText && !window.confirm('Файл content.json на GitHub изменился после загрузки в админку (возможно, его правил кто-то ещё). Перезаписать его вашей версией?')) {
        cancelled = true;
        return null;
      }
      setStatus('Записываю content.json…', 'info');
      return ghFetch(contentsUrl(s, CONTENT_PATH), {
        method: 'PUT',
        body: {
          message: 'Обновление содержимого сайта через админку',
          content: utf8ToB64(text),
          sha: file.sha,
          branch: s.branch
        }
      }, s.token);
    }).then(function (res) {
      if (cancelled || !res) { setStatus('Сохранение отменено. Фото, уже загруженные на GitHub, останутся в репозитории.', 'info'); return; }
      state.baseText = text;
      state.data = clean;
      buildEditor();
      markClean();
      var commit = res.commit && res.commit.html_url ? { href: res.commit.html_url, text: 'Открыть коммит' } : null;
      setStatus('Сохранено. Изменения появятся на сайте через 1–2 минуты (GitHub Pages пересобирает сайт).', 'ok', commit);
    }).catch(function (err) {
      setStatus(errText(err), 'err');
    }).then(function () { setBusy(false); });
  }
  saveBtn.addEventListener('click', save);
})();
