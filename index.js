require('dotenv/config');
// const WebSocket = require('ws');
const {Client, IntentsBitField } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, NoSubscriberBehavior, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const { Readable } = require('stream');
const SpottyDL = require('spottydl');
const play = require('play-dl');
var http = require('http'); 
const express = require("express");
const app = express();
const server = app.listen(8080);
server.keepAliveTimeout = 61 * 1000;

// const io = new WebSocket.Server({ noServer: true });
// global.io = new WebSocket.Server({ noServer: true });

// Set up the Discord bot client
const client = new Client({intents:[
  IntentsBitField.Flags.Guilds,
  IntentsBitField.Flags.GuildMessages,
  IntentsBitField.Flags.MessageContent,
  IntentsBitField.Flags.GuildVoiceStates
]});

client.on('ready', () => {
  console.log('The bot is online'); 
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
    console.log('Access token set')
  })
  .catch((error) => {
    console.log('Error retrieving Spotify access token:', error);
  });

function refreshToken() {spotifyApi.clientCredentialsGrant()
  .then((data) => {
    spotifyAccessToken = data.body.access_token;
    spotifyApi.setRefreshToken(spotifyAccessToken);
    spotifyApi.setAccessToken(spotifyAccessToken);
    console.log('Refresh token set')
  })
  .catch((error) => {
    console.log('Error retrieving Spotify access token:', error);
  });
};

tokenRefreshInterval = setInterval(refreshToken, 1000 * 60 * 14);

// Set up the music queue
const queue = new Map();

// Define the 'play' command for the bot

const autoShuffle = true;
let audioPlayerError = false;
client.on('messageCreate', async (message) => {
  if(!message.content.startsWith('!autoshuffle')) return;
  if (autoShuffle===true) {
    autoShuffle=false;
    message.channel.send('Auto shuffle disabled');
  }
  else if (autoShuffle===false) {
    autoShuffle=true;
    message.channel.send('Auto shuffle enabled');
  }
})

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!play')) return;
  let track = [];
  let playlistName="";
  const query = message.content.slice(6).trim();
  try {
  // Search for tracks on Spotify
  if(query.startsWith('https://')){
    const urlArr = query.split('?')[0].split('/');
    const trackid = urlArr.pop();
    const linkType = urlArr.pop();
    if (linkType == "track") {
    const searchResults = await spotifyApi.getTrack(trackid, {market: "SG"});
    track.push(searchResults.body);}
    else if (linkType == "playlist") {
      const searchResults = await spotifyApi.getPlaylistTracks(trackid, {market: "SG"});
      const playlist = await spotifyApi.getPlaylist(trackid, {market: "SG"});
      playlistName=playlist.body.name;
      if(autoShuffle===true) {
        shuffle(searchResults.body.items);
        message.channel.send("Auto shuffle is enabled by default. Use '!autoshuffle' to turn off. This will only take effect when you stop and play the playlist again.")
      }
      searchResults.body.items.forEach(item => track.push(item.track))
    }
  }

  else {const searchResults = await spotifyApi.searchTracks(query, { limit: 1, market: "SG" });

    if (!searchResults.body.tracks.items.length) {
      message.channel.send('No tracks found!');
      return;
    }

    track.push(searchResults.body.tracks.items[0]);
    
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
  track.forEach(t=>serverQueue.songs.push(t))
  // serverQueue.songs.push(track);
  queue.set(message.guild.id, serverQueue);

  if (serverQueue.songs.length == track.length && playlistName!=="") {
    playSong(message, connection, serverQueue.songs[0]);
    message.channel.send(`Added playlist "${playlistName}" to Queue`);
  }
  else if (serverQueue.songs.length === 1) {
    playSong(message, connection, serverQueue.songs[0]);
  }
  else if (serverQueue.songs.length > 1 && playlistName!=="") {
    message.channel.send(`Added playlist "${playlistName}" to Queue`);
  }
  // Send a message to the Discord channel confirming the track that is now playing
  else if (serverQueue.songs.length > 1) message.channel.send(`Added to Queue: ${track[0].name} by ${track[0].artists[0].name}`);
}
catch(e) {
  message.channel.send("Please specify a song or link.")
  console.log(e);
}
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
  next(message);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!pause')) return;
  player.pause()
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!unpause')) return;
  player.unpause()
});


