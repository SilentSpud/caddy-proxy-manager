import { useState } from "react";
import { GeneratedPasswordField } from "@cpm/controller/src/components/ui/GeneratedPasswordField";
import { DemoSurface } from "../DemoSurface";

/**
 * The field itself is controlled, so the demo holds the value the way every form in the app does.
 * Generate, reveal and copy all act on what is in the box.
 */
export default function PasswordFieldDemo() {
  const [password, setPassword] = useState("");

  return (
    <DemoSurface>
      <GeneratedPasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        description="Generated passwords are 24 characters from a mixed alphabet."
        placeholder="Enter or generate a password"
        minLength={12}
        isRequired
      />
    </DemoSurface>
  );
}
