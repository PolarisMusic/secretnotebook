import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';

import { useDatabaseStore } from '../../db/store';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import {
  getConnectionRoles,
  setMyRole,
  type ConnectionRole,
} from '../../features/connection/role-store';
import type { MainStackParamList } from '../../navigation/MainStack';
import { ConnectionHome } from './ConnectionHome';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Production wiring for ConnectionHome. Reads both partners' roles via
 * `getConnectionRoles`; identifies the local side by byte-comparing
 * the connection's partner_{a,b}_pubkey columns to the engine's
 * selfPub so the UI can label "My role" vs "Partner's role"
 * correctly. Pull-to-refresh + post-save both kick `engine.pull()`
 * so the partner's value lands without waiting for the 15s ticker.
 */
export function ConnectionHomeRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const exec = useDatabaseStore((s) => s.exec);
  const engine = useSyncEngineStore((s) => s.engine);
  const [myRole, setMyRoleState] = useState<ConnectionRole | null>(null);
  const [partnerRole, setPartnerRole] = useState<ConnectionRole | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!exec) return;
    setIsRefreshing(true);
    try {
      if (engine) {
        try {
          await engine.pull();
        } catch {
          // best-effort; the partner's value will appear on the next pull
        }
      }
      const snap = await getConnectionRoles(exec);
      if (!snap || !engine) {
        setMyRoleState(null);
        setPartnerRole(null);
        setLoaded(true);
        return;
      }
      // The engine knows its own selfPub but not which connection
      // partner slot it occupies; resolve that here by hydrating the
      // connection row inside getConnectionRoles and comparing.
      // role-store doesn't currently surface the partner pubkeys, so
      // we infer side via the same `connection` row by re-reading
      // the relevant columns through a narrow query below — kept
      // here rather than complicating role-store's snapshot shape.
      const rows = await exec.query<{
        partner_a_pubkey: Uint8Array | ArrayBufferLike;
      }>(`SELECT partner_a_pubkey FROM connection WHERE id = ?`, [snap.connectionId]);
      const aPub =
        rows[0]?.partner_a_pubkey instanceof Uint8Array
          ? (rows[0]?.partner_a_pubkey as Uint8Array)
          : new Uint8Array(rows[0]?.partner_a_pubkey as ArrayBufferLike);
      const isA = sameBytes(engine.selfPub, aPub);
      setMyRoleState(isA ? snap.partnerARole : snap.partnerBRole);
      setPartnerRole(isA ? snap.partnerBRole : snap.partnerARole);
      setLoaded(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [exec, engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSetRole = useCallback(
    async (role: ConnectionRole) => {
      if (!exec || !engine) return;
      setBusy(true);
      setError(null);
      try {
        await setMyRole(
          { exec, selfPubkey: engine.selfPub, enqueue: (op) => engine.enqueue(op) },
          role,
        );
        await refresh();
      } catch (e) {
        setError((e as Error).message ?? 'Could not save role');
      } finally {
        setBusy(false);
      }
    },
    [exec, engine, refresh],
  );

  return (
    <ConnectionHome
      myRole={myRole}
      partnerRole={partnerRole}
      isLoading={!loaded}
      isRefreshing={isRefreshing}
      busy={busy}
      error={error}
      onRefresh={() => void refresh()}
      onSetMyRole={handleSetRole}
      onBack={() => navigation.goBack()}
      onOpenSaved={engine ? () => navigation.navigate('SavedByYou') : undefined}
      onOpenNotes={engine ? () => navigation.navigate('NotesList') : undefined}
    />
  );
}
