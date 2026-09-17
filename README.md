# DeskPet

## macOS 실행 안내

DeskPet은 Apple 개발자 서명이 되어 있지 않아서, macOS Gatekeeper가 다운로드한 앱에 자동으로 격리(quarantine) 속성을 붙입니다. 이 때문에 `.dmg`에서 앱을 설치한 뒤 그냥 실행하면 "파일이 손상되었습니다" 오류가 뜨며 실행되지 않습니다.

터미널에서 아래 명령어를 실행한 뒤 앱을 열어주세요.

```sh
sudo xattr -cr /Applications/DeskPet.app
open /Applications/DeskPet.app
```
