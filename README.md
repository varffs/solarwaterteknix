# solarwaterteknix

Two buttons, one screen, on the immersion cupboard wall: shows the hot-water
tank (and room) temperature, and lets you ask Home Assistant to do things —
starting with an emergency immersion **Boost** — without a phone.

Runs on `oldpi` (Raspberry Pi 1 B+, Node 16) on [piteknix](https://github.com/varffs/piteknix)
+ Redux Toolkit. Develop on the laptop in virtual mode: `npm run dev`
(keys `1` = left, `2` = right, `d` = dump state, `q` = quit).

## Buttons and screens

- **Left** — next screen. **Right** — "yes" to whatever this screen offers.
- A press while the screen is asleep (10 min idle) only wakes it.

| Screen | Shows | Right ("yes") |
|---|---|---|
| WATER | probe temperature | — |
| ROOM | BME280 temp + RH, or "no room sensor" | — |
| BOOST | what Home Assistant says Boost is doing | asks HA to start / cancel |
| DATA | all readings, HA and MQTT link state | — |
| EGG1 | Pepe | invert the screen |

Add a screen/action in `src/screens.js` (comment there explains local vs HA actions).

## Home Assistant

Talks MQTT to Mosquitto on bigpi. The device decides nothing: it reports a
press, HA's automations decide what it means and send back state + an ack.
The device holds no HA credentials.

| Topic | Direction | |
|---|---|---|
| `solarwater/status` | device → | `online` / `offline` (retained, Last Will) |
| `solarwater/state` | device → | `{"probe_c", "room_c", "room_rh"}` every 30 s |
| `solarwater/action` | device → | `{"event_type": "boost", "request_id"}` → `event.solarwaterteknix_button` |
| `solarwater/actions/<id>` | → device | retained `{"available", "active", "label", "detail", "reason", "finishes_at"}` |
| `solarwater/ack` | → device | `{"request_id", "ok", "message"}` |
| `homeassistant/status` | → device | HA's own birth/will; "HA offline" when not `online` |

Entities come from MQTT discovery: the button event always; **Tank temperature**
only with `PROBE_ROLE=tank`; room temperature/humidity only if a BME280 answers
(0x76 or 0x77). HA side: `timer.immersion_boost` (60 min) and automations
`solarwater_boost_button` / `solarwater_boost_state` on bigpi.

## Config (`.env`, see `.env.example`)

- `MQTT_URL` — default `mqtt://bigpi.local`; in virtual mode MQTT is off unless set.
- `PROBE_ID` — DS18B20 id, default `28-0822b1d75b31`.
- `PROBE_ROLE` — `desk` (default) while oldpi sits on the office desk: the probe
  stays published by oldpi's cron script as `sensor.oldpi_oldpi_air_temp`, which
  the office heating logs use. `tank` once on the cupboard wall.

## Deploy (oldpi)

```
cd ~/code/solarwaterteknix && git pull && npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs && pm2 save
```

`NODE_ENV=production` is set in `ecosystem.config.cjs` on purpose (RTK dev checks are slow on a Pi 1).

## Tests

`npm test` (node:test, no hardware needed).
