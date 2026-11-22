import { test } from "node:test";
import assert from "node:assert/strict";
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit";
import { registerEffects, appStart } from "./effects.js";
import { appReducer, buttonLeft, buttonRight, brokerUp, haStatus, remoteActionState, ack } from "./store.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const setup = (over = {}) => {
  const published = [];
  const listener = createListenerMiddleware();
  registerEffects(listener, {
    publish: (topic, payload) => published.push({ topic, payload: JSON.parse(payload) }),
    ackTimeoutMs: 20, confirmShowMs: 20, sleepAfterMs: 1000, ...over,
  });
  const store = configureStore({ reducer: appReducer, middleware: (g) => g().prepend(listener.middleware) });
  for (const a of [brokerUp(true), haStatus("online"), remoteActionState("boost", { available: true, active: false })]) store.dispatch(a);
  store.dispatch(buttonLeft());
  store.dispatch(buttonLeft()); // → BOOST
  return { store, published, fb: () => store.getState().actions.boost.feedback, stop: () => listener.clearListeners() };
};

test("press_publishes_once_with_request_id", async () => {
  const { store, published, stop } = setup();
  store.dispatch(buttonRight(1000));
  await wait(1);
  assert.deepEqual(published, [{ topic: "solarwater/action", payload: { event_type: "boost", request_id: "1000" } }]);
  stop();
});

test("no_ack_fails_then_idles", async () => {
  const { store, fb, stop } = setup();
  store.dispatch(buttonRight(1000));
  await wait(30);
  assert.equal(fb().phase, "failed");
  assert.equal(fb().message, "No answer from HA");
  await wait(30);
  assert.equal(fb().phase, "idle");
  stop();
});

test("ack_confirms_then_idles", async () => {
  const { store, fb, stop } = setup();
  store.dispatch(buttonRight(1000));
  store.dispatch(ack({ request_id: "1000", ok: true, message: "Boosting 60 min" }));
  assert.equal(fb().phase, "confirmed");
  await wait(30);
  assert.equal(fb().phase, "idle");
  stop();
});

test("render_predicate_includes_tick", async () => {
  const { shouldRender } = await import("./effects.js");
  const st = { a: 1 };
  assert.equal(shouldRender({ type: "display/tick" }, st, st), true);
  assert.equal(shouldRender({ type: "data/probe" }, st, st), false);
  assert.equal(shouldRender({ type: "data/probe" }, { a: 2 }, st), true);
  assert.equal(shouldRender({ type: "push/x" }, { a: 2 }, st), false);
});

test("press_while_sending_publishes_once", async () => {
  const { store, published, stop } = setup();
  store.dispatch(buttonRight(1000));
  store.dispatch(buttonRight(1001));
  await wait(1);
  assert.equal(published.length, 1);
  stop();
});

test("two_presses_only_latest_times_out", async () => {
  const { store, fb, published, stop } = setup({ ackTimeoutMs: 40, confirmShowMs: 1000 });
  store.dispatch(buttonRight(1000));
  await wait(50); // first press has timed out (failed, still shown: confirmShowMs 1000)
  store.dispatch(buttonRight(2000));
  await wait(20); // second (t≈90) not yet timed out
  assert.equal(fb().phase, "sending");
  assert.equal(fb().requestId, "2000");
  assert.equal(published.length, 2);
  await wait(30);
  assert.equal(fb().phase, "failed");
  stop();
});

test("offline_press_publishes_nothing_and_clears", async () => {
  const { store, fb, published, stop } = setup();
  store.dispatch(haStatus("offline"));
  store.dispatch(buttonRight(1000));
  await wait(1);
  assert.equal(published.length, 0);
  assert.equal(fb().message, "HA offline");
  await wait(30);
  assert.equal(fb().phase, "idle");
  stop();
});

test("sleep_after_inactivity_rearmed_by_press", async () => {
  const { store, stop } = setup({ sleepAfterMs: 40 });
  store.dispatch(appStart());
  await wait(25);
  store.dispatch(buttonLeft()); // re-arm
  await wait(25);
  assert.equal(store.getState().display.awake, true);
  await wait(30);
  assert.equal(store.getState().display.awake, false);
  stop();
});
