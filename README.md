<p align="center">
    <img src="src/lib/assets/favicon.svg" width="128" alt="Florida Vote Forecaster Icon"/>
</p>

<h3 align="center">
    <strong>Florida Vote Forecaster</strong>
</h3>

<p align="center">
    <a href="https://fl.cattn.dev/">web</a> · <a href="https://github.com/Cattn/fl-voting-estimations/issues">issues</a>
</p>

<p align="center">
    Tracks Florida 2026 voting by party registration, turnout, and more. It then displays all of that information through various charts and datapoints, making analyzing the vote trends easier!
</p>

> Note: During the Early Voting & Election day period, this tool also offered live projections, forecasts, and more! Those tools are disabled now that this period is over, but the model used for them is still in place for any outstanding votes. The original projected final electorate by my model was R+8.5, with the true final being R+8.73!

Turnout comes from FreshTake (with a backup source if it's down or stale), results from the Florida Division of Elections results file, and race calls from NBC News. A cron job collects them every 3 minutes, keeps the history in Cloudflare D1, and keeps the last good snapshot in Cloudflare KV so a slow or empty source never blocks the page.

## Develop

```sh
pnpm install
pnpm dev        # Vite dev server, with KV emulated locally by Wrangler
pnpm test       # unit tests
pnpm check      # type-check
pnpm preview    # production build running in the local Workers runtime
```

## Deploy (Cloudflare Workers)

```sh
pnpm wrangler login
pnpm wrangler kv namespace create FEED_CACHE
pnpm wrangler d1 create fl-ev-history
```

Put the returned ids in `wrangler.jsonc` and `wrangler.svelte.jsonc` (under `kv_namespaces` and `d1_databases`), then:

```sh
pnpm deploy
```

## How days are handled

All dates use Florida (Eastern) time.

- Finished days are reported data and can't be edited.
- Today is locked and projected automatically. Only the part not yet counted is added. From 9 PM ET the count is treated as final, though late county uploads still land in that day.
- Upcoming days are editable and are the only ones the "Lock to target" solver adjusts.
- Remaining mail is entered as a projected final total, so what's left shrinks as ballots arrive.
- Open pages refresh every 3 minutes (Election Day pages right after each data run) and when the tab regains focus.
