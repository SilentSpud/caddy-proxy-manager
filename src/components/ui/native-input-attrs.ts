/**
 * Native <input> attributes that Astryx forwards but does not type.
 *
 * Astryx's TextInput/TextArea spread any unrecognised props straight onto the
 * underlying element, but their prop types only declare the design-system API.
 * Attributes the browser itself acts on therefore need a cast to be passed
 * through, and dropping them silently changes behaviour:
 *
 * - `autoComplete` — without it password managers stop filling and saving.
 * - `minLength` — sometimes the only enforcement there is; the user-create
 *   action, for one, never re-checks password length on the server.
 * - `required` — Astryx's own `isRequired` sets `aria-required` and draws the
 *   "Required" indicator, but never the native attribute, so on its own it does
 *   not stop an empty field being submitted. Forms that post straight to a
 *   server action relied on the browser for that, so they pass NATIVE_REQUIRED
 *   alongside `isRequired`.
 */
type NativeAttrs = Record<string, string | number | boolean>;

const autofill = (value: string): NativeAttrs => ({ autoComplete: value });

export const AUTOFILL_USERNAME = autofill("username");
export const AUTOFILL_CURRENT_PASSWORD = autofill("current-password");
export const AUTOFILL_NEW_PASSWORD = autofill("new-password");
export const AUTOFILL_ONE_TIME_CODE = autofill("one-time-code");
export const AUTOFILL_EMAIL = autofill("email");
export const AUTOFILL_OFF = autofill("off");

/**
 * Restores the browser's own empty-field gate. Pair it with `isRequired`, which
 * supplies the visible indicator and the accessible state.
 */
export const NATIVE_REQUIRED: NativeAttrs = { required: true };

/** Native constraint-validation attributes, e.g. `nativeAttrs({ minLength: 8 })`. */
export function nativeAttrs(attrs: {
  minLength?: number;
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  pattern?: string;
  step?: number | string;
}): NativeAttrs {
  return attrs as NativeAttrs;
}
