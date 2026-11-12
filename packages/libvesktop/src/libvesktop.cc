#include <gio/gio.h>
#include <algorithm>
#include <cstdint>
#include <functional>
#include <iostream>
#include <map>
#include <napi.h>
#include <memory>
#include <string>
#include <vector>

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

struct SignalSubscription {
  SignalSubscription() = default;
  SignalSubscription(GDBusConnection *conn, guint id) : conn_(conn), id_(id) {}
  ~SignalSubscription() { reset(); }

  SignalSubscription(const SignalSubscription &) = delete;
  SignalSubscription &operator=(const SignalSubscription &) = delete;

  SignalSubscription(SignalSubscription &&o) noexcept : conn_(o.conn_), id_(o.id_) { o.id_ = 0; }
  SignalSubscription &operator=(SignalSubscription &&o) noexcept {
    if (this != &o) { reset(); conn_ = o.conn_; id_ = o.id_; o.id_ = 0; }
    return *this;
  }

  void reset() {
    if (id_) { g_dbus_connection_signal_unsubscribe(conn_, id_); id_ = 0; }}
  explicit operator bool() const { return id_ != 0; }

private:
  GDBusConnection *conn_ = nullptr;
  guint id_ = 0;
};

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

bool is_status_notifier_host_registered()
{
    GError *error = nullptr;

    GObjectPtr<GDBusConnection> bus(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!bus)
    {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::is_status_notifier_host_registered] Failed to connect to session bus: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    // Fails with ServiceUnknown if the watcher isn't running yet
    GVariantPtr reply(g_dbus_connection_call_sync(
        bus.get(),
        "org.kde.StatusNotifierWatcher",
        "/StatusNotifierWatcher",
        "org.freedesktop.DBus.Properties",
        "Get",
        g_variant_new("(ss)", "org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered"),
        G_VARIANT_TYPE("(v)"),
        G_DBUS_CALL_FLAGS_NO_AUTO_START,
        1000,
        nullptr,
        &error));

    if (!reply)
    {
        GErrorPtr error_ptr(error);
        return false;
    }

    GVariant *inner_raw = nullptr;
    g_variant_get(reply.get(), "(v)", &inner_raw);
    GVariantPtr inner(inner_raw);

    return inner && g_variant_is_of_type(inner.get(), G_VARIANT_TYPE_BOOLEAN) && g_variant_get_boolean(inner.get());
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

Napi::Value IsStatusNotifierHostRegistered(const Napi::CallbackInfo &info)
{
    return Napi::Boolean::New(info.Env(), is_status_notifier_host_registered());
}


constexpr const char *PORTAL_BUS_NAME = "org.freedesktop.portal.Desktop";
constexpr const char *PORTAL_PATH = "/org/freedesktop/portal/desktop";
constexpr const char *SHORTCUTS_INTERFACE = "org.freedesktop.portal.GlobalShortcuts";

// Tells the portal our app id. Unsandboxed apps otherwise have an empty app id, which portals use to persist things like shortcut triggers.
// Must happen before any other portal call on this connection.
bool register_host_app(const std::string &app_id)
{
    GError *error = nullptr;

    GObjectPtr<GDBusConnection> bus(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!bus)
    {
        GErrorPtr error_ptr(error);
        return false;
    }

    GVariantBuilder options;
    g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);

    GVariantPtr reply(g_dbus_connection_call_sync(
        bus.get(),
        PORTAL_BUS_NAME,
        PORTAL_PATH,
        "org.freedesktop.host.portal.Registry",
        "Register",
        g_variant_new("(sa{sv})", app_id.c_str(), &options),
        nullptr,
        G_DBUS_CALL_FLAGS_NONE,
        1000,
        nullptr,
        &error));

    if (!reply)
    {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::register_host_app] Failed to register app id: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    // The registration belongs to this connection's unique name. The shared bus connection is only weakly cached by GLib,
    // so keep it alive forever to not lose the registration once all other references are dropped
    bus.release();
    return true;
}

Napi::Value RegisterHostApp(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Boolean::New(env, register_host_app(info[0].As<Napi::String>().Utf8Value()));
}

