
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
require('dotenv').config();

app.use(express.json());

global.balances = {
  "123456789012345678": 1000
};

async function sendLog(client, action, userId, details = {}) {
  const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`📘 ${action}`)
    .setColor(action.includes('취소') ? 0xff0000 : 0x3498db)
    .addFields(
      { name: '사용자', value: `<@${userId}>`, inline: true },
      ...Object.entries(details).map(([key, value]) => ({
        name: key,
        value: String(value),
        inline: true
      }))
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

app.get('/api/balance', (req, res) => {
  const discordId = req.query.discordId;
  const balance = global.balances[discordId] || 0;
  res.json({ balance });
});

app.post('/api/transfer', (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || !amount) return res.status(400).json({ error: '데이터 누락' });
  if ((global.balances[from] || 0) < amount) return res.status(400).json({ error: '잔액 부족' });

  global.balances[from] -= amount;
  global.balances[to] = (global.balances[to] || 0) + amount;

  res.json({ success: true });
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commands = [
  new SlashCommandBuilder()
    .setName('잔액')
    .setDescription('당신의 잔액을 확인합니다'),
  new SlashCommandBuilder()
    .setName('송금')
    .setDescription('다른 유저에게 돈을 보냅니다')
    .addUserOption(option => option.setName('받는사람').setDescription('송금 받을 유저').setRequired(true))
    .addIntegerOption(option => option.setName('금액').setDescription('보낼 금액').setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`🤖 봇 로그인됨: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ 슬래시 명령어 등록 완료');
  } catch (error) {
    console.error('❌ 명령어 등록 실패:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === '잔액') {
    const userId = interaction.user.id;
    const balance = global.balances[userId] || 0;
    const embed = new EmbedBuilder()
      .setTitle('💰 현재 잔액')
      .setDescription(`<@${userId}>님의 잔액은 **${balance}원** 입니다.`)
      .setColor(0x00BFFF);
    await interaction.reply({ embeds: [embed] });
    await sendLog(client, '잔액 조회', userId, { 잔액: `${balance}원` });
  }

  if (commandName === '송금') {
    const senderId = interaction.user.id;
    const receiver = interaction.options.getUser('받는사람');
    const amount = interaction.options.getInteger('금액');

    if (receiver.bot) return interaction.reply({ content: '❌ 봇에게는 송금할 수 없습니다.', ephemeral: true });
    if ((global.balances[senderId] || 0) < amount) return interaction.reply({ content: '❌ 잔액이 부족합니다.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('💸 송금 확인')
      .addFields(
        { name: '보낸 사람', value: `<@${senderId}>`, inline: true },
        { name: '받는 사람', value: `<@${receiver.id}>`, inline: true },
        { name: '금액', value: `${amount}원`, inline: true }
      )
      .setFooter({ text: '아래 버튼으로 송금을 확정하거나 취소할 수 있어요.' })
      .setColor(0x00C09A);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_${senderId}_${receiver.id}_${amount}`).setLabel('✅ 송금하기').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${senderId}`).setLabel('❌ 취소하기').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
    await sendLog(client, '송금 요청', senderId, {
      받는사람: `<@${receiver.id}>`, 금액: `${amount}원`
    });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const [action, senderId, receiverId, amountStr] = interaction.customId.split('_');
  const amount = parseInt(amountStr);

  if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ 이 버튼은 당신이 사용할 수 없습니다.', ephemeral: true });

  if (action === 'confirm') {
    if ((global.balances[senderId] || 0) < amount) {
      return interaction.update({ content: '❌ 송금 실패: 잔액 부족', components: [], embeds: [] });
    }
    global.balances[senderId] -= amount;
    global.balances[receiverId] = (global.balances[receiverId] || 0) + amount;

    const embed = new EmbedBuilder()
      .setTitle('✅ 송금 완료')
      .addFields(
        { name: '보낸 사람', value: `<@${senderId}>`, inline: true },
        { name: '받는 사람', value: `<@${receiverId}>`, inline: true },
        { name: '금액', value: `${amount}원`, inline: true }
      )
      .setColor(0x5cd85c).setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
    await sendLog(client, '송금 확정', senderId, { 받는사람: `<@${receiverId}>`, 금액: `${amount}원` });
  }

  if (action === 'cancel') {
    await interaction.update({ content: '🚫 송금이 취소되었습니다.', components: [], embeds: [] });
    await sendLog(client, '송금 취소', senderId);
  }
});

app.listen(PORT, () => console.log(`✅ API 서버 실행 중: http://localhost:${PORT}`));
client.login(process.env.TOKEN);
