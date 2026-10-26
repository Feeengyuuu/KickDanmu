# Chrome 应用商店上架材料

上架入口：https://chrome.google.com/webstore/devconsole （首次需要注册开发者账号，一次性 5 美元）。
Edge 商店（免费）：https://partner.microsoft.com/dashboard/microsoftedge

## 要上传的文件

| 项目 | 文件 |
|---|---|
| 扩展包 | Release 里的 `KickDanmu-v1.0.0.zip` |
| 商店图标 128×128 | `frontend/chrome_extension/image/app_icon.png` |
| 截图 1280×800 | `store/screenshot_1.png`、`store/screenshot_2.png` |
| 小宣传图 440×280 | `store/promo_tile_440x280.png` |
| 隐私政策网址 | https://github.com/Feeengyuuu/KickDanmu/blob/main/PRIVACY.md |
| 主页网址 | https://github.com/Feeengyuuu/KickDanmu |
| 支持网址 | https://github.com/Feeengyuuu/KickDanmu/issues |

## 商品详情

- **名称**：由扩展包自动读取（中文界面显示「KickDanmu：Kick 直播弹幕」）
- **类别**：娱乐 (Entertainment)
- **语言**：中文（简体），另加英文

### 详细说明（中文）

把 Kick 直播和回放的聊天变成飘屏弹幕。

【斗鱼风弹幕】黑体加粗 + 黑色描边，80% 不透明，亮场景也看得清
【不挡画面】弹幕只占播放器上方 30%
【直播、回放都能用】回放按时间轴同步，跟随播放速度，拖动进度条后自动重新对齐
【表情放大】表情按字号的 1.4 倍显示
【干净】自动跳过被管理员删除的消息、「新消息」分隔线、回复引用和时间戳
【随心调】字号、速度、透明度、密度、字体、粗细都能改，支持关键词 / 正则屏蔽

同样支持 YouTube 直播聊天和 Twitch。

使用方法：把鼠标移到播放器上，点控制栏右下角的弹幕按钮打开设置。

隐私：不需要登录，不收集任何数据，设置只保存在你的浏览器里。

开源地址：https://github.com/Feeengyuuu/KickDanmu （基于 DanMage 修改，GPL-3.0）
本扩展是独立项目，与 Kick、斗鱼均无关联。

### Detailed description (English)

Turn Kick live and VOD chat into scrolling danmaku (bullet comments).

- Bold, outlined text that stays readable on bright scenes
- Uses only the top 30% of the player
- Works on live streams and VODs; VOD chat follows the timeline, playback rate and seeking
- Emotes drawn 1.4x the text size
- Skips messages deleted by moderators, dividers, reply quotes and timestamps
- Adjustable size, speed, opacity, density, font and weight; keyword / regex block rules

Also works with YouTube live chat and Twitch.

Hover the player and click the danmaku button at the bottom right of the controls to open settings.

Privacy: no sign-in, no data collection; settings stay in your browser.

Open source: https://github.com/Feeengyuuu/KickDanmu (a modified version of DanMage, GPL-3.0). Not affiliated with Kick or Douyu.

## 隐私权规范（Privacy practices 页）

- **单一用途说明**：在 Kick（以及 YouTube 直播、Twitch）的视频播放器上，把页面聊天显示为滚动弹幕。
  Single purpose: Show the chat of Kick (and YouTube live, Twitch) as scrolling danmaku over the video player.
- **权限说明**：扩展不申请任何权限（manifest 里没有 permissions / host_permissions），只在 kick.com、www.youtube.com、www.twitch.tv 上注入内容脚本。
  Host access justification: The content script runs on kick.com, www.youtube.com and www.twitch.tv to read the chat shown on the page and draw it over the player.
- **远程代码**：不使用远程代码（No, I am not using remote code）。
- **数据使用**：所有数据类型都不勾选（不收集任何用户数据）；勾选三项承诺：不出售给第三方、不用于与单一用途无关的目的、不用于判断信用或放贷。
