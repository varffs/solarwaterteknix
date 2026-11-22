import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("defaults_hardware", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.mqttUrl, "mqtt://bigpi.local");
  assert.equal(cfg.probeId, "28-0822b1d75b31");
  assert.equal(cfg.probeRole, "desk");
  assert.equal(cfg.pollMs, 30000);
  assert.equal(cfg.ackTimeoutMs, 8000);
  assert.equal(cfg.confirmShowMs, 4000);
  assert.equal(cfg.sleepAfterMs, 600000);
  assert.equal(cfg.isVirtual, false);
});

test("virtual_without_url_disables_mqtt", () => {
  assert.equal(loadConfig({ VIRTUAL_MODE: "true" }).mqttUrl, null);
  assert.equal(loadConfig({ VIRTUAL_MODE: "true", MQTT_URL: "mqtt://x" }).mqttUrl, "mqtt://x");
});

test("rejects_bad_role", () => {
  assert.throws(() => loadConfig({ PROBE_ROLE: "attic" }), /PROBE_ROLE/);
  assert.equal(loadConfig({ PROBE_ROLE: "tank" }).probeRole, "tank");
});

test("fake_ha_only_in_virtual_without_url", () => {
  assert.equal(loadConfig({ VIRTUAL_MODE: "true" }).fakeHa, true);
  assert.equal(loadConfig({ VIRTUAL_MODE: "true", MQTT_URL: "mqtt://x" }).fakeHa, false);
  assert.equal(loadConfig({}).fakeHa, false);
});
