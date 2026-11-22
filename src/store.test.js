import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState, appReducer, buttonLeft, buttonRight, sleep, brokerUp, haStatus,
  remoteActionState, ack, ackTimeout, clearFeedback, canSend,
} from "./store.js";
import { SCREENS, haActionIds } from "./screens.js";

const run = (...actions) => actions.reduce(appReducer, initialState);
const toScreen = (id) => {
  const n = SCREENS.findIndex((s) => s.id === id);
  return Array.from({ length: n }, () => buttonLeft());
};
const haReady = [brokerUp(true), haStatus("online"), remoteActionState("boost", { available: true, active: false })];
const fb = (s) => s.actions.boost.feedback;

test("screens_declared", () => {
  assert.deepEqual(SCREENS.map((s) => s.id), ["WATER", "ROOM", "BOOST", "DATA", "EGG1"]);
  assert.deepEqual(haActionIds(), ["boost"]);
});

test("left_cycles_and_wraps", () => {
  assert.equal(run(...toScreen("BOOST")).display.screen, "BOOST");
  assert.equal(run(...Array.from({ length: 5 }, buttonLeft)).display.screen, "WATER");
});

test("right_on_info_noop", () => {
  const s = run(buttonRight(1));
  assert.equal(s.display.screen, "WATER");
  assert.deepEqual(s.actions, initialState.actions);
  assert.equal(s.display.inverted, false);
});

test("right_on_egg_inverts", () => {
  assert.equal(run(...toScreen("EGG1"), buttonRight(1)).display.inverted, true);
  assert.equal(run(...toScreen("EGG1"), buttonRight(1), buttonRight(2)).display.inverted, false);
});

test("right_on_boost_sends_when_ha_ready", () => {
  const s = run(...haReady, ...toScreen("BOOST"), buttonRight(1000));
  assert.equal(fb(s).phase, "sending");
  assert.equal(fb(s).requestId, "1000");
});

test("right_on_boost_offline", () => {
  const s = run(brokerUp(true), remoteActionState("boost", { available: true }), ...toScreen("BOOST"), buttonRight(1000));
  assert.equal(fb(s).phase, "failed");
  assert.equal(fb(s).message, "HA offline");
});

test("right_on_boost_unavailable_shows_reason", () => {
  const s = run(brokerUp(true), haStatus("online"), remoteActionState("boost", { available: false, reason: "Tank hot" }),
    ...toScreen("BOOST"), buttonRight(1000));
  assert.equal(fb(s).phase, "failed");
  assert.equal(fb(s).message, "Tank hot");
});

test("ack_confirms_matching_request", () => {
  const s = run(...haReady, ...toScreen("BOOST"), buttonRight(1000), ack({ request_id: "1000", ok: true, message: "Boosting 60 min" }));
  assert.equal(fb(s).phase, "confirmed");
  assert.equal(fb(s).message, "Boosting 60 min");
});

test("ack_not_ok_fails_with_message", () => {
  const s = run(...haReady, ...toScreen("BOOST"), buttonRight(1000), ack({ request_id: "1000", ok: false, message: "Nope" }));
  assert.equal(fb(s).phase, "failed");
  assert.equal(fb(s).message, "Nope");
});

test("late_ack_for_old_request_ignored", () => {
  // first press times out, second is sent, then the first's ack straggles in
  const s = run(...haReady, ...toScreen("BOOST"), buttonRight(1000), ackTimeout("boost", "1000"), buttonRight(2000),
    ack({ request_id: "1000", ok: true, message: "old" }));
  assert.equal(fb(s).phase, "sending");
  assert.equal(fb(s).requestId, "2000");
});

test("ack_timeout_only_for_current_request", () => {
  const base = [...haReady, ...toScreen("BOOST"), buttonRight(1000), ackTimeout("boost", "1000"), buttonRight(2000)];
  assert.equal(fb(run(...base, ackTimeout("boost", "1000"))).phase, "sending");
  const s = run(...base, ackTimeout("boost", "2000"));
  assert.equal(fb(s).phase, "failed");
  assert.equal(fb(s).message, "No answer from HA");
});

test("clear_feedback_returns_idle", () => {
  const sent = [...haReady, ...toScreen("BOOST"), buttonRight(1000), ack({ request_id: "1000", ok: true, message: "ok" })];
  assert.equal(fb(run(...sent, clearFeedback("boost", "999"))).phase, "confirmed");
  assert.deepEqual(fb(run(...sent, clearFeedback("boost", "1000"))), { phase: "idle", requestId: null, message: null });
});

test("press_while_asleep_only_wakes", () => {
  const s = run(...toScreen("EGG1"), sleep(), buttonRight(5));
  assert.equal(s.display.awake, true);
  assert.equal(s.display.inverted, false);
  const l = run(sleep(), buttonLeft());
  assert.equal(l.display.awake, true);
  assert.equal(l.display.screen, "WATER");
});

test("ha_offline_hides_remote_as_live", () => {
  const s = run(...haReady, haStatus("offline"));
  assert.deepEqual(canSend(s, "boost"), { ok: false, reason: "HA offline" });
  assert.deepEqual(canSend(run(...haReady), "boost"), { ok: true });
  assert.deepEqual(canSend(run(...haReady, brokerUp(false)), "boost"), { ok: false, reason: "HA offline" });
});

test("broker_drop_forgets_ha_status", () => {
  const s = run(...haReady, brokerUp(false));
  assert.equal(s.link.ha, "unknown");
  assert.equal(run(...haReady, brokerUp(false), brokerUp(true)).link.ha, "unknown");
});

test("press_while_sending_ignored", () => {
  // An impatient double press must not reach HA as start-then-cancel.
  const s = run(...haReady, ...toScreen("BOOST"), buttonRight(1000), buttonRight(1500));
  assert.equal(fb(s).phase, "sending");
  assert.equal(fb(s).requestId, "1000");
});
