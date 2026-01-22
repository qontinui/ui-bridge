/**
 * Minimal React Native type declarations for ui-bridge-native
 *
 * These are stub types to allow compilation without requiring the full
 * react-native package. The actual types will be provided by react-native
 * when this package is used in a React Native project.
 */

declare module 'react-native' {
  import * as React from 'react';

  // View component
  export interface ViewProps {
    style?: unknown;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    onLayout?: (event: LayoutChangeEvent) => void;
    children?: React.ReactNode;
  }

  export class View extends React.Component<ViewProps> {}

  // Text component
  export interface TextProps {
    style?: unknown;
    testID?: string;
    accessibilityLabel?: string;
    children?: React.ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
  }

  export class Text extends React.Component<TextProps> {}

  // TextInput component
  export interface TextInputProps {
    style?: unknown;
    testID?: string;
    accessibilityLabel?: string;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    onChangeText?: (text: string) => void;
    onChange?: (event: { nativeEvent: { text: string } }) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    secureTextEntry?: boolean;
    editable?: boolean;
  }

  export class TextInput extends React.Component<TextInputProps> {
    focus(): void;
    blur(): void;
    clear(): void;
  }

  // Pressable component
  export interface PressableProps {
    style?: unknown;
    testID?: string;
    accessibilityLabel?: string;
    onPress?: (event?: unknown) => void;
    onPressIn?: (event?: unknown) => void;
    onPressOut?: (event?: unknown) => void;
    onLongPress?: (event?: unknown) => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    disabled?: boolean;
    children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  }

  export class Pressable extends React.Component<PressableProps> {}

  // TouchableOpacity component
  export interface TouchableOpacityProps {
    style?: unknown;
    testID?: string;
    accessibilityLabel?: string;
    onPress?: () => void;
    onLongPress?: () => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    disabled?: boolean;
    activeOpacity?: number;
    children?: React.ReactNode;
  }

  export class TouchableOpacity extends React.Component<TouchableOpacityProps> {}

  // ScrollView component
  export interface ScrollViewProps {
    style?: unknown;
    testID?: string;
    onScroll?: (event: unknown) => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    children?: React.ReactNode;
  }

  export class ScrollView extends React.Component<ScrollViewProps> {}

  // Modal component
  export interface ModalProps {
    visible?: boolean;
    animationType?: 'none' | 'slide' | 'fade';
    transparent?: boolean;
    onRequestClose?: () => void;
    children?: React.ReactNode;
  }

  export class Modal extends React.Component<ModalProps> {}

  // Layout types
  export interface LayoutChangeEvent {
    nativeEvent: {
      layout: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  }

  // Dimensions
  export interface ScaledSize {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  }

  export const Dimensions: {
    get(dim: 'window' | 'screen'): ScaledSize;
    addEventListener(type: 'change', handler: (dims: { window: ScaledSize; screen: ScaledSize }) => void): { remove: () => void };
  };

  // StyleSheet
  export interface StyleSheetStatic {
    create<T extends { [key: string]: unknown }>(styles: T): T;
    flatten(style?: unknown): unknown;
  }

  export const StyleSheet: StyleSheetStatic;
}
