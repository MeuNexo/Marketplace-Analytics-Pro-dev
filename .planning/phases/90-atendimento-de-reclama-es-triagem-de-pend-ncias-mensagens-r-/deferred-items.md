# Deferred Items — Phase 90

## sync-ml-claims/index.ts: pre-existing `deno check` type errors (out of scope for 90-01)

`deno check supabase/functions/sync-ml-claims/index.ts` fails with 4 TS errors that
predate Plan 90-01 and are unrelated to the triage columns work (confirmed via
`git stash` — identical errors on the pre-Plan-90-01 version of the file):

1. `TS2769` — `new Date(row.expires_at)` where `row` is typed `{}` (Supabase
   client generic inference issue on `.select()` without an explicit row type).
2. `TS2322` — `row.access_token` typed `{}`, not assignable to `string`.
3. `TS2353` — `return { claims: ..., error: upsertError }` doesn't match the
   declared return type `Promise<{ claims: number }>` (missing `error` field
   in `syncUser`'s return type annotation).
4. `TS2345` — `SupabaseClient<any, "public", any>` not assignable to
   `SupabaseClient<unknown, never, GenericSchema>` when passed to `syncUser`.

These stem from `createClient` being called without generic type args
(`ReturnType<typeof createClient>` resolves to an untyped client), plus a stale
return-type annotation on `syncUser`. The function is deployed and running in
production (cron) despite these local `deno check` failures, so they do not
block runtime — likely because Supabase's deploy-time bundler/type-check is
more lenient than a strict local `deno check`.

Per SCOPE BOUNDARY (executor rules): not fixed in 90-01 since they are
pre-existing and unrelated to the `deriveSellerAction` wiring. A future
cleanup plan should either add explicit generic types to `createClient`
in `sync-ml-claims/index.ts` or add a `deno.json` with relaxed strictness
matching the deployed runtime.
