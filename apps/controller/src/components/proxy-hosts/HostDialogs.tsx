"use client";

import { useActionState, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Selector } from "@astryxdesign/core/Selector";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import {
  createProxyHostAction,
  deleteProxyHostAction,
  updateProxyHostAction,
} from "@/src/app/(dashboard)/proxy-hosts/actions";
import { INITIAL_ACTION_STATE } from "@/lib/actions";
import type { AccessList } from "@/lib/models/access-lists";
import type { CertificatePickerOption } from "@/lib/certificate-api";
import type { ProxyHost } from "@/lib/models/proxy-hosts";
import type { AuthentikSettings } from "@/lib/settings";
import { AppDialog } from "@/components/ui/AppDialog";
import { AuthentikFields } from "./AuthentikFields";
import { DnsResolverFields } from "./DnsResolverFields";
import { LoadBalancerFields } from "./LoadBalancerFields";
import { SettingsToggles } from "./SettingsToggles";
import { UpstreamDnsResolutionFields } from "./UpstreamDnsResolutionFields";
import { UpstreamInput } from "./UpstreamInput";
import { GeoBlockFields } from "./GeoBlockFields";
import { WafFields } from "./WafFields";
import { MtlsFields } from "./MtlsConfig";
import { CpmForwardAuthFields } from "./CpmForwardAuthFields";
import { TailscaleFields, type TailscaleHostDefaults } from "./TailscaleFields";
import { RedirectsFields } from "./RedirectsFields";
import { LocationRulesFields } from "./LocationRulesFields";
import { RewriteFields } from "./RewriteFields";
import { PathAllowsFields } from "./PathAllowsFields";
import { PathBlocksFields } from "./PathBlocksFields";
import { PathRewritesFields } from "./PathRewritesFields";
import { ErrorPagesFields } from "./ErrorPagesFields";
import { AdvancedConfigFields } from "./AdvancedConfigFields";
import type { CaCertificate } from "@/lib/models/ca-certificates";
import type { MtlsRole } from "@/lib/models/mtls-roles";
import type { IssuedClientCertificate } from "@/lib/models/issued-client-certificates";
import { AgentAssignmentFields, type AgentOption } from "@/components/agents/AgentAssignmentFields";
import { useTranslations } from "next-intl";

type ForwardAuthUser = { id: number; email: string; name: string | null; role: string };
type ForwardAuthGroup = {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
};
type ForwardAuthAccessData = { userIds: number[]; groupIds: number[] };

const NONE_VALUE = "__none__";

/** The action result banner, shared by all three dialogs. */
function ActionStatus({ status, message }: { status: string; message?: string }) {
  if (status === "idle" || !message) return null;
  return <Banner status={status === "error" ? "error" : "success"} title={message} />;
}

function toOptions(items: { id: number; name: string }[], noneLabel: string) {
  return [
    { value: NONE_VALUE, label: noneLabel },
    ...items.map((item) => ({ value: String(item.id), label: item.name })),
  ];
}

