!macro customInit
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar.exe'
  Pop $0
  Sleep 500
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /T /IM DreamCoder.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM dreamcoder-sidecar.exe'
  Pop $0
  Sleep 500
!macroend
