/**
 * The two scalars the schema needs beyond the built-ins.
 *
 * `JSON` carries the free-form configuration blobs - a proxy host's load-balancer settings, WAF
 * overrides, geoblock rules, location rules. Those are validated by the model layer against shapes
 * that change with the product, and mirroring each of them as GraphQL input types would be several
 * thousand lines that must be kept in step with validators that already exist. Worse, it would
 * make the schema *look* like the authority on a shape it is not.
 *
 * So the rule is: anything with a fixed, queryable shape is a real field, and configuration that
 * the models validate travels as JSON. That keeps the schema honest about which is which, and it
 * is what lets a GraphQL mutation and the REST route it replaces run the same validation on the
 * same input.
 */

import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from "graphql";

/** Depth limit for a literal JSON value written inline in a query document. */
const MAX_LITERAL_DEPTH = 32;

function literalToJson(node: ValueNode, depth = 0): unknown {
  if (depth > MAX_LITERAL_DEPTH) {
    throw new GraphQLError("JSON literal nested too deeply", { nodes: node });
  }
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.OBJECT:
      return Object.fromEntries(
        node.fields.map((field) => [field.name.value, literalToJson(field.value, depth + 1)]),
      );
    case Kind.LIST:
      return node.values.map((value) => literalToJson(value, depth + 1));
    case Kind.NULL:
      return null;
    default:
      // An enum or a variable reference. Neither is a JSON value, and guessing at one would accept
      // a document that means something other than it appears to.
      throw new GraphQLError(`Cannot represent ${node.kind} as JSON`, { nodes: node });
  }
}

export const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description:
    "An arbitrary JSON value. Used for configuration the model layer validates, rather than " +
    "restating those shapes in the schema where the two could drift apart.",
  serialize: (value) => value,
  parseValue: (value) => value,
  // Wrapped rather than passed directly: the depth counter is this function's business,
  // and GraphQL calls a literal parser with (node, variables).
  parseLiteral: (node) => literalToJson(node),
});

/**
 * An ISO 8601 timestamp, as a string.
 *
 * The database stores these as text already, so this documents the format rather than converting
 * anything - a Date round-tripped through JSON would arrive as a string regardless.
 */
export const DateTimeScalar = new GraphQLScalarType<string, string>({
  name: "DateTime",
  description: "An ISO 8601 timestamp, e.g. 2026-09-08T12:00:00.000Z.",
  serialize: (value) => String(value),
  parseValue: (value) => {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new GraphQLError("DateTime must be an ISO 8601 string");
    }
    return value;
  },
  parseLiteral: (node) => {
    if (node.kind !== Kind.STRING || Number.isNaN(Date.parse(node.value))) {
      throw new GraphQLError("DateTime must be an ISO 8601 string", { nodes: node });
    }
    return node.value;
  },
});
