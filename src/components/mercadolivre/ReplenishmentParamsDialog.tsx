import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useQueryClient } from "@tanstack/react-query";
import { usePurchaseOrderSuppliers } from "@/hooks/usePurchaseOrderSuppliers";

// ── Types ─────────────────────────────────────────────────────────────────────

type Scope = "global" | "marca" | "sku" | "fornecedor";

interface ReplenishmentParam {
  id: string;
  scope: Scope;
  scope_value: string;
  lead_time_dias: number;
  meta_cobertura_dias: number;
  safety_days: number;
  moq: number;
  pack_multiple: number;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  scope:              z.enum(["global", "marca", "sku", "fornecedor"]),
  scope_value:        z.string(),
  lead_time_dias:     z.number().int().min(1).max(365),
  meta_cobertura_dias: z.number().int().min(1).max(730),
  safety_days:        z.number().int().min(0).max(60),
  moq:                z.number().int().min(1),
  pack_multiple:      z.number().int().min(1),
});

type ParamsFormValues = z.infer<typeof paramsSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULTS: Omit<ParamsFormValues, "scope" | "scope_value"> = {
  lead_time_dias:     30,
  meta_cobertura_dias: 60,
  safety_days:        7,
  moq:                1,
  pack_multiple:      1,
};

const SCOPE_LABELS: Record<Scope, string> = {
  global:     "Global",
  marca:      "Por Marca",
  sku:        "Por SKU",
  fornecedor: "Por Fornecedor",
};

function scopeValueLabel(scope: Scope): string {
  if (scope === "global")     return "";
  if (scope === "marca")      return "Nome da Marca";
  if (scope === "fornecedor") return "Fornecedor (das ordens de compra)";
  return "SKU (seller_custom_field)";
}

// ── Param Row ─────────────────────────────────────────────────────────────────

interface ParamRowProps {
  param:       ReplenishmentParam;
  canEdit:     boolean;
  onEdit:      (p: ReplenishmentParam) => void;
  onDelete:    (id: string) => void;
}

