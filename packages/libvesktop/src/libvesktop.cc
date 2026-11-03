#include <gio/gio.h>
#include <napi.h>

#include <cstdint>
#include <iostream>
#include <memory>

template <typename T>
struct GObjectDeleter {
    void operator()(T* obj) const {
        if (obj)
            g_object_unref(obj);
    }
};

template <typename T>
using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

struct GVariantDeleter {
    void operator()(GVariant* variant) const {
        if (variant)
            g_variant_unref(variant);
    }
};

using GVariantPtr = std::unique_ptr<GVariant, GVariantDeleter>;

struct GErrorDeleter {
    void operator()(GError* error) const {
        if (error)
            g_error_free(error);
    }
};

using GErrorPtr = std::unique_ptr<GError, GErrorDeleter>;

bool request_background(bool autostart, const std::vector<std::string>& commandline) {
    GError* error = nullptr;

    GObjectPtr<GDBusConnection> bus(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!bus) {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::request_background] Failed to connect to session bus: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    GVariantBuilder builder;
    g_variant_builder_init(&builder, G_VARIANT_TYPE("a{sv}"));
    g_variant_builder_add(&builder, "{sv}", "autostart", g_variant_new_boolean(autostart));

    if (!commandline.empty()) {
        GVariantBuilder cmd_builder;
        g_variant_builder_init(&cmd_builder, G_VARIANT_TYPE("as"));
        for (const auto& s : commandline)
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

    if (!reply) {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::request_background] Failed to call RequestBackground: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    return true;
}

Napi::Value RequestBackground(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsBoolean() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "Expected (boolean, string[])").ThrowAsJavaScriptException();
        return env.Null();
    }

    bool autostart = info[0].As<Napi::Boolean>();
    Napi::Array arr = info[1].As<Napi::Array>();
    std::vector<std::string> commandline;
    for (uint32_t i = 0; i < arr.Length(); i++) {
        Napi::Value v = arr.Get(i);
        if (v.IsString())
            commandline.push_back(v.As<Napi::String>().Utf8Value());
    }

    bool ok = request_background(autostart, commandline);
    return Napi::Boolean::New(env, ok);
}

static const char* application_interface_xml =
    "<node>"
    "  <interface name='org.freedesktop.Application'>"
    "    <method name='Activate'>"
    "      <arg type='a{sv}' name='platform_data' direction='in'/>"
    "    </method>"
    "  </interface>"
    "</node>";

struct ActivationListener {
    std::string app_id;
    std::string object_path;
    Napi::ThreadSafeFunction callback;
};

static void on_application_method_call(GDBusConnection*, const gchar*, const gchar*, const gchar*,
                                       const gchar*, GVariant* parameters, GDBusMethodInvocation* invocation,
                                       gpointer user_data) {
    auto* listener = static_cast<ActivationListener*>(user_data);

    GVariantPtr platform_data(g_variant_get_child_value(parameters, 0));
    GVariantPtr token(g_variant_lookup_value(platform_data.get(), "activation-token", G_VARIANT_TYPE_STRING));
    if (!token)
        token.reset(g_variant_lookup_value(platform_data.get(), "desktop-startup-id", G_VARIANT_TYPE_STRING));

    std::string activation_token = token ? g_variant_get_string(token.get(), nullptr) : "";

    g_dbus_method_invocation_return_value(invocation, nullptr);

    listener->callback.NonBlockingCall([activation_token](Napi::Env env, Napi::Function callback) { callback.Call({Napi::String::New(env, activation_token)}); });
}

static void on_bus_acquired(GDBusConnection* connection, const gchar*, gpointer user_data) {
    auto* listener = static_cast<ActivationListener*>(user_data);

    GDBusNodeInfo* node_info = g_dbus_node_info_new_for_xml(application_interface_xml, nullptr);
    static const GDBusInterfaceVTable vtable = {on_application_method_call, nullptr, nullptr, {}};

    GError* error = nullptr;
    if (!g_dbus_connection_register_object(connection, listener->object_path.c_str(), node_info->interfaces[0],
                                           &vtable, listener, nullptr, &error)) {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::listen_for_activation] Failed to register object: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
    }

    g_dbus_node_info_unref(node_info);
}

static gpointer run_activation_listener(gpointer user_data) {
    auto* listener = static_cast<ActivationListener*>(user_data);

    GMainContext* context = g_main_context_new();
    g_main_context_push_thread_default(context);

    g_bus_own_name(G_BUS_TYPE_SESSION, listener->app_id.c_str(), G_BUS_NAME_OWNER_FLAGS_NONE, on_bus_acquired,
                   nullptr, nullptr, listener, nullptr);

    GMainLoop* loop = g_main_loop_new(context, FALSE);
    g_main_loop_run(loop);
    return nullptr;
}

Napi::Value ListenForActivation(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected (string, function)").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto* listener = new ActivationListener();
    listener->app_id = info[0].As<Napi::String>().Utf8Value();

    // org.freedesktop.Application expects the app id as a path, e.g. dev.vencord.Vesktop -> /dev/vencord/Vesktop
    listener->object_path = "/" + listener->app_id;
    for (auto& c : listener->object_path) {
        if (c == '.')
            c = '/';
        else if (c == '-')
            c = '_';
    }

    listener->callback = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(),
                                                       "libvesktop::listenForActivation", 0, 1);
    // Don't keep the process alive just for this listener
    listener->callback.Unref(env);

    g_thread_unref(g_thread_new("libvesktop-activation", run_activation_listener, listener));
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("requestBackground", Napi::Function::New(env, RequestBackground));
    exports.Set("listenForActivation", Napi::Function::New(env, ListenForActivation));
    return exports;
}

NODE_API_MODULE(libvesktop, Init)
