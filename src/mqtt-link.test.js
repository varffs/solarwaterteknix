import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLink } from "./mqtt-link.js";

const fakeClient = () => {
  const c = new EventEmitter();
  c.published = [];
  c.subscribed = [];
  c.publish = (topic, payload, opts) => c.published.push({ topic, payload, opts });
  c.subscribe = (topics) => c.subscribed.push(topics);
  c.end = (_force, _opts, cb) => { c.ended = true; cb?.(); };
  return c;
};

const setup = () => {
  const client = fakeClient();
  let opts;
  const actions = [];
  const link = createLink({
    url: "mqtt://broker",
    connect: (url, o) => { opts = { url, ...o }; return client; },
    dispatch: (a) => actions.push(a),
    getDiscovery: () => [{ topic: "homeassistant/event/x/config", payload: "{}", retain: true }],
  });
  return { client, link, actions, opts: () => opts };
};

test("will_and_options", () => {
  const { opts } = setup();
  const o = opts();
  assert.equal(o.url, "mqtt://broker");
  assert.deepEqual(o.will, { topic: "solarwater/status", payload: "offline", retain: true });
  assert.equal(o.reconnectPeriod, 5000);
  assert.equal(o.clientId, "solarwaterteknix");
});

test("reconnect_republishes", () => {
  const { client, actions } = setup();
  client.emit("connect");
  client.emit("close");
  client.emit("connect");
  const online = client.published.filter((p) => p.topic === "solarwater/status" && p.payload === "online");
  assert.equal(online.length, 2);
  assert.ok(online.every((p) => p.opts.retain === true));
  assert.equal(client.published.filter((p) => p.topic === "homeassistant/event/x/config").length, 2);
  assert.equal(client.subscribed.length, 2);
  assert.deepEqual(client.subscribed[0], ["solarwater/ack", "homeassistant/status", "solarwater/ha", "solarwater/actions/boost"]);
  assert.deepEqual(actions.map((a) => [a.type, a.payload]), [["link/broker", true], ["link/broker", false], ["link/broker", true]]);
});

test("messages_route_to_dispatch", () => {
  const { client, actions } = setup();
  client.emit("message", "homeassistant/status", Buffer.from("online"));
  client.emit("message", "nobody/cares", Buffer.from("x"));
  assert.deepEqual(actions, [{ type: "link/ha", payload: "online" }]);
});

test("publish_and_end", async () => {
  const { client, link } = setup();
  link.publish("solarwater/state", "{}");
  assert.deepEqual(client.published.at(-1), { topic: "solarwater/state", payload: "{}", opts: {} });
  await link.end();
  assert.ok(client.published.some((p) => p.topic === "solarwater/status" && p.payload === "offline"));
  assert.equal(client.ended, true);
});
