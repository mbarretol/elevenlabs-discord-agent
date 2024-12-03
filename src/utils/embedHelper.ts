import { ColorResolvable, EmbedBuilder } from 'discord.js';

type PresetType = 'success' | 'error' | 'info' | 'warning';

const presetColors: Record<PresetType, ColorResolvable> = {
  success: 'Green',
  error: 'Red',
  info: 'Blue',
  warning: 'Yellow',
};

/**
 * Creates an embed message.
 * @param {string} title - The title of the embed.
 * @param {string} [description] - The description of the embed.
 * @param {PresetType} [type] - The preset type for the embed color.
 * @param {ColorResolvable} [color] - Custom color for the embed.
 * @returns {EmbedBuilder} The created embed builder instance.
 */
function createEmbed(
  title: string,
  description?: string,
  type?: PresetType,
  color?: ColorResolvable
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(type ? presetColors[type] : color || 0x0099ff)
    .setTitle(title)
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

export const Embeds = {
  success: (title: string, description?: string) => createEmbed(title, description, 'success'),
  error: (title: string, description?: string) => createEmbed(title, description, 'error'),
  info: (title: string, description?: string) => createEmbed(title, description, 'info'),
  warning: (title: string, description?: string) => createEmbed(title, description, 'warning'),
};
