require('dotenv/config')
const {Client, IntentsBitField } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, NoSubscriberBehavior, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
// const ytdl = require('ytdl-core-discord');
const { Readable } = require('stream');
const SpottyDL = require('spottydl');
// const { resourceLimits } = require('worker_threads');
const play = require('play-dl');


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
const player = createAudioPlayer({
    behaviours: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
// Define the 'play' command for the bot
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!play')) return;
  let track = null;
  const query = message.content.slice(6).trim();

  // Search for tracks on Spotify
  if(query.startsWith('https://')){
    const trackid = query.split('?')[0].split('/').pop();
    const searchResults = await spotifyApi.getTrack(trackid, {market: "SG"})
    track = searchResults.body;
  }

  else {const searchResults = await spotifyApi.searchTracks(query, { limit: 1, market: "SG" });

    if (!searchResults.body.tracks.items.length) {
      message.channel.send('No tracks found!');
      return;
    }

    track = searchResults.body.tracks.items[0];
  }
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
  // console.log(serverQueue.songs)

  if (serverQueue.songs.length === 1) {
    playSong(message, connection, serverQueue.songs[0]);
  }

  // Send a message to the Discord channel confirming the track that is now playing
  if (serverQueue.songs.length > 1) message.channel.send(`Added to Queue: ${track.name} by ${track.artists[0].name}`);
});


client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!stop')) return;
  try {
  const connection = getVoiceConnection(message.guild.id);
  connection.destroy();
  queue.delete(message.guild.id);}
  catch(e) {
    console.log('No active connections')
  }
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!next')) return;
  const connection = getVoiceConnection(message.guild.id);
  const serverQueue = queue.get(message.guild.id);
  // if (serverQueue.songs.length > 0) serverQueue.songs.splice(0,1);
  serverQueue.songs.shift();
  if (serverQueue.songs.length > 0) {
    playSong(message, connection, serverQueue.songs[0]);
  } else {
    connection.destroy();
    queue.delete(message.guild.id);
    message.channel.send('No more songs to play.')
  }
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!pause')) return;
  player.pause()
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!unpause')) return;
  player.unpause()
});


async function playSong(message, connection, song) {
  
  const stream = await getStreamFromSpotify(song);
  const resource = createAudioResource(stream.stream);
  player.play(resource);
  connection.subscribe(player);

  player.on( AudioPlayerStatus.Idle, () => {
    const serverQueue = queue.get(message.guild.id);
    try{
    serverQueue.song.shift();
    if (serverQueue.songs.length > 0) {
      playSong(message, connection, serverQueue.songs[0]);
    } else {
      setTimeout(() => connection.destroy(), 5_000);
      queue.delete(message.guild.id);
    }}
    catch(e) {
      console.log("serverQueue.songs is undefined")
    }
  })
  console.log(song)
  message.channel.send(`Now playing: ${song.name} by ${song.artists[0].name}`);
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

  const stream = await play.stream("https://www.youtube.com/watch?v="+videoID, {
    discordPlayerCompatibility: true,
    quality: 2,
  })

  return stream
}

// Log in to the Discord bot client
client.login(process.env.TOKEN);
