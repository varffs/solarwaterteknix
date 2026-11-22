import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, discoveryMessages, statePayload, pressPayload, subscriptions, incomingToAction } from "./ha.js";
import { initialState, haStatus, remoteActionState, ack } from "./store.js";

const parse = (m) => JSON.parse(m.payload);

test("discovery_desk_no_room_is_button_only", () => {
  const msgs = discoveryMessages({ probeRole: "desk", roomPresent: false });
  assert.equal(msgs.length, 1);
  const ev = parse(msgs[0]);
  assert.equal(msgs[0].topic, "homeassistant/event/solarwaterteknix/button/config");
  assert.equal(msgs[0].retain, true);
  assert.deepEqual(ev.event_types, ["boost"]);
  assert.equal(ev.state_topic, "solarwater/action");
  assert.equal(ev.availability_topic, "solarwater/status");
  assert.equal(ev.unique_id, "solarwaterteknix_button");
  assert.deepEqual(ev.device.identifiers, ["solarwaterteknix"]);
});

test("discovery_tank_with_room", () => {
  const msgs = discoveryMessages({ probeRole: "tank", roomPresent: true });
  assert.equal(msgs.length, 4);
  const ids = msgs.map((m) => parse(m).unique_id);
  assert.deepEqual(ids.sort(), ["solarwaterteknix_button", "solarwaterteknix_room_rh", "solarwaterteknix_room_t", "solarwaterteknix_tank"]);
  const tank = msgs.map(parse).find((p) => p.unique_id === "solarwaterteknix_tank");
  assert.equal(tank.value_template, "{{ value_json.probe_c }}");
  assert.equal(tank.device_class, "temperature");
  assert.equal(tank.unit_of_measurement, "°C");
  assert.equal(tank.state_class, "measurement");
  assert.equal(tank.state_topic, "solarwater/state");
});

test("state_payload_rounds_and_keeps_null", () => {
  const s = { ...initialState, data: { probe_c: 18.444, room_c: null, room_rh: 55.06 } };
  assert.deepEqual(JSON.parse(statePayload(s)), { probe_c: 18.4, room_c: null, room_rh: 55.1 });
});

test("press_payload", () => {
  assert.deepEqual(JSON.parse(pressPayload("boost", "1000")), { event_type: "boost", request_id: "1000" });
});

test("subscriptions_cover_ack_ha_and_actions", () => {
  assert.deepEqual(subscriptions(), ["solarwater/ack", "homeassistant/status", "solarwater/ha", "solarwater/actions/boost"]);
  assert.equal(TOPICS.actionState("boost"), "solarwater/actions/boost");
});

test("incoming_ha_status", () => {
  assert.deepEqual(incomingToAction("homeassistant/status", "online"), haStatus("online"));
  assert.deepEqual(incomingToAction("homeassistant/status", "offline"), haStatus("offline"));
  assert.equal(incomingToAction("homeassistant/status", "rebooting"), null);
});

test("incoming_action_state", () => {
  const p = '{"available":true,"active":true,"finishes_at":"2026-11-22T10:00:00Z"}';
  assert.deepEqual(incomingToAction("solarwater/actions/boost", p),
    remoteActionState("boost", { available: true, active: true, finishes_at: "2026-11-22T10:00:00Z" }));
});

test("incoming_ack", () => {
  assert.deepEqual(incomingToAction("solarwater/ack", '{"request_id":"1000","ok":true,"message":"Boosting 60 min"}'),
    ack({ request_id: "1000", ok: true, message: "Boosting 60 min" }));
});

test("malformed_incoming_ignored", () => {
  assert.equal(incomingToAction("solarwater/ack", "x"), null);
  assert.equal(incomingToAction("solarwater/ack", "{}"), null);
  assert.equal(incomingToAction("solarwater/actions/boost", "[]"), null);
  assert.equal(incomingToAction("solarwater/actions/boost", "null"), null);
  assert.equal(incomingToAction("solarwater/actions/fan", '{"available":true}'), null);
  assert.equal(incomingToAction("some/other", "online"), null);
  // missing `available` defaults to available
  assert.equal(incomingToAction("solarwater/actions/boost", '{"active":false}').payload.remote.available, true);
  // payload may arrive as a Buffer from the mqtt client
  assert.deepEqual(incomingToAction("homeassistant/status", Buffer.from("online")), haStatus("online"));
});

test("ha_hello_marks_ha_online", () => {
  // homeassistant/status is not retained on this install (checked 2026-11-22),
  // so HA answers the device's own "online" with a hello on solarwater/ha.
  assert.equal(TOPICS.haHello, "solarwater/ha");
  assert.ok(subscriptions().includes("solarwater/ha"));
  assert.deepEqual(incomingToAction("solarwater/ha", "online"), haStatus("online"));
  assert.equal(incomingToAction("solarwater/ha", "nope"), null);
});
