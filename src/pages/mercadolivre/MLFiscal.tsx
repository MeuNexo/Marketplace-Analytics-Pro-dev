import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UF_LIST } from "@/lib/tax/regions";

// ─── Types ────────────────────────────────────────────────────────────────────

type Regime = "simples_nacional" | "lucro_presumido" | "lucro_real";

interface TaxConfig {
  ml_user_id: string;
  regime: Regime;
  uf_origem: string | null;
  sn_aliquota_efetiva: number | null;
  lp_pis: number | null;
  lp_cofins: number | null;
  lp_irpj: number | null;
  lp_csll: number | null;
  lr_pis_debito: number | null;
  lr_pis_credito: number | null;
  lr_cofins_debito: number | null;
  lr_cofins_credito: number | null;
  lr_icms_debito: number | null;
  lr_icms_credito: number | null;
  lr_icms_aliquota_intra: number | null;
  lr_icms_aliquota_inter_sul_sudeste: number | null;
  lr_icms_aliquota_inter_norte_nordeste: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_LABELS: Record<Regime, string> = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
};

const LP_DEFAULTS: Record<string, { irpj: number; csll: number }> = {
  comercio: { irpj: 1.2, csll: 1.08 },
  industria: { irpj: 1.2, csll: 1.08 },
  servicos: { irpj: 4.8, csll: 2.88 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(val: string): number {
  return parseFloat(val) || 0;
}

function fmtPct(val: number): string {
  return val.toFixed(2).replace(".", ",") + "%";
}

// ─── PercentInput ─────────────────────────────────────────────────────────────

function PercentInput({
  value,
  onChange,
  step = "0.01",
  min,
  max,
  placeholder = "0,00",
}: {
  value: string;
  onChange: (v: string) => void;
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        className="pr-8"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

// ─── Simples Nacional Form ─────────────────────────────────────────────────────

interface SimplesFormProps {
  initial: TaxConfig | undefined;
  onSave: (fields: Partial<TaxConfig>) => void;
  saving: boolean;
}

function SimplesForm({ initial, onSave, saving }: SimplesFormProps) {
  const [aliquota, setAliquota] = useState(
    initial?.sn_aliquota_efetiva != null ? String(initial.sn_aliquota_efetiva) : ""
  );
  const { toast } = useToast();

  function handleSave() {
    const val = parseFloat(aliquota);
    if (isNaN(val) || val < 0.5 || val > 19.5) {
      toast({
        title: "Alíquota inválida",
        description: "O valor deve estar entre 0,50% e 19,50%.",
        variant: "destructive",
      });
      return;
    }
    onSave({ sn_aliquota_efetiva: val });
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1">
          Alíquota efetiva do DAS
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              O valor vem do PGDAS-D ou do seu contador.
            </TooltipContent>
          </Tooltip>
        </Label>
        <PercentInput
          value={aliquota}
          onChange={setAliquota}
          min="0.5"
          max="19.5"
          placeholder="ex: 6,00"
        />
        <p className="text-[11px] text-muted-foreground">Faixa válida: 0,50% – 19,50%</p>
      </div>
      <Button size="sm" className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? "Salvando…" : "Salvar Simples Nacional"}
      </Button>
    </div>
  );
}

// ─── Lucro Presumido Form ──────────────────────────────────────────────────────

interface LPFormProps {
  initial: TaxConfig | undefined;
  onSave: (fields: Partial<TaxConfig>) => void;
  saving: boolean;
}

function LucroPresumidoForm({ initial, onSave, saving }: LPFormProps) {
  const [activity, setActivity] = useState("comercio");
  const [pis, setPis] = useState(initial?.lp_pis != null ? String(initial.lp_pis) : "0.65");
  const [cofins, setCofins] = useState(
    initial?.lp_cofins != null ? String(initial.lp_cofins) : "3.00"
  );
  const [irpj, setIrpj] = useState(initial?.lp_irpj != null ? String(initial.lp_irpj) : "1.20");
  const [csll, setCsll] = useState(initial?.lp_csll != null ? String(initial.lp_csll) : "1.08");

  function handleActivityChange(val: string) {
    setActivity(val);
    const defaults = LP_DEFAULTS[val];
    if (defaults) {
      setIrpj(String(defaults.irpj));
      setCsll(String(defaults.csll));
    }
    setPis("0.65");
    setCofins("3.00");
  }

  const total = pct(pis) + pct(cofins) + pct(irpj) + pct(csll);

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Atividade</Label>
        <Select value={activity} onValueChange={handleActivityChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comercio">Comércio</SelectItem>
            <SelectItem value="industria">Indústria</SelectItem>
            <SelectItem value="servicos">Serviços</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">
            PIS <span className="text-muted-foreground">(fixo)</span>
          </Label>
          <PercentInput value={pis} onChange={setPis} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            COFINS <span className="text-muted-foreground">(fixo)</span>
          </Label>
          <PercentInput value={cofins} onChange={setCofins} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">IRPJ efetivo</Label>
          <PercentInput value={irpj} onChange={setIrpj} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">CSLL efetivo</Label>
          <PercentInput value={csll} onChange={setCsll} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Total estimado:{" "}
        <span className="font-medium text-foreground">{fmtPct(total)}</span>
      </p>

      <Button
        size="sm"
        className="w-full"
        onClick={() =>
          onSave({
            lp_pis: pct(pis),
            lp_cofins: pct(cofins),
            lp_irpj: pct(irpj),
            lp_csll: pct(csll),
          })
        }
        disabled={saving}
      >
        {saving ? "Salvando…" : "Salvar Lucro Presumido"}
      </Button>
    </div>
  );
}

// ─── Lucro Real Form ───────────────────────────────────────────────────────────

interface LRFormProps {
  initial: TaxConfig | undefined;
  onSave: (fields: Partial<TaxConfig>) => void;
  saving: boolean;
}

function LucroRealForm({ initial, onSave, saving }: LRFormProps) {
  const [pisD, setPisD] = useState(
    initial?.lr_pis_debito != null ? String(initial.lr_pis_debito) : ""
  );
  const [pisC, setPisC] = useState(
    initial?.lr_pis_credito != null ? String(initial.lr_pis_credito) : ""
  );
  const [cofinsD, setCofinsD] = useState(
    initial?.lr_cofins_debito != null ? String(initial.lr_cofins_debito) : ""
  );
  const [cofinsC, setCofinsC] = useState(
    initial?.lr_cofins_credito != null ? String(initial.lr_cofins_credito) : ""
  );
  const [icmsD, setIcmsD] = useState(
    initial?.lr_icms_debito != null ? String(initial.lr_icms_debito) : ""
  );
  const [icmsC, setIcmsC] = useState(
    initial?.lr_icms_credito != null ? String(initial.lr_icms_credito) : ""
  );
  const [icmsIntra, setIcmsIntra] = useState(
    initial?.lr_icms_aliquota_intra != null ? String(initial.lr_icms_aliquota_intra) : ""
  );
  const [icmsInterSE, setIcmsInterSE] = useState(
    initial?.lr_icms_aliquota_inter_sul_sudeste != null
      ? String(initial.lr_icms_aliquota_inter_sul_sudeste) : "12"
  );
  const [icmsInterNNE, setIcmsInterNNE] = useState(
    initial?.lr_icms_aliquota_inter_norte_nordeste != null
      ? String(initial.lr_icms_aliquota_inter_norte_nordeste) : "7"
  );

  const debits = pct(pisD) + pct(cofinsD) + pct(icmsD);
  const credits = pct(pisC) + pct(cofinsC) + pct(icmsC);
  const net = debits - credits;
  const isCredit = net < 0;

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">PIS débito</Label>
          <PercentInput value={pisD} onChange={setPisD} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">PIS crédito</Label>
          <PercentInput value={pisC} onChange={setPisC} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">COFINS débito</Label>
          <PercentInput value={cofinsD} onChange={setCofinsD} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">COFINS crédito</Label>
          <PercentInput value={cofinsC} onChange={setCofinsC} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            ICMS débito <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <PercentInput value={icmsD} onChange={setIcmsD} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            ICMS crédito <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <PercentInput value={icmsC} onChange={setIcmsC} />
        </div>
      </div>

      <div className="rounded-md border border-border/60 p-3 space-y-3 bg-muted/30">
        <div className="flex items-center gap-1">
          <Label className="text-xs font-medium">ICMS por destino</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 cursor-help text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs">
              Aplicado por pedido, conforme UF do comprador.<br />
              Quando UF destino = origem, usa "Intra-estadual".<br />
              Quando UF destino é N/NE/CO/ES, usa 7%.<br />
              Demais (S/SE), usa 12%.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Intra-estadual</Label>
            <PercentInput value={icmsIntra} onChange={setIcmsIntra} placeholder={icmsD || "0,00"} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Inter S/SE</Label>
            <PercentInput value={icmsInterSE} onChange={setIcmsInterSE} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Inter N/NE/CO/ES</Label>
            <PercentInput value={icmsInterNNE} onChange={setIcmsInterNNE} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Resultado líquido:{" "}
        <span className="font-medium text-foreground">{isCredit ? "0,00%" : fmtPct(net)}</span>
        {isCredit && (
          <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 text-xs">
            Crédito
          </Badge>
        )}
      </div>

      <Button
        size="sm"
        className="w-full"
        onClick={() =>
          onSave({
            lr_pis_debito: pct(pisD) || null,
            lr_pis_credito: pct(pisC) || null,
            lr_cofins_debito: pct(cofinsD) || null,
            lr_cofins_credito: pct(cofinsC) || null,
            lr_icms_debito: icmsD !== "" ? pct(icmsD) : null,
            lr_icms_credito: icmsC !== "" ? pct(icmsC) : null,
            lr_icms_aliquota_intra: icmsIntra !== "" ? pct(icmsIntra) : null,
            lr_icms_aliquota_inter_sul_sudeste: icmsInterSE !== "" ? pct(icmsInterSE) : null,
            lr_icms_aliquota_inter_norte_nordeste: icmsInterNNE !== "" ? pct(icmsInterNNE) : null,
          })
        }
        disabled={saving}
      >
        {saving ? "Salvando…" : "Salvar Lucro Real"}
      </Button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function MLFiscal() {
  const { stores, loading: storesLoading } = useMLStore();
  const { currentOrg } = useOrganization();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const orgId = currentOrg?.id ?? null;

  // Fetch all tax configs for this org
  const { data: configs = [] } = useQuery<TaxConfig[]>({
    queryKey: ["ml", "taxConfig", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("ml_tax_config")
        .select("*")
        .eq("organization_id", orgId);
      if (error) throw error;
      return (data ?? []) as TaxConfig[];
    },
    enabled: !!orgId,
  });

  // Dialog state — which store is being configured
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Active tab inside the config dialog
  const [selectedTab, setSelectedTab] = useState<Regime>("simples_nacional");

  // Regime-change confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFields, setPendingFields] = useState<Partial<TaxConfig> | null>(null);

  // Saving state
  const [saving, setSaving] = useState(false);

  // UF origem state (shared across all regimes)
  const [ufOrigem, setUfOrigem] = useState<string>("");

  const currentConfig = configs.find((c) => c.ml_user_id === selectedStoreId);

  function openDialog(mlUserId: string) {
    setSelectedStoreId(mlUserId);
    const existing = configs.find((c) => c.ml_user_id === mlUserId);
    setSelectedTab(existing?.regime ?? "simples_nacional");
    setUfOrigem(existing?.uf_origem ?? "");
    setPendingFields(null);
    setConfirmOpen(false);
    setDialogOpen(true);
  }

  function handleFormSave(fields: Partial<TaxConfig>) {
    // If user switched to a different regime than what is stored, require confirmation
    if (currentConfig && currentConfig.regime !== selectedTab) {
      setPendingFields(fields);
      setConfirmOpen(true);
      return;
    }
    void executeUpsert({ ...fields, uf_origem: ufOrigem || null });
  }

  async function executeUpsert(fields: Partial<TaxConfig>) {
    if (!orgId || !selectedStoreId) return;
    setSaving(true);
    const { error } = await supabase.from("ml_tax_config").upsert(
      {
        organization_id: orgId,
        ml_user_id: selectedStoreId,
        regime: selectedTab,
        ...fields,
      },
      { onConflict: "ml_user_id,organization_id" }
    );
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["ml", "taxConfig", orgId] });
    toast({ title: "Regime salvo com sucesso" });
    setDialogOpen(false);
    setConfirmOpen(false);
    setPendingFields(null);
  }

  function handleConfirmedSave() {
    if (pendingFields) void executeUpsert({ ...pendingFields, uf_origem: ufOrigem || null });
  }

  const selectedStore = stores.find((s) => s.ml_user_id === selectedStoreId);
  const currentRegimeLabel = currentConfig ? REGIME_LABELS[currentConfig.regime] : "";
  const newRegimeLabel = REGIME_LABELS[selectedTab];

  // ── Regime badge ────────────────────────────────────────────────────────────
  function RegimeBadge({ config }: { config: TaxConfig | undefined }) {
    if (!config) {
      return (
        <Badge variant="secondary" className="text-xs">
          Não configurado
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-xs">
        {REGIME_LABELS[config.regime]}
      </Badge>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <MLPageHeader title="Fiscal" />
      </div>

      {/* FISCAL-07 — legal disclaimer */}
      <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
        <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <AlertDescription className="text-xs leading-relaxed">
          Os valores de impostos exibidos são estimativas para análise de margem e não constituem
          apuração fiscal oficial. Consulte seu contador.
        </AlertDescription>
      </Alert>

      {/* Store cards — FISCAL-02 */}
      {storesLoading ? (
        <p className="text-sm text-muted-foreground">Carregando contas…</p>
      ) : stores.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta Mercado Livre conectada.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => {
            const config = configs.find((c) => c.ml_user_id === store.ml_user_id);
            return (
              <Card key={store.ml_user_id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium truncate">
                    {store.displayName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-3">
                  <RegimeBadge config={config} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => openDialog(store.ml_user_id)}
                  >
                    {config ? "Editar" : "Configurar"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Config Dialog — FISCAL-03/04/05/06 ────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {selectedStore?.displayName ?? "Conta"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Selecione o regime tributário e preencha os parâmetros.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as Regime)}>
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="simples_nacional" className="text-xs">
                Simples
              </TabsTrigger>
              <TabsTrigger value="lucro_presumido" className="text-xs">
                L. Presumido
              </TabsTrigger>
              <TabsTrigger value="lucro_real" className="text-xs">
                Lucro Real
              </TabsTrigger>
            </TabsList>

            <div className="space-y-1.5 pt-3">
              <Label className="text-xs flex items-center gap-1">
                UF de origem (loja)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-xs">
                    Estado em que sua mercadoria sai. Usado para calcular ICMS interestadual quando o comprador for de outra UF (Lucro Real).
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Select value={ufOrigem || "__none__"} onValueChange={(v) => setUfOrigem(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a UF…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— não definida —</SelectItem>
                  {UF_LIST.map((uf) => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <TabsContent value="simples_nacional">
              <SimplesForm
                initial={currentConfig?.regime === "simples_nacional" ? currentConfig : undefined}
                onSave={handleFormSave}
                saving={saving}
              />
            </TabsContent>

            <TabsContent value="lucro_presumido">
              <LucroPresumidoForm
                initial={
                  currentConfig?.regime === "lucro_presumido" ? currentConfig : undefined
                }
                onSave={handleFormSave}
                saving={saving}
              />
            </TabsContent>

            <TabsContent value="lucro_real">
              <LucroRealForm
                initial={currentConfig?.regime === "lucro_real" ? currentConfig : undefined}
                onSave={handleFormSave}
                saving={saving}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ── Regime-change confirmation Dialog — FISCAL-06 ─────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar regime tributário?</DialogTitle>
            <DialogDescription>
              O regime atual é <strong>{currentRegimeLabel}</strong>. Você está alterando para{" "}
              <strong>{newRegimeLabel}</strong>. Esta alteração afetará os cálculos de margem
              daqui em diante.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmedSave} disabled={saving}>
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
