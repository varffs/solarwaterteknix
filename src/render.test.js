import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDisplay, actionLines, minutesLeft } from "./render.js";
import { initialState, appReducer, buttonLeft, buttonRight, brokerUp, haStatus, remoteActionState, ack, setProbe, setRoom, setRoomPresent } from "./store.js";

const fakeDisplay = () => {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    texts: () => calls.filter((c) => c[0] === "writeText").map((c) => c[1]),
    clear: rec("clear"), setCursor: rec("setCursor"), writeText: rec("writeText"),
    drawLine: rec("drawLine"), drawBitmap: rec("drawBitmap"), invert: rec("invert"),
  };
};
const run = (...a) => a.reduce(appReducer, initialState);
const at = (screen) => {
  const order = ["WATER", "ROOM", "BOOST", "DATA", "EGG1"];
  return Array.from({ length: order.indexOf(screen) }, buttonLeft);
};
const NOW = Date.parse("2026-11-22T09:00:00Z");
const ready = [brokerUp(true), haStatus("online")];

test("water_screen", () => {
  const d = fakeDisplay();
  renderDisplay(run(setProbe(18.44)), d, { now: NOW, egg: null });
  assert.equal(d.calls[0][0], "clear");
  assert.deepEqual(d.texts(), ["Water", "18.4°c"]);
  const e = fakeDisplay();
  renderDisplay(initialState, e, { now: NOW, egg: null });
  assert.deepEqual(e.texts(), ["Water", "--"]);
});

test("room_screen", () => {
  const d = fakeDisplay();
  renderDisplay(run(setRoomPresent(true), setRoom({ c: 19.06, rh: 55.2 }), ...at("ROOM")), d, { now: NOW, egg: null });
  assert.deepEqual(d.texts(), ["Room", "19.1°c 55%"]);
  const n = fakeDisplay();
  renderDisplay(run(setRoomPresent(false), ...at("ROOM")), n, { now: NOW, egg: null });
  assert.deepEqual(n.texts(), ["Room", "no room sensor"]);
});

test("data_screen", () => {
  const d = fakeDisplay();
  renderDisplay(run(setProbe(18.4), brokerUp(true), haStatus("online"), ...at("DATA")), d, { now: NOW, egg: null });
  const t = d.texts();
  assert.ok(t.includes("Probe: 18.4c"), t.join("|"));
  assert.ok(t.includes("HA: online"));
  assert.ok(t.includes("MQTT: up"));
});

test("egg_screen_bitmap_or_placeholder", () => {
  const d = fakeDisplay();
  renderDisplay(run(...at("EGG1")), d, { now: NOW, egg: [1, 2, 3] });
  assert.ok(d.calls.some((c) => c[0] === "drawBitmap"));
  const v = fakeDisplay();
  renderDisplay(run(...at("EGG1")), v, { now: NOW, egg: null });
  assert.deepEqual(v.texts(), ["(egg)"]);
});

test("action_lines_offline", () => {
  assert.deepEqual(actionLines(initialState, "boost", NOW), ["Boost", "HA offline", ""]);
});

test("action_lines_unavailable", () => {
  const s = run(...ready, remoteActionState("boost", { available: false, reason: "Tank hot" }));
  assert.deepEqual(actionLines(s, "boost", NOW), ["Boost", "Tank hot", "(can't boost)"]);
});

test("unavailable_title_struck_through", () => {
  const d = fakeDisplay();
  renderDisplay(run(...ready, remoteActionState("boost", { available: false, reason: "Tank hot" }), ...at("BOOST")), d, { now: NOW, egg: null });
  assert.ok(d.calls.some((c) => c[0] === "drawLine"));
  const ok = fakeDisplay();
  renderDisplay(run(...ready, remoteActionState("boost", { available: true, active: false }), ...at("BOOST")), ok, { now: NOW, egg: null });
  assert.ok(!ok.calls.some((c) => c[0] === "drawLine"));
});

test("action_lines_idle_and_active", () => {
  const idle = run(...ready, remoteActionState("boost", { available: true, active: false, label: "Idle", detail: "yes = boost 60 min" }));
  assert.deepEqual(actionLines(idle, "boost", NOW), ["Boost", "Idle", "yes = boost 60 min"]);
  const active = run(...ready, remoteActionState("boost", { available: true, active: true, label: "Boosting", finishes_at: "2026-11-22T09:47:00Z" }));
  assert.deepEqual(actionLines(active, "boost", NOW), ["Boost", "Boosting", "47 min left"]);
});

test("finished_in_past_shows_ending", () => {
  const s = run(...ready, remoteActionState("boost", { available: true, active: true, label: "Boosting", finishes_at: "2026-11-22T08:59:00Z" }));
  assert.deepEqual(actionLines(s, "boost", NOW), ["Boost", "Boosting", "Ending..."]);
  assert.equal(minutesLeft("2026-11-22T08:00:00Z", NOW), 0);
  assert.equal(minutesLeft("garbage", NOW), null);
  assert.equal(minutesLeft("2026-11-22T09:59:12Z", NOW), 60);
});

test("feedback_overrides_lines", () => {
  const base = [...ready, remoteActionState("boost", { available: true, active: false }), ...at("BOOST")];
  assert.deepEqual(actionLines(run(...base, buttonRight(1)), "boost", NOW), ["Boost", "Sending...", ""]);
  assert.deepEqual(actionLines(run(...base, buttonRight(1), ack({ request_id: "1", ok: true, message: "Boosting 60 min" })), "boost", NOW),
    ["Boost", "Boosting 60 min", ""]);
});

test("asleep_draws_nothing", () => {
  const d = fakeDisplay();
  renderDisplay({ ...initialState, display: { ...initialState.display, awake: false } }, d, { now: NOW, egg: null });
  assert.equal(d.calls.length, 0);
});
