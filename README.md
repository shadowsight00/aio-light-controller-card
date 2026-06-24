# AIO Light Controller Card

> Stop juggling individual light cards. Control every room's lights, effects, and colors from one beautiful collapsible card.

A custom Lovelace card for Home Assistant that organizes all your lights by room into a single, elegant interface. Features live color gradients on room tiles, auto-detected brightness/temperature/color/effect support per light, collapsible room panels, individual light controls, and a fully built-in visual config editor : no YAML required.

![AIO Light Controller Card - Room Grid](https://github.com/user-attachments/assets/9b1c3d34-b820-4ad7-92e7-8a3b80d103da)

![AIO Light Controller Card - Expanded Panel](https://github.com/user-attachments/assets/1b603bc7-c118-4b53-bc98-9662bdfadb34)

---

## Features

- **Room tiles with live gradients** : each tile reflects the actual color(s) of your lights in real time
- **Auto-detection** : brightness, color temperature, color, and effects are detected automatically from each light's HA attributes. No manual configuration needed
- **Collapsible room panels** : tap a room to expand its controls, tap again to collapse
- **Individual light controls** : per-light brightness, temperature, color sliders and effects, expandable inline
- **Effects support** : room-level and per-light effects with scrollable overflow for large effect lists
- **Visual config editor** : full UI editor with icon picker, entity dropdowns, and auto-filled labels. No YAML required
- **Works with any light brand** : Govee, Philips Hue, IKEA, Sengled, Zigbee, Z-Wave, and more
- **Switch support** : kitchen or other switch-controlled lights work as simple on/off tiles

---

## Installation

### HACS (Recommended)

1. Open HACS in your Home Assistant instance
2. Go to **Frontend**
3. Click the **+** button and search for **AIO Light Controller Card**
4. Click **Download**
5. Restart Home Assistant
6. Hard refresh your browser (Ctrl+Shift+R)

### Manual

1. Download `aio-light-controller-card.js` and `aio-light-controller-card-editor.js` from the `dist/` folder
2. Copy both files to your `/config/www/` directory
3. Go to **Settings → Dashboards → Resources** and add:
   - `/local/aio-light-controller-card.js` (type: JavaScript Module)
   - `/local/aio-light-controller-card-editor.js` (type: JavaScript Module)
4. Hard refresh your browser

---

## Usage

### Visual Editor (Recommended)

1. Edit your dashboard
2. Click **Add Card**
3. Search for **AIO Light Controller**
4. Use the visual editor to add rooms, pick entities, and configure lights. No YAML needed

### YAML Configuration

```yaml
type: custom:aio-light-controller-card
title: Light Control
columns: 3
rooms:
  - label: Living Room
    icon: mdi:sofa
    group: light.living_room
    lights:
      - label: Lamp 1
        id: light.living_room_lamp_1
      - label: Lamp 2
        id: light.living_room_lamp_2
    effect_targets:
      - light.living_room_lamp_1
      - light.living_room_lamp_2

  - label: Bedroom
    icon: mdi:bed-double
    group: light.bedroom
    lights:
      - label: Light 1
        id: light.bedroom_light_1
      - label: Light 2
        id: light.bedroom_light_2

  - label: Kitchen
    icon: mdi:food
    group: switch.kitchen_lights

  - label: Office
    icon: mdi:desktop-tower-monitor
    group: light.office_group
    lights:
      - label: Ceiling
        id: light.office_ceiling
      - label: Hue Left
        id: light.hue_play_left
        effect_target: light.hue_play_left
      - label: Hue Right
        id: light.hue_play_right
        effect_target: light.hue_play_right
    effect_targets:
      - light.office_ceiling
      - light.hue_play_left
      - light.hue_play_right
```

---

## Configuration Reference

### Card Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `Light Control` | Header label shown above the room grid |
| `columns` | number | `3` | Number of columns in the room tile grid |
| `rooms` | list | required | List of room definitions |

### Room Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `label` | string | yes | Room display name |
| `icon` | string | yes | MDI icon (e.g. `mdi:sofa`) |
| `group` | string | yes | Main entity to control : a light group or `switch.*` entity |
| `lights` | list | no | Individual lights to show inside the expanded panel |
| `effects` | list | no | Override the auto-detected effect list for room-level effects |
| `effect_targets` | list | no | Entity IDs to send room-level effects to. Defaults to `group` if not set. Use this for Hue or other lights that require effects sent to individual entities |

### Light Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `label` | string | yes | Display name for this light |
| `id` | string | yes | Entity ID (e.g. `light.lamp_1`) |
| `effect_target` | string | no | Override entity to send effects to for this individual light (useful for Hue Play bars) |

---

## Notes

### Philips Hue
Hue lights (especially Play bars and gradient strips) require effects to be sent to individual light entities rather than the group. Use `effect_targets` at the room level and `effect_target` on individual lights to handle this.

### Switches
If your `group` entity is a `switch.*`, the card will show a simple on/off toggle with no sliders or effects.

### Individual Lights Section
If a room has only one light and it matches the group entity, you don't need to add it to the `lights` list : the room-level sliders already control it. Add lights to the list only when you want per-light control.

### Effects Auto-Detection
Effects are read directly from each light entity's `effect_list` attribute in real time. No configuration needed. If no effects appear, make sure the light is turned on and supports effects.

---

## Support

- [Open an issue](https://github.com/shadowsight00/aio-light-controller-card/issues)
- [Home Assistant Community Forum](https://community.home-assistant.io)

---

## License

MIT License : see [LICENSE](LICENSE) for details.
