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
} from "@/app/(dashboard)/proxy-hosts/actions";
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
  initialData,
  caCertificates = [],
  mtlsRoles = [],
  issuedClientCerts = [],
  forwardAuthUsers = [],
  forwardAuthGroups = [],
}: {
  open: boolean;
  onClose: () => void;
  certificates: CertificatePickerOption[];
  accessLists: AccessList[];
  authentikDefaults: AuthentikSettings | null;
  initialData?: ProxyHost | null;
  caCertificates?: CaCertificate[];
  mtlsRoles?: MtlsRole[];
  issuedClientCerts?: IssuedClientCertificate[];
  forwardAuthUsers?: ForwardAuthUser[];
  forwardAuthGroups?: ForwardAuthGroup[];
}) {
  const [state, formAction] = useActionState(createProxyHostAction, INITIAL_ACTION_STATE);

  const [name, setName] = useState(initialData ? `${initialData.name} (Copy)` : "");
  const [domains, setDomains] = useState(initialData?.domains.join("\n") ?? "");
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
      submitLabel="Create"
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
            label="Name"
            htmlName="name"
            placeholder="My Service"
            value={name}
            onChange={setName}
            isRequired
          />
          <TextArea
            label="Domains"
            htmlName="domains"
            placeholder="app.example.com"
            value={domains}
            onChange={setDomains}
            isRequired
            rows={2}
            description="One per line or comma-separated. Wildcards like *.example.com are supported."
          />
          <UpstreamInput defaultUpstreams={initialData?.upstreams} />
          <Selector
            label="Certificate"
            htmlName="certificateId"
            options={toOptions(certificates, "Managed by Caddy (Auto)")}
            value={certificateId}
            onChange={(next) => setCertificateId(next as string)}
          />
          <Selector
            label="Access List"
            htmlName="accessListId"
            options={toOptions(accessLists, "None")}
            value={accessListId}
            onChange={(next) => setAccessListId(next as string)}
          />
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
}) {
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
      title="Edit Proxy Host"
      maxWidth="lg"
      submitLabel="Save Changes"
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
          <TextInput label="Name" htmlName="name" value={name} onChange={setName} isRequired />
          <TextArea
            label="Domains"
            htmlName="domains"
            value={domains}
            onChange={setDomains}
            rows={2}
            description="One per line or comma-separated. Wildcards like *.example.com are supported."
          />
          <UpstreamInput defaultUpstreams={host.upstreams} />
          <Selector
            label="Certificate"
            htmlName="certificateId"
            options={toOptions(certificates, "Managed by Caddy (Auto)")}
            value={certificateId}
            onChange={(next) => setCertificateId(next as string)}
          />
          <Selector
            label="Access List"
            htmlName="accessListId"
            options={toOptions(accessLists, "None")}
            value={accessListId}
            onChange={(next) => setAccessListId(next as string)}
          />
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
      title="Delete Proxy Host"
      maxWidth="sm"
      submitLabel="Delete"
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
              This will remove the configuration for:
            </Text>
            <Text type="body" size="sm" color="secondary">
              • Domains: {host.domains.join(", ")}
            </Text>
            <Text type="body" size="sm" color="secondary">
              • Upstreams: {host.upstreams.join(", ")}
            </Text>
          </VStack>
          <Banner status="warning" title="This action cannot be undone" />
        </VStack>
      </form>
    </AppDialog>
  );
}
