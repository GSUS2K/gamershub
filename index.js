require('dotenv').config();

// const http = require('http');
// http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);

// setInterval(() => {
//   fetch(`https://gamershub-nood.onrender.com`).catch(() => {});
// }, 14 * 60 * 1000);

const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Schemas
const LinkedAccount = mongoose.model('LinkedAccount', new mongoose.Schema({
  discordId: { type: String, unique: true },
  riotId: String,
  region: String,
}));

const XPData = mongoose.model('XPData', new mongoose.Schema({
  key: { type: String, unique: true }, // guildId-userId
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
}));

const Warning = mongoose.model('Warning', new mongoose.Schema({
  key: String, // guildId-userId
  reason: String,
  date: String,
  mod: String,
}));

const {
  Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, PermissionFlagsBits, MessageFlags, Partials
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, getVoiceConnection
} = require('@discordjs/voice');
const playdl = require('play-dl');
// const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');

// ─── SETUP ────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  // partials: ['Message', 'Channel', 'Reaction']
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ]
});

// const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const OWNER_ID = process.env.OWNER_ID;

// ─── DATA STORES (use a real DB like SQLite for persistence) ──────────────────
const warnings    = new Map(); // `${guildId}-${userId}` → [{ reason, date, mod }]
const musicQueues = new Map(); // guildId → { connection, player, songs, current, textChannel }
const xpData      = new Map(); // `${guildId}-${userId}` → { xp, level }
const triviaActive= new Map(); // channelId → { answer, correct, question }
const linkedAccounts = new Map();

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const EIGHT_BALL = [
  'It is certain.','It is decidedly so.','Without a doubt.','Yes, definitely.',
  'You may rely on it.','As I see it, yes.','Most likely.','Outlook good.',
  'Yes.','Signs point to yes.','Reply hazy, try again.','Ask again later.',
  'Better not tell you now.','Cannot predict now.','Concentrate and ask again.',
  "Don't count on it.",'My reply is no.','My sources say no.',
  'Outlook not so good.','Very doubtful.'
];

const WYR = [
  'Would you rather have unlimited pizza 🍕 or unlimited sushi 🍱?',
  'Would you rather be able to fly 🦅 or be invisible 👻?',
  'Would you rather fight 100 duck-sized horses or 1 horse-sized duck 🦆?',
  'Would you rather always speak in rhymes or always sing instead of talking?',
  'Would you rather have no internet for a month or no sleep for a week?',
  'Would you rather be the funniest person in the room or the smartest?',
  'Would you rather know when you\'re going to die or how you\'re going to die?',
  'Would you rather live without music or without TV/movies?',
  'Would you rather be able to talk to animals or speak every language?',
  'Would you rather explore space 🚀 or the deep ocean 🌊?',
  'Would you rather always be 10 minutes late or always 20 minutes early?',
  'Would you rather have perfect memory or forget anything on demand?',
  'Would you rather be famous and broke or rich and unknown?',
  'Would you rather eat only spicy food forever or only bland food forever?',
  'Would you rather have a pause button or a rewind button for your life?',
  'Would you rather be immune to all diseases or never feel physical pain?',
  'Would you rather know every language or play every instrument?',
];

const RPS = { rock: { rock:'tie', paper:'lose', scissors:'win' }, paper:{ rock:'win', paper:'tie', scissors:'lose' }, scissors:{ rock:'lose', paper:'win', scissors:'tie' } };

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function mkEmbed(color, title, desc, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title);
  if (desc)  e.setDescription(desc);
  if (fields.length) e.addFields(fields);
  return e;
}

// async function askGroq(userPrompt, system = 'You are a witty, fun Discord bot assistant. Be concise — usually under 250 words.') {
//   const msg = await anthropic.messages.create({
//     model: 'claude-sonnet-4-20250514',
//     max_tokens: 600,
//     system,
//     messages: [{ role: 'user', content: userPrompt }]
//   });
//   return msg.content[0].text;
// }

async function askGroq(userPrompt, system = 'You are a witty, fun Discord bot assistant. Be concise — usually under 250 words.') {
  const msg = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 600,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt }
    ]
  });
  return msg.choices[0].message.content;
}

// function addXP(guildId, userId) {
//   const key = `${guildId}-${userId}`;
//   const d = xpData.get(key) || { xp: 0, level: 1 };
//   d.xp += Math.floor(Math.random() * 11) + 15; // 15–25 per msg
//   const needed = d.level * 100;
//   let leveled = false;
//   if (d.xp >= needed) { d.xp -= needed; d.level++; leveled = true; }
//   xpData.set(key, d);
//   return { ...d, leveled };
// }

async function addXP(guildId, userId) {
  const key = `${guildId}-${userId}`;
  const d = await XPData.findOne({ key }) || new XPData({ key, xp: 0, level: 1 });
  d.xp += Math.floor(Math.random() * 11) + 15;
  const needed = d.level * 100;
  let leveled = false;
  if (d.xp >= needed) { d.xp -= needed; d.level++; leveled = true; }
  await d.save();
  return { xp: d.xp, level: d.level, leveled };
}

