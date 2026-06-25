class UniversalLightCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._activeRoom = null;
    this._expandedLights = new Set();
    this._sliderCleanup = [];
    this._rendered = false;
    this._featCache = {};
  }

  setConfig(config) {
    if (!config.rooms || !Array.isArray(config.rooms)) {
      throw new Error('universal-light-card: "rooms" array is required');
    }
    this._config = config;
    this._featCache = {};
    this._rendered = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._featCache = {};
    if (!this._rendered) {
      this._fullRender();
      this._rendered = true;
    } else {
      this._updateStates();
    }
  }

  // ── Entity helpers ──────────────────────────────────────────────
  _s(id) { return this._hass?.states[id]; }
  _rgb(e) { return (e?.state === 'on' && e.attributes?.rgb_color) || null; }
  _bri(e) { return e?.state === 'on' ? Math.round((e.attributes?.brightness || 0) / 2.55) : null; }
  _temp(e) { return e?.state === 'on' ? (e.attributes?.color_temp_kelvin || null) : null; }
  _hueVal(e) { return e?.state === 'on' ? (e.attributes?.hs_color?.[0] ?? null) : null; }
  _lum(r, g, b) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  _tc(r, g, b) { return this._lum(r, g, b) > 0.45 ? '#1a1a1a' : '#fff'; }
  _solidCol(e) {
    if (!e || e.state !== 'on') return '#222';
    const c = this._rgb(e);
    return c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'rgb(255,197,143)';
  }

  // ── Auto-detect features from HA entity attributes ──────────────
  _feat(entityId) {
    if (this._featCache[entityId]) return this._featCache[entityId];
    const e = this._s(entityId);
    if (!e) return { hasBri: false, hasTemp: false, hasColor: false, tempMin: 2700, tempMax: 6500, effects: [] };
    const modes = e.attributes?.supported_color_modes || [];
    
    // mireds → kelvin conversion
    const minMired = e.attributes?.min_mireds;
    const maxMired = e.attributes?.max_mireds;
    const minK = e.attributes?.min_color_temp_kelvin || (maxMired ? Math.round(1000000 / maxMired) : 2700);
    const maxK = e.attributes?.max_color_temp_kelvin || (minMired ? Math.round(1000000 / minMired) : 6500);
    const feat = {
      hasBri: modes.some(m => !['onoff', 'unknown'].includes(m)),
      hasTemp: modes.includes('color_temp'),
      hasColor: modes.some(m => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m)),
      tempMin: minK,
      tempMax: maxK,
      effects: e.attributes?.effect_list || [],
      isSwitch: entityId.startsWith('switch.')
    };
    this._featCache[entityId] = feat;
    return feat;
  }

  // ── Tile gradient from light colors ────────────────────────────
  _tileStyle(ids) {
    const on = ids.map(id => this._s(id)).filter(e => e?.state === 'on');
    if (!on.length) return { bg: '#1c1c1c', text: this._config.label_color || '#444' };
    const cols = on.map(e => { const c = this._rgb(e); return c ? [c[0], c[1], c[2]] : [255, 197, 143]; });
    if (cols.length === 1) { const [r, g, b] = cols[0]; return { bg: `rgb(${r},${g},${b})`, text: this._tc(r, g, b) }; }
    const grad = cols.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(',');
    const ar = cols.reduce((s, c) => s + c[0], 0) / cols.length;
    const ag = cols.reduce((s, c) => s + c[1], 0) / cols.length;
    const ab = cols.reduce((s, c) => s + c[2], 0) / cols.length;
    return { bg: `linear-gradient(135deg,${grad})`, text: this._tc(ar, ag, ab) };
  }

  _call(domain, svc, data) { this._hass.callService(domain, svc, data); }

  // ── HTML builders ───────────────────────────────────────────────
  _sliderRow(label, icon, cls, entity, trackStyle, thumbPct, valueLabel, extra) {
    return `<div class="sr"><div class="sl"><span class="sll"><ha-icon icon="${icon}"></ha-icon>${label}</span><span class="slr">${valueLabel || '&mdash;'}</span></div><div class="track ${cls}" data-entity="${entity}" data-extra='${JSON.stringify(extra || {})}' style="${trackStyle}"><div class="thumb" style="left:calc(${Math.min(thumbPct, 99)}% - 9px);"></div></div></div>`;
  }

  _toggleHtml(on, entity, domain, small) {
    const c = small ? 'tsm' : 'toggle';
    return `<button class="${c}${on ? '' : ' off'}" data-toggle-entity="${entity}" data-toggle-domain="${domain}"><span class="tl">${on ? 'on' : 'off'}</span><span class="td"></span></button>`;
  }

  _fxHtml(effects, targets, activeEffect, idSuffix) {
    if (!effects || !effects.length || !targets) return '';
    const tgt = JSON.stringify(Array.isArray(targets) ? targets : [targets]);
    const vis = effects.slice(0, 4), more = effects.slice(4);
    const pills = vis.map(ef => `<button class="fp${activeEffect === ef ? ' active' : ''}" data-effect="${ef}" data-targets='${tgt}'>${ef}</button>`).join('');
    const moreHtml = more.length ? `<div class="fw"><button class="fp fmb" data-dd-id="fxd-${idSuffix}">+ more</button><div class="fd" id="fxd-${idSuffix}">${more.map(ef => `<div class="fdi${activeEffect === ef ? ' active' : ''}" data-effect="${ef}" data-targets='${tgt}'>${ef}</div>`).join('')}</div></div>` : '';
    return `<div class="frow">${pills}${moreHtml}</div>`;
  }

  _lightPanelHtml(l) {
    const e = this._s(l.id);
    const on = e?.state === 'on';
    const exp = this._expandedLights.has(l.id);
    const col = this._solidCol(e);
    const c = this._rgb(e);
    const txt = c ? this._tc(c[0], c[1], c[2]) : (on ? '#1a1a1a' : '#555');
    const bri = this._bri(e);
    const temp = this._temp(e);
    const hv = this._hueVal(e);
    const ae = e?.attributes?.effect;
    const feat = this._feat(l.id);
    const sid = l.id.replace(/\./g, '_');

    let body = '';
    if (on) {
      if (feat.hasBri) body += this._sliderRow('Brightness', 'mdi:brightness-6', 'bri-track', l.id, 'background:linear-gradient(to right,rgb(20,20,20),rgb(255,220,130))', bri !== null ? Math.min(bri, 99) : 0, bri !== null ? bri + '%' : null, {});
      if (feat.hasTemp) body += this._sliderRow('Temperature', 'mdi:temperature-kelvin', 'temp-track', l.id, 'background:linear-gradient(to right,rgb(255,147,41),rgb(255,197,143),rgb(255,255,255),rgb(155,176,255))', temp ? Math.round((temp - feat.tempMin) / (feat.tempMax - feat.tempMin) * 100) : 30, temp ? Math.round(temp) + 'K' : null, { min: feat.tempMin, max: feat.tempMax });
      if (feat.hasColor && hv != null) body += this._sliderRow('Color', 'mdi:palette', 'hue-track', l.id, 'background:linear-gradient(to right,hsl(0,100%,50%),hsl(30,100%,50%),hsl(60,100%,50%),hsl(90,100%,50%),hsl(120,100%,50%),hsl(150,100%,50%),hsl(180,100%,50%),hsl(210,100%,50%),hsl(240,100%,50%),hsl(270,100%,50%),hsl(300,100%,50%),hsl(330,100%,50%),hsl(360,100%,50%))', Math.round(hv / 360 * 100), null, {});
      if (feat.effects.length) {
        const targets = l.effect_target ? [l.effect_target] : [l.id];
        const fx = this._fxHtml(feat.effects, targets, ae, sid);
        if (fx) body += `<div class="ifx">${fx}</div>`;
      }
    }

    return `<div class="ip">
      <div class="ih" data-expand-light="${l.id}" style="background:${on ? col : '#242424'};">
        <div class="ihl"><ha-icon icon="mdi:lightbulb" style="color:${txt};"></ha-icon><span class="iln" style="color:${txt};">${l.label}</span>${on && bri !== null ? `<span class="ibr" style="color:${txt};opacity:.7;">${bri}%</span>` : ''}</div>
        <div class="ihr">${this._toggleHtml(on, l.id, feat.isSwitch ? 'switch' : 'light', true)}<span class="ic" style="color:${txt};">${exp ? '&#9650;' : '&#9660;'}</span></div>
      </div>
      <div class="ibw" style="display:grid;grid-template-rows:${exp && on ? '1fr' : '0fr'};transition:grid-template-rows .3s ease;overflow:hidden;">
        <div style="min-height:0;overflow:hidden;background:#262626;">${exp && on ? `<div style="padding:12px 12px 8px">${body}</div>` : ''}</div>
      </div>
    </div>`;
  }

  _panelHtml() {
    if (!this._activeRoom) return '';
    const r = this._config.rooms[this._activeRoom];
    if (!r) return '';

    const grpId = r.group;
    const grp = this._s(grpId);
    const on = grp?.state === 'on';
    const feat = this._feat(grpId);
    const bri = this._bri(grp);
    const temp = this._temp(grp);
    const hv = this._hueVal(grp);
    const ae = grp?.attributes?.effect;

    // Collect effect targets — use explicit effect_targets if set, else group
    const effectTargets = r.effect_targets || (r.group ? [r.group] : []);

    // Collect room-level effects — union of all individual light effect lists if not specified
    let roomEffects = r.effects || null;
    if (!roomEffects) {
      const allFx = new Set();
      (r.lights || []).forEach(l => { (this._feat(l.id).effects || []).forEach(ef => allFx.add(ef)); });
      if (allFx.size) roomEffects = [...allFx];
    }

    let sliders = '';
    if (!feat.isSwitch) {
      if (feat.hasBri) sliders += this._sliderRow('Brightness', 'mdi:brightness-6', 'bri-track', grpId, 'background:linear-gradient(to right,rgb(20,20,20),rgb(255,220,130))', bri !== null ? Math.min(bri, 99) : 0, bri !== null ? bri + '%' : null, {});
      if (feat.hasTemp) sliders += this._sliderRow('Temperature', 'mdi:temperature-kelvin', 'temp-track', grpId, 'background:linear-gradient(to right,rgb(255,147,41),rgb(255,197,143),rgb(255,255,255),rgb(155,176,255))', temp ? Math.round((temp - feat.tempMin) / (feat.tempMax - feat.tempMin) * 100) : 30, temp ? Math.round(temp) + 'K' : null, { min: feat.tempMin, max: feat.tempMax });
      if (feat.hasColor) sliders += this._sliderRow('Color', 'mdi:palette', 'hue-track', grpId, 'background:linear-gradient(to right,hsl(0,100%,50%),hsl(30,100%,50%),hsl(60,100%,50%),hsl(90,100%,50%),hsl(120,100%,50%),hsl(150,100%,50%),hsl(180,100%,50%),hsl(210,100%,50%),hsl(240,100%,50%),hsl(270,100%,50%),hsl(300,100%,50%),hsl(330,100%,50%),hsl(360,100%,50%))', hv != null ? Math.round(hv / 360 * 100) : 50, null, {});
    }

    const lights = r.lights || [];
    const indHtml = lights.length > 1
      ? `<hr class="hr"><div class="sec">Individual Lights</div>${lights.map(l => this._lightPanelHtml(l)).join('')}`
      : '';

    let fxHtml = '';
    if (roomEffects && roomEffects.length && effectTargets.length) {
      const fx = this._fxHtml(roomEffects, effectTargets, ae, String(this._activeRoom));
      if (fx) fxHtml = `<hr class="hr"><div class="sec">Effects</div>${fx}`;
    }

    return `<div class="panel">
      <div class="ph">
        <div class="pl"><div class="pi"><ha-icon icon="${r.icon || 'mdi:lightbulb'}"></ha-icon></div><span class="pn">${r.label}</span></div>
        ${this._toggleHtml(on, grpId, feat.isSwitch ? 'switch' : 'light', false)}
      </div>
      ${sliders}${indHtml}${fxHtml}
    </div>`;
  }

  // ── State update (no re-render) ─────────────────────────────────
  _updateStates() {
    const root = this.shadowRoot;
    if (!root) return;
    const rooms = this._config.rooms;

    // Update tile gradients
    rooms.forEach((r, i) => {
      const tile = root.querySelector(`.tile[data-room="${i}"]`);
      if (!tile) return;
      const ids = (r.lights || []).map(l => l.id);
      const style = this._tileStyle(ids);
      tile.style.background = style.bg;
      const ic = tile.querySelector('ha-icon'), nm = tile.querySelector('.tile-name');
      if (ic) ic.style.color = style.text;
      if (nm) nm.style.color = style.text;
    });

    if (this._activeRoom === null) return;
    const r = rooms[this._activeRoom];
    if (!r) return;

    const grp = this._s(r.group), on = grp?.state === 'on';
    const tog = root.querySelector('.toggle');
    if (tog) { tog.className = 'toggle' + (on ? '' : ' off'); const lb = tog.querySelector('.tl'); if (lb) lb.textContent = on ? 'on' : 'off'; }

    (r.lights || []).forEach(l => {
      const e = this._s(l.id), lo = e?.state === 'on';
      const hdr = root.querySelector(`.ih[data-expand-light="${l.id}"]`);
      if (!hdr) return;
      const col = this._solidCol(e), c = this._rgb(e), txt = c ? this._tc(c[0], c[1], c[2]) : (lo ? '#1a1a1a' : '#555');
      hdr.style.background = lo ? col : '#242424';
      const ic = hdr.querySelector('ha-icon'), nm = hdr.querySelector('.iln'), br = hdr.querySelector('.ibr');
      if (ic) ic.style.color = txt;
      if (nm) nm.style.color = txt;
      if (br) { const b = this._bri(e); if (lo && b !== null) { br.textContent = b + '%'; br.style.color = txt; } }
      const tg = hdr.querySelector('.tsm');
      if (tg) { tg.className = 'tsm' + (lo ? '' : ' off'); const lb = tg.querySelector('.tl'); if (lb) lb.textContent = lo ? 'on' : 'off'; }
    });
  }

  // ── Full render ─────────────────────────────────────────────────
  _fullRender() {
    this._sliderCleanup.forEach(fn => fn());
    this._sliderCleanup = [];
    const rooms = this._config.rooms;

    const titleColor = this._config.title_color || ''; const css = `${titleColor ? ':host{display:block;--ulc-title-color:' + titleColor + '}' : ':host{display:block}'}*{box-sizing:border-box}.wrap{padding:12px;font-family:var(--primary-font-family)}.title{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ulc-title-color,#666);margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(${this._config.columns || 3},1fr);gap:10px;margin-bottom:12px}.tile{border-radius:14px;padding:22px 10px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;border:2px solid transparent;min-height:100px}.tile.active{border-color:#EF9F27}.tile ha-icon{--mdi-icon-size:26px}.tile-name{font-size:13px;font-weight:500}.pa{display:grid;grid-template-rows:0fr;overflow:hidden}.pa.open{grid-template-rows:1fr}.pa.anim{transition:grid-template-rows .35s ease}.pai{min-height:0;overflow:hidden}.panel{background:#1e1e1e;border-radius:14px;padding:18px;margin-bottom:10px}.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.pl{display:flex;align-items:center;gap:10px}.pi{width:28px;height:28px;border-radius:7px;background:#2a2a2a;display:flex;align-items:center;justify-content:center}.pi ha-icon{--mdi-icon-size:16px;color:#EF9F27}.pn{font-size:17px;font-weight:600;color:#fff}.toggle{display:flex;align-items:center;gap:6px;border:none;border-radius:100px;padding:6px 10px 6px 14px;cursor:pointer;font-size:13px;font-weight:600;transition:background .3s,color .3s;background:#EF9F27;color:#1a0e00}.toggle.off{background:#333;color:#888}.tsm{display:flex;align-items:center;gap:5px;border:none;border-radius:100px;padding:4px 8px 4px 10px;cursor:pointer;font-size:12px;font-weight:600;transition:background .3s;background:#EF9F27;color:#1a0e00}.tsm.off{background:#333;color:#888}.td{width:18px;height:18px;border-radius:50%;background:#fff;display:inline-block;transition:background .3s}.toggle.off .td,.tsm.off .td{background:#555}.sr{margin-bottom:10px;padding:0 2px}.sl{display:flex;justify-content:space-between;margin-bottom:5px}.sll{font-size:12px;color:#888;display:flex;align-items:center;gap:6px}.sll ha-icon{--mdi-icon-size:14px;color:#555}.slr{font-size:12px;color:#666}.track{position:relative;height:7px;border-radius:4px;cursor:pointer;user-select:none}.thumb{position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:50%;transform:translateY(-50%);box-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:none}.hr{border:none;border-top:.5px solid #2e2e2e;margin:14px 0}.sec{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#555;margin-bottom:10px}.ip{border-radius:10px;overflow:hidden;margin-bottom:8px}.ih{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer}.ihl{display:flex;align-items:center;gap:8px}.ihl ha-icon{--mdi-icon-size:15px}.iln{font-size:13px;font-weight:500}.ibr{font-size:12px;margin-left:4px}.ihr{display:flex;align-items:center;gap:8px}.ic{font-size:10px;opacity:.7}.ibw{display:grid;overflow:hidden}.ifx{margin-top:10px;margin-bottom:4px}.frow{display:flex;gap:7px;flex-wrap:wrap}.fp{border-radius:100px;border:1px solid #333;padding:7px 14px;font-size:12px;color:#aaa;background:transparent;cursor:pointer;white-space:nowrap}.fp.active{border-color:#EF9F27;color:#EF9F27}.fw{position:relative;display:inline-block}.fd{display:none;position:absolute;background:#2a2a2a;border-radius:10px;padding:8px;bottom:calc(100% + 6px);left:0;z-index:99;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.5);max-height:220px;overflow-y:auto}.fd.open{display:block}.fdi{padding:8px 12px;font-size:12px;color:#aaa;cursor:pointer;border-radius:6px;white-space:nowrap}.fdi:hover,.fdi.active{color:#EF9F27}.hint{text-align:center;font-size:11px;color:#3a3a3a;margin-top:8px}`;

    const gridHtml = rooms.map((r, i) => {
      const ids = (r.lights || []).map(l => l.id);
      const style = this._tileStyle(ids);
      const active = this._activeRoom === i;
      return `<div class="tile${active ? ' active' : ''}" data-room="${i}" style="background:${style.bg};"><ha-icon icon="${r.icon || 'mdi:lightbulb'}" style="color:${style.text};"></ha-icon><span class="tile-name" style="color:${style.text};">${r.label}</span></div>`;
    }).join('');

    this.shadowRoot.innerHTML = `<style>${css}</style><div class="wrap"><div class="title">${this._config.title || 'Light Control'}</div><div class="grid">${gridHtml}</div><div class="pa${this._activeRoom !== null ? ' open' : ''}" id="pa"><div class="pai" id="pi">${this._panelHtml()}</div></div><div class="hint">tap room to expand</div></div>`;
    this._attachEvents();
  }

  // ── Room toggle with animation ──────────────────────────────────
  _toggleRoom(idx) {
    const newRoom = this._activeRoom === idx ? null : idx;
    this._activeRoom = newRoom;
    const root = this.shadowRoot, pa = root.querySelector('#pa'), pi = root.querySelector('#pi');
    root.querySelectorAll('.tile').forEach(t => t.classList.toggle('active', parseInt(t.dataset.room) === newRoom));
    pa.classList.add('anim');
    if (newRoom !== null) {
      pi.innerHTML = this._panelHtml();
      this._reattachPanel();
      pa.classList.remove('open');
      void pa.offsetHeight;
      pa.classList.add('open');
    } else {
      pa.classList.remove('open');
      pa.addEventListener('transitionend', () => { pi.innerHTML = ''; pa.classList.remove('anim'); }, { once: true });
      return;
    }
    pa.addEventListener('transitionend', () => pa.classList.remove('anim'), { once: true });
  }

  // ── Event wiring ────────────────────────────────────────────────
  _reattachPanel() {
    this._sliderCleanup.forEach(fn => fn());
    this._sliderCleanup = [];
    const root = this.shadowRoot;

    root.querySelectorAll('[data-expand-light]').forEach(h => {
      h.addEventListener('click', e => {
        if (e.target.closest('[data-toggle-entity]')) return;
        const id = h.dataset.expandLight;
        if (this._expandedLights.has(id)) this._expandedLights.delete(id);
        else this._expandedLights.add(id);
        const pi = root.querySelector('#pi');
        if (pi) { pi.innerHTML = this._panelHtml(); this._reattachPanel(); }
      });
    });
    root.querySelectorAll('[data-toggle-entity]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const en = btn.dataset.toggleEntity, d = btn.dataset.toggleDomain, st = this._s(en);
        this._call(d, st?.state === 'on' ? 'turn_off' : 'turn_on', { entity_id: en });
      });
    });
    root.querySelectorAll('.fp[data-effect]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ef = btn.dataset.effect, tgts = JSON.parse(btn.dataset.targets || '[]');
        tgts.forEach(t => this._call('light', 'turn_on', { entity_id: t, effect: ef }));
      });
    });
    root.querySelectorAll('.fmb').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); const dd = root.querySelector(`#${btn.dataset.ddId}`); if (dd) dd.classList.toggle('open'); });
    });
    root.querySelectorAll('.fdi').forEach(item => {
      item.addEventListener('click', () => {
        const ef = item.dataset.effect, tgts = JSON.parse(item.dataset.targets || '[]');
        tgts.forEach(t => this._call('light', 'turn_on', { entity_id: t, effect: ef }));
        item.closest('.fd')?.classList.remove('open');
      });
    });

    const mkSlider = (cls, cb) => root.querySelectorAll(cls).forEach(t => {
      let drag = false;
      const thumb = t.querySelector('.thumb');
      const pct = x => { const r = t.getBoundingClientRect(); return Math.max(0, Math.min(100, (x - r.left) / r.width * 100)); };
      const upd = x => { const p = pct(x); if (thumb) thumb.style.left = `calc(${Math.min(p, 99)}% - 9px)`; return p; };
      const md = e => { e.preventDefault(); e.stopPropagation(); drag = true; upd(e.clientX); };
      const mm = e => { if (drag) upd(e.clientX); };
      const mu = e => { if (!drag) return; drag = false; cb(t, upd(e.clientX)); };
      const ts = e => { e.stopPropagation(); drag = true; upd(e.touches[0].clientX); };
      const tm = e => { if (drag) { e.preventDefault(); upd(e.touches[0].clientX); } };
      const te = e => { if (!drag) return; drag = false; cb(t, upd(e.changedTouches[0].clientX)); };
      t.addEventListener('mousedown', md); window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
      t.addEventListener('touchstart', ts, { passive: true }); t.addEventListener('touchmove', tm, { passive: false }); t.addEventListener('touchend', te);
      this._sliderCleanup.push(() => {
        t.removeEventListener('mousedown', md); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
        t.removeEventListener('touchstart', ts); t.removeEventListener('touchmove', tm); t.removeEventListener('touchend', te);
      });
    });

    mkSlider('.bri-track', (t, p) => this._call('light', 'turn_on', { entity_id: t.dataset.entity, brightness_pct: Math.round(p) }));
    mkSlider('.temp-track', (t, p) => { let ex = {}; try { ex = JSON.parse(t.dataset.extra || '{}'); } catch (e) { } const min = ex.min || 2700, max = ex.max || 6500; this._call('light', 'turn_on', { entity_id: t.dataset.entity, color_temp_kelvin: Math.round(min + (p / 100) * (max - min)) }); });
    mkSlider('.hue-track', (t, p) => this._call('light', 'turn_on', { entity_id: t.dataset.entity, hs_color: [Math.round(p / 100 * 360), 100] }));
  }

  _attachEvents() {
    const root = this.shadowRoot;
    root.querySelectorAll('.tile').forEach(t => t.addEventListener('click', () => this._toggleRoom(parseInt(t.dataset.room))));
    this._reattachPanel();
  }

  getCardSize() { return 8; }
  static getConfigElement() { return document.createElement('universal-light-card-editor'); }
  static getStubConfig() {
    return {
      title: 'Light Control',
      rooms: [
        {
          label: 'Living Room',
          icon: 'mdi:sofa',
          group: 'light.living_room',
          lights: [{ label: 'Light 1', id: 'light.living_room_1' }]
        }
      ]
    };
  }
}

customElements.define('universal-light-card', UniversalLightCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'universal-light-card', name: 'Universal Light Card', description: 'Config-driven light control with auto-detected features' });
