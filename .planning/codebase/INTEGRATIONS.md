# Integrations

## Supabase

**Project ID:** `gionpsuunfkkzzjdubfy`
**URL:** `https://gionpsuunfkkzzjdubfy.supabase.co`
**Client init:** `@supabase/supabase-js 2.98.0`, anon key hardcoded in `src/integrations/supabase/client.ts`

### Auth
- Supabase Auth (email/password)
- Sessions persisted to `localStorage` with auto-refresh
- Custom `user_roles` table (`app_role` enum: admin, editor, viewer) for legacy per-user role checks
- Organization-based roles via `org_role` enum: `owner`, `admin`, `member`, `viewer`
- `is_org_member()` and `get_org_role()` are SECURITY DEFINER functions used in RLS policies

### Storage Bucket
- **avatars** (public bucket) — user profile photos, path-scoped RLS (`/auth.uid()/...`)

### pg_cron Jobs
- `ml-token-refresh-every-20min` — runs every 20 minutes via `net.http_post` to invoke the `ml-token-refresh` edge function
- Cron secret stored in `vault.secrets` under name `CRON_SECRET`, read via `get_cron_secret()` RPC

### Database Tables

#### Core/Auth Tables
| Table | Purpose | RLS Scope |
|---|---|---|
| `profiles` | User display name, avatar | own row |
| `user_roles` | Legacy app_role per user | admin only |
| `organizations` | Multi-tenant orgs (name, slug, owner_id) | org member |
| `organization_members` | user_id + organization_id + org_role | org member |
| `organization_invites` | Email invites with token_hash, expires_at, 7-day TTL | owner/admin |
| `member_route_permissions` | Per-user route access control within an org | org member |
| `audit_log` | Action log (actor_id, action, target_user_id, details jsonb) | owner/admin; inserts via SECURITY DEFINER function only |

#### Sellers / Stores
| Table | Purpose | RLS Scope |
|---|---|---|
| `sellers` | Business entity (name, initials, logo_url, organization_id) | org member |
| `seller_stores` | One row per marketplace channel (marketplace text, external_id, is_active) | org member |

#### ML Token Storage
| Table | Key Columns | Notes |
|---|---|---|
| `ml_tokens` | user_id, ml_user_id (text), access_token, refresh_token, expires_at, seller_id, organization_id | Unique on `(user_id, ml_user_id)`. Tokens expire in 6h; refreshed by cron. |

#### MercadoLivre Cache Tables (all scoped to organization_id + ml_user_id)
| Table | Key Columns | Unique Constraint |
|---|---|---|
| `ml_daily_cache` | date, total_revenue, approved_revenue, qty_orders, units_sold, cancelled_orders, shipped_orders, unique_visits, unique_buyers | `(user_id, ml_user_id, date)` |
| `ml_hourly_cache` | date, hour (0-23), total_revenue, approved_revenue, qty_orders, units_sold | `(user_id, ml_user_id, date, hour)` |
| `ml_product_daily_cache` | date, item_id, title, thumbnail, qty_sold, revenue | `(organization_id, ml_user_id, date, item_id)` |
| `ml_state_daily_cache` | date, uf (2-char), state_name, qty_orders, revenue, approved_revenue | `(user_id, ml_user_id, date, uf)` |
| `ml_user_cache` | ml_user_id (bigint), nickname, country, permalink, active_listings | PK `(user_id, ml_user_id)` |
| `ml_sync_log` | date_from, date_to, days_synced, orders_fetched, source, synced_at | `(user_id, ml_user_id, date_from, date_to, source)` |
| `ml_ads_daily_cache` | date, impressions, clicks, spend, attributed_revenue, attributed_orders, cpc, ctr, roas | `(user_id, ml_user_id, date)` |
| `ml_ads_campaigns_cache` | campaign_id, name, status, daily_budget + metrics | `(user_id, ml_user_id, campaign_id)` |
| `ml_ads_products_cache` | item_id, title, thumbnail + metrics (top 100 by spend) | `(user_id, ml_user_id, item_id)` |

#### Orders Table
| Table | Key Columns | Unique Constraint |
|---|---|---|
| `orders` | ml_order_id, ml_user_id, item_id, variation_id, sku, titulo, listing_type, quantidade, preco_unit, comissao, frete, status, data_pedido, data_pagamento, estado, cidade, comprador, seller_id, organization_id | `(ml_order_id, ml_user_id, item_id, variation_id)` |

