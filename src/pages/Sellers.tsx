import { useState } from "react";
import { Plus, Pencil, Trash2, Check, Power, X, Store } from "lucide-react";
import { useSeller } from "@/contexts/SellerContext";
import { ALL_MARKETPLACES } from "@/types/seller";
import { getMarketplaceBrand } from "@/config/marketplaceConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const MARKETPLACES_NO_TOTAL = ALL_MARKETPLACES;

export default function Sellers() {
  const {
    sellers, loading, addSeller, updateSeller, deleteSeller, toggleSellerActive,
    addStore, deleteStore, selectedSeller, setSelectedSeller,
  } = useSeller();
  const { toast } = useToast();

  // --- Add seller dialog ---
  const [addSellerOpen, setAddSellerOpen] = useState(false);
  const [newSellerName, setNewSellerName] = useState("");

  const handleAddSeller = async () => {
    if (!newSellerName.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    const s = await addSeller(newSellerName.trim());
    if (s) {
      toast({ title: "Seller criado", description: s.name });
      setAddSellerOpen(false);
      setNewSellerName("");
    } else {
      toast({ title: "Erro ao criar seller", variant: "destructive" });
    }
  };

  // --- Edit seller dialog ---
  const [editSellerId, setEditSellerId] = useState<string | null>(null);
  const [editSellerName, setEditSellerName] = useState("");
  const [editSellerLogo, setEditSellerLogo] = useState("");

  const openEditSeller = (id: string, name: string, logo_url: string | null) => {
    setEditSellerId(id);
    setEditSellerName(name);
    setEditSellerLogo(logo_url ?? "");
  };

  const handleUpdateSeller = async () => {
    if (!editSellerId || !editSellerName.trim()) return;
    await updateSeller(editSellerId, {
      name: editSellerName.trim(),
      logo_url: editSellerLogo.trim() || null,
    });
    toast({ title: "Seller atualizado" });
    setEditSellerId(null);
    setEditSellerName("");
    setEditSellerLogo("");
  };

  // --- Add store dialog ---
  const [addStoreForSeller, setAddStoreForSeller] = useState<string | null>(null);
  const [storeMarketplace, setStoreMarketplace] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeExternalId, setStoreExternalId] = useState("");

  const resetStoreForm = () => {
    setStoreMarketplace("");
    setStoreName("");
    setStoreExternalId("");
  };

  const handleAddStore = async () => {
    if (!addStoreForSeller || !storeMarketplace || !storeName.trim()) {
      toast({ title: "Preencha marketplace e nome da loja", variant: "destructive" });
      return;
    }
    const mp = MARKETPLACES_NO_TOTAL.find((m) => m.id === storeMarketplace);
    const defaultName = storeName.trim() || mp?.name || storeMarketplace;
    const st = await addStore(addStoreForSeller, {
      marketplace: storeMarketplace,
      store_name: defaultName,
      external_id: storeExternalId.trim() || undefined,
    });
    if (st) {
      toast({ title: "Loja adicionada", description: defaultName });
      setAddStoreForSeller(null);
      resetStoreForm();
    } else {
      toast({ title: "Erro ao adicionar loja", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
            <CardContent><Skeleton className="h-20 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Sellers</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              {sellers.length} {sellers.length === 1 ? "seller cadastrado" : "sellers cadastrados"}
            </p>
          </div>
          <Dialog open={addSellerOpen} onOpenChange={setAddSellerOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-sm" onClick={() => setNewSellerName("")}>
              <Plus className="h-4 w-4 mr-1.5" /> Novo Seller
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Seller</DialogTitle>
              <DialogDescription>Informe o nome da empresa ou marca.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="seller-name">Nome</Label>
              <Input
                id="seller-name"
                value={newSellerName}
                onChange={(e) => setNewSellerName(e.target.value)}
                placeholder="Ex: Sandrini"
                onKeyDown={(e) => e.key === "Enter" && handleAddSeller()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddSellerOpen(false)}>Cancelar</Button>
              <Button onClick={handleAddSeller}><Check className="h-4 w-4 mr-2" />Criar</Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {sellers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Store className="h-10 w-10 opacity-40" />
          <p className="text-sm">Nenhum seller cadastrado. Clique em <strong>Novo Seller</strong> para começar.</p>
        </div>
      )}

      {/* Sellers Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...sellers].sort((a, b) => b.stores.length - a.stores.length || a.name.localeCompare(b.name)).map((seller) => (
          <Card
            key={seller.id}
            className={`transition-all duration-300 ease-in-out rounded-xl border shadow-sm hover:shadow-md ${!seller.is_active ? "opacity-60" : ""} ${
              selectedSeller?.id === seller.id
                ? "border-primary/40 bg-primary/[0.02] shadow-primary/10 scale-[1.02]"
                : "border-border scale-100"
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  {seller.logo_url ? (
                    <img
                      src={seller.logo_url}
                      alt={seller.name}
                      className="w-10 h-10 rounded-lg object-cover shrink-0 border"
                    />
                  ) : (
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      seller.is_active ? "bg-primary/10" : "bg-muted"
                    }`}>
                      <span className={`text-sm font-bold ${seller.is_active ? "text-primary" : "text-muted-foreground"}`}>
                        {seller.initials}
                      </span>
                    </div>
                  )}
                  <div>
                    <CardTitle className="text-base">{seller.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {seller.stores.length} {seller.stores.length === 1 ? "loja" : "lojas"}
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {selectedSeller?.id === seller.id && (
                    <Badge className="text-[10px] h-5 bg-primary/10 text-primary border-0 font-medium">Ativo</Badge>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="icon" className="h-9 w-9 hover:bg-green-100 dark:hover:bg-green-950"
                        onClick={() => toggleSellerActive(seller.id)}
                      >
                        <Power className={`h-4 w-4 ${seller.is_active ? "text-green-500" : "text-muted-foreground"}`} />
                        <span className="sr-only">{seller.is_active ? "Desativar" : "Ativar"} seller</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{seller.is_active ? "Desativar" : "Ativar"}</TooltipContent>
                  </Tooltip>

                  {/* Edit seller name */}
                  <Dialog open={editSellerId === seller.id} onOpenChange={(o) => { if (!o) setEditSellerId(null); }}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-muted" onClick={() => openEditSeller(seller.id, seller.name, seller.logo_url)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Editar Seller</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Nome</Label>
                          <Input value={editSellerName} onChange={(e) => setEditSellerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUpdateSeller()} />
                        </div>
                        <div className="space-y-2">
                          <Label>URL do Logo</Label>
                          <Input
                            value={editSellerLogo}
                            onChange={(e) => setEditSellerLogo(e.target.value)}
                            placeholder="https://exemplo.com/logo.jpg"
                          />
                          {editSellerLogo && (
                            <div className="flex items-center gap-3 mt-2">
                              <img
                                src={editSellerLogo}
                                alt="Preview"
                                className="h-12 w-12 rounded-lg object-cover border"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <span className="text-xs text-muted-foreground">Preview do logo</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setEditSellerId(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateSeller}><Check className="h-4 w-4 mr-2" />Salvar</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Delete seller */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10" disabled={sellers.length <= 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover {seller.name}?</AlertDialogTitle>
                        <AlertDialogDescription>Esta ação remove o seller e todas as suas lojas. Não pode ser desfeita.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={async () => {
                          const ok = await deleteSeller(seller.id);
                          if (ok) toast({ title: `${seller.name} removido` });
                          else toast({ title: "Não é possível remover o único seller", variant: "destructive" });
                        }}>Remover</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* Stores list */}
              <div className="space-y-1">
                {seller.stores.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Nenhuma loja cadastrada</p>
                )}
                {[...seller.stores].sort((a, b) => a.store_name.localeCompare(b.store_name)).map((store) => {
                  const mp = ALL_MARKETPLACES.find((m) => m.id === store.marketplace);
                  const brand = getMarketplaceBrand(store.marketplace);
                  const BrandIcon = brand?.icon;
                  return (
                    <div key={store.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 text-sm">
                      <span className="flex items-center gap-1.5">
                        {BrandIcon ? (
                          <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gradient-to-br ${brand.gradient}`}>
                            <BrandIcon className="h-2.5 w-2.5 text-white" />
                          </div>
                         ) : null}
                        <span className="font-medium">{store.store_name}</span>
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                            <X className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover loja?</AlertDialogTitle>
                            <AlertDialogDescription>Remover <strong>{store.store_name}</strong> de {seller.name}?</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={async () => {
                              await deleteStore(store.id);
                              toast({ title: `${store.store_name} removida` });
                            }}>Remover</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
              </div>

              {/* Footer actions */}
              <div className="flex gap-2 pt-1 border-t">
                {selectedSeller?.id !== seller.id && (
                  <Button variant="outline" size="sm" className="flex-1 rounded-lg" onClick={() => setSelectedSeller(seller.id)}>
                    Selecionar
                  </Button>
                )}
                {selectedSeller?.id === seller.id && (
                  <div className="flex-1 flex items-center justify-center text-xs font-medium text-primary gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Selecionado
                  </div>
                )}

                {/* Add store button */}
                <Dialog
                  open={addStoreForSeller === seller.id}
                  onOpenChange={(o) => { if (!o) { setAddStoreForSeller(null); resetStoreForm(); } }}
                >
                  <DialogTrigger asChild>
                     <Button variant="outline" size="sm" className="gap-1" onClick={() => setAddStoreForSeller(seller.id)}>
                       <Plus className="h-3.5 w-3.5" />
                       <span>Add loja</span>
                     </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Adicionar Loja — {seller.name}</DialogTitle>
                      <DialogDescription>Escolha o marketplace e dê um nome à loja.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Marketplace</Label>
                        <Select value={storeMarketplace} onValueChange={(v) => {
                          setStoreMarketplace(v);
                          const mp = MARKETPLACES_NO_TOTAL.find((m) => m.id === v);
                          if (mp && !storeName) setStoreName(mp.name);
                        }}>
                          <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                          <SelectContent>
                             {MARKETPLACES_NO_TOTAL.map((mp) => {
                               const brand = getMarketplaceBrand(mp.id);
                               const BrandIcon = brand?.icon;
                               return (
                                 <SelectItem key={mp.id} value={mp.id}>
                                   <span className="flex items-center gap-2">
                                     {BrandIcon ? (
                                       <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gradient-to-br ${brand.gradient}`}>
                                         <BrandIcon className="h-2.5 w-2.5 text-white" />
                                       </div>
                                     ) : null}
                                     {mp.name}
                                   </span>
                                 </SelectItem>
                               );
                             })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Nome da Loja</Label>
                        <Input
                          value={storeName}
                          onChange={(e) => setStoreName(e.target.value)}
                          placeholder="Ex: Shopee Sports, ML SP"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>ID externo <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                        <Input
                          value={storeExternalId}
                          onChange={(e) => setStoreExternalId(e.target.value)}
                          placeholder="ID da conta no marketplace"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { setAddStoreForSeller(null); resetStoreForm(); }}>Cancelar</Button>
                      <Button onClick={handleAddStore}><Check className="h-4 w-4 mr-2" />Adicionar</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
