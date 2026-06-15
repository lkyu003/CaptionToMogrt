# SRT to MOGRT CEP Panel

Premiere Pro에서 `.srt` 자막을 선택된 샘플 MOGRT 클립 기반의 모션그래픽 클립들로 변환하는 CEP 패널입니다.

## 작업 흐름

1. Premiere Pro에서 변환 기준이 될 MOGRT 클립 하나를 타임라인에서 선택합니다.
2. 패널에서 `SRT 선택`을 눌러 `.srt` 파일을 불러옵니다.
3. `선택 클립 분석`을 눌러 MOGRT의 텍스트 파라미터 후보를 읽습니다.
4. `MOGRT 파일 선택`으로 실제 삽입할 `.mogrt` 파일을 고릅니다.
5. 자막 텍스트가 들어갈 파라미터와 삽입할 비디오 트랙 번호를 고릅니다.
6. `MOGRT 생성`을 누르면 SRT 자막의 시작/끝 시간에 맞춰 MOGRT 클립이 생성되고 텍스트가 적용됩니다.

## 설치

개발 중에는 이 폴더를 CEP extensions 폴더에 복사하거나 심볼릭 링크로 연결합니다.

Windows 예시:

```powershell
.\install-dev.ps1
```

서명되지 않은 CEP 확장을 로드하려면 PlayerDebugMode가 켜져 있어야 합니다.
이 설정은 서명되지 않은 CEP 패널 로드를 허용하므로 개발용 PC에서만 사용하세요.

```powershell
New-Item -Path "HKCU:\Software\Adobe\CSXS.12" -Force
Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.12" -Name PlayerDebugMode -Value 1
New-Item -Path "HKCU:\Software\Adobe\CSXS.13" -Force
Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.13" -Name PlayerDebugMode -Value 1
```

Premiere Pro 2026 환경에 따라 `CSXS.13` 이상 키가 필요할 수 있습니다.

## 중요한 제약

- 샘플 MOGRT 클립의 텍스트 속성은 Essential Graphics에 편집 가능 파라미터로 노출되어 있어야 합니다.
- 공개 API에서 기존 캡션 트랙 내용을 직접 읽는 안정적인 방법이 부족해 SRT 파일을 입력 소스로 사용합니다.
- 선택된 샘플 클립은 텍스트 파라미터 분석용이고, 실제 삽입은 선택한 `.mogrt` 파일 경로를 `Sequence.importMGT()`에 넘기는 방식입니다.
- 대상 비디오 트랙은 이미 시퀀스에 존재해야 합니다.
