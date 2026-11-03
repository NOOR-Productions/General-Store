/* Bapi Store: shop, cart and WhatsApp ordering.
   Products live in data/products.json, shop details in data/store.json. */
(() => {
  'use strict';

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');
  const icon = (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const FALLBACK = { phone: '+919832596691', whatsapp: '919832596691', name: 'Bapi Store' };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  /* ---------- State ---------- */
  const S = {
    shop: null,
    products: [],
    byId: new Map(),
    cats: ['All'],
    cart: store.get('bapi.cart', []),
    cat: 'All',
    sort: 'featured',
    stockOnly: false,
    pdQty: 1,
    route: 'shop',
    lastShopHash: '',
  };
  const shop = () => S.shop || FALLBACK;
  const view = () => $('#view');

  /* ---------- Loading bar ---------- */
  const Boot = {
    el: $('#boot'), fill: $('#boot-fill'), pct: $('#boot-pct'), msg: $('#boot-msg'), track: $('#boot-track'), value: 0,
    set(v, m) {
      this.value = Math.max(this.value, Math.min(100, v));
      this.fill.style.transform = `scaleX(${Math.max(.06, this.value / 100)})`;
      this.pct.textContent = Math.round(this.value);
      this.track.setAttribute('aria-valuenow', Math.round(this.value));
      if (m) this.msg.textContent = m;
    },
    done() {
      this.el.classList.add('out');
      document.body.classList.remove('booting');
      setTimeout(() => this.el.remove(), 900);
    },
  };

  /* Thin bar under the top edge when moving between pages */
  const Top = {
    el: $('#topbar'), t: 0,
    start() {
      clearTimeout(this.t);
      const e = this.el;
      e.style.transition = 'none'; e.style.opacity = '1'; e.style.transform = 'scaleX(0)';
      void e.offsetWidth;
      e.style.transition = 'transform .5s cubic-bezier(.2,.7,.2,1)'; e.style.transform = 'scaleX(.7)';
    },
    done() {
      const e = this.el;
      e.style.transition = 'transform .2s ease-out, opacity .3s .2s'; e.style.transform = 'scaleX(1)';
      this.t = setTimeout(() => { e.style.opacity = '0'; }, 220);
    },
  };

  const getJSON = async url => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    return r.json();
  };
  const preloadImage = (src, ms = 7000) => new Promise(res => {
    const im = new Image();
    const t = setTimeout(res, ms);
    im.onload = im.onerror = () => { clearTimeout(t); res(); };
    im.src = src;
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fontsReady = () => (document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, wait(1500)]) : Promise.resolve());

  /* ---------- Opening hours ---------- */
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmtTime = t => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; };
  function nowInShop() {
    const tz = shop().timezone || 'Asia/Kolkata';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t).value;
    return { day: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')], min: (Number(g('hour')) % 24) * 60 + Number(g('minute')) };
  }
  const slotFor = day => (shop().hours || []).find(h => h.days.includes(day));
  function storeStatus() {
    if (!S.shop || !S.shop.hours) return { open: false, text: '' };
    const { day, min } = nowInShop();
    const s = slotFor(day);
    if (s && min >= toMin(s.open) && min < toMin(s.close)) return { open: true, text: `Open until ${fmtTime(s.close)}` };
    if (s && min < toMin(s.open)) return { open: false, text: `Closed, opens ${fmtTime(s.open)}` };
    for (let i = 1; i <= 7; i++) {
      const d = (day + i) % 7, n = slotFor(d);
      if (n) return { open: false, text: `Closed, opens ${i === 1 ? 'tomorrow' : DAYS[d]} ${fmtTime(n.open)}` };
    }
    return { open: false, text: 'Closed' };
  }
  function updateStatus() {
    const st = storeStatus();
    $$('[data-status]').forEach(el => {
      el.hidden = !st.text;
      el.className = 'status ' + (st.open ? 'is-open' : 'is-closed');
      el.innerHTML = `<i class="dot"></i><span>${esc(st.text)}</span>`;
    });
  }
  const statusHTML = () => '<span class="status" data-status></span>';
  function hoursSummary() {
    const short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (shop().hours || []).map(h => {
      const days = DAY_ORDER.filter(d => h.days.includes(d));
      const runs = []; let run = [];
      days.forEach(d => { const prev = run[run.length - 1]; if (prev !== undefined && (DAY_ORDER.indexOf(d) === DAY_ORDER.indexOf(prev) + 1)) run.push(d); else { if (run.length) runs.push(run); run = [d]; } });
      if (run.length) runs.push(run);
      const label = runs.map(r => r.length >= 3 ? `${short[r[0]]} to ${short[r[r.length - 1]]}` : r.map(d => short[d]).join(', ')).join(', ');
      return `${label}, ${fmtTime(h.open)} to ${fmtTime(h.close)}`;
    });
  }

  /* ---------- Links ---------- */
  const waLink = text => `https://wa.me/${shop().whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  const telLink = () => `tel:${shop().phone}`;
  const prettyPhone = p => { const d = String(p).replace(/\D/g, '').replace(/^91/, ''); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p; };
  const mapsQ = () => encodeURIComponent(shop().mapsQuery || 'Curzon Gate Bardhaman West Bengal');

  /* ---------- Cart ---------- */
  const qtyOf = id => (S.cart.find(i => i.id === id) || {}).qty || 0;
  const cartCount = () => S.cart.reduce((a, i) => a + i.qty, 0);
  const cartSub = () => S.cart.reduce((a, i) => a + ((S.byId.get(i.id) || {}).price || 0) * i.qty, 0);
  function deliveryFee(fulfil, sub) {
    const d = shop().delivery || {};
    if (fulfil !== 'delivery' || !d.fee) return 0;
    return d.freeAbove > 0 && sub >= d.freeAbove ? 0 : d.fee;
  }
  function saveCart() { store.set('bapi.cart', S.cart); renderCartUI(); }
  function setQty(id, q) {
    const p = S.byId.get(id);
    if (!p || !p.inStock) return;
    q = Math.max(0, Math.min(99, q));
    const i = S.cart.findIndex(x => x.id === id);
    if (q === 0) { if (i > -1) S.cart.splice(i, 1); }
    else if (i > -1) S.cart[i].qty = q;
    else S.cart.push({ id, qty: q });
    saveCart();
    syncSlots();
    if (S.route === 'cart') renderCartBody();
  }
  function renderCartUI() {
    const n = cartCount();
    $$('[data-cart-count]').forEach(b => { b.textContent = n; b.hidden = !n; });
    $$('[data-cart-link]').forEach(a => a.setAttribute('aria-label', n ? `Cart, ${n} ${n === 1 ? 'item' : 'items'}` : 'Cart'));
    const pill = $('#cartpill');
    const show = n > 0 && !['cart', 'sent'].includes(S.route) && $('#search').hidden;
    pill.hidden = !show;
    if (show) pill.innerHTML = `${icon('bag')}<span class="pill-text"><b>${n} ${n === 1 ? 'item' : 'items'}</b> in your cart</span><span class="pill-total">${inr(cartSub())}</span><span class="pill-go">View cart</span>`;
  }

  /* Quick-add control that appears on every product card */
  function slotHTML(p) {
    if (!p.inStock) return `<a class="notify" href="${waLink(`Hi! Please let me know when ${p.name} is back in stock.`)}" target="_blank" rel="noopener">Notify me</a>`;
    const q = qtyOf(p.id);
    if (!q) return `<button type="button" class="add" data-act="add" data-id="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">${icon('plus')}</button>`;
    return `<div class="stepper" role="group" aria-label="${esc(p.name)} quantity"><button type="button" data-act="dec" data-id="${esc(p.id)}" aria-label="Remove one ${esc(p.name)}">${icon('minus')}</button><output aria-live="polite">${q}</output><button type="button" data-act="inc" data-id="${esc(p.id)}" aria-label="Add one more ${esc(p.name)}">${icon('plus')}</button></div>`;
  }
  function syncSlots() {
    const active = document.activeElement;
    const activeSlot = active && active.closest ? active.closest('.qty-slot') : null;
    $$('.qty-slot').forEach(slot => {
      const p = S.byId.get(slot.dataset.id);
      if (!p) return;
      const html = slotHTML(p);
      if (slot.innerHTML !== html) slot.innerHTML = html;
    });
    if (activeSlot && activeSlot.isConnected) {
      const t = $('[data-act="inc"], [data-act="add"]', activeSlot);
      if (t) t.focus({ preventScroll: true });
    }
  }

  /* ---------- Toasts ---------- */
  function toast(msg, { action, href, bad = false, ms = 2800 } = {}) {
    const box = $('#toasts');
    while (box.children.length >= 2) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'toast glass-strong' + (bad ? ' bad' : '');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<a href="${esc(href)}">${esc(action)}</a>` : ''}`;
    box.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
  }

  /* ---------- Product cards ---------- */
  const meta = p => [p.brand, p.size].filter(Boolean).join(', ');
  function cardHTML(p) {
    const tag = !p.inStock ? '<span class="tag">Out of stock</span>' : (p.comingSoon ? '<span class="tag">Coming soon</span>' : '');
    return `<article class="card frost${p.inStock ? '' : ' is-out'}" data-id="${esc(p.id)}">
      <a class="card-media" href="#/p/${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" width="320" height="320" loading="lazy" decoding="async">${tag}</a>
      <div class="card-body">
        <a class="card-title" href="#/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a>
        <p class="card-meta">${esc(meta(p))}</p>
        <div class="card-foot"><span class="price">${inr(p.price)}</span><div class="qty-slot" data-id="${esc(p.id)}">${slotHTML(p)}</div></div>
      </div></article>`;
  }

  /* ---------- Views ---------- */
  function setTitle(t) { document.title = t; }

  function heroHTML() {
    const s = shop();
    return `<section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy glass-strong">
        ${statusHTML()}
        <h1 id="hero-title">Everyday essentials from the shop by Curzon Gate</h1>
        <p>${esc(s.about || 'Snacks, beauty, stationery and household staples.')}</p>
        <div class="hero-actions">
          <button type="button" class="btn btn-brass" data-act="browse">Browse products</button>
          <a class="btn btn-glass" href="${telLink()}">${icon('phone')}Call the store</a>
        </div>
      </div>
      <figure class="hero-arch"><img src="Assets/hero.webp" width="1026" height="768" alt="The Bapi Store shopfront near Curzon Gate, with baskets of produce at the door" fetchpriority="high"></figure>
    </section>`;
  }

  function railHTML(title, items, id) {
    if (!items.length) return '';
    return `<section class="row" aria-labelledby="${id}">
      <div class="row-head"><h2 id="${id}">${esc(title)}</h2>
        <div class="rail-nav"><button type="button" data-act="rail-prev" aria-label="Scroll ${esc(title)} back">${icon('left')}</button><button type="button" data-act="rail-next" aria-label="Scroll ${esc(title)} forward">${icon('right')}</button></div></div>
      <div class="rail">${items.map(cardHTML).join('')}</div></section>`;
  }
  function boughtBefore() {
    const seen = new Set(); const out = [];
    for (const o of store.get('bapi.orders', [])) for (const it of o.items) { const p = S.byId.get(it.id); if (p && p.inStock && !seen.has(p.id)) { seen.add(p.id); out.push(p); } }
    return out.slice(0, 10);
  }

  function renderShop(params) {
    const c = params.get('cat');
    S.cat = c && S.cats.includes(c) ? c : 'All';
    setTitle('Bapi Store, Bardhaman | Snacks, beauty, stationery and household essentials');
    view().innerHTML = `${heroHTML()}
      <div class="chipbar glass" id="chipbar"><div class="chips" id="chips" role="group" aria-label="Categories"></div></div>
      <div id="rows"></div>
      <section class="shelf" aria-labelledby="shelf-title">
        <div class="shelf-head">
          <div><h2 id="shelf-title"></h2><p id="shelf-count" aria-live="polite"></p></div>
          <div class="controls">
            <select class="select" id="sort" aria-label="Sort products">
              <option value="featured">Featured first</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option><option value="name">Name, A to Z</option>
            </select>
            <label class="switch"><input type="checkbox" id="stock" role="switch"><span class="track"></span><span>In stock only</span></label>
          </div>
        </div>
        <div class="grid" id="grid"></div>
      </section>`;
    $('#sort').value = S.sort; $('#stock').checked = S.stockOnly;
    renderShopBody();
  }

  function renderShopBody() {
    const cats = S.cats;
    $('#chips').innerHTML = cats.map(c => {
      const list = S.products.filter(p => c === 'All' || p.category === c);
      const thumb = c === 'All' ? '' : `<span class="chip-thumb"><img src="${esc(list[0].image)}" alt="" width="32" height="32" loading="lazy"></span>`;
      return `<button type="button" class="chip${thumb ? ' has-thumb' : ''}" data-act="cat" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${thumb}${esc(c)} <small>${list.length}</small></button>`;
    }).join('');

    const rows = $('#rows');
    if (S.cat === 'All') {
      rows.innerHTML =
        railHTML('Buy again', boughtBefore(), 'r-again') +
        railHTML('Featured', S.products.filter(p => p.featured && p.inStock), 'r-feat') +
        railHTML('Ordered often', S.products.filter(p => p.popular && p.inStock), 'r-pop') +
        railHTML('Coming soon', S.products.filter(p => p.comingSoon), 'r-soon');
    } else rows.innerHTML = '';
    renderGrid();
  }

  function visibleProducts() {
    let list = S.products.filter(p => (S.cat === 'All' || p.category === S.cat) && (!S.stockOnly || p.inStock));
    const stockFirst = (a, b) => Number(b.inStock) - Number(a.inStock);
    if (S.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (S.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (S.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => stockFirst(a, b) || Number(b.featured) - Number(a.featured));
    return list;
  }
  function renderGrid() {
    const list = visibleProducts();
    $('#shelf-title').textContent = S.cat === 'All' ? 'All products' : S.cat;
    $('#shelf-count').textContent = `${list.length} ${list.length === 1 ? 'product' : 'products'}`;
    $('#grid').innerHTML = list.length ? list.map(cardHTML).join('') :
      `<div class="empty frost" style="grid-column:1/-1"><h2>Nothing matches these filters</h2><p>Try another category, or show items that are out of stock too.</p><button class="btn btn-glass" type="button" data-act="reset-filters">Clear filters</button></div>`;
  }

  function renderProduct(id) {
    let key = id; try { key = decodeURIComponent(id); } catch { /* keep raw */ }
    const p = S.byId.get(key);
    if (!p) return renderError({ code: '404', title: 'We couldn’t find that product', text: 'It may have been removed or renamed. Search for something similar, or ask us on WhatsApp.', search: true });
    S.pdQty = 1;
    setTitle(`${p.name} | Bapi Store`);
    const d = shop().delivery || {};
    const notes = [];
    if (d.enabled !== false) notes.push(`Delivered from Curzon Gate, Bardhaman${d.fee ? ` (delivery ${inr(d.fee)}${d.freeAbove ? `, free above ${inr(d.freeAbove)}` : ''})` : ', no delivery fee'}`);
    if ((shop().pickup || {}).enabled !== false) notes.push('Pick up at the store, no wait for delivery');
    if ((shop().payments || []).length) notes.push(`Payment options: ${shop().payments.join(', ')}`);
    const related = S.products.filter(x => x.category === p.category && x.id !== p.id).sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, 8);
    const inCart = qtyOf(p.id);
    view().innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Shop</a><span aria-hidden="true">/</span><a href="#/?cat=${encodeURIComponent(p.category)}">${esc(p.category)}</a></nav>
      <article class="pd">
        <div class="pd-media glass"><div class="pd-tile"><img src="${esc(p.image)}" alt="${esc(p.name)}" width="640" height="640" decoding="async"></div></div>
        <div class="pd-info">
          <h1>${esc(p.name)}</h1>
          <p class="pd-brand">${esc(meta(p))}</p>
          <p class="pd-price">${inr(p.price)}</p>
          <p class="pd-desc">${esc(p.description)}</p>
          ${p.details && p.details.length ? `<ul class="tags" aria-label="Product details">${p.details.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <p class="stock${p.inStock ? '' : ' out'}"><i class="dot"></i>${p.inStock ? 'In stock' : 'Out of stock'}</p>
          ${p.inStock ? `
          <div class="pd-buy">
            <div class="stepper" role="group" aria-label="Quantity"><button type="button" data-act="pd-dec" aria-label="Decrease quantity">${icon('minus')}</button><output id="pd-qty" aria-live="polite">1</output><button type="button" data-act="pd-inc" aria-label="Increase quantity">${icon('plus')}</button></div>
            <button type="button" class="btn btn-brass" data-act="pd-add" data-id="${esc(p.id)}">Add to cart</button>
            <button type="button" class="btn btn-glass" data-act="pd-buy" data-id="${esc(p.id)}">Buy now</button>
          </div>
          <p class="fine" id="pd-incart"${inCart ? '' : ' hidden'}>${inCart ? `${inCart} in your cart.` : ''}</p>` : `
          <div class="pd-buy"><a class="btn btn-brass" href="${waLink(`Hi! Please let me know when ${p.name} is back in stock.`)}" target="_blank" rel="noopener">${icon('chat')}Ask on WhatsApp</a><a class="btn btn-glass" href="#/?cat=${encodeURIComponent(p.category)}">See other ${esc(p.category.toLowerCase())}</a></div>`}
          ${notes.length ? `<ul class="notes frost">${notes.map(n => `<li>${icon('check')}<span>${esc(n)}</span></li>`).join('')}</ul>` : ''}
        </div>
      </article>
      ${related.length ? `<div style="margin-top:36px">${railHTML(`More ${p.category.toLowerCase()}`, related, 'r-rel')}</div>` : ''}`;
  }

  /* Cart and checkout */
  function renderCart() {
    setTitle('Your cart | Bapi Store');
    if (!S.cart.length) {
      const again = boughtBefore();
      view().innerHTML = `<div class="empty glass"><h2>Your cart is empty</h2><p>Add a few things from the shop and they will show up here.</p><a class="btn btn-brass" href="#/">Browse products</a></div>${again.length ? `<div style="margin-top:28px">${railHTML('Buy again', again, 'r-again')}</div>` : ''}`;
      return;
    }
    const prof = store.get('bapi.profile', {});
    const d = shop().delivery || {}, pickup = (shop().pickup || {}).enabled !== false, delivery = d.enabled !== false;
    S.fulfil = prof.fulfil === 'pickup' && pickup ? 'pickup' : (delivery ? 'delivery' : 'pickup');
    const pays = shop().payments || [];
    view().innerHTML = `
      <div class="page-head"><h1 class="page-title">Your cart</h1><button type="button" class="link" data-act="clear-cart">Clear cart</button></div>
      <div class="cart-layout">
        <ul class="lines" id="lines" aria-label="Items in your cart"></ul>
        <form class="checkout glass-strong" id="checkout" novalidate>
          <h2>Order details</h2>
          ${delivery && pickup ? `<fieldset><legend class="legend">How do you want it?</legend><div class="seg">
            <div><input type="radio" name="fulfil" id="f-d" value="delivery"${S.fulfil === 'delivery' ? ' checked' : ''}><label for="f-d">Home delivery</label></div>
            <div><input type="radio" name="fulfil" id="f-p" value="pickup"${S.fulfil === 'pickup' ? ' checked' : ''}><label for="f-p">Pick up at store</label></div></div></fieldset>` : ''}
          <div class="field"><label for="f-name">Your name</label><input class="input" id="f-name" name="name" autocomplete="name" value="${esc(prof.name || '')}" aria-describedby="e-name"><div class="field-err" id="e-name"></div></div>
          <div class="field"><label for="f-phone">Phone number</label><input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="10-digit mobile number" value="${esc(prof.phone || '')}" aria-describedby="e-phone"><div class="field-err" id="e-phone"></div></div>
          <div id="addr-wrap">
            <div class="field"><label for="f-addr">Delivery address</label><textarea class="input" id="f-addr" name="address" autocomplete="street-address" placeholder="House or flat, street, area" aria-describedby="e-addr">${esc(prof.address || '')}</textarea><div class="field-err" id="e-addr"></div></div>
            <div class="field" style="margin-top:12px"><label for="f-land">Landmark <span class="opt">(optional)</span></label><input class="input" id="f-land" name="landmark" placeholder="Near a shop or building we know" value="${esc(prof.landmark || '')}"></div>
          </div>
          ${pays.length ? `<fieldset><legend class="legend">How will you pay?</legend><div class="seg">${pays.map((p, i) => `<div><input type="radio" name="pay" id="pay-${i}" value="${esc(p)}"${(prof.pay ? prof.pay === p : i === 0) ? ' checked' : ''}><label for="pay-${i}">${esc(p)}</label></div>`).join('')}</div></fieldset>` : ''}
          <div class="field"><label for="f-note">Note for the store <span class="opt">(optional)</span></label><textarea class="input" id="f-note" name="note" placeholder="Anything we should know" style="min-height:64px"></textarea></div>
          <dl class="totals" id="totals"></dl>
          <div class="notice" id="closed-note" hidden></div>
          <div class="notice" id="min-note" hidden></div>
          <button class="btn btn-brass btn-block" type="submit" id="place">Send order on WhatsApp</button>
          <p class="fine">Your order opens in WhatsApp for you to send. Nothing is charged online. <button type="button" data-act="forget">Clear saved details</button></p>
        </form>
      </div>`;
    renderCartBody();
    syncFulfil();
  }

  function renderCartBody() {
    const lines = $('#lines');
    if (!lines) return;
    if (!S.cart.length) { renderCart(); return; }
    lines.innerHTML = S.cart.map(it => {
      const p = S.byId.get(it.id);
      return `<li class="line frost">
        <a class="card-media" href="#/p/${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.image)}" alt="" width="92" height="92" loading="lazy"></a>
        <div class="line-main">
          <a class="line-title" href="#/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a>
          <span class="line-sub">${inr(p.price)} each${p.size ? ', ' + esc(p.size) : ''}</span>
          <div class="line-row">
            <div class="stepper" role="group" aria-label="${esc(p.name)} quantity"><button type="button" data-act="dec" data-id="${esc(p.id)}" aria-label="Remove one ${esc(p.name)}">${icon('minus')}</button><output>${it.qty}</output><button type="button" data-act="inc" data-id="${esc(p.id)}" aria-label="Add one more ${esc(p.name)}">${icon('plus')}</button></div>
            <span class="line-total">${inr(p.price * it.qty)}</span>
            <button type="button" class="line-remove" data-act="remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from cart">${icon('trash')}</button>
          </div></div></li>`;
    }).join('');
    renderTotals();
  }
  function currentFulfil() { const r = $('input[name="fulfil"]:checked'); return r ? r.value : S.fulfil || 'delivery'; }
  function renderTotals() {
    const box = $('#totals'); if (!box) return;
    const sub = cartSub(), f = currentFulfil(), fee = deliveryFee(f, sub), d = shop().delivery || {};
    box.innerHTML = `<div><dt>Subtotal</dt><dd>${inr(sub)}</dd></div>
      <div><dt>${f === 'delivery' ? 'Delivery' : 'Pickup'}</dt><dd>${f === 'delivery' ? (fee ? inr(fee) : 'Free') : 'Free'}</dd></div>
      <div class="grand"><dt>Total</dt><dd>${inr(sub + fee)}</dd></div>`;
    const min = $('#min-note');
    const short = f === 'delivery' && d.minOrder > 0 && sub < d.minOrder;
    min.hidden = !short;
    if (short) min.textContent = `Delivery needs a minimum order of ${inr(d.minOrder)}. Add ${inr(d.minOrder - sub)} more, or choose pickup.`;
    const st = storeStatus(), closed = $('#closed-note');
    closed.hidden = st.open || !st.text;
    if (!closed.hidden) closed.textContent = `The store is closed right now. You can still send your order, and we will see it when we open.`;
    $('#place').disabled = short;
  }
  function syncFulfil() {
    const wrap = $('#addr-wrap'); if (!wrap) return;
    wrap.hidden = currentFulfil() !== 'delivery';
    renderTotals();
  }

  const normPhone = v => { let d = String(v).replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : null; };
  function setErr(id, msg) { const inp = $(id), e = $('#e-' + id.split('-')[1]); if (!inp || !e) return; e.textContent = msg || ''; if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  function saveProfile() {
    const f = $('#checkout'); if (!f) return;
    const fd = new FormData(f);
    store.set('bapi.profile', { name: fd.get('name') || '', phone: fd.get('phone') || '', address: fd.get('address') || '', landmark: fd.get('landmark') || '', fulfil: fd.get('fulfil') || S.fulfil, pay: fd.get('pay') || '' });
  }

  function submitOrder(e) {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    const fulfil = currentFulfil();
    const name = String(fd.get('name') || '').trim(), phone = normPhone(fd.get('phone') || ''), addr = String(fd.get('address') || '').trim();
    let first = null;
    const bad = (sel, msg) => { setErr(sel, msg); first = first || $(sel); };
    setErr('#f-name', ''); setErr('#f-phone', ''); setErr('#f-addr', '');
    if (name.length < 2) bad('#f-name', 'Enter your name.');
    if (!phone) bad('#f-phone', 'Enter a 10-digit mobile number, for example 98765 43210.');
    if (fulfil === 'delivery' && addr.length < 10) bad('#f-addr', 'Enter your full delivery address so we can find you.');
    if (first) { first.focus(); return; }

    const sub = cartSub(), fee = deliveryFee(fulfil, sub), total = sub + fee;
    const items = S.cart.map(it => { const p = S.byId.get(it.id); return { id: p.id, name: p.name, price: p.price, qty: it.qty }; });
    const lines = items.map((it, i) => `${i + 1}. ${it.name} x ${it.qty} = ${inr(it.price * it.qty)}`);
    const msg = [
      `Hi ${shop().name || 'Bapi Store'}, I'd like to order:`, '',
      ...lines, '',
      `Subtotal: ${inr(sub)}`,
      `${fulfil === 'delivery' ? 'Delivery' : 'Pickup'}: ${fee ? inr(fee) : 'Free'}`,
      `*Total: ${inr(total)}*`, '',
      `Name: ${name}`,
      `Phone: ${phone}`,
      fulfil === 'delivery' ? `Home delivery to: ${addr}` : 'I will pick it up from the store.',
      fulfil === 'delivery' && String(fd.get('landmark') || '').trim() ? `Landmark: ${String(fd.get('landmark')).trim()}` : null,
      fd.get('pay') ? `Payment: ${fd.get('pay')}` : null,
      String(fd.get('note') || '').trim() ? `Note: ${String(fd.get('note')).trim()}` : null,
    ].filter(x => x !== null).join('\n');
    const url = waLink(msg);

    saveProfile();
    const order = { ts: Date.now(), items, total, url };
    store.set('bapi.orders', [order, ...store.get('bapi.orders', [])].slice(0, 12));
    store.set('bapi.last', order);
    S.cart = []; saveCart();
    location.hash = '#/sent';
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
  }

  function renderSent() {
    const o = store.get('bapi.last', null);
    if (!o) { location.replace('#/'); return; }
    setTitle('Finish your order | Bapi Store');
    view().innerHTML = `<section class="sent glass-strong" aria-labelledby="sent-title">
      <span class="seal">${icon('check')}</span>
      <h1 id="sent-title">Send your order in WhatsApp</h1>
      <p>We opened WhatsApp with your order filled in. Tap Send there so the store receives it.</p>
      <ul aria-label="Your order">${o.items.map(i => `<li><span>${esc(i.name)} × ${i.qty}</span><span>${inr(i.price * i.qty)}</span></li>`).join('')}<li style="font-weight:700;border-top:1px solid var(--edge);padding-top:8px"><span>Total</span><span>${inr(o.total)}</span></li></ul>
      <div class="actions">
        <a class="btn btn-brass" href="${esc(o.url)}" target="_blank" rel="noopener">${icon('chat')}Open WhatsApp again</a>
        <button type="button" class="btn btn-glass" data-act="restore">Put items back in cart</button>
        <a class="btn btn-glass" href="#/">Back to shop</a>
      </div></section>`;
  }

  function renderVisit() {
    const s = shop(), a = s.address || {};
    setTitle('Visit the store | Bapi Store');
    const { day } = S.shop ? nowInShop() : { day: -1 };
    view().innerHTML = `
      <div class="page-head"><h1 class="page-title">Visit the store</h1></div>
      <div class="visit">
        <div class="map glass"><iframe title="Map showing ${esc(s.name)} near Curzon Gate, Bardhaman" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapsQ()}&output=embed"></iframe></div>
        <div class="visit-side">
          <section class="panel frost" aria-labelledby="v-addr"><h2 id="v-addr">Find us</h2>
            <address>${esc(a.line1 || '')}<br>${esc(a.line2 || '')}<br>${esc([a.city, a.state].filter(Boolean).join(', '))}${a.pin ? ' ' + esc(a.pin) : ''}</address>
            <a class="btn btn-brass" href="https://www.google.com/maps/dir/?api=1&destination=${mapsQ()}" target="_blank" rel="noopener">Get directions</a></section>
          <section class="panel frost" aria-labelledby="v-hours"><h2 id="v-hours">Opening hours</h2>${statusHTML()}
            <ul class="hours">${DAY_ORDER.map(d => { const sl = slotFor(d); return `<li${d === day ? ' class="today"' : ''}><span>${DAYS[d]}</span><span>${sl ? `${fmtTime(sl.open)} to ${fmtTime(sl.close)}` : 'Closed'}</span></li>`; }).join('')}</ul></section>
          <section class="panel frost" aria-labelledby="v-contact"><h2 id="v-contact">Contact</h2>
            <div class="contacts">
              <a class="contact" href="${telLink()}">${icon('phone')}<span>Call<small>${esc(prettyPhone(s.phone))}</small></span></a>
              <a class="contact" href="${waLink('Hi! I have a question.')}" target="_blank" rel="noopener">${icon('chat')}<span>WhatsApp<small>Message the store</small></span></a>
              ${s.email ? `<a class="contact" href="mailto:${esc(s.email)}">${icon('mail')}<span>Email<small>${esc(s.email)}</small></span></a>` : ''}
            </div></section>
        </div>
      </div>`;
    updateStatus();
  }

  /* Error views */
  function renderError({ code, title, text, search = false, retry = false, offline = false }) {
    setTitle(`${title} | Bapi Store`);
    view().innerHTML = `<section class="err" aria-labelledby="err-title">
      <div class="err-arch glass">${offline ? `<span class="err-icon">${icon('wifi-off')}</span>` : `<span class="err-code" aria-hidden="true">${esc(code)}</span>`}</div>
      <h1 id="err-title">${esc(title)}</h1><p>${esc(text)}</p>
      <div class="err-actions">
        ${retry ? '<button type="button" class="btn btn-brass" data-act="reload">Try again</button>' : '<a class="btn btn-brass" href="#/">Back to the shop</a>'}
        ${search ? '<button type="button" class="btn btn-glass" data-act="search">Search products</button>' : ''}
        ${retry ? `<a class="btn btn-glass" href="${telLink()}">${icon('phone')}Call the store</a>` : ''}
        <a class="btn btn-glass" href="${waLink('Hi! I need some help.')}" target="_blank" rel="noopener">${icon('chat')}Ask on WhatsApp</a>
      </div></section>`;
  }
  const renderNotFound = path => renderError({ code: '404', title: 'That aisle doesn’t exist', text: `Nothing lives at “${path.length > 40 ? path.slice(0, 40) + '…' : path}”. Head back to the shop or search for what you need.`, search: true });

  /* ---------- Footer ---------- */
  function renderFooter() {
    const s = shop(), a = s.address || {};
    $('#foot').innerHTML = `<div class="foot-in glass">
      <div><strong>${esc(s.name)}</strong><address>${esc(a.line1 || '')}, ${esc(a.line2 || '')}<br>${esc([a.city, a.state].filter(Boolean).join(', '))} ${esc(a.pin || '')}</address></div>
      <div>${hoursSummary().map(h => `<p>${esc(h)}</p>`).join('')}</div>
      <nav class="foot-links" aria-label="Footer"><a href="#/">Shop</a><a href="#/visit">Visit</a><a href="${telLink()}">Call</a><a href="${waLink('Hi!')}" target="_blank" rel="noopener">WhatsApp</a></nav>
      <p class="fine">© ${new Date().getFullYear()} ${esc(s.name)}, Bardhaman</p></div>`;
  }

  /* ---------- Search ---------- */
  let searchOpener = null;
  const searchOpen = () => !$('#search').hidden;
  function openSearch() {
    if (searchOpen()) return;
    searchOpener = document.activeElement;
    $('#search').hidden = false;
    document.documentElement.classList.add('lock');
    $('#q').value = '';
    renderSearch('');
    renderCartUI();
    setTimeout(() => $('#q').focus(), 30);
  }
  function closeSearch(restore = true) {
    if (!searchOpen()) return;
    $('#search').hidden = true;
    document.documentElement.classList.remove('lock');
    renderCartUI();
    if (restore && searchOpener && searchOpener.isConnected) searchOpener.focus({ preventScroll: true });
  }
  function searchProducts(q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return S.products.map((p, idx) => {
      const name = p.name.toLowerCase(), brand = (p.brand || '').toLowerCase();
      const hay = [name, brand, p.category.toLowerCase(), (p.details || []).join(' ').toLowerCase(), p.description.toLowerCase()].join(' ');
      let score = 0;
      for (const t of tokens) {
        if (!hay.includes(t)) return null;
        score += name.startsWith(t) ? 4 : name.includes(t) ? 3 : brand.includes(t) ? 2 : 1;
      }
      return { p, score, idx };
    }).filter(Boolean).sort((a, b) => b.score - a.score || Number(b.p.inStock) - Number(a.p.inStock) || a.idx - b.idx).map(x => x.p);
  }
  const hl = (text, q) => {
    const toks = q.split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return toks.length ? esc(text).replace(new RegExp(`(${toks.map(esc).join('|')})`, 'ig'), '<mark>$1</mark>') : esc(text);
  };
  function resultItem(p, q) {
    return `<li><a class="res-link" href="#/p/${encodeURIComponent(p.id)}"><span class="res-img"><img src="${esc(p.image)}" alt="" width="52" height="52" loading="lazy"></span><span class="res-text"><b>${hl(p.name, q)}</b><small>${esc(p.inStock ? meta(p) : 'Out of stock')}</small></span></a><span class="res-price">${inr(p.price)}</span><div class="qty-slot" data-id="${esc(p.id)}">${slotHTML(p)}</div></li>`;
  }
  function renderSearch(q) {
    const body = $('#search-body');
    q = q.trim();
    if (!q) {
      const pop = S.products.filter(p => p.popular && p.inStock).slice(0, 6);
      body.innerHTML = `<h3>Browse by category</h3><div class="search-chips">${S.cats.filter(c => c !== 'All').map(c => `<a class="chip" href="#/?cat=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>
        ${pop.length ? `<h3>Ordered often</h3><ul class="res">${pop.map(p => resultItem(p, '')).join('')}</ul>` : ''}`;
      return;
    }
    const res = searchProducts(q);
    body.innerHTML = res.length ? `<h3>${res.length} ${res.length === 1 ? 'result' : 'results'}</h3><ul class="res">${res.slice(0, 30).map(p => resultItem(p, q)).join('')}</ul>` :
      `<div class="empty" style="padding:30px 10px"><h2>No match for “${esc(q.slice(0, 40))}”</h2><p>Check the spelling, or ask the store whether they can get it.</p><a class="btn btn-brass" href="${waLink(`Hi! Do you have ${q}?`)}" target="_blank" rel="noopener">${icon('chat')}Ask on WhatsApp</a></div>`;
  }

  /* ---------- Router ---------- */
  const ROUTES = [['shop', /^\/$/], ['product', /^\/p\/([^/]+)\/?$/], ['cart', /^\/cart\/?$/], ['visit', /^\/visit\/?$/], ['sent', /^\/sent\/?$/]];
  const scrollMemo = {};
  let prevHash = '';
  function route() {
    Top.start();
    closeSearch(false);
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    let name = 'notfound', args = [];
    for (const [n, re] of ROUTES) { const m = path.match(re); if (m) { name = n; args = m.slice(1); break; } }
    if (prevHash) scrollMemo[prevHash] = window.scrollY;
    const was = S.route;
    S.route = name;
    document.body.dataset.route = name;
    if (!S.products.length && name !== 'notfound' && name !== 'visit' && name !== 'sent') return;
    ({ shop: () => renderShop(params), product: () => renderProduct(args[0]), cart: renderCart, visit: renderVisit, sent: renderSent, notfound: () => renderNotFound(path) })[name]();
    const h = location.hash || '#/';
    const back = name === 'shop' && was === 'product' && scrollMemo[h] != null;
    window.scrollTo(0, back ? scrollMemo[h] : 0);
    prevHash = h;
    $$('[data-route]').forEach(a => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    updateStatus(); renderCartUI();
    if (!back) view().focus({ preventScroll: true });
    requestAnimationFrame(() => Top.done());
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', e => {
    if (e.target.closest('.res-link, .search-chips .chip')) closeSearch(false);
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const id = t.dataset.id, act = t.dataset.act;
    switch (act) {
      case 'add': setQty(id, qtyOf(id) + 1); break;
      case 'inc': setQty(id, qtyOf(id) + 1); break;
      case 'dec': setQty(id, qtyOf(id) - 1); break;
      case 'remove': { const p = S.byId.get(id); setQty(id, 0); toast(`${p ? p.name : 'Item'} removed from your cart`); break; }
      case 'search': openSearch(); break;
      case 'search-close': closeSearch(); break;
      case 'browse': { const el = $('#chipbar'); if (el) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); break; }
      case 'cat': {
        S.cat = t.dataset.cat;
        history.replaceState(null, '', S.cat === 'All' ? '#/' : `#/?cat=${encodeURIComponent(S.cat)}`);
        prevHash = location.hash;
        renderShopBody();
        const bar = $('#chipbar'); if (bar && bar.getBoundingClientRect().top <= 100) bar.scrollIntoView({ block: 'start' });
        break;
      }
      case 'reset-filters': S.cat = 'All'; S.stockOnly = false; S.sort = 'featured'; history.replaceState(null, '', '#/'); renderShop(new URLSearchParams()); break;
      case 'rail-prev': case 'rail-next': { const rail = t.closest('.row').querySelector('.rail'); rail.scrollBy({ left: (act === 'rail-next' ? 1 : -1) * rail.clientWidth * .8, behavior: reduceMotion() ? 'auto' : 'smooth' }); break; }
      case 'pd-inc': case 'pd-dec': S.pdQty = Math.max(1, Math.min(99, S.pdQty + (act === 'pd-inc' ? 1 : -1))); $('#pd-qty').textContent = S.pdQty; break;
      case 'pd-add': case 'pd-buy': {
        setQty(id, qtyOf(id) + S.pdQty);
        if (act === 'pd-buy') { location.hash = '#/cart'; break; }
        const n = qtyOf(id), note = $('#pd-incart'); if (note) { note.hidden = false; note.textContent = `${n} in your cart.`; }
        toast('Added to your cart', { action: 'View cart', href: '#/cart' });
        break;
      }
      case 'clear-cart': if (S.cart.length) { S.cart = []; saveCart(); syncSlots(); renderCart(); toast('Cart cleared'); } break;
      case 'forget': store.del('bapi.profile'); $$('#checkout input.input, #checkout textarea').forEach(i => { i.value = ''; }); toast('Saved details cleared'); break;
      case 'restore': { const o = store.get('bapi.last', null); if (o) { S.cart = o.items.filter(i => S.byId.get(i.id)).map(i => ({ id: i.id, qty: i.qty })); saveCart(); } location.hash = '#/cart'; break; }
      case 'reload': location.reload(); break;
      default: break;
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'sort') { S.sort = e.target.value; renderGrid(); }
    else if (e.target.id === 'stock') { S.stockOnly = e.target.checked; renderGrid(); }
    else if (e.target.name === 'fulfil') { S.fulfil = e.target.value; syncFulfil(); saveProfile(); }
    else if (e.target.name === 'pay') saveProfile();
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') renderSearch(e.target.value);
    else if (e.target.closest && e.target.closest('#checkout')) { if (e.target.hasAttribute('aria-invalid')) { e.target.removeAttribute('aria-invalid'); const er = $('#e-' + e.target.id.split('-')[1]); if (er) er.textContent = ''; } saveProfile(); }
  });
  document.addEventListener('submit', e => { if (e.target.id === 'checkout') submitOrder(e); else if (e.target.id === 'search-form') { e.preventDefault(); const first = $('#search-body .res-link'); if (first) first.click(); } });
  document.addEventListener('keydown', e => {
    const el = e.target, tag = el.tagName || '';
    const typing = el.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(el.type));
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && S.products.length) { e.preventDefault(); openSearch(); return; }
    if (!searchOpen()) return;
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key === 'Tab') {
      const f = $$('input, button, a[href]', $('.search-panel')).filter(el => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => toast('You’re back online'));
  window.addEventListener('offline', () => toast('You’re offline. Reconnect to send orders on WhatsApp.', { bad: true, ms: 4200 }));
  let lastErr = 0;
  window.addEventListener('error', e => { console.error(e.error || e.message); if (Date.now() - lastErr > 10000 && !document.body.classList.contains('booting')) { lastErr = Date.now(); toast('Something went wrong. Refresh the page and try again.', { bad: true }); } });
  window.addEventListener('unhandledrejection', e => console.error(e.reason));

  /* ---------- Start ---------- */
  function validProduct(p) { return p && typeof p.id === 'string' && p.name && Number.isFinite(p.price) && p.image && p.category; }

  async function init() {
    const firstVisit = (() => { try { return !sessionStorage.getItem('bapi.booted'); } catch { return true; } })();
    Boot.set(6, 'Opening the shop');
    try {
      const [shopData, pdata] = await Promise.all([getJSON('data/store.json'), getJSON('data/products.json')]);
      Boot.set(32, 'Loading products');
      S.shop = shopData;
      S.products = (pdata.products || []).filter(validProduct);
      if (!S.products.length) throw new Error('No products in products.json');
      S.byId = new Map(S.products.map(p => [p.id, p]));
      S.cats = ['All', ...new Set(S.products.map(p => p.category))];
      S.cart = (Array.isArray(S.cart) ? S.cart : []).filter(i => i && S.byId.has(i.id) && S.byId.get(i.id).inStock && i.qty > 0).map(i => ({ id: i.id, qty: Math.min(99, Math.floor(i.qty)) }));
      store.set('bapi.cart', S.cart);

      const wantImages = [...new Set([...S.products.filter(p => p.featured), ...S.products.filter(p => p.popular), ...S.products].map(p => p.image))].slice(0, 10);
      const tasks = ['Assets/hero.webp', ...wantImages].map(src => preloadImage(src));
      let done = 0;
      tasks.forEach(t => t.then(() => { done++; Boot.set(32 + 62 * done / tasks.length, 'Loading photos'); }));
      await Promise.all([Promise.all(tasks), fontsReady(), wait(firstVisit ? 700 : 200)]);
      Boot.set(100, 'Ready');
      try { sessionStorage.setItem('bapi.booted', '1'); } catch { /* ignore */ }

      renderFooter();
      $$('[data-call]').forEach(a => { a.href = telLink(); });
      updateStatus();
      setInterval(updateStatus, 60000);
      route();
      await wait(280);
      document.body.classList.add('reveal');
      Boot.done();
      setTimeout(() => document.body.classList.remove('reveal'), 2200);
    } catch (err) {
      console.error(err);
      Boot.set(100, 'Something went wrong');
      $$('[data-call]').forEach(a => { a.href = telLink(); });
      renderError({ code: '!', retry: true, offline: !navigator.onLine, title: navigator.onLine ? 'The shelves didn’t load' : 'You’re offline', text: navigator.onLine ? 'We couldn’t load the product list. Check your connection and try again. You can also call or message us to order.' : 'Reconnect to the internet and try again. You can also call us to place your order.' });
      Boot.done();
      $('#foot').innerHTML = '';
    }
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ }));
  }
  init();
})();
