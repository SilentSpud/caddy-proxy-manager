import { createTranslator } from "use-intl";
import messages from "@cpm/controller/messages/en.json";

/** The English catalog outside a component, for shims answering in the product's words. */
export const t = createTranslator({ locale: "en", messages });
