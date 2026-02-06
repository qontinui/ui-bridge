/**
 * UI Bridge Native Debug Inspector
 *
 * An overlay component that shows registered elements and allows
 * inspection of the UI Bridge state.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Dimensions,
} from 'react-native';
import { useUIBridgeNativeOptional } from '../react/UIBridgeNativeProvider';
import type { RegisteredNativeElement } from '../core/types';

/**
 * Inspector props
 */
export interface UIBridgeInspectorProps {
  /** Whether to show the inspector */
  visible?: boolean;
  /** Callback when inspector is closed */
  onClose?: () => void;
  /** Position of the inspector toggle button */
  togglePosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Element info card
 */
function ElementCard({
  element,
  onPress,
}: {
  element: RegisteredNativeElement;
  onPress: (element: RegisteredNativeElement) => void;
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();

  return (
    <TouchableOpacity style={styles.elementCard} onPress={() => onPress(element)}>
      <View style={styles.elementHeader}>
        <Text style={styles.elementId}>{element.id}</Text>
        <Text style={styles.elementType}>{element.type}</Text>
      </View>
      {element.label && <Text style={styles.elementLabel}>{element.label}</Text>}
      <View style={styles.stateRow}>
        <StateIndicator label="Mounted" value={state.mounted} />
        <StateIndicator label="Visible" value={state.visible} />
        <StateIndicator label="Enabled" value={state.enabled} />
      </View>
      {identifier.testId && <Text style={styles.testId}>testID: {identifier.testId}</Text>}
    </TouchableOpacity>
  );
}

/**
 * State indicator
 */
function StateIndicator({ label, value }: { label: string; value: boolean }) {
  return (
    <View style={styles.stateIndicator}>
      <View style={[styles.stateDot, { backgroundColor: value ? '#4CAF50' : '#F44336' }]} />
      <Text style={styles.stateLabel}>{label}</Text>
    </View>
  );
}

/**
 * Element detail view
 */
function ElementDetail({
  element,
  onClose,
}: {
  element: RegisteredNativeElement;
  onClose: () => void;
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();

  return (
    <View style={styles.detailContainer}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle}>{element.id}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeButton}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.detailContent}>
        <Text style={styles.sectionTitle}>Type</Text>
        <Text style={styles.sectionValue}>{element.type}</Text>

        {element.label && (
          <>
            <Text style={styles.sectionTitle}>Label</Text>
            <Text style={styles.sectionValue}>{element.label}</Text>
          </>
        )}

        <Text style={styles.sectionTitle}>State</Text>
        <View style={styles.stateSection}>
          <Text style={styles.stateText}>Mounted: {String(state.mounted)}</Text>
          <Text style={styles.stateText}>Visible: {String(state.visible)}</Text>
          <Text style={styles.stateText}>Enabled: {String(state.enabled)}</Text>
          <Text style={styles.stateText}>Focused: {String(state.focused)}</Text>
          {state.value !== undefined && <Text style={styles.stateText}>Value: {state.value}</Text>}
        </View>

        {state.layout && (
          <>
            <Text style={styles.sectionTitle}>Layout</Text>
            <View style={styles.stateSection}>
              <Text style={styles.stateText}>
                Position: ({state.layout.x}, {state.layout.y})
              </Text>
              <Text style={styles.stateText}>
                Size: {state.layout.width} x {state.layout.height}
              </Text>
              <Text style={styles.stateText}>
                Page: ({state.layout.pageX}, {state.layout.pageY})
              </Text>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>Identifier</Text>
        <View style={styles.stateSection}>
          {identifier.uiId && <Text style={styles.stateText}>uiId: {identifier.uiId}</Text>}
          {identifier.testId && <Text style={styles.stateText}>testId: {identifier.testId}</Text>}
          {identifier.accessibilityLabel && (
            <Text style={styles.stateText}>a11yLabel: {identifier.accessibilityLabel}</Text>
          )}
          <Text style={styles.stateText}>treePath: {identifier.treePath}</Text>
        </View>

        <Text style={styles.sectionTitle}>Actions</Text>
        <View style={styles.actionsSection}>
          {element.actions.map((action) => (
            <View key={action} style={styles.actionBadge}>
              <Text style={styles.actionText}>{action}</Text>
            </View>
          ))}
        </View>

        {element.customActions && Object.keys(element.customActions).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Custom Actions</Text>
            <View style={styles.actionsSection}>
              {Object.keys(element.customActions).map((action) => (
                <View key={action} style={[styles.actionBadge, styles.customActionBadge]}>
                  <Text style={styles.actionText}>{action}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * UI Bridge Inspector component
 *
 * Shows an overlay with information about registered elements.
 * Useful for debugging and development.
 *
 * @example
 * ```tsx
 * function App() {
 *   const [showInspector, setShowInspector] = useState(false);
 *
 *   return (
 *     <UIBridgeNativeProvider features={{ debug: __DEV__ }}>
 *       <MainContent />
 *       {__DEV__ && (
 *         <UIBridgeInspector
 *           visible={showInspector}
 *           onClose={() => setShowInspector(false)}
 *         />
 *       )}
 *     </UIBridgeNativeProvider>
 *   );
 * }
 * ```
 */
export function UIBridgeInspector({
  visible = false,
  onClose,
  togglePosition = 'bottom-right',
}: UIBridgeInspectorProps) {
  const bridge = useUIBridgeNativeOptional();
  const [showInspector, setShowInspector] = useState(visible);
  const [selectedElement, setSelectedElement] = useState<RegisteredNativeElement | null>(null);

  const elements = useMemo(() => (bridge ? bridge.getElements() : []), [bridge, showInspector]);

  const components = useMemo(() => (bridge ? bridge.getComponents() : []), [bridge, showInspector]);

  const handleToggle = useCallback(() => {
    setShowInspector((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setShowInspector(false);
    onClose?.();
  }, [onClose]);

  const handleSelectElement = useCallback((element: RegisteredNativeElement) => {
    setSelectedElement(element);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedElement(null);
  }, []);

  // Position style for toggle button
  const toggleStyle = useMemo(() => {
    switch (togglePosition) {
      case 'top-left':
        return { top: 50, left: 10 };
      case 'top-right':
        return { top: 50, right: 10 };
      case 'bottom-left':
        return { bottom: 50, left: 10 };
      case 'bottom-right':
      default:
        return { bottom: 50, right: 10 };
    }
  }, [togglePosition]);

  if (!bridge) {
    return null;
  }

  return (
    <>
      {/* Toggle button */}
      <TouchableOpacity style={[styles.toggleButton, toggleStyle]} onPress={handleToggle}>
        <Text style={styles.toggleText}>UI</Text>
      </TouchableOpacity>

      {/* Inspector modal */}
      <Modal
        visible={showInspector}
        animationType="slide"
        transparent={true}
        onRequestClose={handleClose}
      >
        <View style={styles.modalContainer}>
          <View style={styles.inspectorContainer}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>UI Bridge Inspector</Text>
              <TouchableOpacity onPress={handleClose}>
                <Text style={styles.closeButton}>X</Text>
              </TouchableOpacity>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{elements.length}</Text>
                <Text style={styles.statLabel}>Elements</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{components.length}</Text>
                <Text style={styles.statLabel}>Components</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{bridge.serverRunning ? 'ON' : 'OFF'}</Text>
                <Text style={styles.statLabel}>Server</Text>
              </View>
            </View>

            {/* Element list or detail */}
            {selectedElement ? (
              <ElementDetail element={selectedElement} onClose={handleCloseDetail} />
            ) : (
              <ScrollView style={styles.elementList}>
                {elements.map((element) => (
                  <ElementCard key={element.id} element={element} onPress={handleSelectElement} />
                ))}
                {elements.length === 0 && (
                  <Text style={styles.emptyText}>No elements registered yet</Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const { height: screenHeight } = Dimensions.get('window');

const styles = StyleSheet.create({
  toggleButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  toggleText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  inspectorContainer: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: screenHeight * 0.8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statsRow: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  elementList: {
    padding: 12,
  },
  elementCard: {
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  elementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  elementId: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  elementType: {
    color: '#888',
    fontSize: 12,
    backgroundColor: '#444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  elementLabel: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
  stateRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  stateIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  stateLabel: {
    color: '#888',
    fontSize: 10,
  },
  testId: {
    color: '#666',
    fontSize: 10,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 20,
  },
  detailContainer: {
    flex: 1,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  detailTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  detailContent: {
    padding: 12,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  sectionValue: {
    color: '#fff',
    fontSize: 14,
  },
  stateSection: {
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    padding: 8,
  },
  stateText: {
    color: '#ddd',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  actionsSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  actionBadge: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  customActionBadge: {
    backgroundColor: '#9C27B0',
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
  },
});
