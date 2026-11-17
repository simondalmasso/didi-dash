# Legacy D1 schema migrations

These SQL files document the original D1 (SQLite) schema and its evolution. They
are **not executed by the current runtime**: the Worker stores the ledger in
Cloudflare KV (binding `DATA`, key `ledger:v1` — see `wrangler.jsonc` and
`src/index.js`).

`0002_remove_passenger_zones_and_add_login_lockout.sql` is kept as the
historical record of the decision to drop passenger zone columns before the
move to the KV model.

Do not add new D1 migrations unless the storage backend changes back to D1.
