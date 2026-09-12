import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELPER_SCRIPT } from '../src/main/computer/helper.js';

// An owned, non-activating WPF window supplies real UIA providers. The test only
// invokes semantic patterns on its cached elements; no physical user input occurs.
const fixture = String.raw`
using System;
using System.Threading;
using System.Text;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Interop;
using System.Windows.Media;
public class FixtureWindow : Window {
  public bool BrowserRoot;
  protected override AutomationPeer OnCreateAutomationPeer() { return new FixtureWindowPeer(this); }
}
public class FixtureWindowPeer : WindowAutomationPeer {
  private FixtureWindow window;
  public FixtureWindowPeer(FixtureWindow owner) : base(owner) { window = owner; }
  protected override string GetClassNameCore() { return window.BrowserRoot ? "BrowserRootView" : base.GetClassNameCore(); }
}
public static class AccessibilityFixture {
  [STAThread] public static void Main() {
    // A WindowsApplication has no console code page; read the redirected UTF-8 pipe
    // with BOM detection instead of treating its first command as legacy-codepage text.
    Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), true));
    var application = new Application();
    application.ShutdownMode = ShutdownMode.OnMainWindowClose;
    var window = new FixtureWindow { Title = "COS owned accessibility fixture", Width = 400, Height = 600, Left = -10000, Top = -10000, ShowActivated = false, ShowInTaskbar = false };
    var panel = new StackPanel(); window.Content = panel;
    var button = new Button { Content = "Invoke fixture", Height = 30 }; AutomationProperties.SetAutomationId(button, "invoke"); panel.Children.Add(button);
    int invoked = 0; button.Click += delegate { invoked++; };
    var check = new CheckBox { Content = "Toggle fixture", Height = 30 }; AutomationProperties.SetAutomationId(check, "toggle"); panel.Children.Add(check);
    var list = new ListBox { Height = 70 }; AutomationProperties.SetAutomationId(list, "list");
    var first = new ListBoxItem { Content = "First" }; AutomationProperties.SetAutomationId(first, "first"); list.Items.Add(first);
    var second = new ListBoxItem { Content = "Second" }; AutomationProperties.SetAutomationId(second, "second"); list.Items.Add(second); panel.Children.Add(list);
    var expander = new Expander { Header = "Expand fixture", Content = new TextBlock { Text = "Expanded body" } }; AutomationProperties.SetAutomationId(expander, "expand"); panel.Children.Add(expander);
    var scroll = new ScrollViewer { Height = 80, Width = 180, HorizontalScrollBarVisibility = ScrollBarVisibility.Visible, VerticalScrollBarVisibility = ScrollBarVisibility.Visible };
    AutomationProperties.SetAutomationId(scroll, "scroll"); scroll.Content = new TextBlock { Width = 600, Height = 800, Text = "Scrollable fixture content" }; panel.Children.Add(scroll);
    var editor = new TextBox { Height = 80, AcceptsReturn = true, Text = "first\r\n" + new string('x', 20000) }; AutomationProperties.SetAutomationId(editor, "editor"); panel.Children.Add(editor); editor.Select(0, 5);
    var disabled = new Button { Content = "Disabled fixture", IsEnabled = false }; AutomationProperties.SetAutomationId(disabled, "disabled"); panel.Children.Add(disabled);
    var document = new RichTextBox { Height = 60, Visibility = Visibility.Collapsed };
    document.Document = new FlowDocument(new Paragraph(new Run("Page document body " + new string('d', 20000))));
    AutomationProperties.SetAutomationId(document, "document"); panel.Children.Add(document);
    window.Loaded += delegate {
      var targetHandle = new WindowInteropHelper(window).Handle;
      var popup = new HwndSource(new HwndSourceParameters("") { ParentWindow = targetHandle, WindowStyle = unchecked((int)0x90000000), ExtendedWindowStyle = 0x08000080, Width = 100, Height = 50, PositionX = -10000, PositionY = -10000 });
      popup.RootVisual = new Border { Width = 100, Height = 50, Background = Brushes.Green, Child = new TextBlock { Text = "Owned popup" } };
      var unrelated = new Window { Title = "Same process unrelated fixture", Width = 100, Height = 100, Left = -11000, Top = -11000, ShowActivated = false, ShowInTaskbar = false }; unrelated.Show();
      Console.WriteLine(targetHandle.ToInt64() + "," + popup.Handle.ToInt64() + "," + new WindowInteropHelper(unrelated).Handle.ToInt64()); Console.Out.Flush();
      var reader = new Thread(delegate() {
        string command;
        while ((command = Console.ReadLine()) != null) {
          if (command == "quit") { window.Dispatcher.Invoke(new Action(delegate { popup.Dispose(); unrelated.Close(); window.Close(); })); return; }
          window.Dispatcher.Invoke(new Action(delegate {
            if (command == "long-selection") { editor.Select(0, 12000); }
            if (command == "empty-selection") { editor.Select(5, 0); }
            if (command == "document") { document.Visibility = Visibility.Visible; window.UpdateLayout(); }
            if (command == "browser") { window.BrowserRoot = true; document.Visibility = Visibility.Collapsed; window.UpdateLayout(); }
            Console.WriteLine((check.IsChecked == true ? "1" : "0") + "|" + list.SelectedIndex + "|" + (expander.IsExpanded ? "1" : "0") + "|" + invoked + "|" + scroll.VerticalOffset + "|" + scroll.HorizontalOffset + "|" + editor.SelectionLength + "|" + command);
            Console.Out.Flush();
          }));
        }
      }); reader.IsBackground = true; reader.Start();
    };
    application.Run(window);
  }
}
`;

