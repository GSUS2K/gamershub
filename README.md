# 🤖 Discord Bot — Full Feature Guide

A feature-packed Discord bot with **AI chat**, **moderation**, **music**, **XP leveling**, **fun games**, **easter eggs**, and **owner DM relay**.

---

## 🚀 Quick Setup

### 1. Prerequisites
- **Node.js v18+** — https://nodejs.org
- **FFmpeg** — Required for music playback
  - Windows: Download from https://ffmpeg.org/download.html and add to PATH
  - Mac: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### 2. Create Your Discord Bot
1. Go to https://discord.com/developers/applications
2. Click **New Application** → give it a name
3. Go to **Bot** → **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Go to **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Administrator` (or select individually)
6. Open the generated URL and invite the bot to your server

### 3. Install & Configure
```bash
# Clone or download this folder, then:
cd discord-bot

# Install dependencies
npm install

# Copy the example env file
cp .env.example .env

# Edit .env with your values
nano .env   # or open in any text editor
```

Fill in your `.env`:
```
DISCORD_TOKEN=your_token_here
ANTHROPIC_API_KEY=your_key_here
OWNER_ID=your_discord_user_id_here
```

> 💡 To get your User ID: Enable Developer Mode in Discord (Settings → Advanced), then right-click your name → Copy User ID

### 4. Run the Bot
```bash
npm start
# or for auto-restart on file changes:
npm run dev
```

---

## 📋 All Commands

### 🤖 AI (Powered by Claude)
| Command | Description |
|---------|-------------|
| `/ask <question>` | Ask Claude AI anything — general knowledge, coding, creative writing |
| `/roast @user` | AI roasts someone in a playful, comedy-roast style |
| `/story <prompt>` | AI writes a fun micro-story from your idea |
| `/vibe` | AI checks your vibe with a random result |
| `/debate <topic> <for/against>` | AI argues either side of any topic |

### 🛡️ Moderation
| Command | Description | Permission Required |
|---------|-------------|---------------------|
| `/kick @user [reason]` | Kick a member | Kick Members |
| `/ban @user [reason]` | Ban a member | Ban Members |
| `/warn @user <reason>` | Warn a member (stored, DM sent) | Moderate Members |
| `/warnings @user` | View all warnings for a user | Moderate Members |
| `/clearwarnings @user` | Clear all warnings | Moderate Members |
| `/mute @user <minutes> [reason]` | Timeout a member | Moderate Members |
| `/purge <amount>` | Delete 1–100 messages | Manage Messages |

### 🎮 Fun & Games
| Command | Description |
|---------|-------------|
| `/roll [sides]` | Roll a dice (default d6, supports up to d1,000,000) |
| `/8ball <question>` | Ask the magic 8-ball |
| `/coinflip` | Flip a coin |
| `/joke` | Random joke (SFW) |
| `/meme` | Random meme from Reddit |
| `/ship @user1 @user2` | Check compatibility % (deterministic per pair) |
| `/trivia` | Trivia question — type A/B/C/D in chat to answer |
| `/wouldyourather` | Random WYR question with reactions |
| `/fact` | Random interesting fact |
| `/rps <rock/paper/scissors>` | Play Rock Paper Scissors vs the bot |
| `/poll <question> [options]` | Create a poll (separate options with `\|`) |

### 📊 XP & Leveling
| Command | Description |
|---------|-------------|
| `/rank` | View your XP and current level |
| `/leaderboard` | Top 10 XP earners in the server |

> XP is earned automatically by chatting (15–25 XP per message). Correct trivia answers give bonus XP!

### 🎵 Music
| Command | Description |
|---------|-------------|
| `/play <song name or URL>` | Play a song (YouTube search or direct URL) |
| `/skip` | Skip the current song |
| `/stop` | Stop music and clear queue |
| `/queue` | Show the current queue |
| `/nowplaying` | Show current song info |
| `/pause` | Pause playback |
| `/resume` | Resume playback |

> The bot auto-disconnects after 30 seconds if left alone in a voice channel.

### 👑 Owner-Only
| Command | Description |
|---------|-------------|
| `/relay #channel <message>` | Send a message as the bot to any channel |
| `/announce #channel <title> <body> [color]` | Post a styled embed announcement |

### 📩 DM Relay System
Anyone who DMs the bot will have their message forwarded to you (the owner) as an embed.

**To reply**, DM the bot:
```
reply 123456789012345678 Hey, thanks for reaching out!
```
Replace the number with the user's Discord ID (shown in the forwarded embed).

---

## 🥚 Easter Eggs
The bot responds to these messages (try them!):

| Message | Response |
|---------|----------|
| `good bot` | Appreciation responses |
| `bad bot` | Sad bot noises 😢 |
| `amogus` / `sus` | ASCII crewmate |
| `ratio` | Counter-ratio storm |
| `skill issue` | Snarky comeback |
| `ping` | Pong + latency |
| `69` | nice |
| `420` | 🍃 |
| `the game` | You just lost The Game |
| `gm` / `good morning` | Morning greeting |
| `gn` / `good night` | Night message |
| `f` | F 🪦 |
| `im bored` | Command suggestions |
| `bot go brrr` | BRRR |
| `hello darkness my old friend` | ... |
| @mention the bot | Random response |
| Any long message (2% chance) | Random commentary |

---

## 🔧 Customization Tips

**Add custom easter eggs** — find the Easter Eggs section in `index.js` and add:
```js
if (c === 'your trigger phrase') {
  return message.reply('your response');
}
```

**Change bot status** — find `setActivity` in the `ready` event:
```js
client.user.setActivity('your custom status', { type: 3 }); // 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 5=Competing
```

**Faster command registration** (during development) — replace `Routes.applicationCommands` with:
```js
Routes.applicationGuildCommands(client.user.id, 'YOUR_GUILD_ID')
```
This registers commands instantly for one server instead of waiting up to 1 hour for global propagation.

**Persistent data** — Currently, warnings and XP are stored in memory and reset when the bot restarts. For persistence, swap the `Map()` stores with SQLite (using `better-sqlite3`) or a JSON file.

---

## 🐛 Troubleshooting

**Music not working?**
- Make sure FFmpeg is installed and in your PATH
- Try `ffmpeg -version` in terminal to verify
- `@discordjs/opus` and `sodium-native` may need build tools: `npm install --build-from-source`

**Commands not showing up?**
- Global slash commands can take up to 1 hour to appear
- Use guild commands during testing for instant registration

**`sodium-native` build error?**
- Windows: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
- Linux: `sudo apt install build-essential python3`
- Mac: `xcode-select --install`

**Bot can't DM a user?**
- User may have DMs disabled from server members. Nothing can be done about this.

---

## 📄 License
Do whatever you want with this. It's yours! 🎉