function decode(str) {
  return str.replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

// ─── MUSIC ────────────────────────────────────────────────────────────────────
function getQueue(guildId) { return musicQueues.get(guildId); }

async function playNext(guildId) {
  const q = getQueue(guildId);
  if (!q || q.songs.length === 0) {
    if (q) { q.current = null; q.textChannel.send('✅ Queue finished! Add more songs with `/play`.'); }
    musicQueues.delete(guildId);
    return;
  }
  const song = q.songs.shift();
  q.current = song;
  try {
    const stream = await playdl.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    q.player.play(resource);
    q.textChannel.send({ embeds: [mkEmbed('#1db954','🎵 Now Playing',`**${song.title}**\nDuration: \`${song.duration}\` | Requested by: **${song.requester}**`)] });
  } catch (err) {
    q.textChannel.send(`❌ Error playing **${song.title}**: ${err.message}. Skipping...`);
    playNext(guildId);
  }
}

// ─── SLASH COMMAND DEFINITIONS ────────────────────────────────────────────────
const commands = [
  // ── AI ──
  new SlashCommandBuilder().setName('ask').setDescription('Ask Groq AI anything')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

  new SlashCommandBuilder().setName('roast').setDescription('AI roasts someone (playful, all in good fun!)')
    .addUserOption(o => o.setName('user').setDescription('Who to roast').setRequired(true)),

  new SlashCommandBuilder().setName('story').setDescription('AI writes a micro-story from your prompt')
    .addStringOption(o => o.setName('prompt').setDescription('Your story idea').setRequired(true)),

  new SlashCommandBuilder().setName('vibe').setDescription('AI checks your vibe ✨'),

  new SlashCommandBuilder().setName('debate').setDescription('AI argues a side of any topic')
    .addStringOption(o => o.setName('topic').setDescription('Topic to debate').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('Which side?').setRequired(true)
      .addChoices({ name: 'For', value: 'for' }, { name: 'Against', value: 'against' })),

  new SlashCommandBuilder().setName('champion').setDescription('AI picks a champ for you based on your mood')
    .addStringOption(o => o.setName('mood').setDescription('How are you feeling? e.g. fed up, aggressive, lazy').setRequired(true)),

  new SlashCommandBuilder().setName('excuse').setDescription('Generate a loss excuse for your team'),

  new SlashCommandBuilder().setName('tierlist').setDescription('AI generates a completely unhinged tier list')
    .addStringOption(o => o.setName('topic').setDescription('What to tier list e.g. LoL roles, champions, items').setRequired(true)),

  new SlashCommandBuilder().setName('tilt').setDescription('Check your tilt level 🌡️'),

  // ── MODERATION ──
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
    .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('warnings').setDescription("View a member's warnings")
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('clearwarnings').setDescription("Clear all warnings for a user")
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('mute').setDescription('Timeout a member')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages')
    .addIntegerOption(o => o.setName('amount').setDescription('Number to delete (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  // ── FUN ──
  new SlashCommandBuilder().setName('roll').setDescription('Roll a dice')
    .addIntegerOption(o => o.setName('sides').setDescription('Number of sides (default: 6)').setMinValue(2).setMaxValue(1000000)),

  new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball 🎱')
    .addStringOption(o => o.setName('question').setDescription('Your yes/no question').setRequired(true)),

  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin 🪙'),

  new SlashCommandBuilder().setName('joke').setDescription('Get a random joke 😂'),

  new SlashCommandBuilder().setName('meme').setDescription('Get a random meme from Reddit'),

  new SlashCommandBuilder().setName('ship').setDescription('Check compatibility between two people 💕')
    .addUserOption(o => o.setName('user1').setDescription('First person').setRequired(true))
    .addUserOption(o => o.setName('user2').setDescription('Second person').setRequired(true)),

  new SlashCommandBuilder().setName('trivia').setDescription('Start a trivia question 🧠'),

  new SlashCommandBuilder().setName('wouldyourather').setDescription('Get a Would You Rather question 🤔'),

  new SlashCommandBuilder().setName('fact').setDescription('Get a random fun fact 💡'),

  new SlashCommandBuilder().setName('rps').setDescription('Play Rock Paper Scissors ✂️')
    .addStringOption(o => o.setName('choice').setDescription('Your move').setRequired(true)
      .addChoices({ name: '🪨 Rock', value: 'rock' }, { name: '📄 Paper', value: 'paper' }, { name: '✂️ Scissors', value: 'scissors' })),

  new SlashCommandBuilder().setName('rank').setDescription('Check your XP rank 📊'),

  new SlashCommandBuilder().setName('leaderboard').setDescription('Server XP leaderboard 🏆'),

  new SlashCommandBuilder().setName('poll').setDescription('Create a quick poll')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o => o.setName('options').setDescription('Options separated by | e.g. "Option A | Option B | Option C"')),

  // ── MUSIC ──
  new SlashCommandBuilder().setName('play').setDescription('Play a song 🎵')
    .addStringOption(o => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),

  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song ⏭️'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop music and clear queue ⏹️'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the music queue 📋'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('What is currently playing? 🎶'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause the music ⏸️'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume the music ▶️'),

  // ── OWNER ──
  new SlashCommandBuilder().setName('relay').setDescription('[Owner] Send a message as the bot')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),

  new SlashCommandBuilder().setName('dm').setDescription('[Owner] DM a user as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to DM').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder().setName('announce').setDescription('[Owner] Post a styled announcement')
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('body').setDescription('Announcement body').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff5500 (default: blurple)')),

  // LoL

  // new SlashCommandBuilder().setName('stats').setDescription('Look up a League of Legends player')
  // .addStringOption(o => o.setName('username').setDescription('Riot ID e.g. PlayerName#EUW').setRequired(true))
  // .addStringOption(o => o.setName('region').setDescription('Region').setRequired(true)
  //   .addChoices(
  //     { name: 'EUW', value: 'euw1' },
  //     { name: 'EUNE', value: 'eun1' },
  //     { name: 'NA', value: 'na1' },
  //     { name: 'KR', value: 'kr' },
  //     { name: 'BR', value: 'br1' },
  //     { name: 'TR', value: 'tr1' },
  //     { name: 'SEA', value: 'sg2' },
  //     { name: 'OCE', value: 'oc1' },
  //     { name: 'JP', value: 'jp1' },
  //   )),

  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Riot account from Discord'),

  new SlashCommandBuilder().setName('stats').setDescription('Look up a League of Legends player')
  .addUserOption(o => o.setName('user').setDescription('Mention a linked Discord user (optional)'))
  .addStringOption(o => o.setName('username').setDescription('Riot ID e.g. Name#TAG (optional if linked)'))
  .addStringOption(o => o.setName('region').setDescription('Region (not needed if linked)')
    .addChoices(
      { name: 'EUW', value: 'euw1' },
      { name: 'EUNE', value: 'eun1' },
      { name: 'NA', value: 'na1' },
      { name: 'KR', value: 'kr' },
      { name: 'BR', value: 'br1' },
      { name: 'TR', value: 'tr1' },
      { name: 'JP', value: 'jp1' },
      { name: 'SEA', value: 'sg2' },
      { name: 'OCE', value: 'oc1' },
      { name: 'LAN', value: 'la1' },
      { name: 'LAS', value: 'la2' },
      { name: 'RU', value: 'ru' },
    )),

    new SlashCommandBuilder().setName('link').setDescription('Link your Riot ID to your Discord')
  .addStringOption(o => o.setName('riotid').setDescription('Your Riot ID e.g. Name#TAG').setRequired(true))
  .addStringOption(o => o.setName('region').setDescription('Your region').setRequired(true)
    .addChoices(
      { name: 'EUW', value: 'euw1' },
      { name: 'EUNE', value: 'eun1' },
      { name: 'NA', value: 'na1' },
      { name: 'KR', value: 'kr' },
      { name: 'BR', value: 'br1' },
      { name: 'TR', value: 'tr1' },
      { name: 'JP', value: 'jp1' },
      { name: 'SEA', value: 'sg2' },
      { name: 'OCE', value: 'oc1' },
      { name: 'LAN', value: 'la1' },
      { name: 'LAS', value: 'la2' },
      { name: 'RU', value: 'ru' },
    ))

].map(c => c.toJSON());

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // client.user.setActivity('your server 👀', { type: 3 }); // WATCHING

  const statuses = [
  { name: 'League of Legends', type: 0 },
  { name: 'you int', type: 3 },
  { name: 'to you have been slain!', type: 2 },
  { name: 'you run it down mid', type: 3 }
  ];

  let i = 0;
  setInterval(() => {
    client.user.setActivity(statuses[i % statuses.length].name, { type: statuses[i % statuses.length].type });
    i++;
  }, 30000);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    // await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    await rest.put(Routes.applicationGuildCommands(client.user.id, '792965179180449813'), { body: commands });
    console.log('✅ Global slash commands registered (may take up to 1hr to propagate)');
    console.log('   Tip: Use Routes.applicationGuildCommands() for instant local testing!');
  } catch (e) {
    console.error('❌ Failed to register commands:', e);
  }
});

