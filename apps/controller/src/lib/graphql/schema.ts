/**
 * The executable schema: type definitions plus resolvers, assembled once.
 *
 * Built at module load rather than per request. Parsing SDL and building the type map is not free,
 * and the schema cannot change while the process is running.
 */

import { createSchema } from "graphql-yoga";
import { agentResolvers } from "./agent";
import { resolvers } from "./resolvers";
import { typeDefs } from "./typedefs";

/**
 * Merged by hand rather than with a merge helper: there are exactly two sources and the only
 * overlap is `Mutation`, so a dependency to express that would cost more than the three lines it
 * saves — and it would hide the fact that the agent contributes mutations at all.
 */
export const schema = createSchema({
  typeDefs,
  resolvers: {
    ...resolvers,
    Mutation: { ...resolvers.Mutation, ...agentResolvers.Mutation },
    Subscription: agentResolvers.Subscription,
  },
});
