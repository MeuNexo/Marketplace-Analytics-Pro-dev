import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Mapeamento PT-BR: goal IDs (/health) e rule keys conhecidas (/performance)
// ---------------------------------------------------------------------------

interface GoalMapping {
  category: string;
  title: string;
  action_label: string;
}

const GOAL_MAP: Record<string, GoalMapping> = {
  price: {
    category: "Condições de venda",
    title: "Baixe o preço para recuperar a exposição do seu anúncio",
    action_label: "Ajuste o preço para melhorar sua competitividade",
  },
  financing: {
    category: "Condições de venda",
    title: "Ofereça parcelamento sem juros para que seu anúncio seja mais competitivo",
    action_label: "Configure parcelamento sem juros",
  },
  free_shipping: {
    category: "Condições de venda",
    title: "Ofereça frete grátis para aumentar suas vendas",
    action_label: "Ative frete grátis no seu anúncio",
  },
  me2: {
    category: "Condições de venda",
    title: "Use Mercado Envios 2 para melhorar a experiência de entrega",
    action_label: "Ative Mercado Envios 2",
  },
  technical_specification: {
    category: "Dados do produto",
    title: "Complete a ficha técnica do seu produto",
    action_label: "Preencha os atributos faltantes",
  },
  picture: {
    category: "Dados do produto",
    title: "Adicione mais fotos ao seu anúncio",
    action_label: "Inclua imagens adicionais de qualidade",
  },
  video: {
    category: "Dados do produto",
    title: "Adicione um vídeo ao seu anúncio",
    action_label: "Vídeos aumentam as conversões",
  },
  catalog_product_id: {
    category: "Dados do produto",
    title: "Vincule seu anúncio ao catálogo do Mercado Livre",
    action_label: "Associe ao produto do catálogo",
  },
  title: {
    category: "Dados do produto",
    title: "Melhore o título do seu anúncio",
    action_label: "Use palavras-chave relevantes",
  },
  description: {
    category: "Dados do produto",
    title: "Melhore a descrição do seu anúncio",
    action_label: "Adicione mais detalhes sobre o produto",
  },
};

// Mapeamento level → wording PT-BR
const LEVEL_WORDING: Record<string, string> = {
  professional: "Profissional",
  gold: "Ouro",
  silver: "Prata",
  bronze: "Bronze",
  standard: "Satisfatória",
  basic: "Básica",
};

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

interface Issue {
  id: string;
  category: string;
  title: string;
  action_label: string;
  progress: number;
  progress_max: number;
}

interface HealthResult {
  item_id: string;
  score: number | null;
  level: string | null;
  level_wording: string | null;
  issues: Issue[];
  source: "performance_api" | "health_api" | "unavailable";
}

// ---------------------------------------------------------------------------
// Conversão /performance → HealthResult
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function parsePerformanceResponse(itemId: string, data: any): HealthResult {
  const rawScore: number = typeof data.score === "number" ? data.score : 0;
  const score = rawScore / 100; // normalizar 0-100 → 0-1

  const level: string | null = data.level ?? null;
  const levelLower = typeof level === "string" ? level.toLowerCase() : null;
  const level_wording: string | null = levelLower
    ? (LEVEL_WORDING[levelLower] ?? data.level_wording ?? level)
    : null;

  const issues: Issue[] = [];
  const buckets: any[] = Array.isArray(data.buckets) ? data.buckets : [];

  for (const bucket of buckets) {
    const bucketTitle: string = bucket.title ?? bucket.key ?? "Outros";
    const variables: any[] = Array.isArray(bucket.variables) ? bucket.variables : [];

    for (const variable of variables) {
      const rules: any[] = Array.isArray(variable.rules) ? variable.rules : [];

      for (const rule of rules) {
        // Issues acionáveis = mode==="OPPORTUNITY" ou status==="PENDING"
        if (rule.mode !== "OPPORTUNITY" && rule.status !== "PENDING") continue;

        const ruleKey: string = rule.key ?? "";
        const mapped = GOAL_MAP[ruleKey.toLowerCase()];

        let category: string;
        let title: string;
        let action_label: string;

        if (mapped) {
          // Chave conhecida → tradução PT-BR
          category = mapped.category;
          title = mapped.title;
          action_label = mapped.action_label;
        } else {
          // Chave desconhecida → usar wordings da API (podem estar em ES, mas melhor
          // que ocultar a issue; conforme landmine 6 do RESEARCH.md)
          category = bucketTitle;
          title = rule.wordings?.title ?? variable.title ?? ruleKey;
          action_label = rule.wordings?.label ?? rule.wordings?.title ?? ruleKey;
        }

        issues.push({
          id: ruleKey,
          category,
          title,
          action_label,
          progress: rule.progress ?? 0,
          progress_max: rule.progress_max ?? 1,
        });
      }
    }
  }

  return { item_id: itemId, score, level: levelLower, level_wording, issues, source: "performance_api" };
}

