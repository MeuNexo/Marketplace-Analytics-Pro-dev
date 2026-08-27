// ============================================================================
// 233-02 — "Ao longo do tempo, quanto posso confiar?" (Wesley, 27/08/2026)
//
// 🔴 A confiança é do SALDO, medida contra o saldo que o Wesley DECLARA — não o
// `initial_balance` (que é o saldo antes dos movimentos do dia) nem o valor que
// a tela exibe. Em 27/08 os três eram números diferentes: 46.000, 51.304,62 e
// 37.430, e o dia zero errava R$ 13.874,62.
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA e NENHUMA COR QUE SIGNIFIQUE "confiável". A
// escala é `100 − erro` e o corte é do Wesley — D-6 do 224-CONTEXT. A cor aqui é
// gradiente contínuo, não semáforo: semáforo é limiar disfarçado.
//
// 🔴 HORIZONTE SEM AMOSTRA NÃO VIRA BARRA. Lacuna declarada, nunca zero.
// ============================================================================
import { Skeleton } from "@/components/ui/skeleton";
import { useConfiancaDoSaldo } from "@/hooks/useConfiancaDoSaldo";

export function CurvaDeConfianca() {
  const { data, isLoading, error } = useConfiancaDoSaldo();

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  if (error) {
    return (
      <p className="text-xs text-destructive">
        Não foi possível carregar a confiança da previsão.
      </p>
    );
  }

  const pontos = (data?.pontos ?? []).filter((p) => p.estado === "medido");

  if (pontos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Ainda não há confiança medida: nenhum saldo declarado foi confrontado contra as
        previsões congeladas. Cada vez que você corrigir o saldo, um ponto nasce aqui.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">
          Confiança da previsão de saldo
        </span>
        <span className="text-[11px] text-muted-foreground">
          {/* 🔴 n SEMPRE ao lado do percentual: 84% sobre 2 pares não é a mesma
              afirmação que 84% sobre 50. Separá-los é como um número frágil vira
              afirmação forte em quem lê rápido. */}
          {data?.totalPares} {data?.totalPares === 1 ? "par" : "pares"} ·{" "}
          {data?.diasDeSerie} {data?.diasDeSerie === 1 ? "dia" : "dias"} de série
        </span>
      </div>

      <div className="flex items-end gap-1">
        {pontos.map((p) => {
          const pct = p.confianca_pct ?? 0;
          return (
            <div key={p.horizonte} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {Math.round(pct)}%
              </span>
              <div
                className="w-full rounded-sm bg-primary"
                style={{
                  // Altura proporcional e opacidade contínua: sem semáforo, que
                  // seria limiar de tolerância disfarçado de cor.
                  height: `${Math.max(4, (pct / 100) * 48)}px`,
                  opacity: 0.35 + (pct / 100) * 0.65,
                }}
                title={`D+${p.horizonte}: ${pct}% de confiança · erro ${p.erro_pct}% · ${p.n_pares} par(es)`}
              />
              <span className="text-[10px] tabular-nums text-muted-foreground">
                D+{p.horizonte}
              </span>
            </div>
          );
        })}
      </div>

      {data?.selo && (
        // 🔴 O selo diz a DIREÇÃO do viés. "Provisório" sozinho ensina a ler o
        // número como se fosse conservador — e ele é otimista.
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
          ⚠️ {data.selo}
        </p>
      )}
    </div>
  );
}
