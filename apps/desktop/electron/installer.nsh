; TeamAgentX NSIS 自定义脚本
;
; 安装/卸载前先杀掉所有 TeamAgentX 进程（含主进程、utilityProcess fork 出的
; server 子进程、其下的 node.exe / claude.exe 等），避免文件被锁定导致
; 覆盖安装失败、必须先手动卸载旧版本。
;
; electron-builder 会读取 nsis.include 指向的 .nsh，将其插入到 NSIS 模板的
; 对应宏中。我们只需定义这些宏即可：
;   - customInit            : 安装器启动时（GUI 显示前）
;   - customUnInit          : 卸载器启动时
;   - customInstall         : 安装文件复制前
;   - customRemoveFiles     : 卸载文件删除前

!macro killTeamAgentXProcesses
  DetailPrint "Killing existing TeamAgentX processes..."

  ; /F 强制终止；/T 同时终止子进程树。所有失败统一忽略（进程不存在时也会返回非 0）。
  nsExec::Exec '"taskkill.exe" /F /T /IM "TeamAgentX.exe"'
  Pop $0
  nsExec::Exec '"taskkill.exe" /F /T /IM "@teamagentx-desktop.exe"'
  Pop $0
  ; utilityProcess fork 出的 server / claude / codex 子进程
  nsExec::Exec '"taskkill.exe" /F /T /IM "claude.exe"'
  Pop $0
  nsExec::Exec '"taskkill.exe" /F /T /IM "codex.exe"'
  Pop $0

  ; 给 OS 一点时间释放文件句柄，避免接下来覆盖文件时仍被锁
  Sleep 1500
!macroend

!macro customInit
  !insertmacro killTeamAgentXProcesses
!macroend

!macro customInstall
  !insertmacro killTeamAgentXProcesses
!macroend

!macro customUnInit
  !insertmacro killTeamAgentXProcesses
!macroend

!macro customRemoveFiles
  !insertmacro killTeamAgentXProcesses
  ; 默认删除文件
  RMDir /r "$INSTDIR"
!macroend
