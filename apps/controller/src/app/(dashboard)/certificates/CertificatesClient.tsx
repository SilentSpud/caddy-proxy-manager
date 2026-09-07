"use client";

import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchField } from "@/components/ui/SearchField";
import type {
  AcmeHost,
  CaCertificateView,
  CertExpiryStatus,
  ImportedCertView,
  ManagedCertView,
  MtlsRole,
} from "./page";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import { StatusSummaryBar } from "./components/StatusSummaryBar";
import { AcmeTab } from "./components/AcmeTab";
import { ImportedTab } from "./components/ImportedTab";
import { CaTab } from "./components/CaTab";
import { MtlsRolesTab } from "@/components/mtls-roles/MtlsRolesTab";
import { countExpiry } from "./certificate-summary";
import { useTranslations } from "next-intl";

type TabId = "acme" | "imported" | "ca" | "roles";

type Props = {
  acmeHosts: AcmeHost[];
  importedCerts: ImportedCertView[];
  managedCerts: ManagedCertView[];
  caCertificates: CaCertificateView[];
  acmePagination: { total: number; page: number; perPage: number };
  healthyAcmeTotal: number;
  mtlsRoles: MtlsRole[];
  issuedClientCerts: IssuedClientCertificate[];
};

export default function CertificatesClient({
  acmeHosts,
  importedCerts,
  managedCerts,
  caCertificates,
  acmePagination,
  healthyAcmeTotal,
  mtlsRoles,
  issuedClientCerts,
}: Props) {
  const t = useTranslations("certificates");
  const [activeTab, setActiveTab] = useState<TabId>("acme");
  const [searchAcme, setSearchAcme] = useState("");
  const [searchImported, setSearchImported] = useState("");
  const [searchCa, setSearchCa] = useState("");
  const [searchRoles, setSearchRoles] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const importedStatuses: (CertExpiryStatus | null)[] = importedCerts.map((c) => c.expiryStatus);
  const { expired, expiringSoon, healthy: importedHealthy } = countExpiry(importedStatuses);
  const healthy = importedHealthy + healthyAcmeTotal;

  const search =
    activeTab === "acme"
      ? searchAcme
      : activeTab === "imported"
        ? searchImported
        : activeTab === "roles"
          ? searchRoles
          : searchCa;
  const setSearch =
    activeTab === "acme"
      ? setSearchAcme
      : activeTab === "imported"
        ? setSearchImported
        : activeTab === "roles"
          ? setSearchRoles
          : setSearchCa;

  function handleTabChange(value: string) {
    setActiveTab(value as TabId);
    setStatusFilter(null);
  }

  return (
    <VStack gap={6}>
      <PageHeader title={t("sslTlsCertificates")} description={t("automaticHttpsDescription")} />

      {/* Status summary filter chips */}
      <StatusSummaryBar
        expired={expired}
        expiringSoon={expiringSoon}
        healthy={healthy}
        filter={statusFilter}
        onFilter={setStatusFilter}
      />

      <VStack gap={4}>
        <HStack gap={4} vAlign="center" wrap="wrap" justify="between">
          <TabList value={activeTab} onChange={handleTabChange}>
            <Tab
              value="acme"
              label={t("acme")}
              endContent={<Badge label={acmePagination.total} />}
            />
            <Tab
              value="imported"
              label={t("imported")}
              endContent={<Badge label={importedCerts.length} />}
            />
            <Tab
              value="ca"
              label={t("caMtls")}
              endContent={<Badge label={caCertificates.length} />}
            />
            <Tab value="roles" label={t("roles")} endContent={<Badge label={mtlsRoles.length} />} />
          </TabList>

          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={
              activeTab === "acme"
                ? "Search by host or domain…"
                : activeTab === "imported"
                  ? "Search by name or domain…"
                  : "Search by name…"
            }
            label={t("searchCertificates")}
          />
        </HStack>

        {/* Only the active tab's panel is mounted, as before. */}
        {activeTab === "acme" && (
          <AcmeTab
            acmeHosts={acmeHosts}
            acmePagination={acmePagination}
            search={searchAcme}
            statusFilter={statusFilter}
          />
        )}
        {activeTab === "imported" && (
          <ImportedTab
            importedCerts={importedCerts}
            managedCerts={managedCerts}
            search={searchImported}
            statusFilter={statusFilter}
          />
        )}
        {activeTab === "ca" && (
          <CaTab caCertificates={caCertificates} search={searchCa} statusFilter={statusFilter} />
        )}
        {activeTab === "roles" && (
          <MtlsRolesTab roles={mtlsRoles} issuedCerts={issuedClientCerts} search={searchRoles} />
        )}
      </VStack>
    </VStack>
  );
}