client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!shuffle')) return;
  const serverQueue = queue.get(message.guild.id); // this is block level, it will make it undefined
  const queueArr = JSON.parse(JSON.stringify(serverQueue.songs));
  queueArr.shift();
  shuffle(queueArr);
  serverQueue.songs.splice(1);
  queueArr.forEach(t=>serverQueue.songs.push(t));
  console.log("shuffled");
  message.channel.send('Shuffled the Queue.')
});


async function playSong(message, connection, song) {
  const stream = await getStreamFromSpotify(song, message, connection);
  let player = createAudioPlayer({
    behaviours: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
  player.removeAllListeners('error');
  player.on('error', (error) =>{
    console.log(error);
    audioPlayerError = true;
  });
  
  if (typeof stream === 'undefined') {
    console.log('stream undefined');
    player.removeAllListeners(AudioPlayerStatus.Idle);
    next(message);
  }
  else {
  const resource = await createAudioResource(stream.stream, {
    inputType: stream.type
  });
  try {
  message.channel.send(`Now playing: ${song.name} by ${song.artists[0].name}`);
  connection.subscribe(player);
  player.play(resource);
  }
  catch(e) {
    console.log(e);
    message.channel.send(`Now playing: ${song.name} by ${song.artists[0].name}`);
    connection.subscribe(player);
    player.play(resource);
  }
  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.on( AudioPlayerStatus.Idle, () => {
    if (audioPlayerError == true) {
      const serverQueue = queue.get(message.guild.id);
      if (serverQueue.songs.length > 0) {
        console.log('audio player status')
        playSong(message, connection, serverQueue.songs[0]);
      } else {
        player.stop();
        setTimeout(() => connection.destroy(), 5_000);
        queue.delete(message.guild.id);
        message.channel.send('No more songs to play.');
      }
      audioPlayerError = false;
    }
    else{
    player.stop();
    console.log("Audio Player Listener");
    const serverQueue = queue.get(message.guild.id);
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      console.log('audio player status')
      playSong(message, connection, serverQueue.songs[0]);
    } else {
      player.stop();
      setTimeout(() => connection.destroy(), 5_000);
      queue.delete(message.guild.id);
      message.channel.send('No more songs to play.');
    }
  }
  }) 
};
}; 

async function getStreamFromSpotify(track, message, connection) {
  
  const trackInfo = await spotifyApi.getTrack(track.id, { market: 'US' });
  // const trackPreviewUrl = trackInfo.body.preview_url;
  const trackurl = trackInfo.body.external_urls.spotify;
  let videoID = ""
  await SpottyDL.getTrack(trackurl)
    .then(async(results) => {
      videoID = results.id;
      console.log(`The track URL is ${trackurl}, the video is is ${videoID}. Song is ${track.name}`)
    })
  try {
  const stream = await play.stream("https://music.youtube.com/watch?v="+videoID, {
    discordPlayerCompatibility: true,
    quality: 2,
  })
    return stream
  }
  catch(e) {
    console.log(e);
    const serverQueue = queue.get(message.guild.id);
    let songName = serverQueue.songs[0].name;
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      message.channel.send(`${songName} not found, skipping to next track.`)
      console.log(`${songName} not found`)
      getStreamFromSpotify(serverQueue.songs[0], message, connection);
    } else {
      player.stop();
      setTimeout(() => connection.destroy(), 5_000);
      queue.delete(message.guild.id);
      message.channel.send('No more songs to play.')
    }
    
  }
};

function shuffle(array) {
  let currentIndex = array.length,  randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {

    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }

  return array;
};

async function next(message) {
  const connection = getVoiceConnection(message.guild.id);
  const serverQueue = queue.get(message.guild.id);
  serverQueue.songs.shift();
  if (serverQueue.songs.length > 0) {
    console.log('next');
    playSong(message, connection, serverQueue.songs[0]);
  } else {
    player.stop();
    connection.destroy();
    queue.delete(message.guild.id);
    message.channel.send('No more songs to play.')
  }
};

// Log in to the Discord bot client
client.login(process.env.TOKEN);

