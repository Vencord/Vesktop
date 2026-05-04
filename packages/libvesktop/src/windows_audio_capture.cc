#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <fcntl.h>
#include <mmdeviceapi.h>
#include <objidl.h>
#include <propidl.h>
#include <stdio.h>
#include <stdlib.h>
#include <wrl/client.h>
#include <windows.h>
#include <io.h>

#include <atomic>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace
{
constexpr REFERENCE_TIME BUFFER_DURATION = 200000;
constexpr WORD CHANNELS = 2;
constexpr DWORD SAMPLE_RATE = 48000;
constexpr WORD BITS_PER_SAMPLE = 16;

class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler, public IAgileObject
{
public:
    explicit ActivationHandler(HANDLE event) : event_(event) {}

    STDMETHODIMP QueryInterface(REFIID riid, void **ppvObject) override
    {
        if (ppvObject == nullptr)
        {
            return E_POINTER;
        }

        if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler) ||
            riid == __uuidof(IAgileObject))
        {
            *ppvObject = static_cast<IAgileObject *>(this);
            AddRef();
            return S_OK;
        }

        *ppvObject = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override
    {
        return ++ref_count_;
    }

    STDMETHODIMP_(ULONG) Release() override
    {
        const auto value = --ref_count_;
        if (value == 0)
        {
            delete this;
        }
        return value;
    }

    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override
    {
        HRESULT activate_result = E_FAIL;
        ComPtr<IUnknown> activated_interface;
        result_ = operation->GetActivateResult(&activate_result, &activated_interface);

        if (SUCCEEDED(result_) && SUCCEEDED(activate_result))
        {
            result_ = activated_interface.As(&audio_client_);
        }
        else if (SUCCEEDED(result_))
        {
            result_ = activate_result;
        }

        SetEvent(event_);
        return S_OK;
    }

    HRESULT result() const
    {
        return result_;
    }

    ComPtr<IAudioClient> audio_client() const
    {
        return audio_client_;
    }

private:
    std::atomic<ULONG> ref_count_ = 1;
    HANDLE event_;
    HRESULT result_ = E_PENDING;
    ComPtr<IAudioClient> audio_client_;
};

WAVEFORMATEX create_wave_format()
{
    WAVEFORMATEX format = {};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = CHANNELS;
    format.nSamplesPerSec = SAMPLE_RATE;
    format.wBitsPerSample = BITS_PER_SAMPLE;
    format.nBlockAlign = static_cast<WORD>((format.nChannels * format.wBitsPerSample) / 8);
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    return format;
}

bool write_all(const BYTE *data, size_t length)
{
    while (length > 0)
    {
        const auto written = fwrite(data, 1, length, stdout);
        if (written == 0)
        {
            return false;
        }

        data += written;
        length -= written;
    }

    fflush(stdout);
    return true;
}
} // namespace

