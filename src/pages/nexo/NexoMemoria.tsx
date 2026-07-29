import { useState } from "react";
import { Brain, Check, Trash2, Pencil, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  useNexoMemory, MEMORY_TYPE_LABEL, type NexoMemory, type MemoryType,
} from "@/hooks/useNexoMemory";

/**
 * NexoMemoria — o que o Consultor lembra sobre o seu negócio (Phase 106).
 *
 * Linguagem de leigo (padrão "Clareza para Leigos" da Phase 63-05): nada de "embedding",
 * "prompt" ou "contexto injetado" — o usuário precisa entender o que é, de onde veio e
 * como remover.
 */
export default function NexoMemoria() {
  const { pending, active, archived, approve, discard, edit, create, loading } = useNexoMemory();
  const [editando, setEditando] = useState<NexoMemory | null>(null);
  const [criando, setCriando] = useState(false);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Brain className="h-6 w-6 text-primary" />
            O que o Nexo lembra
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Aqui ficam os fatos que o Nexo carrega em toda conversa nova — decisões que você
            travou, preferências suas e contexto do negócio. Ele sugere o que lembrar; quem
            aprova é você. Pode editar ou remover qualquer item a qualquer momento.
          </p>
        </div>
        <Button onClick={() => setCriando(true)} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar fato
        </Button>
      </div>

      {pending.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {pending.length === 1
                ? "1 sugestão esperando sua aprovação"
                : `${pending.length} sugestões esperando sua aprovação`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((m) => (
              <MemoryItem
                key={m.id}
                m={m}
                onApprove={() => void approve(m.id).then(() => toast.success("Aprovado — o Nexo passa a lembrar."))}
                onDiscard={() => void discard(m.id).then(() => toast("Descartado."))}
                onEdit={() => setEditando(m)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="ativas">
        <TabsList>
          <TabsTrigger value="ativas">Em uso ({active.length})</TabsTrigger>
          <TabsTrigger value="arquivadas">Removidas ({archived.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ativas" className="mt-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!loading && active.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nada guardado ainda. Conforme você conversa com o Nexo, ele sugere o que vale
              lembrar — e você aprova aqui.
            </p>
          )}
          {active.map((m) => (
            <MemoryItem
              key={m.id}
              m={m}
              onDiscard={() => void discard(m.id).then(() => toast("Removido da memória."))}
              onEdit={() => setEditando(m)}
            />
          ))}
        </TabsContent>

        <TabsContent value="arquivadas" className="mt-4 space-y-3">
          {archived.length === 0 && (
            <p className="text-sm text-muted-foreground">Nada removido até agora.</p>
          )}
          {archived.map((m) => (
            <MemoryItem key={m.id} m={m} onApprove={() => void approve(m.id).then(() => toast.success("De volta à memória."))} />
          ))}
        </TabsContent>
      </Tabs>

      <MemoryDialog
        memory={editando}
        open={!!editando}
        onClose={() => setEditando(null)}
        onSave={async (title, body, has_numbers) => {
          if (!editando) return;
          await edit({ id: editando.id, title, body, has_numbers });
          setEditando(null);
          toast.success("Fato atualizado.");
        }}
      />

      <NovoFatoDialog
        open={criando}
        onClose={() => setCriando(false)}
        onSave={async (p) => {
          await create(p);
          setCriando(false);
          toast.success("Fato adicionado.");
        }}
      />
    </div>
  );
}

function MemoryItem({
  m, onApprove, onDiscard, onEdit,
}: {
  m: NexoMemory;
  onApprove?: () => void;
  onDiscard?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{MEMORY_TYPE_LABEL[m.type]}</Badge>
        {m.scope === "user" && <Badge variant="outline">Só para você</Badge>}
        {m.has_numbers && (
          <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-3 w-3" /> Contém número
          </Badge>
        )}
      </div>
      <p className="mt-2 font-medium">{m.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{m.body}</p>
      {m.has_numbers && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Números envelhecem. O Nexo usa este fato como pista e confere o valor atual nos dados
          antes de responder.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onApprove && (
          <Button size="sm" className="h-7 text-xs" onClick={onApprove}>
            <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
          </Button>
        )}
        {onDiscard && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDiscard}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
          </Button>
        )}
      </div>
    </div>
  );
}

function MemoryDialog({
  memory, open, onClose, onSave,
}: {
  memory: NexoMemory | null;
  open: boolean;
  onClose: () => void;
  onSave: (title: string, body: string, hasNumbers: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hasNumbers, setHasNumbers] = useState(false);

  // sincroniza ao abrir
  const chaveAtual = memory?.id ?? "";
  const [chaveSincronizada, setChaveSincronizada] = useState("");
  if (open && chaveAtual !== chaveSincronizada && memory) {
    setChaveSincronizada(chaveAtual);
    setTitle(memory.title);
    setBody(memory.body);
    setHasNumbers(memory.has_numbers);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar fato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Título</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">O fato</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasNumbers}
              onChange={(e) => setHasNumbers(e.target.checked)}
            />
            Contém número que pode envelhecer
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => void onSave(title.trim(), body.trim(), hasNumbers)}
            disabled={!title.trim() || !body.trim()}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovoFatoDialog({
  open, onClose, onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: { title: string; body: string; type: MemoryType; has_numbers: boolean }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<MemoryType>("context");
  const [hasNumbers, setHasNumbers] = useState(false);

  const limpar = () => { setTitle(""); setBody(""); setType("context"); setHasNumbers(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { limpar(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar um fato</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Título</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: CMV é o custo cheio da nota"
            />
          </div>
          <div>
            <label className="text-sm font-medium">O fato</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Escreva em 1-3 frases o que o Nexo deve levar em conta."
            />
          </div>
          <div>
            <label className="text-sm font-medium">Tipo</label>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
            >
              {(Object.keys(MEMORY_TYPE_LABEL) as MemoryType[]).map((t) => (
                <option key={t} value={t}>{MEMORY_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasNumbers}
              onChange={(e) => setHasNumbers(e.target.checked)}
            />
            Contém número que pode envelhecer
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { limpar(); onClose(); }}>Cancelar</Button>
          <Button
            onClick={() => void onSave({ title: title.trim(), body: body.trim(), type, has_numbers: hasNumbers }).then(limpar)}
            disabled={!title.trim() || !body.trim()}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
