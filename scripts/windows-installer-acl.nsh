!macro grantSandboxReadAccess
  ClearErrors
  ExecWait '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /Q' $0
  ${If} ${Errors}
    StrCpy $0 2
  ${EndIf}
  ${If} $0 != 0
    SetErrorLevel 2
    Abort "Windows could not set the folder access needed to start Chat On Steroids safely."
  ${EndIf}
!macroend

!macro customInit
  # initMultiUser has resolved a previous custom install path by this point.
  # Repair an existing install before an update removes its runnable version.
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro grantSandboxReadAccess
  ${EndIf}
!macroend

!macro customInstall
  # Chromium's sandbox needs read and execute access through the app tree.
  # Add one inheritable grant to the final directory without resetting other ACLs.
  !insertmacro grantSandboxReadAccess
  # This is an installation preference seed, not a second user-config store. Existing app
  # language wins. Keeping the seed under resources avoids writing the elevated user's AppData.
  FileOpen $0 "$INSTDIR\resources\installer-language.json" w
  ${If} $0 != ""
    ${If} $LANGUAGE == 2052
      FileWrite $0 '{$\"language$\":$\"zh-CN$\"}'
    ${Else}
      FileWrite $0 '{$\"language$\":$\"en$\"}'
    ${EndIf}
    FileClose $0
  ${EndIf}
!macroend
