import { SCREENS, screenById, haActionIds } from "./screens.js";

const IDLE = { phase: "idle", requestId: null, message: null };

export const initialState = {
  data: { probe_c: null, room_c: null, room_rh: null },
  sensors: { probe_status: "unknown", probe_detail: null, room_present: null },
  display: { screen: SCREENS[0].id, inverted: false, awake: true },
  // broker: MQTT connection up. ha: Home Assistant's own birth/will
  // (homeassistant/status) — "unknown" until seen, treated as not online.
  link: { broker: false, ha: "unknown" },
  actions: Object.fromEntries(haActionIds().map((id) => [id, { remote: null, feedback: IDLE }])),
};

export const buttonLeft = () => ({ type: "display/left" });
/** `now` (ms) becomes the request id, so the reducer stays pure. */
export const buttonRight = (now) => ({ type: "display/right", payload: now });
export const sleep = () => ({ type: "display/sleep" });
export const setProbe = (c) => ({ type: "data/probe", payload: c });
export const setProbeStatus = (s) => ({ type: "sensors/probe", payload: s });
export const setRoom = (r) => ({ type: "data/room", payload: r });
export const setRoomPresent = (present) => ({ type: "sensors/roomPresent", payload: present });
export const brokerUp = (up) => ({ type: "link/broker", payload: up });
export const haStatus = (s) => ({ type: "link/ha", payload: s });
export const remoteActionState = (id, remote) => ({ type: "actions/remote", payload: { id, remote } });
export const ack = (a) => ({ type: "actions/ack", payload: a });
export const ackTimeout = (id, requestId) => ({ type: "actions/ackTimeout", payload: { id, requestId } });
export const clearFeedback = (id, requestId) => ({ type: "actions/clearFeedback", payload: { id, requestId } });

/** Whether a press on HA action `id` can be sent right now, and why not. */
export const canSend = (state, id) => {
  const a = state.actions[id];
  if (!state.link.broker || state.link.ha !== "online" || !a || a.remote === null) return { ok: false, reason: "HA offline" };
  if (a.remote.available === false) return { ok: false, reason: a.remote.reason || "Not possible now" };
  return { ok: true };
};

const setFeedback = (state, id, feedback) => ({
  ...state,
  actions: { ...state.actions, [id]: { ...state.actions[id], feedback } },
});

const runLocal = (state, id) => {
  switch (id) {
    case "invert":
      return { ...state, display: { ...state.display, inverted: !state.display.inverted } };
    default:
      return state;
  }
};

const pressRight = (state, now) => {
  const action = screenById(state.display.screen)?.action;
  if (!action) return state;
  if (action.type === "local") return runLocal(state, action.id);
  const can = canSend(state, action.id);
  return setFeedback(state, action.id, can.ok
    ? { phase: "sending", requestId: String(now), message: null }
    : { phase: "failed", requestId: null, message: can.reason });
};

const nextScreen = (id) => SCREENS[(SCREENS.findIndex((s) => s.id === id) + 1) % SCREENS.length].id;

export function appReducer(state = initialState, action) {
  switch (action.type) {
    case "display/left":
    case "display/right": {
      // A press on a dark screen only wakes it: you can't see what you'd be saying yes to.
      if (!state.display.awake) return { ...state, display: { ...state.display, awake: true } };
      if (action.type === "display/left") return { ...state, display: { ...state.display, screen: nextScreen(state.display.screen) } };
      return pressRight(state, action.payload);
    }
    case "display/sleep":
      return { ...state, display: { ...state.display, awake: false } };
    case "data/probe":
      return { ...state, data: { ...state.data, probe_c: action.payload } };
    case "data/room":
      return { ...state, data: { ...state.data, room_c: action.payload?.c ?? null, room_rh: action.payload?.rh ?? null } };
    case "sensors/probe":
      return { ...state, sensors: { ...state.sensors, probe_status: action.payload.status, probe_detail: action.payload.detail ?? null } };
    case "sensors/roomPresent":
      return { ...state, sensors: { ...state.sensors, room_present: action.payload } };
    case "link/broker":
      return { ...state, link: { ...state.link, broker: action.payload } };
    case "link/ha":
      return { ...state, link: { ...state.link, ha: action.payload } };
    case "actions/remote": {
      const { id, remote } = action.payload;
      if (!state.actions[id]) return state;
      return { ...state, actions: { ...state.actions, [id]: { ...state.actions[id], remote } } };
    }
    case "actions/ack": {
      // Acks carry only the request id; match it to whichever action is waiting on it.
      const { request_id, ok, message } = action.payload;
      const id = Object.keys(state.actions).find((k) => {
        const f = state.actions[k].feedback;
        return f.phase === "sending" && f.requestId === request_id;
      });
      if (!id) return state;
      return setFeedback(state, id, { phase: ok ? "confirmed" : "failed", requestId: request_id, message: message ?? (ok ? "OK" : "Refused") });
    }
    case "actions/ackTimeout": {
      const { id, requestId } = action.payload;
      const f = state.actions[id]?.feedback;
      if (!f || f.phase !== "sending" || f.requestId !== requestId) return state;
      return setFeedback(state, id, { phase: "failed", requestId, message: "No answer from HA" });
    }
    case "actions/clearFeedback": {
      const { id, requestId } = action.payload;
      const f = state.actions[id]?.feedback;
      if (!f || f.requestId !== requestId || f.phase === "sending") return state;
      return setFeedback(state, id, IDLE);
    }
    default:
      return state;
  }
}
