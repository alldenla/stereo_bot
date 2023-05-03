require('dotenv/config');
const {Client, IntentsBitField } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, NoSubscriberBehavior, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const { Readable } = require('stream');
const SpottyDL = require('spottydl');
const play = require('play-dl');
var http = require('http'); 

http.createServer(function (req, res) { 
  res.write("I'm alive"); 
  res.end(); 
}).listen(8080);

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
function newToken() {spotifyApi.clientCredentialsGrant()
  .then((data) => {
    spotifyAccessToken = data.body.access_token;
    spotifyApi.setAccessToken(spotifyAccessToken);
    console.log('access token set')
  })
  .catch((error) => {
    console.log('Error retrieving Spotify access token:', error);
  });
}

newToken();
tokenRefreshInterval = setInterval(newToken, 1000 * 60 * 14);

// Set up the music queue
const queue = new Map();
const player = createAudioPlayer({
    behaviours: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });
// Define the 'play' command for the bot

const autoShuffle = true;

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
})



async function playSong(message, connection, song) {
  console.log("Function: PlaySong");
  const stream = await getStreamFromSpotify(song, message, connection);
  if (typeof stream === 'undefined') next(message);
  else {
  const resource = await createAudioResource(stream.stream);
  player.stop();
  player.play(resource);
  connection.subscribe(player);
  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.on( AudioPlayerStatus.Idle, () => {
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
    
  })

  message.channel.send(`Now playing: ${song.name} by ${song.artists[0].name}`);
}
}

//fix incorrect youtube url

async function getStreamFromSpotify(track, message, connection) {
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
  try {
  const stream = await play.stream("https://www.youtube.com/watch?v="+videoID, {
    discordPlayerCompatibility: true,
    quality: 2,
  })
    return stream
  }
  catch(e) {
    const serverQueue = queue.get(message.guild.id);
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      getStreamFromSpotify(serverQueue.songs[0], message, connection);
    } else {
      player.stop();
      setTimeout(() => connection.destroy(), 5_000);
      queue.delete(message.guild.id);
    }
    message.channel.send("Song not found, skipping to next track.")
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

function next(message) {
  const connection = getVoiceConnection(message.guild.id);
  const serverQueue = queue.get(message.guild.id);
  serverQueue.songs.shift();
  if (serverQueue.songs.length > 0) {
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

