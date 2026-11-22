import { TOPICS, subscriptions, incomingToAction } from "./ha.js";
import { brokerUp } from "./store.js";

/**
 * The MQTT connection. Every (re)connect re-announces the device: online,
 * discovery configs and subscriptions — a broker restart loses non-retained
 * subscriptions, and HA may have restarted and forgotten the entities.
 * `connect` is injectable (mqtt.connect in the app, a fake in tests).
 */
export const createLink = ({ url, connect, dispatch, getDiscovery }) => {
  const client = connect(url, {
    clientId: "solarwaterteknix",
    reconnectPeriod: 5000,
    will: { topic: TOPICS.status, payload: "offline", retain: true },
  });

  client.on("connect", () => {
    client.publish(TOPICS.status, "online", { retain: true });
    for (const m of getDiscovery()) client.publish(m.topic, m.payload, { retain: m.retain });
    client.subscribe(subscriptions());
    dispatch(brokerUp(true));
  });
  const down = () => dispatch(brokerUp(false));
  client.on("close", down);
  client.on("offline", down);
  client.on("error", (e) => console.error("mqtt:", e.message));
  client.on("message", (topic, payload) => {
    const action = incomingToAction(topic, payload);
    if (action) dispatch(action);
  });

  return {
    publish(topic, payload, opts = {}) {
      client.publish(topic, payload, opts);
    },
    /** Graceful stop: say offline ourselves (the Will only fires on an unclean drop). */
    end() {
      client.publish(TOPICS.status, "offline", { retain: true });
      return new Promise((resolve) => client.end(false, {}, resolve));
    },
  };
};
