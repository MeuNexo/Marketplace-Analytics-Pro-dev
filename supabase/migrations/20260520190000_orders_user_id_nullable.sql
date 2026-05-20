-- user_id is nullable: orders synced via job queue (service role) have no user context.
-- organization_id is the authoritative scope key.
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;
