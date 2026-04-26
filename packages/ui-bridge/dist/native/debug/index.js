'use strict';

var react = require('react');
var reactNative = require('react-native');
var jsxRuntime = require('react/jsx-runtime');

// src/native/debug/inspector.tsx
var UIBridgeNativeContext = react.createContext(null);
function useUIBridgeNativeOptional() {
  return react.useContext(UIBridgeNativeContext);
}
function ElementCard({
  element,
  onPress
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();
  return /* @__PURE__ */ jsxRuntime.jsxs(reactNative.TouchableOpacity, { style: styles.elementCard, onPress: () => onPress(element), children: [
    /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.elementHeader, children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.elementId, children: element.id }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.elementType, children: element.type })
    ] }),
    element.label && /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.elementLabel, children: element.label }),
    /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stateRow, children: [
      /* @__PURE__ */ jsxRuntime.jsx(StateIndicator, { label: "Mounted", value: state.mounted }),
      /* @__PURE__ */ jsxRuntime.jsx(StateIndicator, { label: "Visible", value: state.visible }),
      /* @__PURE__ */ jsxRuntime.jsx(StateIndicator, { label: "Enabled", value: state.enabled })
    ] }),
    identifier.testId && /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.testId, children: [
      "testID: ",
      identifier.testId
    ] })
  ] });
}
function StateIndicator({ label, value }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stateIndicator, children: [
    /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: [styles.stateDot, { backgroundColor: value ? "#4CAF50" : "#F44336" }] }),
    /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.stateLabel, children: label })
  ] });
}
function ElementDetail({
  element,
  onClose
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();
  return /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.detailContainer, children: [
    /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.detailHeader, children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.detailTitle, children: element.id }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.TouchableOpacity, { onPress: onClose, children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.closeButton, children: "Close" }) })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs(reactNative.ScrollView, { style: styles.detailContent, children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Type" }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionValue, children: element.type }),
      element.label && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Label" }),
        /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionValue, children: element.label })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "State" }),
      /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stateSection, children: [
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "Mounted: ",
          String(state.mounted)
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "Visible: ",
          String(state.visible)
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "Enabled: ",
          String(state.enabled)
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "Focused: ",
          String(state.focused)
        ] }),
        state.value !== void 0 && /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "Value: ",
          state.value
        ] })
      ] }),
      state.layout && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Layout" }),
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stateSection, children: [
          /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
            "Position: (",
            state.layout.x,
            ", ",
            state.layout.y,
            ")"
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
            "Size: ",
            state.layout.width,
            " x ",
            state.layout.height
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
            "Page: (",
            state.layout.pageX,
            ", ",
            state.layout.pageY,
            ")"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Identifier" }),
      /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stateSection, children: [
        identifier.uiId && /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "uiId: ",
          identifier.uiId
        ] }),
        identifier.testId && /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "testId: ",
          identifier.testId
        ] }),
        identifier.accessibilityLabel && /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "a11yLabel: ",
          identifier.accessibilityLabel
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs(reactNative.Text, { style: styles.stateText, children: [
          "treePath: ",
          identifier.treePath
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Actions" }),
      /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: styles.actionsSection, children: element.actions.map((action) => /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: styles.actionBadge, children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.actionText, children: action }) }, action)) }),
      element.customActions && Object.keys(element.customActions).length > 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.sectionTitle, children: "Custom Actions" }),
        /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: styles.actionsSection, children: Object.keys(element.customActions).map((action) => /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: [styles.actionBadge, styles.customActionBadge], children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.actionText, children: action }) }, action)) })
      ] })
    ] })
  ] });
}
function UIBridgeInspector({
  visible = false,
  onClose,
  togglePosition = "bottom-right"
}) {
  const bridge = useUIBridgeNativeOptional();
  const [showInspector, setShowInspector] = react.useState(visible);
  const [selectedElement, setSelectedElement] = react.useState(null);
  const elements = react.useMemo(() => bridge ? bridge.getElements() : [], [bridge, showInspector]);
  const components = react.useMemo(() => bridge ? bridge.getComponents() : [], [bridge, showInspector]);
  const handleToggle = react.useCallback(() => {
    setShowInspector((prev) => !prev);
  }, []);
  const handleClose = react.useCallback(() => {
    setShowInspector(false);
    onClose?.();
  }, [onClose]);
  const handleSelectElement = react.useCallback((element) => {
    setSelectedElement(element);
  }, []);
  const handleCloseDetail = react.useCallback(() => {
    setSelectedElement(null);
  }, []);
  const toggleStyle = react.useMemo(() => {
    switch (togglePosition) {
      case "top-left":
        return { top: 50, left: 10 };
      case "top-right":
        return { top: 50, right: 10 };
      case "bottom-left":
        return { bottom: 50, left: 10 };
      case "bottom-right":
      default:
        return { bottom: 50, right: 10 };
    }
  }, [togglePosition]);
  if (!bridge) {
    return null;
  }
  return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
    /* @__PURE__ */ jsxRuntime.jsx(reactNative.TouchableOpacity, { style: [styles.toggleButton, toggleStyle], onPress: handleToggle, children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.toggleText, children: "UI" }) }),
    /* @__PURE__ */ jsxRuntime.jsx(
      reactNative.Modal,
      {
        visible: showInspector,
        animationType: "slide",
        transparent: true,
        onRequestClose: handleClose,
        children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.View, { style: styles.modalContainer, children: /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.inspectorContainer, children: [
          /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.header, children: [
            /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.headerTitle, children: "UI Bridge Inspector" }),
            /* @__PURE__ */ jsxRuntime.jsx(reactNative.TouchableOpacity, { onPress: handleClose, children: /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.closeButton, children: "X" }) })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.statsRow, children: [
            /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stat, children: [
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statValue, children: elements.length }),
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statLabel, children: "Elements" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stat, children: [
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statValue, children: components.length }),
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statLabel, children: "Components" })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs(reactNative.View, { style: styles.stat, children: [
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statValue, children: bridge.serverRunning ? "ON" : "OFF" }),
              /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.statLabel, children: "Server" })
            ] })
          ] }),
          selectedElement ? /* @__PURE__ */ jsxRuntime.jsx(ElementDetail, { element: selectedElement, onClose: handleCloseDetail }) : /* @__PURE__ */ jsxRuntime.jsxs(reactNative.ScrollView, { style: styles.elementList, children: [
            elements.map((element) => /* @__PURE__ */ jsxRuntime.jsx(ElementCard, { element, onPress: handleSelectElement }, element.id)),
            elements.length === 0 && /* @__PURE__ */ jsxRuntime.jsx(reactNative.Text, { style: styles.emptyText, children: "No elements registered yet" })
          ] })
        ] }) })
      }
    )
  ] });
}
var { height: screenHeight } = reactNative.Dimensions.get("window");
var styles = reactNative.StyleSheet.create({
  toggleButton: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2196F3",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1e3
  },
  toggleText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end"
  },
  inspectorContainer: {
    backgroundColor: "#1e1e1e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: screenHeight * 0.8
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold"
  },
  closeButton: {
    color: "#2196F3",
    fontSize: 16,
    fontWeight: "bold"
  },
  statsRow: {
    flexDirection: "row",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  stat: {
    flex: 1,
    alignItems: "center"
  },
  statValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold"
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
    marginTop: 2
  },
  elementList: {
    padding: 12
  },
  elementCard: {
    backgroundColor: "#2d2d2d",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8
  },
  elementHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  elementId: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold"
  },
  elementType: {
    color: "#888",
    fontSize: 12,
    backgroundColor: "#444",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  elementLabel: {
    color: "#aaa",
    fontSize: 12,
    marginTop: 4
  },
  stateRow: {
    flexDirection: "row",
    marginTop: 8
  },
  stateIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4
  },
  stateLabel: {
    color: "#888",
    fontSize: 10
  },
  testId: {
    color: "#666",
    fontSize: 10,
    marginTop: 4,
    fontFamily: "monospace"
  },
  emptyText: {
    color: "#888",
    textAlign: "center",
    marginTop: 20
  },
  detailContainer: {
    flex: 1
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  detailTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold"
  },
  detailContent: {
    padding: 12
  },
  sectionTitle: {
    color: "#888",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  sectionValue: {
    color: "#fff",
    fontSize: 14
  },
  stateSection: {
    backgroundColor: "#2d2d2d",
    borderRadius: 8,
    padding: 8
  },
  stateText: {
    color: "#ddd",
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 2
  },
  actionsSection: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  actionBadge: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6
  },
  customActionBadge: {
    backgroundColor: "#9C27B0"
  },
  actionText: {
    color: "#fff",
    fontSize: 12
  }
});

exports.UIBridgeInspector = UIBridgeInspector;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map