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
};