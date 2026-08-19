/**
 * useDifalRegimeAplicavel — o recorte de lojas selecionado recolhe DIFAL?
 *
 * Fase 222, plano 222-15-R2. Existe porque a conferência visual exige que a
 * conta do Junior (Simples Nacional) diga "regime não aplicável" em vez de
 * exibir dois números iguais e mudos — e as telas de margem não liam o regime
 * até aqui. Sem ele, uma loja imune por destino apareceria com um "MCO com
 * DIFAL" idêntico ao "sem DIFAL", indistinguível de um DIFAL que não carregou.
 *
 * A decisão de recorte inteiro (nunca metade) mora em `regimeAplicaDifalNasLojas`
 * — este hook só resolve as fontes: as lojas do cabeçalho, a organização atual
 * e a vigência ABERTA de `ml_tax_config`.
 *
 * `undefined` significa "ainda não sabemos" (config carregando ou ausente), e
 * não saber nunca vira a afirmação de que o DIFAL não se aplica.
 */
import { useMemo } from "react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLTaxConfig } from "@/hooks/useMLTaxConfig";
import { regimeAplicaDifalNasLojas } from "@/lib/mcoLinhaCenarios";

export function useDifalRegimeAplicavel(): boolean | undefined {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const { data: taxMap } = useMLTaxConfig(resolvedMLUserIds, currentOrg?.id ?? "");

  return useMemo(() => {
    if (!taxMap) return undefined;
    return regimeAplicaDifalNasLojas(
      resolvedMLUserIds.map((id) => taxMap.get(id)?.regime ?? null),
    );
  }, [taxMap, resolvedMLUserIds]);
}