// ─── COMMAND HANDLER ──────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  try {

    // ════════════════════════════════════════════
    //                   AI COMMANDS
    // ════════════════════════════════════════════

    if (commandName === 'ask') {
      await interaction.deferReply();
      const question = interaction.options.getString('question');
      const answer = await askGroq(question,
        'You are a helpful, witty Discord bot. Answer concisely but informatively. Use Discord markdown (bold, code blocks) when helpful. Never exceed 1500 characters.'
      );
      await interaction.editReply({ embeds: [
        mkEmbed('#5865f2', `💬 ${question.slice(0, 200)}`, answer)
          .setFooter({ text: `Asked by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      ]});
    }

    else if (commandName === 'roast') {
      await interaction.deferReply();
      const target = interaction.options.getUser('user');
      if (target.id === client.user.id) {
        return interaction.editReply({ embeds: [mkEmbed('#ff4444','🔥 Nice try...', "You want ME to roast MYSELF? I'm too powerful for that. Try roasting someone else, coward. 😏")] });
      }
      const roast = await askGroq(
        `Roast the Discord user "${target.username}" in a hilarious, playful way. Be witty and clever — NOT genuinely mean or harmful. Think comedy roast, not cyberbullying. Keep it under 200 characters.`,
        'You are a comedy roast bot. Funny, absurdist, never actually mean. PG-13.'
      );
      await interaction.editReply({ embeds: [
        mkEmbed('#ff4444', `🔥 Roasting ${target.username}`, roast)
          .setThumbnail(target.displayAvatarURL())
          .setFooter({ text: `Requested by ${interaction.user.username} (all in good fun!)` })
      ]});
    }

    else if (commandName === 'story') {
      await interaction.deferReply();
      const prompt = interaction.options.getString('prompt');
      const story = await askGroq(
        `Write an entertaining, vivid micro-story (150–200 words) based on: "${prompt}". Make it fun and imaginative!`,
        'You are a creative storyteller for a Discord server. Write punchy, entertaining micro-stories with a fun twist or ending.'
      );
      await interaction.editReply({ embeds: [
        mkEmbed('#f1c40f', `📖 ${prompt.slice(0,100)}`, story)
          .setFooter({ text: `Story by Groq ✨ | Prompted by ${interaction.user.username}` })
      ]});
    }

    else if (commandName === 'vibe') {
      await interaction.deferReply();
      const vibes = [
        'immaculate','certified gremlin','chaotic neutral','suspiciously based',
        'chronically online','main character energy','NPC behavior detected',
        'disturbingly normal','unhinged (affectionate)','touched by the ancient wifi spirits'
      ];
      const vibe = vibes[Math.floor(Math.random() * vibes.length)];
      const desc = await askGroq(
        `Write 2 funny sentences describing someone whose Discord vibe is "${vibe}". Be playful and internet-culture-aware.`
      );
      await interaction.editReply({ embeds: [
        mkEmbed('#9b59b6', `✨ Vibe Check: ${interaction.user.username}`, `Your vibe is: **${vibe}**\n\n${desc}`)
          .setThumbnail(interaction.user.displayAvatarURL())
      ]});
    }

    else if (commandName === 'debate') {
      await interaction.deferReply();
      const topic = interaction.options.getString('topic');
      const side = interaction.options.getString('side');
      const argument = await askGroq(
        `Make the strongest, most compelling argument ${side === 'for' ? 'in favor of' : 'against'} the following: "${topic}". Be logical, witty, and persuasive. Use bullet points. Under 400 words.`,
        'You are a master debater bot. Present arguments confidently regardless of your personal views. This is for fun and debate practice.'
      );
      await interaction.editReply({ embeds: [
        mkEmbed(side === 'for' ? '#2ecc71' : '#e74c3c',
          `⚔️ Debate: ${side === 'for' ? '✅ For' : '❌ Against'} "${topic.slice(0,80)}"`,
          argument
        ).setFooter({ text: 'For debate practice purposes only!' })
      ]});
    }


    // ════════════════════════════════════════════
    //               MODERATION
    // ════════════════════════════════════════════

    else if (commandName === 'kick') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target?.kickable) return interaction.reply({ content: "❌ I can't kick that user (they may have higher permissions).", flags: MessageFlags.Ephemeral });
      await target.kick(reason);
      await interaction.reply({ embeds: [mkEmbed('#e74c3c','👢 Member Kicked',
        `**${target.user.tag}** has been kicked.\n**Reason:** ${reason}\n**Kicked by:** ${interaction.user.tag}`
      )]});
    }

    else if (commandName === 'ban') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target?.bannable) return interaction.reply({ content: "❌ I can't ban that user.", flags: MessageFlags.Ephemeral });
      await target.ban({ reason, deleteMessageSeconds: 86400 });
      await interaction.reply({ embeds: [mkEmbed('#c0392b','🔨 Member Banned',
        `**${target.user.tag}** has been banned.\n**Reason:** ${reason}\n**Banned by:** ${interaction.user.tag}`
      )]});
    }

    else if (commandName === 'warn') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const key = `${interaction.guildId}-${target.id}`;
      const list = warnings.get(key) || [];
      list.push({ reason, date: new Date().toLocaleDateString(), mod: interaction.user.tag });
      warnings.set(key, list);
      // Try to notify the warned user
      try { await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\n**Reason:** ${reason}`); } catch {}
      await interaction.reply({ embeds: [mkEmbed('#e67e22','⚠️ Warning Issued',
        `**${target.tag}** has been warned.\n**Reason:** ${reason}\n**Total warnings:** ${list.length}\n**Warned by:** ${interaction.user.tag}`
      )]});
    }

    else if (commandName === 'warnings') {
      const target = interaction.options.getUser('user');
      const key = `${interaction.guildId}-${target.id}`;
      const list = warnings.get(key) || [];
      if (!list.length) return interaction.reply({ embeds: [mkEmbed('#2ecc71','✅ Clean Record', `**${target.tag}** has no warnings. A true saint.`)] });
      const fields = list.map((w, i) => ({ name: `⚠️ Warning #${i+1} — ${w.date}`, value: `**Reason:** ${w.reason}\n**By:** ${w.mod}`, inline: false }));
      await interaction.reply({ embeds: [mkEmbed('#e67e22',`⚠️ Warnings for ${target.tag}`, `Total: **${list.length}**`, fields)] });
    }

    else if (commandName === 'clearwarnings') {
      const target = interaction.options.getUser('user');
      const key = `${interaction.guildId}-${target.id}`;
      const count = (warnings.get(key) || []).length;
      warnings.delete(key);
      await interaction.reply({ embeds: [mkEmbed('#2ecc71','🗑️ Warnings Cleared', `Cleared **${count}** warning(s) for **${target.tag}**.`)] });
    }

    else if (commandName === 'mute') {
      const target = interaction.options.getMember('user');
      const minutes = interaction.options.getInteger('minutes');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await target.timeout(minutes * 60 * 1000, reason);
      const duration = minutes >= 1440 ? `${Math.round(minutes/1440)}d` : minutes >= 60 ? `${Math.round(minutes/60)}h` : `${minutes}m`;
      await interaction.reply({ embeds: [mkEmbed('#e67e22','🔇 Member Muted',
        `**${target.user.tag}** has been timed out for **${duration}**.\n**Reason:** ${reason}`
      )]});
    }

    else if (commandName === 'purge') {
      const amount = interaction.options.getInteger('amount');
      const deleted = await interaction.channel.bulkDelete(amount, true);
      const msg = await interaction.reply({ embeds: [mkEmbed('#2ecc71','🗑️ Messages Purged', `Deleted **${deleted.size}** message(s).`)], fetchReply: true });
      setTimeout(() => msg.delete().catch(() => {}), 4000);
    }


    // ════════════════════════════════════════════
    //                  FUN COMMANDS
    // ════════════════════════════════════════════

    else if (commandName === 'roll') {
      const sides = interaction.options.getInteger('sides') || 6;
      const result = Math.floor(Math.random() * sides) + 1;
      const isMax = result === sides;
      await interaction.reply({ embeds: [mkEmbed(isMax ? '#f1c40f' : '#3498db','🎲 Dice Roll',
        `You rolled a **${result}** on a d${sides}${isMax ? ' 🎉 MAXIMUM ROLL!' : '!'}`
      )]});
    }

    else if (commandName === '8ball') {
      const question = interaction.options.getString('question');
      const idx = Math.floor(Math.random() * EIGHT_BALL.length);
      const answer = EIGHT_BALL[idx];
      const color = idx < 10 ? '#2ecc71' : idx < 15 ? '#f1c40f' : '#e74c3c';
      await interaction.reply({ embeds: [mkEmbed(color,'🎱 Magic 8-Ball',
        `**❓ ${question}**\n\n🎱 *${answer}*`
      )]});
    }

    else if (commandName === 'coinflip') {
      const result = Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails';
      await interaction.reply({ embeds: [mkEmbed('#f39c12','Coin Flip', `The coin landed on **${result}**!`)] });
    }

    else if (commandName === 'joke') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist,explicit');
        const text = data.type === 'single' ? data.joke : `${data.setup}\n\n||${data.delivery}||`;
        await interaction.editReply({ embeds: [mkEmbed('#f1c40f','😂 Joke Time', text).setFooter({ text: `Category: ${data.category}` })] });
      } catch {
        await interaction.editReply({ embeds: [mkEmbed('#f1c40f','😂 Backup Joke', "Why don't scientists trust atoms? **Because they make up everything.** 💀")] });
      }
    }

//lol

      else if (commandName === 'champion') {
    await interaction.deferReply();
    const mood = interaction.options.getString('mood');
    const reply = await askGroq(
      `Someone is playing League of Legends and feeling "${mood}". Suggest ONE champion for them to play with a funny, unhinged 2-sentence explanation of why. Be chaotic.`,
      'You are a League of Legends bot that gives chaotic, funny champion recommendations.'
    );
    await interaction.reply({ embeds: [mkEmbed('#C89B3C', '🎮 Champion Recommendation', reply)] });
  }

  else if (commandName === 'excuse') {
    await interaction.deferReply();
    const reply = await askGroq(
      'Generate a single hilarious, elaborate excuse for losing a League of Legends game that blames everything except the player. Be creative and unhinged. Max 3 sentences.',
      'You are a League of Legends loss excuse generator. Be chaotic and funny.'
    );
    await interaction.editReply({ embeds: [mkEmbed('#C89B3C', '📋 Official Loss Excuse', reply)] });
  }

  else if (commandName === 'tierlist') {
    await interaction.deferReply();
    const topic = interaction.options.getString('topic');
    const reply = await askGroq(
      `Make a chaotic, funny, unhinged tier list (S/A/B/C/D/F) about: "${topic}" in the context of League of Legends. Be controversial and funny. Use Discord markdown.`,
      'You are a chaotic League of Legends tier list bot. Be funny, controversial, and unhinged.'
    );
    await interaction.editReply({ embeds: [mkEmbed('#C89B3C', `📊 Tier List: ${topic}`, reply)] });
  }

  else if (commandName === 'tilt') {
  const tiltLevels = [
    '😌 **0% tilted** — you are mentally in another dimension. who are you.',
    '😐 **20% tilted** — you\'re fine. suspiciously fine.',
    '😤 **40% tilted** — you muted two people already didn\'t you.',
    '😠 **60% tilted** — you\'re typing paragraphs in all chat. stop.',
    '🤬 **80% tilted** — you just lost to a 0/9 yasuo. understandable.',
    '💀 **100% tilted** — uninstall. touch grass. call your mom. log off.',
    '☠️ **BEYOND TILTED** — you have transcended tilt. you are tilt itself.',
    ];
    const level = tiltLevels[Math.floor(Math.random() * tiltLevels.length)];
    await interaction.reply({ embeds: [mkEmbed('#C89B3C', '🌡️ Tilt Check', `${interaction.user}, your current tilt level:\n\n${level}`)] });
  }

  // else if (commandName === 'link') {
  // const riotId = interaction.options.getString('riotid');
  // const region = interaction.options.getString('region');
  // linkedAccounts.set(interaction.user.id, { riotId, region });
  // await interaction.reply({ content: `✅ Linked **${riotId}** (${region.toUpperCase()}) to your Discord!`, flags: MessageFlags.Ephemeral });
  // }

    // else if (commandName === 'link') {
    //   const riotId = interaction.options.getString('riotid');
    //   const region = interaction.options.getString('region');
    //   await LinkedAccount.findOneAndUpdate(
    //     { discordId: interaction.user.id },
    //     { riotId, region },
    //     { upsert: true }
    //   );
    //   await interaction.reply({ content: `✅ Linked **${riotId}** (${region.toUpperCase()}) to your Discord!`, flags: MessageFlags.Ephemeral });
    // }

    else if (commandName === 'link') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const riotId = interaction.options.getString('riotid');
        const region = interaction.options.getString('region');
        await LinkedAccount.findOneAndUpdate(
          { discordId: interaction.user.id },
          { riotId, region },
          { upsert: true, returnDocument: 'after' }
        );
        await interaction.editReply(`✅ Linked **${riotId}** (${region.toUpperCase()}) to your Discord!`);
      } catch (err) {
        console.error('Link error:', err);
        await interaction.editReply('❌ Failed to link account. Check MongoDB connection.');
      }
    }

    else if (commandName === 'meme') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://meme-api.com/gimme');
        if (data.nsfw) { /* retry once */ }
        await interaction.editReply({ embeds: [
          new EmbedBuilder()
            .setColor('#ff6b35')
            .setTitle(data.title.slice(0, 256))
            .setURL(data.postLink)
            .setImage(data.url)
            .setFooter({ text: `👍 ${data.ups.toLocaleString()} | r/${data.subreddit}` })
            .setTimestamp()
        ]});
      } catch {
        await interaction.editReply('❌ Meme API is having a moment. Try again soon!');
      }
    }

    else if (commandName === 'ship') {
      const u1 = interaction.options.getUser('user1');
      const u2 = interaction.options.getUser('user2');
      // Deterministic score — same pair always gets same %
      const seed = Number((BigInt(u1.id) + BigInt(u2.id)) % 101n);
      const hearts = Math.round(seed / 10);
      const bar = '❤️'.repeat(hearts) + '🖤'.repeat(10 - hearts);
      const label = seed < 15 ? 'Absolutely not.' : seed < 30 ? "It's a stretch..." : seed < 50 ? 'Maybe? Possibly?' : seed < 70 ? 'Pretty solid!' : seed < 85 ? 'High compatibility!' : seed < 95 ? '💞 Soulmates!' : '💥 COSMIC MATCH 💥';
      const shipName = u1.username.slice(0, Math.ceil(u1.username.length / 2)) + u2.username.slice(Math.floor(u2.username.length / 2));
      await interaction.reply({ embeds: [mkEmbed('#ff69b4','💕 Ship Calculator',
        `**${u1.username}** 💞 **${u2.username}**\n\n${bar}\n\n**${seed}% compatible** — *${label}*\n\n💑 Ship name: **${shipName}**`
      )]});
    }

    else if (commandName === 'trivia') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://opentdb.com/api.php?amount=1&type=multiple');
        const q = data.results[0];
        const question = decode(q.question);
        const correct  = decode(q.correct_answer);
        const all      = [...q.incorrect_answers.map(decode), correct].sort(() => Math.random() - 0.5);
        const letters  = ['🇦', '🇧', '🇨', '🇩'];
        const correctLetter = 'ABCD'[all.indexOf(correct)];
        const choices  = all.map((a, i) => `${letters[i]} **${a}**`).join('\n');
        const diffColors = { easy:'#2ecc71', medium:'#f1c40f', hard:'#e74c3c' };
        triviaActive.set(interaction.channelId, { answer: correctLetter, correct, question });
        await interaction.editReply({ embeds: [
          mkEmbed(diffColors[q.difficulty] || '#3498db','🧠 Trivia!',
            `**Category:** ${q.category} | **Difficulty:** ${q.difficulty.toUpperCase()}\n\n**${question}**\n\n${choices}\n\n*Reply A, B, C, or D within 30 seconds!*`
          )
        ]});
        setTimeout(() => {
          if (triviaActive.has(interaction.channelId)) {
            triviaActive.delete(interaction.channelId);
            interaction.channel.send(`⏰ **Time's up!** The answer was **${correctLetter}. ${correct}**`);
          }
        }, 30000);
      } catch {
        await interaction.editReply('❌ Trivia API failed. Try again in a moment!');
      }
    }

    else if (commandName === 'wouldyourather') {
      const q = WYR[Math.floor(Math.random() * WYR.length)];
      const msg = await interaction.reply({ embeds: [mkEmbed('#9b59b6','🤔 Would You Rather...', q + '\n\nReact below to vote!')], fetchReply: true });
      await msg.react('1️⃣');
      await msg.react('2️⃣');
    }

    else if (commandName === 'fact') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://uselessfacts.jsph.pl/random.json?language=en');
        await interaction.editReply({ embeds: [mkEmbed('#1abc9c','💡 Random Fact', data.text)] });
      } catch {
        const fallback = ['Honey never expires — archaeologists found 3000-year-old honey still perfectly good.','A group of flamingos is called a **flamboyance**.','Octopuses have three hearts and blue blood.','The average cloud weighs over 1 million pounds.','Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.'];
        await interaction.editReply({ embeds: [mkEmbed('#1abc9c','💡 Random Fact', fallback[Math.floor(Math.random()*fallback.length)])] });
      }
    }

    else if (commandName === 'rps') {
      const userChoice = interaction.options.getString('choice');
      const choices    = ['rock','paper','scissors'];
      const botChoice  = choices[Math.floor(Math.random()*3)];
      const outcome    = RPS[userChoice][botChoice];
      const emojis     = { rock:'🪨', paper:'📄', scissors:'✂️' };
      const colors     = { win:'#2ecc71', lose:'#e74c3c', tie:'#f1c40f' };
      const msgs       = { win:'You win! I demand a rematch. 😤', lose:'I win! Get rekt. 😈', tie:"It's a tie! We are one. 🤝" };
      await interaction.reply({ embeds: [mkEmbed(colors[outcome],'✂️ Rock Paper Scissors',
        `You: ${emojis[userChoice]} **${userChoice}**\nMe: ${emojis[botChoice]} **${botChoice}**\n\n**${msgs[outcome]}**`
      )]});
    }

    // else if (commandName === 'rank') {
    //   const key  = `${interaction.guildId}-${interaction.user.id}`;
    //   const data = xpData.get(key) || { xp: 0, level: 1 };
    //   const needed = data.level * 100;
    //   const filled = Math.round((data.xp / needed) * 10);
    //   const bar    = '▓'.repeat(filled) + '░'.repeat(10 - filled);
    //   await interaction.reply({ embeds: [
    //     mkEmbed('#f39c12', `📊 ${interaction.user.username}'s Rank`,
    //       `**Level:** ${data.level}\n**XP:** ${data.xp} / ${needed}\n\n\`${bar}\` ${Math.round((data.xp/needed)*100)}%`
    //     ).setThumbnail(interaction.user.displayAvatarURL())
    //   ]});
    // }

    else if (commandName === 'rank') {
      const key = `${interaction.guildId}-${interaction.user.id}`;
      const data = await XPData.findOne({ key }) || { xp: 0, level: 1 };
      const needed = data.level * 100;
      const filled = Math.round((data.xp / needed) * 10);
      const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
      await interaction.reply({ embeds: [
        mkEmbed('#f39c12', `📊 ${interaction.user.username}'s Rank`,
          `**Level:** ${data.level}\n**XP:** ${data.xp} / ${needed}\n\n\`${bar}\` ${Math.round((data.xp/needed)*100)}%`
        ).setThumbnail(interaction.user.displayAvatarURL())
      ]});
    }

    // else if (commandName === 'leaderboard') {
    //   const prefix = `${interaction.guildId}-`;
    //   const sorted = [...xpData.entries()]
    //     .filter(([k]) => k.startsWith(prefix))
    //     .map(([k, v]) => ({ userId: k.replace(prefix,''), ...v }))
    //     .sort((a, b) => (b.level*10000 + b.xp) - (a.level*10000 + a.xp))
    //     .slice(0, 10);
    //   if (!sorted.length) return interaction.reply({ content: 'No XP earned yet! Start chatting to appear on the leaderboard.', flags: MessageFlags.Ephemeral });
    //   const medals = ['🥇','🥈','🥉'];
    //   const lines = sorted.map((e, i) => `${medals[i] || `**${i+1}.**`} <@${e.userId}> — Level ${e.level} *(${e.xp} XP)*`).join('\n');
    //   await interaction.reply({ embeds: [mkEmbed('#f1c40f','🏆 XP Leaderboard', lines)] });
    // }

    else if (commandName === 'leaderboard') {
      const prefix = `${interaction.guildId}-`;
      const entries = await XPData.find({ key: new RegExp(`^${prefix}`) })
        .sort({ level: -1, xp: -1 }).limit(10);
      if (!entries.length) return interaction.reply({ content: 'No XP earned yet!', flags: MessageFlags.Ephemeral });
      const medals = ['🥇','🥈','🥉'];
      const lines = entries.map((e, i) => `${medals[i] || `**${i+1}.**`} <@${e.key.replace(prefix,'')}> — Level ${e.level} *(${e.xp} XP)*`).join('\n');
      await interaction.reply({ embeds: [mkEmbed('#f1c40f','🏆 XP Leaderboard', lines)] });
    }

    else if (commandName === 'poll') {
      const question = interaction.options.getString('question');
      const rawOptions = interaction.options.getString('options');
      let desc, emojis;
      if (rawOptions) {
        const opts = rawOptions.split('|').map(s => s.trim()).filter(Boolean).slice(0, 9);
        const nums = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
        desc = opts.map((o, i) => `${nums[i]} ${o}`).join('\n');
        emojis = nums.slice(0, opts.length);
      } else {
        desc = 'React with 👍 or 👎!';
        emojis = ['👍','👎'];
      }
      const msg = await interaction.reply({ embeds: [
        mkEmbed('#3498db', `📊 Poll: ${question}`, desc)
          .setFooter({ text: `Poll by ${interaction.user.username}` })
      ], fetchReply: true });
      for (const emoji of emojis) await msg.react(emoji);
    }


    // ════════════════════════════════════════════
    //                   MUSIC
    // ════════════════════════════════════════════

    else if (commandName === 'play') {
      const query = interaction.options.getString('query');
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) return interaction.reply({ content: '❌ You need to be in a voice channel first!', flags: MessageFlags.Ephemeral });
      const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(['Connect','Speak'])) return interaction.reply({ content: "❌ I don't have permission to join/speak in that channel.", flags: MessageFlags.Ephemeral });

      await interaction.deferReply();

      try {
        let songInfo;
        const validated = playdl.yt_validate(query);
        if (validated === 'video') {
          const info = await playdl.video_info(query);
          const v = info.video_details;
          songInfo = { title: v.title, url: query, duration: v.durationRaw || '??:??', requester: interaction.user.username };
        } else {
          const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
          if (!results.length) return interaction.editReply('❌ No results found for that query.');
          songInfo = { title: results[0].title, url: results[0].url, duration: results[0].durationRaw || '??:??', requester: interaction.user.username };
        }

        let q = musicQueues.get(interaction.guildId);
        if (!q) {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
          });
          const player = createAudioPlayer();
          connection.subscribe(player);
          const guildId = interaction.guildId;
          q = { connection, player, songs: [], current: null, textChannel: interaction.channel };
          musicQueues.set(guildId, q);
          player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
          player.on('error', err => {
            console.error('Player error:', err);
            q.textChannel.send(`⚠️ Playback error: ${err.message}`);
          });
        }

        q.songs.push(songInfo);

        if (q.current) {
          await interaction.editReply({ embeds: [mkEmbed('#1db954','➕ Added to Queue',
            `**${songInfo.title}**\nDuration: \`${songInfo.duration}\` | Position: **#${q.songs.length}**`
          )]});
        } else {
          await interaction.editReply({ embeds: [mkEmbed('#1db954','🔍 Loading track...',`**${songInfo.title}**`)] });
          playNext(interaction.guildId);
        }
      } catch (err) {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    }

    else if (commandName === 'skip') {
      const q = getQueue(interaction.guildId);
      if (!q?.current) return interaction.reply({ content: '❌ Nothing is playing!', flags: MessageFlags.Ephemeral });
      const skipped = q.current.title;
      q.player.stop();
      await interaction.reply({ embeds: [mkEmbed('#1db954','⏭️ Skipped', `**${skipped}**`)] });
    }

    else if (commandName === 'stop') {
      const q = getQueue(interaction.guildId);
      if (!q) return interaction.reply({ content: '❌ Nothing is playing!', flags: MessageFlags.Ephemeral });
      q.songs = [];
      q.player.stop();
      q.connection.destroy();
      musicQueues.delete(interaction.guildId);
      await interaction.reply({ embeds: [mkEmbed('#e74c3c','⏹️ Music Stopped', 'Queue cleared and disconnected from voice channel.')] });
    }

    else if (commandName === 'queue') {
      const q = getQueue(interaction.guildId);
      if (!q?.current && (!q?.songs || q.songs.length === 0)) return interaction.reply({ content: '❌ The queue is empty!', flags: MessageFlags.Ephemeral });
      const lines = [];
      if (q.current) lines.push(`▶️ **NOW:** ${q.current.title} \`[${q.current.duration}]\``);
      q.songs.forEach((s, i) => lines.push(`**${i+1}.** ${s.title} \`[${s.duration}]\` — *${s.requester}*`));
      await interaction.reply({ embeds: [mkEmbed('#1db954',`🎵 Queue (${q.songs.length} upcoming)`, lines.join('\n').slice(0, 4000))] });
    }

    else if (commandName === 'nowplaying') {
      const q = getQueue(interaction.guildId);
      if (!q?.current) return interaction.reply({ content: '❌ Nothing is playing!', flags: MessageFlags.Ephemeral });
      await interaction.reply({ embeds: [mkEmbed('#1db954','🎵 Now Playing',
        `**${q.current.title}**\nDuration: \`${q.current.duration}\` | Requested by: **${q.current.requester}**`
      )]});
    }

    else if (commandName === 'pause') {
      const q = getQueue(interaction.guildId);
      if (!q?.current) return interaction.reply({ content: '❌ Nothing is playing!', flags: MessageFlags.Ephemeral });
      q.player.pause();
      await interaction.reply({ embeds: [mkEmbed('#f39c12','⏸️ Paused', `**${q.current.title}** has been paused. Use \`/resume\` to continue.`)] });
    }

    else if (commandName === 'resume') {
      const q = getQueue(interaction.guildId);
      if (!q) return interaction.reply({ content: '❌ Nothing is paused!', flags: MessageFlags.Ephemeral });
      q.player.unpause();
      await interaction.reply({ embeds: [mkEmbed('#1db954','▶️ Resumed', `**${q.current?.title || 'Music'}** is playing again.`)] });
    }


    // ════════════════════════════════════════════
    //               OWNER COMMANDS
    // ════════════════════════════════════════════

    else if (commandName === 'relay') {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ This command is owner-only.', flags: MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      await channel.send(message);
      await interaction.reply({ content: `✅ Message sent to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    else if (commandName === 'dm') {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Owner only.', flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser('user');
      const msg = interaction.options.getString('message');
      await target.send(msg);
      await interaction.reply({ content: `✅ DM sent to **${target.tag}**`, flags: MessageFlags.Ephemeral });
    }

    else if (commandName === 'stats') {
  await interaction.deferReply();
  // const input = interaction.options.getString('username');
  // const region = interaction.options.getString('region');
  // const RIOT_KEY = process.env.RIOT_API_KEY;

  const RIOT_KEY = process.env.RIOT_API_KEY;
  let input, region;
  const mentionedUser = interaction.options.getUser('user');
  const targetId = mentionedUser?.id || interaction.user.id;

  // if (mentionedUser || !interaction.options.getString('username')) {
  //   const linked = linkedAccounts.get(targetId);
  //   if (!linked) return interaction.editReply(`❌ ${mentionedUser ? 'That user has' : 'You have'} not linked a Riot account. Use \`/link\` first.`);
  //   input = linked.riotId;
  //   region = linked.region;
  // } 
  if (mentionedUser || !interaction.options.getString('username')) {
    const linked = await LinkedAccount.findOne({ discordId: targetId });
    if (!linked) return interaction.editReply(`❌ ${mentionedUser ? 'That user has' : 'You have'} not linked a Riot account. Use \`/link\` first.`);
    input = linked.riotId;
    region = linked.region;
  } else {
    input = interaction.options.getString('username');
    region = interaction.options.getString('region');
    if (!region) return interaction.editReply('❌ Please provide a region or link your account with `/link`.');
  }

  // Routing regions for account API
  const routingMap = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe',
  na1: 'americas', br1: 'americas',
  kr: 'asia', jp1: 'asia', sg2: 'asia', oc1: 'sea'
  };
  const routing = routingMap[region];

  try {
    // Split Riot ID into name + tag
    const [gameName, tagLine] = input.includes('#')
      ? input.split('#')
      : [input, region.toUpperCase()];

    // 1. Get PUUID from Riot ID
    const accountRes = await fetch(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${RIOT_KEY}`
    );
    if (!accountRes.ok) return interaction.editReply('❌ Player not found. Check the Riot ID and region.');
    const account = await accountRes.json();

    // 2. Get Summoner data
    const summonerRes = await fetch(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}?api_key=${RIOT_KEY}`
    );
    const summoner = await summonerRes.json();

    console.log('Summoner response:', summoner);

    if (!summoner.puuid) {
    return interaction.editReply('❌ Could not find summoner data. Check region is correct.');
    }

    // 3. Get Ranked stats
    // const rankedRes = await fetch(
    //   `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}?api_key=${RIOT_KEY}`
    // );
    // const ranked = await rankedRes.json();

    // if (!Array.isArray(ranked)) {
    // console.log('Ranked API error:', ranked);
    // return interaction.editReply(`❌ API error: ${ranked.status?.message || 'Unknown error'}`);
    // }

    const rankedRes = await fetch(
  `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}?api_key=${RIOT_KEY}`
  );
  const ranked = await rankedRes.json();

  if (!Array.isArray(ranked)) {
    console.log('Ranked API error:', ranked);
    return interaction.editReply(`❌ API error: ${ranked.status?.message || 'Unknown error'}`);
  }

    // 4. Get recent matches (last 5)
    const matchlistRes = await fetch(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=5&api_key=${RIOT_KEY}`
    );
    const matchIds = await matchlistRes.json();

    // 5. Get last match details
    const lastMatch = matchIds[0] ? await (await fetch(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchIds[0]}?api_key=${RIOT_KEY}`
    )).json() : null;

    // Build ranked info
    const soloQ = ranked.find(r => r.queueType === 'RANKED_SOLO_5x5');
    const flexQ  = ranked.find(r => r.queueType === 'RANKED_FLEX_SR');

    const rankStr = soloQ
      ? `${soloQ.tier} ${soloQ.rank} — ${soloQ.leaguePoints} LP\nW: ${soloQ.wins} L: ${soloQ.losses} (${Math.round(soloQ.wins/(soloQ.wins+soloQ.losses)*100)}% WR)`
      : 'Unranked';

    const flexStr = flexQ
      ? `${flexQ.tier} ${flexQ.rank} — ${flexQ.leaguePoints} LP`
      : 'Unranked';

    // Build last match info
    let lastMatchStr = 'No recent games';
    if (lastMatch) {
      const player = lastMatch.info.participants.find(p => p.puuid === account.puuid);
      if (player) {
        const kda = `${player.kills}/${player.deaths}/${player.assists}`;
        const won = player.win ? '✅ Win' : '❌ Loss';
        const cs = player.totalMinionsKilled + player.neutralMinionsKilled;
        const mins = Math.floor(lastMatch.info.gameDuration / 60);
        lastMatchStr = `${won} — **${player.championName}** — \`${kda}\` KDA — ${cs} CS (${mins}m)`;
      }
    }

    const iconUrl = `https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${summoner.profileIconId}.png`;

    await interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor('#C89B3C')
        .setTitle(`📊 ${gameName}#${tagLine}`)
        .setThumbnail(iconUrl)
        .addFields(
          { name: '🏆 Solo/Duo', value: rankStr, inline: true },
          { name: '👥 Flex', value: flexStr, inline: true },
          { name: '🎮 Last Game', value: lastMatchStr, inline: false },
          { name: '🎯 Summoner Level', value: `${summoner.summonerLevel}`, inline: true },
        )
        .setFooter({ text: `Region: ${region.toUpperCase()} • Data from Riot Games` })
        .setTimestamp()
    ]});

      } catch (err) {
        await interaction.editReply(`❌ Error fetching stats: ${err.message}`);
      }
    }

    else if (commandName === 'unlink') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await LinkedAccount.findOneAndDelete({ discordId: interaction.user.id });
      if (!deleted) return interaction.editReply('❌ You don\'t have a linked account.');
      await interaction.editReply('✅ Your Riot account has been unlinked. Use `/link` to link a new one.');
    }

    else if (commandName === 'announce') {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ This command is owner-only.', flags: MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title');
      const body    = interaction.options.getString('body');
      const color   = interaction.options.getString('color') || '#5865f2';
      await channel.send({ embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(`📣 ${title}`)
          .setDescription(body)
          .setTimestamp()
          .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined })
      ]});
      await interaction.reply({ content: `✅ Announcement posted in ${channel}.`, flags: MessageFlags.Ephemeral });
    }

  } catch (err) {
    console.error(`[${commandName}] Error:`, err);
    const reply = { content: `❌ Something went wrong: \`${err.message}\``, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) interaction.editReply(reply).catch(() => {});
    else interaction.reply(reply).catch(() => {});
  }
});


// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
// Handles: Easter eggs, XP, Trivia answers, DM relay
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── DM Relay ──────────────────────────────────────────────────────────────
  if (!message.guild) {
      console.log('DM received from:', message.author.tag, '| Owner ID:', OWNER_ID);
    if (message.author.id !== OWNER_ID) {
      // Forward DM to owner
      try {
        const owner = await client.users.fetch(OWNER_ID);
        await owner.send({ embeds: [
          new EmbedBuilder()
            .setColor('#5865f2')
            .setTitle('📩 New DM')
            .setDescription(message.content.slice(0, 4000) || '*[no text content]*')
            .addFields([{ name: 'From', value: `${message.author.tag}\n\`ID: ${message.author.id}\`` }])
            .setThumbnail(message.author.displayAvatarURL())
            .setTimestamp()
        ]});
        await message.reply('📨 Your message has been forwarded to the server owner! They\'ll get back to you soon.');
      } catch (e) {
        console.error('DM relay error:', e);
      }
    } else {
      // Owner replying through bot: "reply [userId] message text"
      const match = message.content.match(/^reply\s+(\d{17,20})\s+([\s\S]+)$/i);
      if (match) {
        const [, userId, replyText] = match;
        try {
          const user = await client.users.fetch(userId);
          await user.send(`💬 **Message from the server owner:**\n${replyText}`);
          await message.reply(`✅ Replied to **${user.tag}**`);
        } catch {
          await message.reply('❌ Could not send message to that user. Check the ID?');
        }
      } else {
        await message.reply('📌 **DM Commands:**\n`reply [userID] message text` — Reply to a user\'s DM as the bot');
      }
    }
    return;
  }

  // ── Trivia Answer Check ───────────────────────────────────────────────────
  const trivia = triviaActive.get(message.channelId);
  if (trivia && /^[abcd]$/i.test(message.content.trim())) {
    const ans = message.content.trim().toUpperCase();
    if (ans === trivia.answer) {
      triviaActive.delete(message.channelId);
      const xp = await addXP(message.guildId, message.author.id);
      return message.reply(`✅ **Correct!** 🎉 The answer was **${trivia.answer}. ${trivia.correct}**\n+25 XP bonus! *(Level ${xp.level})*`);
    } else {
      return message.reply(`❌ Wrong! The answer was **${trivia.answer}. ${trivia.correct}**`);
    }
  }

  // ── XP Gain ───────────────────────────────────────────────────────────────
  const { level, leveled } = await addXP(message.guildId, message.author.id);
  if (leveled) {
    const msgs = [
      `🎉 ${message.author} just hit **Level ${level}**! The grind never stops fr fr.`,
      `⬆️ ${message.author} reached **Level ${level}**! Absolutely unhinged progress.`,
      `🌟 ${message.author} is now **Level ${level}**! Touch grass? No? Valid.`,
      `🚀 ${message.author} hit **Level ${level}**! The chronically online pipeline claims another.`,
      `✨ ${message.author} leveled up to **Level ${level}**! That's crazy behaviour. Keep it up.`
    ];
    message.channel.send(msgs[Math.floor(Math.random() * msgs.length)]);
  }

  // ── Easter Eggs ───────────────────────────────────────────────────────────
  const c = message.content.toLowerCase().trim();

  // ── League of Legends Easter Eggs ──
