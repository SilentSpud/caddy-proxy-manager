/**
 * The executable schema: type definitions plus resolvers, assembled once.
 *
 * Built at module load rather than per request. Parsing SDL and building the type map is not free,
 * and the schema cannot change while the process is running.
 */

import { createSchema } from "graphql-yoga";
import { resolvers } from "./resolvers";
import { typeDefs } from "./typedefs";

export const schema = createSchema({ typeDefs, resolvers });
