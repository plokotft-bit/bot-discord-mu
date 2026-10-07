const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const DATA_FILE = path.join(__dirname, "bosses.json");

const bosses = new Map();
const timers = new Map();

/*
====================================================
CARREGAR BOSSES
====================================================
*/

function loadBosses() {
  if (!fs.existsSync(DATA_FILE)) return;

  try {
    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    for (const boss of data) {
      bosses.set(boss.id, boss);
    }

    console.log(
      `${bosses.size} boss(es) carregado(s).`
    );
  } catch (error) {
    console.error(
      "Erro ao carregar bosses:",
      error
    );
  }
}

/*
====================================================
SALVAR BOSSES
====================================================
*/

function saveBosses() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        [...bosses.values()],
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "Erro ao salvar bosses:",
      error
    );
  }
}

/*
====================================================
FORMATAR DATA
====================================================
*/

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString(
    "pt-BR",
    {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }
  );
}

/*
====================================================
VALIDAR TEMPO DE RESPAWN
====================================================
*/

function parseDuration(value) {
  const match = value.match(
    /^(\d+):([0-5]\d)$/
  );

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    hours > 168 ||
    (hours === 168 && minutes > 0)
  ) {
    return null;
  }

  if (hours === 0 && minutes === 0) {
    return null;
  }

  return (
    (hours * 60 + minutes) *
    60 *
    1000
  );
}

/*
====================================================
INTERPRETAR HORA DA MORTE
====================================================
*/

function parseDeathTime(value) {
  const match = value.match(
    /^([01]\d|2[0-3]):([0-5]\d)$/
  );

  if (!match) return null;

  const now = new Date();

  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).formatToParts(now);

  const get = (type) =>
    parts.find(
      (p) => p.type === type
    ).value;

  const date =
    `${get("year")}-${get("month")}-${get("day")}`;

  const [hours, minutes] =
    value.split(":").map(Number);

  const target = new Date(
    `${date}T${String(hours).padStart(
      2,
      "0"
    )}:${String(minutes).padStart(
      2,
      "0"
    )}:00-03:00`
  );

  /*
  Se a hora informada for no futuro,
  considera que foi ontem.
  */

  if (
    target.getTime() >
    now.getTime() + 60000
  ) {
    target.setTime(
      target.getTime() -
        24 * 60 * 60 * 1000
    );
  }

  return target.getTime();
}

/*
====================================================
COMANDOS
====================================================
*/

function createCommands() {
  return [
    new SlashCommandBuilder()
      .setName("bossmorreu")
      .setDescription(
        "Registra a morte de um boss e agenda os alertas"
      )

      .addStringOption((option) =>
        option
          .setName("boss")
          .setDescription(
            "Nome do boss"
          )
          .setRequired(true)
          .setMaxLength(60)
      )

      .addStringOption((option) =>
        option
          .setName("hora")
          .setDescription(
            "Hora da morte, formato HH:MM"
          )
          .setRequired(true)
      )

      .addStringOption((option) =>
        option
          .setName("respawn")
          .setDescription(
            "Tempo até nascer, formato H:MM (ex.: 8:45)"
          )
          .setRequired(true)
      )

      .addStringOption((option) =>
        option
          .setName("servidor")
          .setDescription(
            "Servidor onde o boss foi morto"
          )
          .setRequired(true)
          .setMaxLength(50)
      ),

    new SlashCommandBuilder()
      .setName("bosses")
      .setDescription(
        "Mostra os bosses que ainda vão nascer"
      ),

    new SlashCommandBuilder()
      .setName("bosscancelar")
      .setDescription(
        "Cancela o registro de um boss"
      )

      .addStringOption((option) =>
        option
          .setName("boss")
          .setDescription(
            "Nome do boss registrado"
          )
          .setRequired(true)
          .setAutocomplete(true)
      ),
  ].map((command) =>
    command.toJSON()
  );
}

/*
====================================================
ENVIAR ALERTA
====================================================
*/

async function sendBossAlert(
  boss,
  alert
) {
  try {
    const channel =
      await client.channels.fetch(
        boss.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      console.error(
        `Canal não encontrado para ${boss.name}`
      );

      return;
    }

    let title;
    let color;

    if (
      alert.offset ===
      10 * 60 * 1000
    ) {
      title =
        "⚠️ FALTAM 10 MINUTOS!";
      color = 0xf1c40f;
    } else if (
      alert.offset ===
      5 * 60 * 1000
    ) {
      title =
        "🔥 FALTAM 5 MINUTOS!";
      color = 0xe67e22;
    } else {
      title =
        "👑 O BOSS ESTÁ VIVO!";
      color = 0x2ecc71;
    }

    await channel.send({
      /*
      Menciona @everyone
      */
      content: "@everyone",

      allowedMentions: {
        parse: ["everyone"],
      },

      embeds: [
        new EmbedBuilder()
          .setColor(color)

          .setTitle(title)

          .setDescription(
            `🐉 **${boss.name}**\n\n` +
            `🌐 Servidor: **${
              boss.server ||
              "Não informado"
            }**\n` +
            `☠️ Morto às: **${boss.deathTime}**\n` +
            `👑 Respawn previsto: **${formatDate(
              boss.respawnAt
            )}**\n\n` +
            (
              alert.offset === 0
                ? "⚔️ **Boa caçada!**"
                : "⏰ **Preparem-se!**"
            )
          )

          .setTimestamp(),
      ],
    });

    console.log(
      `Alerta enviado: ${boss.name} - ${title}`
    );
  } catch (error) {
    console.error(
      `Erro ao enviar alerta de ${boss.name}:`,
      error
    );
  }
}

