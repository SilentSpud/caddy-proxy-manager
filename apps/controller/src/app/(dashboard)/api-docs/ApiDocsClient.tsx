"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import "./swagger-ui-overrides.css";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PageHeader } from "@/components/ui/PageHeader";
import { useTranslations } from "next-intl";

/**
 * API documentation is bundled with the application. Keeping executable assets
 * same-origin avoids granting a mutable CDN administrator-level script access.
 *
 * The explorer itself stays Swagger UI - it already resolves $ref, renders schemas and issues
 * requests, and a hand-written replacement would be a large surface to keep correct for no gain.
 * What it does not do is say where it is pointed or that a second API exists beside it, so the
 * page supplies that above it.
 */
export default function ApiDocsClient() {
  const t = useTranslations("apiDocs");

  return (
    <VStack gap={4}>
      <PageHeader title={t("title")} description={t("pageDescription")} />

      <Card padding={4}>
        <HStack gap={4} vAlign="center" wrap="wrap" justify="between">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Text type="label" weight="bold">
                {t("restApi")}
              </Text>
              <Badge variant="info" label="v1" />
            </HStack>
            <Text type="supporting" color="secondary">
              {t("restApiNote")}
            </Text>
          </VStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Button
              as="a"
              variant="secondary"
              size="sm"
              label={t("openApiSpec")}
              href="/api/v1/openapi.json"
              target="_blank"
            />
            <Button
              as="a"
              variant="secondary"
              size="sm"
              label={t("graphqlEndpoint")}
              href="/api/graphql"
              target="_blank"
            />
          </HStack>
        </HStack>
      </Card>

      <div className="w-full min-h-[600px] -mx-4 md:-mx-8 px-4 md:px-8">
        <SwaggerUI url="/api/v1/openapi.json" deepLinking defaultModelsExpandDepth={1} />
      </div>
    </VStack>
  );
}
