#include <gio/gio.h>
#include <cstdint>
#include <iostream>
#include <napi.h>
#include <memory>

template <typename T>
struct GObjectDeleter
{
    void operator()(T *obj) const
    {
        if (obj)
            g_object_unref(obj);
    }
};

template <typename T>
using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

struct GVariantDeleter
{
    void operator()(GVariant *variant) const
    {
        if (variant)
            g_variant_unref(variant);
    }
};

using GVariantPtr = std::unique_ptr<GVariant, GVariantDeleter>;

struct GErrorDeleter
{
    void operator()(GError *error) const
    {
        if (error)
            g_error_free(error);
    }
};

using GErrorPtr = std::unique_ptr<GError, GErrorDeleter>;

bool request_background(bool autostart, const std::vector<std::string> &commandline)
{
    GError *error = nullptr;

    GObjectPtr<GDBusConnection> bus(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!bus)
    {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::request_background] Failed to connect to session bus: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    GVariantBuilder builder;
    g_variant_builder_init(&builder, G_VARIANT_TYPE("a{sv}"));
    g_variant_builder_add(&builder, "{sv}", "autostart", g_variant_new_boolean(autostart));

    if (!commandline.empty())
    {
        GVariantBuilder cmd_builder;
        g_variant_builder_init(&cmd_builder, G_VARIANT_TYPE("as"));
        for (const auto &s : commandline)
            g_variant_builder_add(&cmd_builder, "s", s.c_str());
        g_variant_builder_add(&builder, "{sv}", "commandline", g_variant_builder_end(&cmd_builder));
    }

    GVariantPtr reply(g_dbus_connection_call_sync(
        bus.get(),
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Background",
        "RequestBackground",
        g_variant_new("(sa{sv})", "", &builder),
        nullptr,
        G_DBUS_CALL_FLAGS_NONE,
        5000,
        nullptr,
        &error));

    if (!reply)
    {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::request_background] Failed to call RequestBackground: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    return true;
}

Napi::Value RequestBackground(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsBoolean() || !info[1].IsArray())
    {
        Napi::TypeError::New(env, "Expected (boolean, string[])").ThrowAsJavaScriptException();
        return env.Null();
    }

    bool autostart = info[0].As<Napi::Boolean>();
    Napi::Array arr = info[1].As<Napi::Array>();
    std::vector<std::string> commandline;
    for (uint32_t i = 0; i < arr.Length(); i++)
    {
        Napi::Value v = arr.Get(i);
        if (v.IsString())
            commandline.push_back(v.As<Napi::String>().Utf8Value());
    }

    bool ok = request_background(autostart, commandline);
    return Napi::Boolean::New(env, ok);
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("requestBackground", Napi::Function::New(env, RequestBackground));
    return exports;
}

NODE_API_MODULE(libvesktop, Init)
