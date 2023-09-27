const original = navigator.mediaDevices.getDisplayMedia;
async function getVirtmic() {
    const getAudioDevice = async (deviceName: string|undefined) => {;
        let devices = await navigator.mediaDevices.enumerateDevices();
        let audioDevice = devices.find(({
            label
        }) => label === deviceName);
        console.log(audioDevice);
    return audioDevice;
    }    

    var id: string|undefined;
    try {
        let myDiscordAudioSink = await getAudioDevice('virtmic');
        id = myDiscordAudioSink?.deviceId;
        console.log(id, "connected");
    }
    catch (error) {
        id = 'default';
        console.log("virtmic failed to connect");
    }
return id;
};
navigator.mediaDevices.getDisplayMedia = async function() {
    const id = await getVirtmic();
    const stream = await original.apply(this);

  const audio = await navigator.mediaDevices.getUserMedia({ 
    audio: { 
        deviceId: {
            exact: id
        },
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false
   } });
  audio.getAudioTracks().forEach(t => stream.addTrack(t));
  return stream;
}