/*
====================================================
REMOVER BOSS
====================================================
*/

function removeBoss(bossId) {
  /*
  Cancela qualquer timer restante
  */

  const bossTimers =
    timers.get(bossId) || [];

  for (const timer of bossTimers) {
    clearTimeout(timer);
  }

  timers.delete(bossId);

  /*
  Remove o boss da memória
  */

  bosses.delete(bossId);

  /*
  Salva o arquivo atualizado
  */

  saveBosses();

  console.log(
    `Boss removido dos programados: ${bossId}`
  );
}

/*
====================================================
AGENDAR ALERTAS
====================================================
*/

function scheduleBoss(boss) {
  /*
  Cancela timers antigos desse boss
  */

  const oldTimers =
    timers.get(boss.id) || [];

  for (const timer of oldTimers) {
    clearTimeout(timer);
  }

  timers.delete(boss.id);

  const newTimers = [];
  const now = Date.now();

  const alerts = [
    {
      offset: 10 * 60 * 1000,
      type: "10min",
    },
    {
      offset: 5 * 60 * 1000,
      type: "5min",
    },
    {
      offset: 0,
      type: "alive",
    },
  ];

  /*
  Agenda cada alerta
  */

  for (const alert of alerts) {
    const alertTime =
      boss.respawnAt -
      alert.offset;

    const delay =
      alertTime - now;

    /*
    Se já passou o horário,
    não agenda esse alerta.
    */

    if (delay <= 0) {
      continue;
    }

    const timer = setTimeout(
      async () => {
        /*
        Verifica se o boss ainda existe.
        */

        if (!bosses.has(boss.id)) {
          return;
        }

        await sendBossAlert(
          boss,
          alert
        );

        /*
        ÚLTIMO ALERTA:
        o boss nasceu, então
        remove dos programados.
        */

        if (
          alert.type === "alive"
        ) {
          removeBoss(boss.id);
        }
      },
      delay
    );

    newTimers.push(timer);
  }

  /*
  Guarda os timers
  */

  timers.set(
    boss.id,
    newTimers
  );

  console.log(
    `Alertas programados para ${boss.name} - ${formatDate(
      boss.respawnAt
    )}`
  );
}

/*
====================================================
LIMPAR BOSSES QUE JÁ NASCERAM
====================================================
*/

function cleanupExpiredBosses() {
  const now = Date.now();

  let removed = 0;

  for (const boss of bosses.values()) {
    /*
    Se o horário de nascimento já passou,
    esse boss não precisa mais aparecer.
    */

    if (boss.respawnAt <= now) {
      bosses.delete(boss.id);

      const bossTimers =
        timers.get(boss.id) || [];

      for (const timer of bossTimers) {
        clearTimeout(timer);
      }

      timers.delete(boss.id);

      removed++;
    }
  }

  if (removed > 0) {
    saveBosses();

    console.log(
      `${removed} boss(es) expirado(s) removido(s).`
    );
  }
}

/*
====================================================
BOT ONLINE
====================================================
*/

client.once(
  "ready",
  async () => {
    console.log(
      `Bot conectado como ${client.user.tag}`
    );

    /*
    Carrega os bosses salvos
    */

    loadBosses();

    /*
    Remove bosses cujo respawn
    já passou.
    */

    cleanupExpiredBosses();

    /*
    Agenda os bosses que ainda
    estão aguardando nascimento.
    */

    for (
      const boss of bosses.values()
    ) {
      scheduleBoss(boss);
    }

    console.log(
      "Todos os alertas foram verificados."
    );
  }
);

/*
====================================================
INTERAÇÕES
====================================================
*/

