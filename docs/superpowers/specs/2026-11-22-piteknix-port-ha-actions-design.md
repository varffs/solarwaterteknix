# solarwaterteknix 1.0 — piteknix port + Home Assistant actions (design)

Status: **approved by Patrick 2026-11-22** — pure MVP (1.0).

## Intent

solarwaterteknix is the two-button, one-screen Pi that will live on the immersion
cupboard wall beside the Viessmann solar controller. Today it is a single 334-line
`app.js` from before the `piteknix` library: hard-wired hardware, no tests, can only
run on a real Pi. It shows the water probe on a 128×64 OLED and has an egg picture.

Patrick wants it rebuilt on `piteknix` the way polyteknix was, so it can be developed
and tested on the laptop, and — the core of this MVP — wired into Home Assistant:

1. Its readings appear in Home Assistant.
2. Its buttons can **ask Home Assistant to do things**, starting with an emergency
   immersion boost, so a phone isn't needed at the cupboard.

The hardware was designed as a tiny menu: **left button = next screen, right
button = "yes" to whatever this screen offers.** Some screens only show data; some
are actions (invert the egg; boost; later "run the extractor fan", and whatever
else). The number of actions is meant to be open-ended: adding one should be cheap.

**Logic lives in Home Assistant** (Patrick's decision). The device reports "yes was
pressed on Boost"; HA decides what that means (today: 60-minute boost; later
tariff-aware, solar-aware, whatever) and tells the device what's happening. The
device never switches anything mains and holds no HA credentials.

## Goals

- Port to `piteknix` + Redux Toolkit following `REDUX-SPEC.md` and the hardened
  polyteknix patterns: listener-driven render (no render loop), `loadConfig()` from
  env, pure modules with `node:test` tests, virtual mode on the laptop.
- Screens cycle on the left button; the right button runs the current screen's
  action if it has one.
- Actions are **declared as data** (a list of screen definitions). A new
  HA-backed action = one entry in the device list + HA automation, no new device
  plumbing.
- Talk to HA through the **Mosquitto broker on bigpi** (MQTT), using **MQTT
  discovery** so entities appear in HA with no HA config for the sensors.
- First HA-backed action: **Boost** (approach A: fixed 60 min; pressing "yes" again
  on the Boost screen while active cancels — *Claude's call: a plain second press;
  the piteknix button is edge-only, so a hold would need a library change, and a
  knock that cancels is harmless compared with one that starts*). HA owns the timer and, once the Shelly exists, the switch.
