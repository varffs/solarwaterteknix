# solarwaterteknix 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild solarwaterteknix on piteknix + Redux Toolkit with a declarative screen/action menu and an MQTT link to Home Assistant, first action = 60-min immersion Boost owned by HA.

**Architecture:** Pure modules (config, store, screens, ha contract, render, sensors) tested with `node:test`; `app.js` wires piteknix hardware, the store, listener middleware (render on change, publish presses, ack timeouts, sleep) and an MQTT adapter. HA side is a timer + two automations installed on bigpi and reloaded via the admin token.

**Tech Stack:** Node 16 (oldpi, armv6), ESM, `@reduxjs/toolkit` ^2.11.2, `piteknix` github:varffs/piteknix#v0.1.1, `mqtt` 5.16.1, `dotenv` ^16.4.0, `pngparse` ^2.0.1, pm2.

**Spec:** `docs/superpowers/specs/2026-11-22-piteknix-port-ha-actions-design.md`

## Global Constraints

- Runs on Node 16.14 / armv6 (Raspberry Pi 1 B+, host `oldpi`); every dependency must declare/support Node 16.
- Follow `~/Sites/worldofpi/REDUX-SPEC.md` and polyteknix patterns: listener-driven render, no render loop, `loadConfig(env)` pure, `NODE_ENV=production` in `ecosystem.config.cjs`.
- Hardware: OLED SSD1306 128×64 I²C 0x3c bus 1; left button GPIO 17, right button GPIO 27 (rising, 50 ms debounce, virtual keys "1" and "2"); DS18B20 `28-0822b1d75b31`; BME280 optional at 0x76 or 0x77.
- Env: `MQTT_URL` (default `mqtt://bigpi.local`; in virtual mode unset = MQTT off), `PROBE_ID` (default `28-0822b1d75b31`), `PROBE_ROLE` `desk|tank` (default `desk`), `VIRTUAL_MODE`.
- Poll 30 s. Ack timeout 8 s. Confirmed message shown 4 s. Screen sleep after 10 min without a press; a press while asleep only wakes.
- Topics: `solarwater/status` (online/offline, retained, LWT), `solarwater/state`, `solarwater/action`, `solarwater/actions/<id>` (from HA, retained), `solarwater/ack` (from HA), `homeassistant/status` (HA birth/will), discovery under `homeassistant/`. Device id `solarwaterteknix`.
- Probe entity published **only when `PROBE_ROLE=tank`**. Never touch oldpi's cron script `~/ha-airtemp-pub.sh` or `sensor.oldpi_oldpi_air_temp`.
- No HA token on the device, ever. Admin token on the Mac only via `op read --account my.1password.com "op://Personal/Claude Home Assistant Token/credential"`, never printed or written.
- Confirm the git branch with Patrick before the first commit.

## Review Focus

1. A late ack for an older request arrives after a newer press → must be ignored (feedback stays on the newer request). *Test in Task 2.*
2. Retained boost state whose `finishes_at` is already in the past (HA restarted, stale retained) → render "Ending…" never negative minutes. *Test in Task 4.*
3. Broker reconnect → discovery, `online` and subscriptions re-sent every connect, not only the first. *Test in Task 5.*
4. Right press while asleep → wakes only; no publish, no invert. *Test in Task 2.*
5. Malformed or partial JSON from HA (`{}`, `"x"`, missing `available`) → ignored or defaulted, never throws, previous state kept. *Test in Task 3.*

---

### Task 1: Scaffold + config

