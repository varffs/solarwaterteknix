import { TOPICS, pressPayload } from "./ha.js";
import { haActionIds } from "./screens.js";
import { ackTimeout, clearFeedback, sleep } from "./store.js";

/** Dispatched once at boot so the screen-sleep timer arms without a press. */
export const appStart = () => ({ type: "app/start" });

/**
 * Side effects, driven by state changes (REDUX-SPEC: listeners, not loops).
 * - A feedback entering `sending` (new request id) publishes the press, then
 *   times it out if HA never acks. The reducer ignores timeouts for requests
 *   that are no longer current, so overlapping waits are harmless.
 * - `confirmed` / `failed` show for confirmShowMs, then return to idle.
 * - Any press (or boot) re-arms screen sleep.
 */
export const registerEffects = (listener, { publish, ackTimeoutMs, confirmShowMs, sleepAfterMs }) => {
  for (const id of haActionIds()) {
    const fb = (state) => state.actions[id].feedback;

    listener.startListening({
      predicate: (_a, curr, prev) => fb(curr).phase === "sending" && fb(curr).requestId !== fb(prev).requestId,
      effect: async (_a, api) => {
        const { requestId } = fb(api.getState());
        publish(TOPICS.action, pressPayload(id, requestId));
        await api.delay(ackTimeoutMs);
        api.dispatch(ackTimeout(id, requestId));
      },
    });

    listener.startListening({
      predicate: (_a, curr, prev) =>
        (fb(curr).phase === "confirmed" || fb(curr).phase === "failed") && fb(curr) !== fb(prev),
      effect: async (_a, api) => {
        const { requestId } = fb(api.getState());
        await api.delay(confirmShowMs);
        api.dispatch(clearFeedback(id, requestId));
      },
    });
  }

  listener.startListening({
    predicate: (a) => a.type === "display/left" || a.type === "display/right" || a.type === "app/start",
    effect: async (_a, api) => {
      api.cancelActiveListeners();
      await api.delay(sleepAfterMs);
      api.dispatch(sleep());
    },
  });
};
