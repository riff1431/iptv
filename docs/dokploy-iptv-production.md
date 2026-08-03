# Dokploy IPTV production deployment

## Required Dokploy settings

Run exactly **one application replica**. Disable autoscaling and do not run a
second deployment of the same provider account. The playlist, in-flight request
coordination, and bounded segment cache are process-local; multiple replicas can
open duplicate upstream connections. This is especially important because the
Xtream account allows only one connection.

Build the existing Nitro `node-server` target. Nixpacks runs `bun install`,
`bun run build`, and then `node .output/server/index.mjs`. Expose container port
`3000` through Dokploy/Traefik. Configure health checks against a non-IPTV page;
health checks must not consume the provider connection.

Set secrets only in Dokploy's environment editor. Never commit Xtream
credentials, put them in `VITE_*` variables, or expose a direct provider URL to
the browser. Generate a long random `IPTV_PROXY_SIGNING_KEY` (at least 32 random
bytes). Keep `DISABLE_IPTV_PROXY=false`.

```env
NITRO_PRESET=node-server
HOST=0.0.0.0
PORT=3000

DISABLE_IPTV_PROXY=false
IPTV_PROXY_SIGNING_KEY=replace-with-a-long-random-secret

IPTV_DEBUG_TIMING=false
IPTV_UPSTREAM_HEADERS_TIMEOUT_MS=10000
IPTV_UPSTREAM_IDLE_TIMEOUT_MS=20000
IPTV_SEGMENT_MAX_ATTEMPTS=2

IPTV_SEGMENT_CACHE_TTL_MS=20000
IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES=8388608
IPTV_SEGMENT_CACHE_TOTAL_MAX_BYTES=67108864
```

Keep the existing Supabase server variables and IPTV encrypted-secret variables
configured as before. A 64 MiB segment cache needs memory headroom for Node,
rendering, and temporary stream chunks; provision at least several hundred MiB
and confirm actual usage with `docker stats` during playback.

## Timing diagnosis

Normal errors always emit one credential-safe structured log. To temporarily log
successful request timing too, set `IPTV_DEBUG_TIMING=true`, redeploy, reproduce
with one viewer, then return it to `false`. Logs include request IDs, hostname
only, cache outcome, header/first-byte timing, bytes, throughput, retries,
cancellation, and failure category. They never include upstream paths, query
strings, authorization values, cookies, or signing tokens.

From inside the production container, set the same-origin route and the viewer's
short-lived Supabase token in environment variables (not command arguments), then
run:

```sh
IPTV_DIAGNOSTIC_URL=http://127.0.0.1:3000/api/sports-arena/tv/TV_ID/playlist \
IPTV_DIAGNOSTIC_BEARER_TOKEN=temporary-access-token \
bun run diagnose:iptv
```

Do not paste the token or a provider URL into shell arguments, tickets, or logs.
The script redacts query strings and reports playlist/segment status, TTFB,
download time, size, throughput, and whether the first segment downloaded within
its advertised duration.

## Production verification

Use one signed-in browser and one channel. Do not simultaneously test the direct
provider URL in VLC, a local development server, or another browser: those tests
compete for the account's single connection. In DevTools, confirm playlist and
segment requests remain same-origin, segment responses begin transferring before
completion, and `X-IPTV-Cache`, `X-IPTV-Request-Id`, and `Server-Timing` are
present. Match request IDs with container logs and watch memory/network use with
`docker stats` for at least 30 minutes.

For the public player, open a single page such as `/iptv/CHANNEL_ID` and inspect
the signed `/api/public/iptv/channel/CHANNEL_ID/playlist` and `/segment` requests.
Do not copy the signed query values into logs or tickets. The same one-replica,
cache, timeout, and timing settings apply to both this public flow and Sports
Arena.

If the domain is proxied through Cloudflare, temporarily switch that DNS record
to **DNS only** and repeat the one-viewer test. A material improvement isolates a
Cloudflare buffering/routing contribution; restore the intended proxy setting
after the comparison. This does not replace testing VPS-to-provider latency and
outbound bandwidth.
