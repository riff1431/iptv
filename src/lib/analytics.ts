/**
 * Lightweight client-side analytics shim.
 *
 * The project does not (yet) ship a full analytics provider. This helper
 * gives features a stable API to record events so we can:
 *   - assert on them in tests (via the `analytics:event` window event),
 *   - see them in the browser console during development,
 *   - forward them to a real provider later without touching call sites.
 */

export type AnalyticsProps = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface AnalyticsEvent {
  name: string;
  props: AnalyticsProps;
  ts: number;
}

export const ANALYTICS_EVENT = "analytics:event";

export function trackEvent(name: string, props: AnalyticsProps = {}): void {
  if (typeof window === "undefined") return;
  const event: AnalyticsEvent = { name, props, ts: Date.now() };
  try {
    window.dispatchEvent(new CustomEvent<AnalyticsEvent>(ANALYTICS_EVENT, { detail: event }));
  } catch {
    // ignore
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info("[analytics]", name, props);
  }
}
