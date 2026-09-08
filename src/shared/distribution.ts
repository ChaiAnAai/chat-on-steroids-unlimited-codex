/** Local customization is a separate installation, never an upstream update target. */
export const DISTRIBUTION = {
  channel: 'local' as 'local' | 'upstream',
  profileName: 'Chat On Steroids Desktop',
  bridgePorts: [18775, 18776, 18777, 18778, 18779]
};