**Files:**
- Modify: `package.json` (name, version `1.0.0`, `"scripts": {"start": "node app.js", "dev": "VIRTUAL_MODE=true node app.js", "test": "node --test 'src/**/*.test.js'"}`, deps above; drop `bme280-sensor`, `ds18b20`, `i2c-bus`, `oled-*`, `onoff` — piteknix brings them)
- Create: `ecosystem.config.cjs` (copy polyteknix's, `name: "solarwaterteknix"`), `.gitignore` (`node_modules`, `.env`), `.env.example`
- Create: `src/config.js`, `src/config.test.js`
- Move: `app.js` → `legacy/app.js` (kept for reference until Task 6 replaces it)

**Interfaces:**
- Produces: `loadConfig(env = process.env) → { mqttUrl: string|null, probeId: string, probeRole: 'desk'|'tank', pollMs: 30000, ackTimeoutMs: 8000, confirmShowMs: 4000, sleepAfterMs: 600000, isVirtual: boolean }`

- [ ] **Step 1: Failing tests** in `src/config.test.js`:
  - `defaults_hardware`: `loadConfig({})` → `mqttUrl === 'mqtt://bigpi.local'`, `probeId === '28-0822b1d75b31'`, `probeRole === 'desk'`, `pollMs === 30000`.
  - `virtual_without_url_disables_mqtt`: `loadConfig({VIRTUAL_MODE:'true'}).mqttUrl === null`; with `MQTT_URL:'mqtt://x'` → `'mqtt://x'`.
  - `rejects_bad_role`: `PROBE_ROLE:'attic'` throws `/PROBE_ROLE/`.
- [ ] **Step 2:** `npm install`, then `npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement `loadConfig`.
- [ ] **Step 4:** `npm test` → PASS. `npm ls mqtt` shows 5.16.1.
- [ ] **Step 5: Commit** `chore: scaffold 1.0 on piteknix, add config`.

### Task 2: Screens + store

**Files:**
- Create: `src/screens.js`, `src/store.js`, `src/store.test.js`

**Interfaces:**
- Produces (`screens.js`): `SCREENS` = ordered array `[{id:'WATER',kind:'info'},{id:'ROOM',kind:'info'},{id:'BOOST',kind:'action',title:'Boost',action:{type:'ha',id:'boost'}},{id:'DATA',kind:'info'},{id:'EGG1',kind:'action',title:'Egg',action:{type:'local',id:'invert'}}]`; `haActionIds() → ['boost']`.
- Produces (`store.js`): `initialState`, `appReducer`, action creators:
  `buttonLeft()`, `buttonRight(now: number)`, `sleep()`, `setProbe(c|null)`, `setProbeStatus({status, detail})`, `setRoom({c, rh}|null)`, `setRoomPresent(bool)`, `brokerUp(bool)`, `haStatus('online'|'offline')`, `remoteActionState(id, obj)`, `ack({request_id, ok, message})`, `ackTimeout(id, requestId)`, `clearFeedback(id, requestId)`.
- State: `{ data:{probe_c, room_c, room_rh}, sensors:{probe_status, probe_detail, room_present}, display:{screen:'WATER', inverted:false, awake:true}, link:{broker:false, ha:'unknown'}, actions:{ boost:{ remote:null, feedback:{phase:'idle', requestId:null, message:null} } } }`.
- Selector: `canSend(state, id) → {ok:true} | {ok:false, reason:'HA offline'|string}` — not ok when `!link.broker || link.ha !== 'online' || remote === null`; `remote.available === false` → its `reason`.
- Right on an HA action screen with `canSend.ok` → feedback `{phase:'sending', requestId:String(now), message:null}`; otherwise feedback `{phase:'failed', requestId:null, message:reason}`.

- [ ] **Step 1: Failing tests** (`src/store.test.js`):
  - `left_cycles_and_wraps`: five `buttonLeft()` from WATER → back to WATER, passing BOOST third.
  - `right_on_info_noop`; `right_on_egg_inverts` (toggles `display.inverted`).
  - `right_on_boost_sends_when_ha_ready`: with `brokerUp(true)`, `haStatus('online')`, `remoteActionState('boost',{available:true,active:false})`, screen BOOST, `buttonRight(1000)` → phase `sending`, requestId `'1000'`.
  - `right_on_boost_offline`: no `haStatus('online')` → phase `failed`, message `'HA offline'`.
  - `right_on_boost_unavailable_shows_reason`: remote `{available:false, reason:'Tank hot'}` → `failed`, `'Tank hot'`.
  - `ack_confirms_matching_request` → phase `confirmed`, message from ack. **Review Focus 1:** `late_ack_for_old_request_ignored`: press at 1000, press at 2000, ack `request_id:'1000'` → still `sending` with `'2000'`.
  - `ack_timeout_only_for_current_request`: `ackTimeout('boost','1000')` after a newer press is ignored; matching → `failed`, `'No answer from HA'`.
  - `clear_feedback_returns_idle` (matching requestId only).
  - **Review Focus 4:** `press_while_asleep_only_wakes`: `sleep()` then `buttonRight(5)` on EGG1 → `awake:true`, `inverted` unchanged; same for `buttonLeft` (screen unchanged).
  - `ha_offline_hides_remote_as_live`: `haStatus('offline')` → `canSend` reason `'HA offline'`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: screen menu and store`.

### Task 3: HA contract (topics, discovery, parsing)

**Files:**
- Create: `src/ha.js`, `src/ha.test.js`

**Interfaces:**
- Consumes: `haActionIds()`; action creators from Task 2.
- Produces:
  - `TOPICS = {status:'solarwater/status', state:'solarwater/state', action:'solarwater/action', actionState:(id)=>\`solarwater/actions/${id}\`, ack:'solarwater/ack', haStatus:'homeassistant/status'}`
  - `discoveryMessages({probeRole, roomPresent}) → [{topic, payload: string, retain:true}]` — always the `event` (`homeassistant/event/solarwaterteknix/button/config`, `event_types: haActionIds()`, `state_topic: solarwater/action`, `availability_topic: solarwater/status`, `unique_id: solarwaterteknix_button`); tank sensor (`unique_id: solarwaterteknix_tank`, `value_template: "{{ value_json.probe_c }}"`, `device_class: temperature`, `unit_of_measurement: "°C"`, `state_class: measurement`) only if `probeRole==='tank'`; room temp + RH (`solarwaterteknix_room_t`, `solarwaterteknix_room_rh`) only if `roomPresent`. All share `device: {identifiers:['solarwaterteknix'], name:'solarwaterteknix', manufacturer:'piteknix', model:'Raspberry Pi 1 B+'}`.
  - `statePayload(state) → string` JSON `{probe_c, room_c, room_rh}` (numbers rounded 0.1 or `null`).
  - `pressPayload(id, requestId) → string` JSON `{event_type:id, request_id:requestId}`.
  - `subscriptions() → [TOPICS.ack, TOPICS.haStatus, ...haActionIds().map(TOPICS.actionState)]`.
  - `incomingToAction(topic, payloadString) → ReduxAction | null`.
- [ ] **Step 1: Failing tests:** discovery counts (desk+no room = 1 message; tank+room = 4); event config has `event_types:['boost']`; `statePayload` rounds 18.444 → 18.4 and keeps `null`; `incomingToAction('homeassistant/status','online')` → `haStatus('online')`; `incomingToAction('solarwater/actions/boost', '{"available":true,"active":true,"finishes_at":"2026-11-22T10:00:00Z"}')` → `remoteActionState`; **Review Focus 5:** `malformed_incoming_ignored`: payloads `'x'`, `'{}'` on ack (no `request_id`), `'[]'` on action state, unknown topic → `null`; action state missing `available` → defaulted `available:true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: MQTT contract with Home Assistant`.

### Task 4: Render

**Files:**
- Create: `src/render.js`, `src/render.test.js`; copy `assets/egg1.png` stays.

**Interfaces:**
- Consumes: state shape (Task 2), `SCREENS`.
- Produces: `renderDisplay(state, display, {now, egg}) → void` where `display` is a piteknix OLED (`clear()`, `setCursor(x,y)`, `writeText(text,{size})` or `writeString(font,size,text)`, `drawLine`, `drawBitmap(data)`, `invert(bool)`); `egg` = pre-parsed bitmap data or `null` (virtual: text placeholder `"(egg)"`). Pure helper `actionLines(state, id, now) → [title, line2, line3]` and `minutesLeft(finishesAtIso, now) → number|null`.
- Action screen lines (exact copy):
  - offline/no remote: `["Boost","HA offline",""]`
  - unavailable: title struck through (draw a line across it), `[ "Boost", reason, "(can't boost)" ]`
  - idle: `["Boost","Idle","yes = boost 60 min"]`
  - active: `["Boost","Boosting", "<n> min left"]`; past `finishes_at` → `"Ending..."`
  - feedback overrides line 2/3: sending `"Sending..."`; confirmed `message`; failed `message`.
- WATER: `"Water"` + big `"<t>°c"` (`"--"` when null). ROOM: temp & RH or `"no room sensor"`. DATA: probe, room, `"HA: online|offline|unknown"`, `"MQTT: up|down"`, probe status detail when not ok.
- [ ] **Step 1: Failing tests** with a recording fake display: each screen's text; `actionLines` cases above; **Review Focus 2:** `finished_in_past_shows_ending` (`minutesLeft` ≤ 0 → `"Ending..."`, never negative); `minutesLeft` rounds up (59.2 → 60).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: OLED rendering for screens and actions`.

### Task 5: Sensors + MQTT adapter

**Files:**
- Create: `src/sensors.js`, `src/sensors.test.js`, `src/mqtt-link.js`, `src/mqtt-link.test.js`

**Interfaces:**
- Produces (`sensors.js`): `pollProbe(sensor, dispatch)` (polyteknix `pollExternal` semantics: 85.0 → diagnose; error → `setProbe(null)` + status); `pollRoom(sensor|null, dispatch)` (null sensor → no-op); `detectRoom(createSensor) → Promise<sensor|null>` trying `{type:'bme280', address:0x76}` then `0x77`, a sensor counts only if one `read()` succeeds.
- Produces (`mqtt-link.js`): `createLink({url, connect, dispatch, getDiscovery}) → {publish(topic, payload, opts), end()}` where `connect` is injectable (`mqtt.connect` in app). On every `connect` event: publish `online` retained to `TOPICS.status`, all `getDiscovery()` messages, subscribe `subscriptions()`, dispatch `brokerUp(true)`. On `close`/`offline`: `brokerUp(false)`. On `message`: `incomingToAction` → dispatch if non-null. Connect options: `will: {topic: TOPICS.status, payload: 'offline', retain: true}`, `reconnectPeriod: 5000`, `clientId: 'solarwaterteknix'`.
- [ ] **Step 1: Failing tests:** sensors (85 → diagnose path; null room sensor no-op; `detectRoom` returns null when both reads throw, the 0x77 sensor when only it reads). Link with a fake EventEmitter client: **Review Focus 3:** `reconnect_republishes`: emit `connect` twice → `online` + discovery published twice and subscribe called twice; `close` → `brokerUp(false)`; message routing; will set.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: sensor polling and MQTT link`.

### Task 6: Wire app.js

**Files:**
- Create: `app.js` (replaces legacy), `src/effects.js`, `src/effects.test.js`
- Delete: `legacy/app.js`

**Interfaces:**
- Consumes: all above.
- Produces (`effects.js`): `registerEffects(listener, {publish, ackTimeoutMs, confirmShowMs, sleepAfterMs})`:
  - feedback phase → `sending` (new requestId): `publish(TOPICS.action, pressPayload(id, requestId))`, then `await api.delay(ackTimeoutMs)`; dispatch `ackTimeout(id, requestId)`.
  - phase → `confirmed` or `failed`: `await api.delay(confirmShowMs)`; `clearFeedback(id, requestId)`.
  - any button action: cancel previous sleep wait, `await api.delay(sleepAfterMs)`, dispatch `sleep()` (use `cancelActiveListeners`, as polyteknix `backlight.js`).
- `app.js`: piteknix `createSensor({type:'ds18b20', id})`, `detectRoom`, `createDisplay({type:'oled', width:128, height:64, address:0x3c})`, `createButton({gpio:17, virtualKey:'1'})`, `createButton({gpio:27, virtualKey:'2'})`; listener renders on `data/ sensors/ display/ link/ actions/` prefixes and on a 60 s tick while an active boost is shown (minutes left); display wake/sleep → `turnOn/turnOff`; `inverted` change → `invert`; poll with in-flight guard; publish `statePayload` after each poll when broker up; MQTT only when `cfg.mqttUrl`; SIGINT/SIGTERM cleanup (end link → buttons → display off).
- [ ] **Step 1: Failing tests** (`effects.test.js`, real store + listener, `ackTimeoutMs: 20`, `confirmShowMs: 20`, `sleepAfterMs: 50`): press publishes exactly one message with the requestId; no ack → `failed` then back to `idle`; ack → `confirmed` then `idle`; two presses → only the latest times out; sleep fires after inactivity and is re-armed by a press.
- [ ] **Step 2:** FAIL. **Step 3:** Implement effects + `app.js`.
- [ ] **Step 4:** `npm test` → PASS. Then `npm run dev` for ~10 s: terminal OLED shows WATER; keys `1` cycle through all five screens; `2` on EGG1 inverts; `2` on BOOST shows `HA offline`. Ctrl-C exits cleanly.
- [ ] **Step 5: Commit** `feat: app wiring with effects`.

### Task 7: Home Assistant side

**Files (on bigpi, `~/ha/homeassistant/`; backups `*.bak-20261122`):**
- Modify: `configuration.yaml` — add `timer: immersion_boost: {name: "Immersion boost", duration: "01:00:00", restore: true}`.
- Modify: `automations.yaml` — append two automations:
  - id `solarwater_boost_button`, alias "solarwater: boost button": trigger `platform: state`, `entity_id: event.solarwaterteknix_button` (confirm real id after discovery), `not_from: [unknown, unavailable]`; condition template `trigger.to_state.attributes.event_type == 'boost'`; action `choose`: timer active → `timer.cancel` + `mqtt.publish` ack `{"request_id": "<attr request_id>", "ok": true, "message": "Boost cancelled"}`; else `timer.start` + `notify.mobile_app_dj_pato` ("Boost requested at the cupboard — no immersion switch fitted yet") + ack `"Boosting 60 min"`.
  - id `solarwater_boost_state`, alias "solarwater: boost state": triggers `timer.immersion_boost` state change, `homeassistant` start, and `mqtt` topic `solarwater/status` payload `online`; action `mqtt.publish` retained to `solarwater/actions/boost`: active → `{"available":true,"active":true,"label":"Boosting","finishes_at":"<timer finishes_at>"}`, else `{"available":true,"active":false,"label":"Idle","detail":"yes = boost 60 min"}`.
- [ ] **Step 1:** Back up both files; append; `docker exec homeassistant python -m homeassistant --script check_config -c /config` → no errors.
- [ ] **Step 2:** Via API with the admin token: `POST /api/services/timer/reload`, `POST /api/services/automation/reload` → 200. `GET /api/states/timer.immersion_boost` → `idle`. (If the timer domain wasn't loaded before and reload can't create it, one `docker restart homeassistant` — tell Patrick first.)
- [ ] **Step 3:** Publish `online` to `solarwater/status` from the Mac test client → retained `solarwater/actions/boost` appears with `active:false` (`mosquitto_sub -h 192.168.1.72 -t 'solarwater/#' -v -C 1` or a node one-liner with `mqtt`).
- [ ] **Step 4:** Record in `PiTeknix/CLAUDE.md` State: what was added, backups, untested-on-device status.

### Task 8: End-to-end, deploy, docs

**Files:**
- Modify: `README.md` (what it is, screens, buttons, MQTT topics, HA entities, env, deploy), create `CHANGELOG.md` (1.0.0).

- [ ] **Step 1: E2E on the laptop:** `MQTT_URL=mqtt://192.168.1.72 npm run dev`. HA shows device `solarwaterteknix` with the button event entity (no tank/room entities in desk mode, no BME on the laptop). BOOST screen → `Idle`. Press `2` → `Sending...` → `Boosting 60 min` within 8 s; phone notification; `timer.immersion_boost` active; screen `Boosting / 60 min left`. Press `2` again → `Boost cancelled`, timer idle. Kill the app (Ctrl-C and, separately, `kill -9`) → `solarwater/status` reads `offline` both times (graceful end + Last Will). Never publish to `homeassistant/status` by hand — it's HA's real birth/will topic; "HA offline" handling is proven by the Task 2/3 tests.
- [ ] **Step 2: Deploy to oldpi:** `ssh oldpi` → stop old `app` (`pm2 delete app`), `git pull` (or clone) into `~/code/solarwaterteknix`, `npm ci --omit=dev`, `.env` with `MQTT_URL=mqtt://192.168.1.72` and `PROBE_ROLE=desk`, `pm2 startOrReload ecosystem.config.cjs && pm2 save`. Check `pm2 logs solarwaterteknix --lines 30` clean; HA device online; cron line still in `crontab -l`; `sensor.oldpi_oldpi_air_temp` still updating.
- [ ] **Step 3:** Ask Patrick to press through the screens on the real device and try Boost once (hardware: OLED address, button pins, BME presence are only provable there).
- [ ] **Step 4: Commit** `docs: 1.0.0 README and CHANGELOG`; tag `v1.0.0`; push.
