<div align="center">

# ⚡ Light Yagami

### Advanced WhatsApp Bot with AI Integration

[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Baileys](https://img.shields.io/badge/Baileys-WhatsApp%20API-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)](LICENSE)

---

**Light Yagami** is a powerful WhatsApp bot built with Node.js and Baileys API. It features AI chat integration, media downloading, view once saving, auto status management, and much more!

</div>

---

## 🌟 Features

<table>
<tr>
<td>

### 📥 Media Downloader
- TikTok videos (no watermark)
- Auto-detect TikTok links
- Save view once media

</td>
<td>

### 🤖 AI Integration
- ChatGPT (OpenAI)
- Google Gemini
- Smart auto-replies

</td>
</tr>
<tr>
<td>

### 📱 Status Manager
- Auto watch status
- Auto like status
- Toggle on/off

</td>
<td>

### 👥 Group Control
- Tag all members
- Kick/Promote/Demote
- Welcome/Goodbye messages

</td>
</tr>
</table>

---

## 🚀 Quick Deploy

Deploy your bot in one click:

<div align="center">

[![Deploy to Heroku](https://img.shields.io/badge/Heroku-430098?style=for-the-badge&logo=heroku&logoColor=white)](https://dashboard.heroku.com/new?template=https://github.com/Maxorleans55/light-yagami)

[![Deploy to Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com/deploy?repo=https://github.com/Maxorleans55/light-yagami)

[![Deploy to Railway](https://img.shields.io/badge/Railway-FF8700?style=for-the-badge&logo=railway&logoColor=white)](https://railway.app/new/template?template=https://github.com/Maxorleans55/light-yagami)

[![Deploy to Koyeb](https://img.shields.io/badge/Koyeb-FF009D?style=for-the-badge&logo=koyeb&logoColor=white)](https://app.koyeb.com/deploy?type=git&repository=github.com/Maxorleans55/light-yagami)

</div>

---

## 🌐 Web Pairing Interface

After deploying, access the web interface at your app URL:

```
https://your-app-name.herokuapp.com
```

### How to Connect:

1. **Open the web interface** in your browser
2. **Enter your phone number** with country code
3. **Get your pairing code**
4. **Open WhatsApp** → Settings → Linked Devices
5. **Tap "Link with Phone Number Instead"**
6. **Enter the code**
7. **Done!** Your device is connected

---

## 📋 Commands

| Command | Description | Usage |
|---------|-------------|-------|
| **📝 GENERAL** | | |
| `!menu` | Show all commands | `!menu` |
| `!ping` | Check bot status | `!ping` |
| `!runtime` | Show bot uptime | `!runtime` |
| `!owner` | Bot owner info | `!owner` |
| `!info` | Bot information | `!info` |
| `!speed` | Test speed | `!speed` |
| **🎨 MEDIA** | | |
| `!sticker` | Image/video to sticker | `!sticker` |
| `!vv` | Save view once | `!vv` |
| `!tomp3` | Video to audio | `!tomp3` |
| **📥 DOWNLOAD** | | |
| `!tiktok` | Download TikTok | `!tiktok <url>` |
| `!tt` | Download TikTok | `!tt <url>` |
| **🤖 AI CHAT** | | |
| `!ai` | Chat with AI | `!ai Hello` |
| `!gpt` | ChatGPT | `!gpt What is life?` |
| `!gemini` | Gemini AI | `!gemini Explain quantum` |
| `!translate` | Translate text | `!translate es hello` |
| `!define` | Define a word | `!define happiness` |
| **🔧 TOOLS** | | |
| `!calc` | Calculator | `!calc 2+2*3` |
| `!reverse` | Reverse text | `!reverse hello` |
| `!binary` | Text to binary | `!binary hello` |
| `!quote` | Random quote | `!quote` |
| `!joke` | Random joke | `!joke` |
| `!weather` | Weather info | `!weather London` |
| **📱 STATUS** | | |
| `!autowatch` | Toggle auto watch | `!autowatch` |
| `!autolike` | Toggle auto like | `!autolike` |
| `!statusinfo` | Check settings | `!statusinfo` |
| **👥 GROUP** | | |
| `!tagall` | Mention all | `!tagall` |
| `!hidetag` | Hidden tag all | `!hidetag` |
| `!kick` | Remove user | `!kick @user` |
| `!promote` | Make admin | `!promote @user` |
| `!demote` | Remove admin | `!demote @user` |
| `!antilink` | Toggle antilink | `!antilink` |
| `!welcome` | Toggle welcome msg | `!welcome` |
| **👑 OWNER** | | |
| `!restart` | Restart bot | `!restart` |
| `!leave` | Bot leave group | `!leave` |

---

## 🛠️ Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ 
- [Git](https://git-scm.com/)
- WhatsApp account

### Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/Maxorleans55/light-yagami.git

# 2. Navigate to project
cd light-yagami

# 3. Install dependencies
npm install --legacy-peer-deps

# 4. Configure environment
cp .env.example .env
# Edit .env with your settings

# 5. Start the bot
npm start
```

### Scan QR Code

1. Run the bot
2. Scan the QR code with WhatsApp
3. Bot is now online!

---

## ⚙️ Configuration

Edit the `.env` file:

```env
# Bot Settings
BOT_NAME=Light Yagami
BOT_PREFIX=!
BOT_OWNER_NUMBER=233XXXXXXXXXX
BOT_OWNER_NAME=Your Name

# AI Keys (Optional)
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key

# Features
ENABLE_AUTO_REPLY=true
ENABLE_AI_CHAT=true
ENABLE_GROUP_CONTROL=true

# Server
PORT=3000
```

---

## 📁 Project Structure

```
light-yagami/
├── index.js              # Main bot code
├── package.json          # Dependencies
├── .env                  # Environment variables
├── .gitignore            # Git ignore rules
├── database.json         # User settings (auto-created)
├── auth_info/            # WhatsApp session (auto-created)
└── view_once_media/      # Saved view once (auto-created)
```

---

## 🎯 Feature Highlights

### 📥 TikTok Downloader
```bash
# Just send a TikTok link - bot auto-downloads!
https://www.tiktok.com/@user/video/123456

# Or use command
.tt https://www.tiktok.com/@user/video/123456
```

### 👁️ View Once Saver
```bash
# 1. Someone sends view once media
# 2. Reply with .vv
# 3. Bot saves and sends it back!
```

### 📱 Auto Status
```bash
# Toggle auto watch
!autowatch

# Toggle auto like
!autolike

# Check settings
!statusinfo
```

### 🤖 AI Chat
```bash
# Chat with AI
!ai What is the meaning of life?

# Use ChatGPT
!gpt Explain quantum computing

# Use Gemini
!gemini Write a poem about stars
```

---

## 🌐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_NAME` | Bot display name | Yes |
| `BOT_PREFIX` | Command prefix | Yes |
| `BOT_OWNER_NUMBER` | Your WhatsApp number | Yes |
| `BOT_OWNER_NAME` | Your name | Yes |
| `GOOGLE_API_KEY` | Gemini AI key | No |
| `OPENAI_API_KEY` | ChatGPT key | No |
| `ENABLE_AUTO_REPLY` | Auto-reply to greetings | No |
| `ENABLE_AI_CHAT` | AI chat feature | No |
| `ENABLE_GROUP_CONTROL` | Group management | No |
| `PORT` | Server port | No |

---

## 📊 Bot Stats

<div align="center">

![GitHub stars](https://img.shields.io/github/stars/Maxorleans55/light-yagami?style=social)
![GitHub forks](https://img.shields.io/github/forks/Maxorleans55/light-yagami?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/Maxorleans55/light-yagami?style=social)

</div>

---

## ⚠️ Disclaimer

This bot is for educational purposes. Use responsibly and comply with WhatsApp's Terms of Service. The developers are not responsible for any misuse.

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📞 Support

Having issues? 

- [Open an Issue](https://github.com/Maxorleans55/light-yagami/issues)
- [Watch Tutorial](https://youtu.be/wJKMV0BSqpE)

---

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

### ⭐ Star this repo if you find it useful!

**Made with ❤️ by [Max Shadows](https://github.com/Maxorleans55)**

</div>
