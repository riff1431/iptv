// Resolve the public origin of the current request from the server side so
// og:url / canonical / og:image can be absolute URLs during SSR without
// relying on `window.location` (undefined on the server) or a hardcoded host.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getRequestOrigin = createServerFn({ method: "GET" }).handler(() => {
  const req = getRequest();
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (new URL(req.url).protocol.replace(":", "") || "https");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
});
