## Goal

When a user clicks a match on `/arena`, the match page should look and feel like `/lounge/primetime` — the same immersive 4-tile theatre layout with the background image, side chat panel, bottom action bar, and bottom tabs — but wired to a **match** (and its `match_slots`) instead of a **lounge** (and its `tvs`).

## What's on the page today vs. target

Today (`src/routes/arena.$matchId.tsx`) renders a bare content column: back link, refresh/reset chips, match summary card, and a 4-tile grid via `MatchSlotTile`. No theatre background, no chat, no action bar, no bottom tabs.

Target (mirrors `src/routes/lounge.$loungeId.tsx`):
- `ArenaTopNav` at top
- `ArenaHeader` (live count + viewers)
- Theatre wrapper: rounded card, `arena-theatre-bg.jpg` background + gradient overlay
- Two-column grid inside: match tile grid on the left, `ArenaChatPanel` on the right (toggleable)
- `ArenaActionBar` beneath the grid
- `ArenaBottomTabs` at the bottom of the page

## Implementation

### 1. New match-grid wrapper component

Create `src/components/sports-arena/MatchGrid.tsx` that renders the existing 4-slot `MatchSlotTile` grid (extracted from the current `arena.$matchId.tsx` body). Props: `match`, `channels`, `activeSlot`, `onActiveSlotChange`, `paused?`. This mirrors the shape of `LoungeGrid` so the theatre layout composes cleanly.

Optionally wrap with ads similar to `LoungeGridWithAds` — for scope, skip ads on match pages for now (matches don't have a lounge id the ad scheduler expects). We can add `MatchGridWithAds` in a follow-up if desired.

### 2. Rebuild `src/routes/arena.$matchId.tsx`

Keep all existing data plumbing (playlist loading, realtime subscription, slot preferences, reset dialog, refresh, live-tick viewers). Replace the page shell with the lounge layout:

```tsx
<div className="min-h-screen bg-arena text-white">
  <ArenaTopNav />
  <main className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-6 sm:pt-4">
    <ArenaHeader liveGames={enabledSlots.length} viewers={viewers} />

    <div className="relative isolate overflow-hidden rounded-3xl border border-arena-border">
      {/* theatre background + gradient (same markup as lounge) */}
      <div className={`relative grid gap-4 p-3 sm:gap-5 sm:p-5 lg:p-6 ${
        chatVisible ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"
      }`}>
        <div className="min-w-0">
          <MatchGrid
            match={match}
            channels={channels}
            activeSlot={activeSlot}
            onActiveSlotChange={setActiveSlot}
          />
        </div>
        <div className={`min-w-0 ${chatVisible ? "" : "hidden"}`}>
          <ArenaChatPanel loungeId={match.id} online={viewers} visible={chatVisible} />
        </div>
      </div>

      <div className="relative px-3 pb-3 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
        <ArenaActionBar
          loungeId={match.id}
          tvs={[]}
          chatVisible={chatVisible}
          onToggleChat={() => setChatVisible(v => !v)}
          onLeave={() => navigate({ to: "/arena" })}
        />
      </div>
    </div>
  </main>

  <ArenaBottomTabs />
</div>
```

The current top toolbar (back link, refresh chip, reset chip, viewers pill, provider pill) becomes a compact utility row above the theatre card, or the refresh/reset buttons are folded into the action bar area. The match summary card (title / teams / score / status) stays and is placed inside the theatre card above the grid so users still see match context.

Chat uses `match.id` as the room key so match-level chat is isolated per match. `ArenaChatPanel` and `ArenaActionBar` accept a string `loungeId` — since it's just an opaque room id at the DB level, we can pass `match.id`. (If chat storage schema strictly requires a real `lounges.id`, note it here — see Open questions.)

### 3. Behaviour to preserve

- Refresh streams + reset saved slot controls (place them beside the header row above the theatre card).
- Realtime updates on `matches` + `match_slots`.
- Per-match saved slot preference (server for signed-in users, localStorage otherwise).
- Auto-live from `useLiveTick` when `status === "scheduled"` and start time has passed.
- "No provider configured" and "No slots enabled" empty states — render them inside the theatre card in place of the grid.

## Technical details

- Files edited: `src/routes/arena.$matchId.tsx`.
- Files created: `src/components/sports-arena/MatchGrid.tsx` (extracted tile grid).
- Files reused as-is: `ArenaTopNav`, `ArenaHeader`, `ArenaChatPanel`, `ArenaActionBar`, `ArenaBottomTabs`, `arena-theatre-bg.jpg`, `MatchSlotTile`.
- No DB schema changes.
- No new server functions.

## Open questions

1. **Chat room key**: OK to pass `match.id` as `loungeId` to `ArenaChatPanel` / `ArenaActionBar` (chat is scoped per match), or should match chat share a single global room? Passing `match.id` gives per-match rooms and is the natural default; confirm before I wire it.
2. **Ads on match pages**: skip for v1 (recommended) or add `MatchGridWithAds` that uses `match.id` as the scheduler key?
3. **Match summary card placement**: inside the theatre card above the grid (recommended), or keep it above the theatre card like the lounge header?
