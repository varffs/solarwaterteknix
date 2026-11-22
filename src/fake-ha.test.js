import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHa } from "./fake-ha.js";
import { createLink } from "./mqtt-link.js";
import { subscriptions } from "./ha.js";

const settle = () => new Promise((r) => setImmediate(r));

// A device-side client as the app uses it: connect, announce, subscribe, collect messages.
const setup = async (opts = {}) => {
  const ha = createFakeHa({ now: () => Date.parse("2026-11-22T10:00:00Z"), ...opts });
  const client = ha.connect("fake://", { will: { topic: "solarwater/status", payload: "offline", retain: true } });
  const got = [];
  client.on("message", (topic, payload) => got.push({ topic, payload: String(payload) }));
  await new Promise((r) => client.on("connect", r));
  client.subscribe(subscriptions());
  client.publish("solarwater/status", "online", { retain: true });
  await settle();
  return { ha, client, got };
};
const last = (got, topic) => [...got].reverse().find((m) => m.topic === topic);
const press = (client, id = "r1") =>
  client.publish("solarwater/action", JSON.stringify({ event_type: "boost", request_id: id }));

test("hello_and_idle_state_on_device_online", async () => {
  const { got } = await setup();
  assert.equal(last(got, "solarwater/ha").payload, "online");
  assert.deepEqual(JSON.parse(last(got, "solarwater/actions/boost").payload), {
    available: true, active: false, label: "Idle", detail: "yes = boost 60 min",
  });
});

test("press_starts_boost_then_second_press_cancels", async () => {
  const { client, got } = await setup();
  press(client, "a");
  await settle();
  assert.deepEqual(JSON.parse(last(got, "solarwater/ack").payload), { request_id: "a", ok: true, message: "Boosting 60 min" });
  assert.deepEqual(JSON.parse(last(got, "solarwater/actions/boost").payload), {
    available: true, active: true, label: "Boosting", finishes_at: "2026-11-22T11:00:00.000Z",
  });
  press(client, "b");
  await settle();
  assert.deepEqual(JSON.parse(last(got, "solarwater/ack").payload), { request_id: "b", ok: true, message: "Boost cancelled" });
  assert.equal(JSON.parse(last(got, "solarwater/actions/boost").payload).active, false);
});

test("boost_ends_itself_after_duration", async () => {
  const { client, got } = await setup({ boostMs: 20 });
  press(client);
  await settle();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(JSON.parse(last(got, "solarwater/actions/boost").payload).active, false);
});

test("going_offline_announces_and_ignores_presses", async () => {
  const { ha, client, got } = await setup();
  assert.equal(ha.toggleOnline(), false);
  await settle();
  assert.equal(last(got, "homeassistant/status").payload, "offline");
  const before = got.length;
  press(client);
  await settle();
  assert.equal(got.length, before, "no ack or state while HA is offline");
  assert.equal(ha.toggleOnline(), true);
  await settle();
  assert.equal(last(got, "homeassistant/status").payload, "online");
  assert.equal(last(got, "solarwater/ha").payload, "online");
});

test("drop_next_press_swallows_exactly_one", async () => {
  const { ha, client, got } = await setup();
  ha.dropNextPress();
  press(client, "lost");
  await settle();
  assert.equal(last(got, "solarwater/ack"), undefined);
  press(client, "kept");
  await settle();
  assert.equal(JSON.parse(last(got, "solarwater/ack").payload).request_id, "kept");
});

test("retained_state_delivered_to_late_subscriber", async () => {
  const { ha } = await setup();
  const c2 = ha.connect("fake://", {});
  const got = [];
  c2.on("message", (topic, payload) => got.push({ topic, payload: String(payload) }));
  await new Promise((r) => c2.on("connect", r));
  c2.subscribe(["solarwater/actions/boost"]);
  await settle();
  assert.equal(JSON.parse(last(got, "solarwater/actions/boost").payload).label, "Idle");
});

test("works_through_createLink_end_to_end", async () => {
  const ha = createFakeHa();
  const actions = [];
  const link = createLink({ url: "fake://", connect: ha.connect, dispatch: (a) => actions.push(a), getDiscovery: () => [] });
  await settle();
  await settle();
  assert.ok(actions.some((a) => a.type === "link/broker" && a.payload === true), JSON.stringify(actions));
  assert.ok(actions.some((a) => a.type === "link/ha" && a.payload === "online"), JSON.stringify(actions));
  await link.end();
  assert.ok(actions.some((a) => a.type === "link/broker" && a.payload === false));
});