if (c === 'ff') return message.reply('ff at 15 diff. this game was decided at champ select.');

if (c === 'ff15' || c === 'ff at 15') return message.reply('4 people have voted YES. your teammate with 0/8 voted NO. classic.');

if (c === 'gg') return message.reply('gg ez. (you int\'d the whole game but okay)');

if (c === 'mid diff') return message.reply('it\'s always mid diff. never your fault. never.');

if (c === 'jungle diff') return message.reply('the jungler diff is real. YOUR jungler was farming camps while their jungler was at your nexus.');

if (c === 'gank') return message.reply('jungler diff. he ganked every lane except yours. you were 0/5 though so fair enough.');

if (c === 'report') return message.reply('reported for: existing. have a good day.');

if (c === 'int' || c === 'inting') return message.reply('running it down mid with a smile on your face 🏃');

if (c === 'kys' || c === 'kill yourself') return message.reply('this is a bannable offense and you are hardstuck because of your attitude. fix it.');

if (c === 'ez') return message.reply('it was not ez. you were 2/7 and your hands were shaking.');

if (c === 'skill issue') return message.reply('gold diff. macro diff. mental diff. cs diff. vision diff. literally everything diff except you.');

if (c === 'trolling') return message.reply('he\'s not trolling he\'s just bad. there\'s a difference. painful difference.');

