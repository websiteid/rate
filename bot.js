const { Telegraf, Markup, session } = require('telegraf');
const crypto = require('crypto');

const userPapCooldown = new Map();
const PAP_COOLDOWN_MS = 10 * 60 * 1000;
const PUBLIC_CHANNEL_ID = '-1002857800900';
const BOT_TOKEN = '7524016177:AAFbiGOiSNTQSNpuApObS44aq32pteQrcuI';
const ADMIN_ID = 6468926488;

const bot = new Telegraf(BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

const mediaStore = new Map();

function generateToken(length = 4) {
  return crypto.randomBytes(length).toString('hex');
}

bot.start(async (ctx) => {
  try {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      'Selamat datang! Pilih opsi:',
      Markup.inlineKeyboard([
        [Markup.button.callback('📊 Rate Pap', 'RATE_PAP')],
        [Markup.button.callback('📸 Kirim Pap', 'KIRIM_PAP')],
      ])
    );
  } catch (err) {
    console.error('Start error:', err);
  }
});

bot.action('KIRIM_PAP', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    console.warn('Gagal jawab callback (KIRIM_PAP):', err.description);
  }

  try {
    await ctx.editMessageText(
      'Ingin kirim pap sebagai?',
      Markup.inlineKeyboard([
        [Markup.button.callback('🙈 Anonim', 'KIRIM_ANON')],
        [Markup.button.callback('🪪 Identitas', 'KIRIM_ID')],
      ])
    );
  } catch (err) {
    console.warn('Edit message gagal:', err.description);
  }
});

bot.action('KIRIM_ANON', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    console.warn('Gagal jawab callback (KIRIM_ANON):', err.description);
  }

  ctx.session.kirimPap = { mode: 'Anonim', status: 'menunggu_media' };
  await ctx.editMessageText('✅ Kamu kirim sebagai: *Anonim*\nSekarang kirim media-nya.', { parse_mode: 'Markdown' });
});

bot.action('KIRIM_ID', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    console.warn('Gagal jawab callback (KIRIM_ID):', err.description);
  }

  const username = ctx.from.username ? `@${ctx.from.username}` : 'Tanpa Username';
  ctx.session.kirimPap = { mode: username, status: 'menunggu_media' };
  await ctx.editMessageText(`✅ Kamu kirim sebagai: *${username}*\nSekarang kirim media-nya.`, { parse_mode: 'Markdown' });
});

bot.on(['photo', 'document', 'video'], async (ctx) => {
  const session = ctx.session.kirimPap;
  const now = Date.now();
  const lastSent = userPapCooldown.get(ctx.from.id) || 0;

  if (now - lastSent < PAP_COOLDOWN_MS) {
    const sisa = Math.ceil((PAP_COOLDOWN_MS - (now - lastSent)) / 60000);
    return ctx.reply(`⏳ Kamu hanya bisa kirim pap setiap 10 menit.\nSilakan coba lagi dalam ${sisa} menit.`);
  }

  if (!session || session.status !== 'menunggu_media') {
    return ctx.reply('⚠️ Pilih dulu menu "📸 Kirim Pap".');
  }

  let file, fileType;
  if (ctx.message.photo) {
    file = ctx.message.photo.pop();
    fileType = 'photo';
  } else if (ctx.message.video) {
    file = ctx.message.video;
    fileType = 'video';
  } else if (ctx.message.document) {
    file = ctx.message.document;
    fileType = 'document';
  }

  if (!file?.file_id) return ctx.reply('❌ Gagal membaca file. Coba lagi.');

  const token = generateToken();
  session.token = token;
  session.status = 'selesai';

  mediaStore.set(token, {
    fileId: file.file_id,
    fileType,
    mode: session.mode,
    from: ctx.from.id,
    views: 0,
    maxViews: Infinity,
    caption: ctx.message.caption || '', // ✅ simpan caption
  });

  userPapCooldown.set(ctx.from.id, now);

  await ctx.reply('✅ Media diterima! Token sudah dikirim ke admin.');

  await bot.telegram.sendMessage(
    ADMIN_ID,
    `📥 Pap baru!\n👤 Dari: ${ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name}\n🔐 Token: \`${token}\``,
    { parse_mode: 'Markdown' }
  );

  await bot.telegram.sendMessage(
    PUBLIC_CHANNEL_ID,
    `📸 Pap baru masuk!\n🔐 Token: <code>${token}</code>\n📝 Kirim token ini ke bot : @rate_seme_uke_bot`,
    { parse_mode: 'HTML' }
  );
});

