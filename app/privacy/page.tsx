import Link from "next/link";

export const metadata = {
  title: "隐私政策 | 音乐密码OP",
  description: "音乐密码OP（PartyKeys Play）隐私政策",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-shell">
      <p>PartyKeys · 音乐密码OP</p>
      <h1>隐私政策</h1>
      <p>更新日期：2026 年 7 月 17 日</p>

      <h2>我们如何处理数据</h2>
      <p>音乐密码OP 用于本地音乐演奏、MIDI 连接、循环录制、音效处理与键盘灯光同步。当前版本不要求注册账户，不收集姓名、电话号码、电子邮件、通讯录、位置、支付信息或用于广告跟踪的标识符。</p>

      <h2>MIDI 与蓝牙设备</h2>
      <p>当你主动连接 PartyKeys 或其他兼容设备时，App 会在设备本地读取和发送 MIDI 数据，用于发声、和弦触发及灯光同步。这些 MIDI 演奏数据不会由我们上传或用于识别用户。</p>

      <h2>麦克风</h2>
      <p>App 的界面可能显示麦克风控制，但当前版本不会录制、存储或上传麦克风音频。若未来加入相关功能，我们会在使用前请求系统权限并更新本政策。</p>

      <h2>网络与本地缓存</h2>
      <p>App 会从 op1.partykeys.ai 加载界面、音色和必要资源，并可能在设备中缓存这些资源以改善加载速度和离线体验。我们不会将缓存内容用于用户画像或跨 App 跟踪。</p>

      <h2>儿童隐私</h2>
      <p>我们不会有意收集儿童的个人信息。由于当前版本不提供账户、社交、聊天或公开发布功能，用户不会通过本 App 向其他用户公开个人内容。</p>

      <h2>政策更新</h2>
      <p>当功能或数据处理方式发生变化时，我们会更新本页面，并在适用情况下重新取得必要授权。</p>

      <h2>联系我们</h2>
      <p>如对本隐私政策有疑问，请访问 <Link href="/support">支持与联系页面</Link> 与 PartyKeys 团队联系。</p>

      <Link className="privacy-back" href="/">返回音乐密码OP</Link>
    </main>
  );
}
