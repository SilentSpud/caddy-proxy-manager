"use client";

import { useState } from "react";
import { MinusCircle, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";

type UpstreamEntry = {
  protocol: string;
  address: string;
};

const PROTOCOL_OPTIONS = [
  { value: "http://", label: "http://" },
  { value: "https://", label: "https://" },
];

function parseUpstream(upstream: string): UpstreamEntry {
  if (upstream.startsWith("https://")) {
    return { protocol: "https://", address: upstream.slice(8) };
  }
  if (upstream.startsWith("http://")) {
    return { protocol: "http://", address: upstream.slice(7) };
  }
  return { protocol: "http://", address: upstream };
}

export function UpstreamInput({
  defaultUpstreams = [],
  name = "upstreams",
}: {
  defaultUpstreams?: string[];
  name?: string;
}) {
  const initialEntries: UpstreamEntry[] =
    defaultUpstreams.length > 0
      ? defaultUpstreams.map(parseUpstream)
      : [{ protocol: "http://", address: "" }];

  const [entries, setEntries] = useState<UpstreamEntry[]>(initialEntries);

  const handleProtocolChange = (index: number, newProtocol: string) => {
    setEntries((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, protocol: newProtocol || "http://" } : entry
      )
    );
  };

  const handleAddressChange = (index: number, newAddress: string) => {
    setEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        // Strip protocol if the user pasted a full URL.
        if (newAddress.startsWith("https://")) {
          return { protocol: "https://", address: newAddress.slice(8) };
        }
        if (newAddress.startsWith("http://")) {
          return { protocol: "http://", address: newAddress.slice(7) };
        }
        return { ...entry, address: newAddress };
      })
    );
  };

  const handleAdd = () => setEntries((prev) => [...prev, { protocol: "http://", address: "" }]);

  const handleRemove = (index: number) =>
    setEntries((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const serializedValue = entries
    .filter((e) => e.address.trim() !== "")
    .map((e) => `${e.protocol}${e.address.trim()}`)
    .join("\n");

  const isOnlyEntry = entries.length === 1;

  return (
    <VStack gap={2}>
      <input type="hidden" name={name} value={serializedValue} />
      <Text type="body" size="sm" weight="semibold">
        Upstreams
      </Text>

      <VStack gap={3}>
        {entries.map((entry, index) => (
          <HStack key={index} gap={2} vAlign="end">
            <Selector
              label="Protocol"
              isLabelHidden
              width={120}
              options={PROTOCOL_OPTIONS}
              value={entry.protocol}
              onChange={(next) => handleProtocolChange(index, next as string)}
            />
            <TextInput
              label={`Upstream ${index + 1}`}
              isLabelHidden
              value={entry.address}
              onChange={(next) => handleAddressChange(index, next)}
              placeholder="10.0.0.5:8080"
              isRequired={index === 0}
            />
            <IconButton
              variant="ghost"
              size="sm"
              label={`Remove upstream ${index + 1}`}
              icon={<MinusCircle />}
              isDisabled={isOnlyEntry}
              // Explains the disabled state on hover, replacing a title on a
              // wrapper span that screen readers never announced.
              tooltip={isOnlyEntry ? "At least one upstream is required" : "Remove upstream"}
              onClick={() => handleRemove(index)}
            />
          </HStack>
        ))}

        <HStack>
          <Button variant="ghost" size="sm" label="Add Upstream" icon={<Plus />} onClick={handleAdd} />
        </HStack>
      </VStack>

      <Text type="body" size="xsm" color="secondary">
        Backend servers to proxy requests to
      </Text>
    </VStack>
  );
}