describe.runIf(process.platform === 'win32')('Windows semantic accessibility actions', () => {
  it('executes only supported native patterns and returns bounded observation context', () => {
    // native expands Windows 8.3 TEMP paths; regular realpathSync retains those aliases.
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'cos-uia-test-')));
    try {
      writeFileSync(path.join(dir, 'fixture.cs'), fixture, 'utf8');
      const helper = HELPER_SCRIPT.slice(0, HELPER_SCRIPT.indexOf('while (($line = [Console]::In.ReadLine())'));
      const probe = String.raw`
$runtime = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$wpf = Join-Path $runtime 'WPF'
$refs = @('System.dll', (Join-Path $runtime 'System.Xaml.dll'), (Join-Path $wpf 'PresentationFramework.dll'), (Join-Path $wpf 'PresentationCore.dll'), (Join-Path $wpf 'WindowsBase.dll'))
$exe = Join-Path $PSScriptRoot 'fixture.exe'
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixture.cs'))) -ReferencedAssemblies $refs -OutputAssembly $exe -OutputType WindowsApplication
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $exe; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true; $info.RedirectStandardInput = $true
$owned = [System.Diagnostics.Process]::Start($info)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'fixture.pid'), [string]$owned.Id)
function Read-FixtureLine([string]$phase) {
  $line=$owned.StandardOutput.ReadLineAsync()
  if (-not $line.Wait(8000)) { throw ('FIXTURE_RESPONSE_TIMEOUT: ' + $phase) }
  if ($null -eq $line.Result) { throw ('FIXTURE_EXITED: ' + $phase) }
  return $line.Result
}
try {
  Write-Output 'UIA_PHASE: startup'
  $handles = (Read-FixtureLine 'startup') -split ','
  $id = [int64]$handles[0]; $popupId = [int64]$handles[1]; $unrelatedId = [int64]$handles[2]
  Write-Output 'UIA_PHASE: native window'
  $nativeWindow = Get-WindowRow $id
  Write-Output 'UIA_PHASE: accessibility root'
  $fixtureRoot = Get-UiRoot $id
  Write-Output ('UIA_PHASE: root class ' + $fixtureRoot.Current.ClassName)
  Write-Output 'UIA_PHASE: snapshot'
  $snapshot = Handle-Request @{ op = 'snapshot'; id = $id; includeScreenshot = $false; includeUi = $true; includeRelated = $true; maxResults = 100 }
  $relatedIds = @($snapshot.relatedWindows | ForEach-Object { $_.id })
  if ($popupId -notin $relatedIds -or $unrelatedId -in $relatedIds -or $relatedIds.Count -gt 3) { throw ('related popup ownership failed: ' + ($relatedIds -join ',')) }
  if (-not [Clf]::IsRelatedWindow($popupId, $id) -or [Clf]::IsRelatedWindow($unrelatedId, $id)) { throw 'exact related ownership proof failed' }
  if ($null -eq (Get-WindowRow $popupId)) { throw 'exact empty-title popup lookup failed' }
  $nativeWindow = Get-WindowRow $id
  if (!$nativeWindow.app -or !$nativeWindow.processId -or !$nativeWindow.processPath -or $nativeWindow.dpi -lt 96) { throw 'native window identity or DPI missing' }
  Write-Output 'UIA_PHASE: catalog'
  $apps = Get-WindowsApps @{limit=100}
  $app = @($apps.apps | Where-Object { $_.id -ceq $nativeWindow.app })
  if ($app.Count -ne 1 -or $id -notin @($app[0].windows | ForEach-Object { $_.id })) { throw 'real window did not join its native app identity' }
  try {
    $null = Capture-Target @{ id = $unrelatedId; ownerWindow = $id; file = (Join-Path $PSScriptRoot 'must-not-exist.png') } $null
    throw 'unrelated capture unexpectedly accepted'
  } catch { if ($_.Exception.Message -notmatch 'RELATED_WINDOW_GONE') { throw } }
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'must-not-exist.png')) { throw 'unrelated window captured before ownership rejection' }
  if ($snapshot.uiUnavailable) { throw ('UIA unavailable: ' + $snapshot.uiUnavailable.message) }
  if ($snapshot.uiTextUnavailable) { throw ('UIA text unavailable: ' + $snapshot.uiTextUnavailable.message) }
  $rows = @{}; foreach ($row in $snapshot.elements) { if ($row.automationId) { $rows[$row.automationId] = $row } }
  foreach ($key in @('invoke','toggle','second','expand','scroll','editor','disabled')) {
    if (-not $rows.ContainsKey($key)) { throw ('missing fixture element ' + $key + ': ' + ($snapshot | ConvertTo-Json -Depth 8 -Compress)) }
  }
  if ('invoke' -notin $rows.invoke.actions -or 'toggle' -notin $rows.toggle.actions -or 'select' -notin $rows.second.actions -or 'expand' -notin $rows.expand.actions -or 'scroll_down' -notin $rows.scroll.actions) { throw 'supported semantic actions not projected' }
  if ($rows.second.depth -le $rows.list.depth) { throw 'hierarchy depth not retained' }
  if ($snapshot.document_text -notmatch 'first' -or $snapshot.selected_text -ne 'first') { throw ('text context missing: ' + ($snapshot | ConvertTo-Json -Depth 8 -Compress)) }
  if (($snapshot.document_text.Length + $snapshot.selected_text.Length) -ne 8000) { throw 'long document text was not bounded to the shared budget' }
  # Read the exact same native provider with invalid ownership and traversal proofs.
  # Neither case may silently pick another editor or return any private document text.
  $editor = $fixtureRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'editor')))
  foreach ($proof in @(@{ root=@(-999); target=$editor.GetRuntimeId(); limit=100 }, @{ root=$fixtureRoot.GetRuntimeId(); target=@(-999); limit=100 }, @{ root=$fixtureRoot.GetRuntimeId(); target=$editor.GetRuntimeId(); limit=1 })) {
    try {
      $null = [ClfUiText]::Read($id, [int[]]$proof.root, [int[]]$proof.target, $proof.limit)
      throw 'unproven native text provider was read'
    } catch { if ($_.Exception.ToString() -notmatch 'Selected text provider is no longer') { throw } }
  }
  $owned.StandardInput.WriteLine('long-selection'); $owned.StandardInput.Flush(); $selectionReceipt = Read-FixtureLine 'long selection'
  if (($selectionReceipt -split '\|')[6] -ne '12000') { throw ('fixture selection did not change: ' + $selectionReceipt) }
  $long = Handle-Request @{ op = 'snapshot'; id = $id; includeScreenshot = $false; includeUi = $true; maxResults = 100 }
  if ($long.uiTextUnavailable -or $long.selected_text.Length -ne 2000 -or $long.document_text.Length -ne 6000) { throw ('long selection did not respect the shared native text budget: selection=' + $long.selected_text.Length + ' document=' + $long.document_text.Length + ' error=' + ($long.uiTextUnavailable | ConvertTo-Json -Compress)) }
  $owned.StandardInput.WriteLine('empty-selection'); $owned.StandardInput.Flush(); $null = Read-FixtureLine 'empty selection'
  $empty = Handle-Request @{ op = 'snapshot'; id = $id; includeScreenshot = $false; includeUi = $true; maxResults = 100 }
  if ($empty.uiTextUnavailable -or $empty.selected_text.Length -ne 0 -or $empty.document_text.Length -ne 8000) { throw 'empty selection did not release the native document text budget' }
  function Act([string]$key, [string]$action) {
    Write-Host ('UIA_PHASE: action ' + $key + ' ' + $action)
    $row = $rows[$key]
    return Handle-Request @{ op = 'act'; actions = @(@{ type = 'ui_action'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $row.runtimeKey; action = $action }) }
  }
  function Read-State {
    $owned.StandardInput.WriteLine('state'); $owned.StandardInput.Flush()
    return ((Read-FixtureLine 'state') -split '\|')
  }
  foreach ($pair in @(@('invoke','invoke'), @('toggle','toggle'), @('second','select'), @('expand','expand'), @('scroll','scroll_down'), @('scroll','scroll_right'))) {
    $result = Act $pair[0] $pair[1]
    if ($result.ok -ne $true -or $result.completed_count -ne 1 -or $result.routes[0] -ne 'uia') { throw ('semantic action failed: ' + ($result | ConvertTo-Json -Compress)) }
  }
  $state = Read-State
  if ($state[0] -ne '1' -or $state[1] -ne '1' -or $state[2] -ne '1' -or $state[3] -ne '1' -or [double]$state[4] -le 0 -or [double]$state[5] -le 0) { throw ('native patterns did not change controls: ' + ($state -join '|')) }
  $result = Act 'invoke' 'toggle'
  if ($result.ok -ne $false -or $result.error_code -ne 'UI_ACTION_UNSUPPORTED' -or $result.completed_count -ne 0) { throw 'unsupported action did not reject without effects' }
  $result = Act 'disabled' 'invoke'
  if ($result.ok -ne $false -or $result.error_code -ne 'UI_ELEMENT_DISABLED') { throw 'disabled control was not rejected' }
  if (((Read-State) -join '|') -ne ($state -join '|')) { throw 'rejected actions changed fixture' }
  $result = Handle-Request @{ op = 'act'; ownerWindow = $unrelatedId; actions = @(@{ type = 'ui_action'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $rows.invoke.runtimeKey; action = 'invoke' }) }
  if ($result.ok -ne $false -or $result.error_code -ne 'RELATED_WINDOW_GONE' -or $result.completed_count -ne 0) { throw 'unrelated owner permitted input' }
  if (((Read-State) -join '|') -ne ($state -join '|')) { throw 'owner rejection changed fixture' }
  foreach ($identity in @(@{targetApp='wrong.app'},@{ownerWindow=$id;ownerApp='wrong.owner.app'})) {
    $request = @{ op = 'act'; targetApp=$identity.targetApp; ownerWindow=$identity.ownerWindow; ownerApp=$identity.ownerApp; actions = @(@{ type = 'ui_action'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $rows.invoke.runtimeKey; action = 'invoke' }) }
    $result = Handle-Request $request
    if ($result.ok -ne $false -or $result.error_code -ne 'WINDOW_APP_MISMATCH' -or $result.completed_count -ne 0) { throw 'wrong native application identity permitted input' }
    if (((Read-State) -join '|') -ne ($state -join '|')) { throw 'application identity rejection changed fixture' }
  }
  try {
    $null = Handle-Request @{ op = 'act'; actions = @(
      @{ type = 'ui_action'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $rows.invoke.runtimeKey; action = 'invoke' },
      @{ type = 'ui_action'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $rows.invoke.runtimeKey; action = 'invented' }
    ) }
    throw 'unknown semantic action accepted'
  } catch { if ($_.Exception.Message -notmatch 'BAD_ACTION') { throw } }
  if (((Read-State) -join '|') -ne ($state -join '|')) { throw 'invalid later action performed earlier effects' }
  $result = Act 'second' 'scroll_into_view'; if (-not $result.ok -or $result.routes[0] -ne 'uia') { throw 'scroll into view failed' }
  $result = Act 'expand' 'collapse'; if (-not $result.ok) { throw 'collapse failed' }
  $result = Act 'scroll' 'scroll_up'; if (-not $result.ok) { throw 'scroll up failed' }
  $result = Act 'scroll' 'scroll_left'; if (-not $result.ok) { throw 'scroll left failed' }
  $state = Read-State
  if ($state[2] -ne '0' -or [double]$state[4] -ne 0 -or [double]$state[5] -ne 0) { throw 'reverse actions failed' }
  # click_ref on a checkbox should use its TogglePattern without physical input.
  $row = $rows.toggle
  $result = Handle-Request @{ op = 'act'; actions = @(@{ type = 'click_ui'; window = $id; snapshotId = $snapshot.snapshotId; runtimeKey = $row.runtimeKey }) }
  if (-not $result.ok -or $result.routes[0] -ne 'uia' -or (Read-State)[0] -ne '0') { throw 'click_ref did not use native toggle' }
  $fresh = Handle-Request @{ op = 'snapshot'; id = $id; includeScreenshot = $false; includeUi = $true; maxResults = 100 }
  $selected = @($fresh.elements | Where-Object { $_.automationId -eq 'second' })[0]
  if ($selected.selected -ne $true) { throw 'selection state not projected' }
  # Like a browser toolbar editor preceding its page, an earlier TextPattern
  # must not claim document_text before the actual Document is visited.
  $owned.StandardInput.WriteLine('document'); $owned.StandardInput.Flush(); $null = Read-FixtureLine 'document'
  $page = Handle-Request @{ op = 'snapshot'; id = $id; includeScreenshot = $false; includeUi = $true; maxResults = 100 }
  if (-not @($page.elements | Where-Object { $_.automationId -eq 'document' -and $_.role -eq 'Document' }).Count) { throw 'document fixture provider missing' }
  if ($page.document_text -notmatch '^Page document body') { throw 'earlier editor displaced the page document text' }
  if (($page.document_text.Length + $page.selected_text.Length) -gt 8000) { throw 'document text exceeded shared budget' }
  # A browser without an observed page must not label its toolbar editor as
  # document text. The same real UIA editor remains available in the tree.
  $owned.StandardInput.WriteLine('browser'); $owned.StandardInput.Flush(); $null = Read-FixtureLine 'browser'
  $browser = Find-UiElements @{ id = $id; maxResults = 100 }
  if ((Get-UiRoot $id).Current.ClassName -ne 'BrowserRootView') { throw 'browser root fixture missing' }
  if (-not @($browser.elements | Where-Object { $_.automationId -eq 'editor' }).Count) { throw 'browser editor missing from indexed controls' }
  if ($null -ne $browser.document_text -or $null -ne $browser.selected_text) { throw 'browser toolbar text presented as page content' }
  $owned.StandardInput.WriteLine('document'); $owned.StandardInput.Flush(); $null = Read-FixtureLine 'browser document'
  $browser = Find-UiElements @{ id = $id; maxResults = 100 }
  if ($browser.document_text -notmatch '^Page document body') { throw 'browser page document text missing' }
  Write-Output 'WINDOWS_ACCESSIBILITY_PROBE_OK'
} finally {
  if (-not $owned.HasExited) {
    $owned.StandardInput.WriteLine('quit'); $owned.StandardInput.Flush()
    if (-not $owned.WaitForExit(3000)) { $owned.Kill(); $owned.WaitForExit() }
  }
  $owned.Dispose()
}
`;
      const file = path.join(dir, 'probe.ps1');
      writeFileSync(file, '\uFEFF' + helper + probe, 'utf8');
      const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
        encoding: 'utf8', timeout: 35_000, windowsHide: true
      });
      expect(result.error, result.stderr + result.stdout).toBeUndefined();
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain('WINDOWS_ACCESSIBILITY_PROBE_OK');
    } finally {
      // A killed PowerShell parent cannot execute its finally block. Reap only this
      // fixture's exact PID + executable, including a PID-reuse check, before deletion.
      const pidFile = path.join(dir, 'fixture.pid');
      if (existsSync(pidFile)) {
        const fixturePid = Number(readFileSync(pidFile, 'utf8'));
        if (Number.isSafeInteger(fixturePid) && fixturePid > 0) {
          const cleanup = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            '$ErrorActionPreference="Stop"; $owned=Get-Process -Id ([int]$env:COS_UIA_FIXTURE_PID) -ErrorAction SilentlyContinue; if ($owned -and $owned.Path -eq $env:COS_UIA_FIXTURE_PATH) { $owned.Kill(); if (-not $owned.WaitForExit(5000)) { throw "Owned fixture did not exit" } }; exit 0'],
          { windowsHide: true, timeout: 8000, encoding: 'utf8', env: { ...process.env, COS_UIA_FIXTURE_PID: String(fixturePid), COS_UIA_FIXTURE_PATH: path.join(dir, 'fixture.exe') } });
          if (cleanup.error || cleanup.status !== 0) throw new Error(`Owned accessibility fixture cleanup failed: ${cleanup.stderr}`);
        }
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 40_000);
});
