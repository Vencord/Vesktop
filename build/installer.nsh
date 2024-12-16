!include WinVer.nsh
!macro preInit
${IfNot} ${AtLeastWin10}
  MessageBox mb_iconStop "Vesktop requires at least Windows 10."
  Abort
${EndIf}
SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LocalAppData\vesktop"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LocalAppData\vesktop"
 SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LocalAppData\vesktop"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LocalAppData\vesktop"
!macroend
