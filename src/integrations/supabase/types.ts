export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string | null
          details: Json | null
          id: string
          organization_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_route_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          route: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          route: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          route?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_route_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_campaigns_cache: {
        Row: {
          attributed_orders: number
          attributed_revenue: number
          campaign_id: string
          clicks: number
          cpc: number
          ctr: number
          daily_budget: number
          id: string
          impressions: number
          ml_user_id: string
          name: string
          organization_id: string
          roas: number
          seller_id: string | null
          spend: number
          status: string
          synced_at: string
          user_id: string
        }
        Insert: {
          attributed_orders?: number
          attributed_revenue?: number
          campaign_id: string
          clicks?: number
          cpc?: number
          ctr?: number
          daily_budget?: number
          id?: string
          impressions?: number
          ml_user_id?: string
          name?: string
          organization_id: string
          roas?: number
          seller_id?: string | null
          spend?: number
          status?: string
          synced_at?: string
          user_id: string
        }
        Update: {
          attributed_orders?: number
          attributed_revenue?: number
          campaign_id?: string
          clicks?: number
          cpc?: number
          ctr?: number
          daily_budget?: number
          id?: string
          impressions?: number
          ml_user_id?: string
          name?: string
          organization_id?: string
          roas?: number
          seller_id?: string | null
          spend?: number
          status?: string
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_campaigns_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_ads_campaigns_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_daily_cache: {
        Row: {
          attributed_orders: number
          attributed_revenue: number
          clicks: number
          cpc: number
          ctr: number
          date: string
          id: string
          impressions: number
          ml_user_id: string
          organization_id: string
          roas: number
          seller_id: string | null
          spend: number
          synced_at: string
          user_id: string
        }
        Insert: {
          attributed_orders?: number
          attributed_revenue?: number
          clicks?: number
          cpc?: number
          ctr?: number
          date: string
          id?: string
          impressions?: number
          ml_user_id?: string
          organization_id: string
          roas?: number
          seller_id?: string | null
          spend?: number
          synced_at?: string
          user_id: string
        }
        Update: {
          attributed_orders?: number
          attributed_revenue?: number
          clicks?: number
          cpc?: number
          ctr?: number
          date?: string
          id?: string
          impressions?: number
          ml_user_id?: string
          organization_id?: string
          roas?: number
          seller_id?: string | null
          spend?: number
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_daily_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_ads_daily_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_products_cache: {
        Row: {
          attributed_orders: number
          attributed_revenue: number
          clicks: number
          cpc: number
          ctr: number
          id: string
          impressions: number
          item_id: string
          ml_user_id: string
          organization_id: string
          roas: number
          seller_id: string | null
          spend: number
          synced_at: string
          thumbnail: string | null
          title: string
          user_id: string
        }
        Insert: {
          attributed_orders?: number
          attributed_revenue?: number
          clicks?: number
          cpc?: number
          ctr?: number
          id?: string
          impressions?: number
          item_id: string
          ml_user_id?: string
          organization_id: string
          roas?: number
          seller_id?: string | null
          spend?: number
          synced_at?: string
          thumbnail?: string | null
          title?: string
          user_id: string
        }
        Update: {
          attributed_orders?: number
          attributed_revenue?: number
          clicks?: number
          cpc?: number
          ctr?: number
          id?: string
          impressions?: number
          item_id?: string
          ml_user_id?: string
          organization_id?: string
          roas?: number
          seller_id?: string | null
          spend?: number
          synced_at?: string
          thumbnail?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_products_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_ads_products_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_daily_cache: {
        Row: {
          approved_revenue: number
          cancelled_orders: number
          date: string
          id: string
          ml_user_id: string
          organization_id: string
          qty_orders: number
          seller_id: string | null
          shipped_orders: number
          synced_at: string
          total_revenue: number
          unique_buyers: number
          unique_visits: number
          units_sold: number
          user_id: string
        }
        Insert: {
          approved_revenue?: number
          cancelled_orders?: number
          date: string
          id?: string
          ml_user_id?: string
          organization_id: string
          qty_orders?: number
          seller_id?: string | null
          shipped_orders?: number
          synced_at?: string
          total_revenue?: number
          unique_buyers?: number
          unique_visits?: number
          units_sold?: number
          user_id: string
        }
        Update: {
          approved_revenue?: number
          cancelled_orders?: number
          date?: string
          id?: string
          ml_user_id?: string
          organization_id?: string
          qty_orders?: number
          seller_id?: string | null
          shipped_orders?: number
          synced_at?: string
          total_revenue?: number
          unique_buyers?: number
          unique_visits?: number
          units_sold?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_daily_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_daily_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_hourly_cache: {
        Row: {
          approved_revenue: number
          date: string
          hour: number
          id: string
          ml_user_id: string
          organization_id: string
          qty_orders: number
          seller_id: string | null
          synced_at: string
          total_revenue: number
          units_sold: number
          user_id: string
        }
        Insert: {
          approved_revenue?: number
          date: string
          hour: number
          id?: string
          ml_user_id?: string
          organization_id: string
          qty_orders?: number
          seller_id?: string | null
          synced_at?: string
          total_revenue?: number
          units_sold?: number
          user_id: string
        }
        Update: {
          approved_revenue?: number
          date?: string
          hour?: number
          id?: string
          ml_user_id?: string
          organization_id?: string
          qty_orders?: number
          seller_id?: string | null
          synced_at?: string
          total_revenue?: number
          units_sold?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_hourly_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_hourly_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_product_daily_cache: {
        Row: {
          date: string
          id: string
          item_id: string
          ml_user_id: string
          organization_id: string
          qty_sold: number
          revenue: number
          seller_id: string | null
          synced_at: string
          thumbnail: string | null
          title: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          item_id: string
          ml_user_id?: string
          organization_id: string
          qty_sold?: number
          revenue?: number
          seller_id?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string
          user_id: string
        }
        Update: {
          date?: string
          id?: string
          item_id?: string
          ml_user_id?: string
          organization_id?: string
          qty_sold?: number
          revenue?: number
          seller_id?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_product_daily_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_product_daily_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_state_daily_cache: {
        Row: {
          approved_revenue: number
          date: string
          id: string
          ml_user_id: string
          organization_id: string
          qty_orders: number
          revenue: number
          seller_id: string | null
          state_name: string
          synced_at: string
          uf: string
          user_id: string
        }
        Insert: {
          approved_revenue?: number
          date: string
          id?: string
          ml_user_id?: string
          organization_id: string
          qty_orders?: number
          revenue?: number
          seller_id?: string | null
          state_name?: string
          synced_at?: string
          uf: string
          user_id: string
        }
        Update: {
          approved_revenue?: number
          date?: string
          id?: string
          ml_user_id?: string
          organization_id?: string
          qty_orders?: number
          revenue?: number
          seller_id?: string | null
          state_name?: string
          synced_at?: string
          uf?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_state_daily_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_sync_log: {
        Row: {
          date_from: string
          date_to: string
          days_synced: number
          id: string
          ml_user_id: string
          orders_fetched: number
          organization_id: string
          seller_id: string | null
          source: string
          synced_at: string
          user_id: string
        }
        Insert: {
          date_from: string
          date_to: string
          days_synced?: number
          id?: string
          ml_user_id?: string
          orders_fetched?: number
          organization_id: string
          seller_id?: string | null
          source?: string
          synced_at?: string
          user_id: string
        }
        Update: {
          date_from?: string
          date_to?: string
          days_synced?: number
          id?: string
          ml_user_id?: string
          orders_fetched?: number
          organization_id?: string
          seller_id?: string | null
          source?: string
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_sync_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_sync_log_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_tax_config: {
        Row: {
          created_at: string
          effective_rate: number
          id: string
          lp_cofins: number | null
          lp_csll: number | null
          lp_irpj: number | null
          lp_pis: number | null
          lr_cofins_credito: number | null
          lr_cofins_debito: number | null
          lr_icms_aliquota_inter_norte_nordeste: number | null
          lr_icms_aliquota_inter_sul_sudeste: number | null
          lr_icms_aliquota_intra: number | null
          lr_icms_credito: number | null
          lr_icms_debito: number | null
          lr_pis_credito: number | null
          lr_pis_debito: number | null
          ml_user_id: string
          organization_id: string
          regime: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva: number | null
          uf_origem: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_rate?: number
          id?: string
          lp_cofins?: number | null
          lp_csll?: number | null
          lp_irpj?: number | null
          lp_pis?: number | null
          lr_cofins_credito?: number | null
          lr_cofins_debito?: number | null
          lr_icms_aliquota_inter_norte_nordeste?: number | null
          lr_icms_aliquota_inter_sul_sudeste?: number | null
          lr_icms_aliquota_intra?: number | null
          lr_icms_credito?: number | null
          lr_icms_debito?: number | null
          lr_pis_credito?: number | null
          lr_pis_debito?: number | null
          ml_user_id: string
          organization_id: string
          regime: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva?: number | null
          uf_origem?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_rate?: number
          id?: string
          lp_cofins?: number | null
          lp_csll?: number | null
          lp_irpj?: number | null
          lp_pis?: number | null
          lr_cofins_credito?: number | null
          lr_cofins_debito?: number | null
          lr_icms_aliquota_inter_norte_nordeste?: number | null
          lr_icms_aliquota_inter_sul_sudeste?: number | null
          lr_icms_aliquota_intra?: number | null
          lr_icms_credito?: number | null
          lr_icms_debito?: number | null
          lr_pis_credito?: number | null
          lr_pis_debito?: number | null
          ml_user_id?: string
          organization_id?: string
          regime?: Database["public"]["Enums"]["tax_regime"]
          sn_aliquota_efetiva?: number | null
          uf_origem?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_tax_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_tokens: {
        Row: {
          access_token: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          ml_user_id: string | null
          organization_id: string
          refresh_token: string | null
          scope: string | null
          seller_id: string | null
          token_type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ml_user_id?: string | null
          organization_id: string
          refresh_token?: string | null
          scope?: string | null
          seller_id?: string | null
          token_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ml_user_id?: string | null
          organization_id?: string
          refresh_token?: string | null
          scope?: string | null
          seller_id?: string | null
          token_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_tokens_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_user_cache: {
        Row: {
          active_listings: number
          country: string | null
          custom_name: string | null
          ml_user_id: number
          nickname: string | null
          organization_id: string
          permalink: string | null
          seller_id: string | null
          synced_at: string
          user_id: string
        }
        Insert: {
          active_listings?: number
          country?: string | null
          custom_name?: string | null
          ml_user_id: number
          nickname?: string | null
          organization_id: string
          permalink?: string | null
          seller_id?: string | null
          synced_at?: string
          user_id: string
        }
        Update: {
          active_listings?: number
          country?: string | null
          custom_name?: string | null
          ml_user_id?: number
          nickname?: string | null
          organization_id?: string
          permalink?: string | null
          seller_id?: string | null
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_user_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_user_cache_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cidade: string | null
          comissao: number | null
          comprador: string | null
          custo_unit: number | null
          data_pagamento: string | null
          data_pedido: string | null
          estado: string | null
          frete: number | null
          id: string
          item_id: string
          listing_type: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id: string | null
          preco_unit: number | null
          quantidade: number
          receita_bruta: number | null
          receita_liquida: number | null
          seller_id: string | null
          sku: string | null
          status: string | null
          synced_at: string
          tax_amount: number | null
          tax_rate: number | null
          titulo: string | null
          uf_origem: string | null
          user_id: string
          variation_id: string
        }
        Insert: {
          cidade?: string | null
          comissao?: number | null
          comprador?: string | null
          custo_unit?: number | null
          data_pagamento?: string | null
          data_pedido?: string | null
          estado?: string | null
          frete?: number | null
          id?: string
          item_id: string
          listing_type?: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id?: string | null
          preco_unit?: number | null
          quantidade?: number
          receita_bruta?: number | null
          receita_liquida?: number | null
          seller_id?: string | null
          sku?: string | null
          status?: string | null
          synced_at?: string
          tax_amount?: number | null
          tax_rate?: number | null
          titulo?: string | null
          uf_origem?: string | null
          user_id: string
          variation_id?: string
        }
        Update: {
          cidade?: string | null
          comissao?: number | null
          comprador?: string | null
          custo_unit?: number | null
          data_pagamento?: string | null
          data_pedido?: string | null
          estado?: string | null
          frete?: number | null
          id?: string
          item_id?: string
          listing_type?: string | null
          ml_order_id?: string
          ml_user_id?: string
          organization_id?: string | null
          preco_unit?: number | null
          quantidade?: number
          receita_bruta?: number | null
          receita_liquida?: number | null
          seller_id?: string | null
          sku?: string | null
          status?: string | null
          synced_at?: string
          tax_amount?: number | null
          tax_rate?: number | null
          titulo?: string | null
          uf_origem?: string | null
          user_id?: string
          variation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seller_stores: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          is_active: boolean
          marketplace: string
          organization_id: string
          seller_id: string
          store_name: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_active?: boolean
          marketplace: string
          organization_id: string
          seller_id: string
          store_name: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          is_active?: boolean
          marketplace?: string
          organization_id?: string
          seller_id?: string
          store_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_stores_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          created_at: string
          id: string
          initials: string | null
          is_active: boolean
          logo_url: string | null
          name: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          initials?: string | null
          is_active?: boolean
          logo_url?: string | null
          name: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          initials?: string | null
          is_active?: boolean
          logo_url?: string | null
          name?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sellers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_member_access_route: {
        Args: { _org_id: string; _route: string; _user_id: string }
        Returns: boolean
      }
      get_cache_table_stats: {
        Args: never
        Returns: {
          row_count: number
          table_name: string
          total_size: string
        }[]
      }
      get_cron_secret: { Args: never; Returns: string }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["org_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      insert_audit_log: {
        Args: {
          _action: string
          _actor_id: string
          _details?: Json
          _target_user_id?: string
        }
        Returns: undefined
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      trigger_ml_token_refresh: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      org_role: "owner" | "admin" | "member" | "viewer"
      tax_regime: "simples_nacional" | "lucro_presumido" | "lucro_real"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      org_role: ["owner", "admin", "member", "viewer"],
      tax_regime: ["simples_nacional", "lucro_presumido", "lucro_real"],
    },
  },
} as const
