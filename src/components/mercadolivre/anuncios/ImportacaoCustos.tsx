import { useState, useRef, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Upload, Download, CheckCircle2, AlertTriangle, XCircle,
  Loader2, FileSpreadsheet, X, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useMLProductCosts, type BatchCostRow } from "@/hooks/useMLProductCosts";
import { useMLPrecosCustos } from "@/hooks/useMLPrecosCustos";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE_DATA = [
  ["item_id", "sku", "custo"],
  ["MLB1234567", "SKU-001", "45.90"],
  ["MLB7654321", "",        "120.00"],
  ["",          "SKU-002", "33.50"],
];

function downloadTemplate(fmt: "csv" | "xlsx") {
  if (fmt === "csv") {
    const csv = TEMPLATE_DATA.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    triggerDownload(URL.createObjectURL(blob), "modelo_custos.csv");
  } else {
    const ws = XLSX.utils.aoa_to_sheet(TEMPLATE_DATA);
    // Column widths
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Custos");
    XLSX.writeFile(wb, "modelo_custos.xlsx");
  }
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Column detection ─────────────────────────────────────────────────────────

function norm(s: string) {
  return s.toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_");
}

const ITEM_ID_KEYS = ["item_id", "mlb", "id", "anuncio", "item", "codigo_ml", "id_ml", "id_anuncio"];
const SKU_KEYS     = ["sku", "cod", "codigo", "referencia", "codigo_interno", "ref", "cod_interno", "codigo_sku"];
const CUSTO_KEYS   = ["custo", "cost", "costo", "valor", "preco_custo", "custo_produto", "preco", "valor_custo"];

function detectCol(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => keys.includes(norm(h)));
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

interface RawRow {
  rawItemId: string;
  rawSku: string;
  rawCusto: string;
}

function parseFile(file: File): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];

        if (rows.length < 2) { resolve([]); return; }

        const headers = rows[0].map(String);
        const colItemId = detectCol(headers, ITEM_ID_KEYS);
        const colSku    = detectCol(headers, SKU_KEYS);
        const colCusto  = detectCol(headers, CUSTO_KEYS);

        if (colCusto === -1) {
          reject(new Error('Coluna "custo" não encontrada. Verifique o cabeçalho da planilha.'));
          return;
        }
        if (colItemId === -1 && colSku === -1) {
          reject(new Error('Nenhuma coluna de identificador (item_id ou sku) encontrada.'));
          return;
        }

        const parsed: RawRow[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const rawItemId = colItemId !== -1 ? String(row[colItemId] ?? "").trim() : "";
          const rawSku    = colSku    !== -1 ? String(row[colSku]    ?? "").trim() : "";
          const rawCusto  = String(row[colCusto] ?? "").trim();
          // Skip fully empty rows
          if (!rawItemId && !rawSku && !rawCusto) continue;
          parsed.push({ rawItemId, rawSku, rawCusto });
        }
        resolve(parsed);
      } catch (err: any) {
        reject(new Error("Erro ao ler arquivo: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

function parseCusto(raw: string): number | null {
  // Accept "45.90", "45,90", "R$ 45,90", "45,9"
  const clean = raw.replace(/[R$\s]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isFinite(n) && n >= 0 ? n : null;
}

// ─── Row types ────────────────────────────────────────────────────────────────

type RowStatus = "ok" | "sku_unmatched" | "no_identifier" | "invalid_cost" | "item_not_found";

interface PreviewRow {
  idx: number;
  rawItemId: string;
  rawSku: string;
  rawCusto: string;
  resolvedItemId: string | null;   // final item_id to save
  resolvedTitle:  string | null;
  resolvedSku:    string | null;   // sku to persist
  parsedCusto:    number | null;
  status:         RowStatus;
  manualItemId?:  string;          // user pick when sku_unmatched
}

const STATUS_META: Record<RowStatus, { label: string; icon: React.ReactNode; className: string }> = {
  ok:             { label: "Ok",                   icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: "text-emerald-600" },
  sku_unmatched:  { label: "SKU não mapeado",      icon: <AlertTriangle className="w-3.5 h-3.5" />, className: "text-amber-600" },
  no_identifier:  { label: "Sem identificador",    icon: <XCircle className="w-3.5 h-3.5" />,       className: "text-red-500" },
  invalid_cost:   { label: "Custo inválido",       icon: <XCircle className="w-3.5 h-3.5" />,       className: "text-red-500" },
  item_not_found: { label: "MLB não encontrado",   icon: <XCircle className="w-3.5 h-3.5" />,       className: "text-red-500" },
};

// ─── MLB Selector (for sku_unmatched rows) ────────────────────────────────────

function MlbSelector({
  value,
  onChange,
  items,
}: {
  value: string | undefined;
  onChange: (itemId: string, title: string) => void;
  items: { item_id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return items.filter(
      (it) => it.item_id.toLowerCase().includes(lq) || it.title.toLowerCase().includes(lq),
    ).slice(0, 40);
  }, [items, q]);

  const selected = value ? items.find((it) => it.item_id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 max-w-[220px]">
          <Search className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            {selected ? selected.item_id : "Vincular MLB…"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar MLB ou título…"
            value={q}
            onValueChange={setQ}
            className="text-xs"
          />
          <CommandList>
            <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
              Nenhum anúncio encontrado.
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((it) => (
                <CommandItem
                  key={it.item_id}
                  value={it.item_id}
                  onSelect={() => { onChange(it.item_id, it.title); setOpen(false); setQ(""); }}
                  className="text-xs gap-2"
                >
                  <span className="font-mono text-muted-foreground">{it.item_id}</span>
                  <span className="truncate">{it.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ImportacaoCustos() {
  const { costs, upsertBatch, refetch } = useMLProductCosts();
  const { items: catalogItems }         = useMLPrecosCustos();
  const { toast }                       = useToast();
  const inputRef                        = useRef<HTMLInputElement>(null);

  const [rows, setRows]       = useState<PreviewRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [fileName, setFileName] = useState("");

  // Build lookup maps
  const catalogMap = useMemo(() => {
    const m = new Map<string, string>(); // item_id → title
    for (const it of catalogItems) m.set(it.item_id, it.title);
    return m;
  }, [catalogItems]);

  const skuMap = useMemo(() => {
    const m = new Map<string, string>(); // seller_sku → item_id
    for (const c of costs.values()) {
      if (c.seller_sku) m.set(c.seller_sku.trim().toLowerCase(), c.item_id);
    }
    return m;
  }, [costs]);

  // Resolve a raw row into a PreviewRow
  function resolveRow(raw: RawRow, idx: number): PreviewRow {
    const parsedCusto = parseCusto(raw.rawCusto);

    const base: Omit<PreviewRow, "status"> = {
      idx,
      rawItemId:      raw.rawItemId,
      rawSku:         raw.rawSku,
      rawCusto:       raw.rawCusto,
      resolvedItemId: null,
      resolvedTitle:  null,
      resolvedSku:    raw.rawSku || null,
      parsedCusto,
    };

    if (parsedCusto === null) {
      return { ...base, status: "invalid_cost" };
    }

    // Prefer explicit item_id
    if (raw.rawItemId) {
      const title = catalogMap.get(raw.rawItemId);
      if (!title) return { ...base, status: "item_not_found" };
      return { ...base, resolvedItemId: raw.rawItemId, resolvedTitle: title, status: "ok" };
    }

    // Try resolving via SKU
    if (raw.rawSku) {
      const mapped = skuMap.get(raw.rawSku.trim().toLowerCase());
      if (mapped) {
        const title = catalogMap.get(mapped) ?? mapped;
        return { ...base, resolvedItemId: mapped, resolvedTitle: title, status: "ok" };
      }
      return { ...base, status: "sku_unmatched" };
    }

    return { ...base, status: "no_identifier" };
  }

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setRows([]);
    try {
      const raw = await parseFile(file);
      setRows(raw.map((r, i) => resolveRow(r, i)));
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erro ao ler planilha", description: err.message });
    } finally {
      setParsing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogMap, skuMap]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleManualLink = (rowIdx: number, itemId: string, title: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.idx === rowIdx
          ? { ...r, resolvedItemId: itemId, resolvedTitle: title, manualItemId: itemId, status: "ok" }
          : r,
      ),
    );
  };

  const readyRows  = rows.filter((r) => r.status === "ok");
  const errorRows  = rows.filter((r) => r.status !== "ok" && r.status !== "sku_unmatched");
  const warnRows   = rows.filter((r) => r.status === "sku_unmatched");

  const handleSave = async () => {
    if (readyRows.length === 0) return;
    setSaving(true);
    try {
      const batch: BatchCostRow[] = readyRows.map((r) => ({
        item_id:    r.resolvedItemId!,
        cost:       r.parsedCusto!,
        seller_sku: r.resolvedSku ?? undefined,
      }));
      await upsertBatch(batch);
      await refetch();
      toast({ title: `${batch.length} custo${batch.length > 1 ? "s" : ""} importado${batch.length > 1 ? "s" : ""} com sucesso.` });
      setRows([]);
      setFileName("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erro ao salvar", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const clear = () => { setRows([]); setFileName(""); };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Importar custos em massa</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aceita <strong>.xlsx</strong> e <strong>.csv</strong> — identifique os produtos por MLB ou por SKU interno.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => downloadTemplate("xlsx")}
          >
            <Download className="w-3.5 h-3.5" />
            Planilha modelo (.xlsx)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5 text-muted-foreground"
            onClick={() => downloadTemplate("csv")}
          >
            <Download className="w-3.5 h-3.5" />
            .csv
          </Button>
        </div>
      </div>

      {/* Drop zone */}
      {rows.length === 0 && (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg px-6 py-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors",
            "border-border/60 hover:border-primary/40 hover:bg-muted/20",
            parsing && "pointer-events-none opacity-60",
          )}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {parsing ? (
            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          ) : (
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium">
              {parsing ? "Lendo planilha…" : "Arraste ou clique para selecionar"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              .xlsx · .xls · .csv — máx. 10.000 linhas
            </p>
          </div>
        </div>
      )}

      {/* Preview */}
      {rows.length > 0 && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">{fileName}</span>
              <Badge variant="outline" className="text-xs gap-1 bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3" />
                {readyRows.length} prontos
              </Badge>
              {warnRows.length > 0 && (
                <Badge variant="outline" className="text-xs gap-1 bg-amber-500/10 text-amber-700 border-amber-500/30">
                  <AlertTriangle className="w-3 h-3" />
                  {warnRows.length} SKU não mapeado
                </Badge>
              )}
              {errorRows.length > 0 && (
                <Badge variant="outline" className="text-xs gap-1 bg-red-500/10 text-red-600 border-red-500/30">
                  <XCircle className="w-3 h-3" />
                  {errorRows.length} erros
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clear}>
                <X className="w-3.5 h-3.5 mr-1" />
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                disabled={readyRows.length === 0 || saving}
                onClick={handleSave}
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {saving ? "Salvando…" : `Importar ${readyRows.length} item${readyRows.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="px-3 py-2.5 text-left font-semibold w-5">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                    <th className="px-3 py-2.5 text-left font-semibold">MLB / SKU</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Título</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <tr key={r.idx} className="border-b border-border/30 last:border-0">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.idx + 1}</td>
                        <td className="px-3 py-2">
                          <span className={cn("flex items-center gap-1 whitespace-nowrap", meta.className)}>
                            {meta.icon}
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.status === "sku_unmatched" ? (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground font-mono">{r.rawSku}</span>
                              <MlbSelector
                                value={r.manualItemId}
                                onChange={(itemId, title) => handleManualLink(r.idx, itemId, title)}
                                items={catalogItems}
                              />
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              {r.resolvedItemId && (
                                <p className="font-mono text-muted-foreground">{r.resolvedItemId}</p>
                              )}
                              {r.rawSku && (
                                <p className="text-muted-foreground/70">SKU: {r.rawSku}</p>
                              )}
                              {!r.resolvedItemId && r.rawItemId && (
                                <p className="font-mono text-red-500">{r.rawItemId}</p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          <p className="truncate text-foreground/80">
                            {r.resolvedTitle ?? (r.status === "sku_unmatched" ? "—" : "—")}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.parsedCusto != null ? (
                            <span className={r.status === "ok" ? "text-foreground" : "text-muted-foreground"}>
                              {r.parsedCusto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          ) : (
                            <span className="text-red-500">{r.rawCusto || "—"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Help text for unmatched SKUs */}
          {warnRows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-500" />
              SKUs não mapeados precisam ser vinculados a um MLB antes de importar. O vínculo fica salvo para próximas importações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