// ---------------------------------------------------------------------------
// Conversão /health → HealthResult
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function parseHealthResponse(itemId: string, data: any): HealthResult {
  const score: number | null = typeof data.health === "number" ? data.health : null;

  const level: string | null = data.level ?? null;
  const levelLower = typeof level === "string" ? level.toLowerCase() : null;
  const level_wording: string | null = levelLower
    ? (LEVEL_WORDING[levelLower] ?? level)
    : null;

  const issues: Issue[] = [];
  const goals: any[] = Array.isArray(data.goals) ? data.goals : [];

  for (const goal of goals) {
    // Issues acionáveis = apply===true e progress < progress_max
    if (goal.apply !== true) continue;
    const progress: number = goal.progress ?? 0;
    const progress_max: number = goal.progress_max ?? 1;
    if (progress >= progress_max) continue;

    const goalId: string = goal.id ?? "";
    const mapped = GOAL_MAP[goalId];

    issues.push({
      id: goalId,
      category: mapped?.category ?? "Outros",
      title: mapped?.title ?? goal.name ?? goalId,
      action_label: mapped?.action_label ?? goal.name ?? goalId,
      progress,
      progress_max,
    });
  }

  return { item_id: itemId, score, level: levelLower, level_wording, issues, source: "health_api" };
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Validar JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabaseAdmin.auth.getUser(token);
    if (claimsErr || !claimsData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.user.id;

    // 2. Validar body POST via Zod
    const BodySchema = z.object({
      item_id: z.string().min(1, "item_id is required"),
      ml_user_id: z.string().min(1, "ml_user_id is required"),
    });

    let bodyRaw: unknown;
    try {
      bodyRaw = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const parsed = BodySchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const { item_id, ml_user_id } = parsed.data;

    // 3. Buscar token ML em ml_tokens (ORDER BY updated_at DESC — multi-tenant determinístico)
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return jsonResponse({ error: "No ML token found" }, 404);
    }

    // 4. Anti-IDOR: verificar que o usuário pertence à org dona do token
    if (tokenRow.organization_id) {
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: userId,
        _org_id: tokenRow.organization_id,
      });
      if (!isMember) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    const accessToken = tokenRow.access_token as string;

    // 5. Tentar /item/{id}/performance (singular) — endpoint atual
    let result: HealthResult | null = null;

    const perfRes = await fetch(`${ML_API}/item/${item_id}/performance`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (perfRes.ok) {
      const perfData = await perfRes.json();
      result = parsePerformanceResponse(item_id, perfData);
    } else if (perfRes.status === 401) {
      // Token expirado — retornar 401 explícito (landmine 5: não tentar refresh inline)
      return jsonResponse({ error: "ML token expired" }, 401);
    } else {
      // Não-200 e não-401: tentar fallback /items/{id}/health (plural)
      const healthRes = await fetch(`${ML_API}/items/${item_id}/health`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        result = parseHealthResponse(item_id, healthData);
      } else if (healthRes.status === 401) {
        return jsonResponse({ error: "ML token expired" }, 401);
      } else if (healthRes.status === 404) {
        // Item não encontrado nesta conta
        return jsonResponse({ error: "Item not found" }, 404);
      }
      // qualquer outro erro → cai no unavailable abaixo
    }

    // 6. Ambos falharam → retornar estado explícito unavailable (modal não quebra)
    if (!result) {
      const unavailable: HealthResult = {
        item_id,
        score: null,
        level: null,
        level_wording: null,
        issues: [],
        source: "unavailable",
      };
      console.log(`ml-listing-health: user=${userId} store=${ml_user_id} item=${item_id} source=unavailable`);
      return jsonResponse(unavailable, 200);
    }

    console.log(
      `ml-listing-health: user=${userId} store=${ml_user_id} item=${item_id} source=${result.source} issues=${result.issues.length}`,
    );

    return jsonResponse(result);
  } catch (err) {
    console.error("ml-listing-health error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
