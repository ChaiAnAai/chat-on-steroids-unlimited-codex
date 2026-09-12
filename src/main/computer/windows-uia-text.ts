/** Native UIA3 text access; avoids the legacy managed TextRange ABI on Windows 11.
 * COM declarations follow Windows SDK UIAutomationClient.h. This reader cannot act on UI.
 * https://learn.microsoft.com/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomationtextrange
 */
export const WINDOWS_UIA_TEXT_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ClfUiText {
  // Unused slots retain their SDK order; none is invoked through a dummy declaration.
  [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Automation {
    void CompareElements(); void CompareRuntimeIds(); void GetRootElement();
    Element ElementFromHandle(IntPtr hwnd);
    void ElementFromPoint(); void GetFocusedElement(); void GetRootElementBuildCache();
    void ElementFromHandleBuildCache(); void ElementFromPointBuildCache(); void GetFocusedElementBuildCache();
    void CreateTreeWalker(); Walker GetControlViewWalker();
  }
  [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Element {
    void SetFocus(); [return: MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_I4)] int[] GetRuntimeId();
    void FindFirst(); void FindAll(); void FindFirstBuildCache(); void FindAllBuildCache(); void BuildUpdatedCache();
    [return: MarshalAs(UnmanagedType.Struct)] object GetCurrentPropertyValue(int property);
    void GetCurrentPropertyValueEx(); void GetCachedPropertyValue(); void GetCachedPropertyValueEx();
    [return: MarshalAs(UnmanagedType.IUnknown)] object GetCurrentPatternAs(int pattern, ref Guid iid);
  }
  [ComImport, Guid("4042c624-389c-4afc-a630-9df854a541fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Walker {
    Element GetParentElement(Element element); Element GetFirstChildElement(Element element);
    void GetLastChildElement(); Element GetNextSiblingElement(Element element);
  }
  [ComImport, Guid("32eba289-3583-42c9-9c59-3b6d9a1e9b6a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface TextPattern {
    void RangeFromPoint(); void RangeFromChild(); Ranges GetSelection(); void GetVisibleRanges(); Range GetDocumentRange();
  }
  [ComImport, Guid("ce4ae76a-e717-4c98-81ea-47371d028eb6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Ranges { int GetLength(); Range GetElement(int index); }
  [ComImport, Guid("a543cc6a-f4ae-494b-8239-c814481187a8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Range {
    void Clone(); void Compare(); void CompareEndpoints(); void ExpandToEnclosingUnit();
    void FindAttribute(); void FindText(); void GetAttributeValue(); void GetBoundingRectangles(); void GetEnclosingElement();
    [return: MarshalAs(UnmanagedType.BStr)] string GetText(int limit);
  }
  static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
  static bool Same(int[] a, int[] b) {
    if (a == null || b == null || a.Length != b.Length) return false;
    for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
    return true;
  }
  sealed class Row { public Element Element; public int Depth; public bool UnderRoot; }
  static string Bounded(Range range, int limit) {
    if (limit <= 0) return "";
    string text = range.GetText(limit) ?? "";
    return text.Length > limit ? text.Substring(0, limit) : text;
  }
  // Re-identify only the provider selected by the existing managed traversal. A missing
  // root/provider or changed password state is an error, never a different text source.
  public static string[] Read(long hwnd, int[] rootId, int[] targetId, int visitLimit) {
    Automation automation = null; Walker walker = null;
    var pending = new Stack<Row>();
    try {
      automation = (Automation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
      walker = automation.GetControlViewWalker();
      pending.Push(new Row { Element = automation.ElementFromHandle(new IntPtr(hwnd)), Depth = 0 });
      int visited = 0;
      while (pending.Count > 0 && visited < Math.Min(10000, Math.Max(1, visitLimit))) {
        Row row = pending.Pop();
        try {
          if (row.Element == null) continue;
          visited++;
          int[] runtime = row.Element.GetRuntimeId();
          bool underRoot = row.UnderRoot || Same(runtime, rootId);
          if (underRoot && Same(runtime, targetId)) {
            if (Object.Equals(row.Element.GetCurrentPropertyValue(30019), true)) throw new InvalidOperationException("Text provider became a password control");
            return ReadPattern(row.Element);
          }
          // Two pending references per depth, no native FindAll/FindFirst over an unbounded tree.
          if (row.Depth > 0) pending.Push(new Row { Element = walker.GetNextSiblingElement(row.Element), Depth = row.Depth, UnderRoot = row.UnderRoot });
          if (row.Depth < 64) pending.Push(new Row { Element = walker.GetFirstChildElement(row.Element), Depth = row.Depth + 1, UnderRoot = underRoot });
        } finally { Release(row.Element); }
      }
      throw new InvalidOperationException("Selected text provider is no longer under the observed UI root or exceeded the traversal limit");
    } finally {
      while (pending.Count > 0) Release(pending.Pop().Element);
      Release(walker); Release(automation);
    }
  }
  static string[] ReadPattern(Element element) {
    TextPattern pattern = null; Ranges ranges = null;
    try {
      Guid iid = typeof(TextPattern).GUID;
      pattern = (TextPattern)element.GetCurrentPatternAs(10014, ref iid);
      ranges = pattern.GetSelection();
      string selection = "";
      int count = Math.Min(4, ranges.GetLength());
      for (int i = 0; i < count && selection.Length < 2000; i++) {
        Range range = null;
        try { range = ranges.GetElement(i); selection += Bounded(range, 2000 - selection.Length); }
        finally { Release(range); }
      }
      Range document = null;
      try { document = pattern.GetDocumentRange(); return new[] { Bounded(document, 8000 - selection.Length), selection }; }
      finally { Release(document); }
    } finally { Release(ranges); Release(pattern); }
  }
}
`;
