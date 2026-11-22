// The MQTT contract between the device and Home Assistant. Pure: builds and
// parses payloads; src/mqtt-link.js does the sending.
import { haActionIds } from "./screens.js";
import { haStatus, remoteActionState, ack } from "./store.js";

export const TOPICS = {
  status: "solarwater/status", // device online/offline (retained, Last Will)
  state: "solarwater/state", // readings JSON
  action: "solarwater/action", // presses → HA event entity
  actionState: (id) => `solarwater/actions/${id}`, // HA → device, retained
  ack: "solarwater/ack", // HA → device, per press
  haStatus: "homeassistant/status", // HA's own birth/will — NOT retained on this install
  haHello: "solarwater/ha", // HA answers our "online" with "online" here, so a device that
  // (re)connects after HA's birth still learns HA is up (checked on the broker 2026-11-22)
};

const DEVICE = {
  identifiers: ["solarwaterteknix"],
  name: "solarwaterteknix",
  manufacturer: "piteknix",
  model: "Raspberry Pi 1 B+",
};

const msg = (component, objectId, config) => ({
  topic: `homeassistant/${component}/solarwaterteknix/${objectId}/config`,
  payload: JSON.stringify({ ...config, availability_topic: TOPICS.status, device: DEVICE }),
  retain: true,
});

const reading = (objectId, name, field, deviceClass, unit) =>
  msg("sensor", objectId, {
    name,
    unique_id: `solarwaterteknix_${objectId}`,
    state_topic: TOPICS.state,
    value_template: `{{ value_json.${field} }}`,
    device_class: deviceClass,
    unit_of_measurement: unit,
    state_class: "measurement",
  });

/**
 * Discovery configs for every entity this device should have right now.
 * The probe is only "Tank temperature" when it is actually on the tank.
 */
export const discoveryMessages = ({ probeRole, roomPresent }) => [
  msg("event", "button", {
    name: "Button",
    unique_id: "solarwaterteknix_button",
    state_topic: TOPICS.action,
    event_types: haActionIds(),
  }),
  ...(probeRole === "tank" ? [reading("tank", "Tank temperature", "probe_c", "temperature", "°C")] : []),
  ...(roomPresent
    ? [
        reading("room_t", "Room temperature", "room_c", "temperature", "°C"),
        reading("room_rh", "Room humidity", "room_rh", "humidity", "%"),
      ]
    : []),
];

const r1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export const statePayload = (state) =>
  JSON.stringify({ probe_c: r1(state.data.probe_c), room_c: r1(state.data.room_c), room_rh: r1(state.data.room_rh) });

export const pressPayload = (id, requestId) => JSON.stringify({ event_type: id, request_id: requestId });

export const subscriptions = () => [TOPICS.ack, TOPICS.haStatus, TOPICS.haHello, ...haActionIds().map(TOPICS.actionState)];

const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Turn an incoming MQTT message into a Redux action, or null to ignore it. Never throws. */
export const incomingToAction = (topic, payload) => {
  const text = String(payload);
  if (topic === TOPICS.haStatus) return text === "online" || text === "offline" ? haStatus(text) : null;
  if (topic === TOPICS.haHello) return text === "online" ? haStatus("online") : null;
  if (topic === TOPICS.ack) {
    const a = json(text);
    if (!isObj(a) || typeof a.request_id !== "string") return null;
    return ack({ request_id: a.request_id, ok: a.ok !== false, message: typeof a.message === "string" ? a.message : null });
  }
  const id = haActionIds().find((x) => TOPICS.actionState(x) === topic);
  if (id) {
    const s = json(text);
    if (!isObj(s)) return null;
    return remoteActionState(id, { ...s, available: s.available !== false });
  }
  return null;
};
