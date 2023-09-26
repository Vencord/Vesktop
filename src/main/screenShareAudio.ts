import { createVirtmic } from "./createVirtmic";
export function getAudioFromVirtmic() {
    const getAudioDevice = async (deviceName: string|undefined) => {
        await new Promise(r => setTimeout(r, 1000));
        let devices = await navigator.mediaDevices.enumerateDevices();
        let audioDevice = devices.find(({
            label
        }) => label === deviceName);
        
        return audioDevice;
    };

    const getDisplayMedia = async () => {
        var id: string|undefined;
        try {
            let myDiscordAudioSink = await getAudioDevice('virtmic');
            id = myDiscordAudioSink?.deviceId;
        }
        catch (error) {
            id = 'default';
        }

        const constraints = {
            deviceId: {
                exact: id
            },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2
        };

        await navigator.mediaDevices.getUserMedia({
            audio: true 
        }).then((MediaStream) => {
            const audioTrack = MediaStream.getAudioTracks()[0];
            let captureSystemAudioStream = audioTrack.applyConstraints(constraints);
        });
    };
};