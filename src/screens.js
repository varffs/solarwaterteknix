/**
 * The device menu, in cycle order. Left button = next screen; right button
 * ("yes") runs the screen's action if it has one.
 *
 * Adding an action:
 *  - local (done on the device): { kind: "action", action: { type: "local", id } }
 *    and handle `id` in store.js's runLocal().
 *  - Home Assistant: { kind: "action", title, action: { type: "ha", id } }. The
 *    device only reports the press; an HA automation decides what it means and
 *    publishes solarwater/actions/<id> + an ack. Nothing else changes here.
 */
export const SCREENS = [
  { id: "WATER", kind: "info" },
  { id: "ROOM", kind: "info" },
  { id: "BOOST", kind: "action", title: "Boost", action: { type: "ha", id: "boost" } },
  { id: "DATA", kind: "info" },
  { id: "EGG1", kind: "action", title: "Egg", action: { type: "local", id: "invert" } },
];

export const screenById = (id) => SCREENS.find((s) => s.id === id);

/** Ids of every Home Assistant-backed action, in menu order. */
export const haActionIds = () => SCREENS.filter((s) => s.action?.type === "ha").map((s) => s.action.id);
