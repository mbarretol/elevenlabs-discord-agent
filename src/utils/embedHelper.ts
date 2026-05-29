import { ColorResolvable, EmbedBuilder } from 'discord.js';

type PresetType = 'success' | 'error' | 'info';

const presetColors: Record<PresetType, ColorResolvable> = {
  success: 'Green',
  error: 'Red',
  info: 'Blue',
};

function createEmbed(
  title: string,
  description: string | undefined,
  type: PresetType
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(presetColors[type]).setTitle(title).setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

export const Embeds = {
  success: (title: string, description?: string) => createEmbed(title, description, 'success'),
  error: (title: string, description?: string) => createEmbed(title, description, 'error'),
  info: (title: string, description?: string) => createEmbed(title, description, 'info'),
};
