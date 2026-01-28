/**
 * SWC Plugin for UI Bridge
 *
 * Provides the path to the pre-built WASM plugin binary.
 *
 * @example
 * ```js
 * // next.config.js
 * const swcPluginPath = require('@qontinui/ui-bridge/swc-plugin').default;
 *
 * module.exports = {
 *   experimental: {
 *     swcPlugins: [[swcPluginPath, { elements: ['button', 'input'] }]]
 *   }
 * };
 * ```
 */
import path from 'path';

export type { UIBridgeSwcPluginConfig } from './types';

const pluginPath = path.join(__dirname, '..', '..', 'swc-plugin-wasm', 'ui_bridge_swc_plugin.wasm');

export default pluginPath;
