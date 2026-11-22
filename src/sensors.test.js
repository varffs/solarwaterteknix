import { test } from "node:test";
import assert from "node:assert/strict";
import { pollProbe, pollRoom, detectRoom } from "./sensors.js";

const collect = () => {
  const actions = [];
  return { actions, dispatch: (a) => actions.push(a) };
};

test("probe_ok", async () => {
  const { actions, dispatch } = collect();
  await pollProbe({ read: async () => ({ temperature: 47.2 }) }, dispatch);
  assert.deepEqual(actions.map((a) => a.type), ["data/probe", "sensors/probe"]);
  assert.equal(actions[0].payload, 47.2);
  assert.equal(actions[1].payload.status, "ok");
});

test("probe_85_runs_diagnose", async () => {
  const { actions, dispatch } = collect();
  await pollProbe({ read: async () => ({ temperature: 85 }), diagnose: async () => ({ status: "power", detail: "stuck at 85" }) }, dispatch);
  assert.equal(actions[0].payload, null);
  assert.deepEqual(actions[1].payload, { status: "power", detail: "stuck at 85" });
});

test("probe_error_runs_diagnose_even_if_diagnose_throws", async () => {
  const { actions, dispatch } = collect();
  await pollProbe({ read: async () => { throw new Error("ENOENT"); }, diagnose: async () => { throw new Error("bus"); } }, dispatch);
  assert.equal(actions[0].payload, null);
  assert.equal(actions[1].payload.status, "error");
});

test("room_null_sensor_noop", async () => {
  const { actions, dispatch } = collect();
  await pollRoom(null, dispatch);
  assert.equal(actions.length, 0);
});

test("room_reads_and_errors", async () => {
  const ok = collect();
  await pollRoom({ read: async () => ({ temperature: 19.1, humidity: 55 }) }, ok.dispatch);
  assert.deepEqual(ok.actions[0].payload, { c: 19.1, rh: 55 });
  const bad = collect();
  await pollRoom({ read: async () => { throw new Error("i2c"); } }, bad.dispatch);
  assert.equal(bad.actions[0].payload, null);
});

test("detect_room", async () => {
  const none = await detectRoom(async () => ({ read: async () => { throw new Error("nack"); } }));
  assert.equal(none, null);
  const tried = [];
  const found = await detectRoom(async ({ address }) => {
    tried.push(address);
    if (address === 0x76) throw new Error("no device");
    return { address, read: async () => ({ temperature: 20, humidity: 50 }) };
  });
  assert.deepEqual(tried, [0x76, 0x77]);
  assert.equal(found.address, 0x77);
});
