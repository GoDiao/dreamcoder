!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running DreamCoder sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running DreamCoder processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend
