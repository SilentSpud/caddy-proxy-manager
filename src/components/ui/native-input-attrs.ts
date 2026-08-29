/**
 * Native <input> attributes Astryx forwards but does not type, so they need a cast to get through.
 * Dropping them changes behaviour: `autoComplete` (password managers), `minLength` (sometimes the
 * only enforcement), and `required` — `isRequired` only sets `aria-required`, so NATIVE_REQUIRED is
 * what actually stops an empty submit.
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
 * Restores the browser's own empty-field gate. Pair with `isRequired`, which supplies the visible
 * indicator and the accessible state.
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