int main(int argc, char **argv)
{
    if (argc < 2)
    {
        std::cerr << "Missing target process id" << std::endl;
        return 1;
    }

    const auto pid = static_cast<DWORD>(strtoul(argv[1], nullptr, 10));
    if (pid == 0)
    {
        std::cerr << "Invalid target process id" << std::endl;
        return 1;
    }

    _setmode(_fileno(stdout), _O_BINARY);

    const auto com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com_result))
    {
        std::cerr << "CoInitializeEx failed: 0x" << std::hex << com_result << std::endl;
        return 1;
    }

    HANDLE ready_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!ready_event)
    {
        std::cerr << "CreateEvent failed" << std::endl;
        CoUninitialize();
        return 1;
    }

    AUDIOCLIENT_ACTIVATION_PARAMS activation_params = {};
    activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activation_params.ProcessLoopbackParams.TargetProcessId = pid;
    activation_params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activate_params = {};
    activate_params.vt = VT_BLOB;
    activate_params.blob.cbSize = sizeof(activation_params);
    activate_params.blob.pBlobData = reinterpret_cast<BYTE *>(&activation_params);

    auto *handler = new ActivationHandler(ready_event);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;

    const auto activate_hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &activate_params,
        handler,
        &operation);

    if (FAILED(activate_hr))
    {
        std::cerr << "ActivateAudioInterfaceAsync failed: 0x" << std::hex << activate_hr << std::endl;
        handler->Release();
        CloseHandle(ready_event);
        CoUninitialize();
        return 1;
    }

    WaitForSingleObject(ready_event, INFINITE);
    CloseHandle(ready_event);

    const auto handler_result = handler->result();
    auto audio_client = handler->audio_client();
    handler->Release();

    if (FAILED(handler_result) || !audio_client)
    {
        std::cerr << "Activation failed: 0x" << std::hex << handler_result << std::endl;
        CoUninitialize();
        return 1;
    }

    auto format = create_wave_format();
    DWORD stream_flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

    const auto init_hr = audio_client->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        stream_flags,
        BUFFER_DURATION,
        BUFFER_DURATION,
        &format,
        nullptr);

    if (FAILED(init_hr))
    {
        std::cerr << "IAudioClient::Initialize failed: 0x" << std::hex << init_hr << std::endl;
        CoUninitialize();
        return 1;
    }

    HANDLE sample_ready_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!sample_ready_event)
    {
        std::cerr << "CreateEvent for capture failed" << std::endl;
        CoUninitialize();
        return 1;
    }

    const auto event_hr = audio_client->SetEventHandle(sample_ready_event);
    if (FAILED(event_hr))
    {
        std::cerr << "SetEventHandle failed: 0x" << std::hex << event_hr << std::endl;
        CloseHandle(sample_ready_event);
        CoUninitialize();
        return 1;
    }

    ComPtr<IAudioCaptureClient> capture_client;
    const auto capture_hr = audio_client->GetService(IID_PPV_ARGS(&capture_client));
    if (FAILED(capture_hr))
    {
        std::cerr << "GetService(IAudioCaptureClient) failed: 0x" << std::hex << capture_hr << std::endl;
        CloseHandle(sample_ready_event);
        CoUninitialize();
        return 1;
    }

    const auto start_hr = audio_client->Start();
    if (FAILED(start_hr))
    {
        std::cerr << "IAudioClient::Start failed: 0x" << std::hex << start_hr << std::endl;
        CloseHandle(sample_ready_event);
        CoUninitialize();
        return 1;
    }

    std::vector<BYTE> silence;
    silence.reserve(8192);

    while (true)
    {
        const auto wait_result = WaitForSingleObject(sample_ready_event, INFINITE);
        if (wait_result != WAIT_OBJECT_0)
        {
            break;
        }

        UINT32 packet_length = 0;
        if (FAILED(capture_client->GetNextPacketSize(&packet_length)))
        {
            break;
        }

        while (packet_length > 0)
        {
            BYTE *data = nullptr;
            UINT32 frames_available = 0;
            DWORD flags = 0;
            UINT64 device_position = 0;
            UINT64 qpc_position = 0;

            const auto buffer_hr = capture_client->GetBuffer(
                &data,
                &frames_available,
                &flags,
                &device_position,
                &qpc_position);

            if (FAILED(buffer_hr))
            {
                packet_length = 0;
                break;
            }

            const size_t bytes_to_write = static_cast<size_t>(frames_available) * format.nBlockAlign;
            bool wrote = true;

            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0)
            {
                if (silence.size() < bytes_to_write)
                {
                    silence.assign(bytes_to_write, 0);
                }
                wrote = write_all(silence.data(), bytes_to_write);
            }
            else
            {
                wrote = write_all(data, bytes_to_write);
            }

            capture_client->ReleaseBuffer(frames_available);

            if (!wrote)
            {
                packet_length = 0;
                break;
            }

            if (FAILED(capture_client->GetNextPacketSize(&packet_length)))
            {
                packet_length = 0;
                break;
            }
        }
    }

    audio_client->Stop();
    CloseHandle(sample_ready_event);
    CoUninitialize();
    return 0;
}
