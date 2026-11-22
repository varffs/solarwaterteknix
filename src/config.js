const ROLES = ["desk", "tank"];

/**
 * Device settings from the environment. Pure: pass an env object in tests.
 * PROBE_ROLE says what the DS18B20 is measuring: "desk" while oldpi sits on the
 * office desk (the probe is then published by oldpi's own cron script as
 * sensor.oldpi_oldpi_air_temp, and this app must not publish it), "tank" once
 * it is on the immersion cupboard wall.
 */
export const loadConfig = (env = process.env) => {
  const isVirtual = env.VIRTUAL_MODE === "true";
  const probeRole = env.PROBE_ROLE || "desk";
  if (!ROLES.includes(probeRole)) {
    throw new Error(`PROBE_ROLE must be one of ${ROLES.join(", ")} (got "${probeRole}")`);
  }
  return {
    isVirtual,
    // In virtual mode MQTT is opt-in, so a laptop run never touches the real broker by accident.
    mqttUrl: env.MQTT_URL || (isVirtual ? null : "mqtt://bigpi.local"),
    // ...and talks to a pretend broker + HA instead (src/fake-ha.js).
    fakeHa: isVirtual && !env.MQTT_URL,
    probeId: env.PROBE_ID || "28-0822b1d75b31",
    probeRole,
    pollMs: 30_000,
    ackTimeoutMs: 8_000,
    confirmShowMs: 4_000,
    sleepAfterMs: 10 * 60_000,
  };
};
