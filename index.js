require('dotenv/config')
const {Client, IntentsBitField } = require('discord.js');
const { joinVoiceChannel, demuxProbe, createAudioPlayer, NoSubscriberBehavior, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const ytdl = require('ytdl-core-discord');
const { Readable } = require('stream');
const SpottyDL = require('spottydl');
const { resourceLimits } = require('worker_threads');


// Set up the Discord bot client
const client = new Client({intents:[
  IntentsBitField.Flags.Guilds,
  IntentsBitField.Flags.GuildMessages,
  IntentsBitField.Flags.MessageContent,
  IntentsBitField.Flags.GuildVoiceStates
]});

client.on('ready', () => {
  console.log('The bot is online')
})


// Set up the Spotify API client credentials
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET
});

// Set up the Spotify access token
let spotifyAccessToken = '';

// Log in to the Spotify API and retrieve an access token
spotifyApi.clientCredentialsGrant()
  .then((data) => {
    spotifyAccessToken = data.body.access_token;
    spotifyApi.setAccessToken(spotifyAccessToken);
  })
  .catch((error) => {
    console.log('Error retrieving Spotify access token:', error);
  });

// Set up the music queue
const queue = new Map();

// Define the 'play' command for the bot
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!play')) return;

  const query = message.content.slice(6).trim();

  // Search for tracks on Spotify
  const searchResults = await spotifyApi.searchTracks(query, { limit: 1, market: 'US' });

  if (!searchResults.body.tracks.items.length) {
    message.channel.send('No tracks found!');
    return;
  }

  const track = searchResults.body.tracks.items[0];
  // Play the track in the voice channel
  const connection = await joinVoiceChannel({
    channelId: message.member.voice.channelId,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
  });
  // const connection = await message.member.voice.channel.join()


  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log('The connection has entered the Ready state - ready to play audio!');
  });
  

  const serverQueue = queue.get(message.guild.id) || { songs: [] };
  serverQueue.songs.push(track);
  queue.set(message.guild.id, serverQueue);
  console.log(serverQueue.songs)

  if (serverQueue.songs.length === 1) {
    playSong(message.guild, connection, serverQueue.songs[0]);
  }

  // Send a message to the Discord channel confirming the track that is now playing
  message.channel.send(`Now playing: ${track.name} by ${track.artists[0].name}`);
});

async function playSong(guild, connection, song) {
  const player = createAudioPlayer({
    behaviours: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
  const stream = await getStreamFromSpotify(song);
  const resource = createAudioResource(stream);
  
  connection.subscribe(player);
  player.play(resource);

  // const dispatcher = connection.play(stream, { type: 'opus' });

  player.on( AudioPlayerStatus.Idle, () => {
    const serverQueue = queue.get(guild.id);
    serverQueue.songs.splice(0,1);
    console.log(serverQueue.songs)
    if (serverQueue.songs.length > 0) {
      playSong(guild, connection, serverQueue.songs[0]);
    } else {
      console.log("unplayable")
      connection.disconnect();
      queue.delete(guild.id);
    }
  })
  // dispatcher.on('finish', () => {
  //   const serverQueue = queue.get(guild.id);
  //   serverQueue.songs.shift();
  //   if (serverQueue.songs.length > 0) {
  //     playSong(guild, connection, serverQueue.songs[0]);
  //   } else {
  //     connection.disconnect();
  //     queue.delete(guild.id);
  //   }
  // });
}


async function getStreamFromSpotify(track) {
  const trackInfo = await spotifyApi.getTrack(track.id, { market: 'US' });
  // const trackPreviewUrl = trackInfo.body.preview_url;
  const trackurl = trackInfo.body.external_urls.spotify;
  let videoID = ""
  await SpottyDL.getTrack(trackurl)
    .then(async(results) => {
      videoID = results.id;
      // let track = await SpottyDL.downloadTrack(results, "output/")
      // console.log(track)
    })


  const stream = await ytdl("https://www.youtube.com/watch?v="+videoID, {
    filter: 'audioonly',
    highWaterMark: 1 << 25
  });

  return stream
  // if (!trackPreviewUrl) {
  //   const stream = new Readable();
  //   stream.push(null);
  //   return stream;
  // }

  // const stream = await ytdl(trackPreviewUrl, {
  //   filter: 'audioonly',
  //   opusEncoded: true,
  //   highWaterMark: 1 << 25
  // });
  
  // return stream;
}

// Log in to the Discord bot client
client.login(process.env.TOKEN);