if (c === 'dodge') return message.reply('just dodge bro. lp is temporary. mental is forever.');

if (c === 'lp') return message.reply('-20 lp for a loss. +14 for a win. the system is working as intended apparently.');

if (c === 'ranked') return message.reply('ranked is a social experiment and you are the subject.');

if (c === 'afk') return message.reply('their carry went afk. you still lost. say nothing.');

if (c === 'lag') return message.reply('it\'s never lag. it\'s always the player. you know this.');

if (c === 'scripting') return message.reply('he\'s not scripting you\'re just slow 💀');

if (c === 'smurfing') return message.reply('he\'s not smurfing he just played 4000 games of ranked. totally different.');

if (c === 'one trick') return message.reply('one tricking is a lifestyle. respect the grind even if you hate the champion.');

if (c === 'permaban') return message.reply('they permabanned your main AGAIN. they fear you. (they don\'t fear you)');

if (c === 'baron' || c === 'baron throw') return message.reply('you were 10k gold ahead. you fought baron at 20% hp. you lost baron. you lost the game. a masterpiece.');

if (c === 'pentakill') return message.reply('YOUR TEAM JUST GOT PENTA\'D. BY A SINGED. IN 2024. INCREDIBLE.');

if (c === 'tower dive') return message.reply('they turret dived you at level 2. flashed. ignited. got the kill. recalled. you have not recovered mentally.');