function ParamRow({ param, canEdit, onEdit, onDelete }: ParamRowProps) {
  const scopeColor: Record<Scope, string> = {
    sku:        "bg-primary/10 text-primary border-none",
    fornecedor: "bg-amber-500/10 text-amber-700 border-none",
    marca:      "text-[10px]",
    global:     "",
  };

  return (
    <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/30 border border-border/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={param.scope === "global" ? "secondary" : "outline"}
            className={`text-[10px] ${scopeColor[param.scope]}`}
          >
            {SCOPE_LABELS[param.scope]}
          </Badge>
          {param.scope !== "global" && (
            <span className="text-xs font-mono truncate max-w-[160px]">{param.scope_value}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Entrega {param.lead_time_dias}d · Est. desejado {param.meta_cobertura_dias}d · Folga {param.safety_days}d · Min. {param.moq}un · Caixa {param.pack_multiple}
        </p>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(param)}
            title="Editar"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(param.id)}
            title="Excluir"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface ParamFormProps {
  editingParam: ReplenishmentParam | null;
  canEdit:      boolean;
  orgId:        string;
  onSaved:      () => void;
  onCancel:     () => void;
}

function ParamForm({ editingParam, canEdit, orgId, onSaved, onCancel }: ParamFormProps) {
  const { data: suppliers = [], isLoading: loadingSuppliers } = usePurchaseOrderSuppliers();

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ParamsFormValues>({
    resolver: zodResolver(paramsSchema),
    defaultValues: editingParam
      ? {
          scope:              editingParam.scope,
          scope_value:        editingParam.scope_value,
          lead_time_dias:     editingParam.lead_time_dias,
          meta_cobertura_dias: editingParam.meta_cobertura_dias,
          safety_days:        editingParam.safety_days,
          moq:                editingParam.moq,
          pack_multiple:      editingParam.pack_multiple,
        }
      : { scope: "global", scope_value: "", ...DEFAULTS },
  });

  const scope = watch("scope");

  useEffect(() => {
    if (editingParam) {
      reset({
        scope:              editingParam.scope,
        scope_value:        editingParam.scope_value,
        lead_time_dias:     editingParam.lead_time_dias,
        meta_cobertura_dias: editingParam.meta_cobertura_dias,
        safety_days:        editingParam.safety_days,
        moq:                editingParam.moq,
        pack_multiple:      editingParam.pack_multiple,
      });
    } else {
      reset({ scope: "global", scope_value: "", ...DEFAULTS });
    }
  }, [editingParam, reset]);

  async function onSubmit(values: ParamsFormValues) {
    if (!canEdit) {
      toast.error("Permissão negada", {
        description: "Apenas owner/admin podem editar parâmetros de reposição.",
      });
      return;
    }

    const payload = {
      organization_id:    orgId,
      scope:              values.scope,
      scope_value:        values.scope === "global" ? "" : values.scope_value,
      lead_time_dias:     values.lead_time_dias,
      meta_cobertura_dias: values.meta_cobertura_dias,
      safety_days:        values.safety_days,
      moq:                values.moq,
      pack_multiple:      values.pack_multiple,
    };

    let error;
    if (editingParam) {
      ({ error } = await supabase
        .from("replenishment_params")
        .update(payload)
        .eq("id", editingParam.id));
    } else {
      ({ error } = await supabase
        .from("replenishment_params")
        .insert(payload));
    }

    if (error) {
      if (error.code === "42501" || error.message.includes("policy")) {
        toast.error("Permissão negada", {
          description: "Apenas owner/admin podem editar parâmetros de reposição.",
        });
      } else {
        toast.error("Erro ao salvar", { description: error.message });
      }
      return;
    }

    toast.success(editingParam ? "Parâmetro atualizado" : "Parâmetro criado");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Aplicar a (Scope) */}
        <div className="space-y-1 col-span-2 sm:col-span-1">
          <Label className="text-xs">Aplicar a</Label>
          <Controller
            control={control}
            name="scope"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (todos os produtos)</SelectItem>
                  <SelectItem value="fornecedor">Por Fornecedor</SelectItem>
                  <SelectItem value="marca">Por Marca</SelectItem>
                  <SelectItem value="sku">Por SKU</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            O mais específico prevalece — Por SKU supera Por Fornecedor, que supera Por Marca, que supera Global.
          </p>
        </div>

        {/* Scope value (only when not global) */}
        {scope !== "global" && (
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label className="text-xs">{scopeValueLabel(scope)}</Label>

            {scope === "fornecedor" ? (
              /* Dropdown obrigatório para fornecedor — garante match exato com purchase_orders.fornecedor (D-10, T-66-08) */
              loadingSuppliers ? (
                <Skeleton className="h-8 w-full rounded-md" />
              ) : suppliers.length === 0 ? (
                <p className="text-[10px] text-muted-foreground leading-tight py-1">
                  Nenhum fornecedor encontrado nas ordens de compra. Sincronize as OCs primeiro em Compras.
                </p>
              ) : (
                <Controller
                  control={control}
                  name="scope_value"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => setValue("scope_value", v, { shouldValidate: true })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecione o fornecedor…" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )
            ) : (
              <Input
                {...register("scope_value")}
                className="h-8 text-xs"
                placeholder={scope === "marca" ? "ex: Pralana" : "ex: 020491CA35GRX"}
              />
            )}

            {errors.scope_value && (
              <p className="text-[10px] text-destructive">{errors.scope_value.message}</p>
            )}
          </div>
        )}
      </div>

      <Separator />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {/* Tempo de entrega do fornecedor */}
        <div className="space-y-1">
          <Label className="text-xs">Tempo de entrega do fornecedor</Label>
          <Input
            type="number" min={1} max={365}
            {...register("lead_time_dias", { valueAsNumber: true })}
            className="h-8 text-xs"
          />
          {errors.lead_time_dias && (
            <p className="text-[10px] text-destructive">{errors.lead_time_dias.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Dias entre fazer o pedido e a mercadoria chegar. Ex.: 30 dias para fornecedor nacional.
          </p>
        </div>

        {/* Estoque desejado (dias) */}
        <div className="space-y-1">
          <Label className="text-xs">Estoque desejado (dias)</Label>
          <Input
            type="number" min={1} max={730}
            {...register("meta_cobertura_dias", { valueAsNumber: true })}
            className="h-8 text-xs"
          />
          {errors.meta_cobertura_dias && (
            <p className="text-[10px] text-destructive">{errors.meta_cobertura_dias.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Para quantos dias de venda você quer ter estoque disponível. Ex.: 60 dias equivalem a 2 meses.
          </p>
        </div>

        {/* Folga de segurança (dias) */}
        <div className="space-y-1">
          <Label className="text-xs">Folga de segurança (dias)</Label>
          <Input
            type="number" min={0} max={60}
            {...register("safety_days", { valueAsNumber: true })}
            className="h-8 text-xs"
          />
          {errors.safety_days && (
            <p className="text-[10px] text-destructive">{errors.safety_days.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Dias extras de estoque para imprevistos de atraso ou pico de vendas. Ex.: 7 dias.
          </p>
        </div>

        {/* Pedido mínimo do fornecedor */}
        <div className="space-y-1">
          <Label className="text-xs">Pedido mínimo do fornecedor</Label>
          <Input
            type="number" min={1}
            {...register("moq", { valueAsNumber: true })}
            className="h-8 text-xs"
          />
          {errors.moq && (
            <p className="text-[10px] text-destructive">{errors.moq.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Quantidade mínima por pedido imposta pelo fornecedor. Use 1 se não há mínimo.
          </p>
        </div>

        {/* Múltiplo de caixa */}
        <div className="space-y-1">
          <Label className="text-xs">Múltiplo de caixa</Label>
          <Input
            type="number" min={1}
            {...register("pack_multiple", { valueAsNumber: true })}
            className="h-8 text-xs"
          />
          {errors.pack_multiple && (
            <p className="text-[10px] text-destructive">{errors.pack_multiple.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Fornecedor entrega em caixas fechadas de X unidades. Use 1 para compra avulsa.
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          size="sm"
          className="h-8 text-xs"
          disabled={!canEdit || isSubmitting}
          title={!canEdit ? "Apenas owner/admin podem salvar" : undefined}
        >
          {isSubmitting ? "Salvando…" : editingParam ? "Atualizar" : "Criar"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {!canEdit && (
        <p className="text-[10px] text-muted-foreground">
          Visualização apenas — somente owner/admin podem editar parâmetros.
        </p>
      )}
    </form>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

interface ReplenishmentParamsDialogProps {
  children?: React.ReactNode;
}

export function ReplenishmentParamsDialog({ children }: ReplenishmentParamsDialogProps) {
  const { currentOrg, orgRole } = useOrganization();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<ReplenishmentParam[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingParam, setEditingParam] = useState<ReplenishmentParam | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canEdit = orgRole === "owner" || orgRole === "admin";

  async function loadParams() {
    if (!currentOrg?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("replenishment_params")
      .select("*")
      .order("scope", { ascending: true })
      .order("scope_value", { ascending: true });

    if (!error && data) {
      setParams(
        data.map((r) => ({
          id:                 r.id,
          scope:              r.scope as Scope,
          scope_value:        r.scope_value ?? "",
          lead_time_dias:     r.lead_time_dias,
          meta_cobertura_dias: r.meta_cobertura_dias,
          safety_days:        r.safety_days,
          moq:                r.moq,
          pack_multiple:      r.pack_multiple,
        }))
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    if (open) loadParams();
  }, [open, currentOrg?.id]);

  async function handleDelete(id: string) {
    if (!canEdit) {
      toast.error("Permissão negada", {
        description: "Apenas owner/admin podem excluir parâmetros.",
      });
      return;
    }
    const { error } = await supabase.from("replenishment_params").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir", { description: error.message });
    } else {
      toast.success("Parâmetro excluído");
      await loadParams();
      queryClient.invalidateQueries({ queryKey: ["get_replenishment_by_sku"] });
    }
  }

  function handleEdit(param: ReplenishmentParam) {
    setEditingParam(param);
    setShowForm(true);
  }

  async function handleSaved() {
    setShowForm(false);
    setEditingParam(null);
    await loadParams();
    queryClient.invalidateQueries({ queryKey: ["get_replenishment_by_sku"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Pencil className="w-3.5 h-3.5" />
            Parâmetros
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Regras de Compra</DialogTitle>
          <DialogDescription className="text-xs">
            Define as regras que calculam quanto comprar de cada produto. O mais específico
            prevalece: Por SKU supera Por Fornecedor, que supera Por Marca, que supera Global.
            {!canEdit && " (somente owner/admin podem editar)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Lista de params */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : params.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Nenhuma regra configurada. Os valores padrão serão usados: Entrega 30d · Estoque desejado 60d · Folga 7d · Min. 1 · Caixa 1.
            </p>
          ) : (
            <div className="space-y-2">
              {params.map((p) => (
                <ParamRow
                  key={p.id}
                  param={p}
                  canEdit={canEdit}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          <Separator />

          {/* Form */}
          {showForm ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold">
                {editingParam ? "Editar parâmetro" : "Novo parâmetro"}
              </h4>
              <ParamForm
                editingParam={editingParam}
                canEdit={canEdit}
                orgId={currentOrg?.id ?? ""}
                onSaved={handleSaved}
                onCancel={() => { setShowForm(false); setEditingParam(null); }}
              />
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 w-full"
              disabled={!canEdit}
              onClick={() => { setEditingParam(null); setShowForm(true); }}
              title={!canEdit ? "Apenas owner/admin podem adicionar parâmetros" : undefined}
            >
              <Plus className="w-3.5 h-3.5" />
              Novo parâmetro
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
