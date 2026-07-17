# PartyKeys Play for iOS

原生 iPhone / iPad 外壳，固定加载 `https://op1.partykeys.ai`，通过 CoreMIDI 与 WKWebView Polyfill 为网页提供 Web MIDI、BLE MIDI 与 SysEx 能力。

## 功能

- iPhone / iPad 横屏演奏界面。
- 原生 BLE MIDI 设备连接页。
- USB MIDI 与 CoreMIDI 热插拔。
- Web MIDI input/output、批量消息、running status 与 SysEx。
- PartyKeys 36 / PopuPiano 29 灯光协议由网页产品层按设备 profile 处理。
- Kiosk 模式，只允许 PartyKeys 官方产品域名。

## 构建

```sh
xcodebuild \
  -project MidiBrowser.xcodeproj \
  -scheme MidiBrowser \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

真机或 TestFlight 需要在 Xcode 中选择 Apple Developer Team，并在真实 PartyKeys / BLE MIDI 设备上完成连接、灯光与延迟验收。
