// An unpacked review build always uses isolated app data, even when double-clicked.
const { build, Platform, Arch } = require('electron-builder');
const existingProfiles = process.argv.includes('--existing-profiles');
const setupRefinement = process.argv.includes('--setup-refinement');
const responsive = process.argv.includes('--responsive');
const composerFocus = process.argv.includes('--composer-focus');
const marketplace = process.argv.includes('--marketplace');
const marketplaceChinese = process.argv.includes('--marketplace-chinese');
const upgradeFoundation = process.argv.includes('--upgrade-foundation');
const guidedExtension = process.argv.includes('--guided-extension');
const unifiedSettings = process.argv.includes('--unified-settings');
build({ targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64), config: {
  extends: './electron-builder.yml',
  directories: { output: guidedExtension ? 'release-guided-extension-review' : unifiedSettings ? 'release-unified-settings-review' : upgradeFoundation ? 'release-upgrade-foundation-review' : marketplaceChinese ? 'release-marketplace-chinese-review' : marketplace ? 'release-marketplace-review' : composerFocus ? 'release-composer-review' : responsive ? 'release-responsive-review' : setupRefinement ? 'release-setup-review' : existingProfiles ? 'release-accounts-profiles-review' : 'release-accounts-review' },
  extraMetadata: { version: guidedExtension ? '2.1.1-accounts-preview.10' : unifiedSettings ? '2.1.0-accounts-preview.9' : upgradeFoundation ? '2.0.9-accounts-preview.8' : marketplaceChinese ? '2.0.9-accounts-preview.7' : marketplace ? '2.0.9-accounts-preview.6' : composerFocus ? '2.0.9-accounts-preview.5' : responsive ? '2.0.9-accounts-preview.4' : setupRefinement ? '2.0.9-accounts-preview.3' : existingProfiles ? '2.0.9-accounts-preview.2' : '2.0.9-accounts-preview.1' }
} }).catch(error => { console.error(error); process.exitCode = 1; });
