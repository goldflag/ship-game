# Fleet harbor garage

The owner selected **A — Fleet harbor**, then requested a smaller HUD and a top bar without a background. The selected layout is implemented in `src/ui/Garage.tsx` and `Garage.css`; the alternatives and development switcher have been removed.

- [Original study A](A-fleet-harbor.png): the composition selected by the owner.
- [Compact implementation](fleet-harbor-compact.png): approximately 15% smaller panel and fleet-card footprints, a transparent top bar, and no comparison controls.

Run `bun run dev` and open [the game](http://localhost:5173/). It starts in port with the ship stationary and sailing controls disabled. Drag/scroll inspects the live model. **Set sail** opens the playable sea trial; **Return to port** in the pause menu resets the trial and reopens the garage. Settings and FPS are live.

The harbor is illustrative geometry without collisions. Currency, commander skills, daily orders, ship characteristics, refits and research are mock progression explicitly authorized by the owner. Refits update the local preview configuration and credit balance only. Bismarck is the only ship available to sail; other fleet entries open research previews. Mock state resets on reload or leaving port.
