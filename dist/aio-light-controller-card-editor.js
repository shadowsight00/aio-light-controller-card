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
