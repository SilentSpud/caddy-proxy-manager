"use client";

import { useState } from "react";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { RewriteConfig } from "@/lib/models/proxy-hosts";

type Props = { initialData?: RewriteConfig | null };

export function RewriteFields({ initialData }: Props) {
  // Astryx inputs are controlled; htmlName keeps the value in the submitted
  // FormData exactly as the uncontrolled defaultValue did.
  const [pathPrefix, setPathPrefix] = useState(initialData?.path_prefix ?? "");

  return (
    <TextInput
      label="Path Prefix Rewrite"
      htmlName="rewritePathPrefix"
      value={pathPrefix}
      onChange={setPathPrefix}
      placeholder="/recipes"
      description="Prepend this prefix to every request before proxying (e.g. /recipes → /recipes/original/path)"
    />
  );
}