// Opens GNOME Settings on the page of the given app, which is where GNOME lets you change its global shortcuts
bool open_gnome_app_settings(const std::string &app_id)
{
    GError *error = nullptr;

    GObjectPtr<GDBusConnection> bus(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
    if (!bus)
    {
        GErrorPtr error_ptr(error);
        return false;
    }

    GVariantBuilder panel_args;
    g_variant_builder_init(&panel_args, G_VARIANT_TYPE("av"));
    g_variant_builder_add(&panel_args, "v", g_variant_new_string(app_id.c_str()));

    GVariantBuilder action_params;
    g_variant_builder_init(&action_params, G_VARIANT_TYPE("av"));
    g_variant_builder_add(&action_params, "v", g_variant_new("(sav)", "applications", &panel_args));

    GVariantBuilder platform_data;
    g_variant_builder_init(&platform_data, G_VARIANT_TYPE_VARDICT);

    GVariantPtr reply(g_dbus_connection_call_sync(
        bus.get(),
        "org.gnome.Settings",
        "/org/gnome/Settings",
        "org.freedesktop.Application",
        "ActivateAction",
        g_variant_new("(sava{sv})", "launch-panel", &action_params, &platform_data),
        nullptr,
        G_DBUS_CALL_FLAGS_NONE,
        5000,
        nullptr,
        &error));

    if (!reply)
    {
        GErrorPtr error_ptr(error);
        std::cerr << "[libvesktop::open_gnome_app_settings] Failed to open GNOME Settings: "
                  << (error_ptr ? error_ptr->message : "unknown error") << std::endl;
        return false;
    }

    return true;
}

Napi::Value OpenGnomeAppSettings(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Boolean::New(env, open_gnome_app_settings(info[0].As<Napi::String>().Utf8Value()));
}

// org.freedesktop.portal.GlobalShortcuts session. Reports everything through the callback passed to the constructor:
// ("version", number), ("ready"), ("fatal", message), ("error", message),
// ("shortcuts", { id, description, trigger }[]), ("shortcut", id, pressed)
class XDPGlobalShortcuts : public Napi::ObjectWrap<XDPGlobalShortcuts>
{
public:
    static void Init(Napi::Env env, Napi::Object exports)
    {
        exports.Set("XDPGlobalShortcuts", DefineClass(env, "XDPGlobalShortcuts", {
            InstanceMethod("bindShortcuts", &XDPGlobalShortcuts::BindShortcuts),
            InstanceMethod("configureShortcuts", &XDPGlobalShortcuts::ConfigureShortcuts),
            InstanceMethod("destroy", &XDPGlobalShortcuts::Destroy),
        }));
    }

    XDPGlobalShortcuts(const Napi::CallbackInfo &info) : ObjectWrap(info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsFunction())
        {
            Napi::TypeError::New(env, "Expected (function)").ThrowAsJavaScriptException();
            return;
        }

        GError *error = nullptr;
        connection_.reset(g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error));
        if (!connection_)
        {
            GErrorPtr error_ptr(error);
            Napi::Error::New(env, error_ptr ? error_ptr->message : "Failed to connect to session bus")
                .ThrowAsJavaScriptException();
            return;
        }

        // Request objects live at /org/freedesktop/portal/desktop/request/SENDER/TOKEN, where SENDER is our unique name (":1.23" -> "1_23")
        std::string sender = g_dbus_connection_get_unique_name(connection_.get()) + 1;
        std::replace(sender.begin(), sender.end(), '.', '_');
        requestPathPrefix_ = std::string(PORTAL_PATH) + "/request/" + sender + "/";

        cancellable_.reset(g_cancellable_new());
        tsfn_ = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "libvesktop-global-shortcuts", 0, 1);
        active_ = true;

        FetchVersion();
        SubscribeSignals();
        CreateSession();
    }

    ~XDPGlobalShortcuts() override { Cleanup(); }