client.on(
  "interactionCreate",
  async (interaction) => {
    try {
      /*
      ================================================
      AUTOCOMPLETE
      ================================================
      */

      if (
        interaction.isAutocomplete()
      ) {
        const focused =
          interaction.options
            .getFocused()
            .toLowerCase();

        const choices =
          [...bosses.values()]
            .filter(
              (boss) =>
                boss.guildId ===
                interaction.guildId
            )
            .map(
              (boss) =>
                boss.name
            )
            .filter(
              (name) =>
                name
                  .toLowerCase()
                  .includes(
                    focused
                  )
            )
            .slice(0, 25)
            .map(
              (name) => ({
                name,
                value: name,
              })
            );

        await interaction.respond(
          choices
        );

        return;
      }

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      /*
      ================================================
      /bossmorreu
      ================================================
      */

      if (
        interaction.commandName ===
        "bossmorreu"
      ) {
        const name =
          interaction.options
            .getString(
              "boss",
              true
            )
            .trim();

        const deathText =
          interaction.options
            .getString(
              "hora",
              true
            );

        const durationText =
          interaction.options
            .getString(
              "respawn",
              true
            );

        const server =
          interaction.options
            .getString(
              "servidor",
              true
            )
            .trim();

        const deathAt =
          parseDeathTime(
            deathText
          );

        const duration =
          parseDuration(
            durationText
          );

        if (
          !deathAt ||
          !duration
        ) {
          await interaction.reply({
            content:
              "❌ Confira os formatos. Hora: `13:30`; respawn: `8:45`.",
            ephemeral: true,
          });

          return;
        }

        const respawnAt =
          deathAt + duration;

        const id =
          `${interaction.guildId}:${name.toLowerCase()}`;

        const boss = {
          id,
          name,
          server,

          guildId:
            interaction.guildId,

          channelId:
            interaction.channelId,

          userId:
            interaction.user.id,

          deathTime:
            deathText,

          deathAt,

          duration,

          respawnAt,
        };

        /*
        Salva o boss
        */

        bosses.set(
          id,
          boss
        );

        saveBosses();

        /*
        Agenda os alertas
        */

        scheduleBoss(
          boss
        );

        /*
        Confirmação
        */

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )

              .setTitle(
                `🐉 ${name.toUpperCase()} — REGISTRADO`
              )

              .setDescription(
                `🌐 Servidor: **${server}**\n` +
                `☠️ Morte: **${deathText}**\n` +
                `⏳ Respawn: **${durationText}**\n` +
                `👑 Nascerá aproximadamente: **${formatDate(
                  respawnAt
                )}**\n\n` +
                `⚠️ Aviso de 10 minutos: **${formatDate(
                  respawnAt -
                    600000
                )}**\n` +
                `🔥 Aviso de 5 minutos: **${formatDate(
                  respawnAt -
                    300000
                )}`
              )

              .setFooter({
                text:
                  `Registrado por ${interaction.user.username}`,
              }),
          ],
        });

        return;
      }

      /*
      ================================================
      /bosses
      ================================================
      */

      if (
        interaction.commandName ===
        "bosses"
      ) {
        /*
        Primeiro remove qualquer boss
        cujo horário já passou.
        */

        cleanupExpiredBosses();

        const list =
          [...bosses.values()]
            .filter(
              (boss) =>
                boss.guildId ===
                interaction.guildId
            )
            .sort(
              (a, b) =>
                a.respawnAt -
                b.respawnAt
            );

        if (
          list.length === 0
        ) {
          await interaction.reply(
            "✅ Nenhum boss aguardando respawn no momento."
          );

          return;
        }

        const description =
          list
            .map(
              (boss) =>
                `🐉 **${boss.name}**\n` +
                `🌐 Servidor: **${
                  boss.server ||
                  "Não informado"
                }**\n` +
                `👑 Respawn: **${formatDate(
                  boss.respawnAt
                )}**`
            )
            .join(
              "\n\n"
            );

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )

              .setTitle(
                "🐉 Bosses aguardando respawn"
              )

              .setDescription(
                description
              ),
          ],
        });

        return;
      }

      /*
      ================================================
      /bosscancelar
      ================================================
      */

      if (
        interaction.commandName ===
        "bosscancelar"
      ) {
        const name =
          interaction.options
            .getString(
              "boss",
              true
            );

        const id =
          `${interaction.guildId}:${name.toLowerCase()}`;

        const boss =
          bosses.get(id);

        if (!boss) {
          await interaction.reply({
            content:
              "❌ Não encontrei esse boss registrado neste servidor.",
            ephemeral: true,
          });

          return;
        }

        /*
        Cancela timers
        */

        const bossTimers =
          timers.get(id) || [];

        for (
          const timer of bossTimers
        ) {
          clearTimeout(
            timer
          );
        }

        /*
        Remove
        */

        timers.delete(id);

        bosses.delete(id);

        saveBosses();

        await interaction.reply(
          `✅ Registro de **${boss.name}** cancelado.`
        );

        return;
      }
    } catch (error) {
      console.error(
        error
      );

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content:
              "Ocorreu um erro. Confira o terminal para mais detalhes.",
            ephemeral: true,
          })
          .catch(
            () => {}
          );
      }
    }
  }
);

/*
====================================================
INICIAR BOT
====================================================
*/

async function main() {
  if (
    !process.env.DISCORD_TOKEN ||
    !process.env.CLIENT_ID
  ) {
    console.error(
      "Configure DISCORD_TOKEN e CLIENT_ID no arquivo .env"
    );

    process.exit(
      1
    );
  }

  const rest =
    new REST({
      version: "10",
    }).setToken(
      process.env.DISCORD_TOKEN
    );

  await rest.put(
    Routes.applicationCommands(
      process.env.CLIENT_ID
    ),
    {
      body:
        createCommands(),
    }
  );

  console.log(
    "Comandos do Discord registrados."
  );

  await client.login(
    process.env.DISCORD_TOKEN
  );
}

main().catch(
  console.error
);