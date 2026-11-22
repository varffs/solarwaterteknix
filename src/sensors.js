import { setProbe, setProbeStatus, setRoom } from "./store.js";

const diagnoseAndDispatch = async (sensor, dispatch) => {
  dispatch(setProbe(null));
  let diag;
  try {
    diag = await sensor.diagnose();
  } catch (e) {
    diag = { status: "error", detail: `diagnose failed: ${e.message}` };
  }
  dispatch(setProbeStatus({ status: diag.status, detail: diag.detail }));
};

/** DS18B20 poll, polyteknix semantics: 85.0 is the power-on default, i.e. a fault, not a reading. */
export const pollProbe = async (sensor, dispatch) => {
  try {
    const { temperature } = await sensor.read();
    if (Math.abs(temperature - 85) < 0.05) {
      await diagnoseAndDispatch(sensor, dispatch);
      return;
    }
    dispatch(setProbe(temperature));
    dispatch(setProbeStatus({ status: "ok", detail: `reading ${temperature}c` }));
  } catch {
    await diagnoseAndDispatch(sensor, dispatch);
  }
};

/** BME280 poll. `null` sensor = none fitted: nothing to do. */
export const pollRoom = async (sensor, dispatch) => {
  if (!sensor) return;
  try {
    const { temperature, humidity } = await sensor.read();
    dispatch(setRoom({ c: temperature, rh: humidity }));
  } catch (e) {
    console.error("room sensor read failed:", e.message);
    dispatch(setRoom(null));
  }
};

/**
 * Whether a BME280 is fitted: try both addresses it can strap to. A sensor
 * only counts if a real read succeeds (opening can succeed on an empty bus).
 */
export const detectRoom = async (createSensor) => {
  for (const address of [0x76, 0x77]) {
    try {
      const s = await createSensor({ type: "bme280", address });
      await s.read();
      return s;
    } catch {
      // not at this address
    }
  }
  return null;
};
