import type { ReactElement, ReactNode } from 'react';

export interface StateAnnotationRequiredElement {
  role?: string;
  text?: string;
  testID?: string;
  [key: string]: unknown;
}

export interface StateProps {
  id: string;
  name?: string;
  description?: string;
  requiredElements?: StateAnnotationRequiredElement[];
  blocking?: boolean;
  children?: ReactNode;
  [key: string]: unknown;
}

export function State(props: StateProps): ReactElement {
  return <>{props.children}</>;
}

export interface TransitionToProps {
  id: string;
  name?: string;
  fromStates?: string[];
  activateStates?: string[];
  exitStates?: string[];
  effect?: string;
  description?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

export function TransitionTo(props: TransitionToProps): ReactElement {
  return <>{props.children}</>;
}
