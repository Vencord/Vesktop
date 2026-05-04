#include <napi.h>
#include <cstdlib>
#include <optional>
#include <string>
#include <windows.h>
#include <winternl.h>

namespace
{
std::optional<ULONG> parse_handle(const Napi::Value &value)
{
    if (value.IsNumber())
    {
        return static_cast<ULONG>(value.As<Napi::Number>().Uint32Value());
    }

    if (!value.IsString())
    {
        return std::nullopt;
    }

    const auto input = value.As<Napi::String>().Utf8Value();
    if (input.empty())
    {
        return std::nullopt;
    }

    char *end = nullptr;
    const auto parsed = std::strtoull(input.c_str(), &end, 0);
    if (end == input.c_str() || *end != '\0')
    {
        return std::nullopt;
    }

    return static_cast<ULONG>(parsed);
}

bool supports_process_loopback()
{
    const auto ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll)
    {
        return false;
    }

    using RtlGetVersionFn = LONG(WINAPI *)(PRTL_OSVERSIONINFOW);
    const auto rtl_get_version = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
    if (!rtl_get_version)
    {
        return false;
    }

    RTL_OSVERSIONINFOW version = {};
    version.dwOSVersionInfoSize = sizeof(version);

    if (rtl_get_version(&version) != 0)
    {
        return false;
    }

    return version.dwBuildNumber >= 20348;
}
} // namespace

Napi::Value getWindowProcessId(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1)
    {
        Napi::TypeError::New(env, "Expected (string | number)").ThrowAsJavaScriptException();
        return env.Null();
    }

    const auto handle = parse_handle(info[0]);
    if (!handle)
    {
        return env.Null();
    }

    DWORD pid = 0;
    GetWindowThreadProcessId(reinterpret_cast<HWND>(static_cast<uintptr_t>(*handle)), &pid);

    if (pid == 0)
    {
        return env.Null();
    }

    return Napi::Number::New(env, pid);
}

Napi::Value supportsProcessLoopback(const Napi::CallbackInfo &info)
{
    return Napi::Boolean::New(info.Env(), supports_process_loopback());
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("getWindowProcessId", Napi::Function::New(env, getWindowProcessId));
    exports.Set("supportsProcessLoopback", Napi::Function::New(env, supportsProcessLoopback));
    return exports;
}

NODE_API_MODULE(libvesktop, Init)
