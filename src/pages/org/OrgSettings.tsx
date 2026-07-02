import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/contexts/OrganizationContext";
import { OrgGeneralTab } from "@/components/org/OrgGeneralTab";
import { OrgMembersTab } from "@/components/org/OrgMembersTab";
import { OrgInvitesTab } from "@/components/org/OrgInvitesTab";
import { OrgAuditTab } from "@/components/org/OrgAuditTab";
import { Building2 } from "lucide-react";

export default function OrgSettings() {
  const { currentOrg, orgRole } = useOrganization();
  const [tab, setTab] = useState("geral");

  if (!currentOrg) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Nenhuma organização selecionada.</div>
    );
  }

  const isOwner = orgRole === "owner";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{currentOrg.name}</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Gerencie sua organização, membros e convites</p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 mb-6">
          <TabsList className="flex-nowrap w-max min-w-full">
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="membros">Membros</TabsTrigger>
            <TabsTrigger value="convites">Convites</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="geral">
          <OrgGeneralTab org={currentOrg} canEdit={isOwner} />
        </TabsContent>
        <TabsContent value="membros">
          <OrgMembersTab orgId={currentOrg.id} myRole={orgRole!} />
        </TabsContent>
        <TabsContent value="convites">
          <OrgInvitesTab orgId={currentOrg.id} />
        </TabsContent>
        <TabsContent value="audit">
          <OrgAuditTab orgId={currentOrg.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}