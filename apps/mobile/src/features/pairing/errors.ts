/**
 * Map the technical error strings that bubble up from the pairing transports,
 * the X3DH handshake, and the orchestrator into short, user-facing copy.
 *
 * The underlying `reason` strings stay technical end-to-end — this is purely
 * the presentation layer, applied where the error screen renders. Matching is
 * by substring against the known messages emitted in:
 *   - features/pairing/relay-transport.ts   (HTTP POST failures, timeout)
 *   - @secretnotebook/connection-protocol    (deserializePairingMessage)
 *   - @secretnotebook/crypto handshake        (peer-identity guard)
 *   - features/pairing/persistence + route    (database-not-ready)
 *
 * The copy stays specific enough to still be diagnostic (404 vs 409 vs 429
 * read differently), but anything unrecognised falls back to a generic retry
 * message rather than leaking raw text to the user.
 */
export function friendlyPairingError(reason: string): string {
  const r = reason.toLowerCase();

  // Relay rendezvous server answered with an HTTP error.
  if (r.includes('rendezvous') || r.includes('post failed')) {
    if (r.includes('404')) {
      return "Couldn't reach the pairing server — it may be updating. Try again in a minute.";
    }
    if (r.includes('409')) {
      return 'That code was already used by another pairing. Create a fresh code and try again.';
    }
    if (r.includes('429')) {
      return 'Too many tries just now. Wait a moment, then try again.';
    }
    return "Couldn't reach the pairing server. Check your connection and try again.";
  }

  // Pairing timed out waiting for the partner to join.
  if (r.includes('timed out') || r.includes('timeout')) {
    return "Your partner didn't join in time. Make sure you're both using the same code, then try again.";
  }

  // Network-level failure (fetch rejected before any HTTP status).
  if (r.includes('network') || r.includes('failed to fetch') || r.includes('connection refused')) {
    return 'Connection problem — check your internet and try again.';
  }

  // The scanned QR / received hello wasn't a valid pairing message.
  if (
    r.includes('pairing message') ||
    r.includes('malformed') ||
    r.includes('unsupported version') ||
    r.includes('unknown kind')
  ) {
    return "That pairing code wasn't valid. Ask your partner for a fresh QR or code and try again.";
  }

  // Scanned your own code (the handshake refuses a self-identity).
  if (r.includes('differ from self') || r.includes('identity must differ')) {
    return "That's your own code — scan your partner's instead.";
  }

  // Local database not ready yet.
  if (r.includes('database')) {
    return 'The app is still getting ready. Give it a second and try again.';
  }

  return 'Something went wrong while pairing. Please try again.';
}