private:
    using ArgFactory = std::function<Napi::Value(Napi::Env)>;
    using ReplyCallback = std::function<void(GVariant *reply, GError *error)>;
    using ResponseCallback = std::function<void(guint32 response, GVariant *results)>;
    using SignalCallback = std::function<void(GVariant *parameters)>;

    GObjectPtr<GDBusConnection> connection_;
    GObjectPtr<GCancellable> cancellable_;
    Napi::ThreadSafeFunction tsfn_;
    bool active_ = false;
    std::string requestPathPrefix_;
    std::string session_;
    // Tokens must be unique per connection, so shared between all instances
    static inline guint32 nextToken_ = 0;
    std::map<std::string, SignalSubscription> requests_;
    std::vector<SignalSubscription> signals_;

    Napi::Value BindShortcuts(const Napi::CallbackInfo &info)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsArray())
        {
            Napi::TypeError::New(env, "Expected ({ id: string, description: string }[])").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        if (session_.empty())
        {
            Napi::Error::New(env, "Session is not ready").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        GVariantBuilder shortcuts;
        g_variant_builder_init(&shortcuts, G_VARIANT_TYPE("a(sa{sv})"));

        Napi::Array arr = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++)
        {
            Napi::Object item = arr.Get(i).As<Napi::Object>();
            std::string id = item.Get("id").ToString().Utf8Value();
            std::string description = item.Get("description").ToString().Utf8Value();

            GVariantBuilder props;
            g_variant_builder_init(&props, G_VARIANT_TYPE_VARDICT);
            g_variant_builder_add(&props, "{sv}", "description", g_variant_new_string(description.c_str()));
            g_variant_builder_add(&shortcuts, "(sa{sv})", id.c_str(), &props);
        }

        std::string token = NewToken();
        GVariantBuilder options;
        g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
        g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token.c_str()));

        Request("BindShortcuts", token,
            g_variant_new("(oa(sa{sv})sa{sv})", session_.c_str(), &shortcuts, "", &options),
            "error",
            [this](guint32 response, GVariant *results) {
                if (response != 0)
                {
                    Emit("error", {Str(response == 1 ? "Binding shortcuts was cancelled" : "Failed to bind shortcuts")});
                    return;
                }

                GVariantPtr bound(g_variant_lookup_value(results, "shortcuts", G_VARIANT_TYPE("a(sa{sv})")));
                Emit("shortcuts", {ParseShortcuts(bound.get())});
            });

        return env.Undefined();
    }

    Napi::Value ConfigureShortcuts(const Napi::CallbackInfo &info)
    {
        if (session_.empty())
        {
            Napi::Error::New(info.Env(), "Session is not ready").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }

        GVariantBuilder options;
        g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);

        Call(PORTAL_PATH, SHORTCUTS_INTERFACE, "ConfigureShortcuts",
            g_variant_new("(osa{sv})", session_.c_str(), "", &options),
            nullptr,
            [this](GVariant *, GError *error) {
                if (error)
                    Emit("error", {Str(std::string("ConfigureShortcuts: ") + error->message)});
            });

        return info.Env().Undefined();
    }

    Napi::Value Destroy(const Napi::CallbackInfo &info)
    {
        Cleanup();
        return info.Env().Undefined();
    }

    void Cleanup()
    {
        if (!active_)
            return;
        active_ = false;

        g_cancellable_cancel(cancellable_.get());
        requests_.clear();
        signals_.clear();

        if (!session_.empty())
        {
            g_dbus_connection_call(connection_.get(), PORTAL_BUS_NAME, session_.c_str(), "org.freedesktop.portal.Session",
                "Close", nullptr, nullptr, G_DBUS_CALL_FLAGS_NONE, -1, nullptr, nullptr, nullptr);
            session_.clear();
        }

        tsfn_.Release();
    }

    void FetchVersion()
    {
        Call(PORTAL_PATH, "org.freedesktop.DBus.Properties", "Get",
            g_variant_new("(ss)", SHORTCUTS_INTERFACE, "version"),
            G_VARIANT_TYPE("(v)"),
            [this](GVariant *reply, GError *) {
                guint32 version = 0;
                if (reply)
                {
                    GVariant *raw = nullptr;
                    g_variant_get(reply, "(v)", &raw);
                    GVariantPtr value(raw);
                    if (g_variant_is_of_type(value.get(), G_VARIANT_TYPE_UINT32))
                        version = g_variant_get_uint32(value.get());
                }
                Emit("version", {[version](Napi::Env env) -> Napi::Value { return Napi::Number::New(env, version); }});
            });
    }

    void CreateSession()
    {
        std::string token = NewToken();
        GVariantBuilder options;
        g_variant_builder_init(&options, G_VARIANT_TYPE_VARDICT);
        g_variant_builder_add(&options, "{sv}", "handle_token", g_variant_new_string(token.c_str()));
        g_variant_builder_add(&options, "{sv}", "session_handle_token", g_variant_new_string(token.c_str()));

        Request("CreateSession", token, g_variant_new("(a{sv})", &options), "fatal",
            [this](guint32 response, GVariant *results) {
                // Older portal versions send the handle as a string, newer as an object path
                GVariantPtr handle(g_variant_lookup_value(results, "session_handle", nullptr));
                if (response != 0 || !handle ||
                    !(g_variant_is_of_type(handle.get(), G_VARIANT_TYPE_STRING) ||
                      g_variant_is_of_type(handle.get(), G_VARIANT_TYPE_OBJECT_PATH)))
                {
                    Emit("fatal", {Str("Failed to create session (response " + std::to_string(response) + ")")});
                    return;
                }

                session_ = g_variant_get_string(handle.get(), nullptr);
                Emit("ready");
            });
    }

    void SubscribeSignals()
    {
        auto onKey = [this](bool pressed) {
            return [this, pressed](GVariant *parameters) {
                const char *session = nullptr;
                const char *id = nullptr;
                guint64 timestamp = 0;
                g_variant_get(parameters, "(&o&sta{sv})", &session, &id, &timestamp, nullptr);
                if (session_ != session)
                    return;

                Emit("shortcut", {Str(id), [pressed](Napi::Env env) -> Napi::Value { return Napi::Boolean::New(env, pressed); }});
            };
        };

        signals_.push_back(Subscribe(SHORTCUTS_INTERFACE, "Activated", PORTAL_PATH, onKey(true)));
        signals_.push_back(Subscribe(SHORTCUTS_INTERFACE, "Deactivated", PORTAL_PATH, onKey(false)));
        signals_.push_back(Subscribe(SHORTCUTS_INTERFACE, "ShortcutsChanged", PORTAL_PATH, [this](GVariant *parameters) {
            const char *session = nullptr;
            GVariant *raw = nullptr;
            g_variant_get(parameters, "(&o@a(sa{sv}))", &session, &raw);
            GVariantPtr shortcuts(raw);
            if (session_ == session)
                Emit("shortcuts", {ParseShortcuts(shortcuts.get())});
        }));
    }

    std::string NewToken() { return "vesktop" + std::to_string(++nextToken_); }

    void Call(const char *path, const char *interface, const char *method, GVariant *params,
              const GVariantType *replyType, ReplyCallback callback)
    {
        g_dbus_connection_call(
            connection_.get(), PORTAL_BUS_NAME, path, interface, method, params, replyType,
            G_DBUS_CALL_FLAGS_NONE, -1, cancellable_.get(),
            [](GObject *source, GAsyncResult *res, gpointer user_data) {
                std::unique_ptr<ReplyCallback> callback(static_cast<ReplyCallback *>(user_data));
                GError *raw_error = nullptr;
                GVariantPtr reply(g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), res, &raw_error));
                GErrorPtr error(raw_error);

                // Cancelled means we were destroyed, so the callback must not run
                if (!g_error_matches(error.get(), G_IO_ERROR, G_IO_ERROR_CANCELLED))
                    (*callback)(reply.get(), error.get());
            },
            new ReplyCallback(std::move(callback)));
    }

    // Calls a portal method that answers asynchronously with a Request::Response signal
    void Request(const char *method, const std::string &token, GVariant *params, const char *errorEvent,
                 ResponseCallback onResponse)
    {
        requests_[token] = Subscribe("org.freedesktop.portal.Request", "Response", (requestPathPrefix_ + token).c_str(),
            [this, token, onResponse](GVariant *parameters) {
                guint32 response = 2;
                GVariant *raw = nullptr;
                g_variant_get(parameters, "(u@a{sv})", &response, &raw);
                GVariantPtr results(raw);

                // Erasing unsubscribes this handler, so copy what we need first
                ResponseCallback callback = onResponse;
                std::string key = token;
                requests_.erase(key);
                callback(response, results.get());
            });

        Call(PORTAL_PATH, SHORTCUTS_INTERFACE, method, params, G_VARIANT_TYPE("(o)"),
            [this, token, method = std::string(method), errorEvent = std::string(errorEvent)](GVariant *, GError *error) {
                if (!error)
                    return;
                requests_.erase(token);
                Emit(errorEvent, {Str(method + ": " + error->message)});
            });
    }

    SignalSubscription Subscribe(const char *interface, const char *signal, const char *path, SignalCallback callback)
    {
        guint id = g_dbus_connection_signal_subscribe(
            connection_.get(), PORTAL_BUS_NAME, interface, signal, path, nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
            [](GDBusConnection *, const char *, const char *, const char *, const char *, GVariant *parameters,
               gpointer user_data) { (*static_cast<SignalCallback *>(user_data))(parameters); },
            new SignalCallback(std::move(callback)),
            [](gpointer user_data) { delete static_cast<SignalCallback *>(user_data); });

        return {connection_.get(), id};
    }

    void Emit(std::string name, std::vector<ArgFactory> args = {})
    {
        if (!active_)
            return;

        using Event = std::pair<std::string, std::vector<ArgFactory>>;
        tsfn_.NonBlockingCall(new Event(std::move(name), std::move(args)),
            [](Napi::Env env, Napi::Function callback, Event *event) {
                std::unique_ptr<Event> owned(event);
                if (env == nullptr)
                    return;

                std::vector<napi_value> values{Napi::String::New(env, owned->first)};
                for (auto &make : owned->second)
                    values.push_back(make(env));
                callback.Call(values);
            });
    }

    static ArgFactory Str(std::string value)
    {
        return [value = std::move(value)](Napi::Env env) -> Napi::Value { return Napi::String::New(env, value); };
    }

    static ArgFactory ParseShortcuts(GVariant *shortcuts)
    {
        struct Shortcut
        {
            std::string id, description, trigger;
        };
        std::vector<Shortcut> parsed;

        if (shortcuts)
        {
            GVariantIter iter;
            g_variant_iter_init(&iter, shortcuts);
            const char *id = nullptr;
            GVariant *raw = nullptr;
            while (g_variant_iter_next(&iter, "(&s@a{sv})", &id, &raw))
            {
                GVariantPtr props(raw);
                const char *description = "";
                const char *trigger = "";
                g_variant_lookup(props.get(), "description", "&s", &description);
                g_variant_lookup(props.get(), "trigger_description", "&s", &trigger);
                parsed.push_back({id, description, trigger});
            }
        }

        return [parsed = std::move(parsed)](Napi::Env env) -> Napi::Value {
            Napi::Array arr = Napi::Array::New(env, parsed.size());
            for (size_t i = 0; i < parsed.size(); i++)
            {
                Napi::Object obj = Napi::Object::New(env);
                obj.Set("id", parsed[i].id);
                obj.Set("description", parsed[i].description);
                obj.Set("trigger", parsed[i].trigger);
                arr.Set(i, obj);
            }
            return arr;
        };
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("requestBackground", Napi::Function::New(env, RequestBackground));
    exports.Set("isStatusNotifierHostRegistered", Napi::Function::New(env, IsStatusNotifierHostRegistered));
    exports.Set("registerHostApp", Napi::Function::New(env, RegisterHostApp));
    exports.Set("openGnomeAppSettings", Napi::Function::New(env, OpenGnomeAppSettings));
    XDPGlobalShortcuts::Init(env, exports);
    return exports;
}

NODE_API_MODULE(libvesktop, Init)
