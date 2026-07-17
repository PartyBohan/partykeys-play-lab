# PartyKeys Play Lab

PartyKeys / 音乐密码的网页与 iOS 演奏产品。线上版本：<https://op1.partykeys.ai>。

## 产品能力

- 36 键四层 Salamander Grand Piano 音源与合成兜底。
- 主音、旋律单音、智能三和弦。
- 8 拍循环录制、FX、节拍器和八步音序器。
- 九种风格音阶与屏幕 / 硬件同步灯光。
- Chrome / Edge Web MIDI、MidiBrowser BLE MIDI 与 USB MIDI。
- PartyKeys 36 CMD `0x15` / `0x71` 和 PopuPiano 29 独立设备 profile。
- 可安装 PWA，以及 `ios/PartyKeysPlay` 原生 iPhone / iPad App。

## Web

```sh
npm install
npm run dev
npm run build
```

PWA Manifest、Service Worker、App 图标和 Apple Touch Icon 已包含在 Web 构建中。

## iOS App

原生工程位于 `ios/PartyKeysPlay/MidiBrowser.xcodeproj`。App 使用 WKWebView 加载正式域名，通过 CoreMIDI 桥为网页提供 Web MIDI 与 SysEx；界面固定横屏并提供原生 BLE MIDI 设备连接页。

```sh
cd ios/PartyKeysPlay
xcodebuild \
  -project MidiBrowser.xcodeproj \
  -scheme MidiBrowser \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  test
```

## 发布验证

- Web：生产构建、PWA Manifest、Service Worker 与 HTTPS。
- iOS Simulator：App 编译及 22 项 AppConfig / bridge / MIDI / allowlist 测试。
- 真机：BLE MIDI、USB MIDI、PartyKeys/PopuPiano 灯光、重连与约 200 ms 灯光延迟必须在发布前复测。

钢琴采样署名见 `AUDIO_CREDITS.md`。
