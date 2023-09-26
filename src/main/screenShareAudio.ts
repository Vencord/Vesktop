export function getAudioFromVirtmic() {
    const getAudioDevice = async (deviceName) => {
        await navigator.mediaDevices.getUserMedia({
            audio: true
        });
        
        await new Promise(r => setTimeout(r, 1000));
        let devices = await navigator.mediaDevices.enumerateDevices();
        let audioDevice = devices.find(({
            label
        }) => label === deviceName);
        
        return audioDevice;
    };

    const getDisplayMedia = async () => {
        var id;
        try {
            let myDiscordAudioSink = await getAudioDevice('virtmic');
            id = myDiscordAudioSink?.deviceId;
        }
        catch (error) {
            id = 'default';
        }

        let captureSystemAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                /*deviceId {
                    exact: id
                },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
                channelCount: 2*/
            }
        });
    };
};