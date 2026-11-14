import { getVoiceConnection } from '@discordjs/voice';
import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Embeds } from '../utils/embedHelper.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Disconnects the client from the voice channel.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const connection = interaction.guildId && getVoiceConnection(interaction.guildId);

  if (!connection) {
    await interaction.reply({
      embeds: [Embeds.info('Not in Voice Channel', 'I was not in a voice channel.')],
    });
    return;
  }

  connection.destroy();
  await interaction.reply({
    embeds: [Embeds.success('Voice Channel Left', 'Successfully left the voice channel.')],
  });
}