bot.action('RATE_PAP', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    console.warn('Gagal jawab callback (RATE_PAP):', err.description);
  }

  ctx.session.rating = { stage: 'menunggu_token' };
  await ctx.editMessageText('🔢 Masukkan token pap yang ingin kamu nilai:');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const rating = ctx.session.rating;

  if (text.toLowerCase() === '/help') {
    const helpMessage = `
🤖 *Bantuan Bot*

📸 /start - Mulai bot dan tampilkan menu utama  
📩 /help - Tampilkan pesan bantuan ini  
📸 Kirim Pap - Kirim media secara anonim atau dengan identitas  
📊 Rate Pap - Beri rating pada pap dengan token yang diberikan admin  

➡️ Gunakan tombol yang tersedia untuk navigasi.
    `;
    return ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }

  if (rating && rating.stage === 'menunggu_token') {
    const token = text;
    const data = mediaStore.get(token);

    if (!data) return ctx.reply('❌ Token tidak valid atau sudah habis.');

    const { fileId, fileType, mode, from, views, maxViews, caption: userCaption } = data;

    ctx.session.ratedTokens = ctx.session.ratedTokens || [];
    if (ctx.session.ratedTokens.includes(token)) {
      return ctx.reply('⚠️ Kamu sudah menilai pap ini.');
    }

    const captionPrefix = mode.startsWith('@')
      ? `📸 Pap oleh: [${mode}](https://t.me/${mode.slice(1)})`
      : `📸 Pap oleh: *${mode}*`;

    const captionText = userCaption ? `\n📝 Catatan: ${userCaption}` : '';
    const fullCaption = captionPrefix + captionText;

    try {
      let msg;
      if (fileType === 'document') {
        msg = await ctx.replyWithDocument(fileId, { caption: fullCaption, parse_mode: 'Markdown' });
      } else if (fileType === 'photo') {
        msg = await ctx.replyWithPhoto(fileId, { caption: fullCaption, parse_mode: 'Markdown' });
      } else if (fileType === 'video') {
        msg = await ctx.replyWithVideo(fileId, { caption: fullCaption, parse_mode: 'Markdown' });
      }

      setTimeout(() => {
        ctx.deleteMessage(msg.message_id).catch(() => {});
      }, 5000);

      data.views++;
      if (data.views >= maxViews) {
        mediaStore.delete(token);
      } else {
        mediaStore.set(token, data);
      }

      ctx.session.rating = { stage: 'menunggu_rating', token, from };
      ctx.session.ratedTokens.push(token);

      await ctx.reply(`⏳ Foto ini akan dihapus dalam 5 detik.\nToken ini tersisa ${maxViews - data.views}x.`);

      const buttons = Array.from({ length: 10 }, (_, i) =>
        Markup.button.callback(`${i + 1}`, `RATE_${i + 1}`)
      );

      await ctx.reply(
        '📝 Beri rating:',
        Markup.inlineKeyboard([buttons.slice(0, 5), buttons.slice(5)])
      );
    } catch (err) {
      console.error('Gagal kirim media:', err);
      return ctx.reply('❌ Gagal menampilkan media.');
    }

    return;
  }

  ctx.reply('⚠️ Perintah tidak dikenali. Ketik /help untuk daftar perintah yang tersedia.');
});

bot.action(/^RATE_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    console.warn('Gagal jawab callback (RATE_X):', err.description);
  }

  const ratingValue = parseInt(ctx.match[1]);
  const sessionRating = ctx.session.rating;

  if (!sessionRating || sessionRating.stage !== 'menunggu_rating') {
    return ctx.reply('⚠️ Tidak ada sesi rating yang aktif.');
  }

  const token = sessionRating.token;
  const originalSenderId = sessionRating.from;

  if (ctx.from.id === originalSenderId) {
    return ctx.reply('⚠️ Kamu tidak bisa menilai pap kamu sendiri.');
  }

  delete ctx.session.rating;

  const rater = ctx.from.username
    ? `@${ctx.from.username}`
    : `${ctx.from.first_name || 'Pengguna'}`;

  await ctx.reply(`✅ Terima kasih! Kamu memberi rating ${ratingValue}/10.`);

  try {
    await bot.telegram.sendMessage(
      originalSenderId,
      `📨 Pap kamu telah dinilai!\n⭐ Rating: *${ratingValue}/10*\n👤 Oleh: ${rater}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.warn(`Gagal kirim pesan ke pengirim asli (${originalSenderId}):`, err.description);
  }
});

bot.command('report', (ctx) => {
  const parts = ctx.message.text.split(' ');
  const token = parts[1];

  if (!token) return ctx.reply('⚠️ Gunakan format: /report TOKEN');
  if (!mediaStore.has(token)) return ctx.reply('❌ Token tidak ditemukan.');

  bot.telegram.sendMessage(
    ADMIN_ID,
    `🚨 *Laporan Penyalahgunaan*\nToken: \`${token}\`\nDilaporkan oleh: ${ctx.from.username || ctx.from.first_name}`,
    { parse_mode: 'Markdown' }
  );

  ctx.reply('✅ Laporan kamu telah dikirim ke admin.');
});

bot.launch();
console.log('🤖 Bot aktif!');
