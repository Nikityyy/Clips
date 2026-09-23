!macro customInstall
  DetailPrint "Preparing the private Google Flow runtime..."
  SetOutPath "$PLUGINSDIR\flow-runtime-seed"
  File /r "${PROJECT_DIR}\build\flow-runtime-seed\*"
  SetOutPath "$PLUGINSDIR"
  File "${BUILD_RESOURCES_DIR}\install-flow-runtime.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-flow-runtime.ps1" -Seed "$PLUGINSDIR\flow-runtime-seed" -Destination "$APPDATA\Clips\runtime"' $0
  ${if} $0 != 0
    MessageBox MB_ICONSTOP "Clips could not prepare Google Flow. Check available disk space, then run the installer again."
    Abort
  ${endif}
!macroend
