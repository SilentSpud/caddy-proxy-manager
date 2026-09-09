import { AgentAssignmentFields } from "@cpm/controller/src/components/agents/AgentAssignmentFields";
import { DemoSurface } from "../DemoSurface";

/** A fleet of three, one of them offline - the case the card exists to make visible. */
export default function AgentAssignmentDemo() {
  return (
    <DemoSurface>
      <AgentAssignmentFields
        agents={[
          { id: 1, name: "bundled", connected: true, hasOwnBuildSettings: false },
          { id: 2, name: "edge-fra", connected: true, hasOwnBuildSettings: true },
          { id: 3, name: "edge-syd", connected: false, hasOwnBuildSettings: false },
        ]}
        selected={[1, 2]}
      />
    </DemoSurface>
  );
}