#### Other Domain Tables
| Table | Purpose |
|---|---|
| `sales_data` | Manual/imported sales (seller_id, marketplace, ano, mes, dia) |
| `ml_targets` | Monthly revenue targets per seller/marketplace (year, month, target_value, kpi_targets jsonb, pmt_distribution jsonb) |
| `ml_product_costs` | Per-user product cost and tax_rate for margin calculations |

### RLS Pattern (current)
All domain tables use org-scoped policies: `is_org_member(auth.uid(), organization_id)` for SELECT, `get_org_role(...) IN ('owner','admin','member')` for write, `get_org_role(...) IN ('owner','admin')` for delete.

### Key RPC Functions
- `is_org_member(_user_id, _org_id)` — boolean, STABLE SECURITY DEFINER
- `get_org_role(_user_id, _org_id)` — returns org_role, STABLE SECURITY DEFINER
- `has_org_role(_user_id, _org_id, _role)` — boolean, STABLE SECURITY DEFINER
- `get_cron_secret()` — reads CRON_SECRET from vault, SECURITY DEFINER
- `get_cache_table_stats()` — returns row counts + sizes for ML cache tables
- `bootstrap_org_once_invoke(_name, _email)` — calls bootstrap-org-once edge function via `net.http_post`

---

## MercadoLivre API

**Base URL:** `https://api.mercadolibre.com`
**Auth base:** `https://auth.mercadolivre.com.br/authorization`

### OAuth Flow (edge function: `ml-oauth`, `verify_jwt: false`)
1. **get_auth_url**: Generates PKCE code_verifier (32 random bytes, base64url-encoded), SHA-256 code_challenge; constructs authorization URL with scopes: `offline_access read_orders write_orders read_products read_payments read_advertising`
2. **exchange_code**: POST `https://api.mercadolibre.com/oauth/token` with `grant_type=authorization_code` + `code_verifier` (PKCE); stores tokens in `ml_tokens`; upserts `seller_stores` record
3. **refresh_token**: POST `https://api.mercadolibre.com/oauth/token` with `grant_type=refresh_token`

### Token Management
- Tokens expire in ~6h (`expires_in` seconds from ML response)
- `ml-token-refresh` edge function is called by pg_cron every 20 minutes; refreshes all tokens with `expires_at < now() + 30min`
- `ml-ads` edge function performs inline refresh (5-min margin) when its own token lookup finds an expiring token
- Env vars required: `ML_APP_ID`, `ML_CLIENT_SECRET`

### API Endpoints Used

#### Orders (`mercado-libre-integration`, `sync-ml-orders`)
- `GET /users/me` — resolve numeric seller ID from access token
- `GET /orders/search?seller={id}&order.date_created.from={iso}&order.date_created.to={iso}&sort=date_desc&limit=50&offset={n}` — paginated order fetch; offset capped at 1000; window auto-split when `total > 950`
- `GET /shipments/{id}` — fetch `base_cost` (seller-absorbed shipping) and `receiver_address` (estado + cidade); batched with concurrency=10

#### Inventory (`ml-inventory`)
- `GET /users/{sellerId}/items/search?status=active&limit=100&offset={n}` — list active item IDs
- `GET /users/{sellerId}/items/search?status=paused&limit=100&offset={n}` — list paused item IDs
- `GET /items?ids={id1,...,id20}&attributes=id,title,available_quantity,sold_quantity,price,currency_id,thumbnail,status,category_id,listing_type_id,health,variations,attributes,seller_custom_field,shipping,catalog_product_id,deal_ids` — multi-get items (batches of 20)
- `GET /items/visits?ids={id1,...,id50}` — visit counts (batches of 50, active items only)

#### Dashboard Metrics (`mercado-libre-integration`)
- `GET /users/{sellerId}/items_visits/time_window?last={n}&unit=day&ending={YYYY-MM-DD}` — daily visit totals
- `GET /users/{sellerId}/items/search?status=active&limit=0` — total active listing count
- `GET /items?ids={batch}&attributes=id,thumbnail` — thumbnail enrichment for product sales (batches of 20)
- `GET /shipments/{id}` — receiver state for geo breakdown (concurrency=5, hard cap 150 shipments, 20s budget)