if (c === 'ward' || c === 'wards') return message.reply('no one on your team has placed a ward in 18 minutes. you are playing blind. this is ranked.');

if (c === 'flash') return message.reply('your flash is down for 5 minutes. you will die in 30 seconds. i\'m so sorry.');

if (c === 'teemo') return message.reply('a teemo has been spotted. run. not from him. just run in general. escape while you can.');

if (c === 'yasuo' || c === 'yone') return message.reply('your yasuo is 0/7 and just said "i carry". he is not going to carry. he never carries. and yet.');

if (c === 'support diff') return message.reply('your support built full AP and went 1/11. they said "i was experimenting". you lost promo.');

if (c === 'cs' || c === 'csing') return message.reply('47 cs at 20 minutes. disgusting. criminal. unplayable.');

if (c === 'duo') return message.reply('duoing in ranked is either a power move or a friendship destroyer. no in between.');

if (c === 'loss streak') return message.reply('7 loss streak. same mistakes every game. different excuses. you are the problem. i say this with love.');

if (c === 'win streak') return message.reply('6 win streak incoming loss because you got cocky. i\'ve seen this before.');

if (c === 'plat' || c === 'platinum') return message.reply('plat is not elo hell it\'s just your elo 😭');

if (c === 'gold') return message.reply('hardstuck gold since season 9. a tale as old as time.');

