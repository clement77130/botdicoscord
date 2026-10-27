import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, ChannelType, TextChannel, GuildMember } from 'discord.js';
import { prisma } from '../moderation/logs';

export const data = new SlashCommandBuilder()
  .setName('embedcreator')
  .setDescription('Créer un embed personnalisé')
  .addSubcommand(subcommand =>
    subcommand
      .setName('simple')
      .setDescription('Créer un embed simple')
      .addStringOption(option =>
        option
          .setName('titre')
          .setDescription('Le titre de l\'embed')
          .setRequired(true))
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription('La description de l\'embed')
          .setRequired(true))
      .addStringOption(option =>
        option
          .setName('couleur')
          .setDescription('La couleur de l\'embed (en hexadécimal, ex: #FF0000)')
          .setRequired(true))
      .addStringOption(option =>
        option
          .setName('footer')
          .setDescription('Le texte en bas de l\'embed')
          .setRequired(true))
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Le salon où envoyer l\'embed')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('json')
      .setDescription('Créer un embed à partir d\'un JSON de Discohook')
      .addStringOption(option =>
        option
          .setName('json')
          .setDescription('Le JSON de l\'embed (depuis Discohook)')
          .setRequired(true))
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Le salon où envoyer l\'embed')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({
      content: 'Cette commande doit être utilisée dans un serveur.',
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();
  const targetChannel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;
  const guildData = await prisma.guild.findUnique({
    where: { id: interaction.guildId }
  });

  const moderationRoles = guildData?.moderationRoles ? JSON.parse(guildData.moderationRoles) as string[] : [];
  const member = interaction.member as GuildMember;
  
  const hasPermission = member.roles.cache.some((role) => 
    moderationRoles.includes(role.id)
  );

  if (!hasPermission) {
    return interaction.reply({
      content: "Vous n'avez pas la permission d'utiliser cette commande.",
      ephemeral: true
    });
  }

  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: 'Le salon cible doit être un salon textuel.',
      ephemeral: true
    });
  }

  if (subcommand === 'simple') {
    const titre = interaction.options.getString('titre', true);
    const description = interaction.options.getString('description', true);
    const couleur = interaction.options.getString('couleur', true);
    const footer = interaction.options.getString('footer', true);

    const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!colorRegex.test(couleur)) {
      return interaction.reply({
        content: 'La couleur doit être au format hexadécimal (ex: #FF0000)',
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(titre)
      .setDescription(description.replace(/\\n/g, '\n'))
      .setColor(couleur as `#${string}`)
      .setFooter({ text: footer })
      .setTimestamp();

    await targetChannel.send({ embeds: [embed] });
    await interaction.reply({ content: `L'embed a été envoyé dans ${targetChannel}`, ephemeral: true });
  } else if (subcommand === 'json') {
    try {
      const jsonString = interaction.options.getString('json', true);
      const jsonData = JSON.parse(jsonString);

      const embedData = Array.isArray(jsonData.embeds) ? jsonData.embeds[0] : jsonData;

      const embed = new EmbedBuilder();
      
      if (embedData.title) embed.setTitle(embedData.title);
      if (embedData.description) embed.setDescription(embedData.description);
      if (embedData.color) embed.setColor(embedData.color);
      if (embedData.footer?.text) embed.setFooter({ text: embedData.footer.text, iconURL: embedData.footer.icon_url });
      if (embedData.thumbnail?.url) embed.setThumbnail(embedData.thumbnail.url);
      if (embedData.image?.url) embed.setImage(embedData.image.url);
      if (embedData.author) embed.setAuthor({ name: embedData.author.name, iconURL: embedData.author.icon_url, url: embedData.author.url });
      if (embedData.fields) embed.addFields(embedData.fields);
      if (embedData.timestamp) embed.setTimestamp(new Date(embedData.timestamp));

      await targetChannel.send({ embeds: [embed] });
      await interaction.reply({ content: `L'embed a été envoyé dans ${targetChannel}`, ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: 'Erreur lors de la lecture du JSON. Assurez-vous qu\'il est valide et au bon format.\n\nPour créer un embed facilement :\n1. Allez sur https://discohook.org\n2. Créez votre embed\n3. Cliquez sur "JSON Data" en haut\n4. Copiez le JSON et utilisez-le avec cette commande',
        ephemeral: true
      });
    }
  }
} 