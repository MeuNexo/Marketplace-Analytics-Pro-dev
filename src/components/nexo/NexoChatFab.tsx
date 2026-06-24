import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { NexoChatPanel } from "@/components/nexo/NexoChatPanel";

/**
 * NexoChatFab — botão flutuante que abre o painel de chat do Nexo (NEXO-01).
 *
 * Gate de visibilidade (NEXO-01 "só com ML conectado" + NEXO-06 kill-switch):
 *  - !hasMLConnection → não renderiza nada (sem loja ML, sem Nexo).
 *  - consultor_config.llm_enabled === false → não renderiza (kill-switch desligado).
 *  - linha ausente / ainda carregando → tratada como habilitada (mostra o FAB).
 *
 * Montado no LayoutShell, fora do <main>, então aparece em todas as telas autenticadas.
 */
export function NexoChatFab() {
  const { hasMLConnection } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const [open, setOpen] = useState(false);

  // Lê o kill-switch proativamente para esconder o FAB quando llm_enabled=false.
  // Ausência de linha = habilitado (default da consultor_config é true).
  const { data: llmEnabled } = useQuery<boolean>({
    queryKey: ["nexo_kill_switch", orgId],
    enabled: !!orgId && hasMLConnection,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      if (!orgId) return true;
      const { data, error } = await supabase
        .from("consultor_config")
        .select("llm_enabled")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (error) throw error;
      // sem linha → habilitado; com linha → respeita o flag
      return data?.llm_enabled !== false;
    },
  });

  // Gate: sem ML conectado OU kill-switch explicitamente desligado → nada.
  if (!hasMLConnection) return null;
  if (llmEnabled === false) return null;

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir Nexo"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-glow"
        size="icon"
      >
        <Sparkles className="h-6 w-6" />
      </Button>
      <NexoChatPanel open={open} onOpenChange={setOpen} />
    </>
  );
}
