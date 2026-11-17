; Fixed WebView2 must remain sandboxed. Grant only read/execute on its own files.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$INSTDIR\runtime" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "运行环境准备失败。请确认安装目录可写，然后重新安装。"
    Abort
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$INSTDIR\runtime" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /Q'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "运行环境准备失败。请确认安装目录可写，然后重新安装。"
    Abort
  ${EndIf}
  Pop $1
  Pop $0
!macroend
