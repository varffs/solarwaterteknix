import "dotenv/config";
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import {
  isVirtualMode, getMode, createSensor, createDisplay, createButton, setupKeyboardListener, cleanupKeyboardListener,
} from "piteknix";

import { loadConfig } from "./src/config.js";
import { appReducer, buttonLeft, buttonRight, setRoomPresent } from "./src/store.js";
import { renderDisplay } from "./src/render.js";
import { pollProbe, pollRoom, detectRoom } from "./src/sensors.js";
import { registerEffects, appStart } from "./src/effects.js";
import { TOPICS, discoveryMessages, statePayload } from "./src/ha.js";
import { createLink } from "./src/mqtt-link.js";

const cfg = loadConfig();
console.log(`solarwaterteknix starting in ${getMode()} mode (probe role: ${cfg.probeRole}, mqtt: ${cfg.mqttUrl ?? "off"})`);

// Hardware (piteknix picks real or virtual)
const probe = await createSensor({ type: "ds18b20", id: cfg.probeId });
const room = isVirtualMode() ? null : await detectRoom(createSensor);
const display = await createDisplay({ type: "oled", width: 128, height: 64, address: 0x3c });
const left = createButton({ gpio: 17, virtualKey: "1" });
const right = createButton({ gpio: 27, virtualKey: "2" });

// The egg: parsed once. Virtual mode shows a text placeholder instead.
const egg = isVirtualMode() ? null : await loadEgg("./assets/egg1.png");

const listener = createListenerMiddleware();
let link = null;
registerEffects(listener, {
  publish: (topic, payload) => link?.publish(topic, payload),
  ackTimeoutMs: cfg.ackTimeoutMs,
  confirmShowMs: cfg.confirmShowMs,
  sleepAfterMs: cfg.sleepAfterMs,
});

// Render on any state change that affects the screen.
listener.startListening({
  predicate: (a, curr, prev) =>
    curr !== prev && ["data/", "sensors/", "display/", "link/", "actions/"].some((p) => a.type.startsWith(p)),
  effect: (_a, api) => renderDisplay(api.getState(), display, { now: Date.now(), egg }),
});
// Screen power follows `awake`; invert follows `inverted`.
listener.startListening({
  predicate: (_a, curr, prev) => curr.display.awake !== prev.display.awake,
  effect: (_a, api) => (api.getState().display.awake ? display.turnOn() : display.turnOff()),
});
listener.startListening({
  predicate: (_a, curr, prev) => curr.display.inverted !== prev.display.inverted,
  effect: (_a, api) => display.invert(api.getState().display.inverted),
});

const store = configureStore({
  reducer: appReducer,
  middleware: (getDefault) => getDefault().prepend(listener.middleware),
});

store.dispatch(setRoomPresent(room !== null));
store.dispatch(appStart());
renderDisplay(store.getState(), display, { now: Date.now(), egg });

if (cfg.mqttUrl) {
  const { default: mqtt } = await import("mqtt");
  link = createLink({
    url: cfg.mqttUrl,
    connect: mqtt.connect,
    dispatch: store.dispatch,
    getDiscovery: () => discoveryMessages({ probeRole: cfg.probeRole, roomPresent: room !== null }),
  });
}

// Poll with an in-flight guard so a hung 1-wire read never overlaps the next tick.
let polling = false;
const pollAll = async () => {
  if (polling) return;
  polling = true;
  try {
    await pollProbe(probe, store.dispatch);
    await pollRoom(room, store.dispatch);
    if (link && store.getState().link.broker) link.publish(TOPICS.state, statePayload(store.getState()));
  } finally {
    polling = false;
  }
};
await pollAll();
const poll = setInterval(pollAll, cfg.pollMs);
// "NN min left" needs a redraw as minutes pass; reducer ignores the tick, the render listener doesn't.
const tick = setInterval(() => store.dispatch({ type: "display/tick" }), 60_000);

if (isVirtualMode()) {
  setupKeyboardListener({ onDebug: () => console.log(JSON.stringify(store.getState(), null, 2)) });
}
left.watch(() => store.dispatch(buttonLeft()));
right.watch(() => store.dispatch(buttonRight(Date.now())));

const shutdown = async () => {
  listener.clearListeners();
  clearInterval(poll);
  clearInterval(tick);
  await link?.end();
  await left.cleanup();
  await right.cleanup();
  await display.cleanup();
  await probe.cleanup();
  await room?.cleanup?.();
  if (isVirtualMode()) cleanupKeyboardListener();
  process.exit();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function loadEgg(path) {
  try {
    const { default: pngparse } = await import("pngparse");
    return await new Promise((resolve, reject) => pngparse.parseFile(path, (err, img) => (err ? reject(err) : resolve(img.data))));
  } catch (e) {
    console.error("egg image failed to load:", e.message);
    return null;
  }
}
