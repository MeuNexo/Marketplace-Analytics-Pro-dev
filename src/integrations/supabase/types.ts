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
    PostgrestVersion: "14.5"
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
      cash_inflows: {
        Row: {
          created_at: string
          description: string | null
          gross_amount: number | null
          id: string
          ml_order_id: string | null
          ml_user_id: number
          net_amount: number
          organization_id: string
          payment_id: string
          payment_method: string | null
          refund_date: string | null
          release_date: string
          status_mp: string | null
          synced_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          gross_amount?: number | null
          id?: string
          ml_order_id?: string | null
          ml_user_id: number
          net_amount: number
          organization_id: string
          payment_id: string
          payment_method?: string | null
          refund_date?: string | null
          release_date: string
          status_mp?: string | null
          synced_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          gross_amount?: number | null
          id?: string
          ml_order_id?: string | null
          ml_user_id?: number
          net_amount?: number
          organization_id?: string
          payment_id?: string
          payment_method?: string | null
          refund_date?: string | null
          release_date?: string
          status_mp?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_inflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_outflows: {
        Row: {
          amount: number
          category: string | null
          competence_date: string | null
          created_at: string
          description: string
          document_number: string | null
          id: string
          organization_id: string
          outflow_date: string
          source: string
          status: string
          supplier: string | null
          synced_at: string
          tiny_payable_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          competence_date?: string | null
          created_at?: string
          description: string
          document_number?: string | null
          id?: string
          organization_id: string
          outflow_date: string
          source?: string
          status?: string
          supplier?: string | null
          synced_at?: string
          tiny_payable_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          competence_date?: string | null
          created_at?: string
          description?: string
          document_number?: string | null
          id?: string
          organization_id?: string
          outflow_date?: string
          source?: string
          status?: string
          supplier?: string | null
          synced_at?: string
          tiny_payable_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_outflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_forecast_snapshot: {
        Row: {
          created_at: string
          deflator: number | null
          fonte: string
          horizon_days: number | null
          organization_id: string
          snapshot_date: string
          target_date: string
          valor_previsto: number
        }
        Insert: {
          created_at?: string
          deflator?: number | null
          fonte: string
          horizon_days?: number | null
          organization_id: string
          snapshot_date: string
          target_date: string
          valor_previsto: number
        }
        Update: {
          created_at?: string
          deflator?: number | null
          fonte?: string
          horizon_days?: number | null
          organization_id?: string
          snapshot_date?: string
          target_date?: string
          valor_previsto?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_forecast_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cat_backfill_queue: {
        Row: {
          attempts: number
          ml_user_id: string
          organization_id: string
          req_id: number | null
          status: string
          tiny_payable_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          ml_user_id: string
          organization_id: string
          req_id?: number | null
          status?: string
          tiny_payable_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          ml_user_id?: string
          organization_id?: string
          req_id?: number | null
          status?: string
          tiny_payable_id?: string
          updated_at?: string
        }
        Relationships: []
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
      dre_month_close: {
        Row: {
          closed_at: string
          closed_by: string | null
          competence_month: string
          organization_id: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          competence_month: string
          organization_id: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          competence_month?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dre_month_close_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_settings: {
        Row: {
          alert_threshold: number
          balance_anchor_date: string | null
          created_at: string
          id: string
          initial_balance: number
          operational_cost_rate: number
          organization_id: string
          safety_margin: number
          updated_at: string
        }
        Insert: {
          alert_threshold?: number
          balance_anchor_date?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          operational_cost_rate?: number
          organization_id: string
          safety_margin?: number
          updated_at?: string
        }
        Update: {
          alert_threshold?: number
          balance_anchor_date?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          operational_cost_rate?: number
          organization_id?: string
          safety_margin?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_reposicao_baseline: {
        Row: {
          compra_sugerida: number | null
          gatilho_ativo: boolean | null
          item_id: string | null
          sku_code: string | null
          sku_stock: number | null
          variation_id: string | null
          venda_dia: number | null
          venda_dia_origem: string | null
        }
        Insert: {
          compra_sugerida?: number | null
          gatilho_ativo?: boolean | null
          item_id?: string | null
          sku_code?: string | null
          sku_stock?: number | null
          variation_id?: string | null
          venda_dia?: number | null
          venda_dia_origem?: string | null
        }
        Update: {
          compra_sugerida?: number | null
          gatilho_ativo?: boolean | null
          item_id?: string | null
          sku_code?: string | null
          sku_stock?: number | null
          variation_id?: string | null
          venda_dia?: number | null
          venda_dia_origem?: string | null
        }
        Relationships: []
      }
      gate_reposicao_v2: {
        Row: {
          compra_sugerida: number | null
          divergencia_full: number | null
          estoque_cd: number | null
          estoque_centro: number | null
          estoque_full: number | null
          gatilho_ativo: boolean | null
          item_id: string | null
          origem_catalogo: string | null
          sku_code: string | null
          sku_stock: number | null
          tem_anuncio_ativo: boolean | null
          venda_dia: number | null
        }
        Insert: {
          compra_sugerida?: number | null
          divergencia_full?: number | null
          estoque_cd?: number | null
          estoque_centro?: number | null
          estoque_full?: number | null
          gatilho_ativo?: boolean | null
          item_id?: string | null
          origem_catalogo?: string | null
          sku_code?: string | null
          sku_stock?: number | null
          tem_anuncio_ativo?: boolean | null
          venda_dia?: number | null
        }
        Update: {
          compra_sugerida?: number | null
          divergencia_full?: number | null
          estoque_cd?: number | null
          estoque_centro?: number | null
          estoque_full?: number | null
          gatilho_ativo?: boolean | null
          item_id?: string | null
          origem_catalogo?: string | null
          sku_code?: string | null
          sku_stock?: number | null
          tem_anuncio_ativo?: boolean | null
          venda_dia?: number | null
        }
        Relationships: []
      }
      icms_uf_aliquotas: {
        Row: {
          aliq_interestadual: number
          aliq_interna: number
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          fcp: number
          fonte: string
          id: string
          observacao: string | null
          procedencia: string
          uf: string
          updated_at: string
          vigencia_fim: string | null
          vigencia_inicio: string
        }
        Insert: {
          aliq_interestadual: number
          aliq_interna: number
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          fcp?: number
          fonte: string
          id?: string
          observacao?: string | null
          procedencia?: string
          uf: string
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio: string
        }
        Update: {
          aliq_interestadual?: number
          aliq_interna?: number
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          fcp?: number
          fonte?: string
          id?: string
          observacao?: string | null
          procedencia?: string
          uf?: string
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string
        }
        Relationships: []
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
      ml_ads_daily_pre_221: {
        Row: {
          attributed_orders: number | null
          attributed_revenue: number | null
          clicks: number | null
          cpc: number | null
          ctr: number | null
          date: string | null
          id: string | null
          impressions: number | null
          ml_user_id: string | null
          organization_id: string | null
          roas: number | null
          seller_id: string | null
          spend: number | null
          synced_at: string | null
          user_id: string | null
        }
        Insert: {
          attributed_orders?: number | null
          attributed_revenue?: number | null
          clicks?: number | null
          cpc?: number | null
          ctr?: number | null
          date?: string | null
          id?: string | null
          impressions?: number | null
          ml_user_id?: string | null
          organization_id?: string | null
          roas?: number | null
          seller_id?: string | null
          spend?: number | null
          synced_at?: string | null
          user_id?: string | null
        }
        Update: {
          attributed_orders?: number | null
          attributed_revenue?: number | null
          clicks?: number | null
          cpc?: number | null
          ctr?: number | null
          date?: string | null
          id?: string | null
          impressions?: number | null
          ml_user_id?: string | null
          organization_id?: string | null
          roas?: number | null
          seller_id?: string | null
          spend?: number | null
          synced_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ml_ads_products_cache: {
        Row: {
          attributed_orders: number
          attributed_revenue: number
          clicks: number
          cpc: number
          ctr: number
          date: string
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
          date?: string
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
          date?: string
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
      ml_billing_daily: {
        Row: {
          amount: number
          charge_date: string
          charge_label: string | null
          charge_type: string
          competence_date: string
          id: string
          ml_user_id: string
          organization_id: string
          source_invoice_key: string
          synced_at: string | null
        }
        Insert: {
          amount: number
          charge_date: string
          charge_label?: string | null
          charge_type: string
          competence_date: string
          id?: string
          ml_user_id: string
          organization_id: string
          source_invoice_key: string
          synced_at?: string | null
        }
        Update: {
          amount?: number
          charge_date?: string
          charge_label?: string | null
          charge_type?: string
          competence_date?: string
          id?: string
          ml_user_id?: string
          organization_id?: string
          source_invoice_key?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      ml_billing_moves_stage: {
        Row: {
          amount: number | null
          charge_date: string | null
          charge_label: string | null
          charge_type: string | null
          detail_id: number
          invoice_key: string
          is_bonus: boolean
          ml_user_id: string
          organization_id: string
          sale_date: string | null
        }
        Insert: {
          amount?: number | null
          charge_date?: string | null
          charge_label?: string | null
          charge_type?: string | null
          detail_id: number
          invoice_key: string
          is_bonus?: boolean
          ml_user_id: string
          organization_id: string
          sale_date?: string | null
        }
        Update: {
          amount?: number | null
          charge_date?: string | null
          charge_label?: string | null
          charge_type?: string | null
          detail_id?: number
          invoice_key?: string
          is_bonus?: boolean
          ml_user_id?: string
          organization_id?: string
          sale_date?: string | null
        }
        Relationships: []
      }
      ml_billing_page_cursor: {
        Row: {
          done: boolean
          from_id: number
          grp: string
          invoice_key: string
          ml_user_id: string
          organization_id: string
          paginas: number
          updated_at: string
        }
        Insert: {
          done?: boolean
          from_id?: number
          grp: string
          invoice_key: string
          ml_user_id: string
          organization_id: string
          paginas?: number
          updated_at?: string
        }
        Update: {
          done?: boolean
          from_id?: number
          grp?: string
          invoice_key?: string
          ml_user_id?: string
          organization_id?: string
          paginas?: number
          updated_at?: string
        }
        Relationships: []
      }
      ml_billing_sync_state: {
        Row: {
          erro: string | null
          linhas: number
          ml_user_id: string
          ok: boolean
          organization_id: string | null
          period_month: string | null
          ultima_tentativa: string
          ultimo_sucesso: string | null
        }
        Insert: {
          erro?: string | null
          linhas?: number
          ml_user_id: string
          ok?: boolean
          organization_id?: string | null
          period_month?: string | null
          ultima_tentativa?: string
          ultimo_sucesso?: string | null
        }
        Update: {
          erro?: string | null
          linhas?: number
          ml_user_id?: string
          ok?: boolean
          organization_id?: string | null
          period_month?: string | null
          ultima_tentativa?: string
          ultimo_sucesso?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_sync_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_claim_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_claim_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_claims: {
        Row: {
          action_due_date: string | null
          available_actions: Json | null
          claim_id: string
          data_abertura: string | null
          data_limite: string | null
          id: string
          ml_user_id: string
          motivo: string | null
          motivo_texto: string | null
          order_id: string | null
          organization_id: string
          pending_action_type: string | null
          seller_action_required: boolean
          solucao: string | null
          stage: string | null
          status: string
          synced_at: string | null
          tipo: string
        }
        Insert: {
          action_due_date?: string | null
          available_actions?: Json | null
          claim_id: string
          data_abertura?: string | null
          data_limite?: string | null
          id?: string
          ml_user_id: string
          motivo?: string | null
          motivo_texto?: string | null
          order_id?: string | null
          organization_id: string
          pending_action_type?: string | null
          seller_action_required?: boolean
          solucao?: string | null
          stage?: string | null
          status?: string
          synced_at?: string | null
          tipo?: string
        }
        Update: {
          action_due_date?: string | null
          available_actions?: Json | null
          claim_id?: string
          data_abertura?: string | null
          data_limite?: string | null
          id?: string
          ml_user_id?: string
          motivo?: string | null
          motivo_texto?: string | null
          order_id?: string | null
          organization_id?: string
          pending_action_type?: string | null
          seller_action_required?: boolean
          solucao?: string | null
          stage?: string | null
          status?: string
          synced_at?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_claims_organization_id_fkey"
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
          units_sold: number | null
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
          units_sold?: number | null
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
          units_sold?: number | null
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
          units_sold: number | null
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
          units_sold?: number | null
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
          units_sold?: number | null
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
      ml_mco_targets: {
        Row: {
          id: string
          item_id: string
          organization_id: string
          sku: string
          target_mco_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          item_id: string
          organization_id: string
          sku?: string
          target_mco_pct: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          organization_id?: string
          sku?: string
          target_mco_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_mco_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_order_sale_fee: {
        Row: {
          capturado_em: string
          charge_bonified_id: number | null
          charge_status: string | null
          charge_status_description: string | null
          detail_amount: number | null
          detail_id: number
          detail_sub_type: string | null
          detail_type: string | null
          item_id: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id: string
        }
        Insert: {
          capturado_em?: string
          charge_bonified_id?: number | null
          charge_status?: string | null
          charge_status_description?: string | null
          detail_amount?: number | null
          detail_id: number
          detail_sub_type?: string | null
          detail_type?: string | null
          item_id?: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id: string
        }
        Update: {
          capturado_em?: string
          charge_bonified_id?: number | null
          charge_status?: string | null
          charge_status_description?: string | null
          detail_amount?: number | null
          detail_id?: number
          detail_sub_type?: string | null
          detail_type?: string | null
          item_id?: string | null
          ml_order_id?: string
          ml_user_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_sale_fee_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_order_sale_fee_captura: {
        Row: {
          capturado_em: string | null
          comissao_linhas: number | null
          discount_reason: string | null
          http_status: number | null
          linhas: number
          ml_order_id: string
          ml_user_id: string
          organization_id: string
          proxima_tentativa: string | null
          sale_fee_discount: number | null
          sale_fee_gross: number | null
          sale_fee_net: number | null
          sale_fee_rebate: number | null
          status: string
          tem_estorno: boolean
          tentativas: number
          ultima_tentativa: string
        }
        Insert: {
          capturado_em?: string | null
          comissao_linhas?: number | null
          discount_reason?: string | null
          http_status?: number | null
          linhas?: number
          ml_order_id: string
          ml_user_id: string
          organization_id: string
          proxima_tentativa?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          status: string
          tem_estorno?: boolean
          tentativas?: number
          ultima_tentativa?: string
        }
        Update: {
          capturado_em?: string | null
          comissao_linhas?: number | null
          discount_reason?: string | null
          http_status?: number | null
          linhas?: number
          ml_order_id?: string
          ml_user_id?: string
          organization_id?: string
          proxima_tentativa?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          status?: string
          tem_estorno?: boolean
          tentativas?: number
          ultima_tentativa?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_sale_fee_captura_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_order_sale_fee_captura_pre_hap: {
        Row: {
          capturado_em: string | null
          comissao_linhas: number | null
          discount_reason: string | null
          http_status: number | null
          linhas: number | null
          ml_order_id: string | null
          ml_user_id: string | null
          organization_id: string | null
          proxima_tentativa: string | null
          sale_fee_discount: number | null
          sale_fee_gross: number | null
          sale_fee_net: number | null
          sale_fee_rebate: number | null
          status: string | null
          tem_estorno: boolean | null
          tentativas: number | null
          ultima_tentativa: string | null
        }
        Insert: {
          capturado_em?: string | null
          comissao_linhas?: number | null
          discount_reason?: string | null
          http_status?: number | null
          linhas?: number | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          proxima_tentativa?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          status?: string | null
          tem_estorno?: boolean | null
          tentativas?: number | null
          ultima_tentativa?: string | null
        }
        Update: {
          capturado_em?: string | null
          comissao_linhas?: number | null
          discount_reason?: string | null
          http_status?: number | null
          linhas?: number | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          proxima_tentativa?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          status?: string | null
          tem_estorno?: boolean | null
          tentativas?: number | null
          ultima_tentativa?: string | null
        }
        Relationships: []
      }
      ml_product_costs: {
        Row: {
          cost: number | null
          cost_full: number | null
          created_at: string
          id: string
          item_id: string
          notes: string | null
          organization_id: string
          seller_sku: string | null
          tax_rate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cost?: number | null
          cost_full?: number | null
          created_at?: string
          id?: string
          item_id: string
          notes?: string | null
          organization_id: string
          seller_sku?: string | null
          tax_rate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cost?: number | null
          cost_full?: number | null
          created_at?: string
          id?: string
          item_id?: string
          notes?: string | null
          organization_id?: string
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
          marca: string | null
          ml_user_id: string
          organization_id: string
          qty_sold: number
          revenue: number
          seller_id: string | null
          seller_sku: string | null
          synced_at: string
          thumbnail: string | null
          title: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          item_id: string
          marca?: string | null
          ml_user_id?: string
          organization_id: string
          qty_sold?: number
          revenue?: number
          seller_id?: string | null
          seller_sku?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string
          user_id: string
        }
        Update: {
          date?: string
          id?: string
          item_id?: string
          marca?: string | null
          ml_user_id?: string
          organization_id?: string
          qty_sold?: number
          revenue?: number
          seller_id?: string | null
          seller_sku?: string | null
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
      ml_questions: {
        Row: {
          comprador_id: string | null
          data_pergunta: string | null
          data_resposta: string | null
          id: string
          item_id: string | null
          item_title: string | null
          ml_user_id: string
          organization_id: string
          question_id: number
          resposta: string | null
          status: string
          synced_at: string | null
          texto: string
        }
        Insert: {
          comprador_id?: string | null
          data_pergunta?: string | null
          data_resposta?: string | null
          id?: string
          item_id?: string | null
          item_title?: string | null
          ml_user_id: string
          organization_id: string
          question_id: number
          resposta?: string | null
          status?: string
          synced_at?: string | null
          texto: string
        }
        Update: {
          comprador_id?: string | null
          data_pergunta?: string | null
          data_resposta?: string | null
          id?: string
          item_id?: string | null
          item_title?: string | null
          ml_user_id?: string
          organization_id?: string
          question_id?: number
          resposta?: string | null
          status?: string
          synced_at?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_sale_fee_sync_config: {
        Row: {
          atualizado_em: string
          backfill_desde: string
          habilitado: boolean
          ml_user_id: string
          observacao: string | null
          organization_id: string
        }
        Insert: {
          atualizado_em?: string
          backfill_desde: string
          habilitado?: boolean
          ml_user_id: string
          observacao?: string | null
          organization_id: string
        }
        Update: {
          atualizado_em?: string
          backfill_desde?: string
          habilitado?: boolean
          ml_user_id?: string
          observacao?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_sale_fee_sync_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
        ]
      }
      ml_targets: {
        Row: {
          id: string
          kpi_targets: Json | null
          marketplace_id: string
          month: number
          pmt_distribution: Json
          seller_id: string
          target_id: string
          target_value: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          id?: string
          kpi_targets?: Json | null
          marketplace_id?: string
          month: number
          pmt_distribution?: Json
          seller_id: string
          target_id: string
          target_value?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          id?: string
          kpi_targets?: Json | null
          marketplace_id?: string
          month?: number
          pmt_distribution?: Json
          seller_id?: string
          target_id?: string
          target_value?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      ml_tax_config: {
        Row: {
          created_at: string
          difal_ufs_cobradas_pelo_ml: string[] | null
          difal_ufs_recolhidas: string[] | null
          effective_rate: number
          flex_custo_entrega: number | null
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
          vigencia_fim: string | null
          vigencia_inicio: string
        }
        Insert: {
          created_at?: string
          difal_ufs_cobradas_pelo_ml?: string[] | null
          difal_ufs_recolhidas?: string[] | null
          effective_rate?: number
          flex_custo_entrega?: number | null
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
          vigencia_fim?: string | null
          vigencia_inicio: string
        }
        Update: {
          created_at?: string
          difal_ufs_cobradas_pelo_ml?: string[] | null
          difal_ufs_recolhidas?: string[] | null
          effective_rate?: number
          flex_custo_entrega?: number | null
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
          vigencia_fim?: string | null
          vigencia_inicio?: string
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
          sync_enabled: boolean
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
          sync_enabled?: boolean
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
          sync_enabled?: boolean
          tiny_access_token?: string | null
          tiny_expires_at?: number | null
          tiny_refresh_token?: string | null
          token_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      nexo_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_memories: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          created_by: string | null
          has_numbers: boolean
          id: string
          organization_id: string
          scope: string
          source_conversation_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          has_numbers?: boolean
          id?: string
          organization_id: string
          scope: string
          source_conversation_id?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          has_numbers?: boolean
          id?: string
          organization_id?: string
          scope?: string
          source_conversation_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nexo_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexo_memories_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "nexo_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          role: string
          used_tools: Json
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          role: string
          used_tools?: Json
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          used_tools?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nexo_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "nexo_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexo_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          bonus_envio: number | null
          cidade: string | null
          comissao: number | null
          comprador: string | null
          credito_icms_frete: number | null
          credito_pc_comissao: number | null
          credito_pc_frete: number | null
          custo_entrega: number | null
          custo_unit: number | null
          custo_unit_cheio: number | null
          data_pagamento: string | null
          data_pedido: string | null
          difal_amount: number | null
          difal_base: number | null
          difal_fonte: string | null
          estado: string | null
          fcp_amount: number | null
          frete: number | null
          frete_comprador: number | null
          icms_debito: number | null
          id: string
          item_id: string
          listing_type: string | null
          logistic_type: string | null
          marca: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id: string | null
          pis_cofins_debito: number | null
          pis_cofins_debito_com_difal: number | null
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
          tax_versao: number | null
          titulo: string | null
          uf_origem: string | null
          user_id: string | null
          variation_id: string
        }
        Insert: {
          bonus_envio?: number | null
          cidade?: string | null
          comissao?: number | null
          comprador?: string | null
          credito_icms_frete?: number | null
          credito_pc_comissao?: number | null
          credito_pc_frete?: number | null
          custo_entrega?: number | null
          custo_unit?: number | null
          custo_unit_cheio?: number | null
          data_pagamento?: string | null
          data_pedido?: string | null
          difal_amount?: number | null
          difal_base?: number | null
          difal_fonte?: string | null
          estado?: string | null
          fcp_amount?: number | null
          frete?: number | null
          frete_comprador?: number | null
          icms_debito?: number | null
          id?: string
          item_id: string
          listing_type?: string | null
          logistic_type?: string | null
          marca?: string | null
          ml_order_id: string
          ml_user_id: string
          organization_id?: string | null
          pis_cofins_debito?: number | null
          pis_cofins_debito_com_difal?: number | null
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
          tax_versao?: number | null
          titulo?: string | null
          uf_origem?: string | null
          user_id?: string | null
          variation_id?: string
        }
        Update: {
          bonus_envio?: number | null
          cidade?: string | null
          comissao?: number | null
          comprador?: string | null
          credito_icms_frete?: number | null
          credito_pc_comissao?: number | null
          credito_pc_frete?: number | null
          custo_entrega?: number | null
          custo_unit?: number | null
          custo_unit_cheio?: number | null
          data_pagamento?: string | null
          data_pedido?: string | null
          difal_amount?: number | null
          difal_base?: number | null
          difal_fonte?: string | null
          estado?: string | null
          fcp_amount?: number | null
          frete?: number | null
          frete_comprador?: number | null
          icms_debito?: number | null
          id?: string
          item_id?: string
          listing_type?: string | null
          logistic_type?: string | null
          marca?: string | null
          ml_order_id?: string
          ml_user_id?: string
          organization_id?: string | null
          pis_cofins_debito?: number | null
          pis_cofins_debito_com_difal?: number | null
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
          tax_versao?: number | null
          titulo?: string | null
          uf_origem?: string | null
          user_id?: string | null
          variation_id?: string
        }
        Relationships: []
      }
      orders_pre_222: {
        Row: {
          bonus_envio: number | null
          comissao: number | null
          credito_icms_frete: number | null
          credito_pc_comissao: number | null
          credito_pc_frete: number | null
          custo_entrega: number | null
          custo_unit: number | null
          custo_unit_cheio: number | null
          data_pedido: string | null
          difal_amount: number | null
          difal_base: number | null
          difal_fonte: string | null
          estado: string | null
          fcp_amount: number | null
          frete: number | null
          icms_debito: number | null
          id: string | null
          item_id: string | null
          logistic_type: string | null
          ml_order_id: string | null
          ml_user_id: string | null
          organization_id: string | null
          pis_cofins_debito: number | null
          pis_cofins_debito_com_difal: number | null
          preco_unit: number | null
          quantidade: number | null
          receita_bruta: number | null
          receita_liquida: number | null
          sku: string | null
          snapshot_em: string | null
          status: string | null
          synced_at: string | null
          tax_amount: number | null
          tax_rate: number | null
          tax_versao: number | null
          uf_origem: string | null
        }
        Insert: {
          bonus_envio?: number | null
          comissao?: number | null
          credito_icms_frete?: number | null
          credito_pc_comissao?: number | null
          credito_pc_frete?: number | null
          custo_entrega?: number | null
          custo_unit?: number | null
          custo_unit_cheio?: number | null
          data_pedido?: string | null
          difal_amount?: number | null
          difal_base?: number | null
          difal_fonte?: string | null
          estado?: string | null
          fcp_amount?: number | null
          frete?: number | null
          icms_debito?: number | null
          id?: string | null
          item_id?: string | null
          logistic_type?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          pis_cofins_debito?: number | null
          pis_cofins_debito_com_difal?: number | null
          preco_unit?: number | null
          quantidade?: number | null
          receita_bruta?: number | null
          receita_liquida?: number | null
          sku?: string | null
          snapshot_em?: string | null
          status?: string | null
          synced_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          tax_versao?: number | null
          uf_origem?: string | null
        }
        Update: {
          bonus_envio?: number | null
          comissao?: number | null
          credito_icms_frete?: number | null
          credito_pc_comissao?: number | null
          credito_pc_frete?: number | null
          custo_entrega?: number | null
          custo_unit?: number | null
          custo_unit_cheio?: number | null
          data_pedido?: string | null
          difal_amount?: number | null
          difal_base?: number | null
          difal_fonte?: string | null
          estado?: string | null
          fcp_amount?: number | null
          frete?: number | null
          icms_debito?: number | null
          id?: string | null
          item_id?: string | null
          logistic_type?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          pis_cofins_debito?: number | null
          pis_cofins_debito_com_difal?: number | null
          preco_unit?: number | null
          quantidade?: number | null
          receita_bruta?: number | null
          receita_liquida?: number | null
          sku?: string | null
          snapshot_em?: string | null
          status?: string | null
          synced_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          tax_versao?: number | null
          uf_origem?: string | null
        }
        Relationships: []
      }
      orders_pre_clamp_ikj: {
        Row: {
          data_pedido: string | null
          id: string | null
          ml_order_id: string | null
          ml_user_id: string | null
          receita_liquida: number | null
          snapshot_em: string | null
          tax_amount: number | null
          tax_rate: number | null
        }
        Insert: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          receita_liquida?: number | null
          snapshot_em?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
        }
        Update: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          receita_liquida?: number | null
          snapshot_em?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
        }
        Relationships: []
      }
      orders_pre_rl_jic: {
        Row: {
          data_pedido: string | null
          id: string | null
          ml_order_id: string | null
          ml_user_id: string | null
          receita_liquida: number | null
          snapshot_em: string | null
          tax_amount: number | null
          tax_versao: number | null
        }
        Insert: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          receita_liquida?: number | null
          snapshot_em?: string | null
          tax_amount?: number | null
          tax_versao?: number | null
        }
        Update: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          receita_liquida?: number | null
          snapshot_em?: string | null
          tax_amount?: number | null
          tax_versao?: number | null
        }
        Relationships: []
      }
      orders_pre_tax_junior_ago: {
        Row: {
          item_id: string | null
          ml_order_id: string | null
          ml_user_id: string | null
          organization_id: string | null
          receita_liquida: number | null
          snapshot_at: string | null
          tax_amount: number | null
          tax_rate: number | null
          variation_id: string | null
        }
        Insert: {
          item_id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          receita_liquida?: number | null
          snapshot_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          variation_id?: string | null
        }
        Update: {
          item_id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          receita_liquida?: number | null
          snapshot_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          variation_id?: string | null
        }
        Relationships: []
      }
      orders_pre_tax_junior_jul: {
        Row: {
          data_pedido: string | null
          id: string | null
          ml_order_id: string | null
          receita_bruta: number | null
          snapshot_em: string | null
          status: string | null
          tax_amount: number | null
          tax_rate: number | null
        }
        Insert: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          receita_bruta?: number | null
          snapshot_em?: string | null
          status?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
        }
        Update: {
          data_pedido?: string | null
          id?: string | null
          ml_order_id?: string | null
          receita_bruta?: number | null
          snapshot_em?: string | null
          status?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
        }
        Relationships: []
      }
      orders_pre_tax_recalc_220: {
        Row: {
          item_id: string | null
          ml_order_id: string | null
          ml_user_id: string | null
          organization_id: string | null
          receita_liquida: number | null
          snapshot_at: string | null
          tax_amount: number | null
          tax_rate: number | null
          variation_id: string | null
        }
        Insert: {
          item_id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          receita_liquida?: number | null
          snapshot_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          variation_id?: string | null
        }
        Update: {
          item_id?: string | null
          ml_order_id?: string | null
          ml_user_id?: string | null
          organization_id?: string | null
          receita_liquida?: number | null
          snapshot_at?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          variation_id?: string | null
        }
        Relationships: []
      }
      orders_status_reconciliation: {
        Row: {
          data_pedido: string | null
          id: number
          ml_order_id: string
          motivo: string
          organization_id: string
          receita_bruta: number | null
          reconciliado_em: string
          status_antes: string
          status_depois: string
          tax_amount: number | null
        }
        Insert: {
          data_pedido?: string | null
          id?: number
          ml_order_id: string
          motivo: string
          organization_id: string
          receita_bruta?: number | null
          reconciliado_em?: string
          status_antes: string
          status_depois: string
          tax_amount?: number | null
        }
        Update: {
          data_pedido?: string | null
          id?: number
          ml_order_id?: string
          motivo?: string
          organization_id?: string
          receita_bruta?: number | null
          reconciliado_em?: string
          status_antes?: string
          status_depois?: string
          tax_amount?: number | null
        }
        Relationships: []
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
      product_materials: {
        Row: {
          codigo_modelo: string
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          fonte: string
          id: string
          marca: string
          material: string
          modelo_nome: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          codigo_modelo: string
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          fonte: string
          id?: string
          marca: string
          material: string
          modelo_nome?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          codigo_modelo?: string
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          fonte?: string
          id?: string
          marca?: string
          material?: string
          modelo_nome?: string | null
          organization_id?: string
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
      purchase_orders: {
        Row: {
          data_entrega: string | null
          data_pedido: string | null
          descricao: string | null
          fornecedor: string | null
          id: string
          id_ordem_compra: string
          ml_user_id: string
          numero_pedido: string | null
          organization_id: string
          preco_unitario: number | null
          quantidade: number
          situacao: string | null
          sku: string
          synced_at: string
        }
        Insert: {
          data_entrega?: string | null
          data_pedido?: string | null
          descricao?: string | null
          fornecedor?: string | null
          id?: string
          id_ordem_compra: string
          ml_user_id: string
          numero_pedido?: string | null
          organization_id: string
          preco_unitario?: number | null
          quantidade?: number
          situacao?: string | null
          sku: string
          synced_at?: string
        }
        Update: {
          data_entrega?: string | null
          data_pedido?: string | null
          descricao?: string | null
          fornecedor?: string | null
          id?: string
          id_ordem_compra?: string
          ml_user_id?: string
          numero_pedido?: string | null
          organization_id?: string
          preco_unitario?: number | null
          quantidade?: number
          situacao?: string | null
          sku?: string
          synced_at?: string
        }
        Relationships: []
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
      rpc_backup_214: {
        Row: {
          definicao: string | null
          proname: string | null
          salvo_em: string | null
        }
        Insert: {
          definicao?: string | null
          proname?: string | null
          salvo_em?: string | null
        }
        Update: {
          definicao?: string | null
          proname?: string | null
          salvo_em?: string | null
        }
        Relationships: []
      }
      saldo_declarado: {
        Row: {
          abertura_ancorada: number | null
          created_at: string
          data_declarada: string
          declarado_por: string
          entradas_do_dia: number | null
          entradas_liquidadas: number | null
          entradas_pendentes: number | null
          fonte: string
          id: string
          initial_balance: number | null
          observacao: string | null
          organization_id: string
          saidas_do_dia: number | null
          saidas_pagas: number | null
          saldo_exibido: number | null
          saldo_real: number
        }
        Insert: {
          abertura_ancorada?: number | null
          created_at?: string
          data_declarada: string
          declarado_por?: string
          entradas_do_dia?: number | null
          entradas_liquidadas?: number | null
          entradas_pendentes?: number | null
          fonte?: string
          id?: string
          initial_balance?: number | null
          observacao?: string | null
          organization_id: string
          saidas_do_dia?: number | null
          saidas_pagas?: number | null
          saldo_exibido?: number | null
          saldo_real: number
        }
        Update: {
          abertura_ancorada?: number | null
          created_at?: string
          data_declarada?: string
          declarado_por?: string
          entradas_do_dia?: number | null
          entradas_liquidadas?: number | null
          entradas_pendentes?: number | null
          fonte?: string
          id?: string
          initial_balance?: number | null
          observacao?: string | null
          organization_id?: string
          saidas_do_dia?: number | null
          saidas_pagas?: number | null
          saldo_exibido?: number | null
          saldo_real?: number
        }
        Relationships: [
          {
            foreignKeyName: "saldo_declarado_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_data: {
        Row: {
          ano: number
          created_at: string
          dia: number
          id: string
          marketplace: string
          mes: number
          organization_id: string | null
          pedidos: number
          receita: number
          seller_id: string
          unidades: number
          updated_at: string
        }
        Insert: {
          ano: number
          created_at?: string
          dia: number
          id?: string
          marketplace: string
          mes: number
          organization_id?: string | null
          pedidos?: number
          receita?: number
          seller_id: string
          unidades?: number
          updated_at?: string
        }
        Update: {
          ano?: number
          created_at?: string
          dia?: number
          id?: string
          marketplace?: string
          mes?: number
          organization_id?: string | null
          pedidos?: number
          receita?: number
          seller_id?: string
          unidades?: number
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
      supplier_calendar_versions: {
        Row: {
          calendar_id: string | null
          calendario_valido_ate: string | null
          confirmado_em: string | null
          confirmado_por: string | null
          data_corte_pedido: string | null
          data_entrega_prevista: string | null
          fonte: string | null
          fornecedor: string
          gravado_em: string
          gravado_por: string | null
          id: string
          material: string | null
          motivo: string
          organization_id: string
          para_em: string | null
          retoma_em: string | null
        }
        Insert: {
          calendar_id?: string | null
          calendario_valido_ate?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          data_corte_pedido?: string | null
          data_entrega_prevista?: string | null
          fonte?: string | null
          fornecedor: string
          gravado_em?: string
          gravado_por?: string | null
          id?: string
          material?: string | null
          motivo: string
          organization_id: string
          para_em?: string | null
          retoma_em?: string | null
        }
        Update: {
          calendar_id?: string | null
          calendario_valido_ate?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          data_corte_pedido?: string | null
          data_entrega_prevista?: string | null
          fonte?: string | null
          fornecedor?: string
          gravado_em?: string
          gravado_por?: string | null
          id?: string
          material?: string | null
          motivo?: string
          organization_id?: string
          para_em?: string | null
          retoma_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_calendar_versions_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "supplier_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_calendars: {
        Row: {
          ano: number
          calendario_valido_ate: string | null
          calendario_valido_de: string | null
          confirmado_em: string | null
          confirmado_por: string | null
          corte_padrao_dias_antes: number
          created_at: string
          fonte: string | null
          fornecedor: string
          id: string
          organization_id: string
          para_em: string | null
          regra_pedido_misto: string | null
          retoma_em: string | null
          updated_at: string
        }
        Insert: {
          ano: number
          calendario_valido_ate?: string | null
          calendario_valido_de?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          corte_padrao_dias_antes?: number
          created_at?: string
          fonte?: string | null
          fornecedor: string
          id?: string
          organization_id: string
          para_em?: string | null
          regra_pedido_misto?: string | null
          retoma_em?: string | null
          updated_at?: string
        }
        Update: {
          ano?: number
          calendario_valido_ate?: string | null
          calendario_valido_de?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          corte_padrao_dias_antes?: number
          created_at?: string
          fonte?: string | null
          fornecedor?: string
          id?: string
          organization_id?: string
          para_em?: string | null
          regra_pedido_misto?: string | null
          retoma_em?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_lots: {
        Row: {
          aceita_complemento: boolean
          calendar_id: string | null
          complemento_ate: string | null
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          data_corte_pedido: string | null
          data_entrega_prevista: string
          fonte: string | null
          fornecedor: string
          id: string
          lote_nome: string
          material: string
          observacao: string | null
          organization_id: string
          ultimo_lote_do_ano: boolean
          updated_at: string
        }
        Insert: {
          aceita_complemento?: boolean
          calendar_id?: string | null
          complemento_ate?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          data_corte_pedido?: string | null
          data_entrega_prevista: string
          fonte?: string | null
          fornecedor: string
          id?: string
          lote_nome: string
          material: string
          observacao?: string | null
          organization_id: string
          ultimo_lote_do_ano?: boolean
          updated_at?: string
        }
        Update: {
          aceita_complemento?: boolean
          calendar_id?: string | null
          complemento_ate?: string | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          data_corte_pedido?: string | null
          data_entrega_prevista?: string
          fonte?: string | null
          fornecedor?: string
          id?: string
          lote_nome?: string
          material?: string
          observacao?: string | null
          organization_id?: string
          ultimo_lote_do_ano?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_lots_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "supplier_calendars"
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
      tiny_products: {
        Row: {
          ml_user_id: string
          nome: string | null
          organization_id: string
          situacao: string | null
          sku: string
          synced_at: string
          tiny_id: string
          tipo_variacao: string | null
        }
        Insert: {
          ml_user_id: string
          nome?: string | null
          organization_id: string
          situacao?: string | null
          sku: string
          synced_at?: string
          tiny_id: string
          tipo_variacao?: string | null
        }
        Update: {
          ml_user_id?: string
          nome?: string | null
          organization_id?: string
          situacao?: string | null
          sku?: string
          synced_at?: string
          tiny_id?: string
          tipo_variacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_stock: {
        Row: {
          deposito: string
          disponivel: number
          ml_user_id: string
          organization_id: string
          saldo: number
          sku: string
          synced_at: string
          tiny_id: string
        }
        Insert: {
          deposito: string
          disponivel?: number
          ml_user_id: string
          organization_id: string
          saldo?: number
          sku: string
          synced_at?: string
          tiny_id: string
        }
        Update: {
          deposito?: string
          disponivel?: number
          ml_user_id?: string
          organization_id?: string
          saldo?: number
          sku?: string
          synced_at?: string
          tiny_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiny_stock_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_sync_cursor: {
        Row: {
          erros: number
          fase: string
          fila: Json
          indice: number
          ml_user_id: string
          organization_id: string
          ultimo_erro: string | null
          updated_at: string
          volta_completa: string | null
          volta_iniciada: string | null
        }
        Insert: {
          erros?: number
          fase?: string
          fila?: Json
          indice?: number
          ml_user_id: string
          organization_id: string
          ultimo_erro?: string | null
          updated_at?: string
          volta_completa?: string | null
          volta_iniciada?: string | null
        }
        Update: {
          erros?: number
          fase?: string
          fila?: Json
          indice?: number
          ml_user_id?: string
          organization_id?: string
          ultimo_erro?: string | null
          updated_at?: string
          volta_completa?: string | null
          volta_iniciada?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_sync_cursor_organization_id_fkey"
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
      cashflow_forecast_snapshot_health: {
        Row: {
          amostra_ainda_provisoria: boolean | null
          dias_congelados: number | null
          dias_desde_o_ultimo: number | null
          linhas: number | null
          organizacao: string | null
          organization_id: string | null
          parou_de_congelar: boolean | null
          primeiro_snapshot: string | null
          ultimo_snapshot: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_forecast_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_billing_sync_health: {
        Row: {
          erro: string | null
          linhas: number | null
          ml_user_id: string | null
          nunca_sincronizou: boolean | null
          ok: boolean | null
          organizacao: string | null
          organization_id: string | null
          parado_ha_mais_de_48h: boolean | null
          precisa_atencao: boolean | null
          ultima_tentativa: string | null
          ultimo_sucesso: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_sync_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_difal_cobrado_por_dia: {
        Row: {
          charge_date: string | null
          difal_cobrado: number | null
          lancamentos: number | null
          ml_user_id: string | null
          organization_id: string | null
          pedidos_interestaduais_no_dia: number | null
          receita_interestadual_no_dia: number | null
          ufs_do_dia: string[] | null
        }
        Relationships: []
      }
      ml_order_sale_fee_identidade_suspeita: {
        Row: {
          discount_reason: string | null
          ml_order_id: string | null
          organization_id: string | null
          sale_fee_discount: number | null
          sale_fee_gross: number | null
          sale_fee_net: number | null
          sale_fee_rebate: number | null
          sobra: number | null
        }
        Insert: {
          discount_reason?: string | null
          ml_order_id?: string | null
          organization_id?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          sobra?: never
        }
        Update: {
          discount_reason?: string | null
          ml_order_id?: string | null
          organization_id?: string | null
          sale_fee_discount?: number | null
          sale_fee_gross?: number | null
          sale_fee_net?: number | null
          sale_fee_rebate?: number | null
          sobra?: never
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_sale_fee_captura_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders_frete_health: {
        Row: {
          dia: string | null
          frete_total: number | null
          ml_user_id: string | null
          organizacao: string | null
          organization_id: string | null
          pct_sem_frete: number | null
          pedidos: number | null
          precisa_atencao: boolean | null
          receita_sem_frete: number | null
          sem_frete: number | null
          ultimo_sync: string | null
        }
        Relationships: []
      }
      orders_regua_health: {
        Row: {
          mes: string | null
          ml_user_id: string | null
          organization_id: string | null
          pedido_mais_antigo_regua_antiga: string | null
          pedidos_difal_ausente_destino_interestadual: number | null
          pedidos_difal_calculado: number | null
          pedidos_difal_cobrado_ml: number | null
          pedidos_difal_nao_conciliado: number | null
          pedidos_frete_comprador_nulo: number | null
          pedidos_frete_comprador_zero: number | null
          pedidos_frete_e_frete_comprador_positivos: number | null
          pedidos_frete_igual_frete_comprador: number | null
          pedidos_logistic_type_nulo: number | null
          pedidos_regua_antiga: number | null
          pedidos_regua_nova: number | null
          pedidos_self_service: number | null
          pedidos_self_service_bonus_nulo: number | null
          pedidos_self_service_custo_entrega_nulo: number | null
          pedidos_self_service_frete_nulo: number | null
          total_pedidos: number | null
        }
        Relationships: []
      }
      orders_sync_health: {
        Row: {
          organization_id: string | null
          pedido_mais_recente: string | null
          pedidos_hoje: number | null
          sync_atrasado: boolean | null
          ultimo_sync: string | null
        }
        Relationships: []
      }
      tiny_stock_health: {
        Row: {
          desatualizado: boolean | null
          erros: number | null
          estoque_mais_recente: string | null
          indice: number | null
          ml_user_id: string | null
          organization_id: string | null
          pct_volta: number | null
          skus_com_estoque: number | null
          total_fila: number | null
          ultimo_erro: string | null
          volta_completa: string | null
          volta_iniciada: string | null
        }
        Insert: {
          desatualizado?: never
          erros?: number | null
          estoque_mais_recente?: never
          indice?: number | null
          ml_user_id?: string | null
          organization_id?: string | null
          pct_volta?: never
          skus_com_estoque?: never
          total_fila?: never
          ultimo_erro?: string | null
          volta_completa?: string | null
          volta_iniciada?: string | null
        }
        Update: {
          desatualizado?: never
          erros?: number | null
          estoque_mais_recente?: never
          indice?: number | null
          ml_user_id?: string | null
          organization_id?: string | null
          pct_volta?: never
          skus_com_estoque?: never
          total_fila?: never
          ultimo_erro?: string | null
          volta_completa?: string | null
          volta_iniciada?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_sync_cursor_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _backtest_curve_raw: {
        Args: {
          p_corte_min?: string
          p_deflator_span?: number
          p_excluir_fantasmas?: boolean
          p_h_max?: number
          p_maturacao_dias?: number
          p_org_id: string
        }
        Returns: {
          agregacao: string
          corrigido: boolean
          escopo: string
          horizon_days: number
          n: number
          soma_erro_abs: number
          soma_erro_sinal: number
          soma_previsto: number
          soma_realizado: number
        }[]
      }
      _backtest_errors_raw: {
        Args: {
          p_corte_min?: string
          p_deflator_span?: number
          p_excluir_fantasmas?: boolean
          p_h_max?: number
          p_maturacao_dias?: number
          p_org_id: string
        }
        Returns: {
          agregacao: string
          corrigido: boolean
          corte: string
          erro: number
          escopo: string
          horizon_days: number
          previsto: number
          realizado: number
        }[]
      }
      ads_backfill_kick: { Args: { p_n?: number }; Returns: number }
      ads_cache_daily_totals: {
        Args: { p_from: string; p_ml_user_ids: string[]; p_to: string }
        Returns: {
          dia: string
          total_spend: number
        }[]
      }
      aliquota_interna_vigente: {
        Args: { p_data?: string }
        Returns: {
          aliq_interestadual: number
          aliq_interna: number
          confirmado: boolean
          fcp: number
          pct_difal: number
          procedencia: string
          uf: string
        }[]
      }
      avaliar_billing_sync: { Args: never; Returns: undefined }
      batch_upsert_orders: { Args: { p_records: Json }; Returns: number }
      can_member_access_route: {
        Args: { _org_id: string; _route: string; _user_id: string }
        Returns: boolean
      }
      check_quota: { Args: { _org_id: string }; Returns: boolean }
      claim_approved_action: {
        Args: { p_action_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "proposed_actions"
          isOneToOne: true
          isSetofReturn: false
        }
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
      difal_efeito_liquido: {
        Args: {
          p_difal: number
          p_fcp: number
          p_pc_debito: number
          p_pc_debito_com_difal: number
        }
        Returns: number
      }
      dispatch_ads_jobs:
        | { Args: never; Returns: number }
        | { Args: { p_apenas_hoje: boolean }; Returns: number }
      dispatch_inventory_jobs: { Args: never; Returns: number }
      dispatch_orders_jobs:
        | { Args: never; Returns: undefined }
        | { Args: { p_incluir_hoje?: boolean }; Returns: undefined }
      dispatch_sales_jobs: { Args: never; Returns: undefined }
      dispatch_sync_jobs: { Args: never; Returns: number }
      dre_bloco_for_category: { Args: { p_category: string }; Returns: string }
      enrich_enqueue_new: { Args: never; Returns: Json }
      enrich_harvest: { Args: never; Returns: Json }
      enrich_payable_step: { Args: { p_batch?: number }; Returns: Json }
      enrich_reenqueue_outros: { Args: never; Returns: Json }
      get_app_secret: { Args: { p_name: string }; Returns: string }
      get_cache_table_stats: {
        Args: never
        Returns: {
          row_count: number
          table_name: string
          total_size: string
        }[]
      }
      get_cancelled_revenue: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cancelled_orders: number
          cancelled_revenue: number
        }[]
      }
      get_cash_cycle: {
        Args: { p_janela_dias?: number; p_org_id: string }
        Returns: {
          cmv_diario: number
          cmv_pedidos: number
          dpo_dias: number
          dpo_n: number
          dso_dias: number
          dso_n: number
          dso_no_limite: boolean
          janela_dias: number
          skus_sem_custo: number
          unidades_estoque: number
          unidades_sem_custo: number
          valor_estoque: number
        }[]
      }
      get_cashflow: {
        Args: {
          p_end_date: string
          p_include_purchase_forecasts?: boolean
          p_org_id: string
          p_start_date: string
        }
        Returns: {
          accumulated_balance: number
          accumulated_balance_sma: number
          daily_balance: number
          daily_expense: number
          daily_income: number
          daily_projection: number
          date: string
        }[]
      }
      get_cashflow_data_health: {
        Args: { p_org_id: string }
        Returns: {
          anchor_date: string
          anchor_days_ago: number
          anchor_stale: boolean
          mp_hours_ago: number
          mp_last_sync: string
          mp_stale: boolean
          tiny_hours_ago: number
          tiny_last_sync: string
          tiny_stale: boolean
        }[]
      }
      get_cmv_cheio_gaps: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          linhas: number
          marca: string
          receita: number
          sku: string
          tem_custo_medio: boolean
          unidades: number
        }[]
      }
      get_confianca_do_saldo: {
        Args: {
          p_horizonte_maximo?: number
          p_horizonte_minimo?: number
          p_org_id: string
        }
        Returns: {
          confianca_pct: number
          erro_pct: number
          horizon_days: number
          medivel_em: string
          motivo_ausencia: string
          n_pares: number
          primeiro_alvo: string
          soma_previsto: number
          soma_real: number
          ultimo_alvo: string
        }[]
      }
      get_consultor_coverage: {
        Args: { p_from: string; p_org_id: string }
        Returns: {
          avg_daily: number
          coverage_days: number
          item_id: string
          price: number
          title: string
        }[]
      }
      get_consultor_margin_by_product: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          item_id: string
          lucro: number
          lucro_pct: number
          receita: number
        }[]
      }
      get_consultor_no_cost_count: {
        Args: { p_org_id: string }
        Returns: number
      }
      get_consultor_paused_with_sales: {
        Args: { p_from: string; p_org_id: string }
        Returns: {
          item_id: string
          price: number
          title: string
          vendas_30d: number
        }[]
      }
      get_conversion_funnel: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          compradores: number
          cvr_pct: number
          dia: string
          pedidos: number
          receita: number
          ticket_medio: number
          unidades: number
          visitas: number
        }[]
      }
      get_cost_by_month: {
        Args: { p_months?: number; p_org_id: string }
        Returns: {
          category: string
          month: string
          total: number
        }[]
      }
      get_cost_waterfall: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cmv: number
          cmv_cheio: number
          orders_count: number
          paid_revenue: number
          total_comissao: number
          total_frete: number
          total_tax: number
        }[]
      }
      get_cron_secret: { Args: never; Returns: string }
      get_daily_balance: {
        Args: { p_org_id: string; p_target_date: string }
        Returns: {
          entradas_estado_desconhecido: number
          entradas_hoje: number
          entradas_liquidadas: number
          entradas_pendentes: number
          saidas_canceladas: number
          saidas_estado_desconhecido: number
          saidas_hoje: number
          saidas_pagas: number
          saldo_agora: number
          saldo_final_previsto: number
          saldo_inicial: number
        }[]
      }
      get_difal_summary: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          difal_calculado: number
          difal_cobrado_ml: number
          difal_previsto_nas_ufs_cobradas: number
          difal_recolhido_pela_loja: number
          fcp_calculado: number
          pedidos_com_difal: number
          pedidos_difal_indefinido: number
          pedidos_nao_conciliados: number
          receita_base: number
          reducao_pc_por_difal: number
          regua_cobranca_configurada: boolean
          regua_recolhimento_configurada: boolean
        }[]
      }
      get_dre_cash: {
        Args: { p_month: string; p_org_id: string }
        Returns: {
          bloco: string
          categoria: string
          n: number
          secao: string
          total: number
        }[]
      }
      get_dre_cash_forecast: {
        Args: { p_month: string; p_org_id: string }
        Returns: {
          categoria: string
          n: number
          secao: string
          total: number
        }[]
      }
      get_dre_cash_history: {
        Args: { p_months: number; p_org_id: string }
        Returns: {
          entradas: number
          mes: string
          resultado: number
          saidas: number
        }[]
      }
      get_dre_cash_items: {
        Args: { p_bloco: string; p_month: string; p_org_id: string }
        Returns: {
          amount: number
          category: string
          document_number: string
          outflow_date: string
          supplier: string
        }[]
      }
      get_dre_nao_classificado_items: {
        Args: { p_month: string; p_org_id: string }
        Returns: {
          amount: number
          category: string
          competence_month: string
          description: string
          document_number: string
          outflow_date: string
          supplier: string
        }[]
      }
      get_dre_operational_by_competence: {
        Args: { p_month: string; p_org_id: string }
        Returns: {
          bloco: string
          category: string
          double_count_risk: boolean
          n: number
          total: number
        }[]
      }
      get_estorno_deflator: {
        Args: {
          p_asof?: string
          p_maturacao_dias?: number
          p_org_id: string
          p_span_dias?: number
        }
        Returns: number
      }
      get_estorno_serie_diaria: {
        Args: { p_dias?: number; p_org_id: string }
        Returns: {
          dia: string
          n_parcelas: number
          valor_estornado: number
          valor_liberado: number
        }[]
      }
      get_forecast_backtest_curve: {
        Args: {
          p_corte_min?: string
          p_deflator_span?: number
          p_excluir_fantasmas?: boolean
          p_h_max?: number
          p_maturacao_dias?: number
          p_org_id: string
        }
        Returns: {
          agregacao: string
          corrigido: boolean
          erro_absoluto_medio: number
          erro_medio: number
          escopo: string
          horizon_days: number
          n: number
          soma_previsto: number
          soma_realizado: number
        }[]
      }
      get_forecast_backtest_errors: {
        Args: {
          p_corte_min?: string
          p_deflator_span?: number
          p_excluir_fantasmas?: boolean
          p_h_max?: number
          p_maturacao_dias?: number
          p_org_id: string
        }
        Returns: {
          agregacao: string
          corrigido: boolean
          corte: string
          erro: number
          escopo: string
          horizon_days: number
          previsto: number
          realizado: number
        }[]
      }
      get_imposto_guia_by_competence: {
        Args: { p_competence: string; p_org_id: string }
        Returns: {
          category: string
          n: number
          status: string
          total: number
        }[]
      }
      get_imposto_provisao_erro: {
        Args: { p_meses?: number; p_org_id: string }
        Returns: {
          competencia_apuracao: string
          faturamento: number
          guia_apuracao_m_mais_1: number
          guia_caixa_no_mes: number
          mes_venda: string
          n_guias_caixa: number
          n_linhas_apuracao: number
          n_meses_base: number
          provisao_prevista: number
          taxa_media_prevista: number
        }[]
      }
      get_inss_guia_by_competence: {
        Args: { p_competence: string; p_org_id: string }
        Returns: {
          category: string
          n: number
          status: string
          total: number
        }[]
      }
      get_kpi_summary: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cmv: number
          cmv_has_cost: boolean
          gross_revenue: number
          has_tax_data: boolean
          total_comissao: number
          total_frete: number
          total_tax: number
        }[]
      }
      get_listings_without_sku: {
        Args: { p_org_id: string }
        Returns: {
          estoque: number
          item_id: string
          preco: number
          ruptura_invisivel: boolean
          status: string
          titulo: string
          url_editar: string
          valor_em_risco: number
        }[]
      }
      get_margin_by_brand: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cmv: number
          comissao: number
          frete: number
          has_cmv: boolean
          impostos: number
          lucro: number
          lucro_pct: number
          marca: string
          pedidos: number
          receita: number
        }[]
      }
      get_margin_by_day: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cmv: number
          comissao: number
          date: string
          frete: number
          impostos: number
          lucro: number
          lucro_pct: number
          pedidos: number
          receita: number
        }[]
      }
      get_margin_by_estado: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          estado: string
          lucro: number
          lucro_pct: number
          pedidos: number
          receita: number
        }[]
      }
      get_margin_by_product:
        | {
            Args: {
              p_from: string
              p_org_id: string
              p_to: string
              p_user_ids: string[]
            }
            Returns: {
              cmv: number
              comissao: number
              frete: number
              has_cmv: boolean
              impostos: number
              item_id: string
              listing_type: string
              lucro: number
              lucro_pct: number
              pedidos: number
              receita: number
              sku: string
              titulo: string
              unidades: number
            }[]
          }
        | {
            Args: {
              p_from: string
              p_limit: number
              p_org_id: string
              p_to: string
              p_user_ids: string[]
            }
            Returns: {
              cmv: number
              comissao: number
              frete: number
              has_cmv: boolean
              impostos: number
              item_id: string
              listing_type: string
              lucro: number
              lucro_pct: number
              pedidos: number
              receita: number
              sku: string
              titulo: string
              unidades: number
            }[]
          }
      get_margin_summary: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          cmv: number
          comissao: number
          frete: number
          impostos: number
          lucro: number
          lucro_pct: number
          pedidos: number
          receita: number
          ticket_medio: number
          unidades: number
        }[]
      }
      get_margin_with_ads_by_product: {
        Args: {
          p_from: string
          p_org_id: string
          p_to: string
          p_user_ids: string[]
        }
        Returns: {
          ads_attributed_orders: number
          ads_no_sale: boolean
          ads_spend: number
          cmv: number
          comissao: number
          difal_efeito: number
          frete: number
          has_cmv: boolean
          impostos: number
          item_id: string
          listing_type: string
          lucro: number
          lucro_com_difal: number
          lucro_pct: number
          lucro_pct_com_difal: number
          lucro_pct_pos_ads: number
          lucro_pct_pos_ads_com_difal: number
          lucro_pct_pos_ads_sem_rebate: number
          lucro_pct_sem_rebate: number
          lucro_pos_ads: number
          lucro_pos_ads_com_difal: number
          lucro_pos_ads_sem_rebate: number
          lucro_sem_rebate: number
          marca: string
          pedidos: number
          pedidos_difal_indefinido: number
          pedidos_rebate_nao_conferido: number
          pedidos_sem_captura_rebate: number
          rebate_bruto: number
          rebate_efeito: number
          receita: number
          sku: string
          titulo: string
          unidades: number
        }[]
      }
      get_ml_access_token_for_integration: {
        Args: { p_ml_user_id: string }
        Returns: Json
      }
      get_ml_token_for_service: {
        Args: { p_org_id: string }
        Returns: {
          access_token: string
          expires_at: string
        }[]
      }
      get_movimentos_por_liquidacao: {
        Args: { p_dia: string; p_org_id: string }
        Returns: {
          entradas_estado_desconhecido: number
          entradas_liquidadas: number
          entradas_pendentes: number
          saidas_canceladas: number
          saidas_estado_desconhecido: number
          saidas_pagas: number
          saidas_previstas: number
        }[]
      }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      get_projected_balance_summary: {
        Args: {
          p_include_purchase_forecasts?: boolean
          p_org_id: string
          p_projection_days: number
        }
        Returns: {
          confirmed_income: number
          critical_date: string
          current_balance: number
          min_balance: number
          pessimistic_balance: number
          realistic_balance: number
          total_expenses: number
        }[]
      }
      get_purchase_order_suppliers: {
        Args: { p_org_id: string }
        Returns: {
          fornecedor: string
        }[]
      }
      get_replenishment: {
        Args: {
          p_demand_multiplier?: number
          p_org_id: string
          p_sales_window_days?: number
        }
        Returns: {
          alvo: number
          brand: string
          cobertura_atual: number
          compra_sugerida: number
          custo_ausente: boolean
          estoque_atual: number
          gatilho_ativo: boolean
          item_id: string
          logistic_type: string
          param_cobertura: number
          param_lead_time: number
          param_moq: number
          param_origem: string
          param_pack: number
          param_safety: number
          ponto_reposicao: number
          sem_giro: boolean
          title: string
          valor_estimado: number
          venda_dia: number
        }[]
      }
      get_replenishment_by_sku: {
        Args: {
          p_demand_multiplier?: number
          p_org_id: string
          p_sales_window_days?: number
          p_smart?: boolean
        }
        Returns: {
          alvo: number
          attribute_combinations: Json
          brand: string
          cobertura_atual: number
          compra_sugerida: number
          custo_ausente: boolean
          data_proxima_chegada: string
          divergencia_full: number
          estoque_cd: number
          estoque_centro: number
          estoque_full: number
          fator_sazonal: number
          gatilho_ativo: boolean
          item_id: string
          lead_time_origem: string
          lead_time_real: number
          logistic_type: string
          origem_catalogo: string
          param_cobertura: number
          param_lead_time: number
          param_moq: number
          param_origem: string
          param_pack: number
          param_safety: number
          ponto_reposicao: number
          qtd_a_caminho: number
          sem_giro: boolean
          sku_code: string
          sku_stock: number
          status_esgotado: string
          tem_anuncio_ativo: boolean
          tendencia: string
          title: string
          valor_estimado: number
          variation_id: string
          venda_dia: number
          venda_dia_origem: string
          venda_inteligente: number
          venda_simples: number
        }[]
      }
      get_rolled_opening_balance:
        | { Args: { p_org_id: string }; Returns: number }
        | { Args: { p_as_of: string; p_org_id: string }; Returns: number }
      get_sales_velocity: {
        Args: {
          p_days?: number
          p_limit?: number
          p_min_units?: number
          p_org_id: string
        }
        Returns: {
          alerta_ruptura: boolean
          dias_cobertura: number
          estoque_atual: number
          receita: number
          sku: string
          titulo: string
          unidades: number
          unidades_por_dia: number
        }[]
      }
      get_supplier_exposure: {
        Args: { p_org_id: string; p_top_n?: number }
        Returns: {
          amount_30d: number
          amount_60d: number
          amount_90d: number
          supplier: string
        }[]
      }
      get_treasury_panel: {
        Args: {
          p_horizon?: number
          p_include_purchase_forecasts?: boolean
          p_org_id: string
        }
        Returns: {
          alert_date: string
          alert_threshold: number
          burn_rate: number
          entrada_real_30d: number
          fornec_30d: number
          fornec_60d: number
          fornec_90d: number
          min_balance: number
          min_balance_date: string
          saida_real_30d: number
          total_exposicao: number
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
      orders_price_timeseries: {
        Args: {
          _from?: string
          _granularity?: string
          _item_id: string
          _ml_user_ids?: string[]
          _sku?: string
          _to?: string
        }
        Returns: {
          bucket: string
          cmv: number
          comissao: number
          difal_efeito: number
          frete: number
          impostos: number
          orders: number
          pedidos_difal_indefinido: number
          pedidos_rebate_nao_conferido: number
          pedidos_sem_captura_rebate: number
          preco_max: number
          preco_medio: number
          preco_min: number
          qtd: number
          qtd_sem_custo: number
          qtd_sem_imposto: number
          rebate_bruto: number
          rebate_efeito: number
          total: number
        }[]
      }
      orders_sold_products_agg: {
        Args: { _from?: string; _ml_user_ids?: string[]; _to?: string }
        Returns: {
          item_id: string
          marca: string
          pedidos: number
          quantidade: number
          receita_bruta: number
          titulo: string
        }[]
      }
      rebate_efeito_liquido: {
        Args: {
          p_comissao: number
          p_credito_pc_comissao: number
          p_rebate: number
        }
        Returns: number
      }
      resync_billing_daily_current_month: { Args: never; Returns: undefined }
      set_financial_balance: {
        Args: { p_amount: number; p_org_id: string }
        Returns: undefined
      }
      trigger_ml_token_refresh: { Args: never; Returns: number }
      upsert_order_preserve_cost: {
        Args: {
          p_cidade: string
          p_comissao: number
          p_comprador: string
          p_custo_unit: number
          p_data_pagamento: string
          p_data_pedido: string
          p_estado: string
          p_frete: number
          p_item_id: string
          p_listing_type: string
          p_marca: string
          p_ml_order_id: string
          p_ml_user_id: string
          p_organization_id: string
          p_preco_unit: number
          p_quantidade: number
          p_receita_bruta: number
          p_receita_liquida: number
          p_seller_id: string
          p_sku: string
          p_status: string
          p_synced_at: string
          p_tax_amount: number
          p_tax_rate: number
          p_titulo: string
          p_uf_origem: string
          p_user_id: string
          p_variation_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      org_role: "owner" | "admin" | "member" | "viewer"
      plan_tier: "free" | "starter" | "pro" | "enterprise"
      sync_job_status: "pending" | "running" | "completed" | "failed"
      sync_job_type: "daily_cache" | "orders" | "inventory" | "ads"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      sync_job_type: ["daily_cache", "orders", "inventory", "ads"],
      tax_regime: ["simples_nacional", "lucro_presumido", "lucro_real"],
    },
  },
} as const
