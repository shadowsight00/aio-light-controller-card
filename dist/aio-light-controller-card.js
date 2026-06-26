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
    if (!on.length) return { bg: '#1c1c1c', text: '#444' };
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
    if (this._activeRoom === null) return '';
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

    const css = `:host{display:block}*{box-sizing:border-box}.wrap{padding:12px;font-family:var(--primary-font-family)}.title{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#666;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(${this._config.columns || 3},1fr);gap:10px;margin-bottom:12px}.tile{border-radius:14px;padding:22px 10px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;border:2px solid transparent;min-height:100px}.tile.active{border-color:#EF9F27}.tile ha-icon{--mdi-icon-size:26px}.tile-name{font-size:13px;font-weight:500}.pa{display:grid;grid-template-rows:0fr;overflow:hidden}.pa.open{grid-template-rows:1fr}.pa.anim{transition:grid-template-rows .35s ease}.pai{min-height:0;overflow:hidden}.panel{background:#1e1e1e;border-radius:14px;padding:18px;margin-bottom:10px}.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.pl{display:flex;align-items:center;gap:10px}.pi{width:28px;height:28px;border-radius:7px;background:#2a2a2a;display:flex;align-items:center;justify-content:center}.pi ha-icon{--mdi-icon-size:16px;color:#EF9F27}.pn{font-size:17px;font-weight:600;color:#fff}.toggle{display:flex;align-items:center;gap:6px;border:none;border-radius:100px;padding:6px 10px 6px 14px;cursor:pointer;font-size:13px;font-weight:600;transition:background .3s,color .3s;background:#EF9F27;color:#1a0e00}.toggle.off{background:#333;color:#888}.tsm{display:flex;align-items:center;gap:5px;border:none;border-radius:100px;padding:4px 8px 4px 10px;cursor:pointer;font-size:12px;font-weight:600;transition:background .3s;background:#EF9F27;color:#1a0e00}.tsm.off{background:#333;color:#888}.td{width:18px;height:18px;border-radius:50%;background:#fff;display:inline-block;transition:background .3s}.toggle.off .td,.tsm.off .td{background:#555}.sr{margin-bottom:10px;padding:0 2px}.sl{display:flex;justify-content:space-between;margin-bottom:5px}.sll{font-size:12px;color:#888;display:flex;align-items:center;gap:6px}.sll ha-icon{--mdi-icon-size:14px;color:#555}.slr{font-size:12px;color:#666}.track{position:relative;height:7px;border-radius:4px;cursor:pointer;user-select:none}.thumb{position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:50%;transform:translateY(-50%);box-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:none}.hr{border:none;border-top:.5px solid #2e2e2e;margin:14px 0}.sec{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#555;margin-bottom:10px}.ip{border-radius:10px;overflow:hidden;margin-bottom:8px}.ih{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer}.ihl{display:flex;align-items:center;gap:8px}.ihl ha-icon{--mdi-icon-size:15px}.iln{font-size:13px;font-weight:500}.ibr{font-size:12px;margin-left:4px}.ihr{display:flex;align-items:center;gap:8px}.ic{font-size:10px;opacity:.7}.ibw{display:grid;overflow:hidden}.ifx{margin-top:10px;margin-bottom:4px}.frow{display:flex;gap:7px;flex-wrap:wrap}.fp{border-radius:100px;border:1px solid #333;padding:7px 14px;font-size:12px;color:#aaa;background:transparent;cursor:pointer;white-space:nowrap}.fp.active{border-color:#EF9F27;color:#EF9F27}.fw{position:relative;display:inline-block}.fd{display:none;position:absolute;background:#2a2a2a;border-radius:10px;padding:8px;bottom:calc(100% + 6px);left:0;z-index:99;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.5);max-height:220px;overflow-y:auto}.fd.open{display:block}.fdi{padding:8px 12px;font-size:12px;color:#aaa;cursor:pointer;border-radius:6px;white-space:nowrap}.fdi:hover,.fdi.active{color:#EF9F27}.hint{text-align:center;font-size:11px;color:#3a3a3a;margin-top:8px}`;

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
class UniversalLightCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._expandedRooms = new Set();
  }

  set hass(hass) { this._hass = hass; }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config));
    if (!this._config.rooms) this._config.rooms = [];
    this.render();
  }

  _fire() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true, composed: true,
    }));
  }

  _set(path, value) {
    const keys = path.split('.');
    let obj = this._config;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = isNaN(keys[i]) ? keys[i] : parseInt(keys[i]);
      obj = obj[k];
    }
    const last = isNaN(keys[keys.length-1]) ? keys[keys.length-1] : parseInt(keys[keys.length-1]);
    if (value === undefined || value === null || value === '') {
      delete obj[last];
    } else {
      obj[last] = value;
    }
    this._fire();
    this.render();
  }

  _addRoom() {
    this._config.rooms.push({ label: 'New Room', icon: 'mdi:lightbulb', group: '', lights: [] });
    this._expandedRooms.add(this._config.rooms.length - 1);
    this._fire();
    this.render();
  }

  _removeRoom(i) {
    this._config.rooms.splice(i, 1);
    this._expandedRooms.delete(i);
    this._fire();
    this.render();
  }

  _moveRoom(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this._config.rooms.length) return;
    [this._config.rooms[i], this._config.rooms[j]] = [this._config.rooms[j], this._config.rooms[i]];
    this._fire();
    this.render();
  }

  _addLight(ri) {
    if (!this._config.rooms[ri].lights) this._config.rooms[ri].lights = [];
    this._config.rooms[ri].lights.push({ label: '', id: '' });
    this._fire();
    this.render();
  }

  _removeLight(ri, li) {
    this._config.rooms[ri].lights.splice(li, 1);
    this._fire();
    this.render();
  }

  _toggleRoom(i) {
    if (this._expandedRooms.has(i)) this._expandedRooms.delete(i);
    else this._expandedRooms.add(i);
    this.render();
  }

  _getEffects(entityId) {
    if (!this._hass || !entityId) return [];
    return this._hass.states[entityId]?.attributes?.effect_list || [];
  }

  _getEntityName(entityId) {
    if (!this._hass || !entityId) return entityId;
    return this._hass.states[entityId]?.attributes?.friendly_name || entityId;
  }

  render() {
    const cfg = this._config;
    const rooms = cfg.rooms || [];

    const css = `
      :host { display: block; }
      * { box-sizing: border-box; }
      .editor { padding: 4px 0 16px; font-family: var(--primary-font-family); }
      .section-title { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #888; margin: 18px 0 10px; padding: 0 2px; }
      .field { margin-bottom: 12px; }
      .field label { display: block; font-size: 12px; color: #aaa; margin-bottom: 4px; }
      .field input { width: 100%; padding: 8px 10px; background: var(--card-background-color, #2a2a2a); border: 1px solid var(--divider-color, #444); border-radius: 8px; color: var(--primary-text-color, #fff); font-size: 13px; outline: none; }
      .field input:focus { border-color: #EF9F27; }
      .room-list { display: flex; flex-direction: column; gap: 8px; }
      .room-card { background: var(--card-background-color, #1e1e1e); border-radius: 10px; overflow: hidden; border: 1px solid var(--divider-color, #333); }
      .room-header { display: flex; align-items: center; padding: 10px 12px; cursor: pointer; gap: 8px; }
      .room-header-label { flex: 1; font-size: 13px; font-weight: 500; color: var(--primary-text-color, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .room-body { padding: 14px; border-top: 1px solid var(--divider-color, #2a2a2a); }
      .icon-btn { background: none; border: none; color: var(--secondary-text-color, #666); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 13px; line-height: 1; display: flex; align-items: center; }
      .icon-btn:hover { color: #EF9F27; background: rgba(239,159,39,.1); }
      .icon-btn.danger:hover { color: #e74c3c; background: rgba(231,76,60,.1); }
      .light-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .light-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; background: var(--secondary-background-color, #262626); border-radius: 8px; padding: 10px; }
      .light-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .light-fields .field { margin-bottom: 0; }
      .add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(239,159,39,.08); border: 1px dashed #EF9F27; border-radius: 8px; color: #EF9F27; padding: 9px 12px; cursor: pointer; font-size: 12px; width: 100%; margin-top: 10px; transition: background .15s; }
      .add-btn:hover { background: rgba(239,159,39,.18); }
      .row { display: flex; gap: 10px; }
      .row .field { flex: 1; min-width: 0; }
      .chevron { font-size: 10px; color: var(--secondary-text-color, #666); flex-shrink: 0; }
      .effect-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; max-height: 160px; overflow-y: auto; padding: 2px; }
      .effect-tag { display: flex; align-items: center; gap: 4px; background: var(--secondary-background-color, #262626); border: 1px solid var(--divider-color, #444); border-radius: 100px; padding: 4px 10px; font-size: 11px; color: var(--secondary-text-color, #aaa); cursor: default; }
      .effect-tag.active { border-color: #EF9F27; color: #EF9F27; background: rgba(239,159,39,.08); }
      .effect-none { font-size: 12px; color: var(--secondary-text-color, #666); font-style: italic; padding: 4px 2px; }
      .hint { font-size: 11px; color: var(--secondary-text-color, #666); margin-top: 4px; font-style: italic; line-height: 1.4; }
      ha-entity-picker, ha-icon-picker { display: block; width: 100%; }
      .sub-label { font-size: 11px; color: var(--secondary-text-color, #666); text-transform: uppercase; letter-spacing: .05em; margin: 12px 0 6px; }
    `;

    const roomsHtml = rooms.map((r, i) => {
      const expanded = this._expandedRooms.has(i);
      const effects = this._getEffects(r.group);
      const effectTargets = r.effect_targets || [];

      const lightsHtml = (r.lights || []).map((l, li) => `
        <div class="light-row">
          <div class="light-fields">
            <div class="field">
              <label>Label</label>
              <input value="${l.label || ''}" data-path="rooms.${i}.lights.${li}.label" placeholder="Lamp 1" />
            </div>
            <div class="field">
              <label>Entity</label>
              <ha-entity-picker
                .hass="${'__HASS__'}"
                value="${l.id || ''}"
                allow-custom-entity
                domain-filter="light"
                data-light-entity="${i},${li}"
              ></ha-entity-picker>
            </div>
          </div>
          <button class="icon-btn danger" data-remove-light="${i},${li}" title="Remove light" style="margin-top:20px">&#10005;</button>
        </div>
      `).join('');

      const effectsDisplay = effects.length
        ? `<div class="effect-list">${effects.map(ef => `<span class="effect-tag">${ef}</span>`).join('')}</div>`
        : `<div class="effect-none">Turn on a light in this room to see available effects</div>`;

      return `<div class="room-card">
        <div class="room-header" data-toggle-room="${i}">
          <span class="chevron">${expanded ? '&#9650;' : '&#9660;'}</span>
          ${r.icon ? `<ha-icon icon="${r.icon}" style="--mdi-icon-size:18px;color:#EF9F27;flex-shrink:0"></ha-icon>` : ''}
          <span class="room-header-label">${r.label || 'Room ' + (i+1)}</span>
          <button class="icon-btn" data-move-room="${i},-1" title="Move up">&#8593;</button>
          <button class="icon-btn" data-move-room="${i},1" title="Move down">&#8595;</button>
          <button class="icon-btn danger" data-remove-room="${i}" title="Remove">&#10005;</button>
        </div>
        ${expanded ? `<div class="room-body">
          <div class="row">
            <div class="field" style="max-width:140px">
              <label>Icon</label>
              <ha-icon-picker
                value="${r.icon || ''}"
                data-icon-room="${i}"
              ></ha-icon-picker>
            </div>
            <div class="field">
              <label>Room Label</label>
              <input value="${r.label || ''}" data-path="rooms.${i}.label" placeholder="Living Room" />
            </div>
          </div>
          <div class="field">
            <label>Group / Main Entity</label>
            <ha-entity-picker
              .hass="${'__HASS__'}"
              value="${r.group || ''}"
              allow-custom-entity
              data-group-room="${i}"
            ></ha-entity-picker>
            <div class="hint">The main entity to control (light group or switch). Individual lights below are optional.</div>
          </div>
          <div class="field">
            <label>Effect Targets (optional)</label>
            <div class="hint" style="margin-top:0;margin-bottom:6px">For Hue or other lights where effects must be sent to individual entities rather than the group. Leave blank to send effects to the group.</div>
            <div id="effect-targets-${i}">
              ${effectTargets.map((t, ti) => `
                <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
                  <ha-entity-picker
                    .hass="${'__HASS__'}"
                    value="${t}"
                    allow-custom-entity
                    domain-filter="light"
                    data-effect-target="${i},${ti}"
                    style="flex:1"
                  ></ha-entity-picker>
                  <button class="icon-btn danger" data-remove-effect-target="${i},${ti}">&#10005;</button>
                </div>
              `).join('')}
            </div>
            <button class="add-btn" data-add-effect-target="${i}" style="margin-top:4px">+ Add Effect Target</button>
          </div>
          <div class="sub-label">Individual Lights</div>
          <div class="light-list">${lightsHtml}</div>
          <button class="add-btn" data-add-light="${i}">+ Add Light</button>
          <div class="sub-label" style="margin-top:14px">Available Effects</div>
          <div class="hint" style="margin-top:0;margin-bottom:6px">Detected automatically from your lights. No configuration needed.</div>
          ${effectsDisplay}
        </div>` : ''}
      </div>`;
    }).join('');

    this.shadowRoot.innerHTML = `<style>${css}</style>
      <div class="editor">
        <div class="section-title">Card Settings</div>
        <div class="row">
          <div class="field">
            <label>Title</label>
            <input value="${cfg.title || 'Light Control'}" data-path="title" />
          </div>
          <div class="field" style="max-width:90px">
            <label>Columns</label>
            <input type="number" min="1" max="6" value="${cfg.columns || 3}" data-path="columns" />
          </div>
        </div>
        <div class="section-title">Rooms</div>
        <div class="room-list">${roomsHtml}</div>
        <button class="add-btn" id="add-room-btn" style="margin-top:12px">+ Add Room</button>
      </div>`;

    this._attachEvents();
    this._wireHassPickers();
  }

  _wireHassPickers() {
    if (!this._hass) return;
    const root = this.shadowRoot;

    // Wire hass into all ha-entity-picker elements
    root.querySelectorAll('ha-entity-picker').forEach(picker => {
      picker.hass = this._hass;
    });
  }

  _attachEvents() {
    const root = this.shadowRoot;

    // Plain text inputs
    root.querySelectorAll('input[data-path]').forEach(input => {
      input.addEventListener('change', () => {
        const val = input.type === 'number' ? parseInt(input.value) : input.value;
        this._set(input.dataset.path, val);
      });
    });

    // Icon pickers
    root.querySelectorAll('ha-icon-picker[data-icon-room]').forEach(picker => {
      picker.addEventListener('value-changed', e => {
        const ri = parseInt(picker.dataset.iconRoom);
        this._config.rooms[ri].icon = e.detail.value;
        this._fire();
        this.render();
      });
    });

    // Group entity pickers
    root.querySelectorAll('ha-entity-picker[data-group-room]').forEach(picker => {
      picker.addEventListener('value-changed', e => {
        const ri = parseInt(picker.dataset.groupRoom);
        this._config.rooms[ri].group = e.detail.value || '';
        this._fire();
        this.render();
      });
    });

    // Individual light entity pickers
    root.querySelectorAll('ha-entity-picker[data-light-entity]').forEach(picker => {
      picker.addEventListener('value-changed', e => {
        const [ri, li] = picker.dataset.lightEntity.split(',').map(Number);
        this._config.rooms[ri].lights[li].id = e.detail.value || '';
        // Auto-fill label from friendly name if empty
        if (!this._config.rooms[ri].lights[li].label && e.detail.value && this._hass) {
          const name = this._hass.states[e.detail.value]?.attributes?.friendly_name;
          if (name) this._config.rooms[ri].lights[li].label = name;
        }
        this._fire();
        this.render();
      });
    });

    // Effect target pickers
    root.querySelectorAll('ha-entity-picker[data-effect-target]').forEach(picker => {
      picker.addEventListener('value-changed', e => {
        const [ri, ti] = picker.dataset.effectTarget.split(',').map(Number);
        if (!this._config.rooms[ri].effect_targets) this._config.rooms[ri].effect_targets = [];
        this._config.rooms[ri].effect_targets[ti] = e.detail.value || '';
        this._fire();
      });
    });

    // Add effect target
    root.querySelectorAll('[data-add-effect-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ri = parseInt(btn.dataset.addEffectTarget);
        if (!this._config.rooms[ri].effect_targets) this._config.rooms[ri].effect_targets = [];
        this._config.rooms[ri].effect_targets.push('');
        this._fire();
        this.render();
      });
    });

    // Remove effect target
    root.querySelectorAll('[data-remove-effect-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ri, ti] = btn.dataset.removeEffectTarget.split(',').map(Number);
        this._config.rooms[ri].effect_targets.splice(ti, 1);
        if (!this._config.rooms[ri].effect_targets.length) delete this._config.rooms[ri].effect_targets;
        this._fire();
        this.render();
      });
    });

    // Toggle room expand
    root.querySelectorAll('[data-toggle-room]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('ha-icon-picker') || e.target.closest('ha-entity-picker')) return;
        this._toggleRoom(parseInt(el.dataset.toggleRoom));
      });
    });

    // Add room
    root.querySelector('#add-room-btn')?.addEventListener('click', () => this._addRoom());

    // Remove room
    root.querySelectorAll('[data-remove-room]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this._removeRoom(parseInt(btn.dataset.removeRoom)); });
    });

    // Move room
    root.querySelectorAll('[data-move-room]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const [i, dir] = btn.dataset.moveRoom.split(',').map(Number);
        this._moveRoom(i, dir);
      });
    });

    // Add light
    root.querySelectorAll('[data-add-light]').forEach(btn => {
      btn.addEventListener('click', () => this._addLight(parseInt(btn.dataset.addLight)));
    });

    // Remove light
    root.querySelectorAll('[data-remove-light]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ri, li] = btn.dataset.removeLight.split(',').map(Number);
        this._removeLight(ri, li);
      });
    });

    // Wire hass after events attached
    this._wireHassPickers();
  }
}

customElements.define('universal-light-card-editor', UniversalLightCardEditor);