export function CreateHostDialog({
  open,
  onClose,
  certificates,
  accessLists,
  authentikDefaults,
  defaultDomain,
  initialData,
  caCertificates = [],
  mtlsRoles = [],
  issuedClientCerts = [],
  forwardAuthUsers = [],
  forwardAuthGroups = [],
  agents = [],
  tailscaleDefaults,
}: {
  open: boolean;
  onClose: () => void;
  certificates: CertificatePickerOption[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings | null;
  tailscaleDefaults?: TailscaleHostDefaults | null;
  /**
   * Settings → General's default domain, prefilled so the common case is editing a subdomain
   * rather than typing the whole name. Only for a genuinely new host: duplicating one carries
   * the original's domains, which is what the operator opened the dialog to change.
   */
  defaultDomain?: string;
  initialData?: ProxyHost | null;
  caCertificates?: CaCertificate[];
  mtlsRoles?: MtlsRole[];
  issuedClientCerts?: IssuedClientCertificate[];
  forwardAuthUsers?: ForwardAuthUser[];
  forwardAuthGroups?: ForwardAuthGroup[];
  agents?: AgentOption[];
}) {
  const t = useTranslations("proxyHosts");
  const [state, formAction] = useActionState(createProxyHostAction, INITIAL_ACTION_STATE);

  const [name, setName] = useState(initialData ? `${initialData.name} (Copy)` : "");
  const [domains, setDomains] = useState(initialData?.domains.join("\n") ?? defaultDomain ?? "");
  const [certificateId, setCertificateId] = useState(
    String(initialData?.certificateId ?? NONE_VALUE),
  );
  const [accessListId, setAccessListId] = useState(String(initialData?.accessListId ?? NONE_VALUE));

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={initialData ? "Duplicate Proxy Host" : "Create Proxy Host"}
      maxWidth="lg"
      submitLabel={t("create")}
      onSubmit={() => {
        (document.getElementById("create-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <form id="create-host-form" action={formAction}>
        <VStack gap={5}>
          <ActionStatus status={state.status} message={state.message} />
          <SettingsToggles
            hstsSubdomains={initialData?.hstsSubdomains}
            skipHttpsValidation={initialData?.skipHttpsHostnameValidation}
            enabled={true}
          />
          <TextInput
            label={t("name")}
            htmlName="name"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={setName}
            isRequired
          />
          <TextArea
            label={t("domains")}
            htmlName="domains"
            placeholder="app.example.com"
            value={domains}
            onChange={setDomains}
            isRequired
            rows={2}
            description={t("domainsHelp")}
          />
          <UpstreamInput defaultUpstreams={initialData?.upstreams} />
          <Selector
            label={t("certificate")}
            htmlName="certificateId"
            options={toOptions(certificates, "Managed by Caddy (Auto)")}
            value={certificateId}
            onChange={(next) => setCertificateId(next as string)}
          />
          <Selector
            label={t("accessList")}
            htmlName="accessListId"
            options={toOptions(accessLists, "None")}
            value={accessListId}
            onChange={(next) => setAccessListId(next as string)}
          />
          <AgentAssignmentFields agents={agents} selected={[]} />
          <RedirectsFields initialData={initialData?.redirects} />
          <LocationRulesFields initialData={initialData?.locationRules} />
          <RewriteFields initialData={initialData?.rewrite} />
          <PathAllowsFields initialData={initialData?.pathAllows} />
          <PathBlocksFields initialData={initialData?.pathBlocks} />
          <PathRewritesFields initialData={initialData?.pathRewrites} />
          <ErrorPagesFields initialData={initialData?.errorPages} />
          <AdvancedConfigFields host={initialData} />
          <AuthentikFields defaults={authentikDefaults} authentik={initialData?.authentik} />
          <CpmForwardAuthFields
            cpmForwardAuth={initialData?.cpmForwardAuth}
            users={forwardAuthUsers}
            groups={forwardAuthGroups}
          />
          <TailscaleFields tailscale={initialData?.tailscale} defaults={tailscaleDefaults} />
          <LoadBalancerFields loadBalancer={initialData?.loadBalancer} />
          <DnsResolverFields dnsResolver={initialData?.dnsResolver} />
          <UpstreamDnsResolutionFields upstreamDnsResolution={initialData?.upstreamDnsResolution} />
          <GeoBlockFields />
          <WafFields value={initialData?.waf} />
          <MtlsFields
            value={initialData?.mtls}
            caCertificates={caCertificates}
            mtlsRoles={mtlsRoles}
            issuedClientCerts={issuedClientCerts}
          />
        </VStack>
      </form>
    </AppDialog>
  );
}

export function EditHostDialog({
  open,
  host,
  onClose,
  certificates,
  accessLists,
  authentikDefaults,
  caCertificates = [],
  mtlsRoles = [],
  issuedClientCerts = [],
  forwardAuthUsers = [],
  forwardAuthGroups = [],
  forwardAuthAccess,
  agents = [],
  assignedAgentIds = [],
  tailscaleDefaults,
}: {
  open: boolean;
  host: ProxyHost;
  onClose: () => void;
  certificates: CertificatePickerOption[];
  accessLists: AccessList[];
  // Required, matching CreateHostDialog — see AuthentikFields (#232).
  authentikDefaults: AuthentikSettings | null;
  caCertificates?: CaCertificate[];
  mtlsRoles?: MtlsRole[];
  issuedClientCerts?: IssuedClientCertificate[];
  forwardAuthUsers?: ForwardAuthUser[];
  forwardAuthGroups?: ForwardAuthGroup[];
  forwardAuthAccess?: ForwardAuthAccessData | null;
  agents?: AgentOption[];
  assignedAgentIds?: number[];
  tailscaleDefaults?: TailscaleHostDefaults | null;
}) {
  const t = useTranslations("proxyHosts");
  const [state, formAction] = useActionState(
    updateProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE,
  );

  const [name, setName] = useState(host.name);
  const [domains, setDomains] = useState(host.domains.join("\n"));
  const [certificateId, setCertificateId] = useState(String(host.certificateId ?? NONE_VALUE));
  const [accessListId, setAccessListId] = useState(String(host.accessListId ?? NONE_VALUE));

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t("editProxyHost")}
      maxWidth="lg"
      submitLabel={t("saveChanges")}
      onSubmit={() => {
        (document.getElementById("edit-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <form id="edit-host-form" action={formAction}>
        <VStack gap={5}>
          <ActionStatus status={state.status} message={state.message} />
          <SettingsToggles
            hstsSubdomains={host.hstsSubdomains}
            skipHttpsValidation={host.skipHttpsHostnameValidation}
            enabled={host.enabled}
          />
          <TextInput label={t("name")} htmlName="name" value={name} onChange={setName} isRequired />
          <TextArea
            label={t("domains")}
            htmlName="domains"
            value={domains}
            onChange={setDomains}
            rows={2}
            description={t("domainsHelp")}
          />
          <UpstreamInput defaultUpstreams={host.upstreams} />
          <Selector
            label={t("certificate")}
            htmlName="certificateId"
            options={toOptions(certificates, "Managed by Caddy (Auto)")}
            value={certificateId}
            onChange={(next) => setCertificateId(next as string)}
          />
          <Selector
            label={t("accessList")}
            htmlName="accessListId"
            options={toOptions(accessLists, "None")}
            value={accessListId}
            onChange={(next) => setAccessListId(next as string)}
          />
          <AgentAssignmentFields agents={agents} selected={assignedAgentIds} />
          <RedirectsFields initialData={host.redirects} />
          <LocationRulesFields initialData={host.locationRules} />
          <RewriteFields initialData={host.rewrite} />
          <PathAllowsFields initialData={host.pathAllows} />
          <PathBlocksFields initialData={host.pathBlocks} />
          <PathRewritesFields initialData={host.pathRewrites} />
          <ErrorPagesFields initialData={host.errorPages} />
          <AdvancedConfigFields host={host} />
          <AuthentikFields authentik={host.authentik} defaults={authentikDefaults} />
          <CpmForwardAuthFields
            cpmForwardAuth={host.cpmForwardAuth}
            users={forwardAuthUsers}
            groups={forwardAuthGroups}
            currentAccess={forwardAuthAccess}
          />
          <TailscaleFields tailscale={host.tailscale} defaults={tailscaleDefaults} />
          <LoadBalancerFields loadBalancer={host.loadBalancer} />
          <DnsResolverFields dnsResolver={host.dnsResolver} />
          <UpstreamDnsResolutionFields upstreamDnsResolution={host.upstreamDnsResolution} />
          <GeoBlockFields
            initialValues={{
              geoblock: host.geoblock,
              geoblock_mode: host.geoblockMode,
            }}
          />
          <WafFields value={host.waf} />
          <MtlsFields
            value={host.mtls}
            caCertificates={caCertificates}
            proxyHostId={host.id}
            mtlsRoles={mtlsRoles}
            issuedClientCerts={issuedClientCerts}
          />
        </VStack>
      </form>
    </AppDialog>
  );
}

export function DeleteHostDialog({
  open,
  host,
  onClose,
}: {
  open: boolean;
  host: ProxyHost;
  onClose: () => void;
}) {
  const t = useTranslations("proxyHosts");
  const [state, formAction] = useActionState(
    deleteProxyHostAction.bind(null, host.id),
    INITIAL_ACTION_STATE,
  );

  useEffect(() => {
    if (state.status === "success") {
      setTimeout(onClose, 1000);
    }
  }, [state.status, onClose]);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t("deleteProxyHost")}
      maxWidth="sm"
      submitLabel={t("delete")}
      onSubmit={() => {
        (document.getElementById("delete-host-form") as HTMLFormElement)?.requestSubmit();
      }}
    >
      <form id="delete-host-form" action={formAction}>
        <VStack gap={4}>
          <ActionStatus status={state.status} message={state.message} />
          <Text type="body" size="sm">
            Are you sure you want to delete the proxy host <strong>{host.name}</strong>?
          </Text>
          <VStack gap={1}>
            <Text type="body" size="sm" color="secondary">
              {t("deleteDescription")}
            </Text>
            <Text type="body" size="sm" color="secondary">
              • Domains: {host.domains.join(", ")}
            </Text>
            <Text type="body" size="sm" color="secondary">
              • Upstreams: {host.upstreams.join(", ")}
            </Text>
          </VStack>
          <Banner status="warning" title={t("deleteWarning")} />
        </VStack>
      </form>
    </AppDialog>
  );
}
