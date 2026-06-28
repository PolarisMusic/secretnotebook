import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabaseStore } from '../../db/store';
import { DEFAULT_API_CONFIG } from '../../features/api/config';
import { useApiStore } from '../../features/api/store';
import { tryBuildSyncEngine } from '../../features/connection-channel/build-engine';
import { useSyncEngineStore } from '../../features/connection-channel/store';
import { countPendingNotes } from '../../features/notes/pending-store';
import { createBiometricPrompt } from '../../features/pairing/biometric';
import { persistConnection } from '../../features/pairing/persistence';
import type { MainStackParamList } from '../../navigation/MainStack';
import { useConnectionStore } from '../../state/connection';
import { PairWithPartner } from './PairWithPartner';

/**
 * Pairing, presented as a dismissible modal from the unpaired banner /
 * Settings. On success it persists the connection (status='paired'), updates
 * the connection store, and — critically — builds the SyncEngine right here
 * (pairing no longer flows through DefineSafeWord, which used to be the only
 * other place the engine got created), then closes the modal.
 */
export function PairWithPartnerRoute(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const biometric = useMemo(() => createBiometricPrompt(), []);
  const exec = useDatabaseStore((s) => s.exec);
  const apiClient = useApiStore((s) => s.client);
  const completePairing = useConnectionStore((s) => s.completePairing);
  const setEngine = useSyncEngineStore((s) => s.setEngine);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <Pressable
          accessibilityRole="button"
          style={styles.close}
          hitSlop={12}
          onPress={() => navigation.goBack()}
          testID="pairing.close"
        >
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </SafeAreaView>
      <View style={styles.flex}>
        <PairWithPartner
          apiBaseUrl={DEFAULT_API_CONFIG.baseUrl}
          biometric={biometric}
          onPaired={async ({ rootKey, selfPub, peerPub }) => {
            if (!exec) {
              throw new Error('Database is not ready; cannot persist connection');
            }
            const { connectionId } = await persistConnection(exec, { rootKey, selfPub, peerPub });
            completePairing({ connectionId, rootKey });
            // Build the sync engine now so notes start flowing immediately.
            if (apiClient) {
              const engine = await tryBuildSyncEngine({ exec, api: apiClient, connectionId });
              if (engine) setEngine(engine);
            }
            // Drafts authored before pairing → first-connection triage.
            // Otherwise step through the post-pairing setup wizard so new
            // users can set their role, categories, and Safe Word up front.
            if ((await countPendingNotes(exec)) > 0) {
              navigation.navigate('NotesTriage');
            } else {
              navigation.replace('OnboardingRole');
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  flex: { flex: 1 },
  close: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingVertical: 10 },
  closeText: { color: '#9ec5ff', fontSize: 16, fontWeight: '600' },
});
