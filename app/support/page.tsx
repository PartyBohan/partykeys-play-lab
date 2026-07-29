import Link from "next/link";

export const metadata = {
  title: "支持与联系 | 音乐密码OP",
  description: "音乐密码OP（PartyKeys Play）使用帮助、常见问题与技术支持联系方式",
};

const supportEmail = "popubohan@gmail.com";

export default function SupportPage() {
  return (
    <main className="privacy-shell">
      <p>PartyKeys · 音乐密码OP</p>
      <h1>支持与联系 / Support</h1>
      <p>
        如果你在连接键盘、蓝牙 MIDI、声音播放、Loop、音效或灯光同步时遇到问题，
        请发送邮件至 <a href={`mailto:${supportEmail}`}>{supportEmail}</a>。我们通常会在 2 个工作日内回复。
      </p>

      <h2>连接 PartyKeys</h2>
      <ol>
        <li>打开音乐密码OP，点击“连接 MIDI 设备”。</li>
        <li>打开 PartyKeys 键盘并进入蓝牙配对状态。</li>
        <li>在系统设备列表中选择键盘，连接后返回 App。</li>
        <li>首次播放时点击屏幕琴键或实体琴键以启用声音。</li>
      </ol>

      <h2>常见问题</h2>
      <p><strong>没有声音：</strong>请确认设备音量未静音，然后在 App 内点击一次琴键。必要时断开键盘并重新连接。</p>
      <p><strong>找不到蓝牙键盘：</strong>请确认键盘已开机且未连接到其他设备，并在 iPhone 或 iPad 的蓝牙设置中允许连接。</p>
      <p><strong>灯光没有同步：</strong>灯光功能需要兼容的 PartyKeys 设备。普通 MIDI 键盘仍可用于演奏，但不支持 PartyKeys 专用灯光。</p>
      <p><strong>页面加载失败：</strong>首次使用需要网络连接以加载界面和音色资源。请检查网络后重新打开 App。</p>

      <h2>联系我们时请提供</h2>
      <ul>
        <li>iPhone 或 iPad 型号及系统版本</li>
        <li>PartyKeys 或 MIDI 键盘型号</li>
        <li>问题发生时的操作步骤、截图或短视频</li>
      </ul>

      <h2>English Support</h2>
      <p>
        For help with device pairing, Bluetooth MIDI, audio, loops, effects, or PartyKeys lighting,
        email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. We normally respond within two business days.
      </p>
      <p>
        Please include your Apple device model, iOS/iPadOS version, keyboard model, and the steps needed to reproduce the issue.
      </p>

      <p><Link href="/privacy">隐私政策 / Privacy Policy</Link></p>
      <Link className="privacy-back" href="/">返回音乐密码OP</Link>
    </main>
  );
}