#### Prices & Costs (`ml-precos-custos`)
- `GET /users/{mlUserId}/items/search?status=active&limit=50` — list active item IDs
- `GET /items?ids={batch}&attributes=id,title,thumbnail,price,listing_type_id,category_id[,...]` — item details (batches of 20)
- `GET /items/{id}/prices` — standard + promotion prices
- `GET /items/{id}/sale_price?context=channel_marketplace` — effective sale price
- `GET /suggestions/items/{id}/details` — competitive price suggestion (current_price, suggested_price, lowest_price, costs)
- `GET /suggestions/user/{mlUserId}/items` — bulk list of items with suggestions
- `GET /sites/MLB/listing_prices?price={n}&currency_id=BRL[&category_id=...&logistic_type=...&shipping_mode=...]` — fee structure for `gold_pro`, `gold_special`, `free` listing types

#### Reputation (`ml-reputation`)
- `GET /users/{mlUserId}` — `seller_reputation` object + `power_seller_status`

#### Ads / Product Ads (`ml-ads`, `sync-ads`)
- `GET /advertising/advertisers?product_id=PADS` — get `advertiser_id` for Product Ads
- `GET /advertising/advertisers/{advertiserId}/product_ads/items?date_from={d}&date_to={d}&metrics={list}&metrics_summary=true&limit=50&offset={n}` — per-day item-level ad metrics (impressions/clicks/spend/revenue/orders)
- `GET /advertising/advertisers/{advertiserId}/product_ads/campaigns?date_from={d}&date_to={d}&metrics={list}&metrics_summary=true&limit=50&offset={n}` — campaign list + metrics
- Metrics requested: `prints,clicks,ctr,cvr,acos,roas,cpc,cost,units_quantity,direct_amount,indirect_amount,total_amount`
- `api-version: 2` header sent on all ads requests
- Retry logic: 3 attempts, 429 → wait `retry-after`, 5xx → exponential backoff

### Listing Type Mapping (Brazil)
| ML `listing_type_id` | Internal label |
|---|---|
| `gold_special` | classic |
| `gold_pro`, `gold_premium`, `gold_extra_full` | premium |
| `gold`, `gold_extra` | classic |
| `silver`, `bronze`, `free` | free |

---

## Supabase Edge Functions Reference

| Function | `verify_jwt` | Invoked By | Purpose |
|---|---|---|---|
| `ml-oauth` | false | Frontend (OAuth callback) | OAuth code exchange, token refresh, auth URL generation |
| `ml-token-refresh` | false | pg_cron every 20min | Batch refresh of expiring ML tokens; guarded by `X-Cron-Secret` header |
| `mercado-libre-integration` | true | Frontend | Full metrics sync: orders, visits, daily/hourly/product/state cache |
| `sync-ml-orders` | true (manual) | Frontend | Date-range order sync to `orders` table with shipment details |
| `ml-inventory` | true | Frontend | Active + paused listings with stock, variations, visits |
| `ml-ads` | true | Frontend | ML Product Ads (PADS) metrics; 1h cache TTL |
| `sync-ads` | false | Service role (cron) | Batch ML Ads sync for all active sellers |
| `ml-reputation` | true | Frontend | Seller reputation level and power seller status |
| `ml-products-aggregated` | true | Frontend | Aggregate product revenue across stores from `ml_product_daily_cache` |
| `ml-precos-custos` | true | Frontend | Prices, costs, fee structure, competitive suggestions |
| `admin-list-users` | true | Admin frontend | List auth.users via service role |
| `admin-create-user` | true | Admin frontend | Create user + assign role, writes audit_log |
| `admin-toggle-user` | true | Admin frontend | Enable/disable user accounts |
| `admin-update-role` | true | Admin frontend | Update user_roles table |
| `org-invite-create` | true | Frontend | Create org invite with token_hash |
| `org-invite-accept` | false | Email link | Accept invite, join organization |
| `org-member-update-role` | true | Frontend | Change org member role |
| `org-member-remove` | true | Frontend | Remove member from org |
| `org-transfer-ownership` | true | Frontend | Transfer org ownership |
| `super-admin-orgs` | true | Super admin | Cross-tenant org management |
| `super-admin-users` | true | Super admin | Cross-tenant user management |

---

## No Other External APIs

The codebase has no integrations with Shopee's live API (Shopee tables existed but were dropped in migration `20260512141255`). No Stripe, no email provider SDK, no analytics SDK found in `package.json` or edge function imports.