- Clear feedback on every press: sent → confirmed by HA (with HA's message) →
  or "no answer from HA". Actions HA says aren't possible show **crossed out with
  HA's reason** ("Tank hot") and "yes" does nothing but show the reason.
- Fix the old bugs rather than port them: probe by configured ID (not "first
  found"); actually read the room sensor; screen invert driven by state.

## Non-goals (this MVP)

- Any boost logic beyond 60 min / cancel (tariff, solar, tank-temperature cut-offs
  are later HA work; the device already supports them via availability + messages).
- The tank calibration model ("full of hot / warm / cold").
- Extractor fan action (no fan device yet) — the action list makes it a later
  one-entry change.
- Moving oldpi into the cupboard (blocked on the immersion wall job).
- More Pepe screens (easy follow-up when images are supplied).
- History/graphs on the device.

## After 1.0 (rough order, not committed)

- **1.1 — cupboard move:** oldpi on the cupboard wall, `PROBE_ROLE=tank`, retire the
  cron script and the office-log column; Shelly 1PM switching in the boost automation.
- **1.2 — smarter boost (HA only):** tank-hot availability rule, tariff/solar awareness.
- **Extractor fan action** when the fan device exists (one action entry + HA automation).
- More Pepe screens; tank calibration model ("full of hot / warm / cold").

## Anti-goals

- **Breaking the office heating logs.** `sensor.oldpi_oldpi_air_temp` (oldpi's DS18B20
  on the office desk) is a column in `office_log` and `office_profile_log` and a row on
  the Heating dashboard. While oldpi sits on the desk, that entity must keep working
  unchanged.
- A device that can switch the immersion on its own, or that stores an HA token.
- Silent presses: a press that went nowhere must say so.
- Stale state shown as live: if HA or the broker is gone, the screen says so.
- Accidental boosts from a knock. (Mitigated by design: Boost is a dedicated screen;
  you navigate there and press "yes". No hold needed.)

## Constraints

- **Hardware is oldpi**: Raspberry Pi 1 Model B+ (armv6), Node **16.14** (armv6 has
  no newer official builds), pm2 running the old app (`app`, v0.1.0). OLED SSD1306
  128×64 on I²C 0x3c; buttons on GPIO 17 (left) and 27 (right), rising edge, 50 ms
  debounce. DS18B20 probe `28-0822b1d75b31`. BME280 is listed in the old
  dependencies but never read; whether one is fitted is **unknown** — must be
  optional.
- Every dependency must run on Node 16 / armv6 (pin versions accordingly; polyteknix
  already runs piteknix + RTK 2 on Node 16).
- Broker: Mosquitto on bigpi, port 1883, anonymous on the LAN (pre-existing). Anyone
  on the Wi-Fi could therefore publish a fake press; accepted, same as today.
- `bigpi.local` resolution is flaky from some hosts; the broker address comes from
  config (`MQTT_URL`), default `mqtt://bigpi.local`, overridable to the IP.
- The OLED has burn-in; nothing to design around beyond avoiding a static screen
  for hours (see screen sleep below).
- Repo: `~/Sites/worldofpi/solarwaterteknix` → `github.com/varffs/solarwaterteknix`.
  Branch choice confirmed with Patrick at commit time.

## Approaches considered

1. **The app speaks MQTT directly (chosen).** One process: sensors, screen, buttons,
   MQTT. Discovery makes the entities; HA sends state back on retained topics.
   No credentials on the device; HA holds the logic.
2. HA REST API with a long-lived token on the Pi. Rejected: a token in a cupboard
   Pi, and the device would need to know HA entity ids — coupling the wrong way.
3. Keep a cron script for readings (oldpi's current pattern), app for screen/buttons.
   Rejected: two programs for one device, no clean path for presses and state back.

## Design

### Screens and actions

A screen definition:

```js
{ id: "BOOST", kind: "action", title: "Boost", action: { type: "ha", id: "boost" } }
{ id: "EGG1",  kind: "action", title: "Egg",   action: { type: "local", id: "invert" } }
{ id: "WATER", kind: "info" }
```

Initial list, in cycle order: `WATER` (big probe temperature), `ROOM` (temp + RH,
or "no room sensor"), `BOOST` (HA action), `DATA` (all values + connection
status), `EGG1` (local action: invert). Left wraps around.

Right button:
- info screen → nothing (no-op).
- local action → done on the device (invert).
- HA action → if the broker is disconnected or HA hasn't published state for that
  action: show "HA offline", send nothing. If HA says unavailable: show the reason,
  send nothing. Otherwise publish the press (below) and show **Sending…**.

Action screen render (sketch, 128×64):

```
 Boost                    Boost                    B̶o̶o̶s̶t̶
 Idle                     ✓ Boosting                Tank hot
 yes = boost 60 min       47 min left               (can't boost)
```

Feedback state per HA action, in Redux: `idle | sending | confirmed | failed`.
`sending` → `confirmed` when HA's ack for that request id arrives (shows HA's
`message` for 4 s, then the action's live state); → `failed` ("No answer from HA")
after 8 s without an ack.

### MQTT contract

Device id `solarwaterteknix`; discovery prefix `homeassistant`.

Device → HA:
- `solarwater/status` — `online` on connect (retained), `offline` as Last Will
  (retained). All discovered entities use it as `availability_topic`.
- `solarwater/state` — JSON `{ "probe_c": 18.4, "room_c": 19.1, "room_rh": 55 }`,
  every poll (30 s, as today). Missing readings are `null`.
- Discovery configs (retained), published on every connect:
  - `sensor` **Tank temperature** from `probe_c` — **only when `PROBE_ROLE=tank`**.
    While oldpi is on the desk (`PROBE_ROLE=desk`, the default), the existing cron
    script keeps publishing `sensor.oldpi_oldpi_air_temp` untouched and the app does
    not publish a probe entity at all (avoids a "tank" sensor that reads room air).
  - `sensor` **Room temperature** / **Room humidity** — only if a BME280 answered at
    start.
  - `event` **Button** — `solarwater/action`, `event_types` = the HA action ids
    (`["boost"]`). Payload `{"event_type":"boost","request_id":"<n>"}`; the
    request id rides along as an event attribute.

HA → device:
- `solarwater/actions/<id>` — retained JSON the device renders:
  `{ "available": true, "active": false, "label": "Idle", "detail": "yes = boost 60 min" }`
  or `{ "available": false, "reason": "Tank hot" }`.
- `solarwater/ack` — not retained:
  `{ "request_id": "<n>", "ok": true, "message": "Boosting 60 min" }`.

### Home Assistant side (written by Claude into bigpi's config, reloaded via the admin token)

Claude has an admin HA token (created 2026-11-21, held in 1Password; read per
command with `op read --account my.1password.com "op://Personal/Claude Home
Assistant Token/credential"`, never stored). So the HA work is: back up the YAML,
add the timer + automations, `check_config`, then call `timer.reload` and
`automation.reload` through the API — no HA restart. If a config write on bigpi is
refused by the permission system, fall back to a staged `install.sh` Patrick runs.
The token never goes on the device.

- `timer.immersion_boost`, duration 60 min (restore on restart).
- Automation **solarwater boost button**: trigger on the button event entity's
  **state** (a timestamp) — never on its `event_type` attribute (attribute triggers
  miss two identical presses in a row; known HA lesson, see `CLAUDE.md` 2026-08-25) —
  condition `event_type == boost`. If the timer is active → cancel, ack "Boost
  cancelled"; else start, ack "Boosting 60 min".
- Automation **solarwater boost state**: on timer start / finish / cancel and on HA
  start, publish `solarwater/actions/boost` (retained) with `active`, `label`, and
  `detail` ("NN min left" is computed by the device from a `finishes_at` field to
  avoid per-minute publishes — so the state JSON also carries
  `"finishes_at": "<ISO>"` when active).
- **Until the Shelly 1PM is installed**, starting a boost sends a phone notification
  ("Boost requested at the cupboard — no immersion switch fitted yet") and the ack
  says the same. When the Shelly lands, the automation switches it on at start and
  off at finish/cancel — an HA-only change.
- Availability rule: `available: true` for now. A tank-hot rule is later HA work.

### Offline and faults

- **HA down but broker up** (*Claude's call*): the device also subscribes to HA's own
  birth/will topic `homeassistant/status` (`online`/`offline`, retained). While it
  is `offline` (or never seen), HA-backed actions render "HA offline" and retained
  action state is not shown as live — so a stale "Boosting" can't linger.
- MQTT library auto-reconnects; while disconnected the device keeps sensing and
  displaying, `DATA` shows "HA: offline", HA actions show "HA offline".
- Probe missing/erroring → `--` and a short reason on `DATA`, as polyteknix does
  (reuse piteknix `diagnose`).
- Screen sleep: after 10 min without a press, the display turns off; any press
  wakes it (first press only wakes). Slows the burn-in. *(Builder may tune timing.)*

### Config (env via `.env`, validated in `loadConfig`)

`MQTT_URL` (default `mqtt://bigpi.local`; unset in virtual mode = MQTT off),
`PROBE_ID` (default `28-0822b1d75b31`), `PROBE_ROLE` (`desk` | `tank`, default
`desk`), `VIRTUAL_MODE`. Poll interval 30 s.

### Testing

- `node:test`, pure modules: reducer (screen cycling, action feedback states,
  timeouts via injected clock), render (per screen, into a fake display), MQTT
  contract (topic + payload builders, discovery configs, parsing of HA state/ack,
  including bad JSON ignored), config validation.
- MQTT behind a small adapter so tests inject a fake client; virtual mode runs with
  MQTT off unless `MQTT_URL` is set (so the laptop can also talk to the real broker
  for an end-to-end try).
- End-to-end before calling it done: on the laptop against the real broker, press
  Boost in virtual mode → HA logbook shows the event, timer starts, phone notified,
  device shows "✓ Boosting / 60 min left"; press again → cancelled. Then stop HA's
  `homeassistant/status` (simulate by publishing `offline` to a test copy of the
  topic in virtual mode) → Boost shows "HA offline".

### Deploy / migration

- Same pm2 pattern as polyteknix (`ecosystem.config.cjs`), replacing the old `app`
  process on oldpi. `.env` on the device, never committed.
- `PROBE_ROLE=desk` on deploy; the cron script stays. At the cupboard move (later):
  set `PROBE_ROLE=tank`, remove the cron line, drop the oldpi column from the two
  office log commands (or point it elsewhere) — a separate, deliberate step.
- Version 1.0.0, CHANGELOG, README updated.

## Left to the builder

(Also settled by Claude after the builder check: piteknix declares `engines >=18`
but already runs on Node 16 under polyteknix — keep Node 16 and pin deps that
support it; the egg screen in virtual mode renders a text placeholder; probe the
BME280 at both 0x76 and 0x77; minutes-left computed from `finishes_at` using the
Pi's NTP clock; notification target taken from the existing HA notify service.)

Module layout (mirror polyteknix), exact MQTT client library and version (must
support Node 16), font sizes and pixel layout, debounce/ack timings within the
stated values, how the egg PNG is loaded, whether `DATA` is one or two screens.
