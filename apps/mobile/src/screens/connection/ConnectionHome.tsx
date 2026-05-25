import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ConnectionRole } from '../../features/connection/role-store';

export interface ConnectionHomeProps {
  /** null until first load completes. */
  readonly myRole: ConnectionRole | null;
  readonly partnerRole: ConnectionRole | null;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
  readonly onSetMyRole: (role: ConnectionRole) => Promise<void>;
  readonly onBack: () => void;
  readonly onOpenSaved?: () => void;
  readonly onOpenNotes?: () => void;
}

const ROLES: ConnectionRole[] = ['masculine', 'feminine', 'neutral'];

function roleLabel(role: ConnectionRole | null): string {
  return role ?? '— (not set)';
}

/**
 * Phase-1.6 Connection Home — role tile + nav shortcuts. The
 * Phase-1.5-R0 Connection Points tile lived here as a placeholder
 * for the retired couple-loop ledger; it always read 0 because no
 * writer survived the R0 cleanup. R6 replaces it with a Role tile
 * that drives the R4 setMyRole / getConnectionRoles surface.
 */
export function ConnectionHome(props: ConnectionHomeProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);

  async function pick(role: ConnectionRole): Promise<void> {
    setPickerOpen(false);
    await props.onSetMyRole(role);
  }

  return (
    <SafeAreaView style={styles.container} testID="screen.connection-home">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={props.onBack} testID="connection-home.back">
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Connection</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {props.isLoading ? (
          <View style={styles.center} testID="connection-home.loading">
            <ActivityIndicator color="#f5f5f5" />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPickerOpen(true)}
            testID="connection-home.set-role"
            style={styles.tile}
          >
            <Text style={styles.tileLabel}>Roles</Text>
            <Text style={styles.tileRow} testID="connection-home.role.partner_a">
              My role: {roleLabel(props.myRole)}
            </Text>
            <Text style={styles.tileRow} testID="connection-home.role.partner_b">
              Partner's role: {roleLabel(props.partnerRole)}
            </Text>
            <Text style={styles.tileHint}>Tap to change · pull down to refresh</Text>
            {props.busy ? <ActivityIndicator color="#9ec5ff" style={styles.busy} /> : null}
          </Pressable>
        )}

        {props.error ? (
          <Text style={styles.errorText} testID="connection-home.error">
            {props.error}
          </Text>
        ) : null}

        <View style={styles.shortcuts}>
          {props.onOpenNotes ? (
            <Pressable
              accessibilityRole="button"
              testID="connection-home.open-notes"
              onPress={props.onOpenNotes}
              style={styles.shortcutButton}
            >
              <Text style={styles.shortcutText}>Notes</Text>
            </Pressable>
          ) : null}
          {props.onOpenSaved ? (
            <Pressable
              accessibilityRole="button"
              testID="connection-home.open-saved"
              onPress={props.onOpenSaved}
              style={styles.shortcutButton}
            >
              <Text style={styles.shortcutText}>Saved</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="connection-home.refresh"
            onPress={props.onRefresh}
            style={styles.shortcutButton}
          >
            <Text style={styles.shortcutText}>
              {props.isRefreshing ? 'Refreshing…' : 'Refresh'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={pickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop} testID="connection-home.role-picker">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set my role</Text>
            {ROLES.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityState={{ selected: props.myRole === r }}
                testID={`connection-home.role.${r}`}
                onPress={() => void pick(r)}
                style={[styles.roleOption, props.myRole === r && styles.roleOptionActive]}
              >
                <Text
                  style={[styles.roleOptionText, props.myRole === r && styles.roleOptionTextActive]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              testID="connection-home.role-picker.cancel"
              onPress={() => setPickerOpen(false)}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  back: { color: '#9ec5ff', fontSize: 15, minWidth: 60 },
  headerTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  headerSpacer: { width: 60 },
  body: { padding: 16, gap: 16 },
  tile: {
    padding: 18,
    backgroundColor: '#161616',
    borderRadius: 12,
    gap: 8,
  },
  tileLabel: {
    color: '#9e9e9e',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tileRow: { color: '#f5f5f5', fontSize: 16 },
  tileHint: { color: '#5e5e5e', fontSize: 12, paddingTop: 4 },
  busy: { paddingTop: 8 },
  shortcuts: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  shortcutButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shortcutText: { color: '#9ec5ff', fontWeight: '600' },
  errorText: { color: '#ffb4b4', fontSize: 13 },
  center: { paddingTop: 32, alignItems: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#161616',
    borderRadius: 14,
    padding: 18,
    gap: 10,
  },
  modalTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600', paddingBottom: 4 },
  roleOption: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
  },
  roleOptionActive: { backgroundColor: '#9ec5ff' },
  roleOptionText: { color: '#f5f5f5', fontSize: 15, textTransform: 'capitalize' },
  roleOptionTextActive: { color: '#0a0a0a', fontWeight: '600' },
  cancelButton: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: { color: '#9ec5ff', fontSize: 14 },
});
