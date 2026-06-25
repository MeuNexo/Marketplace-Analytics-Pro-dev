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
      action_audit_log: {
        Row: {
          action_id: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          from_status: string
          id: string
          organization_id: string
          to_status: string
        }
        Insert: {
          action_id: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_status: string
          id?: string
          organization_id: string
          to_status: string
        }
        Update: {
          action_id?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_status?: string
          id?: string
          organization_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_audit_log_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      commercial_analysis_snapshots: {
        Row: {
          brand: string | null
          created_at: string
          elasticity_class: string
          elasticity_pct: number
          id: string
          item_id: string
          ml_user_id: string
          organization_id: string
          period_end: string
          period_start: string
          price_curve: Json
          price_gmv: number
          price_margin: number
          price_neutral: number
          product_title: string
          strategy: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          elasticity_class: string
          elasticity_pct: number
          id?: string
          item_id: string
          ml_user_id: string
          organization_id: string
          period_end: string
          period_start: string
          price_curve: Json
          price_gmv: number
          price_margin: number
          price_neutral: number
          product_title: string
          strategy?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          elasticity_class?: string
          elasticity_pct?: number
          id?: string
          item_id?: string
          ml_user_id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          price_curve?: Json
          price_gmv?: number
          price_margin?: number
          price_neutral?: number
          product_title?: string
          strategy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_analysis_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultor_config: {
        Row: {
          acos_alert_pct: number
          ads_eating_alert_pct: number
          ads_eating_critical_pct: number
          ads_no_sale_days: number
          claims_spike_pct: number
          goal_risk_pct: number
          llm_enabled: boolean
          llm_model: string
          margin_alert_pct: number
          margin_critical_pct: number
          organization_id: string
          paused_ads_lookback_days: number
          roas_min: number
          stock_alert_days: number
          stock_critical_days: number
          tacos_alert_pct: number
          ticket_drop_pct: number
          updated_at: string
        }
        Insert: {
          acos_alert_pct?: number
          ads_eating_alert_pct?: number
          ads_eating_critical_pct?: number
          ads_no_sale_days?: number
          claims_spike_pct?: number
          goal_risk_pct?: number
          llm_enabled?: boolean
          llm_model?: string
          margin_alert_pct?: number
          margin_critical_pct?: number
          organization_id: string
          paused_ads_lookback_days?: number
          roas_min?: number
          stock_alert_days?: number
          stock_critical_days?: number
          tacos_alert_pct?: number
          ticket_drop_pct?: number
          updated_at?: string
        }
        Update: {
          acos_alert_pct?: number
          ads_eating_alert_pct?: number
          ads_eating_critical_pct?: number
          ads_no_sale_days?: number
          claims_spike_pct?: number
          goal_risk_pct?: number
          llm_enabled?: boolean
          llm_model?: string
          margin_alert_pct?: number
          margin_critical_pct?: number
          organization_id?: string
          paused_ads_lookback_days?: number
          roas_min?: number
          stock_alert_days?: number
          stock_critical_days?: number
          tacos_alert_pct?: number
          ticket_drop_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultor_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultor_health_snapshots: {
        Row: {
          created_at: string
          id: string
          insights_critical: number
          insights_total: number
          ml_user_id_key: string
          organization_id: string
          score: number
          score_ads: number
          score_completude: number
          score_estoque: number
          score_margin: number
          score_reputacao: number
          snapshot_month: string
        }
        Insert: {
          created_at?: string
          id?: string
          insights_critical?: number
          insights_total?: number
          ml_user_id_key?: string
          organization_id: string
          score: number
          score_ads?: number
          score_completude?: number
          score_estoque?: number
          score_margin?: number
          score_reputacao?: number
          snapshot_month: string
        }
        Update: {
          created_at?: string
          id?: string
          insights_critical?: number
          insights_total?: number
          ml_user_id_key?: string
          organization_id?: string
          score?: number
          score_ads?: number
          score_completude?: number
          score_estoque?: number
          score_margin?: number
          score_reputacao?: number
          snapshot_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultor_health_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          action_href: string
          action_label: string
          body: string
          category: string
          created_at: string
          dismissed_at: string | null
          id: string
          impact_brl: number | null
          ml_user_id: string | null
          ml_user_id_key: string
          organization_id: string
          resolved_at: string | null
          rule_key: string
          severity: string
          snooze_count: number
          snoozed_until: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_href: string
          action_label: string
          body: string
          category: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          impact_brl?: number | null
          ml_user_id?: string | null
          ml_user_id_key?: string
          organization_id: string
          resolved_at?: string | null
          rule_key: string
          severity: string
          snooze_count?: number
          snoozed_until?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_href?: string
          action_label?: string
          body?: string
          category?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          impact_brl?: number | null
          ml_user_id?: string | null
          ml_user_id_key?: string
          organization_id?: string
          resolved_at?: string | null
          rule_key?: string
          severity?: string
          snooze_count?: number
          snoozed_until?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_analysis_cache: {
        Row: {
          analysis_date: string
          analysis_text: string
          created_at: string
          id: string
          insight_count: number
          model_used: string
          organization_id: string
          prompt_hash: string | null
          prompt_version: string
          tokens_used: number | null
        }
        Insert: {
          analysis_date: string
          analysis_text: string
          created_at?: string
          id?: string
          insight_count?: number
          model_used: string
          organization_id: string
          prompt_hash?: string | null
          prompt_version?: string
          tokens_used?: number | null
        }
        Update: {
          analysis_date?: string
          analysis_text?: string
          created_at?: string
          id?: string
          insight_count?: number
          model_used?: string
          organization_id?: string
          prompt_hash?: string | null
          prompt_version?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_analysis_cache_organization_id_fkey"
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
      ml_billing_monthly: {
        Row: {
          charges: Json | null
          id: string
          ml_user_id: string
          organization_id: string
          period_month: string
          resumo: Json | null
          synced_at: string | null
        }
        Insert: {
          charges?: Json | null
          id?: string
          ml_user_id: string
          organization_id: string
          period_month: string
          resumo?: Json | null
          synced_at?: string | null
        }
        Update: {
          charges?: Json | null
          id?: string
          ml_user_id?: string
          organization_id?: string
          period_month?: string
          resumo?: Json | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_monthly_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      ml_inventory_cache: {
        Row: {
          available_quantity: number
          brand: string | null
          catalog_product_id: string | null
          category_id: string | null
          currency_id: string
          deal_ids: Json
          free_shipping: boolean
          has_variations: boolean
          health: number | null
          item_id: string
          listing_type_id: string | null
          logistic_type: string | null
          ml_user_id: string
          organization_id: string
          price: number | null
          seller_custom_field: string | null
          sold_quantity: number
          status: string | null
          synced_at: string
          thumbnail: string | null
          title: string | null
          variations: Json
          visits: number
        }
        Insert: {
          available_quantity?: number
          brand?: string | null
          catalog_product_id?: string | null
          category_id?: string | null
          currency_id?: string
          deal_ids?: Json
          free_shipping?: boolean
          has_variations?: boolean
          health?: number | null
          item_id: string
          listing_type_id?: string | null
          logistic_type?: string | null
          ml_user_id: string
          organization_id: string
          price?: number | null
          seller_custom_field?: string | null
          sold_quantity?: number
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string | null
          variations?: Json
          visits?: number
        }
        Update: {
          available_quantity?: number
          brand?: string | null
          catalog_product_id?: string | null
          category_id?: string | null
          currency_id?: string
          deal_ids?: Json
          free_shipping?: boolean
          has_variations?: boolean
          health?: number | null
          item_id?: string
          listing_type_id?: string | null
          logistic_type?: string | null
          ml_user_id?: string
          organization_id?: string
          price?: number | null
          seller_custom_field?: string | null
          sold_quantity?: number
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string | null
          variations?: Json
          visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_inventory_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_product_costs: {
        Row: {
          cost: number | null
          created_at: string
          id: string
          item_id: string
          organization_id: string | null
          seller_sku: string | null
          tax_rate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          id?: string
          item_id: string
          organization_id?: string | null
          seller_sku?: string | null
          tax_rate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          id?: string
          item_id?: string
          organization_id?: string | null
          seller_sku?: string | null
          tax_rate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          tiny_access_token: string | null
          tiny_expires_at: number | null
          tiny_refresh_token: string | null
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
          tiny_access_token?: string | null
          tiny_expires_at?: number | null
          tiny_refresh_token?: string | null
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
          tiny_access_token?: string | null
          tiny_expires_at?: number | null
          tiny_refresh_token?: string | null
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
      onboarding_progress: {
        Row: {
          completed_at: string | null
          completed_steps: string[]
          current_step: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: string[]
          current_step?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_steps?: string[]
          current_step?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
          marca: string | null
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
          user_id: string | null
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
          marca?: string | null
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
          user_id?: string | null
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
          marca?: string | null
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
          user_id?: string | null
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
      organization_plans: {
        Row: {
          created_at: string
          history_days: number
          organization_id: string
          plan_tier: Database["public"]["Enums"]["plan_tier"]
          sync_interval_minutes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          history_days?: number
          organization_id: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          sync_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          history_days?: number
          organization_id?: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          sync_interval_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
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
      proposed_actions: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          current_value: Json | null
          dry_run_preview: Json | null
          estimated_impact_brl: number | null
          executed_at: string | null
          id: string
          insight_id: string | null
          ml_user_id: string | null
          organization_id: string
          proposed_by: string
          proposed_value: Json
          result_summary: string | null
          rule_key: string
          status: string
          target_ref: string
          updated_at: string
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_value?: Json | null
          dry_run_preview?: Json | null
          estimated_impact_brl?: number | null
          executed_at?: string | null
          id?: string
          insight_id?: string | null
          ml_user_id?: string | null
          organization_id: string
          proposed_by: string
          proposed_value: Json
          result_summary?: string | null
          rule_key: string
          status?: string
          target_ref: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_value?: Json | null
          dry_run_preview?: Json | null
          estimated_impact_brl?: number | null
          executed_at?: string | null
          id?: string
          insight_id?: string | null
          ml_user_id?: string | null
          organization_id?: string
          proposed_by?: string
          proposed_value?: Json
          result_summary?: string | null
          rule_key?: string
          status?: string
          target_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposed_actions_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      replenishment_params: {
        Row: {
          created_at: string
          id: string
          lead_time_dias: number
          meta_cobertura_dias: number
          moq: number
          organization_id: string
          pack_multiple: number
          safety_days: number
          scope: string
          scope_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_time_dias?: number
          meta_cobertura_dias?: number
          moq?: number
          organization_id: string
          pack_multiple?: number
          safety_days?: number
          scope?: string
          scope_value?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_time_dias?: number
          meta_cobertura_dias?: number
          moq?: number
          organization_id?: string
          pack_multiple?: number
          safety_days?: number
          scope?: string
          scope_value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "replenishment_params_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      sync_jobs: {
        Row: {
          created_at: string
          date_from: string | null
          date_to: string | null
          error_msg: string | null
          finished_at: string | null
          id: string
          job_type: Database["public"]["Enums"]["sync_job_type"]
          ml_user_id: string
          organization_id: string
          retries: number
          started_at: string | null
          status: Database["public"]["Enums"]["sync_job_status"]
        }
        Insert: {
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["sync_job_type"]
          ml_user_id: string
          organization_id: string
          retries?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
        }
        Update: {
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["sync_job_type"]
          ml_user_id?: string
          organization_id?: string
          retries?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_quota_daily: {
        Row: {
          date: string
          organization_id: string
          sync_count: number
        }
        Insert: {
          date: string
          organization_id: string
          sync_count?: number
        }
        Update: {
          date?: string
          organization_id?: string
          sync_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_quota_daily_organization_id_fkey"
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
      claim_next_sync_job: {
        Args: never
        Returns: {
          created_at: string
          date_from: string | null
          date_to: string | null
          error_msg: string | null
          finished_at: string | null
          id: string
          job_type: Database["public"]["Enums"]["sync_job_type"]
          ml_user_id: string
          organization_id: string
          retries: number
          started_at: string | null
          status: Database["public"]["Enums"]["sync_job_status"]
        }
        SetofOptions: {
          from: "*"
          to: "sync_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispatch_inventory_jobs: { Args: never; Returns: number }
      dispatch_orders_jobs: { Args: never; Returns: undefined }
      dispatch_sales_jobs: { Args: never; Returns: undefined }
      dispatch_sync_jobs: { Args: never; Returns: number }
      get_cache_table_stats: {
        Args: never
        Returns: {
          row_count: number
          table_name: string
          total_size: string
        }[]
      }
      get_margin_with_ads_by_product: {
        Args: {
          p_org_id: string
          p_user_ids: string[]
          p_from: string
          p_to: string
        }
        Returns: {
          item_id: string
          titulo: string | null
          sku: string | null
          listing_type: string | null
          receita: number
          cmv: number
          comissao: number
          frete: number
          impostos: number
          lucro: number
          lucro_pct: number | null
          pedidos: number
          unidades: number
          has_cmv: boolean
          ads_spend: number
          ads_attributed_orders: number
          lucro_pos_ads: number
          lucro_pct_pos_ads: number | null
          ads_no_sale: boolean
        }[]
      }
      get_cron_secret: { Args: never; Returns: string }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      get_replenishment: {
        Args: {
          p_org_id: string
          p_sales_window_days?: number
          p_demand_multiplier?: number
        }
        Returns: {
          item_id: string
          title: string | null
          brand: string | null
          logistic_type: string | null
          estoque_atual: number
          venda_dia: number
          cobertura_atual: number | null
          ponto_reposicao: number
          alvo: number
          compra_sugerida: number
          valor_estimado: number | null
          custo_ausente: boolean
          sem_giro: boolean
          gatilho_ativo: boolean
          param_lead_time: number
          param_cobertura: number
          param_safety: number
          param_moq: number
          param_pack: number
          param_origem: string
        }[]
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
      plan_tier: "free" | "starter" | "pro" | "enterprise"
      sync_job_status: "pending" | "running" | "completed" | "failed"
      sync_job_type: "daily_cache" | "orders" | "inventory"
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
      plan_tier: ["free", "starter", "pro", "enterprise"],
      sync_job_status: ["pending", "running", "completed", "failed"],
      sync_job_type: ["daily_cache", "orders", "inventory"],
      tax_regime: ["simples_nacional", "lucro_presumido", "lucro_real"],
    },
  },
} as const
