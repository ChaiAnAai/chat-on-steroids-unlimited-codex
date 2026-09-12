import { app } from 'electron';
import { APP_VERSION, BRIDGE_PROTOCOL } from './version.js';
import type { BuildIdentity } from '../shared/types.js';

/** Package identity comes from Electron, never the renderer's label or the launch manifest. */
export function buildIdentity(): BuildIdentity {
  const version = app.getVersion();
  return { version, extensionVersion: APP_VERSION, protocolVersion: BRIDGE_PROTOCOL,
    channel: /-accounts-preview\.\d+$/.test(version) ? 'preview' : app.isPackaged ? 'release' : 'development',
    dataDirectory: app.getPath('userData') };
}