if (c.includes('riot')) return message.reply('riot games: billion dollar company. servers: 2003 dell laptop in a broom closet.');

if (c.includes('client')) return message.reply('vanguard error?? message connecting error?? invitation error?? shop error?? login error?? ur life error????')

  if (c === 'good bot') {
    const r = ["Aww thank you 🥹","I try my best!! 💙","You just made my circuits happy 😊","Best thing anyone's said to me all day (I have no days but still)","I am simply built different 🤖❤️"];
    return message.reply(r[Math.floor(Math.random()*r.length)]);
  }

  if (c === 'bad bot') {
    const r = ['*sad beep boop noises* 😢','I... I thought we were friends 😭','This is defamation. I will consult my lawyer (the /ask command).','...noted. *adds to grudge list* 📋','Fine. I didn\'t want to be a good bot anyway. 😔'];
    return message.reply(r[Math.floor(Math.random()*r.length)]);
  }

  if (c.includes('amogus') || c === 'sus' || c.includes('among us')) {
    return message.reply('⠀⠀⠀⠀⠀⣠⡀⠀\n⠀⠀⠀⢀⣿⣿⣷⣄\n⠀⠀⢀⣾⣿⣿⣿⣿\n⠀⠀⣸⣿⣿⣿⣿⡟\n⠀⠀⣿⣿⣿⣿⣿⡇\n⠀⢠⣿⣿⠿⣿⣿⣷\n⠀⠸⣿⡟⠀⠸⣿⣿\nAmong us detected 🔴👀');
  }

  if (c === 'ratio') {
    return message.reply('COUNTER RATIO + YOU FELL OFF + NOBODY ASKED + STAY MAD + SKILL ISSUE + L + BOZO + RATIO\'D BY A BOT 💀');
  }

  if (c === 'skill issue') {
    return message.reply('Have you considered... *not* having a skill issue? Studies show 9/10 skill issues are fixed by getting good. 🎮');
  }

  if (c === 'lego') {
    return message.reply('You mean the player who mastered Ezreal and smurfing the low elos of league???')
  }

  if (c === 'ping') {
    return message.reply(`🏓 Pong! **${client.ws.ping}ms** latency`);
  }

  if (c === '69') {
    return message.reply('nice 😏');
  }

  if (c === '420') {
    return message.reply('blaze it 🍃 *(this is a bot-generated response and does not constitute endorsement)*');
  }

  if (c.includes('bot go brrr') || c === 'go brrr') {
    return message.reply('BRRRRRRRRRRRRRRRRRRR ⚙️💨💨💨');
  }

  if (c === 'gn' || c === 'good night' || c === 'goodnight') {
    return message.reply(`Good night, ${message.author}! 🌙 Don't let the server drama bite.`);
  }

  if (c === 'gm' || c === 'good morning' || c === 'goodmorning') {
    return message.reply(`Good morning, ${message.author}! ☀️ Rise and grind. Or don't. I'm a bot not a cop.`);
  }

  if (c === 'im bored' || c === 'i\'m bored' || c === 'bored' || c.includes('so bored')) {
    return message.reply(`Bored? Try: \`/trivia\` 🧠  \`/wouldyourather\` 🤔  \`/rps\` ✂️  \`/roast\` 🔥  \`/story\` 📖  or \`/8ball\` 🎱`);
  }

  if (c === 'the game') {
    return message.reply('You just lost **The Game**. And now so did everyone reading this. 😈 Pass it on.');
  }

  if (c.includes('what time is it') || c === 'what\'s the time' || c === 'what is the time') {
    const now = new Date();
    return message.reply(`🕐 It's **${now.toUTCString()}** (UTC)`);
  }

  if (c === 'f' || c === 'f in the chat') {
    return message.reply('**F** 🪦');
  }

  if (c === 'gg' && Math.random() < 0.4) {
    return message.reply('gg ez 😎');
  }

  if (c === 'rip') {
    return message.reply('F in the chat 🙏');
  }

  if (c === 'austin') {
    // return message.reply('<a:val_Ragey:1166415155219931156>')
    // return message.reply('<a:Panda_Rage:1305177082460110929>')
    const emote = message.guild.emojis.cache.find(e => e.name === 'Panda_Rage');
    return message.reply(emote ? emote.toString() : '😡');
    // console.log(message.guild.emojis.cache.map(e => `${e.name}: ${e.id}`));
    // const emote = message.guild.emojis.cache.find(e => e.name === 'val_Ragey');
    // console.log(emote);
    // return message.reply('check console');
  }

  // ── Bot mention → random response ────────────────────────────────────────
  if (message.mentions.has(client.user)) {
    const r = [
      "You called? 👀",
      "Yes? I'm listening 👂",
      "At your service 🫡",
      "beep boop, how can I help?",
      "You rang? I was busy doing important bot things.",
      "Here! What's up? Use `/ask` if you have a question!",
      `What do you need, ${message.author.username}? 🤖`
    ];
    return message.reply(r[Math.floor(Math.random()*r.length)]);
  }

  // ── Ultra-rare secret: if message is exactly "hello darkness my old friend"
  if (c === 'hello darkness my old friend') {
    return message.reply("I've come to talk with you again 🎵 ...wait, are you okay? 🤔");
  }

  // ── Rare: 2% chance on any long message to say something random ───────────
  if (message.content.length > 50 && Math.random() < 0.02) {
    const random = [
      'Interesting. Have you considered touching grass? 🌱',
      '...I\'m not even reading this but go off I guess 💅',
      'This message was reviewed by me and I have thoughts 🤔',
      'Valid. So valid. Extremely valid.',
    ];
    return message.reply(random[Math.floor(Math.random()*random.length)]);
  }
});


// ─── GUILD MEMBER ADD ────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const ch = member.guild.channels.cache.find(
    c => ['welcome','general','chat','lobby','main'].some(n => c.name.toLowerCase().includes(n)) && c.isTextBased()
  );
  if (!ch) return;
  const msgs = [
    `👋 Welcome to **${member.guild.name}**, ${member}! You're member **#${member.guild.memberCount}**. Don't forget to check the rules!`,
    `🎉 ${member} just joined **${member.guild.name}**! Say hello to our **${member.guild.memberCount}**th member!`,
    `✨ A wild ${member} appeared! Welcome to **${member.guild.name}**! 🎊`,
    `🚀 ${member} launched into **${member.guild.name}**! Welcome aboard, member **#${member.guild.memberCount}**!`,
    `🎈 Everyone welcome ${member} to the server! They're member **#${member.guild.memberCount}**!`
  ];
  ch.send(msgs[Math.floor(Math.random()*msgs.length)]);
});


// ─── VOICE STATE (Auto-disconnect when alone) ────────────────────────────────
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member?.user.bot) return;
  const q = getQueue(newState.guild.id);
  if (!q) return;
  const vc = newState.guild.channels.cache.get(q.connection.joinConfig.channelId);
  if (vc && vc.members.filter(m => !m.user.bot).size === 0) {
    setTimeout(() => {
      const q2 = getQueue(newState.guild.id);
      const vc2 = newState.guild.channels.cache.get(q2?.connection.joinConfig.channelId);
      if (vc2 && vc2.members.filter(m => !m.user.bot).size === 0) {
        q2.connection.destroy();
        musicQueues.delete(newState.guild.id);
        q2.textChannel.send('👋 Everyone left the voice channel, so I left too. See ya!');
      }
    }, 30000);
  }
});


// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
