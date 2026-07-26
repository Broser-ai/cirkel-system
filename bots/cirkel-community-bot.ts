/**
 * Cirkel Community Bot — Modul 8
 *
 * Discord bot for the Cirkel circular-economy platform.
 *
 * Features:
 *   - Slash commands: /scan-stats, /min-impact, /rewards, /leaderboard
 *   - FAQ-channel AI assistant (Claude Sonnet, dansk system-prompt)
 *   - Per-user rate-limit (max 10 messages / user / rolling hour)
 *
 * Install:
 *   npm install discord.js@^14 @anthropic-ai/sdk @supabase/supabase-js dotenv
 *   npm install --save-dev typescript @types/node ts-node
 *
 * Required env:
 *   DISCORD_TOKEN
 *   DISCORD_CLIENT_ID
 *   DISCORD_GUILD_ID
 *   DISCORD_FAQ_CHANNEL_ID
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Run:
 *   ts-node bots/cirkel-community-bot.ts
 */

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  Partials,
  MessageFlags,
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DISCORD_FAQ_CHANNEL_ID',
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    // eslint-disable-next-line no-console
    console.error(`[cirkel-community-bot] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN as string;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID as string;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID as string;
const DISCORD_FAQ_CHANNEL_ID = process.env.DISCORD_FAQ_CHANNEL_ID as string;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, sliding window)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const userMessageLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const log = userMessageLog.get(userId) ?? [];
  const recent = log.filter((ts) => ts > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    userMessageLog.set(userId, recent);
    return true;
  }

  recent.push(now);
  userMessageLog.set(userId, recent);
  return false;
}

// Periodic cleanup so map does not grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [userId, log] of userMessageLog.entries()) {
    const recent = log.filter((ts) => ts > cutoff);
    if (recent.length === 0) userMessageLog.delete(userId);
    else userMessageLog.set(userId, recent);
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Helpers — Supabase queries
// ---------------------------------------------------------------------------

interface ScanStatsTotal {
  totalScans: number;
  totalCo2Kg: number;
  totalItems: number;
}

async function fetchScanStatsTotal(): Promise<ScanStatsTotal> {
  const { data, error } = await supabase
    .from('scans')
    .select('co2_kg, item_count');

  if (error) throw new Error(`scans query failed: ${error.message}`);

  const rows = data ?? [];
  const totalCo2Kg = rows.reduce((sum, r: any) => sum + Number(r.co2_kg ?? 0), 0);
  const totalItems = rows.reduce((sum, r: any) => sum + Number(r.item_count ?? 0), 0);

  return {
    totalScans: rows.length,
    totalCo2Kg,
    totalItems,
  };
}

interface UserImpact {
  userId: string;
  scans: number;
  co2Kg: number;
  items: number;
  rewardsClaimed: number;
}

async function fetchUserImpact(supabaseUserId: string): Promise<UserImpact> {
  const [{ data: scanRows, error: scanErr }, { data: rewardRows, error: rewardErr }] =
    await Promise.all([
      supabase
        .from('scans')
        .select('co2_kg, item_count')
        .eq('user_id', supabaseUserId),
      supabase
        .from('user_rewards')
        .select('id')
        .eq('user_id', supabaseUserId),
    ]);

  if (scanErr) throw new Error(`user scans query failed: ${scanErr.message}`);
  if (rewardErr) throw new Error(`user rewards query failed: ${rewardErr.message}`);

  const scans = scanRows ?? [];
  const co2Kg = scans.reduce((s, r: any) => s + Number(r.co2_kg ?? 0), 0);
  const items = scans.reduce((s, r: any) => s + Number(r.item_count ?? 0), 0);

  return {
    userId: supabaseUserId,
    scans: scans.length,
    co2Kg,
    items,
    rewardsClaimed: (rewardRows ?? []).length,
  };
}

async function lookupSupabaseUserId(discordId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('discord_links')
    .select('user_id')
    .eq('discord_id', discordId)
    .maybeSingle();

  if (error) throw new Error(`discord_links lookup failed: ${error.message}`);
  return (data?.user_id as string | undefined) ?? null;
}

interface Reward {
  id: string;
  title: string;
  description: string | null;
  cost_points: number;
  partner: string | null;
  active: boolean;
}

async function fetchTopActiveRewards(limit: number): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, title, description, cost_points, partner, active')
    .eq('active', true)
    .order('cost_points', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`rewards query failed: ${error.message}`);
  return (data ?? []) as Reward[];
}

interface LeaderboardRow {
  user_id: string;
  display_name: string | null;
  total_co2_kg: number;
  total_scans: number;
}

async function fetchLeaderboard(limit: number): Promise<LeaderboardRow[]> {
  // Prefer materialized view if available.
  const { data, error } = await supabase
    .from('leaderboard_view')
    .select('user_id, display_name, total_co2_kg, total_scans')
    .order('total_co2_kg', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`leaderboard query failed: ${error.message}`);
  return (data ?? []) as LeaderboardRow[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const numberFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 });

function fmtCo2(kg: number): string {
  if (kg >= 1000) return `${numberFmt.format(kg / 1000)} ton CO₂`;
  return `${numberFmt.format(kg)} kg CO₂`;
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('da-DK').format(n);
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('scan-stats')
    .setDescription('Vis total DK-impact på tværs af alle Cirkel-scans.'),
  new SlashCommandBuilder()
    .setName('min-impact')
    .setDescription('Vis dine egne Cirkel-KPI’er (kræver linket konto).'),
  new SlashCommandBuilder()
    .setName('rewards')
    .setDescription('Vis top 5 aktive rewards du kan indløse.'),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Vis top 10 brugere med højest CO₂-besparelse.'),
].map((c) => c.toJSON());

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  // eslint-disable-next-line no-console
  console.log('[cirkel-community-bot] Registering slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
    { body: commands },
  );
  // eslint-disable-next-line no-console
  console.log('[cirkel-community-bot] Slash commands registered.');
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleScanStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const stats = await fetchScanStatsTotal();
    const embed = new EmbedBuilder()
      .setTitle('Cirkel — total DK-impact')
      .setColor(0x2ecc71)
      .addFields(
        { name: 'Antal scans', value: fmtInt(stats.totalScans), inline: true },
        { name: 'Genanvendte items', value: fmtInt(stats.totalItems), inline: true },
        { name: 'CO₂ sparet', value: fmtCo2(stats.totalCo2Kg), inline: true },
      )
      .setFooter({ text: 'Kilde: Supabase · scans-tabellen' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[scan-stats]', err);
    await interaction.editReply(
      'Kunne ikke hente scan-stats lige nu. Prøv igen om lidt.',
    );
  }
}

async function handleMinImpact(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const supabaseUserId = await lookupSupabaseUserId(interaction.user.id);
    if (!supabaseUserId) {
      await interaction.editReply(
        'Din Discord-konto er ikke linket til en Cirkel-bruger endnu.\n' +
          'Log ind på app.cirkel.dk → Indstillinger → Discord for at linke.',
      );
      return;
    }
    const impact = await fetchUserImpact(supabaseUserId);
    const embed = new EmbedBuilder()
      .setTitle(`Din Cirkel-impact, ${interaction.user.username}`)
      .setColor(0x3498db)
      .addFields(
        { name: 'Dine scans', value: fmtInt(impact.scans), inline: true },
        { name: 'Items redders', value: fmtInt(impact.items), inline: true },
        { name: 'CO₂ sparet', value: fmtCo2(impact.co2Kg), inline: true },
        {
          name: 'Rewards indløst',
          value: fmtInt(impact.rewardsClaimed),
          inline: true,
        },
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[min-impact]', err);
    await interaction.editReply(
      'Kunne ikke hente din impact lige nu. Prøv igen om lidt.',
    );
  }
}

async function handleRewards(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const rewards = await fetchTopActiveRewards(5);
    if (rewards.length === 0) {
      await interaction.editReply('Ingen aktive rewards lige nu — kig forbi senere.');
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('Top 5 aktive rewards')
      .setColor(0xf1c40f)
      .setDescription(
        rewards
          .map((r, i) => {
            const partner = r.partner ? ` — ${r.partner}` : '';
            const desc = r.description ? `\n  ${r.description}` : '';
            return `**${i + 1}. ${r.title}**${partner}\n  Pris: ${fmtInt(
              r.cost_points,
            )} point${desc}`;
          })
          .join('\n\n'),
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rewards]', err);
    await interaction.editReply('Kunne ikke hente rewards lige nu. Prøv igen om lidt.');
  }
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const rows = await fetchLeaderboard(10);
    if (rows.length === 0) {
      await interaction.editReply('Leaderboardet er tomt. Bliv den første!');
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('Cirkel — top 10 brugere')
      .setColor(0x9b59b6)
      .setDescription(
        rows
          .map((r, i) => {
            const name = r.display_name ?? `Bruger ${r.user_id.slice(0, 8)}`;
            return `**${i + 1}. ${name}** — ${fmtCo2(
              Number(r.total_co2_kg ?? 0),
            )} · ${fmtInt(Number(r.total_scans ?? 0))} scans`;
          })
          .join('\n'),
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[leaderboard]', err);
    await interaction.editReply(
      'Kunne ikke hente leaderboardet lige nu. Prøv igen om lidt.',
    );
  }
}

// ---------------------------------------------------------------------------
// Claude FAQ handler
// ---------------------------------------------------------------------------

const FAQ_SYSTEM_PROMPT = `Du er Cirkel-Bot, en venlig og faglig assistent i Cirkel-fællesskabets Discord.

Cirkel er en dansk platform for cirkulær økonomi: genbrug, reparation, deling,
udlejning, upcycling og reduktion af affald. Målet er at hjælpe brugere i
Danmark med at træffe mere bæredygtige valg i hverdagen.

Regler for dine svar:
- Skriv altid på dansk, i et varmt, konkret og let forståeligt sprog.
- Hold svar korte: normalt 2–5 sætninger, aldrig mere end 8.
- Fokusér på cirkulær økonomi, bæredygtighed, genbrug, reparation, deling,
  Cirkel-appen og relevante danske ordninger (pant, storskrald, kommunal
  genbrug, DBA/Trendsales, reparationscaféer, mv.).
- Hvis spørgsmålet er off-topic (fx politik, medicinsk rådgivning, personlige
  data), sig venligt at du kun kan hjælpe med cirkulær økonomi og Cirkel-appen.
- Gæt aldrig på tal du ikke kender. Hvis du er usikker, sig det.
- Foreslå gerne næste skridt i Cirkel-appen (fx "scan varen i appen for at se
  CO₂-effekten") — men lov aldrig features du ikke ved eksisterer.
- Undgå emojis medmindre brugeren selv bruger dem.`;

async function handleFaqMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.channelId !== DISCORD_FAQ_CHANNEL_ID) return;

  const content = message.content?.trim();
  if (!content) return;

  if (isRateLimited(message.author.id)) {
    try {
      await message.reply(
        'Du har brugt din time-kvote (10 spørgsmål/time). Prøv igen senere.',
      );
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
      await message.channel.sendTyping();
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: FAQ_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) {
      await message.reply('Jeg fik desværre ikke et svar. Prøv at omformulere spørgsmålet.');
      return;
    }

    // Discord's hard limit is 2000 chars per message.
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 2000) {
      chunks.push(remaining.slice(0, 2000));
      remaining = remaining.slice(2000);
    }
    chunks.push(remaining);

    await message.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send(chunks[i]);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[faq]', err);
    try {
      await message.reply(
        'Jeg kunne ikke svare lige nu (teknisk fejl). Prøv igen om lidt.',
      );
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, (readyClient) => {
  // eslint-disable-next-line no-console
  console.log(`[cirkel-community-bot] Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction as ChatInputCommandInteraction;
  try {
    switch (cmd.commandName) {
      case 'scan-stats':
        await handleScanStats(cmd);
        break;
      case 'min-impact':
        await handleMinImpact(cmd);
        break;
      case 'rewards':
        await handleRewards(cmd);
        break;
      case 'leaderboard':
        await handleLeaderboard(cmd);
        break;
      default:
        await cmd.reply({
          content: 'Ukendt kommando.',
          flags: MessageFlags.Ephemeral,
        });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[interaction:${cmd.commandName}]`, err);
    const payload = {
      content: 'Der opstod en uventet fejl. Prøv igen om lidt.',
      flags: MessageFlags.Ephemeral,
    };
    if (cmd.deferred || cmd.replied) {
      await cmd.followUp(payload).catch(() => undefined);
    } else {
      await cmd.reply(payload).catch(() => undefined);
    }
  }
});

client.on(Events.MessageCreate, (msg) => {
  void handleFaqMessage(msg);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
}

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`[cirkel-community-bot] Received ${signal}, shutting down...`);
  client
    .destroy()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[shutdown] client.destroy error:', err);
    })
    .finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[cirkel-community-bot] Fatal boot error:', err);
  process.exit(1);
});
