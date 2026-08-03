# IPTV production buffering root cause

The active Sports Arena playback call graph is:

`LoungeGrid` -> `HlsTile` -> authenticated
`/api/sports-arena/tv/:tvId/playlist` -> `getSharedPlaylist()` -> signed
`/api/sports-arena/tv/:tvId/seg` URLs -> `getSharedSegment()` -> `customFetch()`.

The production bottleneck was confirmed in that path:

- `customFetch()` waited for the entire upstream response and concatenated every
  chunk before resolving, so downstream headers and bytes could not be sent as
  they arrived.
- `getSharedSegment()` then called `arrayBuffer()` and applied a 10-second
  absolute deadline to the complete download. A progressing transfer could be
  aborted solely because it was slower on the VPS.
- The segment route created a third full-body response copy and converted
  transient timeouts/network errors into synthetic 404 gaps. Its circuit
  breaker could extend a brief slowdown into a 15-second playback blackout.
- `HlsTile` and the reusable `HlsPlayer` used small live buffers and aggressive
  recovery; `HlsPlayer` also treated a quality-level switch as buffering even
  when playback had not stopped.
- Each live playlist poll performed remote Supabase authentication, TV/session
  reads, a session update, and a health-log insert, adding avoidable latency and
  writes every few seconds.
- The browser-facing segment `u=` value was signed but only Base64-encoded, not
  opaque; decoding it revealed the complete upstream credential path.

`global-iptv-relay.server.ts` serves the separately signed public/global channel
flow. It is not imported by the Sports Arena routes and is not part of the
production call graph above.
