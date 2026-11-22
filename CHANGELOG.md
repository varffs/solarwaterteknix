# Changelog

## 1.0.0 — 2026-11-22

- Rebuilt on piteknix + Redux Toolkit; runs and is tested on the laptop in virtual mode.
- Screen menu: left = next screen, right = "yes"; actions declared in `src/screens.js`.
- MQTT link to Home Assistant with discovery: button event, optional tank and room sensors.
- Boost action: press reports to HA, HA owns the 60-min timer and acks; feedback on screen
  (sending → HA's message, or "No answer from HA"); "HA offline" when broker or HA is down.
- Probe read by configured id (was "first found"); room BME280 actually read (was never);
  screen sleeps after 10 min to slow OLED burn-in.
