// Draws the current screen on the 128×64 OLED (or piteknix's terminal stand-in).
// Called from a listener on state change — never on a loop.
import { SCREENS, screenById } from "./screens.js";

const fmt = (v) => (typeof v === "number" && Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : "--");
// Size-2 text fits 10 characters across; longer messages drop to size 1.
const fitSize = (text) => (text.length > 10 ? 1 : 2);

/** Whole minutes until `finishesAtIso`, rounded up; 0 once passed; null if unparseable. */
export const minutesLeft = (finishesAtIso, now) => {
  const t = Date.parse(finishesAtIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 60_000));
};

/** [title, line2, line3] for an HA action screen. */
export const actionLines = (state, id, now) => {
  const title = SCREENS.find((s) => s.action?.id === id)?.title ?? id;
  const { remote, feedback } = state.actions[id] ?? { remote: null, feedback: { phase: "idle" } };
  if (feedback.phase === "sending") return [title, "Sending...", ""];
  if (feedback.phase === "confirmed" || feedback.phase === "failed") return [title, feedback.message ?? "", ""];
  if (!state.link.broker || state.link.ha !== "online" || remote === null) return [title, "HA offline", ""];
  if (remote.available === false) return [title, remote.reason || "Not possible", `(can't ${title.toLowerCase()})`];
  if (remote.active) {
    const m = remote.finishes_at ? minutesLeft(remote.finishes_at, now) : null;
    return [title, remote.label || "Active", m === null ? "" : m === 0 ? "Ending..." : `${m} min left`];
  }
  return [title, remote.label || "Idle", remote.detail || ""];
};

const text = (display, x, y, t, size) => {
  display.setCursor(x, y);
  display.writeText(t, { size });
};

export const renderDisplay = (state, display, { now, egg }) => {
  if (!state.display.awake) return;
  display.clear();
  const screen = screenById(state.display.screen);
  const d = state.data;
  switch (screen.id) {
    case "WATER":
      text(display, 1, 1, "Water", 2);
      text(display, 1, 30, d.probe_c === null ? "--" : `${fmt(d.probe_c)}°c`, 3);
      break;
    case "ROOM":
      text(display, 1, 1, "Room", 2);
      if (state.sensors.room_present === false) text(display, 1, 30, "no room sensor", 1);
      else text(display, 1, 30, `${fmt(d.room_c)}°c ${d.room_rh === null ? "--" : Math.round(d.room_rh)}%`, 2);
      break;
    case "DATA": {
      const lines = [
        `Probe: ${fmt(d.probe_c)}c`,
        `Room: ${fmt(d.room_c)}c ${d.room_rh === null ? "--" : Math.round(d.room_rh)}%`,
        `HA: ${state.link.ha}`,
        `MQTT: ${state.link.broker ? "up" : "down"}`,
      ];
      if (state.sensors.probe_status !== "ok" && state.sensors.probe_detail) lines.push(state.sensors.probe_detail.slice(0, 21));
      lines.forEach((l, i) => text(display, 1, 1 + i * 12, l, 1));
      break;
    }
    case "EGG1":
      if (egg) display.drawBitmap(egg);
      else text(display, 1, 28, "(egg)", 1);
      break;
    default:
      if (screen.action?.type === "ha") {
        const [title, l2, l3] = actionLines(state, screen.action.id, now);
        text(display, 1, 1, title, 2);
        const r = state.actions[screen.action.id]?.remote;
        if (r && r.available === false && state.link.ha === "online") display.drawLine(0, 8, title.length * 12, 8, 1);
        text(display, 1, 24, l2, fitSize(l2));
        if (l3) text(display, 1, 48, l3, 1);
      }
  }
};
