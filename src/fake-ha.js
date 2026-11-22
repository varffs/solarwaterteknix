import { EventEmitter } from "node:events";
import { TOPICS } from "./ha.js";

/**
 * A pretend broker + Home Assistant for laptop dev (`npm run dev` with no MQTT_URL).
 * It speaks the same topics as the real automations (solarwater_boost_button /
 * solarwater_boost_state on bigpi), so the device code can't tell the difference.
 * `connect` matches mqtt.connect's shape for createLink. Messages are delivered on
 * setImmediate, like a real broker round-trip, never synchronously.
 *
 * Dev controls: toggleOnline() (HA restarting / down) and dropNextPress() (HA never
 * answers one press, so the device's "no reply" timeout shows).
 */
export const createFakeHa = ({ boostMs = 60 * 60_000, now = Date.now } = {}) => {
  const clients = new Set();
  const retained = new Map();
  let online = true;
  let finishesAt = null;
  let timer = null;
  let dropNext = false;

  const deliver = (topic, payload, { retain = false } = {}) => {
    if (retain) retained.set(topic, payload);
    setImmediate(() => {
      for (const c of clients) if (c.topics.has(topic)) c.emit("message", topic, Buffer.from(payload));
    });
  };

  const boostState = () =>
    finishesAt
      ? { available: true, active: true, label: "Boosting", finishes_at: new Date(finishesAt).toISOString() }
      : { available: true, active: false, label: "Idle", detail: "yes = boost 60 min" };
  const publishState = () => deliver(TOPICS.actionState("boost"), JSON.stringify(boostState()), { retain: true });
  const hello = () => {
    deliver(TOPICS.haHello, "online");
    publishState();
  };

  const stopBoost = () => {
    clearTimeout(timer);
    timer = null;
    finishesAt = null;
  };

  const onPress = (payload) => {
    let p;
    try {
      p = JSON.parse(String(payload));
    } catch {
      return;
    }
    if (p?.event_type !== "boost" || !online) return;
    if (dropNext) {
      dropNext = false;
      return;
    }
    let message;
    if (finishesAt) {
      stopBoost();
      message = "Boost cancelled";
    } else {
      finishesAt = now() + boostMs;
      timer = setTimeout(() => {
        stopBoost();
        publishState();
      }, boostMs);
      timer.unref?.();
      message = "Boosting 60 min";
    }
    deliver(TOPICS.ack, JSON.stringify({ request_id: p.request_id, ok: true, message }));
    publishState();
  };

  // What HA does with the device's messages (everything else just lands on the broker).
  const fromDevice = (topic, payload) => {
    if (topic === TOPICS.status && String(payload) === "online" && online) hello();
    if (topic === TOPICS.action) onPress(payload);
  };

  const connect = (_url, opts = {}) => {
    const c = new EventEmitter();
    c.topics = new Set();
    c.publish = (topic, payload, o = {}) => {
      if (o.retain) retained.set(topic, String(payload));
      fromDevice(topic, payload);
    };
    c.subscribe = (topics) => {
      for (const t of [].concat(topics)) {
        c.topics.add(t);
        if (retained.has(t)) setImmediate(() => c.emit("message", t, Buffer.from(retained.get(t))));
      }
    };
    c.end = (_force, _o, cb) => {
      clients.delete(c);
      if (opts.will) retained.set(opts.will.topic, String(opts.will.payload));
      setImmediate(() => {
        c.emit("close");
        cb?.();
      });
    };
    clients.add(c);
    setImmediate(() => c.emit("connect"));
    return c;
  };

  return {
    connect,
    /** Flip HA up/down, as its birth/will would. Returns the new online state. */
    toggleOnline() {
      online = !online;
      deliver(TOPICS.haStatus, online ? "online" : "offline");
      if (online) hello();
      return online;
    },
    dropNextPress() {
      dropNext = true;
    },
  };
};
