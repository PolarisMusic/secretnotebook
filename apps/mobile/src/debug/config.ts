// TEMPORARY: force-enabled for diagnosis. The env-var gate
// (EXPO_PUBLIC_DEBUG_OVERLAY=1) didn't reach a real device for at
// least one tester build — either the env wasn't set at prebuild time
// or Metro's inlining of EXPO_PUBLIC_* missed. Hard-code true while we
// dig in; switch back to the env-driven flag once boot is unblocked.
//
// IMPORTANT: re-gate before any external-tester / production
// distribution — the overlay must not ship to real users.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> } | undefined;
void process; // silence "unused" while the gate is bypassed

export const DEBUG_OVERLAY_ENABLED = true;
