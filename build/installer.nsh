!macro customInstall
  MessageBox MB_ICONINFORMATION|MB_OKCANCEL "Clips needs an internet connection during setup to download its private Google Flow runtime. It will be ready before you sign in. No system-wide tools are installed." IDOK +1
  Abort
  DetailPrint "Downloading and preparing the private Google Flow runtime..."
  SetOutPath "$PLUGINSDIR"
  File "${PROJECT_DIR}\build\install-flow-runtime.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-flow-runtime.ps1" -SpecPath "$INSTDIR\resources\flow-runtime-spec.json" -Destination "$APPDATA\Clips\runtime"'
  Pop $0
  ${if} $0 != 0
    MessageBox MB_ICONSTOP "Clips could not prepare Google Flow. Check your internet connection and available disk space, then run the installer again."
    Abort
  ${endif}
!macroend
