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

The public channel page has its own production playback path:

`/iptv/:channelId` -> `IPTVPlayer` -> signed
`/api/public/iptv/channel/:channelId/playlist` ->
`getSharedGlobalPlaylist()` -> encrypted segment URLs ->
`/api/public/iptv/channel/:channelId/segment` ->
`getSharedGlobalResourceResponse()`.

That relay already streamed a cache miss to its first viewer, but it retained a
15-second absolute AbortController deadline until the cache branch finished.
Consequently, a healthy segment that kept making progress could still be cut
off on the production VPS. It also used a second redirect/fetch implementation,
did not forward Range/status metadata through the public route, and could miss a
nested playlist when neither its URL nor Content-Type identified it. The public
`IPTVPlayer` compounded short stalls by restarting HLS loading after only four
seconds without playback progress. The public flow therefore needs to share the
canonical streaming upstream client, idle timeout semantics, bounded cache
configuration, diagnostics, and controlled player recovery used by the sports
flow.

The public relay is now consolidated on `customFetch()`: it resolves at headers,
uses reset-on-progress idle timeouts, streams cache misses, forwards Range/206
metadata, and uses the same byte-bounded cache environment settings as the
sports relay. The obsolete buffered resource entry point and inactive
Cloudflare Cache API branch were removed from the Nitro Node path. `IPTVPlayer`
now uses production-safe HLS load policies and bounded recovery without the
four-second unconditional loader restart.
