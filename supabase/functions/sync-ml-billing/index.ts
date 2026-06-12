import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

// ── ML fetch helper ───────────────────────────────────────────────────────────

async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  const res = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`ML API error [${path}]:`, res.status, data?.message ?? "(no message)");
    throw new Error(data?.message || `ML API error: ${res.status}`);
  }
  return data;
}

// ── Billing period fetch (2-call flow confirmed via nexo-mcp production) ─────

async function fetchBillingPeriod(
  token: string,
  sellerId: string,   // numeric ML seller ID (string)
  periodMonth: string, // YYYY-MM
): Promise<{ cffe: number; cfonpn: number; charges: Array<{ type: string; label: string; amount: number }> } | null> {
  // Step 1: list periods for this seller
  const periodsResp = await fetch(
    `${ML_API}/billing/integration/monthly/periods?seller_id=${sellerId}&group=ML&document_type=BILL`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );

  // 404 = seller without Full / without billing — return null (use orders frete as fallback)
  if (!periodsResp.ok) {
    console.error("billing/periods non-ok:", periodsResp.status);
    return null;
  }

  const periodsData = await periodsResp.json();
  const periodList: any[] = periodsData.results ?? [];

  // REGRA DE DOMÍNIO (Wesley, 2026-06-12): a fatura ML é nomeada pelo mês de
  // FECHAMENTO/PAGAMENTO — o consumo do mês N acumula na fatura N+1.
  // periodMonth aqui é o mês de CONSUMO (como armazenado em ml_billing_monthly);
  // a chave da fatura no ML é consumo + 1 mês.
  const [py, pm] = periodMonth.split("-").map(Number);
  const invDate = new Date(Date.UTC(py, pm, 1)); // pm é 1-based → índice pm = mês seguinte
  const month = `${invDate.getUTCFullYear()}-${String(invDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthCompact = month.replace("-", "");
  const period = periodList.find((p: any) => {
    const k = String(p.key ?? "");
    return k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(monthCompact);
  });

  if (!period?.key) {
    console.error("billing/periods: no matching period for", periodMonth, "found keys:", periodList.map((p: any) => p.key));
    return null;
  }

  // Step 2: fetch summary/details for this period key
  const detailResp = await fetch(
    `${ML_API}/billing/integration/periods/key/${period.key}/summary/details?seller_id=${sellerId}&document_type=BILL`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!detailResp.ok) {
    console.error("billing/summary/details non-ok:", detailResp.status);
    return null;
  }

  const data = await detailResp.json();
  const billIncludes = data.bill_includes ?? {};
  const charges: any[] = billIncludes.charges ?? [];

  // Log charge types found (mitiga risco A2 do research — type field "CFFE"/"CFONPN")
  const chargeTypes = [...new Set(charges.map((c: any) => String(c.type ?? "unknown")))];
  console.error("billing/charges types found:", JSON.stringify(chargeTypes));

  // Extract CFFE (frete Full) and CFONPN (parcelamento sem juros)
  const cffe   = charges.filter((c: any) => String(c.type ?? "").includes("CFFE")).reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);
  const cfonpn = charges.filter((c: any) => String(c.type ?? "").includes("CFONPN")).reduce((s: number, c: any) => s + Number(c.amount ?? 0), 0);

  return {
    cffe,
    cfonpn,
    charges: charges.map((c: any) => ({
      type:   String(c.type ?? ""),
      label:  String(c.label ?? ""),
      amount: Number(c.amount ?? 0),
    })),
  };
}

// ── Body schema ────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  ml_user_id:   z.string().min(1),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "period_month must be YYYY-MM"),
});

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ───────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = authData.user.id;
    }

    // ── Body validation ────────────────────────────────────────────────────────
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { ml_user_id, period_month } = parsed.data;

    // ── ML token lookup ────────────────────────────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, seller_id")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .limit(1)
      .maybeSingle();

    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken: string = tokenRow.access_token;
    const organizationId: string | null = tokenRow.organization_id ?? null;

    // ── Org membership check (when non-service-role) ───────────────────────────
    // Deny-by-default: loja sem organization_id só é acessível via service role.
    if (!isServiceRole) {
      if (!organizationId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: userId,
        _org_id:  organizationId,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Resolve numeric seller_id for ML Billing API ───────────────────────────
    const mlUser = await mlFetch("/users/me", accessToken);
    const mlNumericId = String(mlUser.id);

    // ── Fetch billing data ─────────────────────────────────────────────────────
    const billing = await fetchBillingPeriod(accessToken, mlNumericId, period_month);

    // If billing not available (e.g. account without Full → 404), skip upsert
    // to preserve any previously synced data — do not overwrite good data with zeros
    if (!billing) {
      return new Response(
        JSON.stringify({ success: true, billing: null, message: "No billing data available for this period (account may not use Full)" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Upsert into ml_billing_monthly ─────────────────────────────────────────
    if (!organizationId) {
      // Log and skip — don't fail (Pitfall 6: org may not be linked yet)
      console.error("sync-ml-billing: organization_id is null for ml_user_id", ml_user_id, "— skipping upsert");
      return new Response(
        JSON.stringify({ success: true, billing: { cffe: billing.cffe, cfonpn: billing.cfonpn }, warning: "organization_id missing, upsert skipped" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("ml_billing_monthly")
      .upsert(
        {
          organization_id: organizationId,
          ml_user_id,
          period_month,
          charges: billing.charges,
          resumo: {
            cffe:           billing.cffe,
            cfonpn:         billing.cfonpn,
            total_charges:  billing.charges.reduce((s, c) => s + c.amount, 0),
            synced_at:      new Date().toISOString(),
          },
          synced_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,ml_user_id,period_month" },
      );

    if (upsertErr) {
      console.error("sync-ml-billing upsert error:", upsertErr.message);
      throw new Error(upsertErr.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        billing: { cffe: billing.cffe, cfonpn: billing.cfonpn, charges_count: billing.charges.length },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-billing error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
