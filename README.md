# Gamers Hub

A feature-rich Discord bot built with **discord.js** — packed with AI chat, League of Legends stats, moderation, music, XP leveling, fun games, and easter eggs.

---

## ✨ Features

- 🤖 **AI Chat** — Powered by Groq (Llama 3.3 70B) — ask questions, generate stories, roasts, debates and more
- 🎮 **League of Legends** — `/stats`, `/link`, `/champion`, `/tilt`, `/tierlist`, `/excuse` + LoL easter eggs
- 🛡️ **Moderation** — kick, ban, warn, mute, purge with warning history
- 🎵 **Music** — YouTube playback with queue, skip, pause, resume
- 📊 **XP Leveling** — auto XP on every message, level-up announcements, leaderboard
- 🎲 **Fun Commands** — 8ball, coinflip, trivia, would you rather, meme, joke, ship, rps, poll
- 🥚 **Easter Eggs** — 30+ triggers including LoL-specific responses
- 📩 **DM Relay** — DMs to the bot get forwarded to the owner
- 👑 **Owner Commands** — relay messages, announcements

---

## 🚀 Setup

### Prerequisites
- Node.js v18+
- FFmpeg (for music)

### Installation
```bash
git clone https://github.com/yourusername/your-repo.git
cd your-repo
npm install
cp .env.example .env
```

Fill in `.env`:
```
DISCORD_TOKEN=
GROQ_API_KEY=
RIOT_API_KEY=
MONGODB_URI=
OWNER_ID=
CLIENT_ID=
```

```bash
node index.js
```

---

## 📋 Commands

### 🤖 AI
| Command | Description |
|---------|-------------|
| `/ask` | Ask the AI anything |
| `/roast @user` | Roast someone |
| `/story` | Generate a micro-story |
| `/vibe` | Check your vibe |
| `/debate` | AI argues any topic |

### 🎮 League of Legends
| Command | Description |
|---------|-------------|
| `/stats` | Look up a player's rank and recent match |
| `/link` | Link your Riot ID to your Discord |
| `/champion` | Get a champion recommendation based on your mood |
| `/tilt` | Check your tilt level |
| `/tierlist` | Generate a chaotic tier list |
| `/excuse` | Generate a loss excuse |

### 🛡️ Moderation
| Command | Description |
|---------|-------------|
| `/kick` | Kick a member |
| `/ban` | Ban a member |
| `/warn` | Warn a member |
| `/warnings` | View warnings for a user |
| `/clearwarnings` | Clear all warnings |
| `/mute` | Timeout a member |
| `/purge` | Bulk delete messages |

### 🎵 Music
| Command | Description |
|---------|-------------|
| `/play` | Play a song from YouTube |
| `/skip` | Skip current song |
| `/stop` | Stop and clear queue |
| `/queue` | View the queue |
| `/nowplaying` | Current song info |
| `/pause` | Pause playback |
| `/resume` | Resume playback |

### 🎮 Fun
| Command | Description |
|---------|-------------|
| `/roll` | Roll a dice |
| `/8ball` | Magic 8-ball |
| `/coinflip` | Flip a coin |
| `/joke` | Random joke |
| `/meme` | Random meme |
| `/ship` | Compatibility checker |
| `/trivia` | Trivia question |
| `/wouldyourather` | Would you rather |
| `/fact` | Random fact |
| `/rps` | Rock paper scissors |
| `/poll` | Create a poll |

### 📊 XP
| Command | Description |
|---------|-------------|
| `/rank` | Your XP and level |
| `/leaderboard` | Top 10 server XP |

### 👑 Owner
| Command | Description |
|---------|-------------|
| `/relay` | Send a message as the bot |
| `/announce` | Post a styled announcement |
| `/dm` | DM a user as the bot |

---

## 🔑 API Keys

| Key | Where to get |
|-----|-------------|
| `DISCORD_TOKEN` | https://discord.com/developers/applications |
| `GROQ_API_KEY` | https://console.groq.com |
| `RIOT_API_KEY` | https://developer.riotgames.com |
| `MONGODB_URI` | https://cloud.mongodb.com |

---

## 🛠️ Built With

- [discord.js](https://discord.js.org) v14
- [Groq SDK](https://console.groq.com) — Llama 3.3 70B
- [Riot Games API](https://developer.riotgames.com)
- [MongoDB](https://www.mongodb.com) + Mongoose
- [@discordjs/voice](https://github.com/discordjs/voice) + play-dl
