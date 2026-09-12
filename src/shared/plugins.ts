export type PluginSource = {
  kind: 'npm' | 'python' | 'command' | 'remote' | 'mcpb' | 'github';
  package?: string;
  version?: string;
  /** Reviewed exact Python dependency pins, resolved together with the server package. */
  dependencies?: { package: string; version: string }[];
  command?: string;
  args?: string[];
  url?: string;
  /** Remote OAuth is explicit; omitted sources keep their existing static headers. */
  auth?: 'oauth';
  path?: string;
};
export interface PluginConfigPatch {
  config?: Record<string, string>;
  credentials?: Record<string, string>;
  source?: PluginSource;
  name?: string;
}
export interface PluginInstallRequest extends PluginConfigPatch {
  catalogId?: string;
  registry?: PluginRegistryReference & { authentication?: 'none' | 'oauth' };
}
export interface PluginField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Public manifest prefix (for example Bearer), applied only in the secret store. */
  valuePrefix?: string;
}
export interface PluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  source: PluginSource;
  homepage: string;
  license: string;
  instructions: string[];
  fields: PluginField[];
  /** Representative tool names or documented action labels; live discovery determines actual tools. */
  tools?: string[];
}
export interface PluginToolView {
  name: string;
  exposedName: string;
  description?: string;
  enabled: boolean;
  published?: boolean;
  exposureError?: string;
}
export interface PluginView {
  id: string;
  name: string;
  catalogId?: string;
  registry?: PluginRegistryReference;
  registryInfo?: Pick<PluginRegistryEntry, 'description' | 'repository'>;
  source: PluginSource;
  config: Record<string, string>;
  credentialKeys: string[];
  fields?: PluginField[];
  version: string;
  license: string;
  homepage?: string;
  enabled: boolean;
  status: 'installed' | 'connecting' | 'ready' | 'disabled' | 'error' | 'needs-auth' | 'authenticating';
  error?: string;
  tools: PluginToolView[];
  installedAt: number;
}
export interface PluginSnapshot {
  plugins: PluginView[];
  catalog: PluginCatalogEntry[];
  schemaRevision: number;
}

export interface PluginRegistryReference { name: string; version: string; optionId: string }
export interface PluginRegistryQuery { search?: string; cursor?: string }
export interface PluginRegistryOption {
  id: string;
  source: PluginSource;
  fields: PluginField[];
  defaults: Record<string, string>;
}
export interface PluginRegistryEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  homepage?: string;
  repository?: string;
  icons?: { src: string; theme?: 'light' | 'dark' }[];
  options: PluginRegistryOption[];
  unsupported: string[];
}
export interface PluginRegistryPage {
  entries: PluginRegistryEntry[];
  nextCursor?: string;
  fetchedAt: number;
}
