<p align="center">
    <img src="src/lib/assets/favicon.svg" width="128" alt="Florida Early Vote Forecaster Icon"/>
</p>

<h3 align="center">
    <strong>Florida Early Vote Forecaster</strong>
</h3>

<p align="center">
    <a href="https://fl.cattn.dev/">web</a> · <a href="https://github.com/Cattn/fl-ev-estimations/issues">issues</a>
</p>

<p align="center">
    Tracks Florida 2026 early voting (IPEV + returned mail) by party and lets you build forecasts of the final electorate, with daily benchmarks for the remaining early-voting days.
</p>

Data comes from [acorn-maple-earth-lake.grok.me](https://acorn-maple-earth-lake.grok.me/). The server reads the dataset embedded in that page, caches it for 3 minutes, and keeps the last good snapshot in Cloudflare KV so a slow or empty source never blocks the page.

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
```

Put the returned id in `wrangler.jsonc` under `kv_namespaces`, then:

```sh
pnpm deploy
```

## How days are handled

All dates use Florida (Eastern) time.

- Finished days are reported data and can't be edited.
- Today is locked and projected automatically. Only the part not yet counted is added. From 9 PM ET the count is treated as final, though late county uploads still land in that day.
- Upcoming days are editable and are the only ones the "Lock to target" solver adjusts.
- Remaining mail is entered as a projected final total, so what's left shrinks as ballots arrive.
- Open pages refresh every 5 minutes and when the tab regains focus.
