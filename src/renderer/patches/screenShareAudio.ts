import { isLinux } from "../utils";
if (isLinux) {
    const original = navigator.mediaDevices.getDisplayMedia;
    async function getVirtmic() {
        const getAudioDevice = async (deviceName: string|undefined) => {;
            let devices = await navigator.mediaDevices.enumerateDevices();
            let audioDevice = devices.find(({
                label
            }) => label === deviceName);
        return audioDevice;
        }    

        var id: string|undefined;
        try {
            let vesktopAudioSink = await getAudioDevice('vesktop-virtmic');
            id = vesktopAudioSink?.deviceId;
        }
        catch (error) {
            id = 'error';
        }
    return id;
    };
    navigator.mediaDevices.getDisplayMedia = async function() {
        const id = await getVirtmic();
        const stream = await original.apply(this);
        if (id !== 'error'){
            const audio = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    deviceId: {
                        exact: id
                    },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false
                } 
            });
            audio.getAudioTracks().forEach(t => stream.addTrack(t));
        };
        return stream;
    };
